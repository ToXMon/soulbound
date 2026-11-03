//! Ticket 007: REQ-30/31/32 heartbeat gate, atomic Core update, and one-unit reward.
use super::test_initialize_character::{initialize, read_config, setup};
use anchor_lang::{
    prelude::Clock,
    solana_program::{program_pack::Pack, system_instruction},
    AccountDeserialize, AccountSerialize, AnchorDeserialize, Discriminator, InstructionData,
    ToAccountMetas,
};
use anchor_spl::token::spl_token::{
    self,
    instruction::AuthorityType,
    state::{Account as SplAccount, Mint as SplMint},
};
use base64::Engine;
use litesvm::{types::TransactionResult, LiteSVM};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::{Transaction, TransactionError};
use soulbound::{HeartbeatCranked, HeartbeatRewardConfig, LifeStage, MemoryRootHistory};

const TOKEN_ID: Pubkey = anchor_spl::token::ID;
const ATA_ID: Pubkey = anchor_spl::associated_token::ID;

fn history_pda(config: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"memory_roots", config.as_ref()], &soulbound::id()).0
}
fn reward_config_pda(config: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"heartbeat_reward", config.as_ref()], &soulbound::id()).0
}
fn ata(owner: Pubkey, mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN_ID.as_ref(), mint.as_ref()], &ATA_ID).0
}
fn submit(
    svm: &mut LiteSVM,
    fee_payer: &Keypair,
    other_signers: &[&Keypair],
    instructions: &[Instruction],
) -> TransactionResult {
    svm.expire_blockhash();
    let message = Message::new(instructions, Some(&fee_payer.pubkey()));
    let mut signers: Vec<&dyn Signer> = vec![fee_payer];
    for signer in other_signers {
        if signer.pubkey() != fee_payer.pubkey() {
            signers.push(*signer);
        }
    }
    svm.send_transaction(Transaction::new(&signers, message, svm.latest_blockhash()))
}
fn commit_ix(
    config: Pubkey,
    runtime: Pubkey,
    payer: Pubkey,
    epoch: u64,
    root: [u8; 32],
) -> Instruction {
    Instruction {
        program_id: soulbound::id(),
        accounts: soulbound::accounts::CommitMemoryRoot {
            config,
            runtime_signer: runtime,
            payer,
            history: history_pda(config),
            system_program: solana_sdk_ids::system_program::id(),
        }
        .to_account_metas(None),
        data: soulbound::instruction::CommitMemoryRoot { epoch, root }.data(),
    }
}
fn configure_reward_ix(config: Pubkey, owner: Pubkey, mint: Pubkey) -> Instruction {
    Instruction {
        program_id: soulbound::id(),
        accounts: soulbound::accounts::InitializeHeartbeatReward {
            config,
            owner,
            reward_config: reward_config_pda(config),
            reward_mint: mint,
            vault: ata(config, mint),
            token_program: TOKEN_ID,
            associated_token_program: ATA_ID,
            system_program: solana_sdk_ids::system_program::id(),
        }
        .to_account_metas(None),
        data: soulbound::instruction::InitializeHeartbeatReward {}.data(),
    }
}
fn crank_ix(config: Pubkey, asset: Pubkey, caller: Pubkey, mint: Pubkey) -> Instruction {
    Instruction {
        program_id: soulbound::id(),
        accounts: soulbound::accounts::CrankHeartbeat {
            config,
            history: history_pda(config),
            reward_config: reward_config_pda(config),
            reward_mint: mint,
            vault: ata(config, mint),
            caller,
            caller_ata: ata(caller, mint),
            asset,
            core_program: mpl_core::ID,
            token_program: TOKEN_ID,
            associated_token_program: ATA_ID,
            system_program: solana_sdk_ids::system_program::id(),
        }
        .to_account_metas(None),
        data: soulbound::instruction::CrankHeartbeat {}.data(),
    }
}

fn commit(
    svm: &mut LiteSVM,
    payer: &Keypair,
    runtime: &Keypair,
    config: Pubkey,
    epoch: u64,
    root: u8,
) {
    submit(
        svm,
        payer,
        &[runtime],
        &[commit_ix(
            config,
            runtime.pubkey(),
            payer.pubkey(),
            epoch,
            [root; 32],
        )],
    )
    .unwrap();
}
fn history(svm: &LiteSVM, config: Pubkey) -> Option<MemoryRootHistory> {
    svm.get_account(&history_pda(config))
        .map(|account| MemoryRootHistory::try_deserialize(&mut account.data.as_slice()).unwrap())
}
fn create_test_mint(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint_authority: Pubkey,
    freeze_authority: Option<Pubkey>,
    decimals: u8,
) -> Keypair {
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(SplMint::LEN);
    let create = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        SplMint::LEN as u64,
        &TOKEN_ID,
    );
    let init = spl_token::instruction::initialize_mint2(
        &TOKEN_ID,
        &mint.pubkey(),
        &mint_authority,
        freeze_authority.as_ref(),
        decimals,
    )
    .unwrap();
    submit(svm, payer, &[&mint], &[create, init]).unwrap();
    mint
}
fn token_account(svm: &LiteSVM, address: Pubkey) -> Option<SplAccount> {
    svm.get_account(&address)
        .map(|account| SplAccount::unpack(&account.data).unwrap())
}
fn mint_account(svm: &LiteSVM, address: Pubkey) -> SplMint {
    SplMint::unpack(&svm.get_account(&address).unwrap().data).unwrap()
}
fn core_attributes(svm: &LiteSVM, asset: Pubkey) -> Vec<(String, String)> {
    mpl_core::Asset::from_bytes(&svm.get_account(&asset).unwrap().data)
        .unwrap()
        .plugin_list
        .attributes
        .unwrap()
        .attributes
        .attribute_list
        .into_iter()
        .map(|attribute| (attribute.key, attribute.value))
        .collect()
}
fn core_life_stage(svm: &LiteSVM, asset: Pubkey) -> String {
    core_attributes(svm, asset)
        .into_iter()
        .find(|(key, _)| key == "life_stage")
        .unwrap()
        .1
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct AccountSnapshot {
    lamports: u64,
    data: Vec<u8>,
    owner: Pubkey,
    executable: bool,
    rent_epoch: u64,
}
fn account_snapshot(svm: &LiteSVM, address: Pubkey) -> Option<AccountSnapshot> {
    svm.get_account(&address).map(|account| AccountSnapshot {
        lamports: account.lamports,
        data: account.data,
        owner: account.owner,
        executable: account.executable,
        rent_epoch: account.rent_epoch,
    })
}
fn snapshot(
    svm: &LiteSVM,
    config: Pubkey,
    asset: Pubkey,
    mint: Pubkey,
    caller: Pubkey,
) -> [Option<AccountSnapshot>; 8] {
    [
        account_snapshot(svm, config),
        account_snapshot(svm, asset),
        account_snapshot(svm, history_pda(config)),
        account_snapshot(svm, reward_config_pda(config)),
        account_snapshot(svm, ata(config, mint)),
        account_snapshot(svm, ata(caller, mint)),
        account_snapshot(svm, caller),
        account_snapshot(svm, mint),
    ]
}
fn reject_unchanged(
    svm: &mut LiteSVM,
    fee_payer: &Keypair,
    caller: &Keypair,
    config: Pubkey,
    asset: Pubkey,
    mint: Pubkey,
    instruction: Instruction,
    custom_code: u32,
) {
    let before = snapshot(svm, config, asset, mint, caller.pubkey());
    let failure = submit(svm, fee_payer, &[caller], &[instruction]).unwrap_err();
    assert_eq!(
        failure.err,
        TransactionError::InstructionError(
            0,
            solana_instruction::error::InstructionError::Custom(custom_code)
        ),
        "{:?}",
        failure.meta.logs
    );
    assert_eq!(
        snapshot(svm, config, asset, mint, caller.pubkey()),
        before,
        "failed crank must leave all application accounts unchanged (transaction fee is separate)"
    );
}

struct Fixture {
    svm: LiteSVM,
    fee_payer: Keypair,
    owner: Keypair,
    runtime: Keypair,
    caller: Keypair,
    mint: Keypair,
    config: Pubkey,
    asset: Pubkey,
}

fn fixture() -> Fixture {
    let (mut svm, fee_payer) = setup();
    let owner = Keypair::new();
    let runtime = Keypair::new();
    let caller = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&caller.pubkey(), 10_000_000_000).unwrap();

    let (result, minted) = initialize(&mut svm, &fee_payer, &owner, 7001, runtime.pubkey(), "calm");
    result.unwrap();
    let config = minted.config;
    let asset = read_config(&svm, &config).asset;

    // Local LiteSVM-only synthetic legacy SPL mint; no host wallet, RPC, or live mint.
    let mint = create_test_mint(&mut svm, &owner, owner.pubkey(), None, 0);
    submit(
        &mut svm,
        &fee_payer,
        &[&owner],
        &[configure_reward_ix(config, owner.pubkey(), mint.pubkey())],
    )
    .unwrap();

    let vault = ata(config, mint.pubkey());
    let mint_one = spl_token::instruction::mint_to_checked(
        &TOKEN_ID,
        &mint.pubkey(),
        &vault,
        &owner.pubkey(),
        &[],
        1,
        0,
    )
    .unwrap();
    let revoke = spl_token::instruction::set_authority(
        &TOKEN_ID,
        &mint.pubkey(),
        None,
        AuthorityType::MintTokens,
        &owner.pubkey(),
        &[],
    )
    .unwrap();
    submit(&mut svm, &owner, &[], &[mint_one, revoke]).unwrap();
    let attempted_remint = spl_token::instruction::mint_to_checked(
        &TOKEN_ID,
        &mint.pubkey(),
        &vault,
        &owner.pubkey(),
        &[],
        1,
        0,
    )
    .unwrap();
    assert!(
        submit(&mut svm, &owner, &[], &[attempted_remint]).is_err(),
        "revoked mint authority must prevent a second unit"
    );
    assert_eq!(mint_account(&svm, mint.pubkey()).supply, 1);
    assert_eq!(token_account(&svm, vault).unwrap().amount, 1);

    Fixture {
        svm,
        fee_payer,
        owner,
        runtime,
        caller,
        mint,
        config,
        asset,
    }
}

fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

#[test]
fn req30_31_32_one_transition_checks_entries_time_syncs_core_and_pays_third_party() {
    let mut f = fixture();
    assert_eq!(
        svm_config_len(&f.svm, f.config),
        154,
        "deployed CharacterConfig layout is preserved"
    );
    let configured = HeartbeatRewardConfig::try_deserialize(
        &mut f
            .svm
            .get_account(&reward_config_pda(f.config))
            .unwrap()
            .data
            .as_slice(),
    )
    .unwrap();
    assert_eq!(
        (configured.config, configured.reward_mint),
        (f.config, f.mint.pubkey())
    );
    let before_duplicate_config = snapshot(
        &f.svm,
        f.config,
        f.asset,
        f.mint.pubkey(),
        f.caller.pubkey(),
    );
    let duplicate_config = submit(
        &mut f.svm,
        &f.owner,
        &[],
        &[configure_reward_ix(
            f.config,
            f.owner.pubkey(),
            f.mint.pubkey(),
        )],
    )
    .unwrap_err();
    assert!(matches!(
        duplicate_config.err,
        TransactionError::InstructionError(..)
    ));
    assert_eq!(
        snapshot(
            &f.svm,
            f.config,
            f.asset,
            f.mint.pubkey(),
            f.caller.pubkey()
        ),
        before_duplicate_config
    );
    let attacker = Keypair::new();
    let before_unauthorized_config = snapshot(
        &f.svm,
        f.config,
        f.asset,
        f.mint.pubkey(),
        f.caller.pubkey(),
    );
    let unauthorized = submit(
        &mut f.svm,
        &f.fee_payer,
        &[&attacker],
        &[configure_reward_ix(
            f.config,
            attacker.pubkey(),
            f.mint.pubkey(),
        )],
    )
    .unwrap_err();
    assert!(matches!(
        unauthorized.err,
        TransactionError::InstructionError(..)
    ));
    assert_eq!(
        snapshot(
            &f.svm,
            f.config,
            f.asset,
            f.mint.pubkey(),
            f.caller.pubkey()
        ),
        before_unauthorized_config
    );
    set_time(&mut f.svm, 1_000);

    // No history account and a one-entry history both fail without application-state changes.
    let empty_history_ix = crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey());
    let before_no_history = snapshot(
        &f.svm,
        f.config,
        f.asset,
        f.mint.pubkey(),
        f.caller.pubkey(),
    );
    let failed = submit(&mut f.svm, &f.fee_payer, &[&f.caller], &[empty_history_ix]).unwrap_err();
    assert!(
        matches!(failed.err, TransactionError::InstructionError(..)),
        "missing history must reject: {:?}",
        failed.meta.logs
    );
    assert_eq!(
        snapshot(
            &f.svm,
            f.config,
            f.asset,
            f.mint.pubkey(),
            f.caller.pubkey()
        ),
        before_no_history
    );

    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 0, 1);
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        f.mint.pubkey(),
        crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey()),
        6015,
    );
    set_time(&mut f.svm, 1_020);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 7, 2); // skipped epoch IDs are entries, not counts

    set_time(&mut f.svm, 1_059);
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        f.mint.pubkey(),
        crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey()),
        6018,
    );
    set_time(&mut f.svm, 999);
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        f.mint.pubkey(),
        crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey()),
        6016,
    );

    set_time(&mut f.svm, 1_060); // exactly first entry timestamp + 60
    assert_ne!(f.caller.pubkey(), f.owner.pubkey());
    assert_ne!(f.caller.pubkey(), f.runtime.pubkey());
    let mut expected_attributes = core_attributes(&f.svm, f.asset);
    let caller_lamports_before = f.svm.get_account(&f.caller.pubkey()).unwrap().lamports;
    let result = submit(
        &mut f.svm,
        &f.fee_payer,
        &[&f.caller],
        &[crank_ix(
            f.config,
            f.asset,
            f.caller.pubkey(),
            f.mint.pubkey(),
        )],
    )
    .unwrap();
    assert_eq!(
        read_config(&f.svm, &f.config).life_stage,
        LifeStage::Awakened
    );
    assert_eq!(svm_config_len(&f.svm, f.config), 154);
    assert_eq!(core_life_stage(&f.svm, f.asset), "awakened");
    expected_attributes
        .iter_mut()
        .find(|(key, _)| key == "life_stage")
        .unwrap()
        .1 = "awakened".into();
    assert_eq!(
        core_attributes(&f.svm, f.asset),
        expected_attributes,
        "all non-stage Core attributes are preserved"
    );
    assert_eq!(
        token_account(&f.svm, ata(f.config, f.mint.pubkey()))
            .unwrap()
            .amount,
        0
    );
    let caller_reward_ata = f
        .svm
        .get_account(&ata(f.caller.pubkey(), f.mint.pubkey()))
        .unwrap();
    assert_eq!(
        token_account(&f.svm, ata(f.caller.pubkey(), f.mint.pubkey()))
            .unwrap()
            .amount,
        1
    );
    assert_eq!(
        caller_reward_ata.lamports,
        f.svm.minimum_balance_for_rent_exemption(SplAccount::LEN)
    );
    assert!(
        caller_lamports_before - f.svm.get_account(&f.caller.pubkey()).unwrap().lamports
            >= caller_reward_ata.lamports,
        "permissionless caller pays ATA rent (and may also pay Core realloc rent)"
    );
    assert_eq!(mint_account(&f.svm, f.mint.pubkey()).supply, 1);
    assert!(mint_account(&f.svm, f.mint.pubkey())
        .mint_authority
        .is_none());
    assert!(mint_account(&f.svm, f.mint.pubkey())
        .freeze_authority
        .is_none());
    assert_eq!(history(&f.svm, f.config).unwrap().entries.len(), 2);
    let encoded = result
        .logs
        .iter()
        .find_map(|line| line.strip_prefix("Program data: "))
        .expect("HeartbeatCranked event");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .unwrap();
    assert_eq!(&bytes[..8], HeartbeatCranked::DISCRIMINATOR);
    let event = HeartbeatCranked::deserialize(&mut &bytes[8..]).unwrap();
    assert_eq!(
        (
            event.config,
            event.caller,
            event.reward_mint,
            event.reward_amount,
            event.first_root_timestamp,
            event.timestamp,
            event.from_stage,
            event.to_stage
        ),
        (
            f.config,
            f.caller.pubkey(),
            f.mint.pubkey(),
            1,
            1_000,
            1_060,
            LifeStage::Born,
            LifeStage::Awakened
        )
    );

    // One-time transition prevents repeat payout.
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        f.mint.pubkey(),
        crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey()),
        6014,
    );
}

#[test]
fn req32_clock_add_overflow_and_core_cpi_failure_are_atomic() {
    let mut f = fixture();
    set_time(&mut f.svm, 1_000);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 0, 1);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 1, 2);

    let history_addr = history_pda(f.config);
    let mut hist_account = f.svm.get_account(&history_addr).unwrap();
    let mut hist = MemoryRootHistory::try_deserialize(&mut hist_account.data.as_slice()).unwrap();
    hist.entries[0].timestamp = i64::MAX;
    let mut encoded = Vec::new();
    hist.try_serialize(&mut encoded).unwrap();
    hist_account.data = encoded;
    f.svm.set_account(history_addr, hist_account).unwrap();
    set_time(&mut f.svm, i64::MAX);
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        f.mint.pubkey(),
        crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey()),
        6017,
    );

    // Restore real timestamp; corrupt Core authority so its CPI fails after readiness checks.
    let mut hist_account = f.svm.get_account(&history_addr).unwrap();
    let mut hist = MemoryRootHistory::try_deserialize(&mut hist_account.data.as_slice()).unwrap();
    hist.entries[0].timestamp = 1_000;
    let mut encoded = Vec::new();
    hist.try_serialize(&mut encoded).unwrap();
    hist_account.data = encoded;
    f.svm.set_account(history_addr, hist_account).unwrap();
    set_time(&mut f.svm, 1_060);
    let mut asset_account = f.svm.get_account(&f.asset).unwrap();
    asset_account.data[34..66].copy_from_slice(f.owner.pubkey().as_ref());
    f.svm.set_account(f.asset, asset_account).unwrap();
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        f.mint.pubkey(),
        crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey()),
        mpl_core::errors::MplCoreError::NoApprovals as u32,
    );
}

#[test]
fn req31_reward_initializer_rejects_freeze_authority_malformed_mints_atomically() {
    let (mut svm, fee_payer) = setup();
    let owner = Keypair::new();
    let runtime = Keypair::new();
    svm.airdrop(&owner.pubkey(), 20_000_000_000).unwrap();
    let other_authority = Keypair::new().pubkey();
    let cases = [
        (7101, 0, owner.pubkey(), Some(owner.pubkey()), false), // freeze authority
        (7102, 1, owner.pubkey(), None, false),                 // nonzero decimals
        (7103, 0, owner.pubkey(), None, true),                  // nonzero initial supply
        (7104, 0, other_authority, None, false),                // wrong mint authority
    ];

    for (character_id, decimals, mint_authority, freeze_authority, nonzero_supply) in cases {
        let (result, minted) = initialize(
            &mut svm,
            &fee_payer,
            &owner,
            character_id,
            runtime.pubkey(),
            "calm",
        );
        result.unwrap();
        let config = minted.config;
        let asset = read_config(&svm, &config).asset;
        let mint = create_test_mint(&mut svm, &owner, mint_authority, freeze_authority, decimals);
        if nonzero_supply {
            let mut account = svm.get_account(&mint.pubkey()).unwrap();
            let mut state = SplMint::unpack(&account.data).unwrap();
            state.supply = 1;
            SplMint::pack(state, &mut account.data).unwrap();
            svm.set_account(mint.pubkey(), account).unwrap();
        }

        let before = snapshot(&svm, config, asset, mint.pubkey(), owner.pubkey());
        let failure = submit(
            &mut svm,
            &fee_payer,
            &[&owner],
            &[configure_reward_ix(config, owner.pubkey(), mint.pubkey())],
        )
        .unwrap_err();
        assert_eq!(
            failure.err,
            TransactionError::InstructionError(
                0,
                solana_instruction::error::InstructionError::Custom(6019)
            ),
            "{:?}",
            failure.meta.logs
        );
        assert_eq!(
            snapshot(&svm, config, asset, mint.pubkey(), owner.pubkey()),
            before,
            "invalid reward mint setup must roll back reward config and vault creation"
        );
    }
}

#[test]
fn req30_foreign_history_pda_is_rejected_atomically() {
    let mut f = fixture();
    set_time(&mut f.svm, 4_000);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 0, 1);

    let foreign_owner = Keypair::new();
    f.svm
        .airdrop(&foreign_owner.pubkey(), 10_000_000_000)
        .unwrap();
    let (result, foreign_minted) = initialize(
        &mut f.svm,
        &f.fee_payer,
        &foreign_owner,
        7105,
        f.runtime.pubkey(),
        "calm",
    );
    result.unwrap();
    commit(
        &mut f.svm,
        &f.fee_payer,
        &f.runtime,
        foreign_minted.config,
        0,
        2,
    );
    let foreign_history = history_pda(foreign_minted.config);
    let foreign_before = account_snapshot(&f.svm, foreign_history);
    let before = snapshot(
        &f.svm,
        f.config,
        f.asset,
        f.mint.pubkey(),
        f.caller.pubkey(),
    );
    let mut instruction = crank_ix(f.config, f.asset, f.caller.pubkey(), f.mint.pubkey());
    instruction.accounts[1].pubkey = foreign_history;
    let failure = submit(&mut f.svm, &f.fee_payer, &[&f.caller], &[instruction]).unwrap_err();
    assert_eq!(
        failure.err,
        TransactionError::InstructionError(
            0,
            solana_instruction::error::InstructionError::Custom(2006)
        ),
        "{:?}",
        failure.meta.logs
    );
    assert_eq!(
        snapshot(
            &f.svm,
            f.config,
            f.asset,
            f.mint.pubkey(),
            f.caller.pubkey()
        ),
        before
    );
    assert_eq!(account_snapshot(&f.svm, foreign_history), foreign_before);
}

#[test]
fn req31_crank_rejects_freeze_authority_atomically() {
    let mut f = fixture();
    set_time(&mut f.svm, 3_500);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 0, 1);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 1, 2);
    set_time(&mut f.svm, 3_560);

    let mint_address = f.mint.pubkey();
    let mut account = f.svm.get_account(&mint_address).unwrap();
    let mut mint = SplMint::unpack(&account.data).unwrap();
    mint.freeze_authority =
        anchor_lang::solana_program::program_option::COption::Some(f.owner.pubkey());
    SplMint::pack(mint, &mut account.data).unwrap();
    f.svm.set_account(mint_address, account).unwrap();
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        mint_address,
        crank_ix(f.config, f.asset, f.caller.pubkey(), mint_address),
        6020,
    );
}

#[test]
fn req31_rejects_reward_mint_supply_above_the_one_unit_cap_atomically() {
    let mut f = fixture();
    set_time(&mut f.svm, 3_000);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 0, 1);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 1, 2);
    set_time(&mut f.svm, 3_060);

    let mint_address = f.mint.pubkey();
    let mut account = f.svm.get_account(&mint_address).unwrap();
    let mut mint = SplMint::unpack(&account.data).unwrap();
    mint.supply = 2;
    SplMint::pack(mint, &mut account.data).unwrap();
    f.svm.set_account(mint_address, account).unwrap();
    reject_unchanged(
        &mut f.svm,
        &f.fee_payer,
        &f.caller,
        f.config,
        f.asset,
        mint_address,
        crank_ix(f.config, f.asset, f.caller.pubkey(), mint_address),
        6020,
    );
}

#[test]
fn req32_failed_reward_cpi_rolls_back_prior_core_attribute_update() {
    let mut f = fixture();
    set_time(&mut f.svm, 2_000);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 0, 1);
    commit(&mut f.svm, &f.fee_payer, &f.runtime, f.config, 1, 2);
    set_time(&mut f.svm, 2_060);

    // Corrupt only the in-memory token-account state so SPL transfer fails after
    // the Core CPI. The mint itself has no freeze authority; this is fixture-only.
    let caller_ata = ata(f.caller.pubkey(), f.mint.pubkey());
    let create_ata = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
        &f.caller.pubkey(), &f.caller.pubkey(), &f.mint.pubkey(), &TOKEN_ID,
    );
    submit(&mut f.svm, &f.caller, &[], &[create_ata]).unwrap();
    let mut frozen_account = f.svm.get_account(&caller_ata).unwrap();
    let mut frozen_state = SplAccount::unpack(&frozen_account.data).unwrap();
    frozen_state.state = anchor_spl::token::spl_token::state::AccountState::Frozen;
    SplAccount::pack(frozen_state, &mut frozen_account.data).unwrap();
    f.svm.set_account(caller_ata, frozen_account).unwrap();
    let before = snapshot(
        &f.svm,
        f.config,
        f.asset,
        f.mint.pubkey(),
        f.caller.pubkey(),
    );
    let failure = submit(
        &mut f.svm,
        &f.fee_payer,
        &[&f.caller],
        &[crank_ix(
            f.config,
            f.asset,
            f.caller.pubkey(),
            f.mint.pubkey(),
        )],
    )
    .unwrap_err();
    assert!(
        matches!(failure.err, TransactionError::InstructionError(..)),
        "frozen destination must fail SPL CPI: {:?}",
        failure.meta.logs
    );
    assert_eq!(
        snapshot(
            &f.svm,
            f.config,
            f.asset,
            f.mint.pubkey(),
            f.caller.pubkey()
        ),
        before,
        "Core attribute CPI must roll back when reward transfer fails"
    );
    assert_eq!(read_config(&f.svm, &f.config).life_stage, LifeStage::Born);
    assert_eq!(core_life_stage(&f.svm, f.asset), "born");
}

fn svm_config_len(svm: &LiteSVM, config: Pubkey) -> usize {
    svm.get_account(&config).unwrap().data.len()
}

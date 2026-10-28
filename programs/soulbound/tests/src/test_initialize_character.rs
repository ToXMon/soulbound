//! LiteSVM integration suite for `initialize_character` (Ticket 002).
//! Each test names the REQ id it proves.

use anchor_lang::{AnchorDeserialize, AnchorSerialize};
use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction::Transaction;

use soulbound::state::{CharacterConfig, LifeStage};

const SOULBOUND_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/deploy/soulbound.so");
const CORE_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/mpl_core.so");

const TOKEN_2022_ID: Pubkey = Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_ID: Pubkey = Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const RENT_ID: Pubkey = Pubkey::from_str_const("SysvarRent111111111111111111111111111111111");

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

    let prog = Pubkey::from_str_const("BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd");
    svm.add_program_from_file(prog, SOULBOUND_SO)
        .expect("load soulbound.so — run `anchor build` first");
    svm.add_program_from_file(mpl_core::ID, CORE_SO)
        .expect("load mpl_core.so fixture");
    (svm, payer)
}

fn config_pda(owner: &Pubkey, character_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"character", owner.as_ref(), &character_id.to_le_bytes()],
        &soulbound::id(),
    )
}

fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN_2022_ID.as_ref(), mint.as_ref()], &ATA_ID).0
}

/// Instruction args layout: discriminator || character_id || runtime_signer || trait_vector
/// (discriminator copied verbatim from `target/idl/soulbound.json`).
const IX_DISCRIMINATOR: [u8; 8] = [82, 30, 2, 32, 52, 45, 168, 230];

fn ix_data(character_id: u64, runtime_signer: Pubkey, trait_vector: &str) -> Vec<u8> {
    let mut d = IX_DISCRIMINATOR.to_vec();
    character_id.serialize(&mut d).unwrap();
    runtime_signer.serialize(&mut d).unwrap();
    trait_vector.to_string().serialize(&mut d).unwrap();
    d
}

struct Minted {
    asset: Keypair,
    mint: Keypair,
    config: Pubkey,
}

/// Build + send `initialize_character`; returns the transaction result.
fn initialize(
    svm: &mut LiteSVM,
    payer: &Keypair,
    owner: &Keypair,
    character_id: u64,
    runtime_signer: Pubkey,
    trait_vector: &str,
) -> (Result<(), String>, Minted) {
    let asset = Keypair::new();
    let mint = Keypair::new();
    let (config, _) = config_pda(&owner.pubkey(), character_id);

    let ix = Instruction {
        program_id: soulbound::id(),
        accounts: vec![
            AccountMeta::new(owner.pubkey(), true),
            AccountMeta::new(config, false),
            AccountMeta::new(asset.pubkey(), true),
            AccountMeta::new(mint.pubkey(), true),
            AccountMeta::new(ata(&owner.pubkey(), &mint.pubkey()), false),
            AccountMeta::new_readonly(mpl_core::ID, false),
            AccountMeta::new_readonly(TOKEN_2022_ID, false),
            AccountMeta::new_readonly(ATA_ID, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(RENT_ID, false),
        ],
        data: ix_data(character_id, runtime_signer, trait_vector),
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let mut signers = vec![payer, owner, &asset, &mint];
    signers.sort_by_key(|k| {
        let p = k.pubkey();
        msg.account_keys
            .iter()
            .position(|x| *x == p)
            .unwrap_or(usize::MAX)
    });
    let tx = Transaction::new(&signers, msg, svm.latest_blockhash());
    let res = svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err));
    (
        res,
        Minted { asset, mint, config },
    )
}

fn read_config(svm: &LiteSVM, config: &Pubkey) -> CharacterConfig {
    let acct = svm.get_account(config).expect("config exists");
    CharacterConfig::deserialize(&mut &acct.data[8..]).expect("config deserializes")
}

#[test]
fn req01_pda_derives_canonically() {
    let (mut svm, payer) = setup();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (res, m) = initialize(&mut svm, &payer, &owner, 7, Pubkey::new_unique(), "curious");
    res.expect("initialize succeeds");

    let (expected, bump) = config_pda(&owner.pubkey(), 7);
    assert_eq!(m.config, expected, "REQ-01: PDA seeds [character, owner, id]");
    let cfg = read_config(&svm, &m.config);
    assert_eq!(cfg.owner, owner.pubkey());
    assert_eq!(cfg.character_id, 7);
    assert_eq!(cfg.bump, bump, "canonical bump stored");
}

#[test]
fn req02_and_req03_core_asset_with_attributes() {
    let (mut svm, payer) = setup();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (res, m) = initialize(&mut svm, &payer, &owner, 1, Pubkey::new_unique(), "bold,curious");
    res.expect("initialize succeeds");

    let asset_acct = svm.get_account(&m.asset.pubkey()).expect("asset account exists");
    assert_eq!(asset_acct.owner, mpl_core::ID, "REQ-02: asset owned by Core program");

    // Public, non-generated parser: `Asset::from_bytes` handles the plugin header/registry.
    let asset = mpl_core::Asset::from_bytes(&asset_acct.data).expect("asset deserializes as Asset");
    assert_eq!(asset.base.owner, owner.pubkey(), "REQ-02: asset owner = owner wallet");
    assert_eq!(
        asset.base.update_authority,
        mpl_core::types::UpdateAuthority::Address(m.config),
        "config PDA is update authority"
    );

    // REQ-03: Attributes plugin readable on-chain.
    let attrs = asset
        .plugin_list
        .attributes
        .expect("REQ-03: Attributes plugin attached at creation")
        .attributes;
    let get = |k: &str| {
        attrs
            .attribute_list
            .iter()
            .find(|a| a.key == k)
            .map(|a| a.value.clone())
            .unwrap_or_else(|| panic!("missing attribute {k}"))
    };
    assert_eq!(get("life_stage"), "born");
    assert_eq!(get("mood"), "curious");
    assert_eq!(get("memory_epoch"), "0");
    assert_eq!(get("trait_vector"), "bold,curious");
}

#[test]
fn req05_receipt_is_non_transferable() {
    let (mut svm, payer) = setup();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (res, m) = initialize(&mut svm, &payer, &owner, 2, Pubkey::new_unique(), "calm");
    res.expect("initialize succeeds");

    let mint = svm.get_account(&m.mint.pubkey()).expect("mint exists");
    assert_eq!(mint.owner, TOKEN_2022_ID, "REQ-05: receipt is Token-2022");
    use spl_token_2022_interface::extension::BaseStateWithExtensions as _;
    let parsed = spl_token_2022_interface::extension::StateWithExtensions::<
        spl_token_2022_interface::state::Mint,
    >::unpack(&mint.data)
    .expect("mint unpacks");
    assert!(
        parsed.get_extension::<spl_token_2022_interface::extension::non_transferable::NonTransferable>().is_ok(),
        "REQ-05: NonTransferable extension present"
    );
    assert_eq!(parsed.base.supply, 1, "REQ-05: exactly one receipt");
    assert!(parsed.base.mint_authority.is_none(), "mint authority revoked");

    // REQ-05: a transfer attempt must fail.
    let thief = Keypair::new();
    svm.airdrop(&thief.pubkey(), 1_000_000_000).unwrap();
    let src = ata(&owner.pubkey(), &m.mint.pubkey());
    let dst = ata(&thief.pubkey(), &m.mint.pubkey());
    let create_dst = Instruction {
        program_id: ATA_ID,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(dst, false),
            AccountMeta::new_readonly(thief.pubkey(), false),
            AccountMeta::new_readonly(m.mint.pubkey(), false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(TOKEN_2022_ID, false),
        ],
        data: vec![],
    };
    let msg = Message::new(&[create_dst], Some(&payer.pubkey()));
    let tx = Transaction::new(&[&payer], msg, svm.latest_blockhash());
    svm.send_transaction(tx).expect("dest ATA created");

    let mut d = vec![12u8]; // TransferChecked
    d.extend_from_slice(&1u64.to_le_bytes());
    d.push(0); // decimals
    let transfer = Instruction {
        program_id: TOKEN_2022_ID,
        accounts: vec![
            AccountMeta::new(src, false),
            AccountMeta::new_readonly(m.mint.pubkey(), false),
            AccountMeta::new(dst, false),
            AccountMeta::new_readonly(owner.pubkey(), true),
        ],
        data: d,
    };
    let msg = Message::new(&[transfer], Some(&payer.pubkey()));
    let tx = Transaction::new(&[&payer, &owner], msg, svm.latest_blockhash());
    let out = svm.send_transaction(tx);
    match out.as_ref().err().map(|e| e.err.clone()) {
        // Token-2022 TokenError::NonTransferable == 37: the extension blocked it.
        Some(solana_transaction::TransactionError::InstructionError(
            0,
            solana_instruction::error::InstructionError::Custom(37),
        )) => {}
        other => panic!("REQ-05: expected NonTransferable (37) rejection, got {other:?}"),
    }
    // Balances unchanged after the rejected transfer.
    let src_acct = svm.get_account(&src).unwrap();
    let src_state = spl_token_2022_interface::extension::StateWithExtensions::<
        spl_token_2022_interface::state::Account,
    >::unpack(&src_acct.data)
    .expect("source token account unpacks");
    assert_eq!(src_state.base.amount, 1, "REQ-05: receipt still owned by original owner");
    assert!(
        out.is_err(),
        "REQ-05: transferring a non-transferable receipt MUST fail, got {:?}",
        out.map(|m| m)
    );
}

#[test]
fn req06_duplicate_character_id_rejected() {
    let (mut svm, payer) = setup();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 20_000_000_000).unwrap();
    let (res, _m) = initialize(&mut svm, &payer, &owner, 3, Pubkey::new_unique(), "calm");
    res.expect("first initialize succeeds");

    let (res2, _m2) = initialize(&mut svm, &payer, &owner, 3, Pubkey::new_unique(), "calm");
    match res2.as_ref().err().map(|s| s.as_str()) {
        // system ProgramError::AccountAlreadyInUse == 0: the PDA is already initialized.
        Some("InstructionError(0, Custom(0))") => {}
        other => panic!("REQ-06: expected AccountAlreadyInUse, got {other:?}"),
    }
    assert!(res2.is_err(), "REQ-06: duplicate character_id must fail");

    // Same id, different owner is a different character and must succeed.
    let other = Keypair::new();
    svm.airdrop(&other.pubkey(), 10_000_000_000).unwrap();
    let (res3, _m3) = initialize(&mut svm, &payer, &other, 3, Pubkey::new_unique(), "calm");
    res3.expect("same id for a different owner is allowed");
}

#[test]
fn req07_genesis_state_and_failed_ix_leaves_no_state() {
    let (mut svm, payer) = setup();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 20_000_000_000).unwrap();
    let (res, m) = initialize(&mut svm, &payer, &owner, 4, Pubkey::new_unique(), "calm");
    res.expect("initialize succeeds");

    let cfg = read_config(&svm, &m.config);
    assert_eq!(cfg.life_stage, LifeStage::Born, "REQ-07: life_stage = born");
    assert_eq!(cfg.memory_epoch, 0, "REQ-07: memory_epoch = 0");
    assert_eq!(cfg.asset, m.asset.pubkey());
    assert_eq!(cfg.receipt_mint, m.mint.pubkey());

    // A failing initialize (duplicate) must not mutate the existing config.
    let (prev, _) = config_pda(&owner.pubkey(), 4);
    let before = svm.get_account(&prev).unwrap().data;
    let (res_dup, _) = initialize(&mut svm, &payer, &owner, 4, Pubkey::new_unique(), "calm");
    assert!(res_dup.is_err());
    let after = svm.get_account(&prev).unwrap().data;
    assert_eq!(before, after, "failed instruction changes no state");

    // Over-long trait vector is rejected by an explicit error, not a silent truncation.
    let (res_long, long_m) =
        initialize(&mut svm, &payer, &owner, 5, Pubkey::new_unique(), &"x".repeat(129));
    match res_long.as_ref().err().map(|s| s.as_str()) {
        // Anchor custom error 6000 == first variant == SoulboundError::TraitVectorTooLong.
        Some("InstructionError(0, Custom(6000))") => {}
        other => panic!("trait vector: expected TraitVectorTooLong (6000), got {other:?}"),
    }
    assert!(res_long.is_err(), "trait vector over max length rejected");
    assert!(
        svm.get_account(&long_m.config).is_none(),
        "rejected init left no account behind"
    );
}

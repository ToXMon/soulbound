//! Ticket 005 amendment: actual SBF dual-signature recovery and REQ-11 regression.
use super::test_initialize_character::{setup, initialize, read_config};
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, Space, ToAccountMetas};
use anchor_lang::prelude::Clock;
use base64::Engine;
use litesvm::{LiteSVM, types::TransactionResult};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use soulbound::{CharacterConfig, MemoryRootHistory, RuntimeSignerRotated};

fn history(config: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"memory_roots", config.as_ref()], &soulbound::id()).0
}
fn rotate(config: Pubkey, owner: Pubkey, replacement: Pubkey) -> Instruction {
    Instruction { program_id: soulbound::id(), accounts: soulbound::accounts::RotateRuntimeSigner {
        config, owner, replacement,
    }.to_account_metas(None), data: soulbound::instruction::RotateRuntimeSigner {}.data() }
}
fn root(config: Pubkey, runtime: Pubkey, payer: Pubkey, epoch: u64) -> Instruction {
    Instruction { program_id: soulbound::id(), accounts: soulbound::accounts::CommitMemoryRoot {
        config, runtime_signer: runtime, payer, history: history(config),
        system_program: solana_sdk_ids::system_program::id(),
    }.to_account_metas(None), data: soulbound::instruction::CommitMemoryRoot { epoch, root: [7;32] }.data() }
}
fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ix: Instruction) -> TransactionResult {
    svm.expire_blockhash();
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let mut keys = vec![payer]; keys.extend_from_slice(signers);
    let tx = Transaction::new(&keys, msg, svm.latest_blockhash());
    svm.send_transaction(tx)
}
#[test]
fn amendment_recovers_genesis_without_history_or_old_runtime_signature() {
    let (mut svm, payer) = setup();
    let owner = Keypair::new(); let old = Keypair::new(); let new = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (result, minted) = initialize(&mut svm, &payer, &owner, 7, old.pubkey(), "calm"); result.unwrap();
    let config = minted.config;
    assert!(svm.get_account(&history(config)).is_none());
    let before = svm.get_account(&config).unwrap();
    send(&mut svm, &payer, &[&owner, &new], rotate(config, owner.pubkey(), new.pubkey())).unwrap();
    let mut expected = before; expected.data[48..80].copy_from_slice(new.pubkey().as_ref());
    assert_eq!(svm.get_account(&config).unwrap(), expected);
    assert!(svm.get_account(&history(config)).is_none(), "rotation never creates or touches history");
    assert_eq!(read_config(&svm, &config).memory_epoch, 0);
    // Replacement needs no SOL funding when a separate system wallet pays fees/rent.
    assert_eq!(svm.get_balance(&new.pubkey()).unwrap_or(0), 0);
    send(&mut svm, &payer, &[&new], root(config, new.pubkey(), payer.pubkey(), 0)).unwrap();
    let accepted = MemoryRootHistory::try_deserialize(&mut svm.get_account(&history(config)).unwrap().data.as_slice()).unwrap();
    assert_eq!(accepted.entries.len(), 1); assert_eq!(accepted.entries[0].epoch, 0);
}

#[test]
fn amendment_dual_signature_rotation_preserves_every_other_byte_and_req11() {
    let (mut svm, payer) = setup();
    // Ephemeral LiteSVM test-only keys. No persistent runtime/deploy key is created.
    let owner = Keypair::new(); let old = Keypair::new(); let new = Keypair::new(); let attacker = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (result, minted) = initialize(&mut svm, &payer, &owner, 895354, old.pubkey(), "calm"); result.unwrap();
    let config = minted.config;
    for epoch in [0, 5] {
        send(&mut svm, &payer, &[&old], root(config, old.pubkey(), payer.pubkey(), epoch)).unwrap();
    }
    let cfg = read_config(&svm, &config);
    let token = Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    let ata_program = Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    let ata = Pubkey::find_program_address(&[owner.pubkey().as_ref(), token.as_ref(), cfg.receipt_mint.as_ref()], &ata_program).0;
    let addresses = [config, history(config), cfg.asset, cfg.receipt_mint, ata];
    let snapshot = |svm: &LiteSVM| addresses.iter().map(|p| svm.get_account(p).unwrap()).collect::<Vec<_>>();
    let before = snapshot(&svm);
    // Owner alone / replacement alone / neither: remove signer metas so the
    // transaction reaches Anchor and exercises its typed Signer validation.
    for (owner_signs, replacement_signs, signers) in [
        (true, false, vec![&owner]), (false, true, vec![&new]), (false, false, vec![]),
    ] {
        let mut ix = rotate(config, owner.pubkey(), new.pubkey());
        ix.accounts[1].is_signer = owner_signs;
        ix.accounts[2].is_signer = replacement_signs;
        let failed = send(&mut svm, &payer, &signers, ix).unwrap_err();
        assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
            solana_instruction::error::InstructionError::Custom(3010)));
        assert_eq!(snapshot(&svm), before, "failed rotation changes no tracked state");
    }
    // An unrelated signer cannot replace the owner's authorization.
    let failed = send(&mut svm, &payer, &[&attacker, &new], rotate(config, attacker.pubkey(), new.pubkey())).unwrap_err();
    assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(6007)));
    assert_eq!(snapshot(&svm), before);
    let failed = send(&mut svm, &payer, &[&owner, &old], rotate(config, owner.pubkey(), old.pubkey())).unwrap_err();
    assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(6008)));
    assert_eq!(snapshot(&svm), before);
    // Config ownership and PDA are independently verified on the rotation path.
    let fake = Pubkey::new_unique(); svm.set_account(fake, before[0].clone()).unwrap();
    let failed = send(&mut svm, &payer, &[&owner, &new], rotate(fake, owner.pubkey(), new.pubkey())).unwrap_err();
    assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(2006)));
    assert_eq!(svm.get_account(&fake).unwrap(), before[0]);
    let mut foreign = before[0].clone(); foreign.owner = solana_sdk_ids::system_program::id();
    svm.set_account(config, foreign.clone()).unwrap();
    let failed = send(&mut svm, &payer, &[&owner, &new], rotate(config, owner.pubkey(), new.pubkey())).unwrap_err();
    assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(3007)));
    assert_eq!(svm.get_account(&config).unwrap(), foreign);
    svm.set_account(config, before[0].clone()).unwrap();
    let mut clock: Clock = svm.get_sysvar(); clock.unix_timestamp = 1_800_000_123; svm.set_sysvar(&clock);
    // The lost old runtime key is NOT a required signer for owner recovery.
    let result = send(&mut svm, &payer, &[&owner, &new], rotate(config, owner.pubkey(), new.pubkey())).unwrap();
    let after = snapshot(&svm);
    assert_eq!(before[0].data.len(), 154);
    assert_eq!(after[0].data.len(), 154, "rotation performs no realloc");
    assert_eq!(after[0].data.len(), 8 + CharacterConfig::INIT_SPACE);
    let mut expected = before[0].clone(); expected.data[48..80].copy_from_slice(new.pubkey().as_ref());
    assert_eq!(after[0], expected, "ONLY runtime_signer bytes change; discriminator, metadata, lamports, layout and other fields remain identical");
    assert_eq!(&after[1..], &before[1..], "history, Core asset, mint and receipt ATA preserved byte-for-byte");
    let updated = CharacterConfig::try_deserialize(&mut after[0].data.as_slice()).unwrap();
    assert_eq!(updated.runtime_signer, new.pubkey());
    assert_eq!((updated.owner, updated.character_id, updated.asset, updated.receipt_mint, updated.memory_epoch, updated.life_stage, updated.bump),
        (cfg.owner, cfg.character_id, cfg.asset, cfg.receipt_mint, cfg.memory_epoch, cfg.life_stage, cfg.bump));
    let encoded = result.logs.iter().find_map(|l| l.strip_prefix("Program data: ")).expect("actual rotation event log");
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
    assert_eq!(&bytes[..8], RuntimeSignerRotated::DISCRIMINATOR);
    let event = RuntimeSignerRotated::deserialize(&mut &bytes[8..]).unwrap();
    assert_eq!((event.config, event.old_signer, event.new_signer, event.timestamp), (config, old.pubkey(), new.pubkey(), clock.unix_timestamp));
    let failed = send(&mut svm, &payer, &[&old], root(config, old.pubkey(), payer.pubkey(), 6)).unwrap_err();
    assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(6002)), "REQ-11: stale runtime rejected");
    assert_eq!(snapshot(&svm), after);
    send(&mut svm, &payer, &[&new], root(config, new.pubkey(), payer.pubkey(), 6)).unwrap();
    let accepted = MemoryRootHistory::try_deserialize(&mut svm.get_account(&history(config)).unwrap().data.as_slice()).unwrap();
    let prior = MemoryRootHistory::try_deserialize(&mut before[1].data.as_slice()).unwrap();
    assert_eq!(&accepted.entries[..prior.entries.len()], prior.entries.as_slice());
    assert_eq!(accepted.entries.last().unwrap().epoch, 6);
    assert_eq!(read_config(&svm, &config).memory_epoch, 6);
    let latest = snapshot(&svm);
    let failed = send(&mut svm, &payer, &[&new], root(config, new.pubkey(), payer.pubkey(), 5)).unwrap_err();
    assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(6004)), "REQ-12 unchanged after rotation");
    assert_eq!(snapshot(&svm), latest);
}

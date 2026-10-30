//! Ticket 005: REQ-10..13. Real SBF execution, actual event log decoding.
use super::test_initialize_character::{setup, initialize, read_config};
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas, Space};
use anchor_lang::prelude::Clock;
use base64::Engine;
use litesvm::{LiteSVM, types::TransactionResult};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use soulbound::{MemoryRootHistory, MemoryRootCommitted};

fn history(config: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"memory_roots", config.as_ref()], &soulbound::id()).0
}
fn ix(config: Pubkey, runtime: Pubkey, payer: Pubkey, epoch: u64, root: [u8;32]) -> Instruction {
    Instruction { program_id: soulbound::id(), accounts: soulbound::accounts::CommitMemoryRoot {
        config, runtime_signer: runtime, payer, history: history(config),
        system_program: solana_sdk_ids::system_program::id(),
    }.to_account_metas(None), data: soulbound::instruction::CommitMemoryRoot { epoch, root }.data() }
}
fn send(svm: &mut LiteSVM, payer: &Keypair, runtime: &Keypair, ix: Instruction) -> TransactionResult {
    svm.expire_blockhash();
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer, runtime], msg, svm.latest_blockhash());
    svm.send_transaction(tx)
}
fn born(svm: &mut LiteSVM, payer: &Keypair, runtime: &Keypair, id: u64) -> Pubkey {
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (res, minted) = initialize(svm, payer, &owner, id, runtime.pubkey(), "calm");
    res.unwrap(); minted.config
}
fn read(svm: &LiteSVM, config: Pubkey) -> MemoryRootHistory {
    MemoryRootHistory::try_deserialize(&mut svm.get_account(&history(config)).unwrap().data.as_slice()).unwrap()
}
fn reject(svm: &mut LiteSVM, payer: &Keypair, runtime: &Keypair, config: Pubkey, instruction: Instruction, code: u32) {
    let before = svm.get_account(&config).unwrap().data;
    let hist_before = svm.get_account(&history(config));
    let result = send(svm, payer, runtime, instruction).unwrap_err();
    assert_eq!(result.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(code)), "{:?}", result.meta.logs);
    assert_eq!(svm.get_account(&config).unwrap().data, before);
    assert_eq!(svm.get_account(&history(config)), hist_before);
}
#[test]
fn req10_13_epoch_zero_append_immutable_event_rent_and_capacity() {
    let (mut svm, payer) = setup();
    let runtime = Keypair::new();
    let config = born(&mut svm, &payer, &runtime, 895354);
    let mut clock: Clock = svm.get_sysvar(); clock.unix_timestamp = 1_800_000_000; svm.set_sysvar(&clock);
    let result = send(&mut svm, &payer, &runtime, ix(config, runtime.pubkey(), payer.pubkey(), 0, [7;32])).unwrap();
    let h = read(&svm, config);
    assert_eq!(h.config, config);
    assert_eq!(h.bump, Pubkey::find_program_address(&[b"memory_roots", config.as_ref()], &soulbound::id()).1);
    assert_eq!(h.entries[0].epoch, 0);
    assert_eq!(h.entries[0].root, [7;32]);
    assert_eq!(h.entries[0].timestamp, clock.unix_timestamp);
    assert_eq!(read_config(&svm, &config).memory_epoch, 0);
    let account = svm.get_account(&history(config)).unwrap();
    assert_eq!(account.data.len(), 8 + 32 + 1 + 4 + 128 * 48);
    assert_eq!(account.data.len(), 8 + MemoryRootHistory::INIT_SPACE);
    assert_eq!(account.lamports, svm.minimum_balance_for_rent_exemption(account.data.len()));
    println!("history size={} rent={} CU={}", account.data.len(), account.lamports, result.compute_units_consumed);
    let encoded = result.logs.iter().find_map(|l| l.strip_prefix("Program data: ")).expect("actual event log");
    let data = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
    assert_eq!(&data[..8], MemoryRootCommitted::DISCRIMINATOR);
    let event = MemoryRootCommitted::deserialize(&mut &data[8..]).unwrap();
    assert_eq!((event.config, event.epoch, event.root, event.timestamp), (config, 0, [7;32], clock.unix_timestamp));
    let first = h.entries[0].clone();
    // Fill every allocated entry, then test capacity without truncation.
    for epoch in 1..128 {
        let previous = read(&svm, config).entries;
        send(&mut svm, &payer, &runtime, ix(config, runtime.pubkey(), payer.pubkey(), epoch * 2, [8;32])).unwrap();
        let current = read(&svm, config).entries;
        assert_eq!(current[0], first);
        assert_eq!(&current[..previous.len()], previous.as_slice());
        assert_eq!(read_config(&svm, &config).memory_epoch, epoch * 2);
    }
    reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), payer.pubkey(), 256, [9;32]), 6005);
}
#[test]
fn req11_12_rejections_are_atomic_and_initialization_authenticated() {
    let (mut svm, payer) = setup();
    let runtime = Keypair::new(); let attacker = Keypair::new();
    let config = born(&mut svm, &payer, &runtime, 7);
    reject(&mut svm, &payer, &attacker, config, ix(config, attacker.pubkey(), payer.pubkey(), 0, [1;32]), 6002);
    reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), payer.pubkey(), 0, [0;32]), 6003);
    send(&mut svm, &payer, &runtime, ix(config, runtime.pubkey(), payer.pubkey(), 0, [1;32])).unwrap();
    reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), payer.pubkey(), 0, [1;32]), 6004);
    send(&mut svm, &payer, &runtime, ix(config, runtime.pubkey(), payer.pubkey(), 10, [2;32])).unwrap();
    for epoch in [0, 9, 10] {
        reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), payer.pubkey(), epoch, [3;32]), 6004);
    }
    let foreign = born(&mut svm, &payer, &runtime, 8);
    let mut bad = ix(config, runtime.pubkey(), payer.pubkey(), 11, [3;32]);
    bad.accounts[3].pubkey = history(foreign);
    reject(&mut svm, &payer, &runtime, config, bad, 2006); // ConstraintSeeds
    // Valid-looking config data at the wrong address cannot bypass config PDA checks.
    let fake = Pubkey::new_unique();
    svm.set_account(fake, svm.get_account(&config).unwrap()).unwrap();
    reject(&mut svm, &payer, &runtime, fake, ix(fake, runtime.pubkey(), payer.pubkey(), 11, [3;32]), 2006);
    // Canonical history address with a corrupt association/bump is never reset.
    let hist_address = history(config);
    let original = svm.get_account(&hist_address).unwrap();
    for offset in [8, 40] {
        let mut corrupt = original.clone(); corrupt.data[offset] ^= 1;
        svm.set_account(hist_address, corrupt).unwrap();
        reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), payer.pubkey(), 11, [3;32]), 6006);
    }
    svm.set_account(hist_address, original).unwrap();
    // Ownership, signer, payer and system-program checks are enforced by Anchor.
    let mut owned_elsewhere = svm.get_account(&config).unwrap();
    owned_elsewhere.owner = solana_sdk_ids::system_program::id();
    let original_config = svm.get_account(&config).unwrap();
    svm.set_account(config, owned_elsewhere).unwrap();
    reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), payer.pubkey(), 11, [3;32]), 3007);
    svm.set_account(config, original_config).unwrap();
    let mut unsigned = ix(config, runtime.pubkey(), payer.pubkey(), 11, [3;32]);
    unsigned.accounts[1].is_signer = false;
    svm.expire_blockhash();
    let msg = Message::new(&[unsigned], Some(&payer.pubkey()));
    let tx = Transaction::new(&[&payer], msg, svm.latest_blockhash());
    let before = svm.get_account(&config).unwrap().data;
    let failed = svm.send_transaction(tx).unwrap_err();
    assert_eq!(failed.err, solana_transaction::TransactionError::InstructionError(0,
        solana_instruction::error::InstructionError::Custom(3010)));
    assert_eq!(svm.get_account(&config).unwrap().data, before);
    let mut wrong_system = ix(config, runtime.pubkey(), payer.pubkey(), 11, [3;32]);
    wrong_system.accounts[4].pubkey = mpl_core::ID;
    reject(&mut svm, &payer, &runtime, config, wrong_system, 3008);
    let mut invalid_payer = svm.get_account(&payer.pubkey()).unwrap();
    invalid_payer.owner = soulbound::id();
    svm.set_account(runtime.pubkey(), invalid_payer).unwrap();
    reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), runtime.pubkey(), 11, [3;32]), 2003);
    let mut truncated_root = ix(config, runtime.pubkey(), payer.pubkey(), 11, [3;32]);
    truncated_root.data.pop();
    reject(&mut svm, &payer, &runtime, config, truncated_root, 102);
    // u64::MAX does not wrap; there is no epoch increment.
    send(&mut svm, &payer, &runtime, ix(config, runtime.pubkey(), payer.pubkey(), u64::MAX, [4;32])).unwrap();
    assert_eq!(read_config(&svm, &config).memory_epoch, u64::MAX);
    reject(&mut svm, &payer, &runtime, config, ix(config, runtime.pubkey(), payer.pubkey(), u64::MAX, [4;32]), 6004);
}

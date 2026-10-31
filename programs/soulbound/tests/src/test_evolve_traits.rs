//! Ticket 006: REQ-04, 20..22, real Core binary, no Oracle adapter.
use super::test_initialize_character::{setup, initialize, read_config};
use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use base64::Engine;
use litesvm::{LiteSVM, types::TransactionResult};
use solana_instruction::{Instruction, error::InstructionError};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::{Transaction, TransactionError};
use soulbound::{DreamState, TraitAttribute};

fn dream(config: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"dream", config.as_ref()], &soulbound::id()).0
}
fn attributes(svm: &LiteSVM, asset: Pubkey) -> Vec<TraitAttribute> {
    mpl_core::Asset::from_bytes(&svm.get_account(&asset).unwrap().data).unwrap()
        .plugin_list.attributes.unwrap().attributes.attribute_list.into_iter()
        .map(|a| TraitAttribute { key: a.key, value: a.value }).collect()
}
fn ix(config: Pubkey, asset: Pubkey, runtime: Pubkey, payer: Pubkey, revision: u64, hash: [u8;32], attrs: Vec<TraitAttribute>) -> Instruction {
    Instruction { program_id: soulbound::id(), accounts: soulbound::accounts::EvolveTraits {
        config, asset, runtime_signer: runtime, payer, dream: dream(config),
        core_program: mpl_core::ID, system_program: solana_sdk_ids::system_program::id(),
    }.to_account_metas(None), data: soulbound::instruction::EvolveTraits {
        expected_revision: revision, journal_hash: hash, new_attributes: attrs,
    }.data() }
}
fn send(svm: &mut LiteSVM, payer: &Keypair, signer: &Keypair, ix: Instruction) -> TransactionResult {
    svm.expire_blockhash();
    let message = Message::new(&[ix], Some(&payer.pubkey()));
    svm.send_transaction(Transaction::new(&[payer, signer], message, svm.latest_blockhash()))
}
fn reject(svm: &mut LiteSVM, payer: &Keypair, signer: &Keypair, config: Pubkey, asset: Pubkey, instruction: Instruction, code: u32) {
    let before = [svm.get_account(&config), svm.get_account(&asset), svm.get_account(&dream(config))];
    let result = send(svm, payer, signer, instruction).unwrap_err();
    assert_eq!(result.err, TransactionError::InstructionError(0, InstructionError::Custom(code)), "{:?}", result.meta.logs);
    assert_eq!(before, [svm.get_account(&config), svm.get_account(&asset), svm.get_account(&dream(config))], "failure must be atomic");
}
#[test]
fn req04_20_21_22_runtime_replacement_provenance_and_direct_owner_rejection() {
    let (mut svm, payer) = setup();
    let owner = Keypair::new(); let runtime = Keypair::new(); let stranger = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (result, minted) = initialize(&mut svm, &payer, &owner, 6, runtime.pubkey(), "calm");
    result.unwrap();
    let config = minted.config; let asset = read_config(&svm, &config).asset;
    let config_before = svm.get_account(&config).unwrap();
    let mut attrs = attributes(&svm, asset);
    attrs.iter_mut().find(|a| a.key == "mood").unwrap().value = "reflective".into();
    attrs.push(TraitAttribute { key: "custom".into(), value: "retained".into() });
    // REQ-04, REQ-21: owner and third party cannot enter program authority path.
    for signer in [&owner, &stranger] {
        reject(&mut svm, &payer, signer, config, asset, ix(config, asset, signer.pubkey(), payer.pubkey(), 0, [1;32], attrs.clone()), 6009);
    }
    // REQ-21: direct Core mutation by the owner, not merely our guard rejecting it.
    let direct = mpl_core::instructions::UpdatePluginV1Builder::new()
        .asset(asset).payer(payer.pubkey()).authority(Some(owner.pubkey()))
        .plugin(mpl_core::types::Plugin::Attributes(mpl_core::types::Attributes {
            attribute_list: attrs.iter().map(|a| mpl_core::types::Attribute { key: a.key.clone(), value: a.value.clone() }).collect(),
        })).instruction();
    for signer in [&owner, &stranger] {
        let mut attempt = direct.clone(); attempt.accounts[3].pubkey = signer.pubkey();
        let before = svm.get_account(&asset);
        let failure = send(&mut svm, &payer, signer, attempt).unwrap_err();
        println!("direct non-PDA Core rejection: {:?}", failure.err);
        assert_eq!(failure.err, TransactionError::InstructionError(0, InstructionError::Custom(mpl_core::errors::MplCoreError::NoApprovals as u32)));
        assert_eq!(before, svm.get_account(&asset));
    }
    let result = send(&mut svm, &payer, &runtime, ix(config, asset, runtime.pubkey(), payer.pubkey(), 0, [1;32], attrs.clone())).unwrap();
    assert_eq!(attributes(&svm, asset), attrs, "Core replaces the complete list");
    println!("CORE_FIXTURE config={} data={}", config, base64::engine::general_purpose::STANDARD.encode(&svm.get_account(&asset).unwrap().data));
    assert_eq!(svm.get_account(&config).unwrap(), config_before, "no config layout migration");
    let state = DreamState::try_deserialize(&mut svm.get_account(&dream(config)).unwrap().data.as_slice()).unwrap();
    assert_eq!((state.config, state.journal_hash, state.revision), (config, [1;32], 1));
    assert_eq!(state.bump, Pubkey::find_program_address(&[b"dream", config.as_ref()], &soulbound::id()).1);
    let encoded = result.logs.iter().find_map(|l| l.strip_prefix("Program data: ")).expect("actual TraitsEvolved event");
    let event_bytes = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
    assert_eq!(&event_bytes[..8], soulbound::TraitsEvolved::DISCRIMINATOR);
    let event = soulbound::TraitsEvolved::deserialize(&mut &event_bytes[8..]).unwrap();
    assert_eq!((event.config, event.asset, event.journal_hash, event.revision, event.timestamp),
        (config, asset, state.journal_hash, state.revision, state.timestamp));
    println!("dream size={} rent={} CU={}", svm.get_account(&dream(config)).unwrap().data.len(),
        svm.get_account(&dream(config)).unwrap().lamports, result.compute_units_consumed);
    // Existing provenance binding/bump corruption cannot reset or redirect it.
    let original_dream = svm.get_account(&dream(config)).unwrap();
    for offset in [8, 40] {
        let mut corrupt = original_dream.clone(); corrupt.data[offset] ^= 1;
        svm.set_account(dream(config), corrupt).unwrap();
        reject(&mut svm, &payer, &runtime, config, asset,
            ix(config, asset, runtime.pubkey(), payer.pubkey(), 1, [2;32], attrs.clone()), 6012);
    }
    svm.set_account(dream(config), original_dream.clone()).unwrap();
    let mut overflow = original_dream.clone();
    overflow.data[73..81].copy_from_slice(&u64::MAX.to_le_bytes());
    svm.set_account(dream(config), overflow).unwrap();
    reject(&mut svm, &payer, &runtime, config, asset,
        ix(config, asset, runtime.pubkey(), payer.pubkey(), u64::MAX, [2;32], attrs.clone()), 6001);
    svm.set_account(dream(config), original_dream).unwrap();
    // Full replacement updates values, preserves the fetched custom key.
    attrs.iter_mut().find(|a| a.key == "mood").unwrap().value = "hopeful".into();
    send(&mut svm, &payer, &runtime, ix(config, asset, runtime.pubkey(), payer.pubkey(), 1, [2;32], attrs.clone())).unwrap();
    assert_eq!(attributes(&svm, asset), attrs);
    reject(&mut svm, &payer, &runtime, config, asset, ix(config, asset, runtime.pubkey(), payer.pubkey(), 1, [3;32], attrs.clone()), 6013);
    reject(&mut svm, &payer, &runtime, config, asset, ix(config, asset, runtime.pubkey(), payer.pubkey(), 2, [2;32], attrs.clone()), 6010);
    // Failed validation, including omission of a custom key, leaves provenance and Core unchanged.
    let mut missing_custom = attrs.clone(); missing_custom.pop();
    let mut duplicate = attrs.clone(); duplicate.push(attrs[0].clone());
    let mut long = attrs.clone(); long[1].value = "x".repeat(129);
    let mut lifecycle = attrs.clone(); lifecycle[0].value = "adult".into();
    let mut too_many = attrs.clone();
    for n in 0..12 { too_many.push(TraitAttribute { key: format!("extra{n}"), value: "x".into() }); }
    let mut long_key = attrs.clone(); long_key.push(TraitAttribute { key: "k".repeat(33), value: "x".into() });
    let mut empty = attrs.clone(); empty[1].value.clear();
    for invalid in [missing_custom, duplicate, long, lifecycle, too_many, long_key, empty, vec![]] {
        reject(&mut svm, &payer, &runtime, config, asset, ix(config, asset, runtime.pubkey(), payer.pubkey(), 2, [3;32], invalid), 6011);
    }
    reject(&mut svm, &payer, &runtime, config, asset, ix(config, asset, runtime.pubkey(), payer.pubkey(), 2, [0;32], attrs.clone()), 6010);
    // Missing runtime signature has Anchor's typed AccountNotSigner error.
    let mut unsigned = ix(config, asset, runtime.pubkey(), payer.pubkey(), 2, [3;32], attrs.clone());
    unsigned.accounts[1].is_signer = false;
    let before = [svm.get_account(&config), svm.get_account(&asset), svm.get_account(&dream(config))];
    svm.expire_blockhash();
    let msg = Message::new(&[unsigned], Some(&payer.pubkey()));
    let failure = svm.send_transaction(Transaction::new(&[&payer], msg, svm.latest_blockhash())).unwrap_err();
    assert_eq!(failure.err, TransactionError::InstructionError(0, InstructionError::Custom(3010)));
    assert_eq!(before, [svm.get_account(&config), svm.get_account(&asset), svm.get_account(&dream(config))]);
    // Asset substitution is rejected before any mutation.
    let (result, other) = initialize(&mut svm, &payer, &owner, 7, runtime.pubkey(), "calm");
    result.unwrap();
    let foreign_asset = read_config(&svm, &other.config).asset;
    reject(&mut svm, &payer, &runtime, config, asset, ix(config, foreign_asset, runtime.pubkey(), payer.pubkey(), 2, [3;32], attrs), 2001);
    // Actual Core CPI failure rolls back new provenance creation as well.
    let foreign_attrs = attributes(&svm, foreign_asset);
    let mut broken = svm.get_account(&foreign_asset).unwrap();
    broken.data[34..66].copy_from_slice(owner.pubkey().as_ref()); // replace Core update authority
    svm.set_account(foreign_asset, broken).unwrap();
    reject(&mut svm, &payer, &runtime, other.config, foreign_asset,
        ix(other.config, foreign_asset, runtime.pubkey(), payer.pubkey(), 0, [3;32], foreign_attrs), mpl_core::errors::MplCoreError::NoApprovals as u32);
}

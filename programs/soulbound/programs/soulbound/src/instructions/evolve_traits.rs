use anchor_lang::prelude::*;
use mpl_core::{instructions::UpdatePluginV1Builder, types::{Attribute, Attributes, Plugin}};
use crate::{error::SoulboundError, state::*};

#[derive(Accounts)]
pub struct EvolveTraits<'info> {
    #[account(seeds = [CHARACTER_SEED, config.owner.as_ref(), &config.character_id.to_le_bytes()],
        bump = config.bump, has_one = runtime_signer @ SoulboundError::UnauthorizedTraitRuntime,
        has_one = asset)]
    pub config: Account<'info, CharacterConfig>,
    pub runtime_signer: Signer<'info>,
    #[account(mut, constraint = payer.to_account_info().owner == &anchor_lang::system_program::ID)]
    pub payer: Signer<'info>,
    /// CHECK: config binds the asset; Core owns and validates its contents.
    #[account(mut, owner = mpl_core::ID)]
    pub asset: UncheckedAccount<'info>,
    // First evolution creates provenance, not a config migration. No reset/close path.
    #[account(init_if_needed, payer = payer, space = 8 + DreamState::INIT_SPACE,
        seeds = [DREAM_SEED, config.key().as_ref()], bump)]
    pub dream: Account<'info, DreamState>,
    /// CHECK: pinned executable CPI target.
    #[account(address = mpl_core::ID, executable)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct TraitsEvolved {
    pub config: Pubkey,
    pub asset: Pubkey,
    pub journal_hash: [u8; 32],
    pub revision: u64,
    pub timestamp: i64,
}

pub fn evolve_traits_handle(
    ctx: Context<EvolveTraits>, expected_revision: u64, journal_hash: [u8; 32],
    new_attributes: Vec<TraitAttribute>,
) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let dream = &mut ctx.accounts.dream;
    if dream.config == Pubkey::default() {
        require!(dream.revision == 0 && dream.journal_hash == [0; 32], SoulboundError::InvalidDreamState);
    } else {
        require_keys_eq!(dream.config, cfg.key(), SoulboundError::InvalidDreamState);
        require_eq!(dream.bump, ctx.bumps.dream, SoulboundError::InvalidDreamState);
    }
    require_eq!(dream.revision, expected_revision, SoulboundError::StaleDreamRevision);
    require!(journal_hash != [0; 32] && journal_hash != dream.journal_hash, SoulboundError::InvalidJournalHash);
    let revision = dream.revision.checked_add(1).ok_or(SoulboundError::MathOverflow)?;
    require!(new_attributes.len() >= 4 && new_attributes.len() <= MAX_ATTRIBUTES, SoulboundError::InvalidAttributes);
    for (n, attr) in new_attributes.iter().enumerate() {
        require!(!attr.key.is_empty() && attr.key.len() <= 32 && !attr.value.is_empty()
            && attr.value.len() <= MAX_TRAIT_VECTOR_LEN
            && !new_attributes[..n].iter().any(|prior| prior.key == attr.key), SoulboundError::InvalidAttributes);
    }
    let get = |key: &str| new_attributes.iter().find(|a| a.key == key).map(|a| a.value.as_str());
    require!(get("life_stage") == Some(cfg.life_stage.as_str())
        && get("memory_epoch") == Some(cfg.memory_epoch.to_string().as_str())
        && get("mood").is_some() && get("trait_vector").is_some(), SoulboundError::InvalidAttributes);
    // Fetch-modify-write: reject accidental omission of any existing key.
    // PDA authority + runtime signature is the approved REQ-04 gate (2026-10-30).
    {
        let (_, attributes, _) = mpl_core::fetch_asset_plugin::<Attributes>(
            &ctx.accounts.asset.to_account_info(), mpl_core::types::PluginType::Attributes,
        ).map_err(|_| error!(SoulboundError::InvalidAttributes))?;
        require!(attributes.attribute_list.iter().all(|a| get(&a.key).is_some()), SoulboundError::InvalidAttributes);
    }
    let instruction = UpdatePluginV1Builder::new()
        .asset(ctx.accounts.asset.key()).payer(ctx.accounts.payer.key())
        .authority(Some(cfg.key())).system_program(ctx.accounts.system_program.key())
        .plugin(Plugin::Attributes(Attributes { attribute_list: new_attributes.into_iter()
            .map(|a| Attribute { key: a.key, value: a.value }).collect() }))
        .instruction();
    let id = cfg.character_id.to_le_bytes();
    let seeds: &[&[u8]] = &[CHARACTER_SEED, cfg.owner.as_ref(), &id, &[cfg.bump]];
    anchor_lang::solana_program::program::invoke_signed(&instruction, &[
        ctx.accounts.asset.to_account_info(), ctx.accounts.payer.to_account_info(),
        cfg.to_account_info(), ctx.accounts.system_program.to_account_info(),
        ctx.accounts.core_program.to_account_info(),
    ], &[seeds])?;
    let timestamp = Clock::get()?.unix_timestamp;
    dream.config = cfg.key();
    dream.bump = ctx.bumps.dream;
    dream.journal_hash = journal_hash;
    dream.revision = revision;
    dream.timestamp = timestamp;
    emit!(TraitsEvolved { config: cfg.key(), asset: ctx.accounts.asset.key(), journal_hash, revision, timestamp });
    Ok(())
}

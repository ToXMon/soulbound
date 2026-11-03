use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use mpl_core::{
    instructions::UpdatePluginV1Builder,
    types::{Attributes, Plugin, PluginType},
};

use crate::{error::SoulboundError, state::*};

#[derive(Accounts)]
pub struct CrankHeartbeat<'info> {
    #[account(mut,
        seeds = [CHARACTER_SEED, config.owner.as_ref(), &config.character_id.to_le_bytes()],
        bump = config.bump, has_one = asset)]
    pub config: Account<'info, CharacterConfig>,
    #[account(seeds = [MEMORY_ROOTS_SEED, config.key().as_ref()],
        bump = history.bump, has_one = config)]
    pub history: Account<'info, MemoryRootHistory>,
    #[account(seeds = [HEARTBEAT_REWARD_SEED, config.key().as_ref()],
        bump = reward_config.bump, has_one = config, has_one = reward_mint)]
    pub reward_config: Account<'info, HeartbeatRewardConfig>,
    #[account(mut, address = reward_config.reward_mint)]
    pub reward_mint: Account<'info, Mint>,
    #[account(mut,
        associated_token::mint = reward_mint,
        associated_token::authority = config,
        associated_token::token_program = token_program)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(init_if_needed, payer = caller,
        associated_token::mint = reward_mint,
        associated_token::authority = caller,
        associated_token::token_program = token_program)]
    pub caller_ata: Account<'info, TokenAccount>,
    /// CHECK: config binds the asset; Core validates plugin data.
    #[account(mut, owner = mpl_core::ID)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: pinned executable CPI target.
    #[account(address = mpl_core::ID, executable)]
    pub core_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct HeartbeatCranked {
    pub config: Pubkey,
    pub caller: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_amount: u64,
    pub first_root_timestamp: i64,
    pub timestamp: i64,
    pub from_stage: LifeStage,
    pub to_stage: LifeStage,
}

pub fn crank_heartbeat_handle(ctx: Context<CrankHeartbeat>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(
        config.life_stage == LifeStage::Born,
        SoulboundError::HeartbeatWrongStage
    );
    require!(
        ctx.accounts.history.entries.len() >= HEARTBEAT_MIN_ROOTS,
        SoulboundError::HeartbeatInsufficientRoots
    );

    let first_root_timestamp = ctx.accounts.history.entries[0].timestamp;
    let ready_at = first_root_timestamp
        .checked_add(HEARTBEAT_MIN_ELAPSED_SECONDS)
        .ok_or(SoulboundError::HeartbeatTimestampOverflow)?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= first_root_timestamp,
        SoulboundError::HeartbeatClockRegression
    );
    require!(now >= ready_at, SoulboundError::HeartbeatTooEarly);

    let mint = &ctx.accounts.reward_mint;
    require!(
        mint.decimals == 0
            && mint.supply == HEARTBEAT_REWARD_AMOUNT
            && mint.mint_authority.is_none()
            && mint.freeze_authority.is_none()
            && ctx.accounts.vault.amount == HEARTBEAT_REWARD_AMOUNT,
        SoulboundError::InvalidHeartbeatRewardVault
    );

    update_core_life_stage(&ctx)?;

    let id = config.character_id.to_le_bytes();
    let bump = [config.bump];
    let signer_seeds: &[&[u8]] = &[CHARACTER_SEED, config.owner.as_ref(), &id, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.reward_mint.to_account_info(),
                to: ctx.accounts.caller_ata.to_account_info(),
                authority: config.to_account_info(),
            },
            &[signer_seeds],
        ),
        HEARTBEAT_REWARD_AMOUNT,
        0,
    )?;

    let cfg = &mut ctx.accounts.config;
    cfg.life_stage = LifeStage::Awakened;
    emit!(HeartbeatCranked {
        config: cfg.key(),
        caller: ctx.accounts.caller.key(),
        reward_mint: ctx.accounts.reward_mint.key(),
        reward_amount: HEARTBEAT_REWARD_AMOUNT,
        first_root_timestamp,
        timestamp: now,
        from_stage: LifeStage::Born,
        to_stage: LifeStage::Awakened,
    });
    Ok(())
}

fn update_core_life_stage(ctx: &Context<CrankHeartbeat>) -> Result<()> {
    let (_, mut attributes, _) = mpl_core::fetch_asset_plugin::<Attributes>(
        &ctx.accounts.asset.to_account_info(),
        PluginType::Attributes,
    )
    .map_err(|_| error!(SoulboundError::InvalidHeartbeatAttributes))?;
    let mut found = false;
    for attribute in &mut attributes.attribute_list {
        if attribute.key == "life_stage" {
            require!(!found, SoulboundError::InvalidHeartbeatAttributes);
            attribute.value = LifeStage::Awakened.as_str().to_owned();
            found = true;
        }
    }
    require!(found, SoulboundError::InvalidHeartbeatAttributes);

    let instruction = UpdatePluginV1Builder::new()
        .asset(ctx.accounts.asset.key())
        .payer(ctx.accounts.caller.key())
        .authority(Some(ctx.accounts.config.key()))
        .system_program(ctx.accounts.system_program.key())
        .plugin(Plugin::Attributes(attributes))
        .instruction();
    let config = &ctx.accounts.config;
    let id = config.character_id.to_le_bytes();
    let bump = [config.bump];
    let signer_seeds: &[&[u8]] = &[CHARACTER_SEED, config.owner.as_ref(), &id, &bump];
    anchor_lang::solana_program::program::invoke_signed(
        &instruction,
        &[
            ctx.accounts.asset.to_account_info(),
            ctx.accounts.caller.to_account_info(),
            config.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.core_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;
    Ok(())
}

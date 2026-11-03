use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{error::SoulboundError, state::*};

#[derive(Accounts)]
pub struct InitializeHeartbeatReward<'info> {
    #[account(
        seeds = [CHARACTER_SEED, config.owner.as_ref(), &config.character_id.to_le_bytes()],
        bump = config.bump, has_one = owner @ SoulboundError::UnauthorizedOwner)]
    pub config: Account<'info, CharacterConfig>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + HeartbeatRewardConfig::INIT_SPACE,
        seeds = [HEARTBEAT_REWARD_SEED, config.key().as_ref()], bump)]
    pub reward_config: Account<'info, HeartbeatRewardConfig>,
    pub reward_mint: Account<'info, Mint>,
    #[account(init, payer = owner,
        associated_token::mint = reward_mint,
        associated_token::authority = config,
        associated_token::token_program = token_program)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// One-time owner binding of a zero-decimal legacy SPL mint with neither mint nor freeze authority.
/// The owner separately mints one unit to `vault` and revokes mint authority.
pub fn initialize_heartbeat_reward_handle(ctx: Context<InitializeHeartbeatReward>) -> Result<()> {
    require!(
        ctx.accounts.config.life_stage == LifeStage::Born,
        SoulboundError::HeartbeatWrongStage
    );
    require!(
        ctx.accounts.reward_mint.decimals == 0
            && ctx.accounts.reward_mint.supply == 0
            && ctx.accounts.reward_mint.mint_authority
                == anchor_lang::solana_program::program_option::COption::Some(
                    ctx.accounts.owner.key()
                )
            && ctx.accounts.reward_mint.freeze_authority.is_none(),
        SoulboundError::InvalidHeartbeatRewardMint
    );

    ctx.accounts.reward_config.config = ctx.accounts.config.key();
    ctx.accounts.reward_config.reward_mint = ctx.accounts.reward_mint.key();
    ctx.accounts.reward_config.bump = ctx.bumps.reward_config;
    Ok(())
}

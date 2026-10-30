use anchor_lang::prelude::*;
use crate::{error::SoulboundError, state::*};

#[derive(Accounts)]
pub struct RotateRuntimeSigner<'info> {
    #[account(mut, seeds = [CHARACTER_SEED, config.owner.as_ref(), &config.character_id.to_le_bytes()],
        bump = config.bump, has_one = owner @ SoulboundError::UnauthorizedOwner)]
    pub config: Account<'info, CharacterConfig>,
    pub owner: Signer<'info>,
    // Proof of possession prevents installing an address without a usable key.
    // The lost/current runtime is deliberately NOT required to authorize recovery.
    pub replacement: Signer<'info>,
}

#[event]
pub struct RuntimeSignerRotated {
    pub config: Pubkey,
    pub old_signer: Pubkey,
    pub new_signer: Pubkey,
    pub timestamp: i64,
}

pub fn rotate_runtime_signer_handle(ctx: Context<RotateRuntimeSigner>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_signer = config.runtime_signer;
    let new_signer = ctx.accounts.replacement.key();
    require_keys_neq!(old_signer, new_signer, SoulboundError::UnchangedRuntimeSigner);
    let timestamp = Clock::get()?.unix_timestamp;
    // No realloc or other writable state/asset/history accounts are accepted.
    config.runtime_signer = new_signer;
    emit!(RuntimeSignerRotated { config: config.key(), old_signer, new_signer, timestamp });
    Ok(())
}

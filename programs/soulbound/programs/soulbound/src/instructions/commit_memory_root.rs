use anchor_lang::prelude::*;
use crate::{error::SoulboundError, state::*};

#[derive(Accounts)]
pub struct CommitMemoryRoot<'info> {
    #[account(mut, seeds = [CHARACTER_SEED, config.owner.as_ref(), &config.character_id.to_le_bytes()],
        bump = config.bump, has_one = runtime_signer @ SoulboundError::UnauthorizedRuntime)]
    pub config: Account<'info, CharacterConfig>,
    pub runtime_signer: Signer<'info>,
    /// Explicit rent payer; need not be the character owner or runtime.
    #[account(mut, constraint = payer.to_account_info().owner == &anchor_lang::system_program::ID)]
    pub payer: Signer<'info>,
    // init_if_needed is deliberate: first commit creates history atomically.
    // Only the authenticated runtime reaches the handler. Existing histories
    // must retain their config+bump; no reset/close/rewrite instruction exists.
    #[account(init_if_needed, payer = payer, space = 8 + MemoryRootHistory::INIT_SPACE,
        seeds = [MEMORY_ROOTS_SEED, config.key().as_ref()], bump)]
    pub history: Account<'info, MemoryRootHistory>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct MemoryRootCommitted {
    pub config: Pubkey,
    pub epoch: u64,
    pub root: [u8; 32],
    pub timestamp: i64,
}

pub fn commit_memory_root_handle(ctx: Context<CommitMemoryRoot>, epoch: u64, root: [u8; 32]) -> Result<()> {
    require!(root != [0; 32], SoulboundError::InvalidMemoryRoot);
    let history = &mut ctx.accounts.history;
    if history.config == Pubkey::default() {
        require!(history.entries.is_empty(), SoulboundError::InvalidHistory);
    } else {
        require_keys_eq!(history.config, ctx.accounts.config.key(), SoulboundError::InvalidHistory);
        require_eq!(history.bump, ctx.bumps.history, SoulboundError::InvalidHistory);
    }
    let next_len = history.entries.len().checked_add(1).ok_or(SoulboundError::MathOverflow)?;
    require!(next_len <= MAX_MEMORY_ROOTS, SoulboundError::MemoryHistoryFull);
    if let Some(last) = history.entries.last() {
        require!(epoch > last.epoch, SoulboundError::NonIncreasingEpoch);
    }
    let timestamp = Clock::get()?.unix_timestamp;
    history.config = ctx.accounts.config.key();
    history.bump = ctx.bumps.history;
    history.entries.push(MemoryRootEntry { epoch, root, timestamp });
    ctx.accounts.config.memory_epoch = epoch;
    emit!(MemoryRootCommitted { config: history.config, epoch, root, timestamp });
    Ok(())
}

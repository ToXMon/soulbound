pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd");

#[program]
pub mod soulbound {
    use super::*;

    /// REQ-04, 20..22: runtime-gated full Attributes replacement and provenance.
    pub fn evolve_traits(
        ctx: Context<EvolveTraits>,
        expected_revision: u64,
        journal_hash: [u8; 32],
        new_attributes: Vec<TraitAttribute>,
    ) -> Result<()> {
        instructions::evolve_traits::evolve_traits_handle(ctx, expected_revision, journal_hash, new_attributes)
    }

    /// Ticket 005 amendment: owner-authorized recovery with replacement proof of possession.
    pub fn rotate_runtime_signer(ctx: Context<RotateRuntimeSigner>) -> Result<()> {
        instructions::rotate_runtime_signer::rotate_runtime_signer_handle(ctx)
    }

    /// REQ-10..13: authenticated append-only memory lineage, off the voice path.
    pub fn commit_memory_root(
        ctx: Context<CommitMemoryRoot>,
        epoch: u64,
        root: [u8; 32],
    ) -> Result<()> {
        instructions::commit_memory_root::commit_memory_root_handle(ctx, epoch, root)
    }

    /// REQ-01..03, 05..07: birth of a character.
    pub fn initialize_character(
        ctx: Context<InitializeCharacter>,
        character_id: u64,
        runtime_signer: Pubkey,
        trait_vector: String,
    ) -> Result<()> {
        instructions::initialize_character::handle(ctx, character_id, runtime_signer, trait_vector)
    }
}

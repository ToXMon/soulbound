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

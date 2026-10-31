use anchor_lang::prelude::*;

pub const CHARACTER_SEED: &[u8] = b"character";
pub const MAX_TRAIT_VECTOR_LEN: usize = 128;
pub const CHARACTER_NAME: &str = "SOULBOUND Character";
pub const MEMORY_ROOTS_SEED: &[u8] = b"memory_roots";
pub const MAX_MEMORY_ROOTS: usize = 128;
pub const DREAM_SEED: &[u8] = b"dream";
pub const MAX_ATTRIBUTES: usize = 16;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct TraitAttribute {
    pub key: String,
    pub value: String,
}

/// Separate provenance account preserves the deployed 154-byte config layout.
#[account]
#[derive(InitSpace)]
pub struct DreamState {
    pub config: Pubkey,
    pub bump: u8,
    pub journal_hash: [u8; 32],
    pub revision: u64,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Debug, PartialEq, Eq)]
pub struct MemoryRootEntry {
    pub epoch: u64,
    pub root: [u8; 32],
    /// Unix seconds from the chain Clock.
    pub timestamp: i64,
}

#[account]
#[derive(InitSpace)]
pub struct MemoryRootHistory {
    pub config: Pubkey,
    pub bump: u8,
    #[max_len(128)]
    pub entries: Vec<MemoryRootEntry>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum LifeStage {
    Born,
}

impl LifeStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            LifeStage::Born => "born",
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct CharacterConfig {
    pub owner: Pubkey,
    pub character_id: u64,
    pub runtime_signer: Pubkey,
    pub asset: Pubkey,
    pub receipt_mint: Pubkey,
    pub memory_epoch: u64,
    pub life_stage: LifeStage,
    pub bump: u8,
}

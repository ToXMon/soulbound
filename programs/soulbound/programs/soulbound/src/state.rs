use anchor_lang::prelude::*;

pub const CHARACTER_SEED: &[u8] = b"character";
pub const MAX_TRAIT_VECTOR_LEN: usize = 128;
pub const CHARACTER_NAME: &str = "SOULBOUND Character";

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

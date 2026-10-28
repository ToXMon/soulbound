use anchor_lang::prelude::*;

#[error_code]
pub enum SoulboundError {
    #[msg("Trait vector exceeds the maximum allowed length")]
    TraitVectorTooLong,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

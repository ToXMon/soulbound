use anchor_lang::prelude::*;

#[error_code]
pub enum SoulboundError {
    #[msg("Trait vector exceeds the maximum allowed length")]
    TraitVectorTooLong,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Only the configured runtime signer may commit memory roots")]
    UnauthorizedRuntime,
    #[msg("Memory root must not be zero")]
    InvalidMemoryRoot,
    #[msg("Epoch must be strictly greater than the last committed epoch")]
    NonIncreasingEpoch,
    #[msg("Memory root history is full")]
    MemoryHistoryFull,
    #[msg("Memory root history is bound to another config or bump")]
    InvalidHistory,
    #[msg("Only the configured owner may rotate the runtime signer")]
    UnauthorizedOwner,
    #[msg("Replacement runtime signer must differ from the current signer")]
    UnchangedRuntimeSigner,
}

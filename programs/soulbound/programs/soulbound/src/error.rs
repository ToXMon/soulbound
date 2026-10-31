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
    #[msg("Only the configured runtime signer may evolve traits")]
    UnauthorizedTraitRuntime,
    #[msg("Journal hash must be nonzero and different from the previous journal")]
    InvalidJournalHash,
    #[msg("Trait list is invalid, incomplete, duplicated, or exceeds bounds")]
    InvalidAttributes,
    #[msg("Dream provenance is bound to another config or bump")]
    InvalidDreamState,
    #[msg("Dream revision changed; fetch current attributes before proposing again")]
    StaleDreamRevision,
}

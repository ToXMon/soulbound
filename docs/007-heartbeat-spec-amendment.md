# Ticket 007 heartbeat spec amendment

Date: 2026-10-31
POC: Tolu Shekoni
TL;DR: Tolu approved one Born-to-Awakened heartbeat transition, gated by two committed roots and 60 seconds since the first root, with an atomic Core attribute update and a one-unit devnet reward token. This supplements `tickets/007-crank-heartbeat.md`; it does not alter the architecture REQs.

## Approved behavior

- One monotonic stage transition in Ticket 007: `Born` to `Awakened`.
- A permissionless crank is eligible only when the canonical `MemoryRootHistory` contains at least two distinct committed entries and the current Solana `Clock.unix_timestamp` is at least 60 seconds after the first entry's timestamp. Count entries; do not use numeric epoch value as count because epoch numbers may skip and zero is valid.
- The crank updates `CharacterConfig.life_stage` and the Core asset's Attributes `life_stage` in the same transaction. Reuse the existing config-PDA update authority and established Core CPI pattern. Any failed precondition or failed Core/reward CPI must leave all account state unchanged.
- Preserve the deployed 154-byte `CharacterConfig` layout. Use a separate `HeartbeatState` PDA only if implementation needs state not derivable from the existing root history and current stage. Do not add an unnecessary birth timestamp.
- After success, a repeat crank is rejected and cannot issue another reward.

## Approved reward direction

- New valueless devnet-only legacy SPL Token mint; zero decimals; exactly one token unit minted for the demonstration. The mint must have **no freeze authority**, so the owner cannot freeze the caller's ATA and block the payout.
- The owner creates/funds the program-controlled vault ATA with that one unit and revokes mint authority. No future mint, withdrawal or stablecoin value claim. Reward initialization and every crank must reject a mint whose `freeze_authority` is present; the crank also checks zero decimals, total supply exactly one, revoked mint authority, and vault balance exactly one.
- Every successful crank transfers the fixed one-unit reward from the PDA-authorized vault to the permissionless caller's ATA. The caller may pay ATA rent. The exact mint address, accounts, setup instructions, current rent/fees and maximum authorized SOL cost are not yet approved; present them to Tolu before any signing, minting, vault setup or devnet transaction.
- REQ-31 requires a nonzero reward. Do not use the ticket's zero-reward escape without a separately authorized spec/REQ change.

## Verification and boundaries

- Correct the stale ticket verification command in the working plan to `cd programs/soulbound && anchor build && cargo test -p tests -- --nocapture --test-threads=1`; do not edit the original ticket file under the current project authority rule.
- Local tests must cover threshold, early time, clock regression, wrong/foreign history, already-awakened repeat, successful stage/config/Core attribute/reward/event effects, and atomic rollback on CPI failure.
- No live devnet setup or crank is approved by this amendment. After implementation and independent review, any reward mint, vault funding, ATA creation or crank needs a separate exact-action approval with freshly quoted costs.
- Scope remains Ticket 007 only. No unrelated changes, Arcium work, commits or pushes are authorized by this spec amendment.

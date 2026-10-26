---
name: solana-doer
description: SOULBOUND Solana/Anchor execution pack — distilled patterns from the bounded-payments capstone, Turbin3 Q3 2026 cohort, and verified Metaplex Core / Token-2022 docs. Muse Code (doer) MUST load this before touching programs/ or any Anchor/Solana ticket.
---

# Solana doer pack (SOULBOUND)

Distilled, verified-where-marked. When a fact is marked **[verify]**, check the linked source before writing code — do not guess APIs.

## Capstone patterns (from bounded-payments — follow this style exactly)

- `declare_id!` pinned at top; devnet mints as `pub const`.
- PDA accounts: `seeds = [b"prefix", owner.key().as_ref(), &id.to_le_bytes()], bump` + store `bump` in the account.
- Guards first: `require!(...)` with a typed `#[error_code]` enum (one variant per failure, human message).
- Checked math only: `checked_add/checked_mul` → custom `MathOverflow` error.
- SPL via `anchor_spl::token_interface` (`TokenInterface`, `TransferChecked`) — works for SPL and Token-2022 without handler changes.
- PDA-signed CPI: `CpiContext::new_with_signer(program, accounts, &[signer_seeds])`.
- `#[derive(InitSpace)]` for account sizing; `space = 8 + X::INIT_SPACE`.
- Unit tests live in `#[cfg(test)]` and name their REQ ids in comments. Integration: LiteSVM.
- Deploy evidence: pin program ID in `docs/devnet.md` only AFTER real deploy; `solana program show <ID> --url devnet` must report executable. Never fabricate an address.

## Our four handlers — shapes

### `initialize_character(owner, character_id)`
- Config PDA: seeds `["character", owner, character_id]`. Stores: owner, character_id, runtime_signer, memory_epoch=0, life_stage="born", bump.
- Mints the character = **Metaplex Core asset** with the **Attributes plugin** attached at creation: `{life_stage:"born", mood:"curious", memory_epoch:"0", trait_vector:<genesis>}` (all values are strings — verified plugin fact).
- Mints the ownership **receipt** = Token-2022 mint with the **NonTransferable extension** initialized on the mint BEFORE `InitializeMint` (extension-init ordering rule from Turbin3 W4 — verified from cohort materials), then mints exactly 1 token to the owner ATA and disables further minting (mint authority → none).
- Reject duplicate character_id per owner (PDA init fails naturally — also assert with a clear error).
- **[verify]** mpl-core CPI crate: `mpl-core` Rust SDK — check current crate version and CPI instruction builders at https://developers.metaplex.com/core before writing the CPI. If program-side CPI mint proves heavy in practice, STOP and report: the reviewed fallback is client-orchestrated mint with the program PDA as the asset's update authority.

### `commit_memory_root(runtime_signer, epoch, root)`
- Root-history PDA per character: append-only vec of `(epoch, [u8;32] root, i64 timestamp)`. Reject non-runtime signer, duplicate/regressed epoch. Emit an event carrying the root.

### `evolve_traits(runtime_signer, journal_hash, new_attributes)`
- **Oracle-gated:** only the runtime signer; program CPI-updates the Core asset's Attributes plugin (Authority Managed — the program must BE the update authority or hold an Update Delegate — **[verify]** plugin authority model at https://developers.metaplex.com/core/plugins).
- Store `journal_hash` on the config account for provenance.
- Attributes plugin facts (verified): values are strings only; update REPLACES the whole list (no partial updates — fetch-modify-write the full list); owner cannot update, only the plugin authority.

### `crank_heartbeat(anyone)`
- Permissionless; advances life_stage only when its on-chain precondition holds (e.g., `memory_epoch >= threshold` and min elapsed time); pays caller from a vault PDA via PDA-signed `transfer_checked` (capstone pattern); failed precondition changes no state.

## Toolchain (Turbin3 stack)

- Anchor 0.31.x, LiteSVM for local tests, `gill`/Solana Kit for client code.
- Devnet only. Fund via faucet the day before needing it.
- References when unsure: anchor-lang.com/docs · solana.com/docs/tokens/extensions · developers.metaplex.com/core · github.com/solana-foundation/tokens (Token-2022 reference impls) · your cohort doc (linked in SOULBOUND.md context).

## Non-negotiables on this surface

- No `--yolo`, no `--disable-sandbox` anywhere in `programs/`.
- Failed instruction changes no state. Checked math everywhere. Every error variant has a human message.
- Tests name REQ ids. Nothing ships to devnet without the LiteSVM suite green.

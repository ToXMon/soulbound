# Ticket 007 independent review

Date: 2026-11-01
Reviewer / POC: AdaL; owner Tolu Shekoni
Scope: local implementation acceptance only, against `tickets/007-crank-heartbeat.md` plus approved decisions in `docs/007-heartbeat-spec-amendment.md`.

## Verdict

**PASS locally; live acceptance deferred.** The permissionless Born-to-Awakened transition, committed-history/time gate, Core attribute update, and one-time SPL reward pass the local LiteSVM suite. Ticket 007's live devnet crank criterion is still open. This review does not claim a deployed program, live reward mint/vault, real third-party crank, or explorer evidence.

## Independent verification

- Pinned container `anchor build`: PASS. The built artifact emitted a program-keypair/source-ID mismatch warning. No key sync or deployment was performed.
- `cargo test -p tests -- --nocapture --test-threads=1`: **17 passed, 0 failed** after the build completed.
- `target/idl/soulbound.json` matches the checked-in `idl/soulbound.json` byte-for-byte.
- `git diff --check`: PASS.
- No wallet, RPC, mint, vault funding, signing, transaction, deployment, upgrade, commit or push was used/performed during verification.

An earlier test run overlapped the Anchor build and showed two freeze-authority tests succeeding unexpectedly against the previous SBF artifact. After the build finished, the same suite was rerun against the refreshed artifact and all 17 tests passed, including both negative cases. The race was in verification sequencing, not a product-code failure. Do not run `anchor build` concurrently with LiteSVM tests that load `target/deploy/soulbound.so`.

## Criteria observed locally

| Criterion | Local result |
| --- | --- |
| REQ-30: threshold-governed stage advancement | PASS: requires two actual history entries and at least 60 seconds from the first entry timestamp; skipped epoch numbers do not count as extra entries |
| REQ-31: caller reward | PASS locally: a synthetic zero-decimal legacy SPL mint with exactly one unit, mint authority revoked and freeze authority absent pays the permissionless test caller once |
| REQ-32: failed precondition is atomic | PASS: missing/one-entry history, too-early clock, clock regression/overflow, repeated transition, foreign history and CPI failures leave application state unchanged |
| Core explorer state | PASS locally: config and Core Attributes move to `Awakened` together; the deployed 154-byte CharacterConfig layout remains unchanged |
| Reward setup invariants | PASS locally: owner-only one-time binding, malformed mint rejection, no freeze authority, exact one-unit cap, no program mint/withdraw instruction |

The test mint and keys are synthetic LiteSVM fixtures, not a live token or wallet. The owner still must create and fund the real mint/vault under a separately approved exact-action cost plan.

## Deferred work and caveats

1. **Live REQ-30/31 acceptance:** run the owner-authorized mint/configure/mint-one/revoke setup, then a successful crank signed by a third-party keypair and preserve explorer evidence. Before any signing, show actual addresses, signers, SOL rent/fees, who pays caller ATA/Core realloc rent, and the maximum SOL exposure. No such approval or transaction is included here.
2. **Life-page stage badge:** `agent/src/life-read.ts` currently reports only config enum byte 0 as `born`; the new `Awakened` variant will appear as `unavailable` in that badge even though the Core Attributes table will show the updated attribute. A small life-page projection follow-up is needed before claiming the badge reflects the live transition. This was outside Ticket 007's approved file scope and was not changed.
3. The original ticket's `anchor test --skip-local-validator` command is stale for this repo; the verified local command is `anchor build && cargo test -p tests -- --nocapture --test-threads=1`. The original ticket remains unedited under the project rule that tickets are thinker-owned.
4. The real doer transcript/audit packaging remains separate evidence work. No files under `audit/` were created or edited in this review.

## Scope and repository state

The 007 implementation is limited to the program, tests and the 007 section in `docs/devnet.md`, plus the approved amendment document. No unrelated dirty changes were included. The implementation and review remain uncommitted; the doer must make the implementation commit referencing ticket 007 under the one-ticket-one-commit process. Do not include unrelated work. No push is authorized.

## Next

Proceed to Ticket 008 only after isolating the existing uncommitted Ticket 022 app work or arranging explicit file ownership; Ticket 008 also modifies `app/`, so do not overwrite the pending portrait changes. Keep Ticket 007's live crank and the life-page badge correction visible as follow-ups.
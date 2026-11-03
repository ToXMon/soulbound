# Ticket 023: life-stage projection

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Decode the supported on-chain life-stage variants in the read-only life service so `/life` shows `Awakened` after Ticket 007's crank while preserving safe handling of unknown values.

## Intent

Keep the public life-page stage badge consistent with the deployed `CharacterConfig` enum as life-stage variants are added. The current projection maps only enum byte 0 (`Born`) and renders later known variants as unavailable. Add support for the approved `Awakened` variant from Ticket 007 without changing the program, chain state, app layout or 007 acceptance boundary.

## Implements / preserves

- Supports the read-only life-stage view (architecture REQ-30 view; no REQ change).
- Preserve REQ-70: no raw memory content, transcript or media exposure.
- Preserve fail-closed behavior for unknown enum values; never guess a stage.

## Files in scope

- `agent/src/life-read.ts`
- `agent/scripts/life.test.mjs`

## Non-goals

No Anchor/Solana program or IDL changes; no Core attributes decoding changes; no live RPC, wallet, deployment, transaction, mint or reward setup; no UI redesign; no cost/receipt writer; no changes to Tickets 007/008, architecture REQs, SOULBOUND.md or audit files.

## Acceptance criteria

- [ ] CharacterConfig enum value 0 projects to `born`.
- [ ] Approved enum value 1 projects to `awakened`.
- [ ] Unknown enum variants project to `null`/unavailable, without failing an otherwise valid read or mislabeling the stage.
- [ ] A regression test exercises the projection using synthetic account bytes.
- [ ] Existing life read/proof tests remain green; no private memory data is returned.

## Verification

```sh
pnpm --filter agent build
node --test agent/scripts/life.test.mjs
```

AdaL additionally reviews the focused diff and runs the commands independently. Do not query live RPC or access keys for this ticket.

## Execution boundary

One ticket, one narrow commit referencing 023, only after tests pass and no unrelated files are staged. No push. Any live 007 crank, reward-token setup or devnet evidence remains separately approval-gated and is not required for this projection fix.

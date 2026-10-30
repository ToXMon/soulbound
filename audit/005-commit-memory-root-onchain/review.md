# Ticket 005 review — commit-memory-root-onchain

Reviewer: AdaL (thinker/verifier), 2026-10-30. Scope: ticket + 2026-10-29
runtime-signer rotation amendment. Observed evidence: `verify.txt` (all commands
executed by the reviewer in the pinned sb-anchor:1.2.1 image; chain reads via
public devnet RPC only). Doer session log: not supplied as a file — the doer's
handoff is recorded in `docs/devnet.md` §005 sections and labeled as doer
cross-provider verification, not acceptance.

## Verdict: PASS (engineering criteria) — final closure pending 2 operator items

All ticket acceptance criteria that a reviewer can observe are met. Two items
the ticket itself names as closure conditions remain operator actions:
(1) VPS deployer-key exposure remediation (separately approval-gated by design,
never performed), (2) the doer's one-ticket-one-commit for the 005
implementation (the work is complete and verified but uncommitted).

## Criteria → evidence

| Criterion | Verdict | Evidence |
|---|---|---|
| 004 prerequisite resolved, manifest protocol consumed exactly | PASS | commit 0563e8c reviewed; committer consumes the 004 store API; hashing protocol unchanged |
| LiteSVM REQ-10: epoch 0 first append, immutability, config epoch | PASS | test req10_13 green; on-chain readback: epoch 0 entry, count 1, config binds same history |
| REQ-11/12 rejections atomic (wrong signer/foreign PDA/dup/regressed/zero root/full) | PASS | test req11_12 green; capacity-fill + typed codes asserted in suite |
| REQ-13 event decoded from actual SBF log | PASS | test asserts decoded event, matches root/config/epoch/timestamp |
| Rotation amendment: dual-sig success, owner-only/replacement-only/unrelated/no-op fail, state preserved | PASS | both amendment tests green (byte-scope check 48..80, req-11 regression old/new signer) |
| Rotation event decode | PASS | covered in amendment test; on-chain rotation receipt slot 516879577 independently confirmed |
| New runtime key created on Mac, no secret in repo/evidence | PASS | devnet.md records public key only; repo/audit scanned clean of key material; secret not present in chat/SDL |
| VPS deployer-key remediation | OPEN | explicitly separate approval-gated action; not performed (by design) |
| Existing genesis tests remain green | PASS | req01–07 all green |
| Off-chain committer tests (validation, dry-run no-send, restart, reconciliation, conflict, recovery) | PASS | committer.test.mjs within 61/61 green |
| 003/019 regression + RPC failure never delays speech | PASS | tts/pipeline/latency suites green within the 61 |
| Approved devnet upgrade preserves program/config identity | PASS | upgrade tx slot 516875467 confirmed on public RPC; local rebuild SHA-256 15eef67… = recorded deployed-bytes hash; program executable, same program ID |
| Real Meta-extracted root on devnet, read back, tamper fails | PASS with caveat | root 67929cc8… read back independently from public RPC, matches receipt (slot 516893750). Off-chain proof recomputation/tamper was doer-performed; reviewer confirmed the on-chain root value, not the private store |
| Report signatures/explorer/keys, no secrets in evidence | PASS | docs/devnet.md §005 receipts; verify.txt lists slots/keys verified |

## Findings

- F1 (minor): `agent/.env` on the Mac has no `MEMORY_*` committer settings; the
  documented dry-run fails visibly until configured per `docs/005-committer-runbook.md`.
  Configure before any future live commit.
- F2 (hazard): `programs/soulbound/target/deploy/soulbound-keypair.json` on this
  Mac derives `7VRcVdv…`, not the pinned program ID; created today, origin
  unclear. Harmless to tests, dangerous to a future deploy. Delete or replace
  with the VPS-held keypair; never `anchor keys sync`.
- F3 (process): no `muse-session.log` was supplied; the doer handoff lives in
  docs/devnet.md. Acceptable under the pi/doer harness precedent, but for judge
  evidence the redacted session log should be added to this folder if it exists.
- F4: the 005 implementation remains uncommitted in the working tree. Per the
  repo's one-ticket-one-commit rule the doer should commit it with the ticket id
  and the Muse Code trailer before this ticket is marked done in SOULBOUND.md.

## Not verified (labeled)

- Pre-upgrade genesis runtime signer value `f97njk…` (doer-reported; superseded
  on-chain by `2CU9…`, which was read independently).
- Off-chain store internals (kept private by contract).

Recommendation: PASS for demo purposes. Before SOULBOUND.md marks 005 complete:
execute the separately approved VPS key remediation, commit the implementation
(one ticket = one commit), and fix F1/F2.

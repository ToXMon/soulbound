# Review — Ticket 002: anchor-genesis-mint

**Verdict: PASS** · Reviewed by AdaL (thinker) 2026-10-28 · Doer: pi (claude-sonnet-5-5) · Model purity: doer is the build harness; product inference untouched.

## Acceptance criteria vs observed evidence
| Criterion | Observed | Where |
|---|---|---|
| `anchor build` clean, IDL exists | ✅ observed (my run) | verify.txt §2 |
| LiteSVM suite green (REQ-01,02,03,05,06,07) | ✅ 5/5 passed (my run, `cargo test -p tests`) | verify.txt §3 |
| Program deployed + executable, ID pinned | ✅ getAccountInfo: executable=true, BPFLoader owner | verify.txt §1; docs/devnet.md |
| Genesis character minted, explorer link | ✅ Core asset + non-transferable receipt, links pinned | docs/devnet.md §Genesis; verify.txt §4 (doer-observed, labelled) |

## Review notes
- **Scope:** diff confined to `programs/soulbound/` + `docs/devnet.md` (+ BUILD.md operator note). No scope creep. REQ-04 (oracle plugin) correctly deferred to Ticket 005 per ticket non-goals.
- **Quality:** 250 lines total. Canonical PDA with explicit bump; PDA signer seeds for the CPIs; error enum with typed codes. Tests assert *specific* failure codes (Custom(37) = NonTransferable; Custom(6000) = TraitVectorTooLong), not just "it errored" — REQ-07 also asserts failed-ix-leaves-no-state. This is stronger than the ticket demanded.
- **Doer honesty:** BUILD.md explicitly labels what was and wasn't verified, flags its own toolchain workaround, and refuses to edit the ticket (correctly left the amendment to me). The doer even mutation-checked REQ-05 (deleting the extension CPI fails the test) — a self-check, and I note it here as doer-reported, distinct from my verification.
- **Environment finding (adopted):** verification command in the ticket was wrong for anchor 1.2.x; amended to `cargo test -p tests`. Recorded in verify.txt.
- **Action for Tolu:** `sudo chown -R opadmin:opadmin ~/.config/solana && chmod 600 ~/.config/solana/id.json` — deploy authority keypair is root-owned (BUILD.md §8). Devnet-only key; never commit.

## Findings requiring action
None blocking. Future tickets (005+) should reuse the docker runner + keep the split rust-version pins; BUILD.md documents both.

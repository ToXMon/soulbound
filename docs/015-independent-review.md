# Ticket 015 independent review

Date: 2026-10-31
Reviewer / POC: AdaL; project owner Tolu
Commit reviewed: `69501b964c084f91791ceecb7ca7764fdfb5f586`

TL;DR: CLOSED as an incremental delivery, using the owner's explicitly offered closure option. Live traits, born-stage display and original/tampered proofs pass independent verification. A follow-up `pnpm build` passes on the current mixed checkout. Full acceptance remains deferred: cost/receipt writers, an actual trait-change demonstration, the real doer transcript and clean-revision build provenance are still outstanding.

## Outcome

PASS / CLOSED for the incremental delivery: observed live traits, born-stage display, original/tampered proof flow and honest unavailable panels. This does not pass REQ-71, REQ-62 or the deferred checks below. The owner offered this incremental closure option after the initial review; no missing criterion is silently waived.

No implementation files, tickets, REQs, decision log or audit files were changed during this review. The review is recorded in `docs/`; the owner remains responsible for packaging the real redacted doer transcript under `audit/015-life-page/`. Only this review document is included in the review commit. No push is authorized.

## Independent observations

| Check | Observed result |
| --- | --- |
| `node --test agent/scripts/*.test.mjs` | 80 tests: 79 passed, one opt-in live test skipped, zero failures |
| `node --env-file=agent/.env agent/scripts/life.test.mjs --live` | 11 passed, zero failures; live service-independent readback and proof checks |
| Live readback | Stage born, four Core Attributes, genesis vector equals current vector, two sealed public memory IDs |
| Live proof function | Valid 46 ms; tampered invalid 51 ms; confirmed slot 517146097 |
| Browser original-memory click | VALID, 195 ms click-to-result; confirmed slot 517146193 |
| Browser tampered-copy click | INVALID, 312 ms click-to-result; confirmed slot 517146237; prominent red alert in the memory panel |
| Browser console after both clicks | Zero collected errors or warnings |
| `curl -s localhost:3000/life \| grep -c 'data-req-71'` | 1; proves panel presence only, not functioning cost data |
| 1920×1080 browser | No horizontal overflow: scroll width 1920. Tampered-result page height 1262, so lower content requires scrolling |
| Initial `pnpm build` | FAIL; webpack syntax error in untracked `app/components/living-portrait/signal.ts:13`, imported by modified `app/app/page.tsx` |
| Follow-up `pnpm build` | PASS on the current mixed checkout; agent and app build, lint/type checks and page generation complete |

The initial build failure was outside the committed ticket 015 diff. On the owner's follow-up, `pnpm build` was rerun independently and PASSED: agent build, Next.js production compilation, lint/type checks and page generation completed, including `/life` and `/api/life/proof`. The earlier syntax error no longer reproduces. Portrait changes remain uncommitted, so this establishes a successful build of the current mixed checkout, not exact clean-revision provenance for 69501b9. No portrait files were edited or isolated by the reviewer.

## Acceptance limits

- Traits are read live and the birth vector is obtained from the identity-bound birth transaction. No actual post-birth vector change exists in the observed state. Changed-value highlighting was reviewed in source; a live changed-vector demonstration remains unverified.
- Stage is honestly shown as born. Future stage advancement is not implemented here.
- Original and tampered proof interactions both meet the two-second target in this observed run. This is not a universal latency guarantee.
- Model/cost and receipts correctly render unavailable placeholders. There is no usage or receipt writer to exercise; harness/page equality, paid/unpaid append behavior and facilitator-kill acceptance remain unverified.
- The doer's offline, mobile and unchanged-store observations in `/tmp/sb015-verify.txt` were read but were not independently reproduced in the browser. Automated fixture checks did pass for unchanged storage and private-canary exclusion.
- No physical projector, microphone, speech or payment test was performed.

## Scope and evidence

The committed implementation stays within `app/` and `agent/` and adds no dependency. Source inspection found a loopback read service, read-only RPC calls, explicit public memory projection, fresh committed-root checks and a disposable tampered proof copy. The voice inference path is not changed by this commit.

`audit/015-life-page/` is absent. `/tmp/sb015-verify.txt` explicitly describes itself as an execution summary, not a full session export. The commit trailer names a doer-session evidence path that is not populated. REQ-72 evidence remains incomplete; a summary must not be relabeled as a session transcript.

Browser screenshots retained in this review session:

- Original verdict: `/Users/tolushekoni/.adal/sessions/fb360f36-1c38-409d-9f0d-ca1ee58c162a/screenshots/shot-1793452503-c63bdb.jpg`
- Tampered verdict: `/Users/tolushekoni/.adal/sessions/fb360f36-1c38-409d-9f0d-ca1ee58c162a/screenshots/shot-1793452515-acd03b.jpg`
- 1080p full-page tampered state: `/Users/tolushekoni/.adal/sessions/fb360f36-1c38-409d-9f0d-ca1ee58c162a/screenshots/shot-1793452522-08d839.jpg`

## Deferred checks after incremental closure

| Remaining check | Follow-up responsibility and completion evidence |
| --- | --- |
| Clean-revision build provenance | AdaL reruns `pnpm build` after portrait work is committed or isolated; record the exact revision and checkout status. Current mixed-checkout build passes. |
| Real doer transcript / REQ-72 | Doer exports the actual session; owner redacts and packages it under `audit/015-life-page/`. A summary is not a substitute. |
| Model/cost / REQ-71 | Doer connects the real usage writer under an authorized ticket; AdaL compares observed per-turn model and cost values with the harness. |
| Receipt feed / REQ-62 and payment failure | Ticket 010 supplies real receipts; AdaL checks append behavior and an unpaid receipt during facilitator failure while conversation continues. |
| Actual trait change | When evolution is available, observe a genuine on-chain vector change and confirm the genesis/current highlight in the browser. |

These checks remain open. Incremental closure does not authorize new implementation, inference charges, transactions or changes to the human-authored requirements.

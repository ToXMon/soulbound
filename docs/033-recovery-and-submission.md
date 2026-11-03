# Recovery and submission readiness

Date: 2026-11-02
POC: Tolu Shekoni
TL;DR: The earlier claim that five deployments were dead was incorrect. Direct TLS and health checks show transport, app, Vox and the older storage service reachable. One obsolete unreachable deployment was closed. Submission documentation and live acceptance still need completion.

## Infrastructure observed today

| Deployment | Observation | Action |
| --- | --- | --- |
| 28831027 | Provider management endpoint timed out; obsolete deployment | Closed under owner's cleanup instruction; chain list confirms closed |
| 29314839 | Provider reports ready; HTTPS endpoint returns 200 | Preserved; not a confirmed dead lease |
| 29328467 | Container accessible; signaling returns 401; direct TURN TLS handshake succeeds with trusted TLSv1.3 certificate | Preserved; app credentials already match transport keys |
| 29328579 | Lease-shell reported service failure, but public forwarded `/health` returns 200 | Preserved pending actual synthesis test; do not equate lease-shell failure with endpoint failure |
| 29328587 | Container accessible; local app returns expected 401; private memory volume present; worker processes present | Recreated app tunnel; preserved memory |

Close transaction: `8B3B51D4FC5B531A120448E411D410379DFD3612361B300915CA7DEB07F4EE99`, confirmed code 0. Fee: 11600 uakt (0.0116 AKT). Initial attempt was rejected for insufficient fees. The close settled the remaining 38940 uact to the provider; no ACT refund is claimed.

Current temporary app URL: https://sega-outdoor-civic-individually.trycloudflare.com/

Access credentials remain in private local storage, never in this document. The URL renders the Warden room behind operator authentication. It is a temporary tunnel, not a stable public judge deployment. No transport restart or credential rotation was necessary to establish current health. A successful TLS handshake is not yet proof of media or end-to-end voice.

## Local verification today

- Agent TypeScript build: passed.
- TTS, pipeline and life scripts selected: 30 passed, 1 skipped, 0 failed.
- Portrait/Warden suites: 57 passed, 0 failed.
- Vision and sidecar suites: 32 passed, 0 failed.
- App TypeScript check: no reported errors.
- Isolated production app build: passed. Temporary generated TypeScript include removed.
- `git diff --check`: passed at verification time.
- Gitleaks audit-directory scan: exit 0.
- Gitleaks Git-history scan: exit 1 on one generic-api-key match in `docs/005-committer-runbook.md:101`. Inspection shows an ordinary prose sentence describing batch validation, a false positive, not a credential. The scanner finding is retained rather than silently suppressed. A broad directory scan also traversed ignored/private/generated files; that run is not a clean submission-file scan.

## Fresh live voice check: blocked by Meta billing

The recovered browser joined the room and received the agent audio track. No physical microphone or camera was activated. A short segment of the credited prerecorded speech fixture was published, but no transcript or meaningful reply audio was observed. Worker logs identify the startup failure: `Muse VT handshake rejected: Billing verification failed`.

This is not a successful voice verification. The UI's Connected/playing labels establish transport/track state only. The owner must resolve Meta Model API billing/account verification for the configured credential, then repeat the full voice test. Do not switch inference providers, fabricate a reply, or repeatedly restart healthy transport to hide this failure. No payment method or account billing settings were changed.

The current private app and transport credentials match. Transport was not restarted or rotated because its TLS and signaling checks passed. Worker restart is deferred until the account blocker is resolved; a restart alone does not repair a rejected provider handshake.

## Heartbeat and the three-minute video

Heartbeat is locally tested, not live accepted: see `007-independent-review.md`. It requires a separately approved devnet program upgrade and reward-mint/vault setup before a genuine live crank can be claimed. Do not add a mocked crank or a simulated explorer mutation to the working demo.

Recommendation: film working conversation, a recalled sealed memory if it passes rehearsal, and a genuine inclusion proof plus tamper rejection. Describe memory-root history growth separately from life-stage or trait mutation. Keep heartbeat out of the primary recording until its live transaction and explorer readback exist. This recommendation does not waive or edit architecture requirements; any scope downgrade remains the owner's decision.

## Applying the organizers' feedback to SOULBOUND

The quoted advice was for other projects. SOULBOUND needs reproducible public-repo instructions, rights-cleared inputs, clear sample-data labels, and actual Meta inference in its live core. It does not need signing clips or mood profiles.

- The offline memory demo uses explicit synthetic facts and a fake extractor. Label it as an offline mechanics test, never a Meta inference result or on-chain proof.
- `agent/fixtures/hello-two-speaker.wav` is prerecorded borrowed speech, credited in `built-vs-borrowed.md`. It is a test input, not a live user conversation or generated output.
- `app/fixtures/plant-synthetic.png` is a synthetic plumbing fixture. It does not establish useful object recognition.
- Use an owner-created non-sensitive object image or separately licensed sample for vision acceptance. Do not substitute a fixture caption for real SAM/Spark output.
- Never publish operator passwords, API credentials, personal memories, signing keys or runtime manifests.
- Show the real working flow in at most 180 seconds. Label prerecorded input, sample facts, edits and fallback footage. Do not fabricate latency, payments, privacy guarantees or life-stage transitions.

## Fresh proof-page verification

The recovered `/life` page read Solana devnet at confirmed slot 517918177 and showed life stage `born`, unchanged genesis personality vector, and sealed epoch-1 memories. Clicking Verify inclusion returned `VALID — inclusion verified against the committed Solana root`, 1459 ms from click, confirmed slot 517918243. Clicking Try a tampered copy rendered `INVALID — proof does not match the committed root`, visually confirmed in the browser. No chain transaction or private-memory content disclosure was needed.

The offline sample command in the revised README was also executed successfully: three synthetic records, correction version 2, persistence across reopen, local proof verified and tamper rejected. This is a fake-extractor mechanics check, not live inference or a chain commit.

README and built-versus-borrowed documentation were updated under Ticket 012's documentation scope. No implementation changes, commits or pushes were made in this recovery session. The temporary generated app TypeScript include was removed after build verification.

## Remaining submission gates

1. Complete fresh synthetic end-to-end voice verification, followed by owner mic/speaker rehearsal.
2. Fix and live-verify camera-frame transport before claiming useful vision.
3. Rehearse sealed-memory recall and current-chain inclusion/tamper checks.
4. Triage secret findings; scan intended submission files, not just audit.
5. Correct README setup and built-versus-borrowed status; test a fresh public checkout with judge-owned credentials.
6. Review and commit work in scoped ticket changes. Many essential source files remain untracked; local success is not public-repo reproducibility.
7. Record and check the final video, rights disclosures and claim-to-proof links. Do not claim the submission is ready before these gates pass.

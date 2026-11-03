# Ticket 008 independent review

Date: 2026-11-01
Reviewer / POC: AdaL; owner Tolu Shekoni
Implementation worktree: `.agents/worktrees/ticket-008-eyes-sam` (`worktree-ticket-008-eyes-sam`)

## Verdict

**Local implementation PASS; live/demo acceptance remains OPEN.** The explicit browser trigger sends the versioned frame envelope expected by the worker and accepts only responses matching the outstanding trigger ID. The worker reports correlated failures rather than leaving the browser waiting, marks results durable only after successful memory+sidecar linkage, and uses trigger-specific memory provenance so same-trigger retries are idempotent while repeated looks remain distinct. The private sidecar remains separate from the frozen Ticket 004 memory schema and Merkle protocol. SAM and Spark SDK retries are disabled; the live harness requires an explicit `--approve-live` per invocation and performs exactly one SAM+Spark pair per invocation.

The app now renders a bounded SVG outline derived from the actual SAM parser mask, in the correlated response only. The outline carries its parser-derived source-frame bounds; the worker rejects overlays unless the bounds are ordered and their width/height exactly match the local raster. The browser repeats those checks and positions the SVG using those source bounds—not the observation bbox. If conversion or validation fails, the UI explicitly falls back to a bounding-box highlight. Tests verify offset geometry, mismatch fallback, transport bounds and that mask paths never enter the memory record, extraction, sidecar, logs, or demo report.

Independent agent build, **31** compiled agent vision/sidecar tests, app typecheck, production build and **10** compiled browser-trigger tests pass. The offline synthetic harness exits 0 with `live:false`, `live_model_calls:0`, valid observation record/extraction mapping, and `frame_discarded:true`. Running `vision-demo --live` without `--approve-live` exits 2 with a blocked message before any billable request. The only approved live SAM/Spark pair was already used and returned no mask and no Spark observation. There is still no successful live object commentary, browser-camera/LiveKit session, or subsequent real object recall. Therefore Ticket 008’s live acceptance criteria are **not satisfied**, and no claim of a successful live vision demo should be made yet.

The local implementation is committed on isolated branch `worktree-ticket-008-eyes-sam` as `1b05bab` (`feat(008): eyes-sam explicit-trigger vision with SAM 3.1 + Spark observation`). The worktree is clean. No push was made. Main checkout changes for Tickets 007 and 022 were not included. This closes the local implementation phase only; full live acceptance remains open.

## Independent verification

- `pnpm --dir agent build`: PASS.
- From `agent/`: `node --test dist/vision/*.test.js dist/memory/vision-sidecar.test.js`: **31 passed, 0 failed**. Includes strict envelope validation, sender policy, concurrency gate, frame zeroization, fake SAM/Spark flow, synthetic parser-derived SVG mask overlay bounds, offset source-frame placement, dimension/bounds mismatch fallback, response-only overlay privacy, metadata-only success/failure packets, durable/transient flags, trigger-specific source IDs, sidecar retry rollback/reopen/corruption/bounds, no-SDK-retry enforcement, and failure handling.
- `npx tsx agent/scripts/vision-demo.ts --synthetic-fixture --out /tmp/adal-008-synthetic-final.json`: PASS; report marks zero live calls and `live_acceptance_unverified: true`.
- `npx tsx agent/scripts/vision-demo.ts --live --fixture app/fixtures/plant-synthetic.png` without `--approve-live`: intentionally BLOCKED, exit 2, before inference.
- From `app/`: `pnpm exec tsc --noEmit`: PASS; `app/tsconfig.json` unchanged.
- `pnpm --dir app build`: PASS, including Next.js compile, lint/type validation and static-page generation.
- Browser-trigger tests: compiled `app/vision-trigger.ts` and `app/vision-trigger.test.ts` to a temporary directory using TypeScript NodeNext and ran the emitted test: **10 passed, 0 failed**. Tests cover trigger correlation, source-bounds alignment, and malformed-overlay fallback. Direct Node execution of the TS source does not resolve its `.js` module specifier; the test header documents the compile-then-run workflow.
- Local tests exercise a synthetic parser mask, not a live SAM mask. They establish overlay conversion and source-coordinate placement logic, not real object segmentation, live camera alignment, or useful model output.
- `git diff --check`: PASS.
- No additional model/API calls, wallet/RPC access, transactions, deployment, commit or push occurred during final verification.

## Local behavior verified

1. The user explicitly clicks **Look at this**. The browser captures one JPEG frame, stops the temporary camera stream, builds a bounded version-1 envelope with a fresh UUID trigger ID, publishes that envelope unchanged, and zeroes the browser frame buffer. No capture occurs before the click.
2. The worker validates the payload and requires a nonempty LiveKit participant identity. It admits connected participants under the owner-approved low-friction demo policy and permits only one in-flight observation per sender. This identity is self-asserted, **not owner authentication**.
3. The agent makes at most one SAM and one Spark call per accepted trigger; the Spark request uses the envelope’s validated MIME and strict structured output. When the parser can safely produce a mask outline, the response carries only a bounded SVG path, raster dimensions (maximum 1024 per side), and parser source-frame bounds. Path text is capped at 16,384 characters and restricted to SVG path-data characters. Both worker and browser require ordered finite-integer source bounds whose extents exactly equal the raster dimensions. The response never carries the original frame or mask bitmap.
4. A success response is correlated by trigger ID. It includes `durable: true` only after memory append and sidecar linkage; if memory is disabled, the response is explicitly `durable: false`. The UI labels those outcomes distinctly and renders the actual outline at its parser-derived source bounds only while the view is held. If there is no valid aligned outline, it explicitly labels the bounding-box fallback.
5. A post-trigger inference, persistence or sidecar failure emits only `{trigger_id, error}` with a closed set of stable error codes. No frame, model content or internal error string is included. The browser validates the matching trigger and shows a failure status rather than waiting indefinitely. Pre-trigger rejection and transport failure cannot always produce a correlated response.
6. Memory source IDs are `vision:<trigger_id>:<frame_hash>`. This makes replay of the same trigger idempotent while repeated explicit looks at identical pixels produce distinct records. The sidecar is metadata-only, character-namespaced and bounded. It atomically replaces its own file and rolls back its in-memory staged entry if that write fails; SVG outline data is excluded from the record, extraction, sidecar, logs and demo report.

Memory append and sidecar write are sequential transactions; they are not atomic together. A process crash between them can leave an unlinked memory record. A retry of the same trigger can find the exact trigger-specific source ID and repair the sidecar link. The generic memory record still does not store mask reference or observation time; those fields live in the approved private sidecar. No generic schema or Merkle commitment changes were made.

## Live test result and spend

The one authorized SAM/Spark test pair is spent. Do not make another live call without a fresh explicit budget approval.

- SAM 3.1 was called once on `app/fixtures/plant-synthetic.png` (179 bytes, 96×64, a uniform green field); it returned **zero masks**.
- Spark 1.3 non-contributor was called once with the empty-mask reference and returned no observation content. No retry was made.
- Reported SAM charge: **$0.0025**. Spark usage/cost was not returned; its exact charge is **unknown**.

This was a truthful failed demonstration, not successful segmentation or object recognition. Offline tests use injected fakes and do not establish live model behavior.

## Remaining acceptance gaps

- No useful object-bearing fixture has received a live SAM/Spark pass; correct mask and commentary are unverified. The local UI can render parser-derived SVG mask outlines, but the current synthetic tests do not establish a useful live mask or alignment.
- The actual webcam → LiveKit room → agent → browser result path was not exercised with a camera and running agent.
- No real observation has been written and later recalled through conversation. The mapping and storage path are unit-tested only.
- The current token endpoint signs a caller-supplied LiveKit name. Any connected participant can explicitly invoke the demo; this is not authenticated owner-only vision.
- Cross-file crash atomicity is not provided: a crash between memory append and sidecar link may leave an orphan record, although failure is not reported as success and same-trigger retry can repair the link.

## Exact next steps for full demo acceptance

1. The owner approved a total live-test spend ceiling of **$5**. This checkout had no `agent/.env`, `app/.env`, or process-environment API/LiveKit credentials during verification; therefore no live call or room rehearsal was attempted. Configure those values locally only; never add them to the repository or send them in chat.
2. Select a locally generated/public scene with one clear object. `plant-synthetic.png` is a uniform field and already returned zero SAM masks. No personal photo is needed.
3. During the demo, attach to visible session `sb008-visible` with `tmux attach -t sb008-visible` if it is running. The session used the currently available open-weight DeepSeek V4 Flash to add `maxRetries: 0` and the explicit live confirmation guard. Use exactly one SAM 3.1 call plus one Muse Spark 1.3 non-contributor call; there are no automatic SDK retries. Stop before aggregate spend can exceed $5. Prior test SAM spend was reported as $0.0025; Spark spend is unknown. If remaining budget cannot be checked, do not call.
4. In the actual browser/LiveKit path, verify a nonempty mask with source-bounds-aligned overlay, useful structured commentary, durable memory+sidecar linkage, and later “what did I show you?” recall. Preserve redacted metadata/cost only; do not log raw images or base64.
5. AdaL independently reviews the live evidence. Keep participant-demo/not-owner-authenticated visible.
6. The local implementation commit is already present; after live acceptance is finished and reviewed, record a separate evidence/review update. No push was authorized.

The local implementation and verification are complete. **Full live vision behavior remains unverified**, as detailed above.

## Owner disposition — 2026-11-01

Tolu directed that live testing happen later and authorized closing Ticket 008 now. The ticket is **closed as an incremental local implementation delivery** on the strength of the local implementation PASS; live SAM/Spark object commentary, browser-camera/LiveKit exercise, and subsequent real recall are explicitly deferred, not represented as passed. The prior one-pair live-call approval is spent, and this closure does not authorize further model calls.

Implementation commit `1b05bab` remains on isolated branch `worktree-ticket-008-eyes-sam`; it has not been merged or pushed. Integrate it separately, preserving the unrelated changes in the main checkout. Reopen or track live acceptance as a follow-up when the owner approves a fresh bounded test.
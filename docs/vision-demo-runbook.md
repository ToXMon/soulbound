# Ticket 008 vision demo runbook

**Date:** 2026-11-01 · **POC:** Tolu Shekoni

**Status:** Local implementation is committed and independently verified. Live SAM/Spark acceptance is still open: the only prior pair returned no mask and no observation. The owner approved a new total spend ceiling of **$5**, but the current checkout lacks private API and LiveKit credentials, so no additional call or room rehearsal has occurred. Do not present a successful object-recognition result as observed until the new bounded live test passes.

## What the current local path does

1. Join the SOULBOUND LiveKit room and click **Look at this**. No camera capture or vision request happens before the explicit click.
2. The browser captures one JPEG frame, stops the temporary camera tracks, and sends a bounded versioned envelope with a new trigger ID. The app and worker correlate the response to that ID.
3. The worker runs one SAM 3.1 segmentation and one non-contributor Muse Spark 1.3 observation per accepted trigger. Per-participant requests are serialized. Worker failure is returned as a small correlated error code, not an indefinite wait.
4. When SAM’s actual parser output yields a safe mask outline, the worker sends a bounded SVG path, raster dimensions, and that mask record’s source-frame bounds in the transient correlated response. The worker and browser require finite ordered integer bounds whose extents exactly match the raster dimensions. The UI positions the raster-local path using those parser-derived bounds. If bounds, dimensions, or SVG are invalid, it falls back to an explicitly labeled bounding-box highlight.
5. The mask overlay is temporary UI data. It is not written to the memory record, sidecar, demo report, logs, or Merkle data. **Discard view**, a new look, or disconnect clears it. The memory store retains the observation text/frame-hash link; the private sidecar retains the additional mask reference, timestamp, trigger ID and memory-record ID.

## Access and privacy boundary

- Any connected room participant may explicitly trigger one frame, as approved in `docs/008-scope-amendment.md`. This is **participant demo access, not owner authentication**. The LiveKit identity is a self-asserted name; do not describe it as proof of owner identity.
- No continuous video, face recognition, or tracking is implemented.
- The browser still is local transient UI state; raw frame bytes are zeroed after send. The worker zeroes its frame buffer after processing.
- Persisted sidecar data is metadata-only and private/local. It is never committed on-chain. The generic Ticket 004 memory schema and Merkle protocol remain unchanged.
- Memory append and sidecar write are separate file transactions. If sidecar linking fails, the worker does not publish success and same-trigger retry can repair the link. A process crash between writes can leave an orphan memory entry; do not claim cross-file atomicity.

## Local setup and rehearsal

1. Configure the existing local environment files; never add secrets to the repo. Use the existing LiveKit app/worker configuration and a valid `MODEL_API_KEY` (or `META_API_KEY`) for a live inference run. `VISION_CHARACTER_ID` is used when memory is disabled; with `MEMORY_ENABLED=true`, the configured memory character ID is used. For saved-memory UI status, configure the existing private `MEMORY_STORE_PATH`, `MEMORY_OWNER_ID`, and `MEMORY_CHARACTER_ID` values.
2. Start the app and worker using the existing project commands from the repo root:

   ```sh
   pnpm dev
   pnpm --filter agent start
   ```

3. Open the app in a browser with camera permission and join the configured LiveKit room. Confirm the idle copy says no camera/network action is occurring before click. Click **Look at this** once. Confirm the page either shows the returned object summary and a mask-outline highlight, or truthfully shows the bounding-box fallback. Click **Discard view** and confirm the still/highlight clears.
4. If inference or persistence fails after the click, expect a generic failure status; the UI must not claim the result was saved. A durable result says it was saved to private memory; with memory disabled, the UI explicitly says it was not durably saved.

This app/camera/LiveKit rehearsal has **not yet been observed by AdaL**. Unit tests and a production build do not substitute for this live room check.

## Offline verification commands

From the repository root, in the Ticket 008 worktree:

```sh
pnpm --dir agent build
(cd agent && node --test dist/vision/*.test.js dist/memory/vision-sidecar.test.js)
(cd app && pnpm exec tsc --noEmit)
```

The browser trigger test has a `.js` module specifier, so compile it with the app’s TypeScript compiler and run the emitted JavaScript without changing `app/tsconfig.json`:

```sh
cd app
out=$(mktemp -d /tmp/soulbound-vision-trigger.XXXXXX)
pnpm exec tsc --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --outDir "$out" --rootDir . --skipLibCheck \
  app/vision-trigger.ts app/vision-trigger.test.ts
node --test "$out/app/vision-trigger.test.js"
rm -rf "$out"
cd ..
pnpm --dir app build
git diff --check
```

These offline suites use synthetic parser fixtures and fakes. They do not establish that SAM finds an object in a live image, Spark returns a useful observation, or the browser-camera room path works.

## Live acceptance gate — currently blocked

The previously approved one-pair test was already spent on a 96×64 uniform green PNG: SAM returned zero masks; Spark returned no observation content. Reported SAM spend was $0.0025; Spark usage/cost was unavailable. Do not retry without a new explicit call-budget approval.

To finish full demo acceptance:

1. Choose a locally generated/public scene with one clearly visible, non-sensitive object. Do not use a personal photo without separate approval.
2. Obtain a fresh explicit budget for at most one SAM 3.1 call and one Muse Spark 1.3 non-contributor call. No automatic retry.
3. In the actual browser/LiveKit room, verify a nonempty mask, useful correct object commentary, durable memory+sidecar linkage, and a later “what did I show you?” recall. Save only redacted metadata/cost/evidence; never log frame bytes/base64.
4. AdaL independently review the resulting live evidence. Keep the participant-demo/not-owner-authenticated boundary visible.

**Do not call the feature fully demo-ready or Ticket 008 live-accepted until that gate passes.**
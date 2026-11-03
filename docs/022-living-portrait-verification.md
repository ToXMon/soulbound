# Living portrait verification

Date: 2026-10-31
POC: Tolu Shekoni
TL;DR: Production build, TypeScript and 52 tests pass. Approved portrait imported unchanged. Browser fixture verified energy/silence/interruption and fallback behavior. Live VoxCPM2 synchronization and an approved rig remain unverified.

## Independently observed

- `pnpm --filter app build`: PASS after stopping competing task dev processes. Compilation, type validation, static generation and build traces completed. Existing multiple-lockfile workspace-root warning remains.
- `pnpm --filter app exec tsc --noEmit`: PASS.
- `node --experimental-strip-types --test app/components/living-portrait/*.test.ts`: 52 tests, 9 suites, 52 PASS, 0 FAIL. Includes signal, cue, playback gate, morph mapping and analyzer lifecycle checks.
- `git diff --check`: PASS.
- Source and imported WEBP SHA-256 both `685ba1753df56e9e02f9e4dd6b626a09ca1bc64bda4bd9482940dd71c95fcc4c`.
- Home page renders approved likeness and `Reactive portrait · 2.5D` label with existing Join room, Start audio, life/proof link and diagnostics.
- Synthetic fixture: one audio element, paused=false, muted=false, readyState=4; measured energy 0.067 and Speaking. After exact silence: energy 0.000, paused=false, Ready. Restoring tone: energy 0.398, Speaking. Interrupt/remove track: energy 0.000, paused=true, Ready.
- Missing GLB request: image remains visible with explicit model/controls/WebGL fallback disclosure. WebGL-disabled policy: fallback image complete and WebGL-disabled text observed. This does not verify actual context loss on a valid rig.
- Reduced motion: static portrait mode observed. Mobile production page at 390px: image complete, 2.5D label present, document width 390px (no horizontal overflow).
- Production `/portrait-check` renders not-found output rather than synthetic controls.
- Source review: analyzer taps one selected agent track through zero gain, existing HTMLMediaElement remains audible, cleanup never stops a shared track. Optional rig renderer validates controls, uses live refs, and disposes resources and late loads.

## Limits

No approved textured GLB with jaw/blink controls, playback-aligned word timestamps or timed mouth/viseme cues supplied. Rigged likeness/movement, actual valid-rig WebGL context loss, live VoxCPM2 playback synchronization, physical speaker timing, autoplay failure on every browser and latency regression measurements are NOT independently established. Synthetic tone observations are not a live Vox test. Listening/thinking use documented inferred LiveKit state boundaries. No new backend state protocol or TTS path was introduced.

## Delivery

Feature changes remain uncommitted; no push performed. Unrelated work was preserved. Build preview served at http://localhost:3022 during verification. Usage and missing-asset notes: `app/components/living-portrait/README.md`.

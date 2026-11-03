# Ticket 022: Living portrait

Date: 2026-10-31
POC: Tolu Shekoni
TL;DR: Embed the approved portrait in the existing voice UI; analyze agent playback without changing the audio path. Ship honest 2.5D mode and an optional approved-GLB renderer.

## Intent

Implement the user's reactive-avatar request in the existing Next.js React/TypeScript app. Keep controls, transcript, diagnostic exports and the life/proof link. AdaL verifies independently. This task is explicitly authorized by the current user request.

## Implements REQs

Preserve REQ-40/41 (voice latency and VoxCPM2 path), REQ-43/70 (no new capture or on-chain media), REQ-71 (keep model/cost visibility). The additional portrait behavior below comes from the current user request; it does not add or edit architecture REQs.

## Files in scope

- `app/app/page.tsx`: integrate component and real conversation/remote playback state only. Preserve the existing uncommitted life-link change.
- New `app/components/living-portrait/` files for typed API, rendering, audio analysis, module-scoped styling, tests and usage documentation.
- New `app/assets/soulbound-avatar-meta-preview.webp`, copied byte-for-byte from `/Users/tolushekoni/soulbound-avatar-meta-preview.webp`. Explicit import required before UI use.
- `app/package.json`, `pnpm-lock.yaml`: only minimal Three.js runtime/types if necessary for optional GLB mode; reuse installed React/LiveKit.
- New `app/app/portrait-check/page.tsx`: development-only acceptance fixture, inaccessible in production. Clearly label synthetic audio/test state; never claim a live Vox test.
- No other files. Do not touch existing untracked work, secrets, agent backend, chain code, audit, REQs, master state or other tickets.

## Non-goals

No replacement site, voice transport, TTS, browser speech synthesis, image generation, mouth stretching, invented rig, fabricated visemes/timestamps, expression gimmicks, microphone analysis or mixed-room analysis. No intentional delay before speech. No original source photograph. No global styles.

## Constraints and implementation

1. First import the approved local generated WEBP asset into app/assets, using a binary-safe copy, then reference it via a static module import. Preserve the exact approved face, clothing, skin, hair, beard and cinematic teal/dark appearance.
2. Export a typed embeddable LivingPortrait interface for state (`idle`, `listening`, `thinking`, `speaking`, `disconnected`, `error`), agent MediaStreamTrack plus its EXISTING playback HTMLMediaElement, portrait asset, optional approved textured GLB/control mapping, optional timed mouth cues tied to a browser playback clock, interruption/reset signal and reduced-motion support.
3. Separate renderer, transport adaptation and audio analysis. Analyzer is a silent side tap: MediaStream containing ONLY selected agent remote track -> source -> analyzer (no audible destination). Keep the current single LiveKit attached element audible. Never stop shared tracks. If platform requires a destination for analysis, zero-gain connection only. Analyzer failure must never affect playback. Do not await image/model/analyzer readiness before play.
4. Browser `playing`/`pause`/`waiting`/`stalled`/`emptied`/`ended`/error, element muted/volume, track enabled/muted/end, context suspension and disconnect must gate energy. Smooth RMS envelope with threshold, fast attack and softer release, bounded outputs. Reset immediately on interruption, removal, blockage, disconnect and unmount; prevent stale callbacks after async operations. No speech animation from reply text or server timestamps.
5. Select only remote agent audio (LiveKit participant kind Agent, with explicit existing agent publication name `soulbound-voice` fallback if necessary). Never analyze other participants. Keep remote playback behavior intact. Agent state is independent of Ticket019 diagnostic phase. Use LiveKit local participant active-speaker state for attentive/listening and speech-end/thinking where supported; do not analyze mic. Do not pretend precise backend generation-state events exist. Document any inferred state boundary. Track subscription/unsubscription/mute and connection failure reset state. Lifecycle cleanup must remove listeners and not stop shared tracks.
6. 2.5D fallback: responsive head/shoulders image, dark panel, restrained teal halo responding to actual playback energy, tiny whole-image depth/float/tilt, no deformed face. Listening and thinking clearly differ with readable labels. Neutral disconnected/error. Optional pointer movement bounded and subordinate to state. Clearly label `Reactive portrait · 2.5D` and explain missing approved rig.
7. Optional rigged mode: lazy-load Three.js/GLTFLoader only when approved textured GLB supplied, validate configured jaw/blink controls, render with bounded jaw energy, natural infrequent blink and small head turns. Only supplied timed mouth/viseme cues on supplied playback clock may override approximate energy jaw; reject malformed/out-of-range cues. Never infer visemes from loudness. Clean renderer, frames, geometry/materials/textures and async load results. Missing/bad model, controls or WebGL/context loss -> approved static image or 2.5D fallback, accurate mode label. No test model represented as approved likeness. Reduced motion renders static approved image and retains readable status/audio.
8. Keep transcript below/beside unchanged. No word highlighting without supplied playback-aligned real word timestamps. Explicitly document absent GLB, visemes and word timing.
9. Reduced motion, responsive/mobile sizing and accessibility are mandatory. Component styles scoped via CSS module. No dependency on GPU or asset readiness for speech.
10. Add deterministic tests for smoothing/silence/bounds/reset, cue validation, playback gating and lifecycle using platform tooling where possible. Add dev-only fixture for visual/state checks and user-activated synthetic remote-track playback tests; clearly distinguish fixture from product. Include pause/block/reset, missing model/WebGL/reduced motion controls usable in browser. Avoid fixture bundles in production.

## Acceptance criteria

- [ ] Exact asset imported and displayed without unrelated images.
- [ ] Existing controls/transcript/life link/diagnostics preserved.
- [ ] Typed component with separate analyzer and optional rigged renderer.
- [ ] Agent-only energy gated by actual browser playback; silence decays, blockage/interruption/removal/disconnect reset.
- [ ] Single audible playback path; shared tracks never stopped.
- [ ] Missing rig/WebGL/reduced motion produce usable accurate fallback.
- [ ] Rigged controls, blinking/head turn and supplied cue validation implemented; live rig remains unverified without approved asset.
- [ ] Cleanup handles unmount and asynchronous initialization/loading.
- [ ] Build/typecheck/test pass; any unavailable live Vox/rig verification explicitly labeled.
- [ ] Documentation lists missing assets/timing and real state boundaries.

## Verification

Run from repo root:

```bash
pnpm --filter app exec tsc --noEmit
pnpm --filter app build
node --experimental-strip-types --test app/components/living-portrait/*.test.ts
git diff --check
```

AdaL additionally inspects exact imported asset hashes, real rendered home page/mobile/reduced motion, fixture playback vs silence/interruption/blockage/missing GLB, and source for single playback path and cleanup. Synthetic fixture checks cannot prove live VoxCPM2 synchronization or physical speaker output.

## Execution

Use pi CLI as the project doer, with the verified available open-weight `surplus/kimi-k3`. Keep one-ticket scope. Do not commit the pre-existing dirty page change; if safe partial commit is unavailable, leave changes uncommitted and report that rather than committing unrelated work. Do not push. Report tests actually run and missing verification honestly. Do not write an independent review or edit audit files.

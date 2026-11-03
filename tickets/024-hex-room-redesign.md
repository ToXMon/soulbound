# Ticket 024: HEX-inspired LiveKit room

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Redesign the demo room with HEX's cinematic black stage, floating expressive graphic, tactile keycap, and oversized typography. Preserve the real LiveKit conversation and the approved portrait.

## Intent

Execute the user's requested redesign using the inspected HEX reference and the clone-anywebsite workflow. See `docs/hex-room-clone-plan.md` for observed evidence and the adaptation direction. This is visual work on the demo spine; transport and product inference remain unchanged.

## Implements REQs

Preserve REQ-40/41 (voice and playback), REQ-43/70 (explicit capture and media privacy), REQ-60 (no payment gating), REQ-71 (retain available model visibility and life/proof link; never fabricate cost data). Additional design behavior comes from the user's request and does not amend REQs.

## Files in scope

- `app/app/page.tsx`: visual JSX, scoped class integration and presentation state only. Preserve existing uncommitted changes and all connection, diagnostic and playback logic.
- New `app/app/room.module.css`.
- `app/components/living-portrait/LivingPortrait.tsx`, `types.ts`: optional visual variant only; preserve analyzer and playback gates.
- New `app/components/living-portrait/renderer-soul.tsx`, `soul.module.css`, and focused tests if useful.
- New `docs/024-builder-plan.md`, `docs/024-builder-report.md`, `docs/024-third-party-notices.md`.
- No other files. No dependency changes, backend, chain, secrets, life page, global styles, existing portrait asset, analyzer, playback gate or other renderer modifications.

## Non-goals

No full HEX narrative simulation, copied mascot/branding/audio/cards, explosions, prerecorded speaking demo, generated audio, fake memories/receipts/costs, actual GLB rig or phoneme lip sync. Do not call product inference or read environment files. Do not connect microphones during implementation.

## Constraints

- Execute as pi, the project doer, with the live-listed `surplus/claude-opus-5.5`, explicitly requested by Tolu for this highly creative task. AdaL independently evaluates. First write the builder plan and STOP; implementation requires the subsequent explicit kickoff.
- Follow `AGENTS.md`, the doer skill and clone plan. This ticket authorizes only the files above.
- Existing checkout is dirty. Never reset/stash/revert or commit unrelated work. No commits or pushes for this ticket: the room and portrait predate this task and cannot be safely committed as a clean one-ticket change.
- Reuse React/CSS modules/platform SVG or Canvas2D; no runtime dependency or external network needed. Prefer an original small SVG/CSS procedural glossy soul head over copying the 170KB scene runtime. Reference source can inform the approach. If code is copied retain its MIT notice.
- Preserve approved portrait as an accessible alternate visual mode, using its unchanged existing renderer. Procedural soul is default, explicitly labeled audio-reactive/approximate; never claim it is an approved likeness rig.
- Expressive graphic: glossy dark oval with depth/specular rim, original eyes/brows/mouth, restrained teal accent, soft floor shadow, smooth bounded gaze/float and infrequent blinking. Disconnected/error neutral; listening attentive; thinking distinct; speaking mouth aperture and halo exclusively driven by the existing measured gated energy, never text or a timer. No viseme claim. Reduced motion freezes nonessential motion and retains readable state.
- Keep the existing single audible path. No new AudioContext, capture, audio elements, playback or track lifecycle manipulation. Analyzer failure cannot block speech. Preserve agent-only selection and interruption/reset behavior.
- Room: full-width nearly black canvas, restrained header with proof link, large centered graphic, spare giant headline "Talk. It remembers", concise product framing, tactile Join room/Leave keycap, secondary Start audio, actual connection and audio status. Peripheral status cards may show only real state or truthful architecture labels, never invented live activity. Make the graphic the visual anchor, not a generic dashboard.
- Existing global `main` max-width must be overridden by the page's CSS module. Keep styles isolated; proof page unchanged.
- Keep transcript and ALL diagnostic controls/export/labels. Native details may hide diagnostics by default, but existing opt-in checkbox remains.
- Keyboard focus, touch usability, readable text contrast, reduced motion and mobile layout mandatory.
- No global Option shortcut, fake latency/model labels or default autoplay sound.

## Acceptance criteria

- [ ] Cinematic responsive room adapted to observed HEX composition with original soul graphic, tactile keycap and large headline.
- [ ] Approved portrait accessible via real keyboard-operable visual toggle and exact unchanged asset.
- [ ] All LiveKit handlers/audio and diagnostic/export behavior retained; no capture or playback changes.
- [ ] Procedural speaking uses only measured agent energy; silence/disconnect/error/reset neutralize it. No phoneme/viseme claim.
- [ ] Reduced motion static; 390px usable without overflow; 1440 and 1920 centered.
- [ ] Model/cost unknowns remain honest; proof link and transcript preserved.
- [ ] Build, TypeScript, existing portrait tests pass; limitations reported.
- [ ] Third-party source attribution recorded, license notice for any copied code.

## Verification

```bash
pnpm --filter app exec tsc --noEmit
pnpm --filter app build
node --experimental-strip-types --test app/components/living-portrait/*.test.ts
git diff --check
```

Build only after checking for active Next processes sharing `.next`; use the isolated verification output setting described by the evaluator if necessary. AdaL runs independent browser checks at 1440x1400, 1920x1200 and 390x844, reduced motion, visual toggle, diagnostics and proof link. A dev-only synthetic audio check does not prove real VoxCPM2 synchronization.

## Execution boundaries

Status: PLANNING ONLY, per Tolu's latest request. No implementation kickoff is authorized. Reconcile this ticket with `docs/024-implementation-plan.md` and approve the character concept/default before execution; that plan supersedes the earlier default-mascot assumption.

Plan phase: write only docs/024-builder-plan.md, describe exact file changes and state/motion strategy, then stop. Do not implement yet.

Implementation phase: only after explicit second kickoff. Write docs/024-builder-report.md with actual commands, limitations, touched files and baseline preservation. Do not edit this ticket, master state, REQs or audit. Session transcript is captured by the supervisor; never author your own independent review.

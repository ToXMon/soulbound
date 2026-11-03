# Ticket 024 — code and visual provenance

## New work in this implementation

The room composition, tactile keycap, wordmark glyph, scoped styles, React Warden renderer and focused presentation tests were authored in this pi builder session under `docs/024-warden-kickoff.md`. No Surplus provider was used, and no new product model, generated image, audio, font, dependency or external asset was added.

Warden directly adapts the **existing project-authored concept A** in `docs/concepts/024/concept-sheet.html`: its numeric arch/visor paths, eye proportions, rim, orbital geometry and material palette are the design source. The TSX is an implementation of that approved project concept, not a port of HEX's canvas/GPU runtime. Added implementation details include React-scoped SVG resource IDs, playback-energy-only aperture, finite-value bounds, reduced-motion gates, layered material refinements and CSS-only bounded float/blink.

## Inspiration, not copied implementation

- HEX: https://anoma.ly/hex/
- Reference source identified by the project investigation: https://github.com/anomalyco/hex/tree/dev/site/src/shout
- Investigation record: `docs/hex-room-clone-plan.md`.

The black-stage hierarchy, negative space, glossy procedural-character treatment, oversized type and tactile key are design references. This builder did **not** copy HEX source code, shaders, mascot, branding, audio, photos, cards or runtime. Therefore no copied-code MIT notice is required for this patch. The project investigation reports HEX as MIT; this builder did not independently retrieve or reverify that license and does not claim otherwise.

## Existing work retained

- Approved Meta-generated portrait: `app/assets/soulbound-avatar-meta-preview.webp`, unchanged bytes and unchanged existing 2.5D renderer. Warden is not its likeness rig.
- Existing LiveKit transport, diagnostic/export behavior, silent analyzer, playback gate and renderer code remain project baseline work, not claimed as authored for 024.
- React, Next.js, LiveKit and other already-installed packages retain their existing licenses. No additional third-party implementation was incorporated.

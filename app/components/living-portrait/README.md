# LivingPortrait — Ticket 022

Embeddable reactive avatar for SOULBOUND voice UI.

## What it does

- Shows the approved character portrait (WEBP).
- Reacts to the **agent's actual audio playback energy** via a silent analyzer tap.
- States: idle · listening · thinking · speaking · disconnected · error.
- Does NOT modify the audio path — the existing LiveKit `<audio>` element remains the single audible output.
- 2.5D fallback: responsive head/shoulders image, dark panel, teal energy halo, subtle depth/float/tilt.
- Optional: lazy-loads Three.js for a rigged GLB renderer when an approved textured GLB is supplied.

## Missing assets & timing

| Asset | Status |
|---|---|
| Approved GLB (rigged 3D model) | **Not supplied.** Component falls back to 2.5D. |
| Playback-aligned word timestamps | **Not supplied.** No word highlighting. |
| Timed viseme / mouth cues | **Not supplied.** Energy-driven jaw only. |
| Approved VoxCPM2 sync verification | **Unverified.** Live VoxCPM2 synchronization not tested. |

## State boundaries

| State | Source | Notes |
|---|---|---|
| `disconnected` | LiveKit connection status | — |
| `listening` | Local participant active-speaker flag | Inferred from LiveKit, not mic analysis |
| `thinking` | Gap between listening end and agent audio playback | Inferred boundary; no precise backend event |
| `speaking` | Agent audio energy > threshold + browser playback gated | Energy from silent analyzer tap |
| `idle` | Connected, none of above | — |
| `error` | Analyzer failure or internal error | Resets on new track |

## Usage

```tsx
import { LivingPortrait } from "@/components/living-portrait";
import avatar from "@/assets/soulbound-avatar-meta-preview.webp";

<LivingPortrait
  state={portraitState}
  agentTrack={agentAudioTrack}
  assetSrc={avatar}
  glbSrc={undefined}         // no approved GLB
  reducedMotion={false}
/>
```

## Dev fixture

`/portrait-check` (disabled in production) provides visual/state checks and synthetic audio playback tests. Only included in dev builds.

## Tests

```bash
node --experimental-strip-types --test app/components/living-portrait/LivingPortrait.test.ts
```

Covers: cue validation, smoothing/silence/bounds/reset, playback gating logic.
Browser-API tests require the portrait-check fixture or jsdom.
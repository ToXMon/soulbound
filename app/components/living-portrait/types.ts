/** LivingPortrait typed API — Ticket 022. */

/** Component state: mirrors agent lifecycle. */
export type PortraitState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "disconnected"
  | "error";

/** Timed mouth-open cue on a browser playback clock (seconds, 0–1 value). */
export interface TimedCue {
  time: number;
  value: number;
}

/** Required named morph targets inside an approved GLB; no invented rig. */
export interface GLBControls {
  jaw?: string;
  blink?: string;
  /** Optional approved head node; tiny offsets preserve its rest rotation. */
  head?: string;
}

/** Props accepted by the embeddable LivingPortrait component. */
export interface LivingPortraitProps {
  state: PortraitState;
  /** The single remote agent audio track — analyzer taps this silently. */
  agentTrack: MediaStreamTrack | null;
  /** The HTMLMediaElement that plays the agent track (sole audible path). */
  playbackElement: HTMLMediaElement | null;
  /** Static import URL of the approved soulbound avatar WEBP. */
  assetSrc: string;
  /** Procedural Warden is not a likeness rig; portrait remains the default API. */
  variant?: "portrait" | "soul";
  /** Optional approved textured GLB URL (lazy-loads Three.js). */
  glbSrc?: string;
  glbControls?: GLBControls;
  /** Disable optional GPU mode on restricted devices (default true). */
  allowWebGL?: boolean;
  /** Optional timed mouth cues keyed to a playback clock. */
  timedCues?: TimedCue[];
  /** Current playback position in seconds (same clock as timedCues). */
  playbackClock?: number;
  /** Honour prefers-reduced-motion; also settable manually. */
  reducedMotion?: boolean;
  /** Bump to zero the envelope without destroying its analyzer or track. */
  resetToken?: number;
  className?: string;
  /** Measured energy only, not reply text or diagnostic phase. */
  onSpeakingChange?: (speaking: boolean) => void;
}

/** Energy envelope returned by the analyzer. */
export interface EnergyEnvelope {
  /** Smoothed RMS energy 0–1. */
  level: number;
  /** Raw instantaneous RMS before smoothing. */
  raw: number;
  /** Whether the envelope is currently decaying (silence). */
  decaying: boolean;
}
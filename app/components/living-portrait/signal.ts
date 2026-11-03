/**
 * Pure signal-processing helpers extracted from analyzer.ts.
 * Exported for direct import in tests — no browser APIs.
 */

import type { TimedCue } from "./types";

// ---- Cue validation ----

export type CueValidation =
  | { valid: true; duration?: number }
  | { valid: false; reason: string };

/** Validate timed cues: sorted non-negative finite 0-1 bounded, optional duration check. */
export function validateTimedCues(cues: TimedCue[]): CueValidation {
  if (!Array.isArray(cues)) return { valid: false, reason: "cues must be an array" };
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (!c || typeof c.time !== "number" || !Number.isFinite(c.time) || c.time < 0) {
      return { valid: false, reason: `cue[${i}].time must be non-negative finite` };
    }
    if (typeof c.value !== "number" || !Number.isFinite(c.value) || c.value < 0 || c.value > 1) {
      return { valid: false, reason: `cue[${i}].value must be 0-1, got ${c.value}` };
    }
    if (i > 0 && c.time < cues[i - 1].time) {
      return { valid: false, reason: `cue[${i}].time (${c.time}) < cue[${i - 1}].time (${cues[i - 1].time}) — non-monotonic` };
    }
  }
  if (cues.length > 0) {
    const last = cues[cues.length - 1];
    const duration = last.time;
    return { valid: true, duration };
  }
  return { valid: true };
}

/** Find last cue value at or before `clock` (seconds). */
export function cueValueAt(cues: TimedCue[], clock: number): number {
  if (!cues.length || !Number.isFinite(clock) || clock < 0 || pastCueEnd(cues, clock)) return 0;
  let best = 0;
  for (const c of cues) {
    if (c.time <= clock) best = c.value;
    else break;
  }
  return Math.max(0, Math.min(1, best));
}

/** True when clock is beyond the last cue time. */
export function pastCueEnd(cues: TimedCue[], clock: number): boolean {
  if (!cues.length) return false;
  return clock > cues[cues.length - 1].time;
}

// ---- RMS energy smoothing ----

export interface SmoothConfig {
  threshold: number;
  attack: number;
  release: number;
}

export interface SmoothResult {
  level: number;
  raw: number;
  decaying: boolean;
}

export interface SmoothState {
  smoothed: number;
}

/** RMS from time-domain samples. */
export function computeRMS(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sumSq = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return 0;
    sumSq += sample * sample;
  }
  return Math.min(1, Math.sqrt(sumSq / samples.length));
}

/**
 * Apply one step of attack/release smoothing with threshold.
 * Returns new result and mutated state.
 */
export function smoothStep(
  raw: number,
  config: SmoothConfig,
  state: SmoothState,
): SmoothResult {
  const bounded = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  raw = bounded(raw);
  const threshold = bounded(config.threshold);
  const aboveThreshold = raw >= threshold ? raw : 0;
  state.smoothed = bounded(state.smoothed);
  const coeff = bounded(aboveThreshold > state.smoothed ? config.attack : config.release);
  state.smoothed += coeff * (aboveThreshold - state.smoothed);
  if (state.smoothed < 0.0001) state.smoothed = 0;
  const level = Math.min(1, state.smoothed / 0.3);
  return { level, raw, decaying: aboveThreshold === 0 };
}

export function createSmoothState(): SmoothState {
  return { smoothed: 0 };
}

/** Reset the same envelope; its analyzer and shared track remain usable. */
export function resetSmoothState(state: SmoothState): void {
  state.smoothed = 0;
}
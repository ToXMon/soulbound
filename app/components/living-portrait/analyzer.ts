/** Silent side tap of ONE remote agent track; never owns/stops shared tracks. */
import type { EnergyEnvelope } from "./types";
import { computeRMS, smoothStep, createSmoothState, resetSmoothState, type SmoothConfig } from "./signal";

export interface EnergyAnalyzer {
  update(): EnergyEnvelope;
  reset(): void;
  destroy(): void;
  resume(): Promise<void>;
  running(): boolean;
}

export function createEnergyAnalyzer(track: MediaStreamTrack, config?: Partial<SmoothConfig>): EnergyAnalyzer {
  const cfg = { threshold: 0.005, attack: 0.6, release: 0.12, ...config };
  const state = createSmoothState();
  const ctx = new AudioContext();
  let source: MediaStreamAudioSourceNode | undefined;
  let analyzer: AnalyserNode | undefined;
  let silent: GainNode | undefined;
  let destroyed = false;
  const reset = () => resetSmoothState(state);
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    reset();
    for (const node of [source, analyzer, silent]) {
      try { node?.disconnect(); } catch { /* best effort */ }
    }
    if (ctx.state !== "closed") void ctx.close().catch(() => {});
  }
  try {
    source = ctx.createMediaStreamSource(new MediaStream([track]));
    analyzer = ctx.createAnalyser();
    analyzer.fftSize = 256;
    analyzer.smoothingTimeConstant = 0;
    // Some browsers require a destination to pull samples. This connection
    // is always zero gain; only the existing HTMLMediaElement is audible.
    silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(analyzer);
    analyzer.connect(silent);
    silent.connect(ctx.destination);
  } catch (error) {
    destroy();
    throw error;
  }
  const buffer = new Float32Array(analyzer.fftSize);
  async function resume() {
    if (!destroyed && ctx.state === "suspended") await ctx.resume();
  }
  void resume().catch(() => {});
  return {
    update() {
      if (destroyed || ctx.state !== "running") {
        reset();
        return { level: 0, raw: 0, decaying: true };
      }
      analyzer!.getFloatTimeDomainData(buffer);
      return smoothStep(computeRMS(buffer), cfg, state);
    },
    reset, destroy, resume,
    running: () => !destroyed && ctx.state === "running",
  };
}

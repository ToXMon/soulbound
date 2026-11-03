/**
 * LivingPortrait deterministic tests — Ticket 022.
 *
 * Tests REAL exported logic from signal.ts (pure, no browser APIs).
 * Playback gate lifecycle uses EventTarget fakes (platform tooling, no DOM
 * dependency). Browser rendering/audio is exercised separately in the fixture.
 *
 * Run: node --experimental-strip-types --test app/components/living-portrait/LivingPortrait.test.ts
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
// URL imports let Node strip TS directly without requiring a project-wide
// allowImportingTsExtensions change. The type queries are erased by Node.
const {
  validateTimedCues, cueValueAt, pastCueEnd, computeRMS,
  smoothStep, createSmoothState, resetSmoothState,
}: typeof import("./signal") = await import(new URL("./signal.ts", import.meta.url).href);
const { bindPlaybackGate }: typeof import("./playback") = await import(new URL("./playback.ts", import.meta.url).href);
const { mapMorphControls, setMorph }: typeof import("./rig") = await import(new URL("./rig.ts", import.meta.url).href);
import type { TimedCue } from "./types";

describe("validateTimedCues", () => {
  it("accepts empty array", () => {
    const r = validateTimedCues([]);
    assert.equal(r.valid, true);
  });

  it("accepts valid monotonic cues with duration", () => {
    const cues: TimedCue[] = [
      { time: 0, value: 0 },
      { time: 0.5, value: 0.5 },
      { time: 1.0, value: 1 },
    ];
    const r = validateTimedCues(cues);
    assert.equal(r.valid, true);
    if (r.valid) assert.equal(r.duration, 1.0);
  });

  it("rejects negative time", () => {
    const r = validateTimedCues([{ time: -0.1, value: 0.5 }]);
    assert.equal(r.valid, false);
    if (!r.valid) assert.ok(r.reason.includes("non-negative"));
  });

  it("rejects value > 1", () => {
    const r = validateTimedCues([{ time: 0, value: 1.5 }]);
    assert.equal(r.valid, false);
    if (!r.valid) assert.ok(r.reason.includes("0-1"));
  });

  it("rejects value < 0", () => {
    const r = validateTimedCues([{ time: 0, value: -0.1 }]);
    assert.equal(r.valid, false);
    if (!r.valid) assert.ok(r.reason.includes("0-1"));
  });

  it("rejects NaN time", () => {
    const r = validateTimedCues([{ time: NaN, value: 0.5 }]);
    assert.equal(r.valid, false);
  });

  it("rejects non-monotonic times", () => {
    const r = validateTimedCues([
      { time: 1, value: 0.5 },
      { time: 0.5, value: 0.3 },
    ]);
    assert.equal(r.valid, false);
    if (!r.valid) assert.ok(r.reason.includes("non-monotonic"));
  });
});

describe("cueValueAt", () => {
  const cues: TimedCue[] = [
    { time: 0, value: 0 },
    { time: 0.5, value: 0.3 },
    { time: 1.0, value: 0.7 },
    { time: 2.0, value: 0.2 },
  ];

  it("returns 0 for negative clock", () => {
    assert.equal(cueValueAt(cues, -1), 0);
  });

  it("returns 0 before first cue", () => {
    assert.equal(cueValueAt(cues, 0), 0);
  });

  it("returns correct value at exact cue time", () => {
    assert.equal(cueValueAt(cues, 0.5), 0.3);
    assert.equal(cueValueAt(cues, 1.0), 0.7);
    assert.equal(cueValueAt(cues, 2.0), 0.2);
  });

  it("returns last cue value between cues", () => {
    assert.equal(cueValueAt(cues, 0.8), 0.3);
    assert.equal(cueValueAt(cues, 1.5), 0.7);
  });

  it("zeros mouth after the supplied cue end and for nonfinite clocks", () => {
    assert.equal(cueValueAt(cues, 100), 0);
    assert.equal(cueValueAt(cues, NaN), 0);
    assert.equal(cueValueAt(cues, Infinity), 0);
  });

  it("clamps to 0-1", () => {
    const badCues: TimedCue[] = [
      { time: 0, value: -0.5 },
      { time: 1, value: 1.5 },
    ];
    assert.equal(cueValueAt(badCues, 0), 0);
    assert.equal(cueValueAt(badCues, 1), 1);
  });

  it("returns 0 for empty cues", () => {
    assert.equal(cueValueAt([], 5), 0);
  });
});

describe("pastCueEnd", () => {
  const cues: TimedCue[] = [
    { time: 0, value: 0 },
    { time: 2.0, value: 0.2 },
  ];

  it("returns false before end", () => {
    assert.equal(pastCueEnd(cues, 1.0), false);
    assert.equal(pastCueEnd(cues, 2.0), false);
  });

  it("returns true after end", () => {
    assert.equal(pastCueEnd(cues, 2.01), true);
    assert.equal(pastCueEnd(cues, 100), true);
  });

  it("returns false for empty cues", () => {
    assert.equal(pastCueEnd([], 5), false);
  });
});

describe("computeRMS", () => {
  it("returns 0 for all zeros", () => {
    assert.equal(computeRMS(new Float32Array(256)), 0);
  });

  it("returns correct RMS for constant signal", () => {
    const arr = new Float32Array(256).fill(0.1);
    assert.ok(Math.abs(computeRMS(arr) - 0.1) < 1e-7);
  });

  it("returns bounded for max signal", () => {
    const arr = new Float32Array(256).fill(1.0);
    assert.ok(computeRMS(arr) <= 1.0);
  });
});

describe("smoothStep", () => {
  const cfg = { threshold: 0.005, attack: 0.6, release: 0.12 };

  it("returns zero for silence", () => {
    const state = createSmoothState();
    const r = smoothStep(0, cfg, state);
    assert.equal(r.level, 0);
    assert.equal(r.decaying, true);
  });

  it("returns zero for below-threshold noise", () => {
    const state = createSmoothState();
    const r = smoothStep(0.003, cfg, state);
    assert.equal(r.level, 0);
  });

  it("produces bounded output 0-1", () => {
    const state = createSmoothState();
    for (let i = 0; i < 100; i++) {
      const r = smoothStep(0.5, cfg, state);
      assert.ok(r.level >= 0 && r.level <= 1);
    }
  });

  it("attack is fast on onset", () => {
    const state = createSmoothState();
    // Feed silence, then loud.
    for (let i = 0; i < 20; i++) smoothStep(0, cfg, state);
    let maxAfter = 0;
    for (let i = 0; i < 10; i++) {
      const r = smoothStep(0.2, cfg, state);
      maxAfter = Math.max(maxAfter, r.level);
    }
    assert.ok(maxAfter > 0.1);
  });

  it("decays after silence", () => {
    const state = createSmoothState();
    // Build up.
    for (let i = 0; i < 20; i++) smoothStep(0.2, cfg, state);
    const peak = state.smoothed;
    assert.ok(peak > 0.01, "should have built up energy");

    // Decay.
    for (let i = 0; i < 20; i++) smoothStep(0, cfg, state);
    assert.ok(state.smoothed < peak, "should have decayed");
  });

  it("reset via createSmoothState returns to zero", () => {
    const state = createSmoothState();
    for (let i = 0; i < 10; i++) smoothStep(0.2, cfg, state);
    assert.ok(state.smoothed > 0);

    resetSmoothState(state);
    assert.equal(state.smoothed, 0);
    assert.equal(smoothStep(0, cfg, state).level, 0);
    assert.ok(smoothStep(0.2, cfg, state).level > 0, "same analyzer envelope is reusable");
  });

  it("decaying flag true during silence", () => {
    const state = createSmoothState();
    for (let i = 0; i < 5; i++) smoothStep(0, cfg, state);
    const r = smoothStep(0, cfg, state);
    assert.equal(r.decaying, true);
  });

  it("decaying flag false on loud signal", () => {
    const state = createSmoothState();
    for (let i = 0; i < 5; i++) smoothStep(0.2, cfg, state);
    const r = smoothStep(0.2, cfg, state);
    assert.equal(r.decaying, false);
  });
});

describe("invalid input safety", () => {
  it("rejects null cues, infinite values/times, and duplicate time ordering inversions", () => {
    for (const cues of [null, [null], [{ time: Infinity, value: 0 }], [{ time: 0, value: NaN }]]) {
      assert.equal(validateTimedCues(cues as unknown as TimedCue[]).valid, false);
    }
  });
  it("returns finite zero for empty or corrupt samples", () => {
    assert.equal(computeRMS(new Float32Array()), 0);
    assert.equal(computeRMS(new Float32Array([NaN])), 0);
    assert.equal(computeRMS(new Float32Array([Infinity])), 0);
  });
  it("bounds corrupted smoothing input/config/state", () => {
    for (const raw of [-1, NaN, Infinity, 100]) {
      const result = smoothStep(raw, { threshold: NaN, attack: 20, release: -1 }, { smoothed: NaN });
      assert.ok(Number.isFinite(result.level) && result.level >= 0 && result.level <= 1);
      assert.ok(Number.isFinite(result.raw) && result.raw >= 0 && result.raw <= 1);
    }
  });
  it("silence reaches exact zero after release", () => {
    const state = createSmoothState();
    const cfg = { threshold: 0.005, attack: 0.6, release: 0.12 };
    smoothStep(0.3, cfg, state);
    for (let i = 0; i < 100; i++) smoothStep(0, cfg, state);
    assert.equal(state.smoothed, 0);
  });
});

class FakeElement extends EventTarget {
  paused = false;
  ended = false;
  readyState = 4;
  muted = false;
  volume = 1;
  error = null;
}
class FakeTrack extends EventTarget {
  enabled = true;
  muted = false;
  readyState = "live";
  stops = 0;
  stop() { this.stops++; }
}
function playback() {
  const element = new FakeElement();
  const track = new FakeTrack();
  const smooth = createSmoothState();
  smooth.smoothed = 0.2;
  let resets = 0;
  const gate = bindPlaybackGate(element as unknown as HTMLMediaElement,
    track as unknown as MediaStreamTrack, () => { resets++; resetSmoothState(smooth); });
  return { element, track, gate, smooth, resets: () => resets };
}

describe("browser playback gating and lifecycle", () => {
  it("accepts an already-playing element and requires running analysis context", () => {
    const { gate } = playback();
    assert.equal(gate.isOpen(true), true);
    assert.equal(gate.isOpen(false), false);
    gate.dispose();
  });
  for (const event of ["pause", "waiting", "stalled", "emptied", "ended", "error", "abort"]) {
    it(`${event} latches blocked until playing, even with apparently ready media`, () => {
      const { element, gate, smooth } = playback();
      element.dispatchEvent(new Event(event));
      assert.equal(smooth.smoothed, 0);
      assert.equal(gate.isOpen(true), false);
      element.dispatchEvent(new Event("canplay"));
      element.dispatchEvent(new Event("timeupdate"));
      assert.equal(gate.isOpen(true), false);
      element.dispatchEvent(new Event("playing"));
      assert.equal(gate.isOpen(true), true);
      gate.dispose();
    });
  }
  it("gates paused/ended/not-ready/muted/zero-volume elements", () => {
    const { element, gate } = playback();
    const checks = [{ paused: true }, { ended: true }, { readyState: 2 }, { muted: true }, { volume: 0 }];
    for (const blocked of checks) {
      Object.assign(element, { paused: false, ended: false, readyState: 4, muted: false, volume: 1 }, blocked);
      assert.equal(gate.isOpen(true), false);
    }
    gate.dispose();
  });
  it("mute/volume reset without permanently latching on unmute", () => {
    const { element, gate, smooth } = playback();
    element.muted = true;
    element.dispatchEvent(new Event("volumechange"));
    assert.equal(smooth.smoothed, 0);
    assert.equal(gate.isOpen(true), false);
    element.muted = false;
    element.dispatchEvent(new Event("volumechange"));
    assert.equal(gate.isOpen(true), true);
    gate.dispose();
  });
  it("requires enabled, unmuted, live track, and responds to track mute/end", () => {
    const { track, gate, smooth } = playback();
    track.enabled = false;
    assert.equal(gate.isOpen(true), false);
    track.enabled = true;
    track.muted = true;
    track.dispatchEvent(new Event("mute"));
    assert.equal(smooth.smoothed, 0);
    assert.equal(gate.isOpen(true), false);
    track.muted = false;
    track.dispatchEvent(new Event("unmute"));
    assert.equal(gate.isOpen(true), true);
    track.readyState = "ended";
    assert.equal(gate.isOpen(true), false);
    track.dispatchEvent(new Event("ended"));
    gate.dispose();
  });
  it("removes listeners, blocks stale callbacks, resets without stopping shared tracks", () => {
    const { element, track, gate, resets } = playback();
    gate.dispose();
    const count = resets();
    for (const event of ["playing", "pause", "waiting", "volumechange"]) element.dispatchEvent(new Event(event));
    for (const event of ["mute", "unmute", "ended"]) track.dispatchEvent(new Event(event));
    assert.equal(resets(), count);
    assert.equal(gate.isOpen(true), false);
    assert.equal(track.stops, 0);
    // A subsequent mount starts clean with its OWN listeners.
    const next = bindPlaybackGate(element as unknown as HTMLMediaElement, track as unknown as MediaStreamTrack, () => {});
    assert.equal(next.isOpen(true), true);
    next.dispose();
  });
});

describe("approved morph mapping validation", () => {
  const node = () => ({ morphTargetDictionary: { jaw: 0, blink: 1 }, morphTargetInfluences: [0, 0] });
  it("requires both distinct configured mappings", () => {
    assert.throws(() => mapMorphControls([node()]));
    assert.throws(() => mapMorphControls([node()], { jaw: "jaw" }));
    assert.throws(() => mapMorphControls([node()], { jaw: "jaw", blink: "jaw" }));
    assert.throws(() => mapMorphControls([node()], { jaw: "jaw", blink: "absent" }));
  });
  it("rejects negative, fractional and out-of-bounds morph indices", () => {
    for (const index of [-1, 0.5, 5, NaN]) {
      const invalid = node();
      invalid.morphTargetDictionary.jaw = index;
      assert.throws(() => mapMorphControls([invalid], { jaw: "jaw", blink: "blink" }));
    }
  });
  it("updates all supplied morph targets with finite bounded values", () => {
    const nodes = [node(), node()];
    const { jaw, blink } = mapMorphControls(nodes, { jaw: "jaw", blink: "blink" });
    setMorph(jaw, 50);
    setMorph(blink, NaN);
    for (const n of nodes) assert.deepEqual(n.morphTargetInfluences, [1, 0]);
    setMorph(jaw, -1);
    for (const n of nodes) assert.deepEqual(n.morphTargetInfluences, [0, 0]);
  });
});

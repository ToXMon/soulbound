import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Node's TS stripper intentionally doesn't resolve extensionless runtime TS
// imports. Scope this native loader hook to the ONE browser module under test;
// production keeps the app's normal bundler resolution. No extra test dependency.
const analyzerURL = new URL("./analyzer.ts", import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === analyzerURL && specifier === "./signal") {
      return next(new URL("./signal.ts", analyzerURL).href, context);
    }
    return next(specifier, context);
  },
});
const { createEnergyAnalyzer }: typeof import("./analyzer") = await import(analyzerURL);
hook.deregister();

class FakeNode {
  connections: FakeNode[] = [];
  disconnects = 0;
  connect(destination: FakeNode) { this.connections.push(destination); return destination; }
  disconnect() { this.disconnects++; }
}
class FakeAnalyzer extends FakeNode {
  fftSize = 256;
  smoothingTimeConstant = 0;
  amplitude = 0.2;
  getFloatTimeDomainData(buffer: Float32Array) { buffer.fill(this.amplitude); }
}
class FakeGain extends FakeNode { gain = { value: 1 }; }
class FakeStream {
  tracks: unknown[];
  constructor(tracks: unknown[]) { this.tracks = tracks; }
}
class FakeContext {
  static instances: FakeContext[] = [];
  static failSetup = false;
  static initialState = "running";
  state = FakeContext.initialState;
  source = new FakeNode();
  analyzer = new FakeAnalyzer();
  silent = new FakeGain();
  destination = new FakeNode();
  stream: FakeStream | undefined;
  closes = 0;
  resumes = 0;
  constructor() { FakeContext.instances.push(this); }
  createMediaStreamSource(stream: FakeStream) { this.stream = stream; return this.source; }
  createAnalyser() {
    if (FakeContext.failSetup) throw new Error("setup failed");
    return this.analyzer;
  }
  createGain() { return this.silent; }
  async close() { this.closes++; this.state = "closed"; }
  async resume() { this.resumes++; this.state = "running"; }
}

function browserFakes(t: { after: (cleanup: () => void) => void }) {
  FakeContext.instances = [];
  FakeContext.failSetup = false;
  FakeContext.initialState = "running";
  const originals = ["AudioContext", "MediaStream"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis, "MediaStream", { configurable: true, value: FakeStream });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let stops = 0;
  return { track: { stop() { stops++; } } as unknown as MediaStreamTrack, stops: () => stops };
}

describe("silent analyzer ownership and lifecycle", () => {
  it("taps only the selected track and has zero gain to the destination", (t) => {
    const { track, stops } = browserFakes(t);
    const analyzer = createEnergyAnalyzer(track);
    const ctx = FakeContext.instances[0];
    assert.deepEqual(ctx.stream?.tracks, [track]);
    assert.deepEqual(ctx.source.connections, [ctx.analyzer]);
    assert.deepEqual(ctx.analyzer.connections, [ctx.silent]);
    assert.deepEqual(ctx.silent.connections, [ctx.destination]);
    assert.equal(ctx.silent.gain.value, 0);
    analyzer.destroy();
    assert.equal(stops(), 0);
  });
  it("resets the real envelope without destroying or permanently disabling analysis", (t) => {
    const { track } = browserFakes(t);
    const analyzer = createEnergyAnalyzer(track);
    const ctx = FakeContext.instances[0];
    assert.ok(analyzer.update().level > 0);
    analyzer.reset();
    ctx.analyzer.amplitude = 0;
    assert.equal(analyzer.update().level, 0);
    ctx.analyzer.amplitude = 0.2;
    assert.ok(analyzer.update().level > 0);
    assert.equal(ctx.closes, 0);
    assert.equal(FakeContext.instances.length, 1);
    analyzer.destroy();
  });
  it("suspension zeros the envelope and gesture resume recovers", async (t) => {
    const { track } = browserFakes(t);
    const analyzer = createEnergyAnalyzer(track);
    const ctx = FakeContext.instances[0];
    assert.ok(analyzer.update().level > 0);
    ctx.state = "suspended";
    assert.equal(analyzer.running(), false);
    assert.equal(analyzer.update().level, 0);
    await analyzer.resume();
    assert.equal(analyzer.running(), true);
    assert.ok(analyzer.update().level > 0);
    analyzer.destroy();
  });
  it("destroy is idempotent, disconnects all nodes, and rejects stale update/resume", async (t) => {
    const { track, stops } = browserFakes(t);
    const analyzer = createEnergyAnalyzer(track);
    const ctx = FakeContext.instances[0];
    analyzer.destroy();
    analyzer.destroy();
    await analyzer.resume();
    assert.equal(analyzer.running(), false);
    assert.equal(analyzer.update().level, 0);
    assert.equal(ctx.closes, 1);
    assert.equal(ctx.resumes, 0);
    for (const node of [ctx.source, ctx.analyzer, ctx.silent]) assert.equal(node.disconnects, 1);
    assert.equal(stops(), 0);
  });
  it("partial setup failure cleans acquired resources without touching playback", (t) => {
    const { track, stops } = browserFakes(t);
    FakeContext.failSetup = true;
    assert.throws(() => createEnergyAnalyzer(track), /setup failed/);
    const ctx = FakeContext.instances[0];
    assert.equal(ctx.source.disconnects, 1);
    assert.equal(ctx.closes, 1);
    assert.equal(stops(), 0);
  });
});

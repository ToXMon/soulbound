/** Presentation self-checks, not independent evaluation or live audio proof. */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { PortraitState } from "./types";

// Compile the actual TSX in memory with the already-installed TypeScript.
// No build artifacts, browser/audio mocks, loader hooks or dependency additions.
const require = createRequire(import.meta.url);
const ts: typeof import("typescript") = require("typescript");
const React: typeof import("react") = require("react");
const { renderToStaticMarkup }: typeof import("react-dom/server") = require("react-dom/server");
const source = readFileSync(new URL("./renderer-soul.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const renderer: typeof import("./renderer-soul") = {} as typeof import("./renderer-soul");
new Function("require", "exports", compiled)((name: string) => name.endsWith(".css")
  ? { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) }
  : require(name), renderer);
const states: PortraitState[] = ["idle", "listening", "thinking", "speaking", "disconnected", "error"];

function markup(state: PortraitState, level: number, reducedMotion = false) {
  return renderToStaticMarkup(React.createElement(renderer.default, {
    state, energy: { level, raw: level, decaying: false }, reducedMotion,
  }));
}

describe("Warden presentation gates", () => {
  it("ignores energy in every non-speaking state, including faults and local speech", () => {
    for (const state of states.filter(s => s !== "speaking")) {
      assert.equal(renderer.wardenPose(state, 1, false).energy, 0);
      assert.match(markup(state, 1), /data-mouth-aperture="0.000"/);
      assert.match(markup(state, 1), /data-speech-halo="0.000"/);
    }
  });
  it("bounds finite speaking input, rejects corrupt input and closes on silence", () => {
    for (const [level, expected] of [[0, 0], [-1, 0], [NaN, 0], [Infinity, 0], [0.6, 0.6], [10, 1]]) {
      assert.equal(renderer.wardenPose("speaking", level, false).energy, expected);
    }
    assert.match(markup("speaking", 0), /data-mouth-aperture="0.000"/);
    assert.match(markup("speaking", 0.6), /data-mouth-aperture="18.000"/);
  });
  it("freezes all visual energy, gaze and pose under reduced motion but preserves status", () => {
    for (const state of states) {
      const p = renderer.wardenPose(state, 1, true);
      assert.equal(p.energy, 0);
      assert.equal(p.motion, false);
      assert.equal(p.gazeX, 0);
      assert.equal(p.gazeY, 0);
      assert.equal(p.tilt, 0);
      const html = markup(state, 1, true);
      assert.match(html, /data-motion="off"/);
      assert.match(html, /data-mouth-aperture="0.000"/);
      assert.match(html, /data-speech-halo="0.000"/);
      assert.match(html, /role="status"/);
      assert.match(html, /static \/ reduced motion/);
    }
    assert.match(markup("speaking", 1, true), />Speaking</);
    assert.match(markup("thinking", 1, true), /Awaiting reply · inferred/);
  });
  it("keeps disconnected and error neutral, with no motion or open mouth", () => {
    for (const state of ["disconnected", "error"] as const) {
      const p = renderer.wardenPose(state, 1, false);
      assert.equal(p.motion, false);
      assert.equal(p.tilt, 0);
      assert.match(markup(state, 1), /data-motion="off"/);
    }
  });
  it("retains concept-A construction and unique accessible SVG resource identities", () => {
    const html = renderToStaticMarkup(React.createElement("div", null,
      React.createElement(renderer.default, { state: "idle", energy: { level: 0, raw: 0, decaying: true }, reducedMotion: false }),
      React.createElement(renderer.default, { state: "idle", energy: { level: 0, raw: 0, decaying: true }, reducedMotion: false })));
    assert.match(html, /obsidian arch, glass visor and orbital tether/);
    assert.match(html, /audio-reactive \/ approximate/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    assert.doesNotMatch(source, /new AudioContext|getUserMedia|fetch\(|<audio|setInterval|setTimeout/);
  });
});

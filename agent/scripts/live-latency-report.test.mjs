import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, percentileStats, summarize, validateTurn } from "./live-latency-report.mjs";

function turn(i, overrides = {}) {
  const base = {
    turnId: `t-${i}`,
    index: i,
    isWarmup: false,
    outcome: "success",
    browser: {
      speechStartProxyAtMs: 1000 + i * 10000,
      speechEndProxyAtMs: 2000 + i * 10000,
      dataReceiptAtMs: 2900 + i * 10000,
      domCommitAtMs: 3000 + i * 10000,
    },
    agent: {
      utteranceVtElapsedMs: 1000,
      vtSpeechEndToCompleteMs: 100,
      vtCompleteToSparkMs: 10,
      sparkMs: 500 + i * 10,
      publishMs: 20,
      firstTokenMs: null,
    },
  };
  return { ...base, ...overrides, browser: { ...base.browser, ...(overrides.browser ?? {}) }, agent: overrides.agent === null ? null : { ...base.agent, ...(overrides.agent ?? {}) } };
}

function exportOf(turns, extra = {}) {
  return {
    schemaVersion: 1, mode: "live-mic", runId: "run-1", date: "2026-10-28T00:00:00.000Z",
    codeRevision: "abc123", browser: "test-browser", modelId: "muse-spark-1.3",
    vtEncoding: "PCM_16KHZ", warmupPolicy: "1 warm-up excluded", timeoutMs: 30000,
    boundaryDefinition: "manual proxy", percentileMethod: "nearest-rank",
    turns, unmatchedAgentTurnIds: [], ...extra,
  };
}

test("percentile nearest-rank known values", () => {
  const s = [10, 20, 30, 40];
  assert.equal(percentile(s, 0.5), 20); // ceil(0.5*4)-1 = 1
  assert.equal(percentile(s, 0.95), 40); // ceil(3.8)-1 = 3
  assert.equal(percentile([5], 0.5), 5);
  assert.equal(percentile([5], 0.95), 5);
  assert.deepEqual(percentileStats([30, 10, 20]), { n: 3, p50: 20, p95: 30 });
});

test("empty dataset returns null, not zero", () => {
  assert.equal(percentile([], 0.5), null);
  assert.deepEqual(percentileStats([]), { n: 0, p50: null, p95: null });
  const r = summarize(exportOf([]), 20);
  assert.equal(r.metrics.sparkMs.p50, null);
  assert.equal(r.complete, false);
});

test("singleton dataset", () => {
  const r = summarize(exportOf([turn(1)]), 1);
  assert.equal(r.metrics.markerToVisibleMs.p50, 1000);
  assert.equal(r.metrics.markerToVisibleMs.p95, 1000);
  assert.equal(r.complete, true);
});

test("invalid timestamps rejected, never repaired", () => {
  const bad = turn(1, { browser: { speechEndProxyAtMs: 5000, domCommitAtMs: 4000 } });
  assert.ok(validateTurn(bad).some((e) => e.includes("inverted")));
  const neg = turn(2, { agent: { sparkMs: -5 } });
  assert.ok(validateTurn(neg).length > 0);
  const nan = turn(3, { agent: { sparkMs: NaN } });
  assert.ok(validateTurn(nan).length > 0);
  const r = summarize(exportOf([bad, turn(9)]), 2);
  assert.equal(r.counts.invalid, 1);
  assert.equal(r.metrics.sparkMs.eligible, 1); // bad excluded, not repaired
  assert.equal(r.complete, false);
});

test("warm-up excluded from measured percentiles and counts", () => {
  const warm = turn(0, { isWarmup: true, agent: { sparkMs: 99999 } });
  const measured = Array.from({ length: 20 }, (_, i) => turn(i + 1));
  const r = summarize(exportOf([warm, ...measured]), 20);
  assert.equal(r.counts.warmupAttempted, 1);
  assert.equal(r.counts.attempted, 20);
  assert.equal(r.metrics.sparkMs.n ?? r.metrics.sparkMs.eligible, 20);
  assert.notEqual(r.metrics.sparkMs.p95, 99999);
  assert.equal(r.complete, true);
});

test("missing and duplicate IDs accounted", () => {
  const turns = [turn(1), turn(1), turn(2)];
  const r = summarize(exportOf(turns), 20);
  assert.equal(r.counts.duplicate, 1);
  assert.equal(r.counts.missing, 17); // 20 expected - 3 attempted
  assert.equal(r.complete, false);
});

test("timeouts and failures shown alongside percentiles", () => {
  const turns = [
    turn(1),
    turn(2, { outcome: "timeout", browser: { dataReceiptAtMs: null, domCommitAtMs: null }, agent: null }),
    turn(3, { outcome: "failed", browser: { dataReceiptAtMs: null, domCommitAtMs: null }, agent: null }),
  ];
  const r = summarize(exportOf(turns), 3);
  assert.equal(r.counts.successful, 1);
  assert.equal(r.counts.timedOut, 1);
  assert.equal(r.counts.failed, 1);
  assert.equal(r.metrics.sparkMs.eligible, 1);
  assert.equal(r.complete, false);
});

test("sample accounting: all 20 attempted, no replacement", () => {
  const turns = Array.from({ length: 20 }, (_, i) => turn(i + 1));
  turns[19] = turn(20, { outcome: "timeout", browser: { dataReceiptAtMs: null, domCommitAtMs: null }, agent: null });
  const r = summarize(exportOf(turns), 20);
  assert.equal(r.counts.attempted, 20);
  assert.equal(r.counts.successful, 19);
  assert.equal(r.counts.timedOut, 1);
  assert.equal(r.complete, false);
});

test("unavailable stage metrics are null-counted, not zero", () => {
  const t = turn(1, { agent: { vtSpeechEndToCompleteMs: null, publishMs: null, firstTokenMs: null } });
  const r = summarize(exportOf([t]), 1);
  assert.equal(r.metrics.vtSpeechEndToCompleteMs.eligible, 0);
  assert.equal(r.metrics.vtSpeechEndToCompleteMs.unavailableOrExcluded, 1);
  assert.equal(r.metrics.vtSpeechEndToCompleteMs.p50, null);
  assert.equal(r.metrics.publishMs.p50, null);
});

test("wrong mode rejected", () => {
  const r = summarize(exportOf([turn(1)], { mode: "wav-replay" }), 1);
  assert.ok(r.errors.length > 0);
  assert.equal(r.complete, false);
});

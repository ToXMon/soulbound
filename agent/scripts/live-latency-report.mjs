#!/usr/bin/env node
// Ticket 019 report CLI: summarize a metadata-only live-mic timing export.
// Nearest-rank percentiles. Invalid samples are flagged and excluded,
// never repaired. Exits nonzero on malformed or incomplete baselines.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (!(p > 0 && p <= 1)) return null;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

export function percentileStats(values) {
  const clean = values.filter((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
  const sorted = [...clean].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

const BROWSER_TS = ["speechStartProxyAtMs", "speechEndProxyAtMs", "dataReceiptAtMs", "domCommitAtMs", "audioAttachedAtMs", "audioPlayingAtMs"];
const AGENT_DURATIONS = ["utteranceVtElapsedMs", "vtSpeechEndToCompleteMs", "vtCompleteToSparkMs", "sparkMs", "publishMs", "firstTokenMs", "sparkFirstTokenMs", "firstSentenceMs", "firstTtsChunkMs", "firstAudioPublishMs", "ttsMs"];
const OUTCOMES = new Set(["success", "failed", "timeout", "missing"]);

function isValidNonNeg(v) {
  return v === null || v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

export function validateTurn(turn) {
  const errors = [];
  if (!turn || typeof turn !== "object") return ["turn is not an object"];
  if (typeof turn.turnId !== "string" || !turn.turnId) errors.push("missing turnId");
  if (!OUTCOMES.has(turn.outcome)) errors.push(`invalid outcome: ${String(turn.outcome)}`);
  const b = turn.browser ?? {};
  for (const k of BROWSER_TS) {
    if (!isValidNonNeg(b[k])) errors.push(`browser.${k} invalid (negative/non-finite)`);
  }
  // Inverted timestamps are invalid, never repaired.
  const pairs = [
    ["speechStartProxyAtMs", "speechEndProxyAtMs"],
    ["speechEndProxyAtMs", "domCommitAtMs"],
    ["speechStartProxyAtMs", "domCommitAtMs"],
    ["dataReceiptAtMs", "domCommitAtMs"],
    ["speechEndProxyAtMs", "audioPlayingAtMs"],
    ["audioAttachedAtMs", "audioPlayingAtMs"],
  ];
  for (const [a, c] of pairs) {
    if (typeof b[a] === "number" && typeof b[c] === "number" && b[c] < b[a]) {
      errors.push(`browser timestamps inverted: ${c} < ${a}`);
    }
  }
  const ag = turn.agent;
  if (ag !== null && ag !== undefined) {
    for (const k of AGENT_DURATIONS) {
      if (!isValidNonNeg(ag[k])) errors.push(`agent.${k} invalid (negative/non-finite)`);
    }
  }
  if (turn.outcome === "success") {
    if (typeof b.domCommitAtMs !== "number") errors.push("success turn missing domCommitAtMs");
    if (typeof b.speechEndProxyAtMs !== "number") errors.push("success turn missing speechEndProxyAtMs (manual proxy)");
  }
  return errors;
}

function browserDurations(turn) {
  const b = turn.browser ?? {};
  const diff = (a, c) =>
    typeof b[a] === "number" && typeof b[c] === "number" ? b[c] - b[a] : null;
  return {
    // MANUAL PROXY: operator "Finished speaking" click -> reply DOM commit.
    // This is NOT true speech-end latency; human marker delay is included.
    markerToVisibleMs: diff("speechEndProxyAtMs", "domCommitAtMs"),
    startToVisibleMs: diff("speechStartProxyAtMs", "domCommitAtMs"),
    dataReceiptToDomCommitMs: diff("dataReceiptAtMs", "domCommitAtMs"),
    // MANUAL PROXY (Ticket 003): Finished-speaking click -> audio element
    // "playing" event. Browser clock only; not physical first-audio proof.
    markerToAudioPlayingMs: diff("speechEndProxyAtMs", "audioPlayingAtMs"),
    startToAudioPlayingMs: diff("speechStartProxyAtMs", "audioPlayingAtMs"),
  };
}

const METRICS = [
  "markerToVisibleMs",
  "startToVisibleMs",
  "dataReceiptToDomCommitMs",
  "markerToAudioPlayingMs",
  "startToAudioPlayingMs",
  "utteranceVtElapsedMs",
  "vtSpeechEndToCompleteMs",
  "vtCompleteToSparkMs",
  "sparkMs",
  "publishMs",
  "firstTokenMs",
  "sparkFirstTokenMs",
  "firstSentenceMs",
  "firstTtsChunkMs",
  "firstAudioPublishMs",
  "ttsMs",
];

export function summarize(data, expectedTurns = 20) {
  const errors = [];
  if (!data || typeof data !== "object") errors.push("export is not an object");
  if (data?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (data?.mode !== "live-mic") errors.push(`mode must be "live-mic" (got ${JSON.stringify(data?.mode)})`);
  if (!Array.isArray(data?.turns)) errors.push("turns must be an array");
  const turns = Array.isArray(data?.turns) ? data.turns : [];

  const warmup = turns.filter((t) => t?.isWarmup === true);
  const measured = turns.filter((t) => t?.isWarmup !== true);

  // Duplicate turn IDs (across all turns).
  const seen = new Map();
  let duplicateCount = 0;
  const duplicateIds = [];
  for (const t of turns) {
    if (!t?.turnId) continue;
    if (seen.has(t.turnId)) { duplicateCount++; duplicateIds.push(t.turnId); }
    else seen.set(t.turnId, t);
  }

  const invalid = [];
  const validMeasured = [];
  const seenMeasured = new Set();
  for (const t of measured) {
    const errs = validateTurn(t);
    if (t?.turnId && seenMeasured.has(t.turnId)) errs.push("duplicate turnId in measured turns");
    if (t?.turnId) seenMeasured.add(t.turnId);
    if (errs.length) invalid.push({ turnId: t?.turnId ?? null, errors: errs });
    else validMeasured.push(t);
  }

  const countOutcome = (o) => measured.filter((t) => t?.outcome === o).length;
  const attempted = measured.length;
  const successful = countOutcome("success");
  const failed = countOutcome("failed");
  const timedOut = countOutcome("timeout");
  const missingOutcome = countOutcome("missing");
  const shortfall = Math.max(0, expectedTurns - attempted);
  // Non-overlapping terminal accounting: every measured attempt has exactly
  // one outcome; shortfall is un-attempted, reported as missingRecords.
  const missing = missingOutcome + shortfall;

  const unmatchedAgent = Array.isArray(data?.unmatchedAgentTurnIds)
    ? data.unmatchedAgentTurnIds.length : 0;
  const unmatchedBrowser = validMeasured.filter(
    (t) => t.outcome === "success" && (t.agent === null || t.agent === undefined),
  ).length;

  // Percentiles only over eligible successful, valid, non-duplicate samples.
  const eligible = validMeasured.filter((t) => t.outcome === "success");
  const metrics = {};
  for (const m of METRICS) {
    const values = [];
    let unavailable = 0;
    for (const t of eligible) {
      let v = null;
      if (m === "markerToVisibleMs" || m === "startToVisibleMs" || m === "dataReceiptToDomCommitMs" || m === "markerToAudioPlayingMs" || m === "startToAudioPlayingMs") {
        v = browserDurations(t)[m];
      } else {
        v = t.agent?.[m] ?? null;
      }
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) values.push(v);
      else unavailable++;
    }
    const s = percentileStats(values);
    metrics[m] = { eligible: s.n, unavailableOrExcluded: unavailable, p50: s.p50, p95: s.p95 };
  }

  const complete =
    errors.length === 0 &&
    attempted === expectedTurns &&
    successful === expectedTurns &&
    failed === 0 && timedOut === 0 && missing === 0 &&
    duplicateCount === 0 && invalid.length === 0;

  return {
    meta: {
      schemaVersion: data?.schemaVersion ?? null,
      mode: data?.mode ?? null,
      runId: data?.runId ?? null,
      date: data?.date ?? data?.exportedAt ?? null,
      codeRevision: data?.codeRevision ?? null,
      browser: data?.browser ?? null,
      modelId: data?.modelId ?? null,
      vtEncoding: data?.vtEncoding ?? null,
      warmupPolicy: data?.warmupPolicy ?? null,
      timeoutMs: data?.timeoutMs ?? null,
      boundaryDefinition: data?.boundaryDefinition ?? null,
      percentileMethod: data?.percentileMethod ?? "nearest-rank",
    },
    expectedTurns,
    counts: {
      warmupAttempted: warmup.length,
      attempted,
      successful,
      failed,
      timedOut,
      missing,
      duplicate: duplicateCount,
      duplicateIds,
      invalid: invalid.length,
      unmatchedAgentRecords: unmatchedAgent,
      unmatchedBrowserRecords: unmatchedBrowser,
    },
    invalid,
    metrics,
    quality: data?.quality ?? null,
    errors,
    complete,
    verdict: complete
      ? "COMPLETE text baseline with Ticket 003 TTS/playback proxies reported where present (NOT a REQ-40 first-audio PASS: proxies alone cannot establish physical first audio)"
      : "INCOMPLETE/BLOCKED baseline — see counts, invalid and errors",
  };
}

function formatHuman(r) {
  const lines = [];
  lines.push(`mode=${r.meta.mode} runId=${r.meta.runId} date=${r.meta.date}`);
  lines.push(`codeRevision=${r.meta.codeRevision} browser=${r.meta.browser} model=${r.meta.modelId} vtEncoding=${r.meta.vtEncoding}`);
  lines.push(`timeoutMs=${r.meta.timeoutMs} warmupPolicy=${r.meta.warmupPolicy} percentile=${r.meta.percentileMethod}`);
  lines.push(`boundary: ${r.meta.boundaryDefinition}`);
  lines.push(`counts: expected=${r.expectedTurns} warmup=${r.counts.warmupAttempted} attempted=${r.counts.attempted} successful=${r.counts.successful} failed=${r.counts.failed} timedOut=${r.counts.timedOut} missing=${r.counts.missing} duplicate=${r.counts.duplicate} invalid=${r.counts.invalid} unmatchedAgent=${r.counts.unmatchedAgentRecords} unmatchedBrowser=${r.counts.unmatchedBrowserRecords}`);
  for (const [name, m] of Object.entries(r.metrics)) {
    const label = name === "markerToVisibleMs"
      ? `${name} [MANUAL-PROXY marker->visible, not true speech-end]`
      : name === "markerToAudioPlayingMs"
        ? `${name} [MANUAL-PROXY marker->audio-playing, not physical first-audio]`
        : name;
    lines.push(`${label}: n=${m.eligible} unavailable=${m.unavailableOrExcluded} p50=${m.p50 === null ? "null" : m.p50 + "ms"} p95=${m.p95 === null ? "null" : m.p95 + "ms"}`);
  }
  if (r.invalid.length) lines.push(`invalid turns: ${JSON.stringify(r.invalid)}`);
  if (r.errors.length) lines.push(`errors: ${r.errors.join("; ")}`);
  if (r.quality) lines.push(`quality (aggregate only): ${JSON.stringify(r.quality)}`);
  lines.push(r.verdict);
  return lines.join("\n");
}

function main(argv) {
  const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const input = argOf("--input");
  const expected = Number(argOf("--expected-turns") ?? 20);
  const asJson = argv.includes("--json");
  if (!input) { console.error("usage: live-latency-report.mjs --input <export.json> [--expected-turns 20] [--json]"); return 2; }
  let data;
  try { data = JSON.parse(readFileSync(input, "utf8")); }
  catch (e) { console.error(`malformed export: ${e.message}`); return 2; }
  const report = summarize(data, expected);
  console.log(asJson ? JSON.stringify(report, null, 2) : formatHuman(report));
  return report.complete ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}

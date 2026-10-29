"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, type RemoteParticipant } from "livekit-client";

interface TurnLine {
  who: string;
  text: string;
  reply: boolean;
}

// Ticket 019 diagnostic types. Timing exports are metadata-only:
// no transcript/reply text, tokens, keys, identity, or signed URLs.
interface BrowserTiming {
  speechStartProxyAtMs: number | null;
  speechEndProxyAtMs: number | null;
  dataReceiptAtMs: number | null;
  domCommitAtMs: number | null;
}
interface AgentTimingExport {
  utteranceVtElapsedMs: number | null;
  vtSpeechEndToCompleteMs: number | null;
  vtCompleteToSparkMs: number | null;
  sparkMs: number | null;
  publishMs: number | null;
  firstTokenMs: number | null;
}
interface DiagAttempt {
  turnId: string;
  index: number; // 0 = warm-up, 1..20 measured
  isWarmup: boolean;
  outcome: "success" | "failed" | "timeout" | "missing";
  pending: boolean;
  browser: BrowserTiming;
  agent: AgentTimingExport | null;
}

const BOUNDARY =
  "manual-proxy: speechStartProxy = operator 'Start turn' click; speechEndProxy = operator 'Finished speaking' click; visible = reply DOM commit (not guaranteed physical paint). " +
  "markerToVisible is MANUAL-PROXY marker->visible, NOT true speech-end latency (human marker delay included). " +
  "All browser durations on one performance.now() clock; agent durations on the agent performance.now() clock; clocks are never subtracted.";

function newId(prefix: string): string {
  const c = globalThis.crypto as Crypto | undefined;
  const rand = c?.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

export default function Page() {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Not connected. Join the room and speak.");
  const [lines, setLines] = useState<TurnLine[]>([]);

  // Diagnostic state (opt-in; normal flow unchanged when off).
  const [diagEnabled, setDiagEnabled] = useState(false);
  const [codeRevision, setCodeRevision] = useState("");
  const [timeoutMsInput, setTimeoutMsInput] = useState("30000");
  const [vtEncoding, setVtEncoding] = useState("PCM_16KHZ");
  const [attempts, setAttempts] = useState<DiagAttempt[]>([]);
  const [phase, setPhase] = useState<"idle" | "speaking" | "waiting">("idle");
  const [modelId, setModelId] = useState<string | null>(null);
  const [qualityRelevant, setQualityRelevant] = useState("");
  const [qualitySpeaker, setQualitySpeaker] = useState("");
  const [qualityComplete, setQualityComplete] = useState("");
  const runIdRef = useRef<string>(newId("run"));
  const currentRef = useRef<DiagAttempt | null>(null);
  const attemptsRef = useRef<DiagAttempt[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmatchedRef = useRef<string[]>([]);
  const timeoutRef = useRef(30000);

  const syncAttempts = useCallback((next: DiagAttempt[]) => {
    attemptsRef.current = next;
    setAttempts(next);
  }, []);

  const upsertAttempt = useCallback((a: DiagAttempt) => {
    const next = attemptsRef.current.some((x) => x.turnId === a.turnId)
      ? attemptsRef.current.map((x) => (x.turnId === a.turnId ? a : x))
      : [...attemptsRef.current, a];
    syncAttempts(next);
  }, [syncAttempts]);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setConnected(false);
    setStatus("Disconnected.");
  }, []);

  const finishWithDomCommit = useCallback((turnId: string) => {
    // DOM commit proxy: two rAFs after the state update that rendered the
    // reply. This is not guaranteed physical paint.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const cur = attemptsRef.current.find((x) => x.turnId === turnId);
      if (!cur || !cur.pending) return;
      const done: DiagAttempt = {
        ...cur, pending: false, outcome: "success",
        browser: { ...cur.browser, domCommitAtMs: performance.now() },
      };
      if (timerRef.current) clearTimeout(timerRef.current);
      currentRef.current = null;
      upsertAttempt(done);
      setPhase("idle");
      setStatus(done.isWarmup ? "Warm-up captured. Begin measured turn 1." : `Turn ${done.index} captured.`);
    }));
  }, [upsertAttempt]);

  const connect = useCallback(async () => {
    try {
      setStatus("Connecting\u2026");
      const res = await fetch("/api/token?room=soulbound");
      const data = (await res.json()) as { token?: string; error?: string };
      if (!data.token) throw new Error(data.error ?? "no token returned");
      const url = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "ws://localhost:7880";
      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
        if (topic === "latency-publish") {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; turnId?: string; publishMs?: number | null };
            if (msg.type !== "publish-complete" || !msg.turnId) return;
            const target = attemptsRef.current.find((x) => x.turnId === msg.turnId);
            if (!target) { unmatchedRef.current.push(msg.turnId); return; }
            upsertAttempt({
              ...target,
              agent: {
                utteranceVtElapsedMs: target.agent?.utteranceVtElapsedMs ?? null,
                vtSpeechEndToCompleteMs: target.agent?.vtSpeechEndToCompleteMs ?? null,
                vtCompleteToSparkMs: target.agent?.vtCompleteToSparkMs ?? null,
                sparkMs: target.agent?.sparkMs ?? null,
                publishMs: typeof msg.publishMs === "number" ? msg.publishMs : null,
                firstTokenMs: target.agent?.firstTokenMs ?? null,
              },
            });
          } catch { /* ignore malformed diagnostic packets */ }
          return;
        }
        if (topic !== "turn") return;
        const receiptAt = performance.now();
        try {
          const rec = JSON.parse(new TextDecoder().decode(payload)) as {
            speaker: string | null; kind: string; transcript: string; reply: string; model: string;
            diag?: { runId: string; turnId: string } | null;
            timing?: AgentTimingExport & { firstTokenMs: number | null };
          };
          setModelId(rec.model ?? null);
          setLines((prev) => [
            ...prev,
            { who: `diarized speaker=${rec.speaker ?? "?"} (${rec.kind})`, text: rec.transcript, reply: false },
            { who: `SOULBOUND \u00b7 ${rec.model}`, text: rec.reply, reply: true },
          ]);
          // Join agent timing by opaque turn ID only; never by transcript text.
          const cur = currentRef.current;
          if (cur && rec.diag?.turnId === cur.turnId) {
            const joined: DiagAttempt = {
              ...cur,
              browser: { ...cur.browser, dataReceiptAtMs: receiptAt },
              agent: rec.timing ? {
                utteranceVtElapsedMs: rec.timing.utteranceVtElapsedMs ?? null,
                vtSpeechEndToCompleteMs: rec.timing.vtSpeechEndToCompleteMs ?? null,
                vtCompleteToSparkMs: rec.timing.vtCompleteToSparkMs ?? null,
                sparkMs: rec.timing.sparkMs ?? null,
                publishMs: null, // known only after publish resolves; follow-up joins it
                firstTokenMs: rec.timing.firstTokenMs ?? null,
              } : null,
            };
            currentRef.current = joined;
            upsertAttempt(joined);
            finishWithDomCommit(cur.turnId);
          } else if (cur && !rec.diag?.turnId) {
            // A reply arrived without diagnostic correlation: do not guess.
            unmatchedRef.current.push(`unmatched-browser-${receiptAt}`);
          }
        } catch { /* ignore malformed data packets */ }
      });
      room.on(RoomEvent.Disconnected, () => { setConnected(false); setStatus("Disconnected."); });
      await room.connect(url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setConnected(true);
      setStatus("Connected. Speak \u2014 your words will appear below.");
    } catch (err) {
      setStatus(`Could not connect: ${(err as Error).message}`);
    }
  }, [finishWithDomCommit, upsertAttempt]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void roomRef.current?.disconnect();
  }, []);

  const measuredCount = attempts.filter((a) => !a.isWarmup).length;
  const nextIndex = attempts.length === 0 ? 0 : measuredCount + 1; // 0=warm-up
  const nextLabel = attempts.length === 0 ? "warm-up" : nextIndex <= 20 ? `turn ${nextIndex} of 20` : "done (20 measured)";

  const startTurn = useCallback(async () => {
    const room = roomRef.current;
    if (!room || phase !== "idle") return;
    if (attemptsRef.current.length > 0 && attemptsRef.current.filter((a) => !a.isWarmup).length >= 20) {
      setStatus("20 measured turns already recorded. Export the JSON or reset the run.");
      return;
    }
    const timeoutMs = Number(timeoutMsInput);
    timeoutRef.current = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.round(timeoutMs) : 30000;
    const isWarmup = attemptsRef.current.length === 0;
    const index = isWarmup ? 0 : attemptsRef.current.filter((a) => !a.isWarmup).length + 1;
    const attempt: DiagAttempt = {
      turnId: newId("turn"), index, isWarmup, outcome: "missing", pending: true,
      browser: { speechStartProxyAtMs: performance.now(), speechEndProxyAtMs: null, dataReceiptAtMs: null, domCommitAtMs: null },
      agent: null,
    };
    currentRef.current = attempt;
    upsertAttempt(attempt);
    setPhase("speaking");
    setStatus(isWarmup ? "Warm-up: speak now, then click 'Finished speaking'." : `Turn ${index}: speak now, then click 'Finished speaking'.`);
    try {
      const arm = new TextEncoder().encode(JSON.stringify({ type: "arm", runId: runIdRef.current, turnId: attempt.turnId }));
      await room.localParticipant.publishData(arm, { reliable: true, topic: "latency-diag" });
    } catch { /* agent may be absent; the attempt will time out and be counted */ }
  }, [phase, timeoutMsInput, upsertAttempt]);

  const finishedSpeaking = useCallback(() => {
    const cur = currentRef.current;
    if (!cur || phase !== "speaking") return;
    const updated: DiagAttempt = { ...cur, browser: { ...cur.browser, speechEndProxyAtMs: performance.now() } };
    currentRef.current = updated;
    upsertAttempt(updated);
    setPhase("waiting");
    setStatus("Marker recorded (manual proxy). Waiting for the visible reply\u2026");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const c = currentRef.current;
      if (!c || c.turnId !== updated.turnId) return;
      const timed: DiagAttempt = { ...c, pending: false, outcome: "timeout" };
      currentRef.current = null;
      upsertAttempt(timed);
      setPhase("idle");
      setStatus(`Turn timed out after ${timeoutRef.current}ms. It is counted; do not replace it. Start the next turn.`);
    }, timeoutRef.current);
  }, [phase, upsertAttempt]);

  const markFailed = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const failed: DiagAttempt = { ...cur, pending: false, outcome: "failed" };
    currentRef.current = null;
    upsertAttempt(failed);
    setPhase("idle");
    setStatus("Turn marked failed. It is counted; start the next turn.");
  }, [upsertAttempt]);

  const resetRun = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    runIdRef.current = newId("run");
    currentRef.current = null;
    unmatchedRef.current = [];
    syncAttempts([]);
    setPhase("idle");
    setStatus("Diagnostic run reset. Start with the warm-up turn.");
  }, [syncAttempts]);

  const exportJson = useCallback(() => {
    const parseCount = (s: string) => (s.trim() === "" ? null : Number(s));
    const payload = {
      schemaVersion: 1,
      kind: "soulbound-live-latency",
      mode: "live-mic",
      runId: runIdRef.current,
      exportedAt: new Date().toISOString(),
      date: new Date().toISOString(),
      codeRevision: codeRevision || "unspecified",
      browser: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      modelId: modelId ?? "unknown",
      vtEncoding,
      warmupPolicy: "1 warm-up attempt recorded separately and excluded from measured percentiles",
      timeoutMs: timeoutRef.current,
      boundaryDefinition: BOUNDARY,
      percentileMethod: "nearest-rank",
      quality: {
        relevantCount: parseCount(qualityRelevant),
        speakerOkCount: parseCount(qualitySpeaker),
        completeCount: parseCount(qualityComplete),
      },
      unmatchedAgentTurnIds: [...unmatchedRef.current],
      turns: attemptsRef.current.map((a) => ({
        turnId: a.turnId, index: a.index, isWarmup: a.isWarmup,
        outcome: a.pending ? "missing" : a.outcome,
        browser: a.browser, agent: a.agent,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "soulbound-019-live.json";
    link.click();
    URL.revokeObjectURL(href);
    setStatus("Timing JSON downloaded (metadata only). Save it outside the repo, e.g. /tmp/soulbound-019-live.json, then run the report CLI.");
  }, [codeRevision, modelId, vtEncoding, qualityRelevant, qualitySpeaker, qualityComplete]);

  const diagCounts = {
    warmup: attempts.filter((a) => a.isWarmup).length,
    measured: measuredCount,
    success: attempts.filter((a) => !a.isWarmup && a.outcome === "success" && !a.pending).length,
    failed: attempts.filter((a) => !a.isWarmup && a.outcome === "failed").length,
    timeout: attempts.filter((a) => !a.isWarmup && a.outcome === "timeout").length,
  };

  return (
    <main>
      <h1>SOULBOUND</h1>
      <p className="sub">Talk to it and it changes \u2014 and every change is provable.</p>
      <div className="stage">
        <div className="avatar" aria-label="Character placeholder">S</div>
        <div>
          <p className="status" role="status">{status}</p>
          <button onClick={connected ? disconnect : connect}>{connected ? "Leave" : "Join room"}</button>
        </div>
      </div>

      <section aria-label="Latency diagnostic (Ticket 019)" style={{ marginTop: 24, border: "1px solid #2a2f2c", padding: 16 }}>
        <label>
          <input type="checkbox" checked={diagEnabled} onChange={(e) => setDiagEnabled(e.target.checked)} />
          {" "}Latency diagnostic (Ticket 019, opt-in \u2014 pre-TTS baseline, not REQ-40 first-audio)
        </label>
        {diagEnabled && (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#9aa39c" }}>
              One warm-up, then 20 measured turns. Per turn: Start turn \u2192 speak \u2192
              click Finished speaking the instant you stop \u2192 wait for the reply.
              The Finished click is a manual proxy, not true speech-end. Slow/failed
              turns count; never replace them. Export is metadata-only.
            </p>
            <label>Code revision <input value={codeRevision} onChange={(e) => setCodeRevision(e.target.value)} placeholder="git short hash" /></label>
            <label>Timeout (ms, same for every turn) <input value={timeoutMsInput} onChange={(e) => setTimeoutMsInput(e.target.value)} inputMode="numeric" /></label>
            <label>VT encoding <input value={vtEncoding} onChange={(e) => setVtEncoding(e.target.value)} /></label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={startTurn} disabled={!connected || phase !== "idle"}>Start {nextLabel}</button>
              <button onClick={finishedSpeaking} disabled={phase !== "speaking"}>Finished speaking</button>
              <button onClick={markFailed} disabled={phase === "idle"}>Mark failed</button>
              <button onClick={resetRun}>Reset run</button>
              <button onClick={exportJson}>Export timing JSON</button>
            </div>
            <p role="status" style={{ margin: 0, fontSize: 13 }}>
              warm-up: {diagCounts.warmup} \u00b7 measured: {diagCounts.measured}/20 \u00b7
              success: {diagCounts.success} \u00b7 failed: {diagCounts.failed} \u00b7 timeout: {diagCounts.timeout}
              {phase !== "idle" ? ` \u00b7 in progress: ${phase}` : ""}
            </p>
            <fieldset>
              <legend>Aggregate quality counts (review replies locally; counts only in export)</legend>
              <label>Relevant <input value={qualityRelevant} onChange={(e) => setQualityRelevant(e.target.value)} inputMode="numeric" size={4} /></label>{" "}
              <label>Speaker behaviour OK <input value={qualitySpeaker} onChange={(e) => setQualitySpeaker(e.target.value)} inputMode="numeric" size={4} /></label>{" "}
              <label>Complete <input value={qualityComplete} onChange={(e) => setQualityComplete(e.target.value)} inputMode="numeric" size={4} /></label>
            </fieldset>
          </div>
        )}
      </section>

      <section className="log" aria-live="polite">
        {lines.map((line, i) => (
          <div key={i} className={line.reply ? "line reply" : "line"}>
            <span className="who">{line.who}</span>
            {line.text}
          </div>
        ))}
      </section>
    </main>
  );
}

// latency: shared timing types for Ticket 019 (pre-TTS baseline).
// All durations are computed on a single monotonic clock (performance.now)
// within one process. Browser and agent clocks are never subtracted.

export interface VtTiming {
  /** speechStart -> speechComplete on the agent clock. Utterance/VT elapsed, NOT post-speech recognition delay. */
  utteranceElapsedMs: number | null;
  /** VT speechEnd-event receipt -> speechComplete receipt (agent clock). Null when speechEnd was not observed. */
  speechEndToCompleteMs: number | null;
  speechEndToCompleteUnavailableReason: string | null;
  /** Agent performance.now() at speechComplete receipt; used only inside the agent process. */
  vtCompleteAtMs: number | null;
}

export interface AgentTiming {
  utteranceVtElapsedMs: number | null;
  vtSpeechEndToCompleteMs: number | null;
  vtSpeechEndToCompleteUnavailableReason: string | null;
  vtCompleteToSparkMs: number | null;
  vtCompleteToSparkUnavailableReason: string | null;
  sparkMs: number | null;
  firstTokenMs: number | null;
  firstTokenUnavailableReason: string | null;
  publishMs: number | null;
  publishUnavailableReason: string | null;
}

export function elapsedMs(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const d = end - start;
  return d >= 0 ? d : null;
}

export const FIRST_TOKEN_UNAVAILABLE = "first-token unavailable: streaming not enabled in this measurement-only ticket (Ticket 003)";
export const PUBLISH_PENDING = "publish not yet resolved when the turn packet was created";

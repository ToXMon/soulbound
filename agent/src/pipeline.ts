// pipeline: observe -> orient -> decide -> act for one diarized turn.
import { resolveSpeaker, type DiarizedTurn } from "./orient.js";
import { decide } from "./decide.js";
import { act, type TurnRecord } from "./act.js";
import {
  elapsedMs,
  FIRST_TOKEN_UNAVAILABLE,
  PUBLISH_PENDING,
  type AgentTiming,
  type VtTiming,
} from "./latency.js";

export interface RunTurnOptions {
  vtTiming?: VtTiming;
  diag?: { runId: string; turnId: string } | null;
}

// sttMs is preserved from observe (never silently invented here). When the
// caller supplies no VT timing, utterance timing is reported unavailable,
// not zero. Harness callers that pass an explicit 0 (decide-only mode) keep
// that explicit value for the legacy sttToReplyMs field.
export async function runTurn(
  turn: DiarizedTurn,
  sttMs?: number,
  options?: RunTurnOptions,
): Promise<TurnRecord> {
  const kind = resolveSpeaker(turn);
  const vt = options?.vtTiming;
  const sparkRequestAt = performance.now();
  const reply = await decide(turn, kind);
  const vtCompleteToSparkMs = vt?.vtCompleteAtMs != null
    ? elapsedMs(vt.vtCompleteAtMs, sparkRequestAt)
    : null;
  const timing: AgentTiming = {
    utteranceVtElapsedMs: vt ? vt.utteranceElapsedMs : (sttMs !== undefined ? sttMs : null),
    vtSpeechEndToCompleteMs: vt ? vt.speechEndToCompleteMs : null,
    vtSpeechEndToCompleteUnavailableReason: vt
      ? vt.speechEndToCompleteUnavailableReason
      : "VT timing not supplied to pipeline",
    vtCompleteToSparkMs: vtCompleteToSparkMs === null ? null : Math.round(vtCompleteToSparkMs),
    vtCompleteToSparkUnavailableReason:
      vt?.vtCompleteAtMs != null ? null : "VT completion timestamp unavailable",
    sparkMs: Math.round(reply.latencyMs),
    firstTokenMs: null,
    firstTokenUnavailableReason: FIRST_TOKEN_UNAVAILABLE,
    publishMs: null,
    publishUnavailableReason: PUBLISH_PENDING,
  };
  return act(turn, kind, reply, sttMs ?? vt?.utteranceElapsedMs ?? 0, timing, options?.diag ?? null);
}

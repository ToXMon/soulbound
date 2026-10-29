// act: render the reply (UI data channel / log) + per-turn latency record (REQ-40).
import type { DiarizedTurn, SpeakerKind } from "./orient.js";
import type { TurnReply } from "./decide.js";
import type { AgentTiming } from "./latency.js";

export interface TtsTurnStatus {
  status: "ok" | "failed" | "not-configured" | "cancelled";
  provider: string | null;
  sentences: number;
  error: string | null;
}

export interface TurnRecord {
  diarized: boolean;
  speaker: string | null;
  kind: SpeakerKind;
  transcript: string;
  reply: string;
  model: string;
  sttToReplyMs: number;
  timing?: AgentTiming;
  diag?: { runId: string; turnId: string } | null;
  tts?: TtsTurnStatus;
}

export function act(
  turn: DiarizedTurn,
  kind: SpeakerKind,
  reply: TurnReply,
  sttMs: number,
  timing?: AgentTiming,
  diag?: { runId: string; turnId: string } | null,
  tts?: TtsTurnStatus,
): TurnRecord {
  const rec: TurnRecord = {
    diarized: turn.speaker !== null,
    speaker: turn.speaker,
    kind,
    transcript: turn.text,
    reply: reply.text,
    model: reply.model,
    sttToReplyMs: Math.round(sttMs + reply.latencyMs),
    ...(timing ? { timing } : {}),
    ...(diag !== undefined ? { diag } : {}),
    ...(tts ? { tts } : {}),
  };
  console.log(`[turn] diarized=${rec.diarized} speaker=${rec.speaker ?? "?"} kind=${kind} stt->reply=${rec.sttToReplyMs}ms model=${rec.model}`);
  console.log(`[turn] user: ${rec.transcript}`);
  console.log(`[turn] reply: ${rec.reply}`);
  return rec;
}

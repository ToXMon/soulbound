// pipeline: observe -> orient -> decide(stream) -> [reply TTS] -> act.
// Ticket 003 (Tolu verdict 2026-10-29): per-sentence independent synthesis
// changed voice identity within a reply (no persistent Voice Design
// embedding). The combined single-request sample had the best consistency,
// so each reply is now synthesized in ONE TTS request after Spark completes.
// First-sentence overlap was sacrificed for consistency by that decision;
// Spark tokens still stream for timing. TTS failure never loses the text
// reply. Without TTS deps (harness), behavior is the streamed text path only.
import { resolveSpeaker, type DiarizedTurn, type SpeakerKind } from "./orient.js";
import { decideStream, type StreamCallbacks, type TurnReply } from "./decide.js";
import { act, type TurnRecord, type TtsTurnStatus } from "./act.js";
import {
  elapsedMs,
  PUBLISH_PENDING,
  type AgentTiming,
  type VtTiming,
} from "./latency.js";
import { SentenceAssembler } from "./tts-core.js";
import type { AudioSink, TTSProvider, TtsVoiceConfig } from "./tts.js";

export type StreamReplyFn = (
  turn: DiarizedTurn,
  kind: SpeakerKind,
  cb?: StreamCallbacks,
) => Promise<TurnReply>;

export interface RunTurnOptions {
  vtTiming?: VtTiming;
  diag?: { runId: string; turnId: string } | null;
  tts?: TTSProvider | null;
  voice?: TtsVoiceConfig;
  sink?: AudioSink | null;
  /** Cancels Spark + TTS for this turn (new turn / disconnect / shutdown). */
  signal?: AbortSignal;
  /** Test seam: defaults to the real Spark streaming call. */
  streamReply?: StreamReplyFn;
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
  const provider = options?.tts ?? null;
  const sink = options?.sink ?? null;
  const voice = options?.voice ?? { description: "", seed: null };
  const ttsEnabled = Boolean(provider && sink && voice.description.trim());
  const streamReply = options?.streamReply ?? decideStream;

  const sparkRequestAt = performance.now();
  let firstTokenAt: number | null = null;
  let firstSentenceAt: number | null = null;
  let firstTtsChunkAt: number | null = null;
  let firstAudioPublishAt: number | null = null;

  const assembler = new SentenceAssembler();
  const reply = await streamReply(turn, kind, {
    signal: options?.signal,
    onFirstToken: () => { if (firstTokenAt === null) firstTokenAt = performance.now(); },
    onDelta: (delta) => {
      if (firstSentenceAt !== null) return;
      if (assembler.push(delta).length > 0) firstSentenceAt = performance.now();
    },
  });
  if (firstSentenceAt === null && assembler.flush().length > 0) {
    firstSentenceAt = performance.now();
  }

  let ttsStatus: TtsTurnStatus = ttsEnabled
    ? { status: "ok", provider: provider!.name, sentences: 0, error: null }
    : { status: "not-configured", provider: provider?.name ?? null, sentences: 0, error: null };
  const ttsStartedAt = performance.now();
  if (ttsEnabled) {
    try {
      if (options?.signal?.aborted) throw new Error("AbortError");
      // ONE request for the whole reply (voice consistency verdict).
      let published = false;
      for await (const chunk of provider!.synthesize({
        text: reply.text,
        voiceDescription: voice.description,
        seed: voice.seed,
        signal: options?.signal,
        onFirstChunk: () => {
          if (firstTtsChunkAt === null) firstTtsChunkAt = performance.now();
        },
      })) {
        await sink!.publishPcm(chunk, options?.signal);
        if (!published) {
          published = true;
          if (firstAudioPublishAt === null) firstAudioPublishAt = performance.now();
        }
      }
      const flushable = sink as AudioSink & { flush?: (s?: AbortSignal) => Promise<void> };
      if (flushable.flush) await flushable.flush(options?.signal);
      ttsStatus = { status: "ok", provider: provider!.name, sentences: 1, error: null };
    } catch (e) {
      const aborted = options?.signal?.aborted || (e as Error).name === "AbortError";
      ttsStatus = {
        status: aborted ? "cancelled" : "failed",
        provider: provider!.name,
        sentences: 0,
        error: aborted ? "cancelled" : (e as Error).message,
      };
      try { sink!.clear(); } catch { /* best effort */ }
    }
  }
  const ttsMs = ttsEnabled ? Math.round(performance.now() - ttsStartedAt) : null;
  if (ttsEnabled && ttsStatus.status === "ok") {
    console.log(`[tts] provider=${ttsStatus.provider} requests=1 seed=${voice.seed ?? "none"}`);
  } else if (ttsEnabled) {
    console.log(`[tts] FAILED status=${ttsStatus.status} error=${ttsStatus.error ?? ""} (text reply preserved)`);
  }

  const vtCompleteToSparkMs = vt?.vtCompleteAtMs != null
    ? elapsedMs(vt.vtCompleteAtMs, sparkRequestAt)
    : null;
  const rel = (at: number | null) => {
    const v = at === null ? null : elapsedMs(sparkRequestAt, at);
    return v === null ? null : Math.round(v);
  };
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
    firstTokenMs: rel(firstTokenAt),
    firstTokenUnavailableReason: firstTokenAt === null ? "Spark stream produced no token" : null,
    publishMs: null,
    publishUnavailableReason: PUBLISH_PENDING,
    sparkFirstTokenMs: rel(firstTokenAt),
    sparkFirstTokenUnavailableReason: firstTokenAt === null ? "Spark stream produced no token" : null,
    firstSentenceMs: rel(firstSentenceAt),
    firstSentenceUnavailableReason: firstSentenceAt === null ? "no complete sentence emitted" : null,
    firstTtsChunkMs: rel(firstTtsChunkAt),
    firstTtsChunkUnavailableReason: ttsEnabled
      ? (firstTtsChunkAt === null ? "no TTS chunk received" : null)
      : "TTS not configured",
    firstAudioPublishMs: rel(firstAudioPublishAt),
    firstAudioPublishUnavailableReason: ttsEnabled
      ? (firstAudioPublishAt === null ? "no PCM frame published" : null)
      : "TTS not configured",
    ttsMs,
    ttsUnavailableReason: ttsEnabled ? null : "TTS not configured",
  };
  return act(turn, kind, reply, sttMs ?? vt?.utteranceElapsedMs ?? 0, timing, options?.diag ?? null, ttsStatus);
}

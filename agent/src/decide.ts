// decide: Muse Spark via the OpenAI SDK against the Meta Model API.
// Model purity: muse-spark-1.3 only; never a -contributor variant.
import OpenAI from "openai";
import type { ChatCompletionReasoningEffort } from "openai/resources/chat/completions";
import { systemPrompt, type DiarizedTurn, type SpeakerKind } from "./orient.js";

export interface TurnReply {
  text: string;
  model: string;
  latencyMs: number;
}

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Voice latency (REQ-40): Spark reasons invisibly before the first visible
 * token (~700 reasoning tokens ≈ 3.9 s TTFT at the model default, measured
 * 2026-10-29). `reasoning_effort=minimal` cut that to ~75 tokens ≈ 1.1 s
 * with no visible-reply loss on short persona turns. The nested
 * `reasoning:{effort}` object is rejected on this surface (HTTP 400);
 * `none` is rejected for muse-spark-1.3. Env-overridable for experiments.
 */
// The installed OpenAI SDK types only allow low|medium|high here; Meta
// accepts minimal|xhigh|max too, hence the scoped cast at call sites.
export function reasoningEffort(): ReasoningEffort {
  const raw = process.env.MODEL_REASONING_EFFORT ?? "minimal";
  if (!(REASONING_EFFORTS as readonly string[]).includes(raw)) {
    throw new Error(`MODEL_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join("|")} (got "${raw}")`);
  }
  return raw as ReasoningEffort;
}

let client: OpenAI | null = null;

function spark(): OpenAI {
  const apiKey = process.env.MODEL_API_KEY ?? process.env.META_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY (or META_API_KEY) is not set (see .env.example)");
  client ??= new OpenAI({
    apiKey,
    baseURL: process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1",
  });
  return client;
}

export interface StreamCallbacks {
  onFirstToken?: () => void;
  onDelta?: (delta: string) => void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * Streaming variant (Ticket 003): yields the assembled reply while invoking
 * onDelta per token delta so the pipeline can start TTS on the first complete
 * sentence. Final assembled text/model semantics match decide().
 */
export async function decideStream(
  turn: DiarizedTurn,
  kind: SpeakerKind,
  cb: StreamCallbacks = {},
): Promise<TurnReply> {
  const model = process.env.MODEL_NAME ?? "muse-spark-1.3";
  if (model.includes("contributor")) throw new Error(`refusing contributor-tier model: ${model}`);
  const t0 = performance.now();
  const stream = await spark().chat.completions.create(
    {
      model,
      stream: true,
      reasoning_effort: reasoningEffort() as unknown as ChatCompletionReasoningEffort,
      messages: [
        { role: "system", content: systemPrompt(kind) },
        { role: "user", content: turn.text },
      ],
    },
    cb.signal ? { signal: cb.signal } : undefined,
  );
  let text = "";
  let first = true;
  let resolvedModel = model;
  for await (const chunk of stream) {
    if (chunk.model) resolvedModel = chunk.model;
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (!delta) continue;
    if (first) { first = false; cb.onFirstToken?.(); }
    text += delta;
    await cb.onDelta?.(delta);
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Spark returned an empty reply");
  return { text: trimmed, model: resolvedModel, latencyMs: performance.now() - t0 };
}

export async function decide(turn: DiarizedTurn, kind: SpeakerKind): Promise<TurnReply> {
  const model = process.env.MODEL_NAME ?? "muse-spark-1.3";
  if (model.includes("contributor")) throw new Error(`refusing contributor-tier model: ${model}`);
  const t0 = performance.now();
  const res = await spark().chat.completions.create({
    model,
    reasoning_effort: reasoningEffort() as unknown as ChatCompletionReasoningEffort,
    messages: [
      { role: "system", content: systemPrompt(kind) },
      { role: "user", content: turn.text },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Spark returned an empty reply");
  return { text, model: res.model ?? model, latencyMs: performance.now() - t0 };
}

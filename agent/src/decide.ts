// decide: Muse Spark via the OpenAI SDK against the Meta Model API.
// Model purity: muse-spark-1.3 only; never a -contributor variant.
import OpenAI from "openai";
import { systemPrompt, type DiarizedTurn, type SpeakerKind } from "./orient.js";

export interface TurnReply {
  text: string;
  model: string;
  latencyMs: number;
}

let client: OpenAI | null = null;

function spark(): OpenAI {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set (see .env.example)");
  client ??= new OpenAI({
    apiKey,
    baseURL: process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1",
  });
  return client;
}

export async function decide(turn: DiarizedTurn, kind: SpeakerKind): Promise<TurnReply> {
  const model = process.env.MODEL_NAME ?? "muse-spark-1.3";
  if (model.includes("contributor")) throw new Error(`refusing contributor-tier model: ${model}`);
  const t0 = performance.now();
  const res = await spark().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt(kind) },
      { role: "user", content: turn.text },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Spark returned an empty reply");
  return { text, model: res.model ?? model, latencyMs: performance.now() - t0 };
}

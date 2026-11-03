// Ticket 008. Real Spark vision path (muse-spark-1.3 via Meta Model API,
// OpenAI-compatible). Structured output only; never parse free text. Without
// MODEL_API_KEY the client throws VisionNotConfigured — no observation is
// ever fabricated.
import { VisionUnavailable } from "./frame.js";
import { VisionNotConfigured } from "./sam.js";

export interface SparkVisionConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface SparkObservationOutput {
  object_label: string;
  observation: string;
  confidence: number;
}

/** Output-token ceiling: bounds billed Spark output on every observation call. */
export const VISION_OBSERVATION_MAX_TOKENS = 1024;

export const VISION_OBSERVATION_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["object_label", "observation", "confidence"],
  properties: {
    object_label: { type: "string", maxLength: 128 },
    observation: { type: "string", maxLength: 500 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

/** Pure request builder — unit-testable without any network. The data-URL MIME
 * must be the envelope's validated mime (the browser trigger sends JPEG). */
export function buildObservationRequest(input: {
  model: string; frameBase64: string; maskRef: string; frameHash: string; mime?: string;
}) {
  const mime = input.mime ?? "image/png";
  return {
    model: input.model,
    messages: [
      {
        role: "system",
        content:
          "You are the vision observer for a persistent character. Given one explicitly captured frame and its segmentation mask reference, identify the single most salient object. Return only structured JSON matching the schema. Do not identify people or faces.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `frame_hash=${input.frameHash} mask_ref=${input.maskRef}` },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${input.frameBase64}` },
          },
        ],
      },
    ],
    max_tokens: VISION_OBSERVATION_MAX_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: { name: "soulbound_vision_observation_v1", strict: true, schema: VISION_OBSERVATION_JSON_SCHEMA },
    },
  };
}

export interface SparkObserver {
  observe(req: ReturnType<typeof buildObservationRequest>): Promise<SparkObservationOutput>;
}

export function createSparkObserver(config: SparkVisionConfig): SparkObserver {
  return {
    async observe(req) {
      if (!config.apiKey) {
        throw new VisionNotConfigured("MODEL_API_KEY/META_API_KEY is not set in this session's env; Spark vision inference is blocked (no billable call attempted)");
      }
      const model = req.model;
      if (model.endsWith("-contributor")) {
        throw new VisionNotConfigured("contributor model variants are forbidden for frame data");
      }
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: config.apiKey,
        // Same precedence as the proven memory extractor (extract.ts):
        // explicit config, then MODEL_API_BASE_URL, then the Meta Model API.
        baseURL: config.baseUrl ?? process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1",
        maxRetries: 0, // Ticket 008: no automatic SDK retries — one accepted trigger = one billable call
      });
      const res = await client.chat.completions.create({ ...req, model } as never);
      const text = res.choices[0]?.message?.content;
      if (!text) throw new VisionUnavailableFromSpark("Spark returned no observation content");
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new VisionUnavailableFromSpark("Spark observation was not JSON"); }
      return validateSparkObservation(parsed);
    },
  };
}

export class VisionUnavailableFromSpark extends VisionNotConfigured {}

export function validateSparkObservation(raw: unknown): SparkObservationOutput {
  const o = raw as Record<string, unknown>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new VisionUnavailableFromSpark("observation not an object");
  const keys = Object.keys(o);
  for (const k of keys) if (!["object_label", "observation", "confidence"].includes(k))
    throw new VisionUnavailableFromSpark(`unknown field "${k}"`);
  if (typeof o.object_label !== "string" || !o.object_label.trim() || o.object_label.length > 128)
    throw new VisionUnavailableFromSpark("bad object_label");
  if (typeof o.observation !== "string" || !o.observation.trim() || o.observation.length > 500)
    throw new VisionUnavailableFromSpark("bad observation");
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1)
    throw new VisionUnavailableFromSpark("bad confidence");
  return { object_label: o.object_label, observation: o.observation, confidence: o.confidence };
}

// Ticket 008. Agent-side handler for the browser `vision-frame` LiveKit data
// topic. One accepted envelope = exactly one SAM call + one Spark call, zero
// frame buffers in every exit path, persistence only through the existing
// MemoryStore path (and only when the caller supplies it, i.e. memory is
// enabled), and a metadata-only `vision-observation` publish back to the
// browser. Never the reverse: no observation without an accepted trigger,
// no frame or mask bytes persisted or published.
//
// Security posture (owner decision docs/008-scope-amendment.md):
// - RoomEvent.DataReceived hands us an optional RemoteParticipant whose only
//   identity is the self-asserted `?name=` the token endpoint signed for any
//   guest. This is participant-triggered demo access, NOT owner
//   authentication: any connected participant with a nonempty identity may
//   trigger one frame. Identity is taken ONLY from the LiveKit participant,
//   never from the payload (the envelope has no identity field; unknown
//   fields are rejected).
// - Per-sender serialization (SenderInflightGate) bounds concurrent billed
//   inference calls; envelope validation bounds size/shape/MIME.
// - Raw frame bytes without a JSON envelope are rejected: without a
//   trigger_id the REQ-44 provenance proof cannot be established.
import { runTriggeredObservation } from "./observe.js";
import { MAX_MASK_RASTER_DIM, MAX_MASK_SVG_CHARS, type MaskOverlay, type SamSegmenter } from "./sam.js";
import type { SparkObserver } from "./spark.js";
import type { VisionObservationRecord } from "../memory/observation.js";
import type { VisionSidecarEntry } from "../memory/vision-sidecar.js";

export const VISION_FRAME_TOPIC = "vision-frame";
export const VISION_OBSERVATION_TOPIC = "vision-observation";

/** Largest accepted frame after base64 decode (8 MiB covers a 4K JPEG). */
export const MAX_FRAME_BYTES = 8_000_000;
/** Largest accepted data payload (base64 inflates ~4/3 plus JSON framing). */
export const MAX_ENVELOPE_BYTES = 12_000_000;
/** Largest accepted base64 text before decode. */
export const MAX_BASE64_CHARS = 11_000_000;
export const MAX_TRIGGER_ID_CHARS = 128;
export const ALLOWED_VISION_MIME = ["image/png", "image/jpeg"] as const;

const ENVELOPE_KEYS = ["version", "trigger_id", "mime", "image_base64"] as const;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const PRINTABLE_RE = /^[ -~]+$/;

export class VisionFrameRejected extends Error {
  constructor(readonly code: string, detail: string) {
    super(`vision-frame rejected (${code}): ${detail}`);
  }
}

export interface ParsedVisionFrame {
  frame: Uint8Array;
  triggerId: string;
  mime: string;
}

/** Strict envelope validation. Throws VisionFrameRejected; never returns
 * frame bytes alongside an error. Bounds every field before decoding. */
export function parseVisionFrameEnvelope(payload: Uint8Array): ParsedVisionFrame {
  if (!(payload instanceof Uint8Array) || payload.byteLength === 0) {
    throw new VisionFrameRejected("empty-payload", "no bytes received");
  }
  if (payload.byteLength > MAX_ENVELOPE_BYTES) {
    throw new VisionFrameRejected("envelope-too-large", `payload ${payload.byteLength}B exceeds ${MAX_ENVELOPE_BYTES}B`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new VisionFrameRejected("envelope-required", "payload is not JSON; raw frame bytes are never accepted without a trigger envelope");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new VisionFrameRejected("bad-envelope", "envelope must be an object");
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(ENVELOPE_KEYS as readonly string[]).includes(k)) {
      throw new VisionFrameRejected("bad-envelope", `unknown field "${k}"`);
    }
  }
  if (o.version !== 1) throw new VisionFrameRejected("bad-version", "envelope version must be 1");
  const triggerId = o.trigger_id;
  if (typeof triggerId !== "string" || !triggerId || triggerId.length > MAX_TRIGGER_ID_CHARS || !PRINTABLE_RE.test(triggerId)) {
    throw new VisionFrameRejected("bad-trigger-id", "trigger_id must be 1..128 printable chars");
  }
  if (typeof o.mime !== "string" || !(ALLOWED_VISION_MIME as readonly string[]).includes(o.mime)) {
    throw new VisionFrameRejected("bad-mime", `mime must be one of ${(ALLOWED_VISION_MIME as readonly string[]).join(", ")}`);
  }
  const b64 = o.image_base64;
  if (typeof b64 !== "string" || !b64 || b64.length > MAX_BASE64_CHARS || !BASE64_RE.test(b64) || b64.length % 4 !== 0) {
    throw new VisionFrameRejected("bad-image", "image_base64 must be bounded, padded base64");
  }
  let frame: Uint8Array;
  try {
    frame = new Uint8Array(Buffer.from(b64, "base64"));
  } catch {
    throw new VisionFrameRejected("bad-image", "image_base64 did not decode");
  }
  if (frame.length === 0 || frame.length > MAX_FRAME_BYTES) {
    throw new VisionFrameRejected("frame-out-of-bounds", `decoded frame ${frame.length}B outside 1..${MAX_FRAME_BYTES}B`);
  }
  return { frame, triggerId, mime: o.mime as string };
}

/** Participant identity check. Only a nonempty LiveKit sender identity may
 * trigger; missing/empty identity is rejected. There is no allowlist: per the
 * owner scope decision this is participant demo access, not owner
 * authentication. */
export function isKnownSender(identity: string | null | undefined): boolean {
  return typeof identity === "string" && identity.length > 0;
}

/** One in-flight vision request per sender: a second trigger from the same
 * sender while one is running is rejected (`trigger-in-flight`), so a guest
 * cannot stack unbounded billed inference calls. Bounded sender count; the
 * default shared instance serves the worker, tests inject a fresh gate. */
export class SenderInflightGate {
  private readonly inflight = new Set<string>();
  constructor(private readonly maxSenders = 1024) {}
  tryAcquire(sender: string): boolean {
    if (this.inflight.has(sender)) return false;
    if (this.inflight.size >= this.maxSenders) return false;
    this.inflight.add(sender);
    return true;
  }
  release(sender: string): void {
    this.inflight.delete(sender);
  }
  get size(): number {
    return this.inflight.size;
  }
}

const sharedGate = new SenderInflightGate();

export interface VisionFrameDeps {
  sam: SamSegmenter;
  spark: SparkObserver;
  characterId: string;
  /** Publish metadata-only bytes on `vision-observation`. */
  publish: (data: Uint8Array) => Promise<void>;
  /** Existing MemoryStore path only; omit when memory is disabled. Resolves
   * the created memory record id so the sidecar can key provenance to it. */
  persist?: (record: VisionObservationRecord) => Promise<string>;
  /** Provenance sidecar link; omit only when memory is disabled. Runs after
   * persist resolves and before publish: publish implies durable linkage. */
  linkSidecar?: (entry: VisionSidecarEntry) => Promise<void>;
  gate?: SenderInflightGate;
  now?: Date;
  /** Called once with the validated record after persistence succeeded and
   * just before the observation is published. Session-only consumers (the
   * character talking about what it saw); must not throw into the pipeline. */
  onObservation?: (record: VisionObservationRecord) => void;
}

export type VisionFrameOutcome =
  | { ok: true; frameHash: string; triggerId: string; durable: boolean }
  | { ok: false; code: string };

/** Stable bounded failure codes the worker may report after a trigger is
 * established. Deliberately coarse: no error text, no internals, no content. */
export const VISION_FAILURE_CODES = ["observation-failed", "persist-failed", "sidecar-failed"] as const;
export type VisionFailureCode = (typeof VISION_FAILURE_CODES)[number];

/** Metadata-only failure packet. Carries ONLY the original trigger_id (so the
 * browser can correlate) plus one stable code. Never frame bytes, base64,
 * labels, summaries, or error text. */
export function toFailureMessage(triggerId: string, code: VisionFailureCode): Record<string, unknown> {
  return { trigger_id: triggerId, error: code };
}

/** Metadata-only browser message. Never carries frame bytes or base64; the
 * optional mask_overlay is the mask's actual vector outline plus its own
 * source-frame bounds for placement (transient response only — never
 * persisted, logged, or stored). bbox is four display numbers (the fallback
 * highlight), not mask content, and is never overlay geometry. */
export function toObservationMessage(
  record: VisionObservationRecord,
  durable = false,
  overlay?: MaskOverlay | null,
): Record<string, unknown> {
  // Re-validated at the message boundary: a malformed overlay is dropped and
  // the bbox highlight remains, never a broken render. Bounds travel with
  // the outline — the browser places the SVG from these, never the bbox.
  const maskOverlay = isTransportableOverlay(overlay)
    ? {
      svg: overlay.svg,
      width: overlay.width,
      height: overlay.height,
      left: overlay.left,
      top: overlay.top,
      right: overlay.right,
      bottom: overlay.bottom,
    }
    : undefined;
  return {
    object_label: record.object_label,
    summary: record.summary,
    confidence: record.confidence,
    frame_hash: record.frame_hash,
    mask_ref: record.mask_ref,
    trigger_id: record.trigger_id,
    synthetic: record.synthetic,
    durable,
    ...(record.bbox ? { bbox: [...record.bbox] } : {}),
    ...(maskOverlay ? { mask_overlay: maskOverlay } : {}),
  };
}

const SVG_PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;

/** Message-boundary overlay check: bounded dims, bounded path text with a
 * closed path-data charset, explicit source bounds with EXACT raster
 * correspondence ((right-left) === width, (bottom-top) === height), no frame
 * content. Mirrors the browser's own validation so malformed overlays never
 * reach the wire. */
export function isTransportableOverlay(overlay: unknown): overlay is MaskOverlay {
  if (!overlay || typeof overlay !== "object") return false;
  const o = overlay as Record<string, unknown>;
  if (typeof o.svg !== "string" || o.svg.length === 0 || o.svg.length > MAX_MASK_SVG_CHARS || !SVG_PATH_RE.test(o.svg)) {
    return false;
  }
  if (!Number.isInteger(o.width) || (o.width as number) < 1 || (o.width as number) > MAX_MASK_RASTER_DIM) return false;
  if (!Number.isInteger(o.height) || (o.height as number) < 1 || (o.height as number) > MAX_MASK_RASTER_DIM) return false;
  const { left, top, right, bottom } = o;
  if (![left, top, right, bottom].every((n) => Number.isInteger(n) && Number.isFinite(n as number))) return false;
  const l = left as number, t = top as number, r = right as number, b = bottom as number;
  if (l < 0 || t < 0 || r <= l || b <= t) return false;
  return r - l === (o.width as number) && b - t === (o.height as number);
}

/** Handle one `vision-frame` payload. Exactly one SAM + one Spark call per
 * accepted frame, no retries of billed calls; the frame buffer is zeroed in
 * every exit path (runTriggeredObservation owns the buffer after parse).
 * Durability contract (docs/008-scope-amendment.md): persist runs through the
 * existing store, the sidecar links provenance to the created record id,
 * and ONLY then does the observation publish. A persist or sidecar failure
 * returns ok:false and publishes only a failure packet — a durable success is
 * never reported without durable linkage. Without persist (memory disabled)
 * the observation still publishes, but the outcome reports durable:false.
 * Failure contract: once the trigger is established (envelope parsed), an
 * observation/persist/sidecar failure publishes a metadata-only failure
 * packet (trigger_id + stable code), so the browser shows a failure status
 * instead of waiting forever. Pre-trigger rejections stay silent: with no
 * established trigger there is nothing to correlate. */
export async function handleVisionFrame(
  payload: Uint8Array,
  senderIdentity: string | null | undefined,
  deps: VisionFrameDeps,
): Promise<VisionFrameOutcome> {
  if (!isKnownSender(senderIdentity)) {
    return { ok: false, code: "unknown-sender" };
  }
  if (!deps.characterId) return { ok: false, code: "vision-identity-unconfigured" };
  const sender = senderIdentity as string;
  const gate = deps.gate ?? sharedGate;
  if (!gate.tryAcquire(sender)) {
    return { ok: false, code: "trigger-in-flight" };
  }
  try {
    let parsed: ParsedVisionFrame;
    try {
      parsed = parseVisionFrameEnvelope(payload);
    } catch (e) {
      return { ok: false, code: e instanceof VisionFrameRejected ? e.code : "bad-envelope" };
    }
    // The trigger is established: later failures notify the browser with a
    // metadata-only packet. Best-effort — if the transport itself is broken
    // the notify throws too, and the original code is still returned.
    const notifyFailure = async (code: VisionFailureCode): Promise<void> => {
      try {
        await deps.publish(new TextEncoder().encode(JSON.stringify(toFailureMessage(parsed.triggerId, code))));
      } catch (e) {
        console.log(`[vision] failure-notify failed trigger=${parsed.triggerId} error=${(e as Error).message}`);
      }
    };
    let record: VisionObservationRecord;
    let overlay: MaskOverlay | null = null;
    try {
      ({ record, overlay } = await runTriggeredObservation(parsed.frame, {
        sam: deps.sam,
        spark: deps.spark,
        characterId: deps.characterId,
        triggerId: parsed.triggerId,
        mime: parsed.mime, // envelope-validated; the Spark data URL must match the bytes
        now: deps.now,
      }));
    } catch (e) {
      // Frame already zeroed by runTriggeredObservation; nothing persisted.
      // Log carries trigger id + error, never frame bytes.
      console.log(`[vision] observation failed trigger=${parsed.triggerId} error=${(e as Error).message}`);
      await notifyFailure("observation-failed");
      return { ok: false, code: "observation-failed" };
    }
    let durable = false;
    if (deps.persist) {
      let recordId: string;
      try {
        recordId = await deps.persist(record);
      } catch (e) {
        console.log(`[vision] persist failed frame=${record.frame_hash} error=${(e as Error).message}`);
        await notifyFailure("persist-failed");
        return { ok: false, code: "persist-failed" };
      }
      if (deps.linkSidecar) {
        try {
          await deps.linkSidecar({
            schema_version: 1,
            record_id: recordId,
            character_id: deps.characterId,
            frame_hash: record.frame_hash,
            mask_ref: record.mask_ref,
            timestamp: record.timestamp,
            trigger_id: record.trigger_id,
          });
        } catch (e) {
          console.log(`[vision] sidecar failed record=${recordId} error=${(e as Error).message}`);
          await notifyFailure("sidecar-failed");
          return { ok: false, code: "sidecar-failed" };
        }
        durable = true;
      }
    }
    try { deps.onObservation?.(record); } catch (e) { console.log(`[vision] onObservation failed: ${(e as Error).message}`); }
    try {
      // Overlay travels ONLY in this correlated response: transient browser
      // highlight, never persisted, sidecar-stored, logged, or memorized.
      await deps.publish(new TextEncoder().encode(JSON.stringify(toObservationMessage(record, durable, overlay))));
    } catch (e) {
      console.log(`[vision] publish failed frame=${record.frame_hash} error=${(e as Error).message}`);
      return { ok: false, code: "publish-failed" };
    }
    return { ok: true, frameHash: record.frame_hash, triggerId: record.trigger_id, durable };
  } finally {
    gate.release(sender);
  }
}

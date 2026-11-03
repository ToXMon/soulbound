// Ticket 008. Browser-side trigger gate. Pure logic: no React/DOM imports, so
// the REQ-43 "nothing happens before explicit trigger" contract is testable
// offline. All hardware/network access is injected by the caller.
//
// Wire contract with the agent (`vision-frame` topic): each explicit click
// mints a fresh cryptographic trigger id; the frame is published ONCE as a
// bounded JSON envelope {version, trigger_id, mime, image_base64}. The agent
// echoes trigger_id back on `vision-observation` — either a metadata-only
// observation (with a durable flag) or a metadata-only failure packet
// {trigger_id, error} — and only a response whose trigger_id matches the
// outstanding trigger is surfaced. A new look() or discard() invalidates any
// older response.

export interface SingleFrameSource {
  cancel?(): void;
  /** Enable the camera, capture exactly one frame, stop all tracks, return
   * raw JPEG frame bytes.  VisionTrigger.look() builds the bounded envelope
   * via buildVisionFrameEnvelope to enforce the 48 KiB bound for ANY
   * injected source (Ticket 034).
   * triggerId is optional — when provided the source may use it for
   * exact envelope sizing in its internal candidate loop; when absent the
   * source must still return a frame that fits after envelope wrapping.
   * Implementations must not stream or retain raw frame bytes beyond the
   * returned Uint8Array. */
  capture(triggerId?: string): Promise<Uint8Array>;
}
export interface VisionFrameTransport {
  /** Publish one envelope. triggerId is passed alongside so transports that
   * need it (logging-free diagnostics excluded) can correlate without
   * re-parsing. The envelope is always a freshly encoded ArrayBuffer-backed
   * array (TextEncoder output), matching what LiveKit publishData accepts. */
  publishFrame(data: Uint8Array, triggerId: string): Promise<void>;
}

export type VisionStatus = "idle" | "capturing" | "sent" | "observed" | "failed" | "unavailable";

/** Why a look ended "unavailable". Stable, non-sensitive categories only. */
export type VisionUnavailableReason =
  | "camera-denied" | "no-camera" | "camera-unavailable" | "camera-prompt" | "camera-busy" | "camera-no-frames" | "camera-playback" | "camera-draw" | "camera-encode" | "camera-timeout" | "camera-preview" | "frame-too-large"
  | "send-failed" | "no-response" | "disconnected" | "unknown";

export function classifyVisionError(e: unknown): VisionUnavailableReason {
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (name === "NotAllowedError" || name === "SecurityError") return "camera-denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-camera";
  if (name === "NotReadableError") return "camera-busy";
  if (/camera-acquire:NotAllowedError|camera-acquire:SecurityError/.test(msg)) return "camera-denied";
  if (/camera-acquire:NotFoundError|camera-acquire:OverconstrainedError/.test(msg)) return "no-camera";
  if (/camera-acquire:NotReadableError/.test(msg)) return "camera-busy";
  if (/camera-acquire:(TypeError|NotSupportedError)/.test(msg)) return "camera-unavailable";
  if (/camera-acquire-timeout/.test(msg)) return "camera-prompt";
  if (/camera-playback/.test(msg)) return "camera-playback";
  if (/camera-draw/.test(msg)) return "camera-draw";
  if (/camera-encode/.test(msg)) return "camera-encode";
  if (/camera-preview/.test(msg)) return "camera-preview";
  if (/camera-no-frames/.test(msg)) return "camera-no-frames";
  if (/capture cancelled/.test(msg)) return "disconnected";
  if (/capture timeout/.test(msg)) return "camera-timeout";
  if (/camera-frame-too-large/.test(msg)) return "frame-too-large";
  if (/exceeds|too large|fit/i.test(msg)) return "frame-too-large";
  if (/publish timeout/.test(msg)) return "send-failed";
  if (/disconnected/.test(msg)) return "disconnected";
  return "unknown";
}

/** Stable agent failure codes the worker may report after a trigger is
 * established. Coarse by design: no error text, no internals, no content. */
export const VISION_FAILURE_CODES = ["observation-failed", "persist-failed", "sidecar-failed"] as const;

export interface VisionMaskOverlay {
  /** SVG path in raster-pixel space (viewBox `0 0 width height`). Actual SAM
   * parser output, transient: held in view state only, dropped on
   * discard/re-look. Never persisted anywhere.
   * left/top/right/bottom are the parser's source-frame bounds for placement:
   * the UI positions the SVG from THESE, never from the observation bbox, and
   * requires (right-left) === width and (bottom-top) === height. */
  svg: string;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Same placement contract as the worker: integer finite ordered bounds with
 * exact raster correspondence, or the overlay is dropped (bbox fallback). */
export function isValidMaskOverlay(overlay: unknown): overlay is VisionMaskOverlay {
  if (!overlay || typeof overlay !== "object") return false;
  const o = overlay as Record<string, unknown>;
  if (typeof o.svg !== "string" || !o.svg || o.svg.length > MAX_MASK_SVG_CHARS || !SVG_PATH_RE.test(o.svg)) {
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

export interface VisionObservationView {
  object_label: string;
  summary: string;
  confidence: number;
  frame_hash: string;
  mask_ref: string;
  trigger_id: string;
  synthetic: boolean;
  durable: boolean;
  bbox?: [number, number, number, number];
  /** Present only when the worker could transport the mask safely; otherwise
   * the UI falls back to the bbox highlight and says so. */
  mask_overlay?: VisionMaskOverlay;
}

/** Transport bounds mirror the agent's message boundary: oversized or
 * malformed overlays are dropped and the bbox highlight remains. */
export const MAX_MASK_SVG_CHARS = 16_384;
export const MAX_MASK_RASTER_DIM = 1024;
const SVG_PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;

/** Envelope version the agent handler accepts. */
export const VISION_ENVELOPE_VERSION = 1;
/** Hard 48 KiB envelope bound (Ticket 034).  Frames whose JSON/base64
 * envelope exceeds this limit are rejected before transport.  The same
 * constant gates buildVisionFrameEnvelope and the browser capture path. */
export const MAX_VISION_ENVELOPE_BYTES = 49152;

/** Pre-check guard on raw frame bytes before base64 encoding (same value as
 * MAX_VISION_ENVELOPE_BYTES — any frame this large will never fit after
 * base64 expansion).  The real gate is the post-encode envelope check. */
export const MAX_VISION_FRAME_BYTES = 49152;
export const ALLOWED_VISION_MIME = ["image/png", "image/jpeg"] as const;

export class VisionEnvelopeError extends Error {}

const PRINTABLE_RE = /^[ -~]+$/;

/** Fresh trigger id per explicit click. crypto.randomUUID when available,
 * otherwise 128 bits from getRandomValues formatted as UUID. */
export function newTriggerId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) throw new VisionEnvelopeError("no cryptographic randomness available");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Chunked bytes→base64: a single btoa(String.fromCharCode(...bytes)) call
 * overflows the argument list on multi-megabyte frames. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/** Pure envelope builder — throws VisionEnvelopeError on anything the agent
 * would reject, so malformed/oversized frames fail closed before transport. */
export function buildVisionFrameEnvelope(
  frame: Uint8Array,
  triggerId: string,
  mime: string,
): Uint8Array<ArrayBuffer> {
  if (!(frame instanceof Uint8Array) || frame.length === 0) {
    throw new VisionEnvelopeError("empty frame");
  }
  if (frame.length > MAX_VISION_FRAME_BYTES) {
    throw new VisionEnvelopeError(`frame ${frame.length}B exceeds ${MAX_VISION_FRAME_BYTES}B`);
  }
  if (typeof triggerId !== "string" || !triggerId || triggerId.length > 128 || !PRINTABLE_RE.test(triggerId)) {
    throw new VisionEnvelopeError("bad trigger_id");
  }
  if (!(ALLOWED_VISION_MIME as readonly string[]).includes(mime)) {
    throw new VisionEnvelopeError(`mime must be one of ${ALLOWED_VISION_MIME.join(", ")}`);
  }
  const encoded = new TextEncoder().encode(JSON.stringify({
    version: VISION_ENVELOPE_VERSION,
    trigger_id: triggerId,
    mime,
    image_base64: bytesToBase64(frame),
  }));
  if (encoded.length > MAX_VISION_ENVELOPE_BYTES) {
    throw new VisionEnvelopeError(
      `envelope ${encoded.length}B exceeds ${MAX_VISION_ENVELOPE_BYTES}B limit`,
    );
  }
  // Materialize an ArrayBuffer-backed copy for LiveKit's publishData typing.
  return new Uint8Array(encoded);
}

export class VisionTrigger {
  private status: VisionStatus = "idle";
  private view: VisionObservationView | null = null;
  private pendingTriggerId: string | null = null;
  private failureCode: string | null = null;
  /** Generation counter for late-capture invalidation (Ticket 034).
   * Incremented on discard(); checked after async capture/publish in
   * look() so late frames never publish and orphaned state never resurrects. */
  private _generation = 0;
  private responseTimer: ReturnType<typeof setTimeout> | undefined;
  private unavailableReason: VisionUnavailableReason | null = null;
  private clearResponseTimer(): void {
    clearTimeout(this.responseTimer);
    this.responseTimer = undefined;
  }
  private readonly deps: {
    source: SingleFrameSource;
    transport: VisionFrameTransport;
    onStatus: (s: VisionStatus) => void;
    onView?: (v: VisionObservationView | null) => void;
    captureTimeoutMs?: number;
    responseTimeoutMs?: number;
    publishTimeoutMs?: number;
  };
  constructor(deps: {
    source: SingleFrameSource;
    transport: VisionFrameTransport;
    onStatus: (s: VisionStatus) => void;
    onView?: (v: VisionObservationView | null) => void;
    captureTimeoutMs?: number;
    responseTimeoutMs?: number;
    publishTimeoutMs?: number;
  }) {
    this.deps = deps;
  }

  get currentStatus(): VisionStatus { return this.status; }
  get currentView(): VisionObservationView | null { return this.view; }
  /** Outstanding trigger the next observation must echo, or null. */
  get currentTriggerId(): string | null { return this.pendingTriggerId; }
  /** Stable agent failure code of the last failed trigger, or null. The UI
   * shows a generic failure message; the code exists for correlation only. */
  get currentFailureCode(): string | null { return this.failureCode; }
  /** Category of the last "unavailable" outcome, or null. UI-only guidance. */
  get currentUnavailableReason(): VisionUnavailableReason | null { return this.unavailableReason; }

  private set(s: VisionStatus) {
    this.status = s;
    this.deps.onStatus(s);
  }

  /** The ONLY path that touches camera/network. One explicit call = one
   * fresh trigger id = one frame.  triggerId is minted BEFORE capture so
   * the bounded encoder can use the exact id when checking envelope size
   * (no placeholder overhead mismatch — Ticket 034).
   *
   * The envelope is built HERE via buildVisionFrameEnvelope to enforce the
   * 48 KiB bound for ANY injected SingleFrameSource — no source can bypass
   * validation by returning a prebuilt envelope.
   *
   * Generation invalidation (Ticket 034): if discard() is called while
   * capture() or publishFrame() is in-flight, the generation check prevents
   * the late result from publishing or resurrecting state.
   *
   * Owned frame and envelope bytes are declared outside the try and cleared
   * in `finally` — i.e. only AFTER capture/publish has settled, never while a
   * publish is still pending, and regardless of success, failure, or discard.
   * The transport must copy what it needs before the returned promise
   * resolves. */
  async look(): Promise<void> {
    if (this.status === "capturing") return; // re-entrant trigger is a no-op
    this.clearResponseTimer();
    this.pendingTriggerId = null;
    this.view = null;
    this.failureCode = null;
    this.unavailableReason = null;
    this.deps.onView?.(null);
    this.set("capturing");
    const gen = ++this._generation;
    let triggerId: string;
    let frame: Uint8Array | null = null;
    let envelope: Uint8Array | null = null;
    try {
      // Fresh id per click: a previous observation can never match a new look.
      // Minted first so the SingleFrameSource can use it for exact envelope sizing.
      triggerId = newTriggerId();
      let captureTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const capture = this.deps.source.capture(triggerId).then(bytes => {
          if (gen !== this._generation) bytes.fill(0);
          return bytes;
        });
        frame = await Promise.race([capture, new Promise<never>((_, reject) => {
          captureTimer = setTimeout(() => reject(new Error("capture timeout")), this.deps.captureTimeoutMs ?? 45000);
        })]);
      } finally { clearTimeout(captureTimer); }
      // Generation check: if discard() was called during capture, do not
      // publish (Ticket 034).  Bytes are cleared in `finally` once settled.
      if (gen !== this._generation) return;
      // buildVisionFrameEnvelope is the single authority on acceptable
      // envelopes — no injected source can bypass the 48 KiB bound.
      envelope = buildVisionFrameEnvelope(frame, triggerId, "image/jpeg");
      const ownedFrame = frame;
      const ownedEnvelope = envelope;
      let publishTimer: ReturnType<typeof setTimeout> | undefined;
      const publication = Promise.resolve().then(() => this.deps.transport.publishFrame(ownedEnvelope, triggerId))
        .finally(() => { ownedFrame.fill(0); ownedEnvelope.fill(0); });
      // Publication owns these bytes until it settles, even after UI timeout.
      frame = null;
      envelope = null;
      try {
        await Promise.race([publication, new Promise<never>((_, reject) => {
          publishTimer = setTimeout(() => reject(new Error("publish timeout")), this.deps.publishTimeoutMs ?? 8000);
        })]);
      } finally { clearTimeout(publishTimer); }
      // Post-publish generation check: a late discard during publish must
      // not resurrect state.
      if (gen !== this._generation) return;
      this.pendingTriggerId = triggerId;
      this.set("sent");
      this.responseTimer = setTimeout(() => {
        if (gen !== this._generation || this.status !== "sent") return;
        this._generation++;
        this.pendingTriggerId = null;
        this.unavailableReason = "no-response";
        this.set("unavailable");
      }, this.deps.responseTimeoutMs ?? 30000);
      (this.responseTimer as unknown as { unref?: () => void }).unref?.();
    } catch (e) {
      // Only update state if our generation is still current, so a late
      // discard/takeover during async work doesn't overwrite set status.
      if (gen === this._generation) {
        this._generation++;
        this.deps.source.cancel?.();
        this.pendingTriggerId = null;
        this.unavailableReason = classifyVisionError(e);
        this.set("unavailable");
      }
    } finally {
      // Publish has settled here (success, failure, or invalidated).  Clear
      // both owned buffers; no clearing happens while publish is pending.
      frame?.fill(0);
      envelope?.fill(0);
    }
  }

  /** Agent → app response (topic "vision-observation"). Accepted only while a
   * trigger is outstanding AND the echoed trigger_id matches it; stale,
   * foreign, or malformed packets are ignored (fail closed). Either a
   * metadata-only observation or a metadata-only failure packet
   * {trigger_id, error}: a matching failure moves to "failed" so the UI
   * stops waiting instead of hanging on "sent". */
  handleObservation(payload: Uint8Array): void {
    if (this.status !== "sent" || !this.pendingTriggerId) return; // never display unrequested results
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload)) as VisionObservationView & { error?: unknown };
      if (typeof msg.trigger_id !== "string" || msg.trigger_id !== this.pendingTriggerId) return; // stale or foreign response
      // Failure packet: bounded stable code only — no content, no internals.
      if (msg.error !== undefined) {
        if (typeof msg.error !== "string" || !msg.error || msg.error.length > 64 || !PRINTABLE_RE.test(msg.error)) return;
        if (!(VISION_FAILURE_CODES as readonly string[]).includes(msg.error)) return;
        this.clearResponseTimer();
        this.failureCode = msg.error;
        this.pendingTriggerId = null;
        this.set("failed");
        return;
      }
      if (typeof msg.object_label !== "string" || typeof msg.summary !== "string" ||
          typeof msg.frame_hash !== "string" || typeof msg.mask_ref !== "string" ||
          typeof msg.synthetic !== "boolean" ||
          typeof msg.durable !== "boolean" || typeof msg.confidence !== "number") return;
      // A malformed bbox must not break the overlay: drop it, keep the view.
      if (msg.bbox !== undefined && !(Array.isArray(msg.bbox) && msg.bbox.length === 4 &&
          msg.bbox.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0))) {
        delete msg.bbox;
      }
      // A malformed mask overlay must not break the view either: drop it and
      // the bbox highlight remains. Pixels are never repaired or synthesized,
      // and overlay geometry never falls back to the observation bbox.
      if (msg.mask_overlay !== undefined && !isValidMaskOverlay(msg.mask_overlay)) {
        delete msg.mask_overlay;
      }
      this.clearResponseTimer();
      this.view = msg;
      this.deps.onView?.(msg);
      this.pendingTriggerId = null;
      this.set("observed");
    } catch { /* malformed observation packets ignored */ }
  }

  /** Drop the observation view and any local still (REQ: discard after
   * processing). Also invalidates any outstanding trigger, so a late agent
   * response to it can never display. Clears a failure status too.
   * Increments generation so any in-flight capture is silently dropped. */
  discard(): void {
    this.clearResponseTimer();
    this.deps.source.cancel?.();
    this._generation++; // invalidate in-flight capture (Ticket 034)
    this.view = null;
    this.pendingTriggerId = null;
    this.failureCode = null;
    this.deps.onView?.(null);
    this.set("idle");
  }
}

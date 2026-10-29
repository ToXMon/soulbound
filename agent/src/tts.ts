// tts: replaceable TTSProvider (D15) + pinned VoxCPM2 client + LiveKit egress.
// VoxCPM2 is the explicitly approved speech renderer (D13/D15); it is not a
// conversational model. No silent provider fallback: any failure throws and
// the pipeline preserves the text conversation (Ticket 003 Gate C).
import { AudioFrame, AudioSource, LocalAudioTrack } from "@livekit/rtc-node";
import {
  BoundedPcmQueue,
  MAX_QUEUED_PCM_BYTES,
  PCM_FRAME_SAMPLES,
  PcmFramer,
  TTS_CHANNELS,
  TTS_SAMPLE_RATE,
} from "./tts-core.js";

export interface TtsFormat {
  sampleRate: number;
  channels: number;
  encoding: "pcm_s16le";
}

export const VOXCPM2_FORMAT: TtsFormat = {
  sampleRate: TTS_SAMPLE_RATE,
  channels: TTS_CHANNELS,
  encoding: "pcm_s16le",
};

export interface TtsRequest {
  /** Complete sentence text (VoxCPM2 takes fixed text, not token streams). */
  text: string;
  /** Natural-language Voice Design description, rendered as (<desc>)<text>. */
  voiceDescription: string;
  seed: number | null;
  signal?: AbortSignal;
  onFirstChunk?: () => void;
}

/** Streamed speech: PCM chunks arrive before synthesis ends. */
export interface TTSProvider {
  readonly name: string;
  readonly format: TtsFormat;
  synthesize(req: TtsRequest): AsyncIterable<Buffer>;
}

export class TtsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TtsError";
  }
}

/**
 * Pinned vLLM-Omni VoxCPM2 client for POST /v1/audio/speech.
 * Live-verified contract (Gate B, dseq 29283087): the pinned server DROPS
 * response_format="pcm" streams (connection closed, "cancelled by client"
 * in server logs), while stream=true, stream_format="audio",
 * response_format="wav" streams a 44-byte WAV header followed by raw
 * 48 kHz mono s16le PCM, first byte well before synthesis ends. This client
 * validates and strips the header, then yields pure PCM. Model id must be
 * the served name "openbmb/VoxCPM2" ("voxcpm2" gets a 404).
 * Auth is a runtime Bearer secret; it never enters SDL, logs, or the browser.
 */
export class VoxCpm2Provider implements TTSProvider {
  readonly name = "voxcpm2-vllm-omni";
  readonly format = VOXCPM2_FORMAT;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string = "openbmb/VoxCPM2",
    private timeoutMs: number = 60000,
  ) {}

  async *synthesize(req: TtsRequest): AsyncIterable<Buffer> {
    if (!req.text.trim()) throw new TtsError("VoxCPM2: refusing empty sentence");
    if (!req.voiceDescription.trim()) throw new TtsError("VoxCPM2: voice description is required");
    const input = `(${req.voiceDescription.trim()})${req.text.trim()}`;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/audio/speech`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input,
          voice: "default", // required by the OpenAI schema; ignored by VoxCPM2
          response_format: "wav", // live-verified streaming contract; header stripped below
          stream: true,
          stream_format: "audio",
          ...(req.seed !== null ? { seed: req.seed } : {}),
        }),
      });
    } catch (e) {
      throw new TtsError(`VoxCPM2 request failed: ${(e as Error).name}`);
    }
    if (!res.ok) {
      // Never log the body verbatim if it could echo request data; status only.
      throw new TtsError(`VoxCPM2 HTTP ${res.status}`, res.status);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/audio|octet-stream/.test(ct)) {
      throw new TtsError(`VoxCPM2 unexpected content-type: ${ct || "(none)"}`);
    }
    if (!res.body) throw new TtsError("VoxCPM2 returned no body");
    let first = true;
    let headerBuf: Buffer = Buffer.alloc(0);
    let headerDone = false;
    const reader = res.body.getReader();
    try {
      for (;;) {
        if (req.signal?.aborted) {
          await reader.cancel().catch(() => undefined);
          throw new Error("AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        let chunk: Buffer = Buffer.from(value);
        if (!headerDone) {
          headerBuf = headerBuf.length ? Buffer.concat([headerBuf, chunk]) : chunk;
          const stripped = stripWavHeader(headerBuf);
          if (stripped === null) {
            if (headerBuf.length > 8192) throw new TtsError("VoxCPM2 WAV header not found");
            continue; // need more bytes to validate the header
          }
          headerDone = true;
          chunk = stripped;
          if (!chunk.length) continue;
        }
        if (first) { first = false; req.onFirstChunk?.(); }
        yield chunk;
      }
      if (!headerDone) throw new TtsError("VoxCPM2 stream ended before WAV header");
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new TtsError(`VoxCPM2 stream failed: ${(e as Error).name}`);
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Validate a streaming WAV header and return the PCM payload after the
 * data chunk header, or null when more bytes are needed. Throws on a
 * format mismatch (never guesses sample rate/channels).
 */
export function stripWavHeader(buf: Buffer): Buffer | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new TtsError("VoxCPM2 stream is not WAV");
  }
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (sampleRate !== TTS_SAMPLE_RATE || channels !== TTS_CHANNELS || bits !== 16) {
    throw new TtsError(
      `VoxCPM2 WAV format mismatch: ${sampleRate}Hz ${channels}ch ${bits}bit (expected 48000Hz 1ch 16bit)`,
    );
  }
  const dataAt = buf.indexOf("data", 12);
  if (dataAt < 0 || dataAt + 8 > buf.length) return null;
  return Buffer.from(buf.subarray(dataAt + 8));
}

export function ttsProviderFromEnv(): TTSProvider | null {
  const base = process.env.TTS_BASE_URL;
  const key = process.env.TTS_API_KEY;
  if (!base && !key) return null; // TTS not configured: text-only mode
  if (!base || !key) {
    throw new TtsError("TTS_BASE_URL and TTS_API_KEY must be set together (see .env.example)");
  }
  return new VoxCpm2Provider(base, key, process.env.TTS_MODEL ?? "openbmb/VoxCPM2");
}

export interface TtsVoiceConfig {
  description: string;
  seed: number | null;
}

export function voiceConfigFromEnv(): TtsVoiceConfig {
  const description = process.env.TTS_VOICE_DESCRIPTION ?? "";
  const rawSeed = process.env.TTS_SEED;
  const seed = rawSeed === undefined || rawSeed === "" ? null : Number(rawSeed);
  if (seed !== null && (!Number.isInteger(seed) || seed < 0)) {
    throw new TtsError("TTS_SEED must be a non-negative integer");
  }
  return { description, seed };
}

export interface AudioSink {
  /** Publish one reframed PCM chunk, in order. Must apply backpressure. */
  publishPcm(frame: Buffer, signal?: AbortSignal): Promise<void>;
  clear(): void;
  close(): Promise<void>;
}

/**
 * Ordered mono PCM egress over the installed rtc-node APIs:
 * AudioSource(48000, 1) -> LocalAudioTrack -> localParticipant.publishTrack.
 * One publisher per room; sentences are published strictly in call order by
 * the pipeline's single ordered consumer.
 */
export class LiveKitAudioPublisher implements AudioSink {
  private source: AudioSource | null = null;
  private track: LocalAudioTrack | null = null;
  private framer = new PcmFramer();
  private queue = new BoundedPcmQueue(MAX_QUEUED_PCM_BYTES);
  publishedFrames = 0;

  constructor(private publish: (track: LocalAudioTrack) => Promise<void>) {}

  async start(): Promise<void> {
    if (this.source) return;
    this.source = new AudioSource(TTS_SAMPLE_RATE, TTS_CHANNELS, 1000);
    this.track = LocalAudioTrack.createAudioTrack("soulbound-voice", this.source);
    await this.publish(this.track);
  }

  async publishPcm(chunk: Buffer, signal?: AbortSignal): Promise<void> {
    if (!this.source) throw new TtsError("LiveKitAudioPublisher: not started");
    if (signal?.aborted) throw new Error("AbortError");
    for (const frame of this.framer.push(chunk)) {
      await this.capture(frame, signal);
    }
  }

  /** Flush the final partial frame at end of a turn's speech. */
  async flush(signal?: AbortSignal): Promise<void> {
    if (!this.source) return;
    for (const frame of this.framer.flush()) {
      await this.capture(frame, signal);
    }
  }

  private async capture(frameBytes: Buffer, signal?: AbortSignal): Promise<void> {
    if (!this.source) throw new TtsError("LiveKitAudioPublisher: not started");
    if (signal?.aborted) throw new Error("AbortError");
    if (!this.queue.tryPush(frameBytes.length)) {
      throw new TtsError("TTS audio queue bound exceeded; cancelling turn speech");
    }
    try {
      const samples = new Int16Array(
        frameBytes.buffer, frameBytes.byteOffset, frameBytes.length / 2,
      );
      const frame = new AudioFrame(
        Int16Array.from(samples), TTS_SAMPLE_RATE, TTS_CHANNELS,
        Math.min(PCM_FRAME_SAMPLES, samples.length),
      );
      await this.source.captureFrame(frame);
      this.publishedFrames++;
    } finally {
      this.queue.pop(frameBytes.length);
    }
  }

  clear(): void {
    this.source?.clearQueue();
    this.framer = new PcmFramer();
    this.queue.clear();
  }

  async close(): Promise<void> {
    try { await this.track?.close(true); } catch { /* already closed */ }
    this.track = null;
    this.source = null;
  }

  get queuedBytes(): number {
    return this.queue.queuedBytes;
  }
}

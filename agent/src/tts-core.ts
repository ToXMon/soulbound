// tts-core: pure, deterministic helpers for Ticket 003 (no I/O, no deps).
// Sentence assembly from streamed Spark tokens, PCM framing across arbitrary
// HTTP chunk boundaries, bounded-queue accounting, and WAV wrapping for the
// smoke script. Kept dependency-free so tests can import the compiled output.

export const TTS_SAMPLE_RATE = 48000;
export const TTS_CHANNELS = 1;
export const TTS_BITS_PER_SAMPLE = 16;
/** 10 ms of 48 kHz mono audio = 480 samples = 960 bytes. */
export const PCM_FRAME_SAMPLES = 480;
export const PCM_FRAME_BYTES = PCM_FRAME_SAMPLES * 2;
export const MAX_SENTENCE_CHARS = 200;
export const MAX_QUEUED_SENTENCES = 8;
export const MAX_QUEUED_PCM_BYTES = 2 * 1024 * 1024; // ~21 s of 48k mono PCM

const TERMINAL = new Set([".", "!", "?", "…"]);
const CLOSERS = new Set(['"', "'", ")", "]", "”", "’"]);

/**
 * Incremental sentence assembler. Feed streamed token deltas; complete
 * sentences are returned as soon as their terminal punctuation is followed
 * by whitespace (or a closer + whitespace). flush() emits the trailing
 * fragment exactly once. A fragment longer than MAX_SENTENCE_CHARS is split
 * at its last word boundary so first-sentence latency stays bounded.
 */
export class SentenceAssembler {
  private buf = "";
  private flushed = false;

  push(delta: string): string[] {
    if (this.flushed) throw new Error("SentenceAssembler: push after flush");
    if (!delta) return [];
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) break;
      const s = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut).trimStart();
      if (s) out.push(s);
    }
    return out;
  }

  private findCut(): number {
    const b = this.buf;
    for (let i = 0; i < b.length; i++) {
      if (!TERMINAL.has(b[i])) continue;
      let j = i + 1;
      while (j < b.length && CLOSERS.has(b[j])) j++;
      if (j < b.length && /\s/.test(b[j])) return j;
    }
    if (b.length > MAX_SENTENCE_CHARS) {
      const sp = b.lastIndexOf(" ", MAX_SENTENCE_CHARS);
      if (sp > 40) return sp + 1;
      return MAX_SENTENCE_CHARS;
    }
    return -1;
  }

  /** Emit the trailing fragment once; later calls return []. */
  flush(): string[] {
    if (this.flushed) return [];
    this.flushed = true;
    const s = this.buf.trim();
    this.buf = "";
    return s ? [s] : [];
  }

  get pending(): string {
    return this.buf;
  }
}

/**
 * Reframes an arbitrary byte stream into fixed PCM frames. An odd trailing
 * byte is retained across chunks (16-bit samples are never split). The final
 * partial frame is emitted by flush() without padding; a lone leftover byte
 * at end-of-stream is counted in droppedBytes, never invented into a sample.
 */
export class PcmFramer {
  private leftover: Buffer = Buffer.alloc(0);
  droppedBytes = 0;

  constructor(private frameBytes: number = PCM_FRAME_BYTES) {
    if (frameBytes <= 0 || frameBytes % 2 !== 0) {
      throw new Error("PcmFramer: frameBytes must be a positive even number");
    }
  }

  push(chunk: Buffer | Uint8Array): Buffer[] {
    const data = this.leftover.length
      ? Buffer.concat([this.leftover, Buffer.from(chunk)])
      : Buffer.from(chunk);
    const frames: Buffer[] = [];
    let off = 0;
    while (data.length - off >= this.frameBytes) {
      frames.push(Buffer.from(data.subarray(off, off + this.frameBytes)));
      off += this.frameBytes;
    }
    this.leftover = Buffer.from(data.subarray(off));
    return frames;
  }

  flush(): Buffer[] {
    const rest = this.leftover;
    this.leftover = Buffer.alloc(0);
    if (rest.length === 0) return [];
    if (rest.length % 2 === 1) {
      this.droppedBytes += 1;
      const even = rest.subarray(0, rest.length - 1);
      return even.length ? [Buffer.from(even)] : [];
    }
    return [Buffer.from(rest)];
  }

  get bufferedBytes(): number {
    return this.leftover.length;
  }
}

/** Byte/sample accounting guard for the ordered TTS queue. */
export class BoundedPcmQueue {
  private bytes = 0;
  constructor(private maxBytes: number = MAX_QUEUED_PCM_BYTES) {}

  tryPush(n: number): boolean {
    if (this.bytes + n > this.maxBytes) return false;
    this.bytes += n;
    return true;
  }

  pop(n: number): void {
    this.bytes = Math.max(0, this.bytes - n);
  }

  clear(): void {
    this.bytes = 0;
  }

  get queuedBytes(): number {
    return this.bytes;
  }
}

/** Wrap raw little-endian PCM in a canonical 44-byte WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate = TTS_SAMPLE_RATE, channels = TTS_CHANNELS): Buffer {
  if (pcm.length % 2 === 1) throw new Error("pcmToWav: odd byte count is not valid 16-bit PCM");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(TTS_BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Validate a WAV buffer produced from the TTS endpoint (smoke checks). */
export function inspectWav(buf: Buffer): { sampleRate: number; channels: number; bits: number; dataBytes: number; durationSec: number } {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("inspectWav: not a RIFF/WAVE file");
  }
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  // Walk chunks to find data (tolerates extra chunks before data).
  let dataBytes = 0;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") { dataBytes = Math.min(size, buf.length - (off + 8)); break; }
    off += 8 + size + (size % 2);
  }
  const bytesPerSec = sampleRate * channels * (bits / 8);
  return { sampleRate, channels, bits, dataBytes, durationSec: bytesPerSec ? dataBytes / bytesPerSec : 0 };
}

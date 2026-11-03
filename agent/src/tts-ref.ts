// tts-ref: voice-reference loading and validation for opt-in synthetic
// reference support (Ticket 035). Opens the file with a non-blocking fd,
// stats it to confirm a regular file before allocating, reads from the
// same fd, and closes in finally. Validates fmt PCM16 mono/stereo with
// plausible rate and blockAlign. Never logs paths, bytes, or credentials.
// No remote fetch. No silent fallback — any misconfiguration throws
// immediately so the operator sees the failure.
import { createHash } from "node:crypto";
import { openSync, fstatSync, readSync, closeSync } from "node:fs";

/** Maximum WAV file size for a reference audio (10 MB). */
export const REF_AUDIO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Validate a WAV buffer as a valid PCM16 mono or stereo file with a
 * plausible sample rate and correct blockAlign. Requires a fmt chunk
 * before the data chunk; rejects duplicate fmt/data chunks, missing
 * chunks, non-PCM, unsupported channel counts, and implausible rates.
 */
function validateRefWav(buf: Buffer): void {
  if (buf.length < 44) throw new Error("ref audio too short for a WAV header");
  if (
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("ref audio is not a valid RIFF/WAVE file");
  }

  let hasFmt = false;
  let hasData = false;

  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);

    if (id === "fmt ") {
      if (hasFmt) throw new Error("ref audio has duplicate fmt chunk");
      hasFmt = true;
      if (off + 8 + size > buf.length)
        throw new Error("ref audio fmt chunk exceeds file");
      if (size < 16) throw new Error("ref audio fmt chunk too small");

      const audioFormat = buf.readUInt16LE(off + 8);
      const channels = buf.readUInt16LE(off + 10);
      const sampleRate = buf.readUInt32LE(off + 12);
      const byteRate = buf.readUInt32LE(off + 16);
      const blockAlign = buf.readUInt16LE(off + 20);
      const bitsPerSample = buf.readUInt16LE(off + 22);

      if (audioFormat !== 1)
        throw new Error("ref audio must be PCM (format 1)");
      if (channels !== 1 && channels !== 2)
        throw new Error("ref audio must be mono or stereo");
      if (sampleRate < 8000 || sampleRate > 192000)
        throw new Error("ref audio sample rate out of plausible range");
      if (bitsPerSample !== 16)
        throw new Error("ref audio must be 16-bit PCM");
      if (blockAlign !== channels * (bitsPerSample / 8))
        throw new Error("ref audio blockAlign mismatch");
      if (byteRate !== sampleRate * blockAlign)
        throw new Error("ref audio byteRate mismatch");
    } else if (id === "data") {
      if (hasData) throw new Error("ref audio has duplicate data chunk");
      hasData = true;
      if (size === 0)
        throw new Error("ref audio WAV has an empty data chunk");
      if (off + 8 + size > buf.length)
        throw new Error("ref audio WAV data chunk exceeds file length");
    }

    off += 8 + size + (size % 2);
  }

  if (!hasFmt) throw new Error("ref audio WAV has no fmt chunk");
  if (!hasData) throw new Error("ref audio WAV has no data chunk");
}

/**
 * Load a reference WAV file, validate it, verify the SHA256 digest, and
 * return a data URI suitable for the VoxCPM2 `ref_audio` field.
 *
 * Opens via fd (non-blocking), stats to confirm a regular file before any
 * allocation, reads bounded from the same fd, and closes in finally.
 * Every error is sanitized — no filesystem path or original OS message is
 * included in the thrown Error.
 *
 * Throws on any failure — there is no silent fallback.
 */
export function loadRefAudio(path: string, expectedDigest: string): string {
  if (!path || !expectedDigest) {
    throw new Error(
      "TTS_REF_AUDIO_PATH and TTS_REF_AUDIO_DIGEST must be set together",
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(expectedDigest)) {
    throw new Error(
      "TTS_REF_AUDIO_DIGEST must be a 64-character hex SHA256 digest",
    );
  }

  let fd: number | undefined;
  try {
    // openSync throws with path in message → catch and sanitise
    try {
      fd = openSync(path, "r");
    } catch {
      throw new Error("cannot open ref audio file");
    }

    const stat = fstatSync(fd);
    if (!stat.isFile())
      throw new Error("ref audio path is not a regular file");
    if (stat.size === 0) throw new Error("ref audio file is empty");
    if (stat.size > REF_AUDIO_MAX_BYTES) {
      throw new Error(
        `ref audio file exceeds ${REF_AUDIO_MAX_BYTES} byte limit`,
      );
    }

    const buf = Buffer.alloc(stat.size);
    let bytesRead = 0;
    while (bytesRead < stat.size) {
      const n = readSync(fd, buf, bytesRead, stat.size - bytesRead, bytesRead);
      if (n === 0) break;
      bytesRead += n;
    }
    if (bytesRead < stat.size)
      throw new Error("ref audio file truncated during read");

    validateRefWav(buf);

    const actual = createHash("sha256").update(buf).digest("hex");
    const expected = expectedDigest.toLowerCase();
    if (actual !== expected) {
      throw new Error(
        `ref audio digest mismatch: expected ${expected} but got ${actual}`,
      );
    }

    return `data:audio/wav;base64,${buf.toString("base64")}`;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Build a reference data URI from environment variables, or return null when
 * reference is not configured. Throws if either env var is set without the
 * other or if the file cannot be validated.
 */
export function refAudioFromEnv(): string | null {
  const path = (process.env.TTS_REF_AUDIO_PATH ?? "").trim();
  const digest = (process.env.TTS_REF_AUDIO_DIGEST ?? "").trim();
  if (!path && !digest) return null; // reference not configured
  return loadRefAudio(path, digest);
}
// observe: Muse Voice Transcribe over WebSocket only (never HTTP for streaming).
// Protocol per meta-model-cookbook 06_muse_voice/01_voice_api_fundamentals:
//   wss://api.meta.ai/v1/asr/realtime; auth inside the handshake JSON
//   (authorization:{accessToken}); binary PCM frames; {"type":"endStream"}
//   ends input; events speechStart -> partials -> speaker -> speechEnd ->
//   speechComplete correlated by turnId; speaker labels are bare letters.
// No mock fallback: missing config or a server error is a loud throw.
import WebSocket from "ws";
import type { DiarizedTurn } from "./orient.js";

interface VtEvent {
  type?: string;
  sessionId?: string;
  turnId?: number | string;
  transcript?: string;
  final?: boolean;
  label?: string;
  speaker?: string;
  message?: string;
}

interface PendingTurn {
  text: string;
  speaker: string | null;
  startedAt: number;
  emitted: boolean;
}

const ENCODINGS: Record<string, number> = { PCM_16KHZ: 16000, PCM_24KHZ: 24000 };

export class VoiceTranscribeStream {
  private ws: WebSocket | null = null;
  private turns = new Map<string, PendingTurn>();
  private lastTurnId: string | null = null;
  private streamError: Error | null = null;
  sessionId: string | null = null;

  constructor(private onTurn: (turn: DiarizedTurn, sttMs: number) => void) {}

  get encoding(): string {
    return process.env.MUSE_VT_ENCODING ?? "PCM_16KHZ";
  }

  get sampleRate(): number {
    return ENCODINGS[this.encoding] ?? 16000;
  }

  // Owner = OWNER_SPEAKER_LABEL when configured, else the first diarized
  // speaker letter seen this session. resolveSpeaker (orient) reads the env
  // var per turn, so publishing the first-seen letter there wires the live
  // pipeline without a second owner channel. Explicit config always wins.
  private noteSpeaker(label: string): void {
    if (!process.env.OWNER_SPEAKER_LABEL) process.env.OWNER_SPEAKER_LABEL = label;
  }

  private emit(id: string, pending: PendingTurn): void {
    if (pending.emitted || !pending.text.trim()) return;
    pending.emitted = true;
    if (pending.speaker) this.noteSpeaker(pending.speaker);
    this.onTurn(
      { speaker: pending.speaker, text: pending.text.trim() },
      Math.max(1, Math.round(performance.now() - pending.startedAt)),
    );
  }

  private pendingFor(id: string): PendingTurn {
    let p = this.turns.get(id);
    if (!p) {
      p = { text: "", speaker: null, startedAt: performance.now(), emitted: false };
      this.turns.set(id, p);
    }
    return p;
  }

  async connect(): Promise<string> {
    const url = process.env.MUSE_VT_WS_URL ?? "wss://api.meta.ai/v1/asr/realtime";
    const apiKey = process.env.MODEL_API_KEY ?? process.env.META_API_KEY;
    if (!apiKey) throw new Error("MODEL_API_KEY (or META_API_KEY) is not set (see agent/.env.example)");
    const ws = new WebSocket(url);
    this.ws = ws;
    const opened = new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", () => reject(new Error("Muse VT WebSocket failed to open")));
    });
    // Attach the message handler before the handshake so the ack is not missed.
    const ack = new Promise<string>((resolve, reject) => {
      const onMessage = (data: WebSocket.RawData) => {
        let msg: VtEvent;
        try { msg = JSON.parse(String(data)) as VtEvent; } catch { return; }
        if (msg.sessionId && !msg.type) {
          this.sessionId = msg.sessionId;
          ws.off("message", onMessage);
          this.attachTurnHandler();
          resolve(msg.sessionId);
        } else if (msg.type === "error") {
          ws.off("message", onMessage);
          reject(new Error(`Muse VT handshake rejected: ${msg.message ?? "unknown error"}`));
        }
      };
      ws.on("message", onMessage);
    });
    await opened;
    ws.send(JSON.stringify({
      mode: "DIARIZATION",
      authorization: { accessToken: apiKey },
      audioEncoding: this.encoding,
      model: process.env.MUSE_VT_MODEL ?? "muse-voice-transcribe-1.0",
      partialMode: "CUMULATIVE",
      emitAudioProgress: false,
    }));
    return ack;
  }

  private attachTurnHandler(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.on("message", (data: WebSocket.RawData) => {
      // The `ws` client delivers text frames as Buffer; JSON-parse the string form.
      let msg: VtEvent;
      try { msg = JSON.parse(String(data)) as VtEvent; } catch { return; }
      if (msg.type === "error") { this.streamError = new Error(`Muse VT error: ${msg.message ?? "unknown error"}`); ws.close(); return; }
      const id = msg.turnId !== undefined ? String(msg.turnId) : this.lastTurnId;
      switch (msg.type) {
        case "speechStart":
          if (id) { this.pendingFor(id).startedAt = performance.now(); this.lastTurnId = id; }
          break;
        case "transcript":
          if (id && msg.final && msg.transcript) this.pendingFor(id).text = msg.transcript;
          break;
        case "speaker": {
          // Labels the span of speech before it: attach to its turnId when
          // present, else the most recent turn still missing a label.
          const label = msg.label ?? msg.speaker;
          if (!label) break;
          const target = id && this.turns.has(id)
            ? id
            : [...this.turns.keys()].reverse().find((k) => !this.turns.get(k)?.speaker);
          if (target) this.pendingFor(target).speaker = label;
          break;
        }
        case "speechComplete":
          if (id) {
            const p = this.pendingFor(id);
            if (msg.transcript) p.text = msg.transcript;
            this.emit(id, p);
          }
          break;
        default:
          break; // session / speechEnd / progress: lifecycle only
      }
    });
    ws.on("close", () => { this.ws = null; });
  }

  sendAudio(pcm: Buffer | Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(Buffer.from(pcm)); // binary PCM frame, never base64/JSON
  }

  // Half-close input, then flush every completed/pending turn before closing.
  async endStream(timeoutMs = 20000): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "endStream" }));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pending = [...this.turns.values()].filter((t) => !t.emitted);
      if (pending.length === 0 || ws.readyState !== WebSocket.OPEN) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    for (const [id, p] of this.turns) this.emit(id, p);
    if (this.streamError) throw this.streamError;
  }

  close(): void { this.ws?.close(); this.ws = null; }
}

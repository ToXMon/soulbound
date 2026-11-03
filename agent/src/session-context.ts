import type { DiarizedTurn, SpeakerKind } from "./orient.js";

export interface SpeakerHistory {
  speaker: string;
  kind: SpeakerKind;
  messages: SessionMessage[];
}

export class SpeakerSessions {
  private contexts = new Map<string, SessionContext>();

  private key(turn: DiarizedTurn, kind: SpeakerKind): string | null {
    if (!turn.speaker || turn.speaker.length > 128 ||
        (turn.confidence !== undefined && (!Number.isFinite(turn.confidence) || turn.confidence < 0.5))) return null;
    return JSON.stringify([kind, turn.speaker]);
  }

  forTurn(turn: DiarizedTurn, kind: SpeakerKind): SpeakerHistory | undefined {
    const key = this.key(turn, kind);
    if (key === null) return undefined;
    return { speaker: turn.speaker!, kind, messages: this.contexts.get(key)?.getMessages() ?? [] };
  }

  append(turn: DiarizedTurn, kind: SpeakerKind, reply: string): void {
    const key = this.key(turn, kind);
    if (key === null) return;
    let context = this.contexts.get(key);
    if (!context) {
      if (this.contexts.size >= 8) {
        const oldest = this.contexts.keys().next().value!;
        this.contexts.get(oldest)?.reset();
        this.contexts.delete(oldest);
      }
      context = new SessionContext();
      this.contexts.set(key, context);
    }
    // Each buffer holds only this diarized speaker's ephemeral pairs.
    context.append(turn.text, reply, "owner");
  }

  reset(): void {
    for (const context of this.contexts.values()) context.reset();
    this.contexts.clear();
  }
}

export interface SessionMessage { role: "user" | "assistant"; content: string }
export interface SessionContextOptions { maxTurns?: number; maxChars?: number; maxMessageChars?: number }

/** Ephemeral context owned by one room job. Never a durable-memory proof. */
export class SessionContext {
  private messages: SessionMessage[] = [];
  private readonly opts: Required<SessionContextOptions>;

  constructor(opts: SessionContextOptions = {}) {
    this.opts = { maxTurns: 20, maxChars: 8000, maxMessageChars: 2000, ...opts };
    for (const value of Object.values(this.opts)) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid session context bound");
    }
  }

  append(user: string, assistant: string, kind: SpeakerKind): void {
    if (kind !== "owner") return;
    const pair: SessionMessage[] = [
      { role: "user", content: user.slice(0, this.opts.maxMessageChars) },
      { role: "assistant", content: assistant.slice(0, this.opts.maxMessageChars) },
    ];
    if (pair.some(m => !m.content) || pair.reduce((n, m) => n + m.content.length, 0) > this.opts.maxChars) return;
    this.messages.push(...pair);
    while (this.turnCount > this.opts.maxTurns || this.totalChars > this.opts.maxChars) this.messages.splice(0, 2);
  }

  getMessages(kind: SpeakerKind = "owner"): SessionMessage[] {
    return kind === "owner" ? this.messages.map(m => ({ ...m })) : [];
  }
  reset(): void { this.messages = []; }
  get length(): number { return this.messages.length; }
  get turnCount(): number { return this.messages.length / 2; }
  get totalChars(): number { return this.messages.reduce((n, m) => n + m.content.length, 0); }
}

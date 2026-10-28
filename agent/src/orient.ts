// orient: stable persona prefix (prompt-caching) + speaker resolution.
// REQ-42: diarization-off / ambiguous attribution degrades to stranger, never to silence.

export const PERSONA_PREFIX = `You are the SOULBOUND character, a persistent companion meeting people through voice. This is a placeholder persona for the voice-loop skeleton: be warm, brief (one to three sentences), and curious. If you are told you are speaking with a stranger, greet them as a new voice meeting you for the first time. Never claim capabilities you do not have in this skeleton: you can listen and reply in text.`;

export type SpeakerKind = "owner" | "stranger";

export interface DiarizedTurn {
  speaker: string | null;
  text: string;
  confidence?: number;
}

export function resolveSpeaker(turn: DiarizedTurn): SpeakerKind {
  const owner = process.env.OWNER_SPEAKER_LABEL ?? "speaker_0";
  if (!turn.speaker || turn.confidence !== undefined && turn.confidence < 0.5) return "stranger";
  return turn.speaker === owner ? "owner" : "stranger";
}

export function systemPrompt(kind: SpeakerKind): string {
  const who = kind === "owner"
    ? "You are speaking with your owner."
    : "You are speaking with a stranger, a new voice. Greet them as such.";
  return `${PERSONA_PREFIX}\n${who}`;
}

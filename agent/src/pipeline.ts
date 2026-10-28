// pipeline: observe -> orient -> decide -> act for one diarized turn.
import { resolveSpeaker, type DiarizedTurn } from "./orient.js";
import { decide } from "./decide.js";
import { act, type TurnRecord } from "./act.js";

export async function runTurn(turn: DiarizedTurn, sttMs = 0): Promise<TurnRecord> {
  const kind = resolveSpeaker(turn);
  const reply = await decide(turn, kind);
  return act(turn, kind, reply, sttMs);
}

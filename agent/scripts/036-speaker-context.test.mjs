import test from "node:test";
import assert from "node:assert/strict";
import * as context from "../dist/session-context.js";
import { conversationMessages } from "../dist/decide.js";
import { systemPrompt } from "../dist/orient.js";
import { runTurn } from "../dist/pipeline.js";

test("production pipeline supplies B history for consecutive B turns only", async () => {
  const prior = process.env.OWNER_SPEAKER_LABEL;
  process.env.OWNER_SPEAKER_LABEL = "A";
  try {
    const sessions = new context.SpeakerSessions();
    sessions.append({speaker:"A",text:"private owner fact"}, "owner", "private reply");
    const requests = [];
    const streamReply = async (turn, kind, cb) => {
      requests.push(conversationMessages(turn, kind, cb.sessionHistory, cb.speakerHistory));
      return {text:"synthetic test reply",model:"muse-spark-1.3",latencyMs:0};
    };
    const first = {speaker:"B",text:"sample colour teal"};
    const rec = await runTurn(first,0,{speakerSessions:sessions,streamReply});
    sessions.append(first,rec.kind,rec.reply);
    await runTurn({speaker:"B",text:"What sample colour?"},0,{speakerSessions:sessions,streamReply});
    await runTurn({speaker:"C",text:"What sample colour?"},0,{speakerSessions:sessions,streamReply});
    assert.equal(rec.kind,"stranger");
    assert.deepEqual(requests[1].slice(1).map(m=>m.content),
      ["sample colour teal","synthetic test reply","What sample colour?"]);
    assert.equal(requests[2].length,2);
    assert.ok(!JSON.stringify(requests).includes("private owner fact"));
  } finally {
    if (prior === undefined) delete process.env.OWNER_SPEAKER_LABEL;
    else process.env.OWNER_SPEAKER_LABEL = prior;
  }
});

test("B follow-up gets B context, never A context, despite being a stranger", () => {
  const sessions = new context.SpeakerSessions();
  sessions.append({speaker:"A",text:"private owner fact"}, "owner", "private reply");
  sessions.append({speaker:"B",text:"sample colour teal"}, "stranger", "Noted.");
  const turn = {speaker:"B",text:"What sample colour?"};
  const scoped = sessions.forTurn(turn, "stranger");
  const messages = conversationMessages(turn, "stranger", undefined, scoped);
  assert.deepEqual(messages.slice(1).map(m=>m.content), ["sample colour teal", "Noted.", "What sample colour?"]);
  assert.ok(!JSON.stringify(messages).includes("private owner fact"));
  assert.equal(conversationMessages({speaker:"C",text:"hello"}, "stranger", undefined, scoped).length, 2);
  assert.equal(conversationMessages(turn, "owner", undefined, scoped).length, 2);
  assert.equal(conversationMessages({...turn,confidence:0.1}, "stranger", undefined, scoped).length, 2);
  assert.equal(sessions.forTurn({speaker:null,text:"hello"}, "stranger"), undefined);
  sessions.reset();
  assert.equal(sessions.forTurn(turn, "stranger").messages.length, 0);
});

test("speaker contexts remain bounded and reject ambiguous turns", () => {
  const sessions = new context.SpeakerSessions();
  sessions.append({speaker:"B",text:"ambiguous",confidence:0.1}, "stranger", "reply");
  assert.equal(sessions.forTurn({speaker:"B",text:"hello"},"stranger").messages.length,0);
  for(let i=0;i<50;i++) sessions.append({speaker:"B",text:"x".repeat(1000)},"stranger","y".repeat(1000));
  const messages=sessions.forTurn({speaker:"B",text:"hello"},"stranger").messages;
  assert.ok(messages.length<=40);
  assert.ok(messages.reduce((n,m)=>n+m.content.length,0)<=8000);
  for(let i=0;i<30;i++) sessions.append({speaker:`S${i}`,text:"hello"},"stranger","reply");
  assert.equal(sessions.forTurn({speaker:"B",text:"hello"},"stranger").messages.length,0);
});

test("stranger prompt does not demand a first-time greeting every turn", () => {
  assert.doesNotMatch(systemPrompt("stranger"), /greet them as|meeting you for the first time/i);
  assert.match(systemPrompt("stranger"), /do not repeat introductions/i);
});

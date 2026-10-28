// LiveKit agent worker (agent-starter pattern): join room, stream mic audio
// to Muse VT (observe), run each diarized turn through orient/decide/act,
// publish the turn record back on the "turn" data topic for the UI.
import { cli, defineAgent, WorkerOptions } from "@livekit/agents";
import { AudioStream, RoomEvent, TrackKind, type RemoteTrack } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { VoiceTranscribeStream } from "./observe.js";
import { runTurn } from "./pipeline.js";

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();
    const vt = new VoiceTranscribeStream(async (turn) => {
      const rec = await runTurn(turn);
      const data = new TextEncoder().encode(JSON.stringify(rec));
      await ctx.agent?.publishData(data, { reliable: true, topic: "turn" });
    });
    await vt.connect();
    ctx.addShutdownCallback(async () => { vt.close(); });

    ctx.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      void (async () => {
        const stream = new AudioStream(track, 16000, 1);
        for await (const frame of stream) {
          vt.sendAudio(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
        }
      })();
    });
    await ctx.waitForParticipant();
    console.log("[agent] participant in room; voice loop live (text replies only — TTS is Ticket 003)");
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new WorkerOptions({ agent: import.meta.filename }));
}

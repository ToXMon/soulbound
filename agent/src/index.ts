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
    // Ticket 018: register the track handler BEFORE ctx.connect() so a mic
    // track published by an already-present participant is never missed, and
    // scan for already-subscribed audio tracks after joining (late discovery).
    const vt = new VoiceTranscribeStream(async (turn) => {
      const rec = await runTurn(turn);
      const data = new TextEncoder().encode(JSON.stringify(rec));
      await ctx.agent?.publishData(data, { reliable: true, topic: "turn" });
    });
    const feed = (track: RemoteTrack) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      void (async () => {
        const stream = new AudioStream(track, 16000, 1);
        // Double-cast through unknown: compiles against any @livekit/rtc-node
        // typing drift (ticket 017/018); runtime unchanged — frames are
        // 16-bit PCM views and Buffer.from slices the exact bytes.
        const frames = stream as unknown as AsyncIterable<{ data: Uint8Array }>;
        for await (const frame of frames) {
          vt.sendAudio(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
        }
      })();
    };
    ctx.room.on(RoomEvent.TrackSubscribed, feed);
    await ctx.connect();
    // Late discovery: audio tracks already subscribed before our handler existed.
    for (const p of ctx.room.remoteParticipants ?? []) {
      for (const pub of (p as { trackPublications?: Map<string, { track?: RemoteTrack }> }).trackPublications?.values() ?? []) {
        if (pub.track) feed(pub.track);
      }
    }
    await vt.connect();
    ctx.addShutdownCallback(async () => { vt.close(); });
    await ctx.waitForParticipant();
    console.log("[agent] participant in room; voice loop live (text replies only — TTS is Ticket 003)");
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // fileURLToPath(import.meta.url) instead of import.meta.filename: portable
  // across Node builds and @livekit/agents typings (ticket 017).
  cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
}

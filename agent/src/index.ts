// LiveKit agent worker (agent-starter pattern): join room, stream mic audio
// to Muse VT (observe), run each diarized turn through orient/decide/act,
// publish the turn record back on the "turn" data topic for the UI.
import { cli, defineAgent, WorkerOptions } from "@livekit/agents";
import { AudioStream, RoomEvent, TrackKind, TrackPublishOptions, type RemoteTrack } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { VoiceTranscribeStream } from "./observe.js";
import { runTurn } from "./pipeline.js";
import { LiveKitAudioPublisher, ttsProviderFromEnv, voiceConfigFromEnv } from "./tts.js";
import { randomUUID } from "node:crypto";
import { memoryConfigFromEnv } from "./memory/config.js";
import { MemoryStore } from "./memory/store.js";
import { MemoryQueue } from "./memory/queue.js";
import { SparkExtractor, type SourceTurn } from "./memory/extract.js";

export default defineAgent({
  entry: async (ctx) => {
    // Ticket 019 diagnostic correlation: the browser arms ONE turn at a time
    // on topic "latency-diag" with opaque {runId, turnId}. The agent consumes
    // it for the next VT turn, joins it into the turn packet, then publishes
    // a separate follow-up on "latency-publish" once publishData resolves.
    // Follow-ups are never armed/acked, so no diagnostic loop can form.
    let pendingDiag: { runId: string; turnId: string } | null = null;
    let overlapCount = 0;
    // Ticket 004: opt-in durable memory. Disabled preserves the current loop.
    // Enabled-but-misconfigured throws here (startup error, loud).
    // LIMITATION: only owner-classified turns are extracted; diarization is a
    // heuristic, not authenticated ownership (see docs/memory-schema.md).
    const memCfg = memoryConfigFromEnv();
    let memoryQueue: MemoryQueue | null = null;
    let memoryStore: MemoryStore | null = null;
    const sessionId = randomUUID();
    let turnSeq = 0;
    if (memCfg) {
      memoryStore = await MemoryStore.open(memCfg.storePath, memCfg.namespace);
      memoryQueue = new MemoryQueue(memoryStore, new SparkExtractor(), { capacity: memCfg.capacity, timeoutMs: memCfg.timeoutMs });
      console.log(`[memory] enabled character=${memCfg.namespace.characterId} records=${memoryStore.stats().records}`);
    }
    // Ticket 003: TTS is optional. Misconfiguration is loud at startup;
    // absence keeps the proven text-only loop. No silent fallback provider.
    const ttsProvider = ttsProviderFromEnv();
    const voice = voiceConfigFromEnv();
    let publisher: LiveKitAudioPublisher | null = null;
    let turnAbort: AbortController | null = null;
    if (ttsProvider) {
      console.log(`[tts] provider=${ttsProvider.name} format=${ttsProvider.format.sampleRate}Hz/${ttsProvider.format.channels}ch seed=${voice.seed ?? "none"} (endpoint not yet proven until Gate B smoke)`);
    } else {
      console.log("[tts] not configured; text-only mode");
    }
    const vt = new VoiceTranscribeStream(async (turn, sttMs, vtTiming) => {
      const diag = pendingDiag;
      pendingDiag = null;
      // New turn supersedes any speech still synthesizing: cancel, never queue stale audio.
      turnAbort?.abort();
      turnAbort = new AbortController();
      const rec = await runTurn(turn, sttMs, {
        vtTiming, diag,
        tts: ttsProvider,
        voice,
        sink: publisher,
        signal: turnAbort.signal,
      });
      const data = new TextEncoder().encode(JSON.stringify(rec));
      const publishStart = performance.now();
      await ctx.agent?.publishData(data, { reliable: true, topic: "turn" });
      // Post-publication only: enqueue an immutable snapshot. Extraction,
      // storage and hashing are never awaited in the speech/publication path.
      if (memoryQueue && rec.kind === "owner") {
        const sourceTurn: SourceTurn = {
          id: `${sessionId}:${++turnSeq}`,
          speakerKind: rec.kind,
          userText: rec.transcript,
          replyText: rec.reply,
        };
        memoryQueue.enqueue({ key: `turn:${sourceTurn.id}`, turns: [sourceTurn] });
      }
      const publishMs = Math.round(performance.now() - publishStart);
      if (diag) {
        const followUp = new TextEncoder().encode(JSON.stringify({
          type: "publish-complete",
          runId: diag.runId,
          turnId: diag.turnId,
          publishMs,
          publishUnavailableReason: null,
        }));
        await ctx.agent?.publishData(followUp, { reliable: true, topic: "latency-publish" });
      }
    });
    ctx.room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p: unknown, _k: unknown, topic?: string) => {
      if (topic !== "latency-diag") return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; runId?: string; turnId?: string };
        if (msg.type !== "arm" || !msg.runId || !msg.turnId) return;
        if (pendingDiag) {
          overlapCount++;
          console.log(`[latency] overlapping diagnostic arm ignored (count=${overlapCount}) turnId=${msg.turnId}`);
          return;
        }
        pendingDiag = { runId: msg.runId, turnId: msg.turnId };
      } catch { /* ignore malformed diagnostic packets */ }
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
    if (ttsProvider && ctx.room.localParticipant) {
      publisher = new LiveKitAudioPublisher(async (track) => {
        await ctx.room.localParticipant!.publishTrack(track, new TrackPublishOptions({}));
      });
      await publisher.start();
      console.log("[tts] LiveKit audio track published (soulbound-voice, 48kHz mono)");
    }
    // Late discovery: audio tracks already subscribed before our handler existed.
    for (const p of ctx.room.remoteParticipants ?? []) {
      for (const pub of (p as { trackPublications?: Map<string, { track?: RemoteTrack }> }).trackPublications?.values() ?? []) {
        if (pub.track) feed(pub.track);
      }
    }
    await vt.connect();
    ctx.addShutdownCallback(async () => {
      turnAbort?.abort();
      vt.close();
      if (publisher) await publisher.close();
      if (memoryQueue) {
        // Bounded drain; pending jobs are NOT crash-durable and are reported as such.
        const drained = await memoryQueue.flush(5_000);
        const s = memoryQueue.getStats();
        console.log(`[memory] shutdown drain=${drained ? "complete" : "INCOMPLETE"} completed=${s.completed} failed=${s.failed} droppedOverflow=${s.droppedOverflow} pending=${s.pending}`);
        await memoryStore?.close(); // release the single-writer lock last
      }
    });
    await ctx.waitForParticipant();
    console.log(`[agent] participant in room; voice loop live (${ttsProvider ? "TTS configured" : "text replies only"})`);
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // fileURLToPath(import.meta.url) instead of import.meta.filename: portable
  // across Node builds and @livekit/agents typings (ticket 017).
  cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
}

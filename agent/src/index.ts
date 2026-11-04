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
import { bindRecallStore } from "./memory/retrieval.js";
import { SpeakerSessions } from "./session-context.js";
import { MemoryQueue } from "./memory/queue.js";
import { SparkExtractor, type SourceTurn } from "./memory/extract.js";
import { createMetaSamClient } from "./vision/sam.js";
import { RecentLookSession, lookAcknowledgement } from "./recent-look.js";
import { createSparkObserver } from "./vision/spark.js";
import { handleVisionFrame, VISION_FRAME_TOPIC, VISION_OBSERVATION_TOPIC } from "./vision/handler.js";
import { observationToExtraction } from "./memory/observation.js";
import { VisionSidecarStore } from "./memory/vision-sidecar.js";

// Longest a voice turn waits for an in-progress look (SAM + Spark vision).
const LOOK_WAIT_MS = 12_000;

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
    // Ticket 036: per-room-job bounded session context (ephemeral, never sealed).
    const sessionCtx = new SpeakerSessions();
    const recentLook = new RecentLookSession();
    if (memCfg) {
      // Live finding 2026-11-03: a second session (new tab, judge, or a room
      // that is still draining) hit the single-writer lock and the whole job
      // died, so the guest got no character at all. Wait briefly for a closing
      // session, then (about 5s, inside LiveKit's 10s job window) run THIS session
      // without durable memory rather than failing voice and vision. The single-writer guarantee is unchanged.
      for (let attempt = 0; attempt < 5 && !memoryStore; attempt++) {
        try {
          memoryStore = await MemoryStore.open(memCfg.storePath, memCfg.namespace);
        } catch (e) {
          if (!/writer lock held/.test((e as Error).message)) throw e;
          if (attempt === 4) console.log("[memory] DISABLED for this session: another live session holds the single writer lock; voice and vision continue without durable memory");
          else await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    if (memCfg && memoryStore) {
      bindRecallStore(memoryStore);
      memoryQueue = new MemoryQueue(memoryStore, new SparkExtractor(), { capacity: memCfg.capacity, timeoutMs: memCfg.timeoutMs });
      console.log(`[memory] enabled character=${memCfg.namespace.characterId} records=${memoryStore.stats().records}`);
    }
    // Ticket 003: TTS is optional. Misconfiguration is loud at startup;
    // absence keeps the proven text-only loop. No silent fallback provider.
    const ttsProvider = ttsProviderFromEnv();
    const voice = voiceConfigFromEnv();
    let publisher: LiveKitAudioPublisher | null = null;
    let turnAbort: AbortController | null = null;
    let turnsInFlight = 0;
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
      publisher?.clear();
      const controller = new AbortController();
      turnAbort = controller;
      turnsInFlight++;
      try {
      // A question asked while a look is still being analysed waits for it
      // (bounded), so "what is this?" is answered from the frame.
      if (recentLook.pending()) {
        await recentLook.waitForPending(LOOK_WAIT_MS);
        if (controller.signal.aborted || turnAbort !== controller) return;
      }
      const rec = await runTurn(turn, sttMs, {
        vtTiming, diag,
        tts: ttsProvider,
        voice,
        sink: publisher,
        signal: controller.signal,
        speakerSessions: sessionCtx,
        recentLook,
      });
      if (controller.signal.aborted || turnAbort !== controller) return;
      // Ticket 036: append completed turn to session context (ephemeral, not sealed memory).
      sessionCtx.append(turn, rec.kind, rec.reply);
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
      } catch {
        if (!controller.signal.aborted && turnAbort === controller) {
          console.error("[voice] turn failed; next turn remains available");
          await ctx.agent?.publishData(new TextEncoder().encode(JSON.stringify({ code: "turn-failed" })),
            { reliable: true, topic: "voice-status" }).catch(() => undefined);
        }
      } finally {
        turnsInFlight--;
      }
    }, (code) => {
      console.error(`[voice] ${code}`);
      void ctx.agent?.publishData(new TextEncoder().encode(JSON.stringify({ code })),
        { reliable: true, topic: "voice-status" }).catch(() => undefined);
    });
    // Ticket 008: explicit-trigger vision. The browser publishes exactly one
    // JSON envelope per "look at this" click on `vision-frame`; the handler
    // validates, serializes one in-flight trigger per sender, runs one SAM +
    // one Spark call, persists via the existing MemoryStore path plus the
    // private vision sidecar (only when memory is enabled), and publishes a
    // metadata-only observation on `vision-observation` only after durable
    // linkage. Identity here is the self-asserted LiveKit participant name —
    // participant-triggered demo access, NOT owner authentication (the token
    // route signs any caller-supplied name). Any connected participant with a
    // nonempty identity may trigger; admission is the nonempty-identity check
    // plus the per-sender in-flight gate (see handler.ts). No sender allowlist.
    // Sidecar atomicity boundary: store append and sidecar link are sequential
    // (the frozen store protocol has no joint transaction); a link failure
    // returns ok:false with only a metadata-only failure packet, so durable
    // success is never misclaimed and the browser never waits forever.
    const visionApiKey = process.env.MODEL_API_KEY ?? process.env.META_API_KEY;
    const visionSam = createMetaSamClient({ apiKey: visionApiKey, concept: process.env.VISION_SAM_CONCEPT?.trim() || "object" });
    const visionSpark = createSparkObserver({ apiKey: visionApiKey });
    const visionCharacterId = memCfg?.namespace.characterId ?? process.env.VISION_CHARACTER_ID?.trim() ?? "";
    const visionSidecar = memoryStore && memCfg ? await VisionSidecarStore.open(memCfg.storePath, memCfg.namespace) : null;
    ctx.room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant: unknown, _k: unknown, topic?: string) => {
      if (topic === VISION_FRAME_TOPIC) {
        const p = participant as { identity?: unknown } | null | undefined;
        const identity = typeof p?.identity === "string" ? p.identity : undefined;
        recentLook.begin();
        void handleVisionFrame(payload, identity, {
          sam: visionSam,
          spark: visionSpark,
          characterId: visionCharacterId,
          publish: async (data) => {
            await ctx.agent?.publishData(data, { reliable: true, topic: VISION_OBSERVATION_TOPIC });
          },
          onObservation: (record) => {
            // The character can now talk about what it just saw (session-only,
            // expiring). Never stored by this call and never sealed.
            recentLook.set(record.object_label, record.summary);
            const line = lookAcknowledgement(record.object_label);
            // Say it only if the voice path is idle: never talk over a reply.
            if (!line || !ttsProvider || !publisher || turnsInFlight > 0 || !voice.description.trim()) return;
            const sink = publisher;
            void (async () => {
              try {
                for await (const chunk of ttsProvider.synthesize({ text: line, voiceDescription: voice.description, seed: voice.seed })) {
                  if (turnsInFlight > 0) { sink.clear(); return; }
                  await sink.publishPcm(chunk);
                }
                await sink.flush?.();
                console.log("[vision] spoken acknowledgement published");
              } catch {
                console.log("[vision] spoken acknowledgement failed; visual observation remains available");
              }
            })();
          },
          persist: memoryStore
            ? async (record) => {
              // source_turn_id binds trigger + frame. Same-trigger replay is
              // idempotent; a later explicit look at identical pixels is a
              // distinct observation and memory record.
              const extraction = observationToExtraction(record);
              const sourceTurnId = extraction.source_turn_ids[0]!;
              const created = await memoryStore.appendExtracted(sourceTurnId, [extraction]);
              if (created[0]) return created[0].id;
              // Idempotent replay (same trigger redelivered, e.g. after a
              // sidecar failure): appendExtracted returned [] without creating
              // a record. Locate the exact record by source_turn_id — the
              // same value the extraction carries — not by bare frame_hash.
              // Take the most recent match: a replayed trigger's record is
              // the latest one carrying that link (an earlier trigger may
              // have stored the same frame under its own trigger id).
              const matches = memoryStore.records.filter((r) => r.provenance.turn_ids.includes(sourceTurnId));
              const found = matches[matches.length - 1];
              if (!found) throw new Error("vision persist replayed without creating or finding a record");
              return found.id;
            }
            : undefined,
          linkSidecar: visionSidecar
            ? async (entry) => {
              await visionSidecar.link(entry);
            }
            : undefined,
        }).then((outcome) => {
          if (outcome.ok) console.log(`[vision] observed trigger=${outcome.triggerId} frame=${outcome.frameHash} durable=${outcome.durable} sender=${identity ?? "?"}`);
          else console.log(`[vision] rejected sender=${identity ?? "?"} code=${outcome.code}`);
        }).catch(() => {
          console.log("[vision] look failed unexpectedly");
        }).finally(() => recentLook.settle());
        return;
      }
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
      bindRecallStore(null);
      sessionCtx.reset();
      recentLook.clear();
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

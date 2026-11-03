"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  ParticipantKind,
} from "livekit-client";
import { LivingPortrait } from "@/components/living-portrait";
import type { PortraitState } from "@/components/living-portrait";
import avatar from "@/assets/soulbound-avatar-meta-preview.webp";
import styles from "./room.module.css";
import { VisionTrigger, type VisionObservationView, type VisionStatus } from "./vision-trigger";
import { fitVisionFrame } from "./vision-frame";
import { MICROPHONE_PROCESSING, microphoneReport } from "./speaker-mode";

interface RecallSource { id: string; hash: string; epoch: number; root: string }
interface TurnLine {
  recallSources?: RecallSource[];
  who: string;
  text: string;
  reply: boolean;
}

// Ticket 019 diagnostic types. Timing exports are metadata-only:
// no transcript/reply text, tokens, keys, identity, or signed URLs.
interface BrowserTiming {
  speechStartProxyAtMs: number | null;
  speechEndProxyAtMs: number | null;
  dataReceiptAtMs: number | null;
  domCommitAtMs: number | null;
  // Ticket 003: browser-clock playback observations. audioPlayingAtMs is the
  // media element "playing" event, a proxy for first audible playback, not
  // proof of physical sound (headphone/recording review still required).
  audioAttachedAtMs: number | null;
  audioPlayingAtMs: number | null;
}
interface AgentTimingExport {
  utteranceVtElapsedMs: number | null;
  vtSpeechEndToCompleteMs: number | null;
  vtCompleteToSparkMs: number | null;
  sparkMs: number | null;
  publishMs: number | null;
  firstTokenMs: number | null;
  sparkFirstTokenMs?: number | null;
  firstSentenceMs?: number | null;
  firstTtsChunkMs?: number | null;
  firstAudioPublishMs?: number | null;
  ttsMs?: number | null;
}
interface DiagAttempt {
  turnId: string;
  index: number; // 0 = warm-up, 1..20 measured
  isWarmup: boolean;
  outcome: "success" | "failed" | "timeout" | "missing";
  pending: boolean;
  browser: BrowserTiming;
  agent: AgentTimingExport | null;
}

const BOUNDARY =
  "manual-proxy: speechStartProxy = operator 'Start turn' click; speechEndProxy = operator 'Finished speaking' click; visible = reply DOM commit (not guaranteed physical paint). " +
  "markerToVisible is MANUAL-PROXY marker->visible, NOT true speech-end latency (human marker delay included). " +
  "markerToAudioPlaying (Ticket 003) = Finished-speaking click -> remote audio element 'playing' event; also a MANUAL PROXY on the browser clock, not physical first-audio proof. " +
  "All browser durations on one performance.now() clock; agent durations on the agent performance.now() clock; clocks are never subtracted.";

function newId(prefix: string): string {
  const c = globalThis.crypto as Crypto | undefined;
  const rand = c?.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

export default function Page() {
  const roomRef = useRef<Room | null>(null);
  const connectionEpochRef = useRef(0);
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const audioElsRef = useRef(new Map<string, HTMLMediaElement>());
  const audioCleanupRef = useRef(new Map<string, () => void>());
  const agentSidRef = useRef<string | null>(null);
  const [agentPlayback, setAgentPlayback] = useState<{ track: MediaStreamTrack; element: HTMLMediaElement } | null>(null);
  const [agentMuted, setAgentMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Not connected. Join the room and speak.");
  const [audioStatus, setAudioStatus] = useState("Character audio: not attached yet.");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [lines, setLines] = useState<TurnLine[]>([]);
  const [visualVariant, setVisualVariant] = useState<"soul" | "portrait">("soul");

  const [micEnabled, setMicEnabled] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const micBusyRef = useRef(false);
  const [micSettings, setMicSettings] = useState("Actual microphone settings: not captured yet.");

  // Ticket 008: explicit-trigger vision; construction opens no device/network.
  const visionTriggerRef = useRef<VisionTrigger | null>(null);
  const visionStillUrlRef = useRef<string | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const cameraGenerationRef = useRef(0);
  const [visionView, setVisionView] = useState<VisionObservationView | null>(null);
  const [visionStatus, setVisionStatus] = useState<VisionStatus>("idle");
  const [visionStill, setVisionStill] = useState<{ url: string; width: number; height: number } | null>(null);

  const clearVisionStill = useCallback(() => {
    if (visionStillUrlRef.current) URL.revokeObjectURL(visionStillUrlRef.current);
    visionStillUrlRef.current = null;
    setVisionStill(null);
  }, []);

  const cancelCameraCapture = useCallback(() => {
    cameraGenerationRef.current++;
    for (const track of cameraRef.current?.getTracks() ?? []) track.stop();
    cameraRef.current = null;
    clearVisionStill();
  }, [clearVisionStill]);

  const discardVision = useCallback(() => {
    visionTriggerRef.current?.discard();
    cancelCameraCapture();
  }, [cancelCameraCapture]);

  const captureVisionFrame = useCallback(async (triggerId: string): Promise<Uint8Array> => {
    const epoch = connectionEpochRef.current;
    const generation = ++cameraGenerationRef.current;
    clearVisionStill();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    // Permission may resolve after leave/unmount; never use that late stream.
    const video = document.createElement("video");
    let captureTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (generation !== cameraGenerationRef.current || epoch !== connectionEpochRef.current) throw new Error("capture cancelled");
      cameraRef.current = stream;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const ready = async () => {
        await video.play();
        if (!video.videoWidth) {
          await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      };
      await Promise.race([ready(), new Promise<never>((_, reject) => {
        captureTimeout = setTimeout(() => reject(new Error("capture timeout")), 10000);
      })]);
      if (generation !== cameraGenerationRef.current || cameraRef.current !== stream || epoch !== connectionEpochRef.current) throw new Error("capture cancelled");
      // Ticket 034: bounded canvas-encode helper — up to 16 dimension×quality
      // candidates, fail-closed if none fits the 48 KiB envelope bound.
      const result = await fitVisionFrame(
        (ctx, w, h) => ctx.drawImage(video, 0, 0, w, h),
        video.videoWidth,
        video.videoHeight,
        triggerId,
      );
      if (generation !== cameraGenerationRef.current || cameraRef.current !== stream || epoch !== connectionEpochRef.current) {
        // Ticket 034: clear the fitted frame before bailing out so a cancelled
        // capture does not retain raw frame bytes.
        result.frame.fill(0);
        throw new Error("capture cancelled");
      }
      const url = URL.createObjectURL(result.blob);
      visionStillUrlRef.current = url;
      setVisionStill({ url, width: result.width, height: result.height });
      // Return raw frame bytes — VisionTrigger.look() builds the envelope
      // via buildVisionFrameEnvelope to enforce the 48 KiB bound (Ticket 034).
      return result.frame;
    } finally {
      clearTimeout(captureTimeout);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
      if (cameraRef.current === stream) cameraRef.current = null;
    }
  }, [clearVisionStill]);

  const refreshMicrophone = useCallback((room: Room) => {
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    setMicEnabled(room.localParticipant.isMicrophoneEnabled);
    setMicSettings(microphoneReport(
      navigator.mediaDevices?.getSupportedConstraints?.() ?? {},
      track?.mediaStreamTrack.getSettings(),
    ));
  }, []);

  const toggleMicrophone = useCallback(async () => {
    const room = roomRef.current;
    if (!room || micBusyRef.current) return;
    micBusyRef.current = true;
    setMicBusy(true);
    try {
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled, MICROPHONE_PROCESSING);
      if (roomRef.current === room) refreshMicrophone(room);
    } catch {
      if (roomRef.current === room) setStatus("Microphone change failed. Check browser permission and retry.");
    } finally {
      micBusyRef.current = false;
      setMicBusy(false);
    }
  }, [refreshMicrophone]);

  // ---- Ticket 022: independent portrait state (NOT tied to diagnostics) ----
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [portraitResetToken, setPortraitResetToken] = useState(0);
  const wasLocalSpeakingRef = useRef(false);
  const awaitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive portrait state from connection + independent state signals.
  const portraitState: PortraitState = !connected
    ? "disconnected"
    : audioBlocked
      ? "error"
      : localSpeaking
        ? "listening"
        : awaitingReply
          ? "thinking"
          : "idle"; // LivingPortrait promotes to speaking only from actual energy.

  // ---- Diagnostic state (opt-in; normal flow unchanged when off) ----
  const [diagEnabled, setDiagEnabled] = useState(false);
  const [codeRevision, setCodeRevision] = useState("");
  const [timeoutMsInput, setTimeoutMsInput] = useState("30000");
  const [vtEncoding, setVtEncoding] = useState("PCM_16KHZ");
  const [attempts, setAttempts] = useState<DiagAttempt[]>([]);
  const [phase, setPhase] = useState<"idle" | "speaking" | "waiting">("idle");
  const [modelId, setModelId] = useState<string | null>(null);
  const [qualityRelevant, setQualityRelevant] = useState("");
  const [qualitySpeaker, setQualitySpeaker] = useState("");
  const [qualityComplete, setQualityComplete] = useState("");
  const runIdRef = useRef<string>(newId("run"));
  const currentRef = useRef<DiagAttempt | null>(null);
  const attemptsRef = useRef<DiagAttempt[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmatchedRef = useRef<string[]>([]);
  const timeoutRef = useRef(30000);

  // Inferred thinking starts ONLY on local active-speaker true -> false,
  // never on joining or diagnostic controls. No precise backend state exists.
  useEffect(() => {
    const ended = wasLocalSpeakingRef.current && !localSpeaking;
    wasLocalSpeakingRef.current = localSpeaking;
    if (!connected || localSpeaking) {
      setAwaitingReply(false);
      if (awaitingTimerRef.current) clearTimeout(awaitingTimerRef.current);
    } else if (ended) {
      setAwaitingReply(true);
      if (awaitingTimerRef.current) clearTimeout(awaitingTimerRef.current);
      awaitingTimerRef.current = setTimeout(() => setAwaitingReply(false), 30000);
    }
  }, [localSpeaking, connected]);

  const noteMeasuredSpeech = useCallback((speaking: boolean) => {
    if (!speaking) return;
    setAwaitingReply(false);
    if (awaitingTimerRef.current) clearTimeout(awaitingTimerRef.current);
  }, []);

  const syncAttempts = useCallback((next: DiagAttempt[]) => {
    attemptsRef.current = next;
    setAttempts(next);
  }, []);

  const upsertAttempt = useCallback((a: DiagAttempt) => {
    const next = attemptsRef.current.some((x) => x.turnId === a.turnId)
      ? attemptsRef.current.map((x) => (x.turnId === a.turnId ? a : x))
      : [...attemptsRef.current, a];
    syncAttempts(next);
  }, [syncAttempts]);

  const noteAudioPlaying = useCallback(() => {
    const at = performance.now();
    setAudioStatus("Character audio: playing.");
    setAudioBlocked(false);
    const cur = currentRef.current;
    if (cur && cur.browser.audioPlayingAtMs === null) {
      const updated: DiagAttempt = {
        ...cur,
        browser: { ...cur.browser, audioPlayingAtMs: at },
      };
      currentRef.current = updated;
      upsertAttempt(updated);
    }
  }, [upsertAttempt]);

  const noteAudioAttached = useCallback(() => {
    const at = performance.now();
    setAudioStatus("Character audio: attached, waiting for playback. Keep speaker volume moderate.");
    const cur = currentRef.current;
    if (cur && cur.browser.audioAttachedAtMs === null) {
      const updated: DiagAttempt = {
        ...cur,
        browser: { ...cur.browser, audioAttachedAtMs: at },
      };
      currentRef.current = updated;
      upsertAttempt(updated);
    }
  }, [upsertAttempt]);

  const detachAllAudio = useCallback(() => {
    for (const cleanup of audioCleanupRef.current.values()) cleanup();
    audioCleanupRef.current.clear();
    audioElsRef.current.clear();
    agentSidRef.current = null;
    setAgentPlayback(null);
    setAgentMuted(false);
    setLocalSpeaking(false);
    setMicEnabled(false);
    setMicSettings("Actual microphone settings: not captured yet.");
    setAwaitingReply(false);
    if (awaitingTimerRef.current) clearTimeout(awaitingTimerRef.current);
    setPortraitResetToken((t) => t + 1);
  }, []);

  const startAudio = useCallback(async () => {
    try {
      await roomRef.current?.startAudio();
      for (const el of audioElsRef.current.values()) await el.play();
      setAudioBlocked(false);
      setAudioStatus("Character audio: enabled by user activation.");
    } catch {
      setAudioBlocked(true);
      setAudioStatus("Character audio: playback still blocked. Click Start audio again and check browser sound settings.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    connectionEpochRef.current++;
    connectingRef.current = false;
    setConnecting(false);
    discardVision();
    visionTriggerRef.current = null;
    const room = roomRef.current;
    roomRef.current = null;
    room?.removeAllListeners();
    detachAllAudio();
    await room?.disconnect();
    setConnected(false);
    setStatus("Disconnected.");
    setAudioStatus("Character audio: detached.");
  }, [detachAllAudio, discardVision]);

  const finishWithDomCommit = useCallback((turnId: string) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const cur = attemptsRef.current.find((x) => x.turnId === turnId);
      if (!cur || !cur.pending) return;
      const done: DiagAttempt = {
        ...cur, pending: false, outcome: "success",
        browser: { ...cur.browser, domCommitAtMs: performance.now() },
      };
      if (timerRef.current) clearTimeout(timerRef.current);
      currentRef.current = null;
      upsertAttempt(done);
      setPhase("idle");
      setStatus(done.isWarmup ? "Warm-up captured. Begin measured turn 1." : `Turn ${done.index} captured.`);
    }));
  }, [upsertAttempt]);

  const connect = useCallback(async () => {
    if (connectingRef.current || roomRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    const epoch = ++connectionEpochRef.current;
    try {
      setStatus("Connecting\u2026");
      const res = await fetch("/api/token?room=soulbound");
      const data = (await res.json()) as { token?: string; url?: string; error?: string };
      if (connectionEpochRef.current !== epoch) return;
      if (!data.token) throw new Error(data.error ?? "no token returned");
      const url = data.url ?? process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "ws://localhost:7880";
      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
        if (topic === "voice-status") {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as { code?: string };
            const messages: Record<string, string> = {
              "turn-failed": "Reply failed. Please try that sentence again.",
              "transcription-closed": "Speech recognition disconnected. Leave and rejoin the room.",
              "transcription-failed": "Speech recognition failed. Leave and rejoin the room.",
            };
            if (msg.code && messages[msg.code]) {
              setStatus(messages[msg.code]);
              setAudioStatus("Character audio: unavailable for this turn.");
              setAwaitingReply(false);
            }
          } catch { /* malformed status packets ignored */ }
          return;
        }
        if (topic === "latency-publish") {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; turnId?: string; publishMs?: number | null };
            if (msg.type !== "publish-complete" || !msg.turnId) return;
            const target = attemptsRef.current.find((x) => x.turnId === msg.turnId);
            if (!target) { unmatchedRef.current.push(msg.turnId); return; }
            upsertAttempt({
              ...target,
              agent: {
                utteranceVtElapsedMs: target.agent?.utteranceVtElapsedMs ?? null,
                vtSpeechEndToCompleteMs: target.agent?.vtSpeechEndToCompleteMs ?? null,
                vtCompleteToSparkMs: target.agent?.vtCompleteToSparkMs ?? null,
                sparkMs: target.agent?.sparkMs ?? null,
                publishMs: typeof msg.publishMs === "number" ? msg.publishMs : null,
                firstTokenMs: target.agent?.firstTokenMs ?? null,
                sparkFirstTokenMs: target.agent?.sparkFirstTokenMs ?? null,
                firstSentenceMs: target.agent?.firstSentenceMs ?? null,
                firstTtsChunkMs: target.agent?.firstTtsChunkMs ?? null,
                firstAudioPublishMs: target.agent?.firstAudioPublishMs ?? null,
                ttsMs: target.agent?.ttsMs ?? null,
              },
            });
          } catch { /* ignore malformed diagnostic packets */ }
          return;
        }
        if (topic === "vision-observation") {
          visionTriggerRef.current?.handleObservation(payload);
          return;
        }
        if (topic !== "turn") return;
        const receiptAt = performance.now();
        try {
          const rec = JSON.parse(new TextDecoder().decode(payload)) as {
            speaker: string | null; kind: string; transcript: string; reply: string; model: string;
            recallSources?: RecallSource[];
            diag?: { runId: string; turnId: string } | null;
            timing?: AgentTimingExport & { firstTokenMs: number | null };
            tts?: { status: string; provider: string | null; sentences: number; error: string | null };
          };
          setModelId(rec.model ?? null);
          if (rec.tts) {
            setAudioStatus(
              rec.tts.status === "ok"
                ? `Character audio: TTS ok (${rec.tts.sentences} sentence(s) via ${rec.tts.provider ?? "tts"}).`
                : rec.tts.status === "not-configured"
                  ? "Character audio: TTS not configured (text-only)."
                  : `Character audio: TTS ${rec.tts.status}${rec.tts.error ? ` — ${rec.tts.error}` : ""}. Text reply preserved.`,
            );
          }
          const recallSources = Array.isArray(rec.recallSources) ? rec.recallSources.slice(0, 10).filter(s =>
            s && /^[0-9a-f-]{36}$/i.test(s.id) && /^[0-9a-f]{64}$/.test(s.hash) &&
            /^[0-9a-f]{64}$/.test(s.root) && Number.isSafeInteger(s.epoch) && s.epoch >= 0
          ).map(s => ({ id: s.id, hash: s.hash, epoch: s.epoch, root: s.root })) : [];
          setLines((prev) => [
            ...prev,
            { who: `diarized speaker=${rec.speaker ?? "?"} (${rec.kind})`, text: rec.transcript, reply: false },
            { who: `SOULBOUND \u00b7 ${rec.model}`, text: rec.reply, reply: true, recallSources },
          ]);
          const cur = currentRef.current;
          if (cur && rec.diag?.turnId === cur.turnId) {
            const joined: DiagAttempt = {
              ...cur,
              browser: { ...cur.browser, dataReceiptAtMs: receiptAt },
              agent: rec.timing ? {
                utteranceVtElapsedMs: rec.timing.utteranceVtElapsedMs ?? null,
                vtSpeechEndToCompleteMs: rec.timing.vtSpeechEndToCompleteMs ?? null,
                vtCompleteToSparkMs: rec.timing.vtCompleteToSparkMs ?? null,
                sparkMs: rec.timing.sparkMs ?? null,
                publishMs: null,
                firstTokenMs: rec.timing.firstTokenMs ?? null,
                sparkFirstTokenMs: rec.timing.sparkFirstTokenMs ?? null,
                firstSentenceMs: rec.timing.firstSentenceMs ?? null,
                firstTtsChunkMs: rec.timing.firstTtsChunkMs ?? null,
                firstAudioPublishMs: rec.timing.firstAudioPublishMs ?? null,
                ttsMs: rec.timing.ttsMs ?? null,
              } : null,
            };
            currentRef.current = joined;
            upsertAttempt(joined);
            finishWithDomCommit(cur.turnId);
          } else if (cur && !rec.diag?.turnId) {
            unmatchedRef.current.push(`unmatched-browser-${receiptAt}`);
          }
        } catch { /* ignore malformed data packets */ }
      });
      // Ticket 003 Gate C: attach remote character audio; detach on mute/
      // unpublish/disconnect. Autoplay rejection surfaces as a visible
      // Start audio control (startAudio below), never silent silence.
      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, publication: RemoteTrackPublication, participant?: RemoteParticipant) => {
          if (track.kind !== Track.Kind.Audio) return;
          // Exact AGENT kind. Name fallback only when kind metadata is absent;
          // a named STANDARD/SIP/other participant can never drive the portrait.
          const isAgent = participant?.kind === ParticipantKind.AGENT ||
            (participant?.kind == null && publication.trackName === "soulbound-voice");
          // Only one selected agent track may be audible; no peer/duplicate path.
          if (!isAgent) return;
          const sid = publication.trackSid;
          if (agentSidRef.current && agentSidRef.current !== sid) {
            if (publication.trackName !== "soulbound-voice") return;
            audioCleanupRef.current.get(agentSidRef.current)?.();
            audioCleanupRef.current.delete(agentSidRef.current);
            audioElsRef.current.delete(agentSidRef.current);
          }
          audioCleanupRef.current.get(sid)?.();
          const el = track.attach() as HTMLMediaElement;
          const selected = true;
          if (selected) {
            agentSidRef.current = sid;
            setAgentMuted(publication.isMuted);
            setAgentPlayback({ track: track.mediaStreamTrack, element: el });
            setPortraitResetToken((t) => t + 1);
            noteAudioAttached();
          }
          const playing = () => { if (agentSidRef.current === sid) noteAudioPlaying(); };
          if (isAgent) el.addEventListener("playing", playing);
          audioElsRef.current.set(sid, el);
          (audioHostRef.current ?? document.body).appendChild(el);
          audioCleanupRef.current.set(sid, () => {
            el.removeEventListener("playing", playing);
            el.pause();
            track.detach(el); // detach, NEVER stop this shared remote track
            el.remove();
          });
          void el.play().catch(() => {
            if (agentSidRef.current !== sid || audioElsRef.current.get(sid) !== el) return;
            setAudioBlocked(true);
            setAudioStatus("Character audio: autoplay blocked. Click Start audio, then speak again.");
          });
        },
      );
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
        audioCleanupRef.current.get(publication.trackSid)?.();
        audioCleanupRef.current.delete(publication.trackSid);
        audioElsRef.current.delete(publication.trackSid);
        if (agentSidRef.current === publication.trackSid) {
          agentSidRef.current = null;
          setAgentPlayback(null);
          setAgentMuted(false);
          setAwaitingReply(false);
          setPortraitResetToken((t) => t + 1);
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        room.removeAllListeners();
        if (roomRef.current !== room) return;
        roomRef.current = null;
        connectionEpochRef.current++;
        connectingRef.current = false;
        setConnecting(false);
        discardVision();
        visionTriggerRef.current = null;
        detachAllAudio();
        setConnected(false);
        setStatus("Disconnected.");
      });
      room.on(RoomEvent.TrackMuted, (publication) => {
        if (publication.trackSid !== agentSidRef.current) return;
        setAgentMuted(true);
        setAwaitingReply(false);
        setPortraitResetToken((t) => t + 1);
      });
      room.on(RoomEvent.TrackUnmuted, (publication) => {
        if (publication.trackSid !== agentSidRef.current) return;
        setAgentMuted(false);
        setPortraitResetToken((t) => t + 1);
      });
      room.on(RoomEvent.Reconnecting, () => {
        discardVision();
        setConnected(false);
        setLocalSpeaking(false);
        setAwaitingReply(false);
        setPortraitResetToken((t) => t + 1);
      });
      room.on(RoomEvent.Reconnected, () => {
        refreshMicrophone(room);
        setConnected(true);
      });
      room.on(RoomEvent.LocalTrackPublished, () => refreshMicrophone(room));
      room.on(RoomEvent.LocalTrackUnpublished, () => refreshMicrophone(room));
      // Ticket 022: detect local speaker for "listening" portrait state.
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setLocalSpeaking(
          speakers.some((s) => s.sid === room.localParticipant.sid),
        );
      });
      await room.connect(url, data.token);
      if (connectionEpochRef.current !== epoch || roomRef.current !== room) return;
      visionTriggerRef.current = new VisionTrigger({
        source: { capture: captureVisionFrame, cancel: cancelCameraCapture },
        transport: {
          publishFrame: async (envelope) => {
            if (roomRef.current !== room || connectionEpochRef.current !== epoch) throw new Error("disconnected");
            await room.localParticipant.publishData(envelope as Uint8Array<ArrayBuffer>, { reliable: true, topic: "vision-frame" });
          },
        },
        onStatus: (s) => {
          setVisionStatus(s);
          if (s === "idle") setVisionView(null);
          if (s === "unavailable") clearVisionStill();
        },
        onView: setVisionView,
      });
      await room.localParticipant.setMicrophoneEnabled(true, MICROPHONE_PROCESSING);
      refreshMicrophone(room);
      if (connectionEpochRef.current !== epoch || roomRef.current !== room) return;
      setConnected(true);
      setStatus("Connected. Speak \u2014 your words will appear below.");
    } catch (err) {
      if (connectionEpochRef.current !== epoch) return;
      const room = roomRef.current;
      roomRef.current = null;
      room?.removeAllListeners();
      discardVision();
      visionTriggerRef.current = null;
      detachAllAudio();
      await room?.disconnect();
      setConnected(false);
      setStatus("Could not connect. Check local LiveKit configuration and browser microphone permission.");
    } finally {
      if (connectionEpochRef.current === epoch) {
        connectingRef.current = false;
        setConnecting(false);
      }
    }
  }, [detachAllAudio, discardVision, captureVisionFrame, cancelCameraCapture, clearVisionStill, refreshMicrophone, finishWithDomCommit, noteAudioAttached, noteAudioPlaying, upsertAttempt]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (awaitingTimerRef.current) clearTimeout(awaitingTimerRef.current);
    connectionEpochRef.current++;
    const room = roomRef.current;
    roomRef.current = null;
    room?.removeAllListeners();
    discardVision();
    visionTriggerRef.current = null;
    detachAllAudio();
    void room?.disconnect();
  }, [detachAllAudio, discardVision]);

  const measuredCount = attempts.filter((a) => !a.isWarmup).length;
  const nextIndex = attempts.length === 0 ? 0 : measuredCount + 1;
  const nextLabel = attempts.length === 0 ? "warm-up" : nextIndex <= 20 ? `turn ${nextIndex} of 20` : "done (20 measured)";

  const startTurn = useCallback(async () => {
    const room = roomRef.current;
    if (!room || phase !== "idle") return;
    if (attemptsRef.current.length > 0 && attemptsRef.current.filter((a) => !a.isWarmup).length >= 20) {
      setStatus("20 measured turns already recorded. Export the JSON or reset the run.");
      return;
    }
    const timeoutMs = Number(timeoutMsInput);
    timeoutRef.current = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.round(timeoutMs) : 30000;
    const isWarmup = attemptsRef.current.length === 0;
    const index = isWarmup ? 0 : attemptsRef.current.filter((a) => !a.isWarmup).length + 1;
    const attempt: DiagAttempt = {
      turnId: newId("turn"), index, isWarmup, outcome: "missing", pending: true,
      browser: {
        speechStartProxyAtMs: performance.now(), speechEndProxyAtMs: null,
        dataReceiptAtMs: null, domCommitAtMs: null,
        audioAttachedAtMs: null, audioPlayingAtMs: null,
      },
      agent: null,
    };
    currentRef.current = attempt;
    upsertAttempt(attempt);
    setPhase("speaking");
    setStatus(isWarmup ? "Warm-up: speak now, then click 'Finished speaking'." : `Turn ${index}: speak now, then click 'Finished speaking'.`);
    try {
      const arm = new TextEncoder().encode(JSON.stringify({ type: "arm", runId: runIdRef.current, turnId: attempt.turnId }));
      await room.localParticipant.publishData(arm, { reliable: true, topic: "latency-diag" });
    } catch { /* agent may be absent */ }
  }, [phase, timeoutMsInput, upsertAttempt]);

  const finishedSpeaking = useCallback(() => {
    const cur = currentRef.current;
    if (!cur || phase !== "speaking") return;
    const updated: DiagAttempt = { ...cur, browser: { ...cur.browser, speechEndProxyAtMs: performance.now() } };
    currentRef.current = updated;
    upsertAttempt(updated);
    setPhase("waiting");
    setStatus("Marker recorded (manual proxy). Waiting for the visible reply\u2026");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const c = currentRef.current;
      if (!c || c.turnId !== updated.turnId) return;
      const timed: DiagAttempt = { ...c, pending: false, outcome: "timeout" };
      currentRef.current = null;
      upsertAttempt(timed);
      setPhase("idle");
      setStatus(`Turn timed out after ${timeoutRef.current}ms. It is counted; do not replace it. Start the next turn.`);
    }, timeoutRef.current);
  }, [phase, upsertAttempt]);

  const markFailed = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const failed: DiagAttempt = { ...cur, pending: false, outcome: "failed" };
    currentRef.current = null;
    upsertAttempt(failed);
    setPhase("idle");
    setStatus("Turn marked failed. It is counted; start the next turn.");
  }, [upsertAttempt]);

  const resetRun = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    runIdRef.current = newId("run");
    currentRef.current = null;
    unmatchedRef.current = [];
    syncAttempts([]);
    setPhase("idle");
    setStatus("Diagnostic run reset. Start with the warm-up turn.");
  }, [syncAttempts]);

  const exportJson = useCallback(() => {
    const parseCount = (s: string) => (s.trim() === "" ? null : Number(s));
    const payload = {
      schemaVersion: 1,
      kind: "soulbound-live-latency",
      mode: "live-mic",
      runId: runIdRef.current,
      exportedAt: new Date().toISOString(),
      date: new Date().toISOString(),
      codeRevision: codeRevision || "unspecified",
      browser: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      modelId: modelId ?? "unknown",
      vtEncoding,
      warmupPolicy: "1 warm-up attempt recorded separately and excluded from measured percentiles",
      timeoutMs: timeoutRef.current,
      boundaryDefinition: BOUNDARY,
      percentileMethod: "nearest-rank",
      quality: {
        relevantCount: parseCount(qualityRelevant),
        speakerOkCount: parseCount(qualitySpeaker),
        completeCount: parseCount(qualityComplete),
      },
      unmatchedAgentTurnIds: [...unmatchedRef.current],
      turns: attemptsRef.current.map((a) => ({
        turnId: a.turnId, index: a.index, isWarmup: a.isWarmup,
        outcome: a.pending ? "missing" : a.outcome,
        browser: a.browser, agent: a.agent,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "soulbound-019-live.json";
    link.click();
    URL.revokeObjectURL(href);
    setStatus("Timing JSON downloaded (metadata only). Save it outside the repo, e.g. /tmp/soulbound-019-live.json, then run the report CLI.");
  }, [codeRevision, modelId, vtEncoding, qualityRelevant, qualitySpeaker, qualityComplete]);

  const diagCounts = {
    warmup: attempts.filter((a) => a.isWarmup).length,
    measured: measuredCount,
    success: attempts.filter((a) => !a.isWarmup && a.outcome === "success" && !a.pending).length,
    failed: attempts.filter((a) => !a.isWarmup && a.outcome === "failed").length,
    timeout: attempts.filter((a) => !a.isWarmup && a.outcome === "timeout").length,
  };

  return (
    <main className={styles.room}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="SOULBOUND room">
          <svg width="23" height="27" viewBox="0 0 23 27" fill="none" aria-hidden="true">
            <path d="M3 23V12a8.5 8.5 0 0 1 17 0v11H3Z" stroke="currentColor" />
            <path d="M8 12v5m7-5v5M1 21l21-4" stroke="currentColor" />
          </svg>
          SOULBOUND<span className={styles.brandDivider}>/</span><span className={styles.roomWord}>THE ROOM</span>
        </a>
        <a className={styles.proofLink} href="/life">Life &amp; proof <span aria-hidden="true">↗</span></a>
      </header>

      <section className={styles.experience} aria-label="Voice room">
        <div className={styles.stageTop}>
          <span className={styles.stageIndex}>01 <span>/</span> A presence, not a profile.</span>
          <div className={styles.visualSelector} role="group" aria-label="Character visual">
            <button aria-pressed={visualVariant === "soul"} onClick={() => setVisualVariant("soul")}>Warden</button>
            <button aria-pressed={visualVariant === "portrait"} onClick={() => setVisualVariant("portrait")}>Portrait</button>
          </div>
        </div>
        <div className={styles.stage}>
          <p className={`${styles.marginNote} ${styles.leftNote}`}><span>THE MEDIUM</span>Voice + vision<br /><span className={styles.noteRule} />A conversation.<br />Not a command line.</p>
          <div className={styles.character} data-variant={visualVariant}>
            <LivingPortrait
              state={portraitState}
              agentTrack={agentMuted ? null : agentPlayback?.track ?? null}
              playbackElement={agentPlayback?.element ?? null}
              assetSrc={avatar.src}
              resetToken={portraitResetToken}
              onSpeakingChange={noteMeasuredSpeech}
              variant={visualVariant}
            />
          </div>
          <p className={`${styles.marginNote} ${styles.rightNote}`}><span>THE CONNECTION</span><span className={styles.connection} data-connected={connected}>{connecting ? "Connecting" : connected ? "Connected" : "Offline"}</span><span className={styles.noteRule} />Your microphone opens<br />only when you join.</p>
        </div>

        <div className={styles.controls}>
          <button className={styles.keycap} onClick={connected ? disconnect : connect} disabled={connecting}>
            <span className={styles.keyFace}><span className={styles.keyIcon} aria-hidden="true">{connected ? "↗" : "+"}</span>{connecting ? "Connecting…" : connected ? "Leave" : "Join room"}<span className={styles.keyCorner} aria-hidden="true">↵</span></span>
          </button>
          <div className={styles.audioControls}>
            <button onClick={startAudio} disabled={!connected}>Start audio <span aria-hidden="true">↗</span></button>
            <button onClick={toggleMicrophone} disabled={!connected || micBusy} aria-pressed={!micEnabled} aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}>
              {micBusy ? "Updating mic…" : micEnabled ? "Mute mic" : "Unmute mic"}
            </button>
            <span>Speaker mode · moderate volume</span>
          </div>
        </div>

        <div className={styles.liveStatus}>
          <p role="status">{status}</p>
          <p role="status">{audioStatus}</p>
          {audioBlocked && (
            <p className={styles.audioAlert} role="alert">
              Audio playback is blocked by the browser. Click Start audio (user activation), then speak again.
            </p>
          )}
          <details>
            <summary>Speaker &amp; microphone settings</summary>
            <p>Requested: echoCancellation=true, noiseSuppression=true, autoGainControl=true.</p>
            <p>{micSettings}</p>
            <p>Use moderate speaker volume and keep the built-in mic away from speaker output. Processing cannot guarantee no echo. If feedback persists, mute the mic while the character speaks, then unmute.</p>
          </details>
        </div>
        <div ref={audioHostRef} aria-hidden="true" />

        <div className={styles.headline}>
          <p className={styles.eyebrow}>A persistent voice + vision character</p>
          <h1>Talk to it.<br /><span>And it changes.</span></h1>
          <p className={styles.tagline}>— and every change is provable.</p>
        </div>
      </section>

      <div className={styles.belowStage}>
        <section className={styles.transcript} aria-labelledby="transcript-title">
          <div className={styles.sectionHeading}>
            <h2 id="transcript-title">The conversation</h2><span>LIVE TRANSCRIPT</span>
          </div>
          <div className={styles.modelInfo}><span>Live response model: {modelId ?? "not reported yet"}</span><span>Turn cost: unavailable</span></div>
          <p className={styles.stackInfo}>Architecture (not live health): Meta Voice Transcribe · Meta Spark conversation/vision · SAM 3.1 segmentation adapter integrated, live configuration/entitlement unverified · VoxCPM2 voice synthesis by OpenBMB (not Meta).</p>
          <div className={styles.log} aria-live="polite" aria-relevant="additions text">
            {lines.length === 0 && <p className={styles.emptyTranscript}>An empty room. An open beginning.<span>Join and speak. Your conversation will appear here.</span></p>}
            {lines.map((line, i) => (
              <div key={i} className={`${styles.line} ${line.reply ? styles.reply : ""}`}>
                <span className={styles.who}>{line.who}</span>
                {line.text}
                {line.reply && <div>
                  {line.recallSources?.length ? <>
                    <p>Sealed memory supplied to this reply · chain inclusion not yet checked. This does not prove the model used it.</p>
                    {line.recallSources.map(source => <details key={source.id}>
                      <summary>Memory {source.id} · epoch {source.epoch}</summary>
                      <p>Leaf hash: <code>{source.hash}</code></p>
                      <p>Local sealed root: <code>{source.root}</code></p>
                      <a href={`/life?memory=${encodeURIComponent(source.id)}`} target="_blank" rel="noreferrer">Verify this exact memory on Solana ↗</a>
                    </details>)}
                  </> : <p>No sealed memory supplied to this reply. Session context is not an on-chain commitment.</p>}
                </div>}
              </div>
            ))}
          </div>
        </section>

      <section className={styles.vision} aria-labelledby="vision-title">
        <div className={styles.sectionHeading}><h2 id="vision-title">A look, not a live feed</h2><span>EXPLICIT CAPTURE</span></div>
        <p>Nothing is captured or sent before your click. One frame goes to SAM 3.1 segmentation and Meta Spark vision. Camera tracks stop after capture; the local still stays only until discarded, next look, or disconnect.</p>
        <p>Guest room access is not owner authentication. Do not show sensitive material.</p>
        <div className={styles.visionActions}>
          <button onClick={() => { clearVisionStill(); void visionTriggerRef.current?.look(); }} disabled={!connected || visionStatus === "capturing" || visionStatus === "sent"}>Look at this</button>
          <button onClick={discardVision} disabled={visionStatus === "idle" && !visionStill}>Discard view</button>
        </div>
        <p role="status">
          {visionStatus === "idle" && "Vision idle — no camera or vision request before click."}
          {visionStatus === "capturing" && "Capturing one frame…"}
          {visionStatus === "sent" && "Frame sent once; waiting for observation. No automatic retries."}
          {visionStatus === "failed" && "That look did not complete. Private memory linkage was not confirmed; no saved observation is claimed."}
          {visionStatus === "unavailable" && "Vision unavailable — camera denied, disconnected, timed out, or path not configured. No success claimed."}
          {visionStatus === "observed" && (visionView?.durable ? "Observation received and linked to private memory." : "Observation received; not saved to durable memory.")}
        </p>
        {visionView && (
          <div className={styles.visionResult}>
            {visionStill && (
              <div className={styles.visionImage}>
                <img src={visionStill.url} alt="Single explicitly captured frame" />
                {visionView.mask_overlay && (
                  <svg aria-hidden="true" viewBox={`0 0 ${visionView.mask_overlay.width} ${visionView.mask_overlay.height}`} preserveAspectRatio="none" style={{
                    position: "absolute",
                    left: `${(visionView.mask_overlay.left / visionStill.width) * 100}%`,
                    top: `${(visionView.mask_overlay.top / visionStill.height) * 100}%`,
                    width: `${((visionView.mask_overlay.right - visionView.mask_overlay.left) / visionStill.width) * 100}%`,
                    height: `${((visionView.mask_overlay.bottom - visionView.mask_overlay.top) / visionStill.height) * 100}%`,
                  }}>
                    <path d={visionView.mask_overlay.svg} fill="rgba(123,216,143,0.35)" stroke="#7bd88f" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
                {visionView.bbox && !visionView.mask_overlay && (
                  <div aria-hidden="true" title="Bounding-box highlight (mask outline unavailable)" style={{
                    position: "absolute", boxSizing: "border-box", border: "2px solid #7bd88f",
                    left: `${(visionView.bbox[0] / visionStill.width) * 100}%`,
                    top: `${(visionView.bbox[1] / visionStill.height) * 100}%`,
                    width: `${(visionView.bbox[2] / visionStill.width) * 100}%`,
                    height: `${(visionView.bbox[3] / visionStill.height) * 100}%`,
                  }} />
                )}
              </div>
            )}
            <p><strong>{visionView.object_label}</strong>{visionView.synthetic && " · SYNTHETIC FIXTURE"}</p>
            <p>{visionView.summary}</p>
            <p>{visionView.mask_overlay ? "SAM mask outline (transient)" : visionView.bbox ? "Bounding-box highlight — mask outline unavailable" : "No highlight available"}</p>
            <p>Confidence {visionView.confidence.toFixed(2)} · frame {visionView.frame_hash.slice(0, 12)}… · mask {visionView.mask_ref.slice(0, 16)}…</p>
          </div>
        )}
      </section>

      <details className={styles.diagnostics}>
        <summary><span>Room diagnostics</span><span className={styles.summaryHint}>Timing, quality &amp; export <span aria-hidden="true">＋</span></span></summary>
        <section aria-label="Latency diagnostic (Ticket 019)" className={styles.diagnosticBody}>
        <label>
          <input type="checkbox" checked={diagEnabled} onChange={(e) => setDiagEnabled(e.target.checked)} />
          {" "}Latency diagnostic (Ticket 019 baseline, extended by Ticket 003 with TTS/playback proxies — still not REQ-40 first-audio proof)
        </label>
        {diagEnabled && (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#9aa39c" }}>
              One warm-up, then 20 measured turns. Per turn: Start turn → speak →
              click Finished speaking the instant you stop → wait for the reply.
              The Finished click is a manual proxy, not true speech-end. Slow/failed
              turns count; never replace them. Export is metadata-only.
            </p>
            <label>Code revision <input value={codeRevision} onChange={(e) => setCodeRevision(e.target.value)} placeholder="git short hash" /></label>
            <label>Timeout (ms, same for every turn) <input value={timeoutMsInput} onChange={(e) => setTimeoutMsInput(e.target.value)} inputMode="numeric" /></label>
            <label>VT encoding <input value={vtEncoding} onChange={(e) => setVtEncoding(e.target.value)} /></label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={startTurn} disabled={!connected || phase !== "idle"}>Start {nextLabel}</button>
              <button onClick={finishedSpeaking} disabled={phase !== "speaking"}>Finished speaking</button>
              <button onClick={markFailed} disabled={phase === "idle"}>Mark failed</button>
              <button onClick={resetRun}>Reset run</button>
              <button onClick={exportJson}>Export timing JSON</button>
            </div>
            <p role="status" style={{ margin: 0, fontSize: 13 }}>
              warm-up: {diagCounts.warmup} · measured: {diagCounts.measured}/20 ·
              success: {diagCounts.success} · failed: {diagCounts.failed} · timeout: {diagCounts.timeout}
              {phase !== "idle" ? ` · in progress: ${phase}` : ""}
            </p>
            <fieldset>
              <legend>Aggregate quality counts (review replies locally; counts only in export)</legend>
              <label>Relevant <input value={qualityRelevant} onChange={(e) => setQualityRelevant(e.target.value)} inputMode="numeric" size={4} /></label>{" "}
              <label>Speaker behaviour OK <input value={qualitySpeaker} onChange={(e) => setQualitySpeaker(e.target.value)} inputMode="numeric" size={4} /></label>{" "}
              <label>Complete <input value={qualityComplete} onChange={(e) => setQualityComplete(e.target.value)} inputMode="numeric" size={4} /></label>
            </fieldset>
          </div>
        )}
        </section>
      </details>
      <footer className={styles.footer}><span>SOULBOUND / A CONTINUITY EXPERIMENT</span><span>Warden is procedural, not a likeness rig.</span></footer>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LivingPortrait } from "./index";
import type { PortraitState } from "./types";
import avatar from "@/assets/soulbound-avatar-meta-preview.webp";
import styles from "./living-portrait.module.css";

const STATES: PortraitState[] = ["idle", "listening", "thinking", "speaking", "disconnected", "error"];

/** Synthetic development fixture. No microphone, LiveKit, or VoxCPM2 claims. */
export default function Fixture() {
  const [state, setState] = useState<PortraitState>("idle");
  const [reduced, setReduced] = useState(false);
  const [missingModel, setMissingModel] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [silent, setSilent] = useState(false);
  const [muted, setMuted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [element, setElement] = useState<HTMLAudioElement | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [status, setStatus] = useState("Stopped. Use low speaker volume or headphones.");
  const resources = useRef<{ ctx: AudioContext; oscillator: OscillatorNode; silence: GainNode; stream: MediaStream } | null>(null);
  const stop = useCallback(() => {
    const owned = resources.current;
    resources.current = null;
    if (!owned) return;
    try { owned.oscillator.stop(); } catch { /* already stopped */ }
    // Only the fixture's OWN generated tracks, never product/shared tracks.
    for (const ownedTrack of owned.stream.getTracks()) ownedTrack.stop();
    void owned.ctx.close().catch(() => {});
  }, []);
  useEffect(() => () => { stop(); }, [stop]);
  useEffect(() => {
    if (resources.current) resources.current.silence.gain.value = silent ? 0 : 1;
  }, [silent]);
  useEffect(() => { if (element) element.muted = muted; }, [element, muted]);
  useEffect(() => { if (track) track.enabled = enabled; }, [track, enabled]);

  function removeTrack() {
    stop();
    if (element) { element.pause(); element.srcObject = null; }
    setTrack(null);
    setStatus("Removed synthetic track; envelope must be zero.");
  }
  function play() {
    if (!element) return;
    stop();
    let ctx: AudioContext | undefined;
    try {
      ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = 220;
      const pulse = ctx.createGain();
      const silence = ctx.createGain();
      silence.gain.value = silent ? 0 : 1;
      for (let i = 0; i < 120; i++) {
        const at = ctx.currentTime + i * 0.5;
        pulse.gain.setValueAtTime(0, at);
        pulse.gain.linearRampToValueAtTime(0.2, at + 0.1);
        pulse.gain.linearRampToValueAtTime(0, at + 0.35);
      }
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(pulse);
      pulse.connect(silence);
      silence.connect(destination); // NEVER ctx.destination: sole audible path is HTML audio.
      resources.current = { ctx, oscillator, silence, stream: destination.stream };
      const synthetic = destination.stream.getAudioTracks()[0];
      synthetic.enabled = enabled;
      element.muted = muted;
      element.srcObject = destination.stream;
      setTrack(synthetic);
      oscillator.start();
      void ctx.resume().catch(() => {});
      void element.play().catch(() => setStatus("Browser blocked playback. Press Resume audio."));
    } catch {
      stop();
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
      setTrack(null);
      setStatus("Synthetic audio unavailable in this browser.");
    }
  }
  function resume() {
    void resources.current?.ctx.resume().catch(() => {});
    void element?.play().catch(() => setStatus("Playback remains blocked."));
  }
  return (
    <main>
      <h1>Living portrait · development fixture</h1>
      <p>Synthetic pulsing tone only — NOT a live VoxCPM2 synchronization test. No mic capture.</p>
      <div className={styles.pageStage}>
        <LivingPortrait state={state} agentTrack={track} playbackElement={element}
          assetSrc={avatar.src} resetToken={resetToken} reducedMotion={reduced}
          glbSrc={missingModel ? "/__portrait_missing_approved.glb" : undefined}
          glbControls={{ jaw: "jawOpen", blink: "blink" }} allowWebGL={webgl} />
        <div>
          <label>Requested state <select value={state} onChange={(e) => setState(e.target.value as PortraitState)}>
            {STATES.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <p>“Speaking” still requires actual measured energy. Thinking/listening are synthetic state inputs here.</p>
          <p><label><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduced motion (OS preference also applies)</label></p>
          <p><label><input type="checkbox" checked={missingModel} onChange={(e) => setMissingModel(e.target.checked)} /> Request missing GLB (404 test, not approved likeness)</label></p>
          <p><label><input type="checkbox" checked={!webgl} onChange={(e) => setWebgl(!e.target.checked)} /> Disable WebGL (fallback policy simulation)</label></p>
        </div>
      </div>
      <fieldset style={{ marginTop: 20 }}>
        <legend>Sole audible HTML audio path</legend>
        <audio ref={setElement} controls onPlaying={() => setStatus("HTML audio playing (not proof of physical speaker output).")}
          onPause={() => setStatus("Paused: energy must be zero.")} onError={() => setStatus("HTML audio error: energy must be zero.")} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
          <button onClick={play}>Start / replace tone</button>
          <button onClick={() => element?.pause()}>Pause</button>
          <button onClick={resume}>Resume audio</button>
          <button onClick={() => { setResetToken((n) => n + 1); setStatus("Envelope reset; analyzer stays reusable."); }}>Reset envelope</button>
          <button onClick={removeTrack}>Interrupt / remove track</button>
          <button onClick={() => { element?.dispatchEvent(new Event("waiting")); setStatus("Simulated waiting: must latch zero until actual playing (Pause, Resume)."); }}>Simulate waiting</button>
          <button onClick={() => { element?.dispatchEvent(new Event("stalled")); setStatus("Simulated stalled: must latch zero until actual playing (Pause, Resume)."); }}>Simulate stalled</button>
          <button onClick={() => { void resources.current?.ctx.suspend(); }}>Suspend source context</button>
        </div>
        <p><label><input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} /> Exact silence (observe soft decay)</label></p>
        <p><label><input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> Mute playback element (immediate zero)</label></p>
        <p><label><input type="checkbox" checked={!enabled} onChange={(e) => setEnabled(!e.target.checked)} /> Disable generated track (immediate zero)</label></p>
        <p role="status">{status}</p>
      </fieldset>
      <p>Check mobile sizing, readable labels and static OS reduced-motion output. Real WebGL context loss / rig motion require an approved model, which is absent. No word timestamps or visemes are supplied.</p>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LivingPortraitProps, EnergyEnvelope } from "./types";
import { createEnergyAnalyzer, type EnergyAnalyzer } from "./analyzer";
import { bindPlaybackGate } from "./playback";
import Renderer2D from "./renderer-2d";
import RendererGLB from "./renderer-glb";
import RendererSoul from "./renderer-soul";

const ZERO: EnergyEnvelope = { level: 0, raw: 0, decaying: true };

export default function LivingPortrait({
  state, agentTrack, playbackElement, assetSrc, glbSrc, glbControls,
  timedCues, playbackClock, reducedMotion: reducedMotionProp,
  resetToken = 0, className, onSpeakingChange, allowWebGL = true, variant = "portrait",
}: LivingPortraitProps) {
  const [sample, setSample] = useState<{ energy: EnergyEnvelope; track: MediaStreamTrack;
    element: HTMLMediaElement; token: number } | null>(null);
  const tokenRef = useRef(resetToken);
  tokenRef.current = resetToken;
  const [analysisUnavailable, setAnalysisUnavailable] = useState(false);
  const analyzerRef = useRef<EnergyAnalyzer | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReducedMotion(mq.matches);
    const change = () => setSystemReducedMotion(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  // A caller can request less motion, never override an OS accessibility setting.
  const reducedMotion = systemReducedMotion || reducedMotionProp === true;
  const reset = useCallback(() => {
    analyzerRef.current?.reset();
    setSample(null);
  }, []);
  useEffect(reset, [resetToken, reset]);
  useEffect(() => {
    if (["disconnected", "error", "listening"].includes(state)) reset();
  }, [state, reset]);

  useEffect(() => {
    setAnalysisUnavailable(false);
    setSample(null);
    if (!agentTrack || !playbackElement) return;
    let active = true;
    let raf = 0;
    let analyzer: EnergyAnalyzer;
    try {
      analyzer = createEnergyAnalyzer(agentTrack);
    } catch {
      setAnalysisUnavailable(true);
      return; // Analyzer failure never changes the audible playback path.
    }
    analyzerRef.current = analyzer;
    const gate = bindPlaybackGate(playbackElement, agentTrack, reset);
    const resume = () => { void analyzer.resume().catch(() => {}); };
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    function tick() {
      if (!active) return;
      const neutral = ["disconnected", "error", "listening"].includes(stateRef.current);
      try {
        if (neutral || !gate.isOpen(analyzer.running())) {
          analyzer.reset();
          setSample(null);
        } else {
          setSample({ energy: analyzer.update(), track: agentTrack!, element: playbackElement!, token: tokenRef.current });
        }
      } catch {
        analyzer.reset();
        setSample(null);
        analyzer.destroy();
        setAnalysisUnavailable(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      gate.dispose();
      analyzer.destroy();
      if (analyzerRef.current === analyzer) analyzerRef.current = null;
    };
  }, [agentTrack, playbackElement, reset]);

  const neutral = ["disconnected", "error", "listening"].includes(state);
  // Ignore caller "speaking" claims without measured playback energy. Thinking
  // is only an inference and yields to actual agent audio (even on persistent tracks).
  const currentSample = sample?.track === agentTrack && sample?.element === playbackElement && sample?.token === resetToken;
  const effectiveEnergy = neutral || !currentSample ? ZERO : sample!.energy;
  const speaking = effectiveEnergy.level > 0.04;
  const displayState = speaking ? "speaking" : state === "speaking" ? "idle" : state;
  useEffect(() => { onSpeakingChange?.(speaking); }, [speaking, onSpeakingChange]);
  useEffect(() => () => { onSpeakingChange?.(false); }, [onSpeakingChange]);

  return (
    <div className={className} data-testid="living-portrait" data-energy={effectiveEnergy.level.toFixed(3)}>
      {variant === "soul" ? (
        <RendererSoul state={displayState} energy={effectiveEnergy} reducedMotion={reducedMotion} />
      ) : glbSrc && !reducedMotion ? (
        <RendererGLB state={displayState} assetSrc={assetSrc} glbSrc={glbSrc}
          controls={glbControls} energy={effectiveEnergy} timedCues={timedCues}
          playbackClock={playbackClock} reducedMotion={false} allowWebGL={allowWebGL} />
      ) : (
        <Renderer2D state={displayState} assetSrc={assetSrc} energy={effectiveEnergy}
          reducedMotion={reducedMotion} />
      )}
      {analysisUnavailable && <p role="status">Audio reactivity unavailable; playback is unaffected.</p>}
    </div>
  );
}

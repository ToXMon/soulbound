"use client";

import { useId } from "react";
import type { EnergyEnvelope, PortraitState } from "./types";
import styles from "./soul.module.css";

interface Props {
  state: PortraitState;
  energy: EnergyEnvelope;
  reducedMotion: boolean;
}

/** Presentation only. Input is LivingPortrait's already-gated agent energy. */
export function wardenPose(state: PortraitState, level: number, reducedMotion: boolean) {
  const neutral = state === "disconnected" || state === "error";
  const motion = !neutral && !reducedMotion;
  const energy = motion && state === "speaking" && Number.isFinite(level)
    ? Math.max(0, Math.min(1, level)) : 0;
  const listening = motion && state === "listening";
  const thinking = motion && state === "thinking";
  return {
    motion, energy,
    eyeHeight: neutral ? 9 : listening ? 64 : thinking ? 45 : 58,
    gazeX: thinking ? 6 : 0,
    gazeY: thinking ? -6 : listening ? -2 : 0,
    browY: listening ? 155 : thinking ? 166 : 168,
    tilt: listening ? -3 : thinking ? 3 : 0,
    light: neutral ? 0.25 : 0.88,
    beadAngle: thinking ? -65 : listening ? 150 : 25,
  };
}

const labels: Record<PortraitState, string> = {
  idle: "Ready", listening: "Listening to you", thinking: "Awaiting reply · inferred",
  speaking: "Speaking", disconnected: "Disconnected", error: "Audio issue",
};

export default function RendererSoul({ state, energy, reducedMotion }: Props) {
  const id = `warden-${useId().replace(/:/g, "")}`;
  const url = (name: string) => `url(#${id}-${name})`;
  const p = wardenPose(state, energy.level, reducedMotion);
  const body = "M90 340V196C90 120 138 70 200 70S310 120 310 196V340C310 362 290 374 268 374H132C110 374 90 362 90 340Z";
  const visor = "M118 310V205C118 152 154 120 200 120S282 152 282 205V310C282 318 276 324 268 324H132C124 324 118 318 118 310Z";
  const aperture = p.energy > 0.04 ? p.energy * 30 : 0;
  const mouthWidth = 27 + p.energy * 8;
  const angle = p.beadAngle * Math.PI / 180;
  const beadX = 200 + 178 * Math.cos(angle);
  const beadY = 318 + 30 * Math.sin(angle);

  function tether(front: boolean) {
    return (
      <g transform="rotate(-6 200 318)" opacity={p.light}>
        <ellipse cx="200" cy="318" rx="178" ry="30" fill="none" stroke="#2fd6c0"
          strokeWidth="1.3" strokeDasharray={state === "disconnected" ? "4 8" : state === "thinking" ? "10 7" : undefined}
          clipPath={url(front ? "front" : "back")} />
        {(Math.sin(angle) > 0) === front && (
          <circle cx={beadX} cy={beadY} r="4" fill="#bff7ee" filter={url("glow")} />
        )}
      </g>
    );
  }

  return (
    <figure className={styles.figure} data-state={state} data-motion={p.motion ? "on" : "off"}
      data-reduced-motion={reducedMotion ? "true" : "false"}>
      <svg className={styles.warden} viewBox="0 0 400 460" role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>Warden · obsidian arch, glass visor and orbital tether</title>
        <defs>
          <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#34454a" /><stop offset=".24" stopColor="#1c272b" />
            <stop offset=".6" stopColor="#0c1114" /><stop offset="1" stopColor="#070a0b" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#080e10" /><stop offset=".55" stopColor="#010202" />
            <stop offset="1" stopColor="#061011" />
          </linearGradient>
          <linearGradient id={`${id}-highlight`} x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#fff" stopOpacity="0" /><stop offset=".65" stopColor="#e6f6ff" stopOpacity=".65" />
            <stop offset="1" stopColor="#fff" stopOpacity=".15" />
          </linearGradient>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#2fd6c0" stopOpacity="0" /><stop offset=".4" stopColor="#2fd6c0" />
            <stop offset="1" stopColor="#2fd6c0" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-core`}>
            <stop stopColor="#2fd6c0" stopOpacity=".23" /><stop offset="1" stopColor="#2fd6c0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-halo`}>
            <stop stopColor="#2fd6c0" stopOpacity=".24" /><stop offset="1" stopColor="#2fd6c0" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`${id}-soft`} x="-50%" y="-150%" width="200%" height="400%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <clipPath id={`${id}-back`}><rect x="0" y="0" width="400" height="318" /></clipPath>
          <clipPath id={`${id}-front`}><rect x="0" y="318" width="400" height="140" /></clipPath>
          <clipPath id={`${id}-visor`}><path d={visor} /></clipPath>
        </defs>
        <ellipse cx="200" cy="421" rx="110" ry="10" fill="#000" filter={url("soft")} />
        <ellipse cx="200" cy="421" rx="93" ry="5" fill="#63a79e" opacity=".12" filter={url("soft")} />
        <g className={styles.float}>
          <g className={styles.pose} style={{ transform: `rotate(${p.tilt}deg)` }}>
            <ellipse className={styles.speechHalo} cx="200" cy="220" rx="196" ry="208"
              fill={url("halo")} opacity={p.energy * 0.8} data-speech-halo={p.energy.toFixed(3)} />
            {tether(false)}
            <path d={body} fill={url("body")} stroke="#566970" strokeOpacity=".45" strokeWidth="1.2" />
            <path d="M98 214C98 130 142 80 200 80" fill="none" stroke={url("highlight")}
              strokeWidth="3" strokeLinecap="round" />
            <path d="M104 184C109 124 150 87 190 87" fill="none" stroke="#d9ecf2"
              strokeWidth=".7" strokeOpacity=".16" />
            <path d="M304 196C304 136 270 92 222 78" fill="none" stroke={url("rim")}
              opacity={p.light} strokeWidth="2.4" strokeLinecap="round" />
            <path d={visor} fill={url("glass")} stroke="#82b9b5" strokeOpacity=".18" strokeWidth="1.2" />
            <ellipse cx="200" cy="238" rx="85" ry="80" fill={url("core")} opacity={p.light} />
            <g clipPath={url("visor")}>
              <path d="M126 140L196 122L152 330H126Z" fill="#e3f5fc" opacity=".045" />
              <path d="M271 150L266 316" stroke="#82b9b5" strokeOpacity=".08" />
            </g>
            <g className={styles.gaze} transform={`translate(${p.gazeX} ${p.gazeY})`} opacity={p.light}>
              <g fill="none" stroke="#bff7ee" strokeWidth="2.5" strokeLinecap="round" opacity=".55">
                <path d={`M144 ${p.browY}L174 ${p.browY - 2}`} />
                <path d={`M226 ${p.browY - 2}L256 ${p.browY}`} />
              </g>
              <g className={styles.eyes} fill="#bff7ee" filter={url("glow")}>
                <rect x="150.5" y={212 - p.eyeHeight / 2} width="19" height={p.eyeHeight} rx="9.5" />
                <rect x="230.5" y={212 - p.eyeHeight / 2} width="19" height={p.eyeHeight} rx="9.5" />
              </g>
            </g>
            <path className={styles.closedMouth} d="M173 282Q200 286 227 282" fill="none"
              stroke="#bff7ee" strokeWidth="3" strokeLinecap="round" opacity={aperture ? 0 : p.light}
              filter={url("glow")} />
            <path className={styles.openMouth} data-mouth-aperture={aperture.toFixed(3)}
              d={`M${200 - mouthWidth} 282Q200 ${282 - aperture * 0.7} ${200 + mouthWidth} 282Q200 ${282 + aperture * 1.6} ${200 - mouthWidth} 282Z`}
              fill="#021615" stroke="#bff7ee" strokeWidth="2.6" strokeLinejoin="round"
              opacity={aperture ? 1 : 0} filter={url("glow")} />
            <rect x="184" y="348" width="32" height="4" rx="2" fill="#2fd6c0" opacity={p.light} filter={url("glow")} />
            {tether(true)}
          </g>
        </g>
      </svg>
      <figcaption className={styles.caption}>
        <span className={styles.state} role="status">{labels[state]}</span>
        <span className={styles.note}>Warden · {reducedMotion ? "static / reduced motion" : "audio-reactive / approximate"}</span>
      </figcaption>
    </figure>
  );
}

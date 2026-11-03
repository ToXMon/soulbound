"use client";

import { useState, type CSSProperties, type PointerEvent } from "react";
import type { PortraitState, EnergyEnvelope } from "./types";
import styles from "./living-portrait.module.css";

interface Props {
  state: PortraitState;
  assetSrc: string;
  energy: EnergyEnvelope;
  reducedMotion: boolean;
  note?: string;
}

export default function Renderer2D({ state, assetSrc, energy, reducedMotion,
  note = "Approved image · no approved 3D rig supplied." }: Props) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const neutral = state === "disconnected" || state === "error";
  const motion = !reducedMotion && !neutral;
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!motion || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    setTilt({ x: clamp((event.clientX - rect.left) / rect.width * 2 - 1),
      y: clamp((event.clientY - rect.top) / rect.height * 2 - 1) });
  }
  const label = { idle: "Ready", speaking: "Speaking", listening: "Listening to you",
    thinking: "Thinking…", disconnected: "Disconnected", error: "Audio issue" }[state];
  return (
    <div className={`${styles.container} ${reducedMotion ? styles.reducedMotion : ""}`}>
      <div className={`${styles.panel} ${motion ? styles.float : ""}`} data-state={state}
        onPointerMove={move} onPointerLeave={() => setTilt({ x: 0, y: 0 })}
        style={{ "--lp-tilt-x": motion ? -tilt.y * 0.6 : 0,
          "--lp-tilt-y": motion ? tilt.x * 0.6 : 0,
          "--lp-halo-opacity": motion ? Math.min(0.65, energy.level * 0.65) : 0 } as CSSProperties}>
        {/* Whole approved image only: never deform the mouth or face. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.image} src={assetSrc} alt="SOULBOUND character portrait" />
        <div className={styles.halo} aria-hidden="true" />
        <span className={styles.modeBadge}>
          {reducedMotion ? "Static portrait · reduced motion" : "Reactive portrait · 2.5D"}
        </span>
      </div>
      <span className={styles.label} data-state={state} role="status">{label}</span>
      <p className={styles.note}>{note}</p>
    </div>
  );
}

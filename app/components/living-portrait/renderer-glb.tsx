"use client";

import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import type { PortraitState, EnergyEnvelope, GLBControls, TimedCue } from "./types";
import { validateTimedCues, cueValueAt } from "./signal";
import { mapMorphControls, setMorph } from "./rig";
import Renderer2D from "./renderer-2d";
import styles from "./living-portrait.module.css";

interface Props {
  state: PortraitState;
  assetSrc: string;
  glbSrc: string;
  controls?: GLBControls;
  energy: EnergyEnvelope;
  timedCues?: TimedCue[];
  playbackClock?: number;
  reducedMotion: boolean;
  allowWebGL: boolean;
}

/** Dispose every material texture slot, not only its diffuse map. Also handles
 * models that finish loading AFTER unmount/failure/context loss. */
function disposeModel(root: Three.Object3D) {
  const geometries = new Set<Three.BufferGeometry>();
  const materials = new Set<Three.Material>();
  const textures = new Set<Three.Texture>();
  root.traverse((node) => {
    const mesh = node as Three.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if ((value as Three.Texture | null)?.isTexture) textures.add(value as Three.Texture);
      }
    }
    const skinned = node as Three.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
  });
  for (const texture of textures) {
    texture.dispose();
    // GLTFLoader can own ImageBitmaps outside WebGL's texture allocation.
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export default function RendererGLB(props: Props) {
  const { state, assetSrc, glbSrc, controls, energy, timedCues, reducedMotion, allowWebGL } = props;
  const mountRef = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const [mode, setMode] = useState("Loading approved rig");
  const [ready, setReady] = useState(false);
  const validation = timedCues ? validateTimedCues(timedCues) : { valid: true };
  const invalidCues = !validation.valid;

  // Hooks always execute, including reduced motion / invalid cue fallbacks.
  useEffect(() => {
    let disposed = false;
    let failed = false;
    let raf = 0;
    let renderer: Three.WebGLRenderer | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let model: Three.Object3D | undefined;
    setReady(false);
    setMode("Loading approved rig");
    function cleanupGPU() {
      cancelAnimationFrame(raf);
      if (model) { disposeModel(model); model = undefined; }
      if (canvas) {
        canvas.removeEventListener("webglcontextlost", contextLost);
        canvas.remove();
      }
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer = undefined;
      }
    }
    function fail(reason: string) {
      if (disposed || failed) return;
      failed = true;
      cleanupGPU();
      setReady(false);
      setMode(reason);
    }
    function contextLost(event: Event) {
      event.preventDefault();
      fail("WebGL context lost");
    }
    async function init() {
      if (!allowWebGL || reducedMotion || invalidCues || !controls?.jaw || !controls.blink || controls.jaw === controls.blink) {
        fail(!allowWebGL ? "WebGL disabled" : reducedMotion ? "Reduced motion" : invalidCues ? "Invalid mouth cues" : "Missing jaw/blink mappings");
        return;
      }
      try {
        const [THREE, { GLTFLoader }] = await Promise.all([
          import("three"), import("three/examples/jsm/loaders/GLTFLoader.js"),
        ]);
        if (disposed || failed) return;
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        canvas = renderer.domElement;
        canvas.addEventListener("webglcontextlost", contextLost);
        mountRef.current?.appendChild(canvas);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
        scene.add(new THREE.AmbientLight(0xc6e7e5, 1.5));
        const key = new THREE.DirectionalLight(0xffffff, 2);
        key.position.set(2, 3, 4);
        scene.add(key);
        const gltf = await new GLTFLoader().loadAsync(glbSrc);
        if (disposed || failed) { disposeModel(gltf.scene); return; }
        model = gltf.scene; // Own it before validating, so failures also dispose it.
        const meshes: Three.Mesh[] = [];
        model.traverse((node) => { if ((node as Three.Mesh).isMesh) meshes.push(node as Three.Mesh); });
        const mappings = mapMorphControls(meshes, controls);
        const head = controls.head ? model.getObjectByName(controls.head) : undefined;
        if (controls.head && !head) throw new Error("Configured head node missing");
        const headRest = head?.rotation.clone();
        if (!meshes.some((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          .some((material) => !!(material as Three.MeshStandardMaterial).map))) {
          throw new Error("Approved model must be textured");
        }
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(extent) || extent <= 0) throw new Error("Invalid model bounds");
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        const turn = new THREE.Group();
        turn.add(model);
        scene.add(turn);
        camera.position.z = extent * 2.1;
        camera.far = Math.max(100, extent * 10);
        let lastWidth = 0;
        let lastHeight = 0;
        let nextBlink = performance.now() + 3000 + Math.random() * 4000;
        let blinkStart = -Infinity;
        setMode("Rigged · 3D (energy jaw, not visemes)");
        setReady(true);
        function animate(now: number) {
          if (disposed || failed || !renderer) return;
          try {
            const current = live.current;
            const neutral = current.state === "disconnected" || current.state === "error";
            let jaw = current.state === "speaking" ? Math.min(0.7, current.energy.level * 0.7) : 0;
            if (current.timedCues && current.state === "speaking" &&
                current.playbackClock !== undefined && Number.isFinite(current.playbackClock)) {
              jaw = cueValueAt(current.timedCues, current.playbackClock);
            }
            setMorph(mappings.jaw, jaw);
            if (now >= nextBlink) {
              blinkStart = now;
              nextBlink = now + 3000 + Math.random() * 5000;
            }
            const blinkPhase = (now - blinkStart) / 180;
            setMorph(mappings.blink, neutral || blinkPhase > 1 ? 0 : Math.sin(blinkPhase * Math.PI));
            if (head && headRest) {
              head.rotation.copy(headRest);
              if (!neutral) {
                head.rotation.y += Math.sin(now / 4300) * 0.035;
                head.rotation.x += Math.sin(now / 5700) * 0.015;
              }
            } else {
              // Without an approved head-node mapping, only turn the whole rig.
              turn.rotation.y = neutral ? 0 : Math.sin(now / 4300) * 0.025;
            }
            const width = mountRef.current?.clientWidth || 280;
            const height = mountRef.current?.clientHeight || 280;
            // Resize drawing buffer only when needed; camera always matches it.
            if (width !== lastWidth || height !== lastHeight) {
              renderer.setSize(width, height, false);
              camera.aspect = width / height;
              camera.updateProjectionMatrix();
              lastWidth = width;
              lastHeight = height;
            }
            renderer.render(scene, camera);
            raf = requestAnimationFrame(animate);
          } catch { fail("Rig rendering unavailable"); }
        }
        raf = requestAnimationFrame(animate);
      } catch {
        fail("Model, controls or WebGL unavailable");
      }
    }
    void init();
    return () => { disposed = true; cleanupGPU(); };
  }, [glbSrc, controls?.jaw, controls?.blink, controls?.head, reducedMotion, invalidCues, allowWebGL]);

  return (
    <div className={styles.rigWrapper}>
      <div className={styles.rigCanvas} ref={mountRef} style={{ visibility: ready ? "visible" : "hidden" }} aria-hidden="true" />
      {ready ? (
        <div className={styles.container}>
          <div className={styles.panel} aria-label="Approved rigged SOULBOUND portrait">
            <span className={styles.modeBadge}>{mode}</span>
          </div>
          <span className={styles.label} role="status">{state === "idle" ? "Ready" : state}</span>
        </div>
      ) : (
        <Renderer2D state={state} assetSrc={assetSrc} energy={energy} reducedMotion={reducedMotion}
          note={`${mode} · approved image fallback.`} />
      )}
    </div>
  );
}

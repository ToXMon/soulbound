import type { GLBControls } from "./types";

interface MorphNode {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
}
export interface MorphTarget { node: MorphNode; index: number }

/** Only supplied morph names are accepted. A partial rig is not a valid rig. */
export function mapMorphControls(nodes: MorphNode[], controls?: GLBControls) {
  if (!controls?.jaw || !controls.blink || controls.jaw === controls.blink) {
    throw new Error("Distinct jaw and blink mappings are required");
  }
  function find(name: string): MorphTarget[] {
    const targets: MorphTarget[] = [];
    for (const node of nodes) {
      const dictionary = node.morphTargetDictionary;
      if (!dictionary || !Object.hasOwn(dictionary, name)) continue;
      const index = dictionary[name];
      if (Number.isInteger(index) && index >= 0 && node.morphTargetInfluences &&
          index < node.morphTargetInfluences.length) targets.push({ node, index });
    }
    if (!targets.length) throw new Error(`Model missing valid morph mapping: ${name}`);
    return targets;
  }
  return { jaw: find(controls.jaw), blink: find(controls.blink) };
}

export function setMorph(targets: MorphTarget[], value: number) {
  const bounded = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  for (const { node, index } of targets) node.morphTargetInfluences![index] = bounded;
}

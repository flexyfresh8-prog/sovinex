/**
 * Driver Studio — grayscale PBR material library.
 *
 * The studio is strictly black & white: every material is achromatic.
 * Realism comes from roughness / metalness / clearcoat / surface normal
 * detail, so rubber still reads as rubber, ferrite as ferrite, cast
 * aluminum as cast aluminum — just without hue.
 *
 * Materials are cached in a registry keyed by preset + color + finish so
 * geometry rebuilds share instances (cheap swaps, correct disposal).
 */
import * as THREE from 'three';
import { getTextures } from '../textures';
import { monochrome, FinishKey } from './config';

export type MaterialPresetKey =
  | ConePreset | SoftPreset | 'copper' | 'aluminum' | 'copperCladAluminum'
  | 'ferrite' | 'neodymium' | 'stampedSteel' | 'castAluminum' | 'steel'
  | 'chrome' | 'gasket' | 'screw';
type ConePreset = 'pressedPaper' | 'polypropylene' | 'composite' | 'carbonFiber';
type SoftPreset = 'rubber' | 'foam' | 'fabric';

interface PresetSpec {
  color: number;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: number;
  normal?: 'paper' | 'rubber' | 'brushed' | 'weave' | 'micro';
  normalScale?: number;
  envMapIntensity?: number;
  side?: THREE.Side;
}

const PRESETS: Record<MaterialPresetKey, PresetSpec> = {
  pressedPaper:   { color: 0x9a9a9a, roughness: 0.82, metalness: 0.0,  normal: 'paper', normalScale: 0.5, envMapIntensity: 0.6 },
  polypropylene:  { color: 0x6a6a6a, roughness: 0.48, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.4, normal: 'micro', normalScale: 0.12, envMapIntensity: 0.9 },
  composite:      { color: 0x3a3a3a, roughness: 0.62, metalness: 0.08, normal: 'weave', normalScale: 0.42, envMapIntensity: 0.8 },
  carbonFiber:    { color: 0x181818, roughness: 0.38, metalness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.18, normal: 'weave', normalScale: 0.75, envMapIntensity: 1.1 },
  aluminum:       { color: 0xb4b4b4, roughness: 0.28, metalness: 0.95, normal: 'brushed', normalScale: 0.35, envMapIntensity: 1.15 },
  rubber:         { color: 0x111111, roughness: 0.88, metalness: 0.0,  normal: 'rubber', normalScale: 0.3, sheen: 0.35, sheenColor: 0x2c2c2c, envMapIntensity: 0.55 },
  foam:           { color: 0x4a4a4a, roughness: 0.97, metalness: 0.0,  normal: 'rubber', normalScale: 0.85, envMapIntensity: 0.35 },
  fabric:         { color: 0x8c8c8c, roughness: 0.92, metalness: 0.0,  normal: 'paper', normalScale: 0.6, sheen: 0.55, sheenColor: 0x3c3c3c, envMapIntensity: 0.4 },
  copper:         { color: 0x8f8f8f, roughness: 0.34, metalness: 0.98, normal: 'brushed', normalScale: 0.5, envMapIntensity: 1.05 },
  copperCladAluminum: { color: 0xa6a6a6, roughness: 0.4, metalness: 0.96, normal: 'brushed', normalScale: 0.42, envMapIntensity: 1.0 },
  ferrite:        { color: 0x2c2c2c, roughness: 0.74, metalness: 0.12, normal: 'micro', normalScale: 0.3, envMapIntensity: 0.5 },
  neodymium:      { color: 0x9e9e9e, roughness: 0.42, metalness: 0.85, normal: 'brushed', normalScale: 0.25, envMapIntensity: 0.95 },
  stampedSteel:   { color: 0x565656, roughness: 0.46, metalness: 0.88, normal: 'brushed', normalScale: 0.3, envMapIntensity: 0.9 },
  castAluminum:   { color: 0x707070, roughness: 0.55, metalness: 0.82, normal: 'micro', normalScale: 0.55, envMapIntensity: 0.85 },
  steel:          { color: 0x494949, roughness: 0.4,  metalness: 0.92, normal: 'brushed', normalScale: 0.32, envMapIntensity: 0.95 },
  chrome:         { color: 0xdadada, roughness: 0.09, metalness: 1.0,  envMapIntensity: 1.4 },
  gasket:         { color: 0x0e0e0e, roughness: 0.9,  metalness: 0.0,  normal: 'rubber', normalScale: 0.22, envMapIntensity: 0.45 },
  screw:          { color: 0x333333, roughness: 0.36, metalness: 0.95, normal: 'brushed', normalScale: 0.4, envMapIntensity: 1.0 },
};

const FINISH_ADJ: Record<FinishKey, { rough: number; cc: number }> = {
  matte: { rough: +0.14, cc: -0.15 },
  satin: { rough: 0, cc: 0 },
  gloss: { rough: -0.14, cc: +0.25 },
};

const registry = new Map<string, THREE.MeshPhysicalMaterial>();

export function studioMaterial(
  preset: MaterialPresetKey,
  colorOverride?: string,
  finish: FinishKey = 'satin',
): THREE.MeshPhysicalMaterial {
  const color = monochrome(colorOverride ?? '');
  const key = `${preset}|${color}|${finish}`;
  const hit = registry.get(key);
  if (hit) return hit;

  const spec = PRESETS[preset];
  const fin = FINISH_ADJ[finish] ?? FINISH_ADJ.satin;
  // headless/node environments have no DOM — skip procedural canvas textures
  const tex = typeof document !== 'undefined'
    ? getTextures()
    : ({ paper: undefined, rubber: undefined, brushed: undefined, weave: undefined, micro: undefined } as ReturnType<typeof getTextures>);
  const normalMap = spec.normal
    ? ({ paper: tex.paper, rubber: tex.rubber, brushed: tex.brushed, weave: tex.weave, micro: tex.micro }[spec.normal] ?? null)
    : null;

  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(colorOverride ? color : spec.color),
    roughness: THREE.MathUtils.clamp(spec.roughness + fin.rough, 0.04, 1),
    metalness: spec.metalness,
    clearcoat: Math.max(0, (spec.clearcoat ?? 0) + fin.cc),
    clearcoatRoughness: spec.clearcoatRoughness ?? 0.3,
    sheen: spec.sheen ?? 0,
    sheenColor: spec.sheen ? new THREE.Color(spec.sheenColor!) : undefined,
    normalMap: normalMap ?? undefined,
    normalScale: normalMap ? new THREE.Vector2(spec.normalScale ?? 0.4, spec.normalScale ?? 0.4) : undefined,
    envMapIntensity: spec.envMapIntensity ?? 0.9,
    side: spec.side ?? THREE.FrontSide,
  });
  // clearcoat only costs when present; keep param explicit for shader cache
  if (!(spec.clearcoat ?? 0) && fin.cc <= 0) mat.clearcoat = 0;
  mat.userData.preset = preset;
  registry.set(key, mat);
  return mat;
}

/** Plain shading material for interior/vent surfaces (pure black cavity). */
export function cavityMaterial(): THREE.MeshStandardMaterial {
  const key = '__cavity__';
  const hit = registry.get(key) as unknown as THREE.MeshStandardMaterial | undefined;
  if (hit) return hit;
  const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
  registry.set(key, mat as unknown as THREE.MeshPhysicalMaterial);
  return mat;
}

/** Apply the cutaway clipping plane to every registered studio material. */
export function setClipping(plane: THREE.Plane | null): void {
  registry.forEach((m) => {
    m.clippingPlanes = plane ? [plane] : null;
    m.clipShadows = true;
    m.needsUpdate = true;
  });
}

export function disposeMaterials(): void {
  registry.forEach((m) => m.dispose());
  registry.clear();
}

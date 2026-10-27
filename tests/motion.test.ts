/**
 * MotionSystem attachment-contract tests.
 *
 * The user-visible bug: the surround (flex deformable) did not follow the
 * cone — first it never flexed at all, then the falloff plane was computed
 * around the wrong axis and the excursion sign was inverted. These tests pin
 * the contract:
 *   1. deformables are NEVER rigid members (object transform untouched)
 *   2. the flex shader excursion equals +smoothed (inner edge follows the cone)
 *   3. the falloff plane is perpendicular to the configured drive axis
 *      (inner radial edge = 1, outer radial edge = 0)
 *   4. axis changes recompute the falloff
 *   5. rigid members translate exactly with the returned displacement
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MotionSystem } from '../src/renderer/three/MotionSystem';
import { MotionGroupConfig } from '../src/shared/types';

function group(over: Partial<MotionGroupConfig> = {}): MotionGroupConfig {
  return {
    id: 'g1', name: 'Cone Assembly', partIds: ['cone'], enabled: true,
    axis: 'x', pivot: [0, 0, 0], maxDisplacementMM: 0, gain: 1,
    smoothingMs: 8, mode: 'A', bandLowHz: 20, bandHighHz: 120, invert: false,
    ...over,
  };
}

/** Ring around the X axis: radial extent 0.85–1.15 in the Y/Z plane. */
function ringAroundX(): THREE.Mesh {
  const geo = new THREE.TorusGeometry(1, 0.15, 12, 48);
  geo.rotateY(Math.PI / 2); // default torus wraps Z → now wraps X
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
}

/** Short open cylinder along X (the cone stand-in). */
function coneAlongX(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.85, 0.3, 0.4, 32, 1, true);
  geo.rotateZ(Math.PI / 2); // default axis Y → now X
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
}

interface ShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

/** Compile the injected onBeforeCompile by hand (no WebGL in node). */
function compile(mat: THREE.Material): ShaderLike {
  const shader: ShaderLike = {
    uniforms: {},
    vertexShader: 'attribute float aFalloff;\nvoid main() {\n#include <begin_vertex>\n gl_Position = vec4(transformed, 1.0);\n}',
  };
  (mat as unknown as { onBeforeCompile: (s: ShaderLike) => void }).onBeforeCompile(shader);
  return shader;
}

function setup(axis: 'x' | 'y' | 'z' = 'x') {
  const scene = new THREE.Scene();
  const cone = coneAlongX();
  const ring = ringAroundX();
  scene.add(cone, ring);
  const parts = new Map<string, THREE.Object3D>([['cone', cone], ['ring', ring]]);
  const motion = new MotionSystem(scene);
  motion.rebuild([group({ axis })], parts, ['ring'], 0.01);
  return { scene, cone, ring, motion };
}

describe('MotionSystem attachment contract', () => {
  it('keeps deformables out of the rigid members', () => {
    const { ring, motion } = setup();
    motion.apply('g1', 0.006, 0.1);
    // ring object transform must be untouched (flex-only)
    expect(ring.position.x).toBe(0);
    expect(ring.position.y).toBe(0);
    expect(ring.position.z).toBe(0);
    expect(motion.isPartAnimated('ring')).toBe(true);
  });

  it('drives the flex shader with +smoothed (same sign as the cone)', () => {
    const { ring, motion } = setup();
    const smoothed = motion.apply('g1', 0.006, 0.1);
    expect(smoothed).toBeGreaterThan(0);
    const mat = ring.material as THREE.Material & { userData: Record<string, unknown> };
    // simulate the render-time compile (no WebGL in node)
    const shader = compile(mat as THREE.Material);
    expect(shader.uniforms.uExcursion).toBeDefined();
    expect(shader.uniforms.uAxis).toBeDefined();
    expect(mat.userData.shaderRef).toBe(shader);
    // after compile, the next apply writes the live uniform
    const next = motion.apply('g1', 0.006, 0.1);
    expect(shader.uniforms.uExcursion.value).toBeCloseTo(next, 12);
    expect((shader.uniforms.uExcursion.value as number)).toBeGreaterThan(0);
    expect(ring.position.x).toBe(0); // still never translated
  });

  it('computes the falloff in the Y/Z plane for an X-axis driver', () => {
    const { ring } = setup('x');
    const geo = ring.geometry;
    const falloff = geo.getAttribute('aFalloff');
    expect(falloff).toBeDefined();
    const pos = geo.getAttribute('position');
    // find extreme radial vertices in the Y/Z plane
    let iMin = 0, iMax = 0, rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getY(i), pos.getZ(i));
      if (r < rMin) { rMin = r; iMin = i; }
      if (r > rMax) { rMax = r; iMax = i; }
    }
    expect(falloff.getX(iMin)).toBeCloseTo(1, 5); // inner edge (cone side) → 1
    expect(falloff.getX(iMax)).toBeCloseTo(0, 5); // outer edge (frame side) → 0
  });

  it('computes the falloff in the X/Y plane for a Z-axis driver', () => {
    const { ring } = setup('z');
    const geo = ring.geometry;
    const falloff = geo.getAttribute('aFalloff')!;
    const pos = geo.getAttribute('position');
    let iMin = 0, iMax = 0, rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      if (r < rMin) { rMin = r; iMin = i; }
      if (r > rMax) { rMax = r; iMax = i; }
    }
    expect(falloff.getX(iMin)).toBeCloseTo(1, 5);
    expect(falloff.getX(iMax)).toBeCloseTo(0, 5);
  });

  it('recomputes the falloff when the axis changes', () => {
    const { ring, motion } = setup('x');
    const geo = ring.geometry;
    const before = Array.from((geo.getAttribute('aFalloff') as THREE.BufferAttribute).array as Float32Array);
    motion.setAxis('g1', 'z');
    const after = (geo.getAttribute('aFalloff') as THREE.BufferAttribute).array as Float32Array;
    // torus wrapped around X scanned in X/Y plane ≠ scanned in Y/Z plane
    let differs = false;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs(before[i] - after[i]) > 1e-6) { differs = true; break; }
    }
    expect(differs).toBe(true);
  });

  it('maps the world drive axis into the part local space (rotated part)', () => {
    const scene = new THREE.Scene();
    const cone = coneAlongX();
    const ring = ringAroundX();
    // rotate the ring 90° about Y: its local X now points along world -Z.
    // A torus wrapped around X rotated -90° about Y wraps around Z… so feed
    // the world axis that keeps it radial: world Z.
    ring.rotation.y = Math.PI / 2;
    ring.updateMatrixWorld(true);
    scene.add(cone, ring);
    const parts = new Map<string, THREE.Object3D>([['cone', cone], ['ring', ring]]);
    const motion = new MotionSystem(scene);
    motion.rebuild([group({ axis: 'x' })], parts, ['ring'], 0.01);
    const mat = ring.material as THREE.Material & { userData: { flexAxis?: THREE.Vector3 } };
    // local axis must be world X mapped through the inverse rotation → ±Z
    expect(mat.userData.flexAxis).toBeDefined();
    expect(Math.abs(mat.userData.flexAxis!.x)).toBeCloseTo(0, 5);
    expect(Math.abs(mat.userData.flexAxis!.z)).toBeCloseTo(1, 5);
  });

  it('translates rigid members exactly with the returned displacement', () => {
    const { cone, motion } = setup();
    const smoothed = motion.apply('g1', 0.008, 0.1);
    expect(cone.position.x).toBeCloseTo(smoothed, 12);
    expect(cone.position.y).toBe(0);
    motion.resetAll();
    expect(cone.position.x).toBe(0);
  });

  it('soft-limits displacement to the group limit', () => {
    const { cone, motion } = setup();
    // xmaxM = 0.01 → limit 0.01; drive far past it
    motion.apply('g1', 1.0, 0.5);
    expect(Math.abs(cone.position.x)).toBeLessThanOrEqual(0.01 + 1e-9);
  });
});

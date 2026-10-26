/**
 * Motion system: applies audio-derived displacement to enabled motion groups.
 * - each group gets a hidden pivot Object3D as logical parent transform
 * - rest poses are captured once; "reset" restores them exactly
 * - soft limiter: |x| clamped to Xmax with tanh saturation
 * - deformable parts get a radial falloff vertex bend driven by the same signal
 * - static parts are NEVER touched
 */
import * as THREE from 'three';
import { MotionGroupConfig } from '../../shared/types';

interface GroupRuntime {
  config: MotionGroupConfig;
  pivot: THREE.Object3D;
  members: THREE.Object3D[];
  deformMembers: THREE.Object3D[];
  restPositions: Map<THREE.Object3D, THREE.Vector3>;
  smoothed: number;      // smoothed displacement, meters
  softLimitM: number;
}

export class MotionSystem {
  private groups = new Map<string, GroupRuntime>();
  private scene: THREE.Scene;
  private partObjects = new Map<string, THREE.Object3D>();
  private deformParts = new Set<string>();
  private shaderRefs: { mat: THREE.Material; basePosAttr: string }[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  rebuild(groups: MotionGroupConfig[], partObjects: Map<string, THREE.Object3D>, deformPartIds: string[], xmaxM: number): void {
    // tear down old pivots
    this.groups.forEach((g) => this.scene.remove(g.pivot));
    this.groups.clear();
    this.partObjects = partObjects;
    this.deformParts = new Set(deformPartIds);
    this.shaderRefs = [];

    for (const config of groups) {
      const pivot = new THREE.Object3D();
      pivot.name = `motion_pivot_${config.id}`;
      pivot.position.set(config.pivot[0], config.pivot[1], config.pivot[2]);
      this.scene.add(pivot);

      const members: THREE.Object3D[] = [];
      const deformMembers: THREE.Object3D[] = [];
      const restPositions = new Map<THREE.Object3D, THREE.Vector3>();
      for (const pid of config.partIds) {
        const obj = partObjects.get(pid);
        if (!obj) continue;
        members.push(obj);
        restPositions.set(obj, obj.position.clone());
        if (this.deformParts.has(pid)) {
          deformMembers.push(obj);
          this.injectDeformShader(obj);
        }
      }
      this.groups.set(config.id, {
        config, pivot, members, deformMembers, restPositions,
        smoothed: 0,
        softLimitM: (config.maxDisplacementMM > 0 ? config.maxDisplacementMM / 1000 : xmaxM),
      });
    }
  }

  /** Inject radial-bend deformation into mesh materials (surround roll / spider). */
  private injectDeformShader(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material & { onBeforeCompile?: unknown };
      if (!mat || !('onBeforeCompile' in mat)) return;
      const geo = mesh.geometry;
      if (!geo.getAttribute('aFalloff')) {
        // precompute radial falloff attribute: 1 at inner edge → 0 at outer edge
        const pos = geo.getAttribute('position');
        const count = pos.count;
        const arr = new Float32Array(count);
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
        let rMin = 1e9, rMax = -1;
        for (let i = 0; i < count; i++) {
          const r = Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy);
          if (r < rMin) rMin = r; if (r > rMax) rMax = r;
        }
        const span = Math.max(rMax - rMin, 1e-6);
        for (let i = 0; i < count; i++) {
          const r = Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy);
          const t = 1 - (r - rMin) / span; // 1 inner → 0 outer
          arr[i] = t * t;
        }
        geo.setAttribute('aFalloff', new THREE.BufferAttribute(arr, 1));
      }
      mat.onBeforeCompile = (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string }) => {
        shader.uniforms.uExcursion = { value: 0 };
        shader.uniforms.uAxis = { value: new THREE.Vector3(1, 0, 0) };
        shader.vertexShader = 'attribute float aFalloff;\nuniform float uExcursion;\nuniform vec3 uAxis;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\n transformed += uAxis * (aFalloff * uExcursion);',
          );
        (mat as unknown as { userData: { shaderRef?: { uniforms: Record<string, { value: unknown }> } } }).userData.shaderRef = shader;
        this.shaderRefs.push({ mat, basePosAttr: 'aFalloff' });
      };
      mat.needsUpdate = true;
    });
  }

  /** Set axis direction for every group (called when config axis changes). */
  setAxis(groupId: string, axis: 'x' | 'y' | 'z'): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    g.config.axis = axis;
    const vec = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    g.deformMembers.forEach((obj) => {
      obj.traverse((child) => {
        const mat = (child as THREE.Mesh).material as THREE.Material & { userData: { shaderRef?: { uniforms: Record<string, { value: unknown }> } } };
        if (mat?.userData?.shaderRef) {
          (mat.userData.shaderRef.uniforms.uAxis.value as THREE.Vector3).copy(vec);
        }
      });
    });
  }

  /**
   * Advance to target displacement (meters, signed, along +axis).
   * Applies smoothing + soft limiter, then positions member objects.
   * Returns the applied displacement.
   */
  apply(groupId: string, targetM: number, dtSec: number): number {
    const g = this.groups.get(groupId);
    if (!g || !g.config.enabled || g.members.length === 0) return 0;

    const limit = g.softLimitM;
    let x = targetM * g.config.gain;
    if (g.config.invert) x = -x;
    // soft limiter
    x = limit * Math.tanh(x / Math.max(limit, 1e-6));

    const k = 1 - Math.exp(-dtSec * 1000 / Math.max(g.config.smoothingMs, 8));
    g.smoothed += (x - g.smoothed) * Math.min(k, 1);
    if (Math.abs(g.smoothed) < 1e-7) g.smoothed = 0;

    const axisVec = new THREE.Vector3(
      g.config.axis === 'x' ? 1 : 0,
      g.config.axis === 'y' ? 1 : 0,
      g.config.axis === 'z' ? 1 : 0,
    );
    const disp = axisVec.multiplyScalar(g.smoothed);

    for (const obj of g.members) {
      const rest = g.restPositions.get(obj)!;
      obj.position.copy(rest).add(disp);
    }

    // deformables: shader excursion relative to their own attachment (opposite sign for surround)
    for (const obj of g.deformMembers) {
      obj.traverse((child) => {
        const mat = (child as THREE.Mesh).material as THREE.Material & { userData: { shaderRef?: { uniforms: Record<string, { value: unknown }> } } };
        if (mat?.userData?.shaderRef) {
          mat.userData.shaderRef.uniforms.uExcursion.value = -g.smoothed;
        }
      });
    }
    return g.smoothed;
  }

  /** Hard reset to rest pose + zero smoothing state. */
  resetAll(): void {
    this.groups.forEach((g) => {
      g.smoothed = 0;
      g.restPositions.forEach((rest, obj) => obj.position.copy(rest));
      g.deformMembers.forEach((obj) => {
        obj.traverse((child) => {
          const mat = (child as THREE.Mesh).material as THREE.Material & { userData: { shaderRef?: { uniforms: Record<string, { value: unknown }> } } };
          if (mat?.userData?.shaderRef) mat.userData.shaderRef.uniforms.uExcursion.value = 0;
        });
      });
    });
  }

  /** True when a part belongs to an enabled group. */
  isPartAnimated(partId: string): boolean {
    for (const g of this.groups.values()) {
      if (g.config.enabled && g.config.partIds.includes(partId)) return true;
    }
    return false;
  }

  dispose(): void {
    this.groups.forEach((g) => this.scene.remove(g.pivot));
    this.groups.clear();
    this.shaderRefs = [];
  }
}

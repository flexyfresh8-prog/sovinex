/**
 * Motion system: applies audio-derived displacement to enabled motion groups.
 *
 * Attachment contract (the cone must stay visually glued to the frame):
 * - rigid members (cone, dust cap, voice coil) translate along the drive axis
 * - deformable parts (surround roll, spider) are FLEX-ONLY: their object
 *   transform is NEVER touched. A vertex shader bends them along the drive
 *   axis with a radial falloff — 1 at the inner edge (glued to the moving
 *   cone, follows it exactly) fading to 0 at the outer edge (bolted to the
 *   static frame, never moves). The excursion sign is the SAME as the group
 *   displacement so the cone-side edge tracks the cone 1:1.
 * - static parts are never touched
 * - soft limiter: |x| clamped to Xmax with tanh saturation
 * - rest poses are captured once; "reset" restores them exactly
 *
 * Falloff geometry is axis-aware: the radial plane is perpendicular to the
 * configured drive axis (an X-axis surround is scanned in the Y/Z plane).
 * The world→local axis mapping accounts for the part's world transform
 * (rotation + scale), so parts behind rotated/scaled nodes still bend
 * parallel to the drive axis.
 */
import * as THREE from 'three';
import { MotionGroupConfig } from '../../shared/types';

interface FlexBinding {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  axisAtBuild: 'x' | 'y' | 'z';
}

interface GroupRuntime {
  config: MotionGroupConfig;
  pivot: THREE.Object3D;
  members: THREE.Object3D[];            // rigid movers (deformables excluded)
  flex: FlexBinding[];                  // deformables driven by this group
  restPositions: Map<THREE.Object3D, THREE.Vector3>;
  smoothed: number;                     // smoothed displacement, meters
  softLimitM: number;
}

function axisVec(axis: 'x' | 'y' | 'z'): THREE.Vector3 {
  return new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
}

/** The two coordinate axes perpendicular to the given axis. */
function radialDims(axis: 'x' | 'y' | 'z'): [0 | 1 | 2, 0 | 1 | 2] {
  if (axis === 'x') return [1, 2];
  if (axis === 'y') return [0, 2];
  return [0, 1];
}

/** Flatten a material (or material array) into unique materials. */
function matsOf(mesh: THREE.Mesh): THREE.Material[] {
  const m = mesh.material as THREE.Material | THREE.Material[];
  return Array.isArray(m) ? [...new Set(m)] : m ? [m] : [];
}

export class MotionSystem {
  private groups = new Map<string, GroupRuntime>();
  private scene: THREE.Scene;
  private partObjects = new Map<string, THREE.Object3D>();
  private deformPartIds = new Set<string>();
  private flexPartIds = new Set<string>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  rebuild(groups: MotionGroupConfig[], partObjects: Map<string, THREE.Object3D>, deformPartIds: string[], xmaxM: number): void {
    // tear down old pivots
    this.groups.forEach((g) => this.scene.remove(g.pivot));
    this.groups.clear();
    this.partObjects = partObjects;
    this.deformPartIds = new Set(deformPartIds);
    this.flexPartIds = new Set();

    // ---- rigid groups first (deformables are never rigid members) ----
    for (const config of groups) {
      const pivot = new THREE.Object3D();
      pivot.name = `motion_pivot_${config.id}`;
      pivot.position.set(config.pivot[0], config.pivot[1], config.pivot[2]);
      this.scene.add(pivot);

      const members: THREE.Object3D[] = [];
      const restPositions = new Map<THREE.Object3D, THREE.Vector3>();
      for (const pid of config.partIds) {
        if (this.deformPartIds.has(pid)) continue; // flex-only, never translated
        const obj = partObjects.get(pid);
        if (!obj) continue;
        members.push(obj);
        restPositions.set(obj, obj.position.clone());
      }
      this.groups.set(config.id, {
        config, pivot, members, flex: [], restPositions,
        smoothed: 0,
        softLimitM: (config.maxDisplacementMM > 0 ? config.maxDisplacementMM / 1000 : xmaxM),
      });
    }

    // ---- attach deformables: nearest group by axial center, then flex shader ----
    for (const pid of deformPartIds) {
      const obj = partObjects.get(pid);
      if (!obj) continue;
      const g = this.pickGroupForDeformable(obj);
      if (!g) continue;
      this.injectFlexShader(obj, g.config.axis);
      g.flex.push({ obj, mats: this.collectMats(obj), axisAtBuild: g.config.axis });
      this.flexPartIds.add(pid);
    }
  }

  /** Group whose rigid members sit closest (axially) to the deformable. */
  private pickGroupForDeformable(obj: THREE.Object3D): GroupRuntime | null {
    const candidates = [...this.groups.values()].filter((g) => g.members.length > 0);
    if (candidates.length === 0) return null;
    obj.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(obj);
    const c = new THREE.Vector3(); box.getCenter(c);
    let best: GroupRuntime | null = null;
    let bestD = Infinity;
    for (const g of candidates) {
      const ai = { x: 0, y: 1, z: 2 }[g.config.axis] as 0 | 1 | 2;
      const tmp = new THREE.Vector3();
      let sum = 0;
      for (const m of g.members) {
        m.updateWorldMatrix(true, false);
        new THREE.Box3().setFromObject(m).getCenter(tmp);
        sum += tmp.getComponent(ai);
      }
      const d = Math.abs(sum / g.members.length - c.getComponent(ai));
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  private collectMats(obj: THREE.Object3D): THREE.Material[] {
    const out = new Set<THREE.Material>();
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) matsOf(child as THREE.Mesh).forEach((m) => out.add(m));
    });
    return [...out];
  }

  /**
   * Compute the radial falloff attribute for a geometry around a drive axis.
   * 1 at the inner radial edge (cone side) → 0 at the outer edge (frame side).
   * Re-runnable: overwrites any existing attribute (used on axis change).
   */
  private applyFalloff(geo: THREE.BufferGeometry, axis: 'x' | 'y' | 'z'): void {
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const count = pos.count;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const [da, db] = radialDims(axis);
    const ca = ((bb.min.getComponent(da) + bb.max.getComponent(da)) / 2);
    const cb = ((bb.min.getComponent(db) + bb.max.getComponent(db)) / 2);
    let rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const r = Math.hypot(pos.getComponent(i, da) - ca, pos.getComponent(i, db) - cb);
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }
    const span = Math.max(rMax - rMin, 1e-6);
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = Math.hypot(pos.getComponent(i, da) - ca, pos.getComponent(i, db) - cb);
      const t = 1 - (r - rMin) / span; // 1 inner (cone side) → 0 outer (frame side)
      arr[i] = t * t;
    }
    geo.setAttribute('aFalloff', new THREE.BufferAttribute(arr, 1));
  }

  /**
   * Local-space direction of a world drive axis for a given object,
   * exact for any affine world transform (rotation + scale).
   */
  private localAxisFor(obj: THREE.Object3D, axis: 'x' | 'y' | 'z'): THREE.Vector3 {
    obj.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const lin = new THREE.Matrix3().setFromMatrix4(inv);
    return axisVec(axis).applyMatrix3(lin);
  }

  /** Inject (or refresh) the flex-bend shader into every material of the part. */
  private injectFlexShader(obj: THREE.Object3D, axis: 'x' | 'y' | 'z'): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      this.applyFalloff(mesh.geometry, axis);
      const localAxis = this.localAxisFor(mesh, axis);
      for (const mat of matsOf(mesh)) {
        const m = mat as THREE.Material & {
          onBeforeCompile?: unknown;
          userData: { flexAxis?: THREE.Vector3; shaderRef?: { uniforms: Record<string, { value: unknown }> } };
        };
        if (!('onBeforeCompile' in m)) continue;
        // live vector shared with the compiled shader — axis changes propagate
        // without recompiling, regardless of compile order
        if (!m.userData.flexAxis) m.userData.flexAxis = localAxis.clone();
        else m.userData.flexAxis.copy(localAxis);
        m.onBeforeCompile = (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string }) => {
          shader.uniforms.uExcursion = { value: 0 };
          shader.uniforms.uAxis = { value: m.userData.flexAxis! };
          shader.vertexShader = 'attribute float aFalloff;\nuniform float uExcursion;\nuniform vec3 uAxis;\n' +
            shader.vertexShader.replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\n transformed += uAxis * (aFalloff * uExcursion);',
            );
          m.userData.shaderRef = shader;
        };
        m.needsUpdate = true;
      }
    });
  }

  /** Set axis direction for a group; recomputes flex falloff when it changes. */
  setAxis(groupId: string, axis: 'x' | 'y' | 'z'): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    const changed = g.config.axis !== axis;
    g.config.axis = axis;
    if (!changed) return;
    for (const f of g.flex) {
      this.injectFlexShader(f.obj, axis); // refresh falloff + local axis mapping
      f.axisAtBuild = axis;
    }
  }

  /**
   * Advance to target displacement (meters, signed, along +axis).
   * Applies smoothing + soft limiter, then positions rigid members and drives
   * flex members' shaders. Returns the applied displacement.
   */
  apply(groupId: string, targetM: number, dtSec: number): number {
    const g = this.groups.get(groupId);
    if (!g || !g.config.enabled || (g.members.length === 0 && g.flex.length === 0)) return 0;

    const limit = g.softLimitM;
    let x = targetM * g.config.gain;
    if (g.config.invert) x = -x;
    // soft limiter
    x = limit * Math.tanh(x / Math.max(limit, 1e-6));

    const k = 1 - Math.exp(-dtSec * 1000 / Math.max(g.config.smoothingMs, 8));
    g.smoothed += (x - g.smoothed) * Math.min(k, 1);
    if (Math.abs(g.smoothed) < 1e-7) g.smoothed = 0;

    const disp = axisVec(g.config.axis).multiplyScalar(g.smoothed);

    // rigid members translate with the group
    for (const obj of g.members) {
      const rest = g.restPositions.get(obj)!;
      obj.position.copy(rest).add(disp);
    }

    // flex members: inner edge (falloff=1, cone side) follows the cone exactly;
    // outer edge (falloff=0, frame side) never moves. Same sign as the group.
    for (const f of g.flex) {
      for (const mat of f.mats) {
        const ref = (mat as THREE.Material & { userData: { shaderRef?: { uniforms: Record<string, { value: unknown }> } } }).userData.shaderRef;
        if (ref) ref.uniforms.uExcursion.value = g.smoothed;
      }
    }
    return g.smoothed;
  }

  /** Hard reset to rest pose + zero smoothing state. */
  resetAll(): void {
    this.groups.forEach((g) => {
      g.smoothed = 0;
      g.restPositions.forEach((rest, obj) => obj.position.copy(rest));
      for (const f of g.flex) {
        for (const mat of f.mats) {
          const ref = (mat as THREE.Material & { userData: { shaderRef?: { uniforms: Record<string, { value: unknown }> } } }).userData.shaderRef;
          if (ref) ref.uniforms.uExcursion.value = 0;
        }
      }
    });
  }

  /** True when a part belongs to an enabled group (rigid or flex). */
  isPartAnimated(partId: string): boolean {
    for (const g of this.groups.values()) {
      if (g.config.enabled && g.config.partIds.includes(partId)) return true;
    }
    return this.flexPartIds.has(partId);
  }

  dispose(): void {
    this.groups.forEach((g) => this.scene.remove(g.pivot));
    this.groups.clear();
    this.flexPartIds.clear();
  }
}

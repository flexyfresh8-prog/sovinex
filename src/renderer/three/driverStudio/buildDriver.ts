/**
 * Driver Studio — assembly engine.
 *
 * Builds the complete driver from independent components and updates it
 * dependency-aware: after a config change the datums are recomputed, the
 * consumers of every changed datum group are rebuilt, and their groups are
 * swapped in place (same child index) — the rest of the scene is untouched.
 *
 * The exploded view offsets real component groups along the driver axis
 * (front parts forward, motor rearward), scaled to the driver size, with
 * animation handled by the caller (controller/viewport easing).
 */
import * as THREE from 'three';
import { DriverStudioConfig, ComponentId, COMP_IDS, COMPONENT_LABELS, clampConfig } from './config';
import { computeDatums, Datums, componentsAffectedBy } from './datums';
import { PART_BUILDERS, PartBuild } from './parts';

export interface StudioComponent {
  id: ComponentId;
  name: string;
  role: 'moving' | 'flex' | 'static';
  object: THREE.Group;
  meshes: THREE.Mesh[];
  /** position with explode = 0 (the assembled pose) */
  assembledPos: THREE.Vector3;
  explodeOffset: THREE.Vector3;
}

export interface StudioUpdateResult {
  rebuilt: ComponentId[];
  datums: Datums;
  totalDepthM: number;
  coneRadiusM: number;
}

export class DriverStudio {
  readonly root: THREE.Group;
  readonly components = new Map<ComponentId, StudioComponent>();
  config: DriverStudioConfig;
  datums: Datums;
  /** 0..1 exploded-view factor applied to every component offset */
  explodeFactor = 0;

  constructor(config: DriverStudioConfig) {
    this.config = clampConfig(config);
    this.root = new THREE.Group();
    this.root.name = 'DriverStudioAssembly';
    this.root.userData.studioManaged = true;
    this.datums = computeDatums(this.config);
    for (const id of COMP_IDS) this.buildComponent(id);
    this.applyExplode(0);
  }

  private buildComponent(id: ComponentId): void {
    const build: PartBuild = PART_BUILDERS[id](this.datums, this.config);
    const old = this.components.get(id);
    build.group.name = `component_${id}`;
    build.group.userData.partId = id;
    build.group.userData.role = build.role;
    for (const m of build.meshes) m.userData.partId = id;

    if (old) {
      // swap in place, preserving child order
      const index = this.root.children.indexOf(old.object);
      this.root.remove(old.object);
      this.disposeObject(old.object);
      if (index >= 0) this.root.add(build.group);
      else this.root.add(build.group);
      if (index >= 0 && index !== this.root.children.length - 1) {
        this.root.children.splice(index, 0, this.root.children.pop()!);
      }
    } else {
      this.root.add(build.group);
    }

    const comp: StudioComponent = {
      id,
      name: COMPONENT_LABELS[id],
      role: build.role,
      object: build.group,
      meshes: build.meshes,
      assembledPos: build.group.position.clone(),
      explodeOffset: build.explodeOffset.clone().multiplyScalar(this.explodeScale()),
    };
    this.components.set(id, comp);
  }

  /** Explode distances scale with the driver so small drivers don't fly apart. */
  private explodeScale(): number {
    return THREE.MathUtils.clamp(this.datums.flangeR / 0.159, 0.45, 1.6);
  }

  /**
   * Dependency-aware update: recomputes datums, rebuilds only components
   * whose datums changed, re-applies explode, returns what was rebuilt.
   */
  update(next: DriverStudioConfig): StudioUpdateResult {
    const prev = this.config;
    const changed = (Object.keys(next) as (keyof DriverStudioConfig)[])
      .filter((k) => !deepEq(prev[k] as unknown, next[k] as unknown));
    this.config = clampConfig(next);

    const nextDatums = computeDatums(this.config);
    const rebuilt: ComponentId[] = [];

    if (changed.length > 0) {
      // datums must be refreshed BEFORE rebuilding so affected components
      // are constructed from the new geometry
      this.datums = nextDatums;
      const affected = new Set(componentsAffectedBy(changed));
      for (const id of COMP_IDS) {
        if (!affected.has(id)) continue;
        this.buildComponent(id);
        rebuilt.push(id);
      }
      // re-scale explode offsets for rebuilt components
      const scale = this.explodeScale();
      this.components.forEach((c) => c.explodeOffset.copy(BASE_OFFSETS[c.id]).multiplyScalar(scale));
      this.applyExplode(this.explodeFactor);
    }

    return {
      rebuilt,
      datums: this.datums,
      totalDepthM: this.datums.totalDepthM,
      coneRadiusM: this.datums.coneR,
    };
  }

  /** Rebuild every component from scratch (preset change / fresh config). */
  rebuildAll(config: DriverStudioConfig): void {
    this.config = clampConfig(config);
    this.datums = computeDatums(this.config);
    const scale = this.explodeScale();
    for (const id of COMP_IDS) {
      this.buildComponent(id);
      this.components.get(id)!.explodeOffset.copy(BASE_OFFSETS[id]).multiplyScalar(scale);
    }
    this.applyExplode(this.explodeFactor);
  }

  /** Set the exploded factor and reposition components accordingly. */
  applyExplode(factor: number): void {
    this.explodeFactor = THREE.MathUtils.clamp(factor, 0, 1);
    this.components.forEach((c) => {
      c.object.position.copy(c.assembledPos).addScaledVector(c.explodeOffset, this.explodeFactor);
    });
  }

  /** Moving parts (rigid) — for the motion system's group. */
  movingPartIds(): string[] {
    return COMP_IDS.filter((id) => this.components.get(id)?.role === 'moving');
  }

  /** Flex-only deformables — surround + spider. */
  flexPartIds(): string[] {
    return COMP_IDS.filter((id) => this.components.get(id)?.role === 'flex');
  }

  /** All pickable meshes with stable per-component ids. */
  pickables(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.components.forEach((c) => out.push(...c.meshes));
    return out;
  }

  partObjects(): Map<string, THREE.Object3D> {
    const map = new Map<string, THREE.Object3D>();
    this.components.forEach((c) => map.set(c.id, c.object));
    return map;
  }

  dispose(): void {
    this.components.forEach((c) => this.disposeObject(c.object));
    this.components.clear();
    this.root.clear();
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose();
    });
  }
}

/** Canonical explode vectors (unscaled) — front parts +z, motor −z. */
const BASE_OFFSETS: Record<ComponentId, THREE.Vector3> = {
  dustcap: new THREE.Vector3(0, 0, 0.046),
  cone: new THREE.Vector3(0, 0, 0.030),
  leads: new THREE.Vector3(0, 0, 0.030),
  surround: new THREE.Vector3(0, 0, 0.017),
  gasket: new THREE.Vector3(0, 0, 0.009),
  hardware: new THREE.Vector3(0, 0, 0.023),
  basket: new THREE.Vector3(0, 0, 0),
  spider: new THREE.Vector3(0, 0, -0.015),
  voicecoil: new THREE.Vector3(0, 0, -0.027),
  topPlate: new THREE.Vector3(0, 0, -0.040),
  magnet: new THREE.Vector3(0, 0, -0.052),
  bottomPlate: new THREE.Vector3(0, 0, -0.064),
  pole: new THREE.Vector3(0, 0, -0.078),
  terminals: new THREE.Vector3(0, -0.018, -0.020),
};

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return false;
}

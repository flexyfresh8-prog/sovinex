/**
 * AppController — central orchestrator wiring UI store ↔ 3D viewport ↔
 * motion system ↔ audio engine ↔ physics engine ↔ persistence bridge.
 */
import * as THREE from 'three';
import { useStore, hudBus, ConsoleLine } from '../store';
import { Viewport, StandardView } from '../three/Viewport';
import { MotionSystem } from '../three/MotionSystem';
import { AudioEngine } from '../audio/AudioEngine';
import { DriverStudio } from '../three/driverStudio/buildDriver';
import { buildEnclosure } from '../three/driverStudio/enclosure';
import { DimensionGuides } from '../three/driverStudio/dimensions';
import { setClipping, disposeMaterials } from '../three/driverStudio/materials';
import { COMPONENT_LABELS, ComponentId } from '../../shared/driver/studioConfig';
import { parseModel, ImportedPartNode, studioMaterialFor } from './importModel';
import { autoClassify, applyKnownTripoLayout } from '../../shared/project/autoClassify';
import {
  buildDriverModel, buildBoxModel, netVolumeL,
} from '../../shared/physics/model';
import { computeCurves, computeSummary } from '../../shared/physics/curves';
import { ProjectData, PartInfo, PartMetrics, TrackAnalysis, ViewMode } from '../../shared/types';
import { sanitizeProject, defaultGroups, makeGroup } from '../../shared/project/schema';

declare global {
  interface Window { sonivex: {
    openModel: () => Promise<{ fileName: string; filePath: string; data: Uint8Array } | { error: string } | null>;
    openAudio: () => Promise<{ fileName: string; filePath: string; data: Uint8Array } | { error: string } | null>;
    openProject: () => Promise<{ filePath: string; json: string } | { error: string } | null>;
    saveProjectAs: (name: string) => Promise<string | null>;
    writeProject: (p: string, json: string) => Promise<{ ok?: boolean; error?: string }>;
    writeExport: (name: string, mime: string, b64: string) => Promise<{ ok?: boolean; filePath?: string; error?: string }>;
    printToPDF: (html: string) => Promise<{ data?: string; error?: string }>;
    autosaveWrite: (json: string) => Promise<{ ok?: boolean; error?: string }>;
    autosaveRead: () => Promise<{ json: string | null; mtime?: number }>;
    autosaveClear: () => Promise<{ ok?: boolean }>;
    appInfo: () => Promise<{ version: string; platform: string; userData: string }>;
    showItemInFolder: (p: string) => Promise<{ ok?: boolean; error?: string }>;
    readModelPath: (p: string) => Promise<{ fileName: string; filePath: string; data: Uint8Array } | { error: string } | null>;
    readAudioPath: (p: string) => Promise<{ fileName: string; filePath: string; data: Uint8Array } | { error: string } | null>;
  }
}
}

const store = useStore;
const bridge = () => window.sonivex;

export class AppController {
  viewport!: Viewport;
  motion!: MotionSystem;
  audio = new AudioEngine();
  private studio: DriverStudio | null = null;
  private enclosure: THREE.Group | null = null;
  private stand: THREE.Group | null = null;
  private dimGuides: DimensionGuides | null = null;
  private explodeCur = 0;
  private partObjects = new Map<string, THREE.Object3D>();
  private deformIds: string[] = [];
  private rafId = 0;
  private lastT = 0;
  private hudAccum = 0;
  private physicsTimer: number | undefined;
  private reanalysisTimer: number | undefined;
  private autosaveTimer: number | undefined;
  private analysisCache: TrackAnalysis | null = null;
  private maxWave = 1;
  private envP95 = 0.001;
  private disposed = false;
  assemblyCenter = new THREE.Vector3();

  async init(container: HTMLElement): Promise<void> {
    this.viewport = new Viewport(container, {
      onHover: (id) => store.getState().setHover(id),
      onSelect: (id, additive) => {
        const cur = store.getState().selection;
        const next = additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id];
        store.getState().setSelection(next);
      },
      onEmptyClick: () => store.getState().setSelection([]),
    });
    this.motion = new MotionSystem(this.viewport.scene);

    await this.loadDefaultAssembly();
    this.applyViewFromProject();
    this.startLoop();
    this.physicsTimer = window.setInterval(() => this.recomputePhysics(), 400);
    this.autosaveTimer = window.setInterval(() => void this.autosave(), 20000);
    await this.tryRestoreAutosave();

    const info = await bridge().appInfo();
    store.getState().log('ok', `Sonivex Studio ${info.version} ready — Design. Simulate. Validate.`);
    store.getState().log('info', 'Driver Studio: 14 independently modeled components, fully customizable in the STUDIO tab.');
  }

  // ================= assembly management =================

  private registerParts(root: THREE.Group, parts: { id: string; name: string; sourceName: string; meshIndex: number; object: THREE.Object3D; mesh: THREE.Mesh; metrics: PartMetrics; hadRealMaterial?: boolean }[]): void {
    // an imported model replaces the Driver Studio scene content
    if (this.studio) this.studio.root.visible = false;
    if (this.enclosure) this.enclosure.visible = false;
    if (this.stand) this.stand.visible = false;
    this.dimGuides?.clear();
    this.motion.clearPartOffsets();
    this.partObjects.clear();
    this.deformIds = [];
    const projParts: PartInfo[] = parts.map((p) => ({
      id: p.id, name: p.name, sourceName: p.sourceName, meshIndex: p.meshIndex,
      role: 'unknown', visible: true, locked: false, enabledForMotion: false,
      groupId: null, metrics: p.metrics,
    }));
    // preserve existing roles/groups where ids match
    const prev = store.getState().project.parts;
    const prevById = new Map(prev.map((p) => [p.id, p]));
    const merged = projParts.map((p) => {
      const old = prevById.get(p.id);
      return old ? { ...p, role: old.role, visible: old.visible, locked: old.locked, groupId: old.groupId, enabledForMotion: old.enabledForMotion, name: old.name || p.name } : p;
    });

    parts.forEach((p) => this.partObjects.set(p.id, p.object));
    store.getState().setParts(merged);
    this.currentRoot = root;
    this.viewport.setModel(root, this.partObjects, parts.map((p) => p.mesh));
    parts.forEach((p) => this.viewport.setPartVisible(p.id, true));
  }

  private currentRoot: THREE.Group | null = null;

  // ================= Driver Studio assembly =================

  /** Build (or rebuild from config) the modular procedural driver assembly. */
  async loadDriverStudio(): Promise<void> {
    const { studio: cfg, box, view } = store.getState().project;

    if (!this.studio) {
      this.studio = new DriverStudio(cfg);
      this.viewport.scene.add(this.studio.root);
      this.dimGuides = new DimensionGuides();
      this.viewport.scene.add(this.dimGuides.group);
      this.stand = this.buildStand();
      this.viewport.scene.add(this.stand);
    } else {
      this.studio.rebuildAll(cfg);
    }

    this.buildEnclosureFor(box.wCM, box.hCM, box.dCM, box.type === 'ported', box.portDiameterCM, box.portCount);
    this.registerStudioParts();
    this.syncStudioMotion();
    this.recomputePhysics();
    this.explodeCur = view.explode;
    this.applyViewMode(view.viewMode, false);
    this.viewport.fitToModel();
    store.getState().setModelMeta('procedural', true);
    const comps = this.studio.components.size;
    store.getState().log('ok', `Driver Studio assembly ready — ${comps} independently modeled components (moving: cone + dust cap + voice coil + leads · flex: surround + spider).`);
  }

  /** Compatibility alias used by project restore paths. */
  async loadDefaultAssembly(): Promise<void> {
    return this.loadDriverStudio();
  }

  private buildEnclosureFor(wCM: number, hCM: number, dCM: number, ported: boolean, portD: number, portN: number): void {
    if (this.enclosure) {
      this.viewport.scene.remove(this.enclosure);
      this.enclosure.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
      this.enclosure = null;
    }
    const flangeR = this.studio!.datums.flangeR;
    const build = buildEnclosure(wCM, hCM, dCM, ported, portD, portN, flangeR);
    this.enclosure = build.group;
    this.enclosure.position.y = build.groundOffsetY;
    this.viewport.scene.add(this.enclosure);
  }

  /** Minimal display stand so the driver-only view never floats unanchored. */
  private buildStand(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'DisplayStand';
    const mat = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.55, metalness: 0.35 });
    const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 12, 64).rotateX(Math.PI / 2), mat);
    cradle.name = 'stand_cradle';
    cradle.position.z = -0.075;
    cradle.rotation.x = Math.PI / 2 - 0.0;
    g.add(cradle);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.34, 32), mat);
    pedestal.name = 'stand_pedestal';
    pedestal.position.y = -0.24;
    pedestal.castShadow = true;
    g.add(pedestal);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.022, 48), mat);
    base.name = 'stand_base';
    base.position.y = -0.41;
    base.receiveShadow = true;
    g.add(base);
    return g;
  }

  private registerStudioParts(): void {
    if (!this.studio) return;
    this.partObjects.clear();
    this.deformIds = [];
    const parts: PartInfo[] = [];
    let idx = 0;
    this.studio.components.forEach((c) => {
      this.partObjects.set(c.id, c.object);
      const metrics = this.metricsForObject(c.object);
      parts.push({
        id: c.id,
        name: COMPONENT_LABELS[c.id as ComponentId] ?? c.name,
        sourceName: `procedural/${c.id}`,
        meshIndex: idx,
        role: c.role === 'moving' ? 'moving' : c.role === 'flex' ? 'deformable' : 'static',
        visible: true,
        locked: false,
        enabledForMotion: c.role === 'moving',
        groupId: c.role === 'moving' ? 'g1' : null,
        metrics,
      });
      if (c.role === 'flex') this.deformIds.push(c.id);
      idx++;
    });
    store.getState().setParts(parts);
    this.currentRoot = this.studio.root;
    this.viewport.setModel(this.studio.root, this.partObjects, this.studio.pickables());
    parts.forEach((p) => this.viewport.setPartVisible(p.id, true));
  }

  private syncStudioMotion(): void {
    if (!this.studio) return;
    const { driver } = store.getState().project;
    const moving = this.studio.movingPartIds();
    const cone = this.studio.components.get('cone');
    // capture rest poses in the ASSEMBLED pose (no explode) so offsets don't
    // stack — explode is re-applied through the offset map below
    this.studio.applyExplode(0);
    const center = cone ? cone.object.position.clone() : new THREE.Vector3();
    const group = makeGroup('g1', 'Cone Assembly', moving);
    group.axis = 'z';
    group.pivot = [center.x, center.y, center.z];
    group.mode = 'D';
    group.enabled = true;
    store.getState().setGroups([group]);
    this.deformIds = this.studio.flexPartIds();
    this.motion.rebuild([group], this.partObjects, this.deformIds, driver.xmaxMM / 1000);
    this.motion.setAxis(group.id, 'z');
    this.motion.setPartOffsets(this.explodeOffsetMap());
    this.studio.applyExplode(this.explodeCur);
    this.viewport.setSelected(store.getState().selection);
  }

  private explodeOffsetMap(): Map<THREE.Object3D, THREE.Vector3> {
    const map = new Map<THREE.Object3D, THREE.Vector3>();
    if (!this.studio) return map;
    const distScale = store.getState().project.view.explodeDistance / 120;
    this.studio.components.forEach((c) => {
      map.set(c.object, c.explodeOffset.clone().multiplyScalar(distScale));
    });
    return map;
  }

  /** Live customization: patch the studio config and rebuild affected parts. */
  applyStudioConfig(patch: Partial<ProjectData['studio']>): void {
    if (!this.studio) return;
    store.getState().patchStudio(patch);
    const cfg = store.getState().project.studio;
    const result = this.studio.update(cfg);
    if (result.rebuilt.length > 0) {
      // refresh registered metrics + motion rests, keep selection/visibility
      this.registerStudioParts();
      this.syncStudioMotion();
      const view = store.getState().project.view;
      if (view.viewMode === 'system') this.applyViewMode('system', false);
      this.refreshSelection();
    }
  }

  /** Replace the entire studio config (driver class preset / reset). */
  applyStudioPreset(cfg: ProjectData['studio']): void {
    if (!this.studio) return;
    store.getState().setStudio(cfg);
    this.studio.rebuildAll(cfg);
    this.buildEnclosureFor(
      store.getState().project.box.wCM, store.getState().project.box.hCM, store.getState().project.box.dCM,
      store.getState().project.box.type === 'ported', store.getState().project.box.portDiameterCM, store.getState().project.box.portCount,
    );
    this.registerStudioParts();
    this.syncStudioMotion();
    this.refreshSelection();
    this.viewport.fitToModel();
    store.getState().log('ok', 'Driver geometry rebuilt from the selected configuration.');
  }

  // ================= view modes =================

  /**
   * Complete System / Driver Only / Driver Exploded / Component Focus.
   * Driver Only removes the enclosure from rendering entirely (not ghosted).
   */
  applyViewMode(mode: ViewMode, frameCamera = true): void {
    if (!this.studio) return;
    const view = store.getState().project.view;
    if (view.viewMode !== mode) store.getState().patchView({ viewMode: mode });

    // enclosure: visible only in Complete System
    if (this.enclosure) this.enclosure.visible = mode === 'system';
    // stand: anchor for the standalone driver views
    if (this.stand) this.stand.visible = mode !== 'system';
    // exploded factor: 1 in exploded mode (user slider scales the distance)
    store.getState().patchView({ explode: mode === 'exploded' ? (view.explode || 1) : 0 });

    // visibility of parts (respect hidden flags + focus isolation)
    this.refreshSelection();

    if (frameCamera) {
      if (mode === 'focus') {
        const sel = store.getState().selection[0];
        if (sel) this.viewport.fitToObject(sel);
        else this.viewport.fitToModel();
      } else {
        this.viewport.fitToModel();
      }
    }
  }

  /** One-click "Assemble Driver" — animate every part back to its seat. */
  assembleDriver(): void {
    store.getState().patchView({ explode: 0 });
    if (store.getState().project.view.viewMode === 'exploded') this.applyViewMode('driver');
    store.getState().log('ok', 'Driver assembled — all components returned to their correct positions.');
  }

  setCutaway(on: boolean, offset = 0): void {
    if (on) {
      const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), offset);
      setClipping(plane);
    } else {
      setClipping(null);
    }
    store.getState().patchView({ cutaway: on });
  }

  updateDimensionGuides(): void {
    if (!this.dimGuides || !this.studio) return;
    const { selection, project } = store.getState();
    this.dimGuides.clear();
    if (!project.view.showDimensions || selection.length !== 1) return;
    const comp = this.studio.components.get(selection[0] as ComponentId);
    if (!comp) return;
    const units = project.units;
    const box = new THREE.Box3().setFromObject(comp.object);
    const size = box.getSize(new THREE.Vector3());
    const mm = (m: number) => m * 1000;
    const fmt = (v: number) => units === 'metric' ? `Ø ${v.toFixed(0)} mm` : `Ø ${(v / 25.4).toFixed(2)}″`;
    const fmtD = (v: number) => units === 'metric' ? `${v.toFixed(0)} mm` : `${(v / 25.4).toFixed(2)}″`;
    const radial = Math.max(size.x, size.y);
    this.dimGuides.show(comp.object, 'z', fmt(mm(radial)), fmtD(mm(size.z)));
  }

  private metricsForObject(obj: THREE.Object3D): PartMetrics {
    const box3 = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box3.getSize(size);
    const center = new THREE.Vector3(); box3.getCenter(center);
    return {
      vertexCount: 0, triangleCount: 0,
      sizeM: [size.x, size.y, size.z], centerM: [center.x, center.y, center.z],
      radiusMaxM: size.length() / 2, symmetryAxis: 'z', symmetryCV: 1, rMinOverRMax: 0,
    };
  }

  async importModel(): Promise<void> {
    const res = await bridge().openModel();
    if (!res) return;
    if ('error' in res && res.error) { store.getState().log('error', res.error); return; }
    if (!('data' in res) || !res.data) return;
    const { fileName, filePath, data } = res;
    store.getState().setImportStage({ active: true, pct: 2, stage: 'Reading file' });
    store.getState().log('info', `Importing model: ${fileName} (${(data.length / 1048576).toFixed(1)} MB)`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const result = await parseModel(fileName, data, { smooth: true, studioMaterials: true }, (pct, stage) => {
        store.getState().setImportStage({ active: true, pct, stage });
      });
      this.currentRoot = result.root;
      const parts = result.parts.map((p: ImportedPartNode) => ({
        id: p.id, name: p.name, sourceName: p.sourceName, meshIndex: p.meshIndex,
        object: p.object, mesh: p.mesh, metrics: p.metrics, hadRealMaterial: p.hadRealMaterial,
      }));
      // classify
      let classified = autoClassify(parts.map((p) => p.metrics));
      const isTripo = parts.length === 15 && parts.every((p) => /^tripo_part_\d+$/.test(p.sourceName) || p.sourceName.startsWith('part_'));
      if (isTripo || parts.length === 15) classified = applyKnownTripoLayout(parts.map((p) => p.metrics), classified);
      const projParts: PartInfo[] = parts.map((p, i) => ({
        id: p.id, name: classified[i].suggestedName, sourceName: p.sourceName, meshIndex: p.meshIndex,
        role: classified[i].role, visible: true, locked: false,
        enabledForMotion: classified[i].role === 'moving', groupId: classified[i].role === 'moving' ? 'g1' : null,
        metrics: p.metrics,
      }));
      store.getState().setParts(projParts);
      // rebuild groups from moving parts
      const moving = projParts.filter((p) => p.role === 'moving').map((p) => p.id);
      const cone = projParts.find((p) => p.role === 'moving' && p.name.toLowerCase().includes('cone')) || projParts.find((p) => p.role === 'moving');
      const groups = defaultGroups();
      groups[0] = { ...groups[0], partIds: moving, name: 'Cone Assembly', enabled: true };
      if (cone) groups[0].pivot = [...cone.metrics.centerM] as [number, number, number];
      if (cone) groups[0].axis = (cone.metrics.symmetryAxis as 'x' | 'y' | 'z') || 'x';
      store.getState().setGroups(groups);
      store.getState().patchProject({ model: { filePath, fileName, format: result.format } });
      store.getState().setModelMeta(result.format, parts.some((p) => p.hadRealMaterial));
      this.currentRoot = result.root;
      this.registerParts(result.root, parts);
      this.rebuildMotion();
      this.recomputePhysics();
      this.viewport.fitToModel();
      const movingCount = moving.length;
      store.getState().log('ok', `Imported ${parts.length} parts — ${movingCount} classified as moving, ${parts.length - movingCount} static. Verify roles in the Parts panel.`);
      if (parts.length === 15) store.getState().log('ok', `All 15 parts detected and preserved. Cone identified by geometry (${projParts[3]?.sourceName ?? 'part index 3'}); its surround ring stays static except for flex.`);
    } catch (e) {
      store.getState().log('error', `Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      store.getState().setImportStage({ active: false, pct: 0, stage: '' });
    }
  }

  /** Shared path for drag&drop imports: register an already-parsed result. */
  async applyImportedResult(
    fileName: string, root: THREE.Group,
    parts: ImportedPartNode[], format: 'glb' | 'gltf' | 'obj' | 'fbx',
  ): Promise<void> {
    this.currentRoot = root;
    const mapped = parts.map((p) => ({
      id: p.id, name: p.name, sourceName: p.sourceName, meshIndex: p.meshIndex,
      object: p.object, mesh: p.mesh, metrics: p.metrics, hadRealMaterial: p.hadRealMaterial,
    }));
    let classified = autoClassify(parts.map((p) => p.metrics));
    if (parts.length === 15) classified = applyKnownTripoLayout(parts.map((p) => p.metrics), classified);
    const projParts: PartInfo[] = parts.map((p, i) => ({
      id: p.id, name: classified[i].suggestedName, sourceName: p.sourceName, meshIndex: p.meshIndex,
      role: classified[i].role, visible: true, locked: false,
      enabledForMotion: classified[i].role === 'moving', groupId: classified[i].role === 'moving' ? 'g1' : null,
      metrics: p.metrics,
    }));
    store.getState().setParts(projParts);
    const moving = projParts.filter((p) => p.role === 'moving').map((p) => p.id);
    const cone = projParts.find((p) => p.role === 'moving' && p.name.toLowerCase().includes('cone')) || projParts.find((p) => p.role === 'moving');
    const groups = defaultGroups();
    groups[0] = { ...groups[0], partIds: moving };
    if (cone) { groups[0].pivot = [...cone.metrics.centerM] as [number, number, number]; groups[0].axis = cone.metrics.symmetryAxis as 'x' | 'y' | 'z'; }
    store.getState().setGroups(groups);
    store.getState().patchProject({ model: { filePath: null, fileName, format } });
    store.getState().setModelMeta(format, parts.some((p) => p.hadRealMaterial));
    this.registerParts(root, mapped);
    this.rebuildMotion();
    this.recomputePhysics();
    this.viewport.fitToModel();
    store.getState().log('ok', `Imported ${parts.length} parts from ${fileName} — verify roles in the Parts panel.`);
  }

  private registerPartsFresh(projParts: PartInfo[], parts: { object: THREE.Object3D; mesh: THREE.Mesh }[]): void {
    this.partObjects.clear();
    this.deformIds = [];
    projParts.forEach((p, i) => this.partObjects.set(p.id, parts[i].object));
    this.viewport.setModel(this.currentRoot!, this.partObjects, parts.map((p) => p.mesh));
  }

  // ================= motion =================

  rebuildMotion(): void {
    const { groups, driver, parts } = store.getState().project;
    this.deformIds = parts.filter((p) => p.role === 'deformable').map((p) => p.id);
    this.motion.rebuild(groups, this.partObjects, this.deformIds, driver.xmaxMM / 1000);
    groups.forEach((g) => this.motion.setAxis(g.id, g.axis));
    // selection outlines refresh
    this.viewport.setSelected(store.getState().selection);
  }

  resetMotion(): void {
    this.motion.resetAll();
    store.getState().log('info', 'Motion reset — all parts returned to rest pose.');
  }

  // ================= physics =================

  recomputePhysics(): void {
    const { driver, box, amp } = store.getState().project;
    const d = buildDriverModel(driver);
    const net = netVolumeL(box, box.wallCM, 3.5);
    const b = buildBoxModel({ type: box.type, netVolumeL: net, portDiameterCM: box.portDiameterCM, portLengthCM: box.portLengthCM, portCount: box.portCount });
    const curves = computeCurves(d, b, amp.voltageRMS);
    const summary = computeSummary(d, b, amp.voltageRMS, curves, net);
    store.getState().setPhysics(curves, summary);
    const xmaxMM = driver.xmaxMM;
    store.getState().setPosition(store.getState().positionSec, { xmaxMM, usagePct: store.getState().hud.usagePct });
  }

  private scheduleReanalysis(): void {
    window.clearTimeout(this.reanalysisTimer);
    this.reanalysisTimer = window.setTimeout(() => {
      if (this.analysisCache && store.getState().audioKind) void this.analyzeCurrentAudio(true);
    }, 500);
  }

  // ================= audio =================

  async importAudio(): Promise<void> {
    const res = await bridge().openAudio();
    if (!res) return;
    if ('error' in res && res.error) { store.getState().log('error', res.error); return; }
    if (!('data' in res) || !res.data) return;
    await this.loadAudioFromData(res.fileName, res.filePath, res.data, 'file');
  }

  async loadAudioFromData(fileName: string, filePath: string | null, data: Uint8Array, kind: 'file' | 'synth'): Promise<void> {
    const st = store.getState();
    st.log('info', `Loading audio: ${fileName}`);
    st.setAnalysis(null, 0, true);
    try {
      const buf = await this.audio.decode(fileName, data);
      store.getState().setAudio(fileName, kind);
      store.getState().patchProject({ audio: { filePath, fileName } });
      store.getState().log('ok', `Decoded ${fileName} — ${buf.duration.toFixed(1)}s, ${buf.sampleRate} Hz, ${buf.numberOfChannels} ch`);
      await this.analyzeCurrentAudio(false);
    } catch (e) {
      store.getState().setAnalysis(null, 0, false);
      store.getState().log('error', `Audio decode failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async analyzeCurrentAudio(isRetry: boolean): Promise<void> {
    if (!this.audio.isLoaded) return;
    store.getState().setAnalysis(null, 5, true);
    await new Promise((r) => setTimeout(r, 40));
    try {
      const mono = this.audio.monoMixdown();
      const mono8k = await this.audio.resampleForAnalysis(mono, this.audio.currentSampleRate);
      store.getState().setAnalysis(null, 35, true);
      await new Promise((r) => setTimeout(r, 30));
      const { driver, box, amp } = store.getState().project;
      const d = buildDriverModel(driver);
      const net = netVolumeL(box, box.wallCM, 3.5);
      const b = buildBoxModel({ type: box.type, netVolumeL: net, portDiameterCM: box.portDiameterCM, portLengthCM: box.portLengthCM, portCount: box.portCount });
      const analysis = this.audio.runAnalysis(mono8k, d, b, amp.voltageRMS);
      this.analysisCache = analysis;
      this.maxWave = Math.max(1e-6, ...Array.from(analysis.waveform).map(Math.abs));
      this.envP95 = Math.max(analysis.stats.bassP95, 1e-6);
      // stats: peak excursion, % over Xmax
      const xmaxM = driver.xmaxMM / 1000;
      let peak = 0, over = 0;
      for (let i = 0; i < analysis.frameCount; i++) {
        const a = Math.abs(analysis.excursionM[i]);
        if (a > peak) peak = a;
        if (a > xmaxM) over++;
      }
      store.getState().setStats(peak * 1000, (over / Math.max(analysis.frameCount, 1)) * 100);
      store.getState().setAnalysis(analysis, 100, false);
      store.getState().setBottomTab('waveform');
      const { peakExcursionMM, overXmaxPct } = store.getState();
      store.getState().log('ok', `Analysis complete: ${analysis.frameCount} frames @ ${analysis.fps.toFixed(0)} fps. Physics-mode peak excursion ${peakExcursionMM.toFixed(1)} mm vs Xmax ${driver.xmaxMM} mm (${overXmaxPct.toFixed(1)}% over).`);
      if (overXmaxPct > 2) store.getState().log('warn', `Cone exceeds Xmax ${overXmaxPct.toFixed(1)}% of the time at ${amp.voltageRMS} V — reduce drive level, volume, or port tuning.`);
    } catch (e) {
      store.getState().setAnalysis(null, 0, false);
      store.getState().log('error', `Analysis failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async generateTestSignal(kind: 'sweep' | 'kick' | 'tone40' | 'musicish'): Promise<void> {
    const names = { sweep: 'Sine Sweep 20-80Hz.wav', kick: 'Kick Pattern 50BPM.wav', tone40: '40Hz Tone.wav', musicish: 'Bass Demo Loop.wav' };
    const buf = await AudioEngine.synthesizeTestSignal(kind);
    const data = new Uint8Array(0);
    this.audio.loadBuffer(buf);
    store.getState().setAudio(names[kind], 'synth');
    store.getState().patchProject({ audio: { filePath: null, fileName: names[kind] } });
    store.getState().log('ok', `Generated test signal: ${names[kind]}`);
    await this.analyzeCurrentAudio(false);
  }

  // transport
  play(): void {
    if (!this.audio.isLoaded) { store.getState().log('warn', 'No audio loaded — use Audio → Import Audio or generate a test signal.'); return; }
    this.audio.play();
    store.getState().setTransport('playing');
  }
  pause(): void {
    this.audio.pause();
    store.getState().setTransport('paused');
  }
  stop(): void {
    this.audio.stop();
    store.getState().setTransport('stopped');
    store.getState().setPosition(0);
    this.motion.resetAll();
  }
  toggleTransport(): void {
    const t = store.getState().transport;
    if (t === 'playing') this.pause(); else this.play();
  }
  seek(sec: number): void {
    this.audio.seek(sec);
    store.getState().setPosition(sec);
    if (store.getState().transport !== 'playing') this.motion.resetAll();
  }
  setLoop(on: boolean): void { this.audio.loop = on; store.getState().setLoop(on); }
  setVolume(v: number): void { this.audio.setVolume(v); store.getState().setVolume(v); }

  // ================= render loop =================

  private startLoop(): void {
    const tick = (t: number) => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min((t - this.lastT) / 1000, 0.1) || 0.016;
      this.lastT = t;
      this.updateExplode(dt);
      this.updateMotion(dt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Smooth exploded-view animation toward the active mode's target. */
  private updateExplode(dt: number): void {
    if (!this.studio) return;
    const view = store.getState().project.view;
    const target = view.viewMode === 'exploded' ? view.explode : 0;
    const k = 1 - Math.exp(-dt * 7);
    this.explodeCur += (target - this.explodeCur) * k;
    if (Math.abs(target - this.explodeCur) < 0.0005) this.explodeCur = target;
    this.studio.applyExplode(this.explodeCur);
  }

  /** Refresh the exploded offsets (after distance slider changes). */
  refreshExplodeOffsets(): void {
    if (!this.studio) return;
    this.motion.setPartOffsets(this.explodeOffsetMap());
    // flex parts are offset too — reposition them directly
    const distScale = store.getState().project.view.explodeDistance / 120;
    this.studio.components.forEach((c) => {
      if (c.role !== 'flex') return;
      c.object.position.copy(c.assembledPos).addScaledVector(c.explodeOffset, this.explodeCur * distScale);
    });
  }

  private updateMotion(dt: number): void {
    const state = store.getState();
    const { groups, analysis: cfg, driver } = state.project;
    const analysis = this.analysisCache;
    const playing = state.transport === 'playing';

    let signal = 0; // meters, signed
    if (analysis && state.audioKind) {
      const pos = this.audio.framePosition();
      const fPos = pos * analysis.fps;
      const i0 = Math.min(Math.floor(fPos), analysis.frameCount - 1);
      const i1 = Math.min(i0 + 1, analysis.frameCount - 1);
      const frac = Math.max(0, Math.min(fPos - i0, 1));
      const xmaxM = driver.xmaxMM / 1000;

      for (const g of groups) {
        if (!g.enabled) continue;
        let raw = 0;
        const sens = cfg.sensitivity * g.gain;
        switch (g.mode) {
          case 'A': raw = (analysis.waveform[i0] * (1 - frac) + analysis.waveform[i1] * frac) / this.maxWave * xmaxM * sens; break;
          case 'B': {
            const env = analysis.envelope[i0] * (1 - frac) + analysis.envelope[i1] * frac;
            raw = Math.max(0, env / this.envP95) * xmaxM * 0.7 * sens;
            break;
          }
          case 'C': {
            // nearest band to [bandLowHz, bandHighHz]
            let best = 0, bestDist = 1e9;
            for (let bi = 0; bi < analysis.bandCenterHz.length; bi++) {
              const c = analysis.bandCenterHz[bi];
              const dist = Math.abs(c - (g.bandLowHz + g.bandHighHz) / 2);
              if (dist < bestDist) { bestDist = dist; best = bi; }
            }
            const v0 = analysis.bandRMS[i0 * 6 + best] / this.envP95;
            const v1 = analysis.bandRMS[i1 * 6 + best] / this.envP95;
            raw = Math.max(0, (v0 * (1 - frac) + v1 * frac)) * xmaxM * 0.7 * sens;
            break;
          }
          case 'D': raw = (analysis.excursionM[i0] * (1 - frac) + analysis.excursionM[i1] * frac) * sens; break;
        }
        signal = raw; // last enabled group wins for HUD; all groups applied below
        this.motion.apply(g.id, raw, playing || state.transport === 'paused' ? dt : dt);
      }
      if (!playing) this.motion.apply(groups.find((g) => g.enabled)?.id ?? '', 0, dt);
    } else {
      for (const g of groups) if (g.enabled) this.motion.apply(g.id, 0, dt);
    }

    // HUD @ ~12 Hz
    this.hudAccum += dt;
    if (this.hudAccum > 0.08) {
      this.hudAccum = 0;
      const hud = this.computeHud();
      store.getState().setPosition(this.audio.position(), hud);
      hudBus.dispatch(hud);
    }
  }

  private computeHud(): ReturnType<typeof useStore.getState>['hud'] {
    const analysis = this.analysisCache;
    const { driver, box, amp } = store.getState().project;
    const xmaxMM = driver.xmaxMM;
    if (!analysis || !store.getState().audioKind) {
      return { excursionMM: 0, velocityMS: 0, accelG: 0, splDB: 0, portVelMS: 0, xmaxMM, usagePct: 0 };
    }
    const pos = this.audio.framePosition();
    const fPos = pos * analysis.fps;
    const i0 = Math.min(Math.floor(fPos), analysis.frameCount - 1);
    const i1 = Math.min(i0 + 1, analysis.frameCount - 1);
    const frac = Math.max(0, Math.min(fPos - i0, 1));
    const lerp = (a: Float32Array) => a[i0] * (1 - frac) + a[i1] * frac;

    // SPL from band levels
    let p2 = 0;
    for (let bi = 0; bi < 6; bi++) {
      const v = (analysis.bandRMS[i0 * 6 + bi] * (1 - frac) + analysis.bandRMS[i1 * 6 + bi] * frac) * analysis.calibrationVoltsPerUnit;
      p2 += (analysis.bandSPLCoef[bi] * v) ** 2;
    }
    const spl = 20 * Math.log10(Math.max(Math.sqrt(p2), 1e-9) / 20e-6);
    const xMM = Math.abs(lerp(analysis.excursionM)) * 1000;
    return {
      excursionMM: xMM,
      velocityMS: Math.abs(lerp(analysis.velocity)),
      accelG: Math.abs(lerp(analysis.acceleration)) / 9.81,
      splDB: spl,
      portVelMS: box.type === 'ported' ? Math.abs(lerp(analysis.portVelocity)) : 0,
      xmaxMM,
      usagePct: Math.min(200, (xMM / Math.max(xmaxMM, 0.01)) * 100),
    };
  }

  // ================= view commands =================

  applyViewFromProject(): void {
    const { view } = store.getState().project;
    this.viewport.setProjection(view.projection === 'orthographic');
    this.viewport.setShading(view.shading);
    this.viewport.setExplode(view.explode);
    this.viewport.setGridVisible(view.showGrid);
    this.viewport.setAutoRotate(view.autoRotate);
    this.viewport.setLighting(view.lighting);
    this.setCutaway(view.cutaway);
    this.applyViewMode(view.viewMode, false);
  }

  standardView(v: StandardView): void { this.viewport.setStandardView(v); }
  resetCamera(): void { this.viewport.fitToModel(); }

  setPartVisible(id: string, visible: boolean): void {
    this.viewport.setPartVisible(id, visible);
  }

  refreshSelection(): void {
    const { selection, project } = store.getState();
    const focusMode = project.view.viewMode === 'focus' && selection.length > 0;
    project.parts.forEach((p) => {
      const visible = p.visible && (!focusMode || selection.includes(p.id));
      this.viewport.setPartVisible(p.id, visible);
    });
    this.viewport.setSelected(selection);
    this.viewport.setShading(project.view.shading);
    this.updateDimensionGuides();
  }

  // ================= persistence =================

  serialize(): string {
    const st = store.getState();
    const proj: ProjectData = { ...st.project, modifiedAt: new Date().toISOString() };
    return JSON.stringify(proj, (_k, v) => (v instanceof Float32Array ? undefined : v), 2);
  }

  async saveProjectAs(): Promise<void> {
    const name = store.getState().project.name || 'project';
    const path = await bridge().saveProjectAs(name);
    if (!path) return;
    const r = await bridge().writeProject(path, this.serialize());
    if (r.error) { store.getState().log('error', `Save failed: ${r.error}`); return; }
    store.getState().setProjectFile(path, name);
    store.getState().log('ok', `Project saved: ${path}`);
  }

  async saveProject(): Promise<void> {
    const path = store.getState().projectFilePath;
    if (!path) return this.saveProjectAs();
    const r = await bridge().writeProject(path, this.serialize());
    if (r.error) { store.getState().log('error', `Save failed: ${r.error}`); return; }
    store.getState().setDirty(false);
    store.getState().log('ok', `Project saved: ${path}`);
  }

  async openProject(): Promise<void> {
    const res = await bridge().openProject();
    if (!res) return;
    if ('error' in res) { store.getState().log('error', res.error); return; }
    const parsed = sanitizeProject(JSON.parse(res.json));
    if (!parsed.ok) { store.getState().log('error', `Invalid project: ${parsed.error}`); return; }
    this.applyProject(parsed.project);
    store.getState().setProjectFile(res.filePath, parsed.project.name);
    store.getState().log('ok', `Project loaded: ${res.filePath}`);
  }

  async applyProject(project: ProjectData): Promise<void> {
    this.stop();
    store.getState().patchProject(project);
    // rebuild model if the project references one
    if (project.model.filePath && project.model.format !== 'procedural') {
      const res = await bridge().readModelPath(project.model.filePath);
      if (res && 'data' in res && res.data) {
        try {
          const result = await parseModel(project.model.fileName || 'model.glb', res.data, { smooth: true, studioMaterials: true });
          this.currentRoot = result.root;
          const parts = result.parts.map((p) => ({
            id: p.id, name: p.name, sourceName: p.sourceName, meshIndex: p.meshIndex,
            object: p.object, mesh: p.mesh, metrics: p.metrics, hadRealMaterial: p.hadRealMaterial,
          }));
          this.partObjects.clear();
          parts.forEach((p) => this.partObjects.set(p.id, p.object));
          this.viewport.setModel(this.currentRoot, this.partObjects, parts.map((p) => p.mesh));
          store.getState().setModelMeta(project.model.format, true);
        } catch (e) {
          store.getState().log('warn', `Could not restore model from ${project.model.filePath}: ${e instanceof Error ? e.message : e}`);
          await this.loadDefaultAssembly();
        }
      } else {
        store.getState().log('warn', `Referenced model file not found (${project.model.filePath}). Falling back to reference assembly.`);
        await this.loadDefaultAssembly();
      }
    } else {
      await this.loadDefaultAssembly();
    }
    // apply stored roles/groups on top
    store.getState().setParts(project.parts);
    store.getState().setGroups(project.groups);
    this.rebuildMotion();
    this.recomputePhysics();
    this.applyViewFromProject();
    this.refreshSelection();
    // restore audio if referenced
    if (project.audio.filePath) {
      const res = await bridge().readAudioPath(project.audio.filePath);
      if (res && 'data' in res && res.data) {
        await this.loadAudioFromData(project.audio.fileName || 'audio', project.audio.filePath, res.data, 'file');
      } else {
        store.getState().log('warn', `Referenced audio file not found: ${project.audio.filePath ?? '—'}`);
      }
    }
  }

  async newProject(): Promise<void> {
    this.stop();
    const { defaultProject } = await import('../../shared/project/schema');
    store.getState().patchProject(defaultProject('Untitled Project'));
    store.getState().setProjectFile(null, 'Untitled Project');
    store.getState().setAudio(null, null);
    this.analysisCache = null;
    store.getState().setAnalysis(null, 0, false);
    await this.loadDefaultAssembly();
    store.getState().log('info', 'New project created.');
  }

  private async autosave(): Promise<void> {
    if (!store.getState().dirty) return;
    const r = await bridge().autosaveWrite(this.serialize());
    if (r.error) console.warn('autosave failed', r.error);
  }

  async tryRestoreAutosave(): Promise<void> {
    const r = await bridge().autosaveRead();
    if (!r.json) return;
    try {
      const parsed = sanitizeProject(JSON.parse(r.json));
      if (!parsed.ok) return;
      const t = new Date(r.mtime ?? Date.now());
      store.getState().log('warn', `Found autosave from ${t.toLocaleString()} — restoring session. Use File → New Project to start fresh.`);
      await this.applyProject(parsed.project);
    } catch { /* ignore corrupt autosave */ }
  }

  // ================= exports =================

  exportCurvesCSV(): void {
    const curves = store.getState().physicsCurves;
    if (!curves) return;
    const rows = ['frequency_hz,spl_db_1m,excursion_peak_mm,impedance_ohm,port_velocity_ms,impedance_phase_deg,spl_at_xmax_db'];
    for (let i = 0; i < curves.freq.length; i++) {
      rows.push([
        curves.freq[i].toFixed(2), curves.splDB[i].toFixed(2), curves.excursionMM[i].toFixed(3),
        curves.impedanceOhm[i].toFixed(2), curves.portVelMS[i].toFixed(2), curves.phaseDeg[i].toFixed(1), curves.splXmaxDB[i].toFixed(2),
      ].join(','));
    }
    const b64 = btoa(unescape(encodeURIComponent(rows.join('\n'))));
    void bridge().writeExport('sonivex-curves', 'text/csv', b64).then((r) => {
      if (r?.filePath) store.getState().log('ok', `CSV exported: ${r.filePath}`);
    });
  }

  async exportReportPDF(): Promise<void> {
    const st = store.getState();
    const { project, physicsSummary, physicsCurves, peakExcursionMM, overXmaxPct, audioName } = st;
    const summary = physicsSummary;
    const rows = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const warn = (summary?.warnings ?? []).map((w) => `<li>${w}</li>`).join('') || '<li>No warnings.</li>';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:'Segoe UI',Arial,sans-serif;color:#16181d;margin:36px;}
      h1{font-size:22px;letter-spacing:.5px;border-bottom:3px solid #3a3a3a;padding-bottom:8px;}
      h2{font-size:15px;color:#8a8a8a;margin-top:22px;}
      table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px;}
      td{border:1px solid #d8dde3;padding:5px 8px;} td:first-child{width:45%;color:#4a5361;}
      ul{font-size:12px;} .muted{color:#7a828e;font-size:11px;}
    </style></head><body>
      <h1>Sonivex Studio — Simulation Report</h1>
      <p class="muted">Project: ${project.name} · Generated ${new Date().toLocaleString()} · Design. Simulate. Validate.</p>
      <h2>Driver (Thiele/Small)</h2>
      <table>${rows({
        'Nominal size': `${project.driver.nominalSizeIn}"`,
        'Effective piston diameter (Sd)': `${project.driver.effectiveDiameterCM} cm (${summary?.sdCM2.toFixed(0)} cm²)`,
        'Resonance Fs': `${project.driver.fsHz} Hz`,
        'Qes / Qms / Qts': `${project.driver.qes} / ${project.driver.qms} / ${summary?.qtc ? project.driver.qes && project.driver.qms ? ((project.driver.qes * project.driver.qms) / (project.driver.qes + project.driver.qms)).toFixed(3) : '' : ''}`,
        'Vas': `${project.driver.vasL} L`,
        'Re / Le': `${project.driver.reOhm} Ω / ${project.driver.leMH} mH`,
        'Xmax': `${project.driver.xmaxMM} mm`,
        'Rated power Pe': `${project.driver.peW} W`,
        'Mms (derived)': `${summary?.mmsG.toFixed(1)} g`,
        'Bl (derived)': `${summary?.blTM.toFixed(2)} T·m`,
        'Cms (derived)': `${summary?.cmsMMN.toFixed(3)} mm/N`,
      })}</table>
      <h2>Enclosure</h2>
      <table>${rows({
        'Type': project.box.type === 'ported' ? 'Bass reflex (ported)' : 'Sealed',
        'External dimensions (W×H×D)': `${project.box.wCM} × ${project.box.hCM} × ${project.box.dCM} cm`,
        'Wall thickness': `${project.box.wallCM} cm`,
        'Net volume': `${summary?.volumeNetL.toFixed(1)} L`,
        ...(project.box.type === 'ported'
          ? { 'Tuning Fb': `${summary ? summary.qtcOrFbHz.toFixed(1) : ''} Hz` }
          : { 'System Fc / Qtc': `${summary ? summary.qtcOrFbHz.toFixed(1) : ''} Hz / Qtc ${summary?.qtc.toFixed(2) ?? ''}` }),
        ...(project.box.type === 'ported'
          ? { 'Port': `${project.box.portCount} × ⌀${project.box.portDiameterCM} cm × ${project.box.portLengthCM} cm` }
          : { 'Fill': `${Math.round(project.box.fillAmount * 100)}% damping fill` }),
        '-3 dB point F3': `${summary?.f3Hz.toFixed(1)} Hz`,
      })}</table>
      <h2>Results @ ${project.amp.voltageRMS} V (${(project.amp.voltageRMS ** 2 / project.amp.nominalOhm).toFixed(0)} W into ${project.amp.nominalOhm} Ω)</h2>
      <table>${rows({
        'Max SPL (response peak)': `${summary?.splAtPeDB.toFixed(1)} dB`,
        'Max SPL at Xmax limit': `${summary?.maxSplXmaxDB.toFixed(1)} dB`,
        'Peak excursion @ drive level': `${summary?.excursionAtPeMM.toFixed(1)} mm (Xmax ${project.driver.xmaxMM} mm)`,
        'Port air velocity (max)': project.box.type === 'ported' ? `${summary?.portVelocityAtPeMS.toFixed(1)} m/s` : '— (sealed)',
        'Air volume displaced at Xmax': `${summary?.airVolumeDisplacedL.toFixed(1)} L`,
      })}</table>
      <h2>Track analysis</h2>
      <table>${rows({
        'Track': audioName ?? '—',
        'Physics-mode peak excursion (track)': `${peakExcursionMM.toFixed(1)} mm`,
        'Time over Xmax': `${overXmaxPct.toFixed(1)} %`,
      })}</table>
      <h2>Warnings</h2><ul>${warn}</ul>
      <h2>Limitations</h2><p style="font-size:11px;color:#5a626e">Excursion/SPL values are lumped-parameter estimates derived from the entered Thiele/Small parameters and the track's spectral content scaled to the set amplifier voltage. They are engineering estimates, not measurements of a physical system. For validated displacement, measure with a calibration rig.</p>
    </body></html>`;
    const r = await bridge().printToPDF(html);
    if (r.error) { store.getState().log('error', `PDF export failed: ${r.error}`); return; }
    if (r.data) {
      const saved = await bridge().writeExport('sonivex-report', 'application/pdf', r.data);
      if (saved?.filePath) store.getState().log('ok', `Report exported: ${saved.filePath}`);
    }
  }

  // ================= project actions =================

  async reapplyStudioMaterials(): Promise<void> {
    const parts = store.getState().project.parts;
    parts.forEach((p, i) => {
      const obj = this.partObjects.get(p.id);
      obj?.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) mesh.material = studioMaterialFor(p.name, i);
      });
    });
    store.getState().log('ok', 'Studio PBR materials applied to all parts.');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.clearInterval(this.physicsTimer);
    window.clearInterval(this.autosaveTimer);
    window.clearTimeout(this.reanalysisTimer);
    this.audio.dispose();
    this.motion.dispose();
    this.dimGuides?.dispose();
    this.studio?.dispose();
    disposeMaterials();
    this.viewport.dispose();
  }
}

export const controller = new AppController();

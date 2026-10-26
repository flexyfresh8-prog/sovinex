/**
 * Global application state (zustand).
 * High-frequency HUD data is pushed at ~12 Hz; gauges subscribe directly.
 */
import { create } from 'zustand';
import { ProjectData, TrackAnalysis, PhysicsCurves, PhysicsSummary } from '../shared/types';
import { defaultProject } from '../shared/project/schema';

export interface HudData {
  excursionMM: number;
  velocityMS: number;
  accelG: number;
  splDB: number;
  portVelMS: number;
  xmaxMM: number;
  usagePct: number;
}

export interface ConsoleLine { t: number; level: 'info' | 'warn' | 'error' | 'ok'; msg: string }

export interface StoreState {
  project: ProjectData;
  selection: string[];
  hover: string | null;
  transport: 'stopped' | 'playing' | 'paused';
  positionSec: number;
  durationSec: number;
  volume: number;
  loop: boolean;
  audioName: string | null;
  audioKind: 'file' | 'synth' | null;
  analysis: TrackAnalysis | null;
  analyzing: boolean;
  analysisPct: number;
  physicsCurves: PhysicsCurves | null;
  physicsSummary: PhysicsSummary | null;
  hud: HudData;
  consoleLines: ConsoleLine[];
  importStage: { active: boolean; pct: number; stage: string };
  rightTab: 'parts' | 'driver' | 'box' | 'motion' | 'results';
  bottomTab: 'console' | 'waveform' | 'spectrum' | 'physics';
  projectFilePath: string | null;
  dirty: boolean;
  peakExcursionMM: number;
  overXmaxPct: number;
  modelFormat: 'glb' | 'gltf' | 'obj' | 'fbx' | 'procedural';
  hasRealMaterials: boolean;
}

export interface StoreActions {
  patchProject: (patch: Partial<ProjectData>) => void;
  patchDriver: (patch: Partial<ProjectData['driver']>) => void;
  patchBox: (patch: Partial<ProjectData['box']>) => void;
  patchAmp: (patch: Partial<ProjectData['amp']>) => void;
  patchView: (patch: Partial<ProjectData['view']>) => void;
  patchAnalysisCfg: (patch: Partial<ProjectData['analysis']>) => void;
  setParts: (parts: ProjectData['parts']) => void;
  updatePart: (id: string, patch: Partial<ProjectData['parts'][number]>) => void;
  setGroups: (groups: ProjectData['groups']) => void;
  updateGroup: (id: string, patch: Partial<ProjectData['groups'][number]>) => void;
  setSelection: (ids: string[]) => void;
  setHover: (id: string | null) => void;
  setTransport: (t: StoreState['transport']) => void;
  setPosition: (sec: number, hud?: Partial<HudData>) => void;
  setAudio: (name: string | null, kind: StoreState['audioKind']) => void;
  setAnalysis: (a: TrackAnalysis | null, pct: number, active: boolean) => void;
  setPhysics: (curves: PhysicsCurves | null, summary: PhysicsSummary | null) => void;
  log: (level: ConsoleLine['level'], msg: string) => void;
  setImportStage: (s: { active: boolean; pct: number; stage: string }) => void;
  setRightTab: (t: StoreState['rightTab']) => void;
  setBottomTab: (t: StoreState['bottomTab']) => void;
  setProjectFile: (p: string | null, name: string) => void;
  setDirty: (d: boolean) => void;
  setModelMeta: (format: StoreState['modelFormat'], hasRealMaterials: boolean) => void;
  setStats: (peakMM: number, overPct: number) => void;
  setLoop: (l: boolean) => void;
  setVolume: (v: number) => void;
}

export const useStore = create<StoreState & StoreActions>((set) => ({
  project: defaultProject(),
  selection: [],
  hover: null,
  transport: 'stopped',
  positionSec: 0,
  durationSec: 0,
  volume: 0.7,
  loop: false,
  audioName: null,
  audioKind: null,
  analysis: null,
  analyzing: false,
  analysisPct: 0,
  physicsCurves: null,
  physicsSummary: null,
  hud: { excursionMM: 0, velocityMS: 0, accelG: 0, splDB: 0, portVelMS: 0, xmaxMM: 14, usagePct: 0 },
  consoleLines: [],
  importStage: { active: false, pct: 0, stage: '' },
  rightTab: 'parts',
  bottomTab: 'waveform',
  projectFilePath: null,
  dirty: false,
  peakExcursionMM: 0,
  overXmaxPct: 0,
  modelFormat: 'procedural',
  hasRealMaterials: false,

  patchProject: (patch) => set((s) => ({ project: { ...s.project, ...patch }, dirty: true })),
  patchDriver: (patch) => set((s) => ({ project: { ...s.project, driver: { ...s.project.driver, ...patch } }, dirty: true })),
  patchBox: (patch) => set((s) => ({ project: { ...s.project, box: { ...s.project.box, ...patch } }, dirty: true })),
  patchAmp: (patch) => set((s) => ({ project: { ...s.project, amp: { ...s.project.amp, ...patch } }, dirty: true })),
  patchView: (patch) => set((s) => ({ project: { ...s.project, view: { ...s.project.view, ...patch } }, dirty: true })),
  patchAnalysisCfg: (patch) => set((s) => ({ project: { ...s.project, analysis: { ...s.project.analysis, ...patch } }, dirty: true })),
  setParts: (parts) => set((s) => ({ project: { ...s.project, parts }, dirty: true })),
  updatePart: (id, patch) => set((s) => ({
    project: {
      ...s.project,
      parts: s.project.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    },
    dirty: true,
  })),
  setGroups: (groups) => set((s) => ({ project: { ...s.project, groups }, dirty: true })),
  updateGroup: (id, patch) => set((s) => ({
    project: {
      ...s.project,
      groups: s.project.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    },
    dirty: true,
  })),
  setSelection: (ids) => set({ selection: ids }),
  setHover: (id) => set({ hover: id }),
  setTransport: (t) => set({ transport: t }),
  setPosition: (sec, hud) => set((s) => ({ positionSec: sec, ...(hud ? { hud: { ...s.hud, ...hud } } : {}) })),
  setAudio: (name, kind) => set({ audioName: name, audioKind: kind, dirty: true }),
  setAnalysis: (a, pct, active) => set({ analysis: a, analysisPct: pct, analyzing: active }),
  setPhysics: (curves, summary) => set({ physicsCurves: curves, physicsSummary: summary }),
  log: (level, msg) => set((s) => ({
    consoleLines: [...s.consoleLines.slice(-400), { t: Date.now(), level, msg }],
  })),
  setImportStage: (importStage) => set({ importStage }),
  setRightTab: (rightTab) => set({ rightTab }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setProjectFile: (projectFilePath, name) => set((s) => ({
    projectFilePath, project: { ...s.project, name }, dirty: false,
  })),
  setDirty: (dirty) => set({ dirty }),
  setModelMeta: (modelFormat, hasRealMaterials) => set({ modelFormat, hasRealMaterials }),
  setStats: (peakExcursionMM, overXmaxPct) => set({ peakExcursionMM, overXmaxPct }),
  setLoop: (loop) => set({ loop }),
  setVolume: (volume) => set({ volume }),
}));

export function hudEventTarget(): { dispatch: (h: HudData) => void; subscribe: (fn: (h: HudData) => void) => () => void } {
  const listeners = new Set<(h: HudData) => void>();
  return {
    dispatch: (h) => listeners.forEach((fn) => fn(h)),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export const hudBus = hudEventTarget();

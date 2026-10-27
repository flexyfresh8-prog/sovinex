/**
 * Project persistence: schema v1, defaults, validation, migration.
 * Project files (.svx) are JSON; model/audio files are referenced, never modified.
 */
import { ProjectData, PartInfo, MotionGroupConfig, PartMetrics } from '../types';

export const SCHEMA_VERSION = 1;

export function defaultDriver() {
  return {
    nominalSizeIn: 12,
    effectiveDiameterCM: 26.5,
    fsHz: 28,
    qes: 0.42,
    qms: 6.5,
    vasL: 85,
    reOhm: 3.2,
    leMH: 1.4,
    xmaxMM: 14,
    peW: 500,
    sensitivityDB: 87,
    coneDepthMM: 62,
    surroundWidthMM: 16,
    dustCapRatio: 0.34,
    dustCapHeight: 22,
    magnetDiameterCM: 14.6,
    magnetHeightCM: 3.8,
    vcDiameterCM: 5.1,
    coneColor: '#1A1A1A',
    basketColor: '#2C2C2C',
    coneMaterial: 'composite' as const,
  };
}

export function defaultBox() {
  return {
    type: 'ported' as const,
    wCM: 46, hCM: 92, dCM: 40,
    wallCM: 1.9,
    portDiameterCM: 10.2,
    portLengthCM: 28,
    portCount: 1,
    fillAmount: 0.25,
  };
}

export function defaultAmp() {
  return { voltageRMS: 20, nominalOhm: 4 };
}

export function defaultAnalysis() {
  return { smoothingMs: 90, sensitivity: 1.0 };
}

export function makePart(
  id: string, name: string, sourceName: string, meshIndex: number,
  role: PartInfo['role'], metrics: PartMetrics,
): PartInfo {
  return {
    id, name, sourceName, meshIndex, role,
    visible: true, locked: false,
    enabledForMotion: role === 'moving',
    groupId: null, metrics,
  };
}

export function makeGroup(id: string, name: string, partIds: string[]): MotionGroupConfig {
  return {
    id, name, partIds, enabled: true,
    axis: 'x', pivot: [0, 0, 0],
    maxDisplacementMM: 0, // 0 → derive from Xmax
    gain: 1.0, smoothingMs: 90,
    mode: 'D', bandLowHz: 40, bandHighHz: 100, invert: false,
  };
}

/**
 * Default 15-part layout matching the user's Tripo model
 * (`loudspeaker 3d model.glb`, parts tripo_part_0..14, 1-based part N = tripo_part_(N-1)).
 * Part #3 (tripo_part_2) is the cone, per user specification.
 * Geometry-derived metrics are filled in at import; placeholders here.
 */
export function defaultPartsForTripo(): PartInfo[] {
  const P = (
    idx: number, name: string, role: PartInfo['role'],
    verts: number, size: [number, number, number], center: [number, number, number],
    rMax: number, sym: PartMetrics['symmetryAxis'], cv: number, rminRmax: number,
  ): PartInfo => makePart(`p${idx}`, name, `tripo_part_${idx}`, idx, role, {
    vertexCount: verts, triangleCount: Math.floor(verts * 1.9),
    sizeM: size, centerM: center, radiusMaxM: rMax, symmetryAxis: sym,
    symmetryCV: cv, rMinOverRMax: rminRmax,
  });

  const parts = [
    P(0, 'Enclosure', 'static', 108612, [0.513, 0.854, 0.867], [0.092, 0.495, 0.001], 0.481, 'x', 0.224, 0.07),
    P(1, 'Driver Motor / Basket', 'static', 47829, [0.414, 0.819, 0.785], [-0.281, 0.418, 0.000], 0.408, 'x', 0.087, 0.62),
    P(2, 'Cone', 'moving', 41509, [0.186, 0.992, 1.000], [0.332, 0.496, 0.000], 0.500, 'x', 0.051, 0.83),
    P(3, 'Dust Cap / Dome', 'moving', 33870, [0.243, 0.826, 0.824], [0.367, 0.505, -0.000], 0.410, 'x', 0.336, 0.03),
    P(4, 'Motor Rear Plug', 'static', 7432, [0.096, 0.551, 0.565], [-0.409, 0.406, -0.000], 0.282, 'x', 0.346, 0.04),
    P(5, 'Surround Ring', 'deformable', 8273, [0.153, 0.934, 0.890], [0.334, 0.489, -0.002], 0.443, 'x', 0.041, 0.82),
    P(6, 'Side Vent L-Upper', 'static', 1513, [0.150, 0.073, 0.052], [0.021, 0.474, -0.336], 0.078, 'x', 0.307, 0.16),
    P(7, 'Side Vent L-Lower', 'static', 1461, [0.145, 0.067, 0.057], [0.038, 0.396, -0.337], 0.073, 'x', 0.342, 0.04),
    P(8, 'Side Vent R-Upper', 'static', 1299, [0.149, 0.068, 0.051], [0.022, 0.468, 0.340], 0.076, 'x', 0.302, 0.10),
    P(9, 'Side Vent R-Lower', 'static', 1188, [0.157, 0.064, 0.049], [0.036, 0.398, 0.338], 0.079, 'x', 0.318, 0.07),
    P(10, 'Trim Detail A', 'static', 600, [0.034, 0.118, 0.073], [0.302, 0.681, 0.407], 0.037, 'y', 0.323, 0.13),
    P(11, 'Trim Detail B', 'static', 521, [0.030, 0.137, 0.058], [0.310, 0.678, -0.399], 0.029, 'y', 0.410, 0.05),
    P(12, 'Terminal Badge', 'static', 416, [0.029, 0.087, 0.054], [0.302, 0.686, -0.386], 0.028, 'x', 0.429, 0.03),
    P(13, 'Top Control Strip', 'static', 310, [0.007, 0.038, 0.282], [0.247, 0.967, 0.048], 0.141, 'x', 0.532, 0.05),
    P(14, 'Micro Detail', 'static', 17, [0.001, 0.006, 0.025], [0.310, 0.905, -0.186], 0.013, 'z', 0.432, 0.08),
  ];
  return parts;
}

export function defaultGroups(): MotionGroupConfig[] {
  const g = makeGroup('g1', 'Cone Assembly', ['p2', 'p3']);
  // Pivot at cone apex region (from measured geometry): cone center x=0.332
  g.pivot = [0.30, 0.496, 0.0];
  g.axis = 'x';
  g.mode = 'D';
  return [g];
}

export function defaultProject(name = 'Untitled Project'): ProjectData {
  const now = new Date().toISOString();
  return {
    schema: 'sonivex-project',
    version: SCHEMA_VERSION,
    name,
    createdAt: now,
    modifiedAt: now,
    units: 'metric',
    model: { filePath: null, fileName: null, format: 'procedural' },
    parts: defaultPartsForTripo(),
    groups: defaultGroups(),
    driver: defaultDriver(),
    box: defaultBox(),
    amp: defaultAmp(),
    analysis: defaultAnalysis(),
    view: {
      projection: 'perspective', shading: 'shaded', explode: 0,
      showGrid: true, autoRotate: false,
    },
    audio: { filePath: null, fileName: null },
  };
}

/** Defensive validation when loading .svx files (never trust external JSON). */
export function sanitizeProject(raw: unknown): { ok: true; project: ProjectData } | { ok: false; error: string } {
  try {
    const p = raw as Partial<ProjectData>;
    if (!p || typeof p !== 'object') return { ok: false, error: 'Not an object' };
    if (p.schema !== 'sonivex-project') return { ok: false, error: 'Unrecognized project schema' };
    const base = defaultProject();
    const out: ProjectData = {
      ...base,
      ...p,
      version: SCHEMA_VERSION,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : base.createdAt,
      modifiedAt: new Date().toISOString(),
      model: { ...base.model, ...(p.model || {}) },
      driver: { ...base.driver, ...(p.driver || {}) },
      box: { ...base.box, ...(p.box || {}) },
      amp: { ...base.amp, ...(p.amp || {}) },
      analysis: { ...base.analysis, ...(p.analysis || {}) },
      view: { ...base.view, ...(p.view || {}) },
      audio: { ...base.audio, ...(p.audio || {}) },
      parts: Array.isArray(p.parts) && p.parts.length > 0
        ? p.parts.map((part, i) => ({
            ...makePart(part.id ?? `p${i}`, String(part.name ?? `Part ${i + 1}`),
              String(part.sourceName ?? `part_${i}`), Number(part.meshIndex ?? i),
              (['static', 'moving', 'deformable', 'unknown'] as const).includes(part.role as never) ? (part.role as PartInfo['role']) : 'unknown',
              { ...(base.parts[0]?.metrics ?? emptyMetrics()), ...((part as PartInfo).metrics || {}) },
            ),
            visible: part.visible !== false, locked: part.locked === true,
            enabledForMotion: part.enabledForMotion === true,
            groupId: typeof part.groupId === 'string' ? part.groupId : null,
          }))
        : base.parts,
      groups: Array.isArray(p.groups)
        ? p.groups.map((g, i) => ({ ...makeGroup(g.id ?? `g${i + 1}`, String(g.name ?? `Group ${i + 1}`), Array.isArray(g.partIds) ? g.partIds.map(String) : []), ...g, id: g.id ?? `g${i + 1}` }))
        : base.groups,
    };
    // numeric sanity clamps
    clampNum(out.driver, 'fsHz', 5, 200); clampNum(out.driver, 'qes', 0.1, 3); clampNum(out.driver, 'qms', 0.5, 30);
    clampNum(out.driver, 'vasL', 1, 3000); clampNum(out.driver, 'reOhm', 0.5, 64); clampNum(out.driver, 'xmaxMM', 0.1, 80);
    clampNum(out.driver, 'effectiveDiameterCM', 2, 100);
    clampNum(out.amp, 'voltageRMS', 0.5, 200); clampNum(out.amp, 'nominalOhm', 1, 16);
    clampNum(out.box, 'wCM', 8, 300); clampNum(out.box, 'hCM', 8, 300); clampNum(out.box, 'dCM', 8, 300);
    return { ok: true, project: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function emptyMetrics(): PartMetrics {
  return { vertexCount: 0, triangleCount: 0, sizeM: [0, 0, 0], centerM: [0, 0, 0], radiusMaxM: 0, symmetryAxis: 'z', symmetryCV: 1, rMinOverRMax: 0 };
}

function clampNum(o: object, key: string, min: number, max: number): void {
  const rec = o as Record<string, unknown>;
  const v = Number(rec[key]);
  if (!Number.isFinite(v)) { rec[key] = min; return; }
  rec[key] = Math.min(max, Math.max(min, v));
}

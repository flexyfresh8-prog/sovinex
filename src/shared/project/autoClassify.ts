/**
 * Geometry-driven part auto-classification.
 * Pure logic on PartMetrics — unit-testable without three.js.
 *
 * Heuristics (never trusted blindly — user can always override):
 *  - dominant size + low symmetry → enclosure (static)
 *  - thin ring (rMin/rMax > 0.55, shallow) → surround (deformable)
 *  - axisymmetric, reaches axis, shallow → dome/cap (moving)
 *  - axisymmetric with large depth/diameter → cone candidate (moving)
 *  - small long cylinders → port/vent (static)
 *  - tiny parts → trim/detail (static)
 */
import { PartMetrics, PartRole } from '../types';

export interface ClassifiedPart {
  meshIndex: number;
  role: PartRole;
  suggestedName: string;
  confidence: number;
}

export function autoClassify(metrics: PartMetrics[]): ClassifiedPart[] {
  const n = metrics.length;
  const results: ClassifiedPart[] = metrics.map((m, i) => classifyOne(m, i, n));
  // guarantee exactly one largest → enclosure if none assigned
  if (!results.some((r) => r.suggestedName.toLowerCase().includes('enclosure'))) {
    let biggest = 0, bigVol = -1;
    metrics.forEach((m, i) => {
      const vol = m.sizeM[0] * m.sizeM[1] * m.sizeM[2];
      if (vol > bigVol) { bigVol = vol; biggest = i; }
    });
    if (results[biggest] && metrics[biggest].symmetryCV > 0.15) {
      results[biggest] = { meshIndex: biggest, role: 'static', suggestedName: 'Enclosure', confidence: 0.9 };
    }
  }
  return results;
}

function classifyOne(m: PartMetrics, index: number, total: number): ClassifiedPart {
  const [sx, sy, sz] = m.sizeM;
  const vol = sx * sy * sz;
  const maxDim = Math.max(sx, sy, sz);
  const ringness = m.rMinOverRMax;
  const depth = m.sizeM[{ x: 0, y: 1, z: 2 }[m.symmetryAxis]];
  const dia = m.radiusMaxM * 2;
  const depthRatio = depth / Math.max(dia, 1e-6);
  const sym = m.symmetryCV;

  // biggest, box-like → enclosure
  if (sym > 0.15 && vol > 0.02) {
    return { meshIndex: index, role: 'static', suggestedName: 'Enclosure', confidence: 0.85 };
  }
  // thin ring → surround roll
  if (ringness > 0.55 && depthRatio < 0.35 && sym < 0.12) {
    return { meshIndex: index, role: 'deformable', suggestedName: 'Surround Ring', confidence: 0.6 };
  }
  // reaches axis, shallow dome → dust cap
  if (ringness < 0.35 && depthRatio < 0.22 && sym < 0.2 && dia > 0.05) {
    return { meshIndex: index, role: 'moving', suggestedName: 'Dust Cap / Dome', confidence: 0.55 };
  }
  // deep axisymmetric shell → cone
  if (sym < 0.12 && depthRatio >= 0.22 && depthRatio < 1.2 && dia > 0.15) {
    return { meshIndex: index, role: 'moving', suggestedName: 'Cone', confidence: 0.5 };
  }
  // small long cylinder → vent/port
  if (depthRatio > 1.4 && dia < 0.12) {
    return { meshIndex: index, role: 'static', suggestedName: 'Vent / Port', confidence: 0.5 };
  }
  // small solid disc → motor element
  if (ringness < 0.3 && sym < 0.4 && dia < 0.6 && dia > 0.04) {
    return { meshIndex: index, role: 'static', suggestedName: 'Motor Element', confidence: 0.4 };
  }
  // tiny → detail
  if (maxDim < 0.05 || m.vertexCount < 60) {
    return { meshIndex: index, role: 'static', suggestedName: `Detail ${index + 1}`, confidence: 0.35 };
  }
  return { meshIndex: index, role: 'unknown', suggestedName: `Part ${index + 1}`, confidence: 0.2 };
}

/**
 * Apply user knowledge: for Tripo models, part #3 (tripo_part_2, 0-based index 2)
 * is the cone per the owner's specification.
 */
export function applyKnownTripoLayout(metrics: PartMetrics[], classified: ClassifiedPart[]): ClassifiedPart[] {
  const out = [...classified];
  if (metrics.length === 15 && out[2]) {
    out[2] = { meshIndex: 2, role: 'moving', suggestedName: 'Cone', confidence: 1.0 };
    // nearest deep axisymmetric neighbor → dust cap candidate stays as classified
    if (out[5] && out[5].suggestedName === 'Surround Ring') {
      out[5] = { ...out[5], confidence: 0.75 };
    }
  }
  return out;
}

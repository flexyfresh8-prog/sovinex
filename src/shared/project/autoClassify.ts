/**
 * Geometry-driven part auto-classification.
 * Pure logic on PartMetrics — unit-testable without three.js.
 *
 * Verified against the user's real 15-part Tripo model
 * (upload/loudspeaker 3d model.glb, radial scans + rendered inspection):
 *   idx 0  basket/frame   (deep dish w/ mounting tabs, symCV 0.22, vol max)
 *   idx 1  ring magnet    (thick deep annulus, rMin/rMax 0.62)
 *   idx 2  surround ring  (thin wide annulus rMin/rMax 0.83, wraps cone edge)
 *   idx 3  CONE           (dish reaching the axis, rMin/rMax 0.03, depth/dia 0.29)
 *   idx 4  motor back cap (dish, but axially far behind the cone)
 *   idx 5  gasket ring    (thin annulus at the front rim)
 *   idx 6-9  pole-vent/spacer cylinders (static)
 *   idx 10-14 trim, terminal, tinsel lead details (static)
 *
 * Heuristics (never trusted blindly — user can always override):
 *  - dominant size + low symmetry → basket/frame or enclosure (static)
 *  - dish reaching the axis, moderate depth → cone (moving)
 *  - thin wide annulus matching the cone's outer radius → surround (deformable)
 *  - dish near the cone axially, small → dust cap (moving); far → motor element
 *  - thick deep annulus → motor element (ring magnet / plates)
 *  - small long cylinders → vent/spacer (static)
 *  - tiny parts → trim/detail (static)
 */
import { PartMetrics, PartRole } from '../types';

export interface ClassifiedPart {
  meshIndex: number;
  role: PartRole;
  suggestedName: string;
  confidence: number;
}

const axisIdx = { x: 0, y: 1, z: 2 } as const;

/** Depth along the symmetry axis divided by the largest radial diameter. */
function depthRatio(m: PartMetrics): number {
  const dia = m.radiusMaxM * 2;
  return m.sizeM[axisIdx[m.symmetryAxis]] / Math.max(dia, 1e-6);
}

export function autoClassify(metrics: PartMetrics[]): ClassifiedPart[] {
  const n = metrics.length;
  let maxVol = 0;
  for (const m of metrics) maxVol = Math.max(maxVol, m.sizeM[0] * m.sizeM[1] * m.sizeM[2]);
  const results: ClassifiedPart[] = metrics.map((m, i) => classifyOne(m, i, n, maxVol));

  // ---- relational refinement ----
  // Pick the cone: among dish candidates prefer the one whose outer radius best
  // matches the inner radius of the largest thin ring (the surround wraps it),
  // then the one axially closest to that ring.
  const rings = results.filter((r) => r.suggestedName === 'Surround Ring');
  const cones = results.filter((r) => r.suggestedName === 'Cone');
  if (cones.length > 1) {
    let bestRing: PartMetrics | null = null;
    let bestInner = -1;
    for (const r of rings) {
      const m = metrics[r.meshIndex];
      const inner = m.rMinOverRMax * m.radiusMaxM;
      if (inner > bestInner) { bestInner = inner; bestRing = m; }
    }
    const score = (m: PartMetrics) =>
      (bestRing ? Math.abs(m.radiusMaxM - bestInner) : 0);
    const ranked = [...cones].sort((a, b) => {
      const ma = metrics[a.meshIndex], mb = metrics[b.meshIndex];
      return score(ma) - score(mb) ||
        (bestRing ? Math.abs(ma.centerM[axisIdx[ma.symmetryAxis]] - bestRing.centerM[axisIdx[bestRing.symmetryAxis]])
                  - Math.abs(mb.centerM[axisIdx[mb.symmetryAxis]] - bestRing.centerM[axisIdx[bestRing.symmetryAxis]])
                  : 0);
    });
    const winner = ranked[0];
    const cmWin = metrics[winner.meshIndex];
    const winDepth = cmWin.sizeM[axisIdx[cmWin.symmetryAxis]];
    for (const c of cones) {
      if (c === winner) continue;
      const m = metrics[c.meshIndex];
      const d = Math.abs(m.centerM[axisIdx[m.symmetryAxis]] - cmWin.centerM[axisIdx[cmWin.symmetryAxis]]);
      // far behind/ahead of the winning cone → motor part; otherwise frame-like
      results[c.meshIndex] = d > winDepth * 2.2
        ? { meshIndex: c.meshIndex, role: 'static', suggestedName: 'Motor Element', confidence: 0.5 }
        : { meshIndex: c.meshIndex, role: 'static', suggestedName: 'Basket / Frame', confidence: 0.45 };
    }
  }

  // Dust caps must sit near the cone axially; far dishes are motor parts.
  const cone = results.find((r) => r.suggestedName === 'Cone');
  if (cone) {
    const cm = metrics[cone.meshIndex];
    const coneDepth = cm.sizeM[axisIdx[cm.symmetryAxis]];
    for (const r of results) {
      if (r.suggestedName !== 'Dust Cap / Dome') continue;
      const m = metrics[r.meshIndex];
      const d = Math.abs(m.centerM[axisIdx[m.symmetryAxis]] - cm.centerM[axisIdx[cm.symmetryAxis]]);
      if (d > coneDepth * 2.2) {
        results[r.meshIndex] = { meshIndex: r.meshIndex, role: 'static', suggestedName: 'Motor Element', confidence: 0.5 };
      }
    }
  }

  // guarantee exactly one dominant part → basket/enclosure if none assigned
  if (!results.some((r) => r.suggestedName === 'Enclosure' || r.suggestedName === 'Basket / Frame')) {
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

function classifyOne(m: PartMetrics, index: number, total: number, maxVol: number): ClassifiedPart {
  const [sx, sy, sz] = m.sizeM;
  const vol = sx * sy * sz;
  const maxDim = Math.max(sx, sy, sz);
  const ringness = m.rMinOverRMax;
  const dr = depthRatio(m);
  const dia = m.radiusMaxM * 2;
  const sym = m.symmetryCV;

  // dominant, low-symmetry → enclosure; if it still reaches the axis it is a basket/frame.
  // A true enclosure is box-like (high ringness); an axisymmetric dish that merely has a
  // large bbox (cone shells do) must fall through to the dish rules instead.
  if (sym > 0.15 && vol > 0.02 && (ringness >= 0.3 || vol > maxVol * 0.5)) {
    const name = ringness < 0.3 ? 'Basket / Frame' : 'Enclosure';
    return { meshIndex: index, role: 'static', suggestedName: name, confidence: 0.85 };
  }
  // dish reaching the axis with moderate depth → cone candidate
  // (rolled edges / ribs raise symmetryCV, so the ceiling is generous)
  if (ringness < 0.4 && dr >= 0.14 && dr <= 0.65 && dia > 0.15 && sym < 0.45) {
    return { meshIndex: index, role: 'moving', suggestedName: 'Cone', confidence: 0.6 };
  }
  // thin wide annulus → surround candidate
  if (ringness > 0.55 && dr < 0.35) {
    return { meshIndex: index, role: 'deformable', suggestedName: 'Surround Ring', confidence: 0.6 };
  }
  // thick deep annulus → motor element (ring magnet / plates)
  if (ringness > 0.45 && dr >= 0.35 && dia > 0.15) {
    return { meshIndex: index, role: 'static', suggestedName: 'Motor Element', confidence: 0.55 };
  }
  // reaches axis, very shallow → dust cap (validated axially later)
  if (ringness < 0.35 && dr < 0.14 && sym < 0.4 && dia > 0.05) {
    return { meshIndex: index, role: 'moving', suggestedName: 'Dust Cap / Dome', confidence: 0.55 };
  }
  // small long cylinder → vent/spacer
  if (dr > 1.4 && dia < 0.12) {
    return { meshIndex: index, role: 'static', suggestedName: 'Vent / Spacer', confidence: 0.5 };
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
 * Apply user knowledge for the owner's 15-part Tripo export.
 *
 * Geometry-verified (radial scan + rendered inspection of the actual file):
 * tripo_part_3 is the cone dish; tripo_part_2 is the thin surround ring that
 * wraps it ("the bracket around the cone"). Earlier revisions misread the
 * owner's "part number 3" as 1-based tripo_part_2 — the mesh data proves
 * the cone is tripo_part_3 (0-based index 3).
 */
export function applyKnownTripoLayout(metrics: PartMetrics[], classified: ClassifiedPart[]): ClassifiedPart[] {
  const out = [...classified];
  if (metrics.length !== 15 || !out[3]) return out;
  out[3] = { meshIndex: 3, role: 'moving', suggestedName: 'Cone', confidence: 1.0 };
  if (out[2]) out[2] = { meshIndex: 2, role: 'deformable', suggestedName: 'Surround Ring', confidence: 0.9 };
  if (out[5] && out[5].suggestedName === 'Surround Ring') {
    out[5] = { meshIndex: 5, role: 'static', suggestedName: 'Gasket Ring', confidence: 0.75 };
  }
  return out;
}

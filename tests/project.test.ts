/**
 * Project schema + auto-classification tests.
 */
import { describe, it, expect } from 'vitest';
import { defaultProject, sanitizeProject, defaultPartsForTripo } from '../src/shared/project/schema';
import { autoClassify, applyKnownTripoLayout } from '../src/shared/project/autoClassify';
import { PartMetrics } from '../src/shared/types';

describe('default project', () => {
  it('has exactly 15 parts with part #3 = Cone (moving)', () => {
    const p = defaultProject();
    expect(p.parts).toHaveLength(15);
    expect(p.parts[2].name).toBe('Cone');
    expect(p.parts[2].role).toBe('moving');
  });

  it('pre-assigns a Cone Assembly motion group with moving parts', () => {
    const p = defaultProject();
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].name).toBe('Cone Assembly');
    expect(p.groups[0].partIds).toContain('p2');
    expect(p.groups[0].mode).toBe('D');
  });

  it('keeps enclosure and motor static', () => {
    const p = defaultProject();
    expect(p.parts[0].role).toBe('static');
    expect(p.parts[1].role).toBe('static');
    expect(p.parts[5].role).toBe('deformable');
  });
});

describe('sanitizeProject', () => {
  it('round-trips a serialized project', () => {
    const p = defaultProject('Test');
    const json = JSON.stringify(JSON.parse(JSON.stringify(p)));
    const r = sanitizeProject(JSON.parse(json));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.name).toBe('Test');
      expect(r.project.parts).toHaveLength(15);
      expect(r.project.groups[0].partIds).toContain('p2');
    }
  });

  it('rejects non-sonivex schemas', () => {
    expect(sanitizeProject({ schema: 'other' }).ok).toBe(false);
    expect(sanitizeProject(null).ok).toBe(false);
    expect(sanitizeProject('string').ok).toBe(false);
  });

  it('clamps insane numeric values', () => {
    const p = JSON.parse(JSON.stringify(defaultProject()));
    p.driver.fsHz = 9999;
    p.driver.qes = -5;
    p.box.wCM = 100000;
    const r = sanitizeProject(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.driver.fsHz).toBeLessThanOrEqual(200);
      expect(r.project.driver.qes).toBeGreaterThanOrEqual(0.1);
      expect(r.project.box.wCM).toBeLessThanOrEqual(300);
    }
  });

  it('preserves user part assignments', () => {
    const p = JSON.parse(JSON.stringify(defaultProject()));
    p.parts[2].name = 'My Woofer Cone';
    p.parts[2].role = 'moving';
    p.parts[4].role = 'moving';
    const r = sanitizeProject(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.parts[2].name).toBe('My Woofer Cone');
      expect(r.project.parts[4].role).toBe('moving');
    }
  });
});

// Measured metrics from the user's actual Tripo model (upload/loudspeaker 3d model.glb)
const tripoMetrics: PartMetrics[] = [
  { vertexCount: 108612, triangleCount: 206362, sizeM: [0.513, 0.854, 0.867], centerM: [0.092, 0.495, 0.001], radiusMaxM: 0.481, symmetryAxis: 'x', symmetryCV: 0.224, rMinOverRMax: 0.07 },
  { vertexCount: 47829, triangleCount: 90875, sizeM: [0.414, 0.819, 0.785], centerM: [-0.281, 0.418, 0.0], radiusMaxM: 0.408, symmetryAxis: 'x', symmetryCV: 0.087, rMinOverRMax: 0.62 },
  { vertexCount: 41509, triangleCount: 78867, sizeM: [0.186, 0.992, 1.0], centerM: [0.332, 0.496, 0.0], radiusMaxM: 0.5, symmetryAxis: 'x', symmetryCV: 0.051, rMinOverRMax: 0.83 },
  { vertexCount: 33870, triangleCount: 64353, sizeM: [0.243, 0.826, 0.824], centerM: [0.367, 0.505, -0.0], radiusMaxM: 0.41, symmetryAxis: 'x', symmetryCV: 0.336, rMinOverRMax: 0.03 },
  { vertexCount: 7432, triangleCount: 14120, sizeM: [0.096, 0.551, 0.565], centerM: [-0.409, 0.406, -0.0], radiusMaxM: 0.282, symmetryAxis: 'x', symmetryCV: 0.346, rMinOverRMax: 0.04 },
  { vertexCount: 8273, triangleCount: 15718, sizeM: [0.153, 0.934, 0.89], centerM: [0.334, 0.489, -0.002], radiusMaxM: 0.443, symmetryAxis: 'x', symmetryCV: 0.041, rMinOverRMax: 0.82 },
  { vertexCount: 1513, triangleCount: 2874, sizeM: [0.15, 0.073, 0.052], centerM: [0.021, 0.474, -0.336], radiusMaxM: 0.078, symmetryAxis: 'x', symmetryCV: 0.307, rMinOverRMax: 0.16 },
  { vertexCount: 1461, triangleCount: 2775, sizeM: [0.145, 0.067, 0.057], centerM: [0.038, 0.396, -0.337], radiusMaxM: 0.073, symmetryAxis: 'x', symmetryCV: 0.342, rMinOverRMax: 0.04 },
  { vertexCount: 1299, triangleCount: 2468, sizeM: [0.149, 0.068, 0.051], centerM: [0.022, 0.468, 0.34], radiusMaxM: 0.076, symmetryAxis: 'x', symmetryCV: 0.302, rMinOverRMax: 0.1 },
  { vertexCount: 1188, triangleCount: 2257, sizeM: [0.157, 0.064, 0.049], centerM: [0.036, 0.398, 0.338], radiusMaxM: 0.079, symmetryAxis: 'x', symmetryCV: 0.318, rMinOverRMax: 0.07 },
  { vertexCount: 600, triangleCount: 1140, sizeM: [0.034, 0.118, 0.073], centerM: [0.302, 0.681, 0.407], radiusMaxM: 0.037, symmetryAxis: 'y', symmetryCV: 0.323, rMinOverRMax: 0.13 },
  { vertexCount: 521, triangleCount: 989, sizeM: [0.03, 0.137, 0.058], centerM: [0.31, 0.678, -0.399], radiusMaxM: 0.029, symmetryAxis: 'y', symmetryCV: 0.41, rMinOverRMax: 0.05 },
  { vertexCount: 416, triangleCount: 790, sizeM: [0.029, 0.087, 0.054], centerM: [0.302, 0.686, -0.386], radiusMaxM: 0.028, symmetryAxis: 'x', symmetryCV: 0.429, rMinOverRMax: 0.03 },
  { vertexCount: 310, triangleCount: 589, sizeM: [0.007, 0.038, 0.282], centerM: [0.247, 0.967, 0.048], radiusMaxM: 0.141, symmetryAxis: 'x', symmetryCV: 0.532, rMinOverRMax: 0.05 },
  { vertexCount: 17, triangleCount: 32, sizeM: [0.001, 0.006, 0.025], centerM: [0.31, 0.905, -0.186], radiusMaxM: 0.013, symmetryAxis: 'z', symmetryCV: 0.432, rMinOverRMax: 0.08 },
];

describe('auto-classification on the real Tripo model', () => {
  it('classifies all 15 parts', () => {
    const result = autoClassify(tripoMetrics);
    expect(result).toHaveLength(15);
    result.forEach((r) => expect(['static', 'moving', 'deformable', 'unknown']).toContain(r.role));
  });

  it('classifies the basket (largest, tabbed dish) as static frame', () => {
    const result = autoClassify(tripoMetrics);
    expect(result[0].role).toBe('static');
    expect(result[0].suggestedName).toBe('Basket / Frame');
  });

  it('classifies the surround ring (index 2) as deformable, never the cone', () => {
    const result = autoClassify(tripoMetrics);
    expect(result[2].suggestedName).toBe('Surround Ring');
    expect(result[2].role).toBe('deformable');
  });

  it('geometrically identifies the cone dish at index 3 (tripo_part_3)', () => {
    const result = autoClassify(tripoMetrics);
    expect(result[3].suggestedName).toBe('Cone');
    expect(result[3].role).toBe('moving');
  });

  it('applies user knowledge: cone = tripo_part_3 (index 3), surround = index 2', () => {
    let result = autoClassify(tripoMetrics);
    result = applyKnownTripoLayout(tripoMetrics, result);
    expect(result[3].role).toBe('moving');
    expect(result[3].suggestedName).toBe('Cone');
    expect(result[3].confidence).toBe(1.0);
    expect(result[2].role).toBe('deformable');
    expect(result[2].suggestedName).toBe('Surround Ring');
  });

  it('never leaves everything moving (rest protection by default)', () => {
    let result = autoClassify(tripoMetrics);
    result = applyKnownTripoLayout(tripoMetrics, result);
    const moving = result.filter((r) => r.role === 'moving');
    expect(moving.length).toBeLessThan(15);
    expect(result[0].role).toBe('static');
  });

  it('reclassifies a deep annulus candidate away from the cone (motor cap)', () => {
    // index 4: dish metrics but sits far behind the cone (motor back cap)
    const result = autoClassify(tripoMetrics);
    expect(result[4].suggestedName).toBe('Motor Element');
    expect(result[4].role).toBe('static');
  });
});

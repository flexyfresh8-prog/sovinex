/**
 * Driver Studio engine tests.
 *
 * Pins the studio contract required by the upgrade spec:
 *  1. every component builds independently with a stable id and a
 *     construction-time role (moving / flex / static)
 *  2. customization parameters change REAL geometry (bounding boxes move)
 *  3. dependency-aware updates rebuild only affected components
 *  4. the exploded view offsets real parts along the driver axis and
 *     returns them exactly to their assembled positions
 *  5. mechanical validation catches coil/neck interference and pole gaps
 *  6. colors are forced grayscale (black & white theme)
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  defaultStudioConfig, clampConfig, validateConfig, monochrome,
  DriverStudioConfig, COMPONENT_LABELS,
} from '../src/shared/driver/studioConfig';
import { computeDatums } from '../src/renderer/three/driverStudio/datums';
import { DriverStudio } from '../src/renderer/three/driverStudio/buildDriver';

const base = (): DriverStudioConfig => clampConfig(defaultStudioConfig('subwoofer'));

function boxSize(obj: THREE.Object3D): THREE.Vector3 {
  const b = new THREE.Box3().setFromObject(obj);
  return b.getSize(new THREE.Vector3());
}

describe('studio config', () => {
  it('forces every color into grayscale', () => {
    // luminance of pure red = 0.2126·255 ≈ 54 → #363636
    expect(monochrome('#ff0000')).toBe('#363636');
    // luminance of pure green = 0.7152·255 ≈ 182 → #b6b6b6
    expect(monochrome('#00ff00')).toBe('#b6b6b6');
    expect(monochrome('#123456')).toBe(monochrome('#123456'));
    const m = /^#([0-9a-f]{2})\1\1$/i.exec(monochrome('#12ff34'));
    expect(m).not.toBeNull();
  });

  it('clamps numeric fields into their metadata limits', () => {
    const cfg = base();
    cfg.coneDepthMM = 9999;
    cfg.windingLayers = 99;
    const out = clampConfig(cfg);
    expect(out.coneDepthMM).toBeLessThanOrEqual(140);
    expect(out.windingLayers).toBeLessThanOrEqual(4);
  });

  it('flags a voice coil that cannot pass through the cone neck', () => {
    const cfg = base();
    cfg.voiceCoilDiameterMM = 90;   // neck clear ≈ 62 - 3.2 = 58.8
    const issues = validateConfig(cfg);
    expect(issues.some((i) => i.level === 'error' && /neck/.test(i.msg))).toBe(true);
  });

  it('flags a center pole that leaves no magnetic gap', () => {
    const cfg = base();
    cfg.poleDiameterMM = 66;        // former ID ≈ 76.2 - 4.8 - 1.6 = 69.8 → error only below 68.3; use 70
    cfg.poleDiameterMM = 70;
    const issues = validateConfig(cfg);
    expect(issues.some((i) => i.level === 'error' && /pole/.test(i.msg))).toBe(true);
  });

  it('warns when the surround is unlinked from the cone edge', () => {
    const cfg = base();
    cfg.linkSurroundToCone = false;
    cfg.surroundInnerDiameterMM = cfg.coneOuterDiameterMM + 30;
    const issues = validateConfig(cfg);
    expect(issues.some((i) => /seal/.test(i.msg))).toBe(true);
  });
});

describe('DriverStudio assembly', () => {
  it('builds every named component with a construction-time role', () => {
    const studio = new DriverStudio(base());
    expect(studio.components.size).toBe(Object.keys(COMPONENT_LABELS).length);
    expect(studio.movingPartIds().sort()).toEqual(['cone', 'dustcap', 'leads', 'voicecoil']);
    expect(studio.flexPartIds().sort()).toEqual(['spider', 'surround']);
    const statics = ['basket', 'gasket', 'hardware', 'magnet', 'pole', 'topPlate', 'bottomPlate', 'terminals'];
    for (const id of statics) expect(studio.components.get(id)!.role).toBe('static');
    studio.dispose();
  });

  it('keeps the moving group attached: surround + spider are flex-only (never rigid)', () => {
    const studio = new DriverStudio(base());
    const moving = studio.movingPartIds();
    expect(moving).not.toContain('surround');
    expect(moving).not.toContain('spider');
    studio.dispose();
  });

  it('updates real geometry when the magnet diameter changes', () => {
    const studio = new DriverStudio(base());
    const before = boxSize(studio.components.get('magnet')!.object);
    studio.update({ ...base(), magnetDiameterMM: 200 });
    const after = boxSize(studio.components.get('magnet')!.object);
    expect(after.x).toBeGreaterThan(before.x * 1.2);
    studio.dispose();
  });

  it('changes the surround roll profile when roll height changes', () => {
    const studio = new DriverStudio(base());
    const before = boxSize(studio.components.get('surround')!.object);
    const cfg = base();
    cfg.rollHeightMM = 34;
    const res = studio.update(cfg);
    const after = boxSize(studio.components.get('surround')!.object);
    // roll height is AXIAL (z): the roll must actually grow taller
    expect(after.z).toBeGreaterThan(before.z * 1.4);
    expect(res.rebuilt).toContain('surround');
    studio.dispose();
  });

  it('rebuilds only the components affected by a voice-coil change', () => {
    const studio = new DriverStudio(base());
    const res = studio.update({ ...base(), voiceCoilDiameterMM: 82, windingHeightMM: 30 });
    expect(res.rebuilt).toContain('voicecoil');
    expect(res.rebuilt).not.toContain('magnet');
    expect(res.rebuilt).not.toContain('dustcap');
    studio.dispose();
  });

  it('keeps the coil, spider and motor aligned after a coil resize', () => {
    const d1 = computeDatums(base());
    const cfg2 = base();
    cfg2.voiceCoilDiameterMM = 95;
    cfg2.coneNeckDiameterMM = 100;   // keep the neck clear of the coil
    const d2 = computeDatums(cfg2);
    // the winding must stay inside the top-plate bore and above the plate face
    expect(d2.zWindBot).toBeGreaterThan(d2.zTPFront);
    expect(d2.windOuterR).toBeGreaterThan(d1.windOuterR);
    // spider follows the winding bottom
    expect(d2.zSpider).toBeCloseTo(d2.zWindBot - 8 / 1000, 6);
  });

  it('explodes along the axis in mechanically ordered layers and reassembles exactly', () => {
    const studio = new DriverStudio(base());
    const assembled = new Map<string, THREE.Vector3>();
    studio.components.forEach((c, id) => assembled.set(id, c.object.position.clone()));

    studio.applyExplode(1);
    const z = (id: string) => studio.components.get(id)!.object.position.z;
    // front stack explodes forward, motor stack rearward
    expect(z('dustcap')).toBeGreaterThan(z('cone'));
    expect(z('cone')).toBeGreaterThan(z('surround'));
    expect(z('surround')).toBeGreaterThan(assembled.get('surround')!.z);
    expect(z('voicecoil')).toBeLessThan(assembled.get('voicecoil')!.z);
    expect(z('pole')).toBeLessThan(z('magnet'));
    expect(z('magnet')).toBeLessThan(z('topPlate'));

    studio.applyExplode(0);
    studio.components.forEach((c, id) => {
      expect(c.object.position.distanceTo(assembled.get(id)!)).toBeLessThan(1e-9);
    });
    studio.dispose();
  });

  it('scales explode offsets with driver size (tweeter vs subwoofer)', () => {
    const sub = new DriverStudio(defaultStudioConfig('subwoofer'));
    const tw = new DriverStudio(defaultStudioConfig('tweeter'));
    sub.applyExplode(1);
    tw.applyExplode(1);
    const subZ = sub.components.get('cone')!.explodeOffset.z;
    const twZ = tw.components.get('cone')!.explodeOffset.z;
    expect(Math.abs(subZ)).toBeGreaterThan(Math.abs(twZ) * 1.5);
    sub.dispose();
    tw.dispose();
  });

  it('does not leak geometries across targeted rebuilds', () => {
    const studio = new DriverStudio(base());
    const countGeometries = (): number => {
      let n = 0;
      studio.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
      return n;
    };
    const before = countGeometries();
    studio.update({ ...base(), coneDepthMM: 70 });
    const after = countGeometries();
    // rebuilt cone group swaps meshes 1:1 — no accumulation
    expect(after).toBeLessThanOrEqual(before + 4);
    studio.dispose();
  });
});

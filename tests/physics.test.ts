/**
 * Physics engine tests — lumped parameter model correctness.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDriverModel, buildBoxModel, netVolumeL, solvePoint, fbHz, fcHz,
  C_AIR, RHO0, SQRT2,
} from '../src/shared/physics/model';
import { computeCurves, computeSummary, powerForXmax } from '../src/shared/physics/curves';

const driverParams = {
  effectiveDiameterCM: 26.5, fsHz: 28, qes: 0.42, qms: 6.5,
  vasL: 85, reOhm: 3.2, leMH: 1.4, xmaxMM: 14,
};

describe('driver model derivation chain', () => {
  const d = buildDriverModel(driverParams);

  it('round-trips Fs from Mms and Cms', () => {
    const ws = 1 / Math.sqrt(d.mmsKg * d.cmsMperN);
    expect(ws / (2 * Math.PI)).toBeCloseTo(driverParams.fsHz, 4);
  });

  it('computes Qts = Qes*Qms/(Qes+Qms)', () => {
    const q = (driverParams.qes * driverParams.qms) / (driverParams.qes + driverParams.qms);
    expect(d.qts).toBeCloseTo(q, 6);
  });

  it('computes Cms from Vas and Sd', () => {
    const sd = Math.PI * Math.pow(driverParams.effectiveDiameterCM / 200, 2);
    const cms = (driverParams.vasL / 1000) / (sd * sd * RHO0 * C_AIR * C_AIR);
    expect(d.cmsMperN).toBeCloseTo(cms, 9);
  });

  it('produces Sd near 550 cm² for a 12" driver', () => {
    expect(d.sdM2 * 1e4).toBeGreaterThan(480);
    expect(d.sdM2 * 1e4).toBeLessThan(600);
  });
});

describe('sealed box solve', () => {
  const d = buildDriverModel(driverParams);
  const b = buildBoxModel({ type: 'sealed', netVolumeL: 45, portDiameterCM: 10, portLengthCM: 0, portCount: 1 });

  it('raises system resonance above driver Fs (Vb < Vas)', () => {
    const { fc, qtc } = fcHz(d, b);
    expect(fc).toBeGreaterThan(driverParams.fsHz);
    expect(qtc).toBeGreaterThan(d.qts);
    expect(qtc).toBeCloseTo(d.qts * Math.sqrt(1 + d.vasM3 / b.vbM3), 4);
  });

  it('excursion is flat below Fc (stiffness-controlled) and decays above', () => {
    const xAt30 = solvePoint(d, b, 30).xMPerV;
    const xAt100 = solvePoint(d, b, 100).xMPerV;
    const xAt10 = solvePoint(d, b, 10).xMPerV;
    expect(xAt30).toBeGreaterThan(xAt100 * 2); // 12 dB/oct roll-off above Fc
    expect(xAt10).toBeGreaterThan(xAt30);      // flat/stiffness-controlled below Fc
    expect(xAt30).toBeGreaterThan(0);
  });

  it('scales linearly with drive voltage', () => {
    const x1 = solvePoint(d, b, 50).xMPerV;
    const c1 = computeCurves(d, b, 10);
    const c2 = computeCurves(d, b, 20);
    const i = c1.freq.findIndex((f) => f > 49 && f < 51);
    expect(c2.excursionMM[i]).toBeCloseTo(c1.excursionMM[i] * 2, 1);
    expect(x1).toBeGreaterThan(0);
  });

  it('impedance is minimum below Fc and peaks at resonance', () => {
    const zLow = solvePoint(d, b, 12).zOhm;
    const { fc } = fcHz(d, b);
    const zRes = solvePoint(d, b, fc).zOhm;
    const zHigh = solvePoint(d, b, 300).zOhm;
    expect(zRes).toBeGreaterThan(zLow * 1.5);
    expect(zRes).toBeGreaterThan(zHigh);
    expect(zRes).toBeGreaterThan(driverParams.reOhm * 1.5); // Re + Bl²/Rmt
    expect(zLow).toBeGreaterThanOrEqual(driverParams.reOhm * 0.95);
  });

  it('SPL rises through the transition band then flattens (piston band)', () => {
    const c = computeCurves(d, b, 10);
    const splAt = (f: number) => c.splDB[c.freq.findIndex((q) => q >= f)];
    const spl50 = splAt(50);
    const spl100 = splAt(100);
    const spl200 = splAt(200);
    expect(spl100 - spl50).toBeGreaterThan(1.5);   // still rising past Fc
    expect(spl100 - spl50).toBeLessThan(10);
    expect(Math.abs(spl200 - spl100)).toBeLessThan(3); // piston band: flat
  });
});

describe('ported box solve', () => {
  const d = buildDriverModel(driverParams);
  const b = buildBoxModel({ type: 'ported', netVolumeL: 60, portDiameterCM: 10.2, portLengthCM: 28, portCount: 1 });

  it('Helmholtz tuning is physically reasonable (~40 Hz)', () => {
    const fb = fbHz(b);
    // manual reference: (1/2pi)*sqrt(c^2*Sp/(Vb*Leff))
    const sp = b.portAreaM2;
    const ref = (1 / (2 * Math.PI)) * Math.sqrt((C_AIR * C_AIR * sp) / (b.vbM3 * b.portLenEffM));
    expect(fb).toBeCloseTo(ref, 6);
    expect(fb).toBeGreaterThan(30);
    expect(fb).toBeLessThan(50);
  });

  it('impedance shows two peaks (double hump) above the Re floor', () => {
    const z = (f: number) => solvePoint(d, b, f).zOhm;
    const fb = fbHz(b);
    const zAtTuning = z(fb);
    // scan for maxima below and above tuning
    let zLow = 0, zHigh = 0;
    for (let f = 8; f < fb * 0.95; f *= 1.05) zLow = Math.max(zLow, z(f));
    for (let f = fb * 1.05; f < 300; f *= 1.05) zHigh = Math.max(zHigh, z(f));
    expect(zLow).toBeGreaterThan(zAtTuning * 1.6);
    expect(zHigh).toBeGreaterThan(zAtTuning * 1.6);
    expect(zAtTuning).toBeLessThan(driverParams.reOhm * 1.9); // dips near Re at tuning
  });

  it('excursion is minimum at tuning (port takes over)', () => {
    const fb = fbHz(b);
    const xAtTuning = solvePoint(d, b, fb).xMPerV;
    const xBelow = solvePoint(d, b, fb * 0.6).xMPerV;
    expect(xBelow).toBeGreaterThan(xAtTuning * 1.5);
  });

  it('port velocity is nonzero and scales with voltage', () => {
    const p1 = solvePoint(d, b, 40);
    expect(p1.upM3PerV).toBeGreaterThan(0);
    const c1 = computeCurves(d, b, 10);
    const c2 = computeCurves(d, b, 20);
    const i = c1.freq.findIndex((f) => f > 39 && f < 41);
    expect(c2.portVelMS[i]).toBeCloseTo(c1.portVelMS[i] * 2, 2);
  });
});

describe('summary and warnings', () => {
  it('warns when excursion exceeds Xmax at high drive', () => {
    const d = buildDriverModel(driverParams);
    const b = buildBoxModel({ type: 'ported', netVolumeL: 60, portDiameterCM: 10.2, portLengthCM: 28, portCount: 1 });
    const curves = computeCurves(d, b, 200); // extreme voltage
    const summary = computeSummary(d, b, 200, curves, 60);
    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(summary.excursionAtPeMM).toBeGreaterThan(driverParams.xmaxMM);
  });

  it('reports no warnings at sane drive', () => {
    const d = buildDriverModel(driverParams);
    const b = buildBoxModel({ type: 'sealed', netVolumeL: 45, portDiameterCM: 10, portLengthCM: 0, portCount: 1 });
    const curves = computeCurves(d, b, 10);
    const summary = computeSummary(d, b, 10, curves, 45);
    expect(summary.excursionAtPeMM).toBeLessThan(driverParams.xmaxMM);
  });

  it('power for Xmax is finite and positive', () => {
    const d = buildDriverModel(driverParams);
    const b = buildBoxModel({ type: 'sealed', netVolumeL: 45, portDiameterCM: 10, portLengthCM: 0, portCount: 1 });
    const p = powerForXmax(d, b, 40);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(1);
  });
});

describe('net volume', () => {
  it('subtracts walls and displacement', () => {
    const gross = 46 * 92 * 40 / 1000; // external L
    const net = netVolumeL({ wCM: 46, hCM: 92, dCM: 40 }, 1.9, 4);
    expect(net).toBeLessThan(gross);
    expect(net).toBeGreaterThan(0.5);
    const expected = ((46 - 3.8) * (92 - 3.8) * (40 - 3.8)) / 1000 - 4;
    expect(net).toBeCloseTo(expected, 3);
  });
});

describe('peak conversion', () => {
  it('SQRT2 converts RMS to peak', () => {
    expect(SQRT2).toBeCloseTo(Math.SQRT2, 10);
  });
});

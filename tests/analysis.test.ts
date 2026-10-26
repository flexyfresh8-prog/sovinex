/**
 * Audio analysis tests — FFT correctness, band extraction, signed waveform.
 */
import { describe, it, expect } from 'vitest';
import { FFT, hannWindow } from '../src/shared/audio/fft';
import { analyzeTrack, ANALYSIS_SR } from '../src/shared/audio/analysis';
import { buildDriverModel, buildBoxModel } from '../src/shared/physics/model';
import { TrackAnalysis } from '../src/shared/types';

describe('FFT', () => {
  it('forward+inverse round-trips a signal', () => {
    const n = 1024;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const ref = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ref[i] = Math.sin(2 * Math.PI * 13 * i / n) + 0.3 * Math.cos(2 * Math.PI * 61 * i / n);
      re[i] = ref[i];
    }
    fft.forward(re, im);
    fft.inverse(re, im);
    let maxErr = 0;
    for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(re[i] - ref[i]));
    expect(maxErr).toBeLessThan(1e-9);
  });

  it('detects a single tone in the correct bin', () => {
    const n = 1024;
    const fft = new FFT(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(2 * Math.PI * 10 * i / n);
    fft.forward(re, im);
    let peakK = 0, peakM = 0;
    for (let k = 0; k < n / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (m > peakM) { peakM = m; peakK = k; }
    }
    expect(peakK).toBe(10);
  });

  it('hann window is symmetric and positive', () => {
    const w = hannWindow(64);
    expect(w[0]).toBeCloseTo(0, 6);
    expect(w[32]).toBeCloseTo(1, 4);
    expect(w[1]).toBeCloseTo(w[63], 6);
  });
});

function makeDriverBox() {
  const driver = buildDriverModel({
    effectiveDiameterCM: 26.5, fsHz: 28, qes: 0.42, qms: 6.5,
    vasL: 85, reOhm: 3.2, leMH: 1.4, xmaxMM: 14,
  });
  const box = buildBoxModel({ type: 'ported', netVolumeL: 60, portDiameterCM: 10.2, portLengthCM: 28, portCount: 1 });
  return { driver, box };
}

function sineTrack(freq: number, seconds: number, amp = 0.5): Float32Array {
  const n = ANALYSIS_SR * seconds;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * i / ANALYSIS_SR);
  return out;
}

describe('analyzeTrack', () => {
  it('assigns a 40 Hz sine to the sub band, not upper bass', () => {
    const { driver, box } = makeDriverBox();
    const t = analyzeTrack({ mono: sineTrack(40, 6), sampleRate: ANALYSIS_SR, driver, box, voltsRMS: 20 });
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(t.subRMS) + mean(t.bassRMS)).toBeGreaterThan(mean(t.upperRMS) * 5);
  });

  it('produces signed (oscillating) physics excursion for a low sine', () => {
    const { driver, box } = makeDriverBox();
    const t = analyzeTrack({ mono: sineTrack(32, 6), sampleRate: ANALYSIS_SR, driver, box, voltsRMS: 20 });
    let hasPos = false, hasNeg = false;
    for (let i = 10; i < t.frameCount - 10; i++) {
      if (t.excursionM[i] > 1e-6) hasPos = true;
      if (t.excursionM[i] < -1e-6) hasNeg = true;
    }
    expect(hasPos).toBe(true);
    expect(hasNeg).toBe(true);
  });

  it('silent track → near-zero excursion', () => {
    const { driver, box } = makeDriverBox();
    const t = analyzeTrack({ mono: new Float32Array(ANALYSIS_SR * 4), sampleRate: ANALYSIS_SR, driver, box, voltsRMS: 20 });
    let maxAbs = 0;
    for (let i = 0; i < t.frameCount; i++) maxAbs = Math.max(maxAbs, Math.abs(t.excursionM[i]));
    expect(maxAbs).toBeLessThan(1e-4);
  });

  it('higher drive voltage → proportionally larger excursion', () => {
    const { driver, box } = makeDriverBox();
    const t1 = analyzeTrack({ mono: sineTrack(40, 4), sampleRate: ANALYSIS_SR, driver, box, voltsRMS: 10 });
    const t2 = analyzeTrack({ mono: sineTrack(40, 4), sampleRate: ANALYSIS_SR, driver, box, voltsRMS: 20 });
    let p1 = 0, p2 = 0;
    for (let i = 0; i < t1.frameCount; i++) { p1 = Math.max(p1, Math.abs(t1.excursionM[i])); p2 = Math.max(p2, Math.abs(t2.excursionM[i])); }
    expect(p2).toBeGreaterThan(p1 * 1.7);
    expect(p2).toBeLessThan(p1 * 2.3);
  });

  it('frame timing is position-based and fps is stable', () => {
    const { driver, box } = makeDriverBox();
    const t = analyzeTrack({ mono: sineTrack(45, 4), sampleRate: ANALYSIS_SR, driver, box, voltsRMS: 20 });
    expect(t.fps).toBeCloseTo(ANALYSIS_SR / 128, 2);
    expect(t.frameCount).toBeGreaterThan(4 * t.fps * 0.9);
    expect(t.durationSec).toBeCloseTo(4, 1);
  });

  it('computes port velocity for ported box and zero for sealed', () => {
    const driver = buildDriverModel({
      effectiveDiameterCM: 26.5, fsHz: 28, qes: 0.42, qms: 6.5,
      vasL: 85, reOhm: 3.2, leMH: 1.4, xmaxMM: 14,
    });
    const ported = buildBoxModel({ type: 'ported', netVolumeL: 60, portDiameterCM: 10.2, portLengthCM: 28, portCount: 1 });
    const sealed = buildBoxModel({ type: 'sealed', netVolumeL: 60, portDiameterCM: 10.2, portLengthCM: 28, portCount: 1 });
    const tp: TrackAnalysis = analyzeTrack({ mono: sineTrack(40, 4), sampleRate: ANALYSIS_SR, driver, box: ported, voltsRMS: 20 });
    const ts: TrackAnalysis = analyzeTrack({ mono: sineTrack(40, 4), sampleRate: ANALYSIS_SR, driver, box: sealed, voltsRMS: 20 });
    let mp = 0, ms = 0;
    for (let i = 0; i < tp.frameCount; i++) { mp = Math.max(mp, tp.portVelocity[i]); ms = Math.max(ms, ts.portVelocity[i]); }
    expect(mp).toBeGreaterThan(0.5);
    expect(ms).toBe(0);
  });

  it('band SPL coefficients produce plausible SPL for a full-scale sine', () => {
    const { driver, box } = makeDriverBox();
    const t = analyzeTrack({ mono: sineTrack(40, 4, 0.9), sampleRate: ANALYSIS_SR, driver, box, voltsRMS: 20 });
    // integrate manually at frame 100
    let p2 = 0;
    for (let bi = 0; bi < 6; bi++) {
      const v = t.bandRMS[100 * 6 + bi] * t.calibrationVoltsPerUnit;
      p2 += (t.bandSPLCoef[bi] * v) ** 2;
    }
    const spl = 20 * Math.log10(Math.sqrt(p2) / 20e-6);
    expect(spl).toBeGreaterThan(60);
    expect(spl).toBeLessThan(140);
  });
});

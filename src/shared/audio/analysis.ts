/**
 * Offline audio analysis pipeline.
 *
 * Converts raw mono PCM into per-frame motion signals:
 *  - signed low-band waveform reconstruction (mode A)
 *  - asymmetric bass envelope (mode B)
 *  - per-band RMS levels incl. 6 selectable bands (mode C)
 *  - physics excursion through the driver/box transfer function |Hx(f)|·e^{jφ(f)} (mode D)
 *  - port air velocity through the port transfer function
 *
 * All results are position-based (frame index = time), so playback can be
 * pause/seek/loop-perfect with zero drift.
 */
import { FFT, hannWindow } from './fft';
import { DriverModel, BoxModel, excursionTransfer, portTransfer, RHO0 } from '../physics/model';
import { TrackAnalysis } from '../types';

export const FRAME_WINDOW = 1024;   // analysis window samples @ analysis SR (8000 Hz) = 128 ms
export const FFT_SIZE = 1024;      // 7.8 Hz bin spacing @ 8k
export const HOP = 128;             // 62.5 fps @ 8k
export const ANALYSIS_SR = 8000;

const BANDS: [number, number][] = [
  [20, 40], [40, 63], [63, 100], [100, 160], [160, 250], [250, 400],
];
export const SUB = [20, 60] as const;
export const BASS = [60, 120] as const;
export const UPPER = [120, 250] as const;
export const LOWSPAN = [15, 300] as const;

export interface AnalysisInput {
  mono: Float32Array;   // mono mixdown
  sampleRate: number;
  driver: DriverModel;
  box: BoxModel;
  voltsRMS: number;
}

/**
 * Analyze a track. Heavy but linear; a 4-minute 48 kHz track takes
 * roughly 10k frames * (2 FFTs of 16k) ≈ fast enough for a one-time import pass.
 */
export function analyzeTrack(input: AnalysisInput): TrackAnalysis {
  const { mono, sampleRate, driver, box, voltsRMS } = input;
  const fft = new FFT(FFT_SIZE);
  const win = hannWindow(FRAME_WINDOW);
  const winGain = 1 / (FRAME_WINDOW / 2 / 1.637); // ~coherent gain correction to RMS

  const frameCount = Math.max(1, Math.floor((mono.length - FRAME_WINDOW) / HOP) + 1);
  const fps = sampleRate / HOP;

  // Precompute per-bin physics weighting (magnitude + phase) once per import.
  const bins = FFT_SIZE / 2 + 1;
  const hRe = new Float64Array(bins);
  const hIm = new Float64Array(bins);
  const pRe = new Float64Array(bins);
  const pIm = new Float64Array(bins);
  const binHz = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    const f = (k * sampleRate) / FFT_SIZE;
    binHz[k] = f;
    const hx = excursionTransfer(driver, box, Math.max(f, 1));
    hRe[k] = hx.mag * Math.cos(hx.phase);
    hIm[k] = hx.mag * Math.sin(hx.phase);
    const hp = portTransfer(driver, box, Math.max(f, 1));
    pRe[k] = hp.mag * Math.cos(hp.phase);
    pIm[k] = hp.mag * Math.sin(hp.phase);
  }

  // Calibration: find 95th percentile bass RMS over coarse pass → maps to voltsRMS.
  const coarseHop = 4096;
  const bassLevels: number[] = [];
  const reBuf = new Float64Array(FFT_SIZE);
  const imBuf = new Float64Array(FFT_SIZE);
  const mag = new Float64Array(bins);
  const applyWindowFFT = (offset: number) => {
    for (let i = 0; i < FFT_SIZE; i++) {
      reBuf[i] = i < FRAME_WINDOW ? (mono[offset + i] || 0) * win[i] : 0;
      imBuf[i] = 0;
    }
    fft.forward(reBuf, imBuf);
    for (let k = 0; k < bins; k++) {
      mag[k] = Math.hypot(reBuf[k], imBuf[k]) * 2; // single-sided
    }
  };
  const bandRMSFromMag = (fLo: number, fHi: number): number => {
    const k0 = Math.max(1, Math.ceil((fLo * FFT_SIZE) / sampleRate));
    const k1 = Math.min(bins - 1, Math.floor((fHi * FFT_SIZE) / sampleRate));
    let s = 0, n = 0;
    for (let k = k0; k <= k1; k++) { s += mag[k] * mag[k]; n++; }
    return n ? Math.sqrt(s / n / (FRAME_WINDOW / 2)) * winGain : 0;
  };

  for (let off = 0; off + FRAME_WINDOW <= mono.length; off += coarseHop) {
    applyWindowFFT(off);
    bassLevels.push(bandRMSFromMag(BASS[0], BASS[1]) + bandRMSFromMag(SUB[0], SUB[1]));
  }
  bassLevels.sort((a, b) => a - b);
  const p95 = bassLevels.length ? bassLevels[Math.floor(bassLevels.length * 0.95)] : 0.01;
  // volts per (track bass RMS unit)
  const cal = voltsRMS / Math.max(p95, 1e-6);

  const excursionM = new Float32Array(frameCount);
  const waveform = new Float32Array(frameCount);
  const envelope = new Float32Array(frameCount);
  const subRMS = new Float32Array(frameCount);
  const bassRMS = new Float32Array(frameCount);
  const upperRMS = new Float32Array(frameCount);
  const fullRMS = new Float32Array(frameCount);
  const bandRMS = new Float32Array(frameCount * BANDS.length);
  const portVel = new Float32Array(frameCount);

  // reusable inverse buffers for physics + waveform reconstruction
  const invRe = new Float64Array(FFT_SIZE);
  const invIm = new Float64Array(FFT_SIZE);

  for (let fi = 0; fi < frameCount; fi++) {
    const off = fi * HOP;
    applyWindowFFT(off);

    subRMS[fi] = bandRMSFromMag(SUB[0], SUB[1]);
    bassRMS[fi] = bandRMSFromMag(BASS[0], BASS[1]);
    upperRMS[fi] = bandRMSFromMag(UPPER[0], UPPER[1]);
    fullRMS[fi] = bandRMSFromMag(20, Math.min(20000, sampleRate / 2 - 100));
    for (let bi = 0; bi < BANDS.length; bi++) {
      bandRMS[fi * BANDS.length + bi] = bandRMSFromMag(BANDS[bi][0], BANDS[bi][1]);
    }

    // ---- Mode A: signed low-band waveform (flat magnitude preserve, 15-300 Hz)
    for (let i = 0; i < FFT_SIZE; i++) { invRe[i] = 0; invIm[i] = 0; }
    {
      const k0 = Math.max(1, Math.ceil((LOWSPAN[0] * FFT_SIZE) / sampleRate));
      const k1 = Math.min(bins - 1, Math.floor((LOWSPAN[1] * FFT_SIZE) / sampleRate));
      for (let k = k0; k <= k1; k++) {
        invRe[k] = reBuf[k]; invIm[k] = imBuf[k];
        if (k > 0 && k < FFT_SIZE / 2) {
          invRe[FFT_SIZE - k] = reBuf[k]; invIm[FFT_SIZE - k] = -imBuf[k];
        }
      }
      fft.inverse(invRe, invIm);
      // signed peak of band-limited reconstruction, window-gain normalized
      waveform[fi] = invRePeakSigned(invRe, FRAME_WINDOW) * winGain * 2;
    }

    // ---- Mode D: physics excursion — weight bins by |Hx| and phase, invert
    for (let i = 0; i < FFT_SIZE; i++) { invRe[i] = 0; invIm[i] = 0; }
    {
      const k0 = Math.max(1, Math.ceil((LOWSPAN[0] * FFT_SIZE) / sampleRate));
      const k1 = Math.min(bins - 1, Math.floor((LOWSPAN[1] * FFT_SIZE) / sampleRate));
      for (let k = k0; k <= k1; k++) {
        const vr = reBuf[k], vi = imBuf[k];
        const xr = (vr * hRe[k] - vi * hIm[k]) * cal;
        const xi = (vr * hIm[k] + vi * hRe[k]) * cal;
        invRe[k] = xr; invIm[k] = xi;
        if (k > 0 && k < FFT_SIZE / 2) { invRe[FFT_SIZE - k] = xr; invIm[FFT_SIZE - k] = -xi; }
      }
      fft.inverse(invRe, invIm);
      excursionM[fi] = invRePeakSigned(invRe, FRAME_WINDOW);
      // port velocity from displacement derivative approx: v = 2π f_centroid x — computed later globally
    }

    // ---- port velocity waveform (physics): weight bins by |Hp|
    if (box.type === 'ported') {
      for (let i = 0; i < FFT_SIZE; i++) { invRe[i] = 0; invIm[i] = 0; }
      const k0 = Math.max(1, Math.ceil((LOWSPAN[0] * FFT_SIZE) / sampleRate));
      const k1 = Math.min(bins - 1, Math.floor((LOWSPAN[1] * FFT_SIZE) / sampleRate));
      for (let k = k0; k <= k1; k++) {
        const vr = reBuf[k], vi = imBuf[k];
        const pr = (vr * pRe[k] - vi * pIm[k]) * cal;
        const pi = (vr * pIm[k] + vi * pRe[k]) * cal;
        invRe[k] = pr; invIm[k] = pi;
        if (k > 0 && k < FFT_SIZE / 2) { invRe[FFT_SIZE - k] = pr; invIm[FFT_SIZE - k] = -pi; }
      }
      fft.inverse(invRe, invIm);
      // velocity = d(displacement)/dt — but here Hp already gives volume velocity;
      // convert volume velocity → air speed: u = Up/Sp. Peak signed / area:
      let peak = 0;
      for (let i = 0; i < FRAME_WINDOW; i++) peak = Math.max(peak, Math.abs(invRe[i]));
      portVel[fi] = (peak / Math.max(box.portAreaM2, 1e-9));
    }

    // ---- Mode B: asymmetric envelope from sub+bass RMS
    const bass = subRMS[fi] + bassRMS[fi];
    envelope[fi] = bass;
  }

  // Smooth envelope (one-pole attack/release)
  {
    const atk = 0.55, rel = 0.12;
    let y = 0;
    for (let i = 0; i < frameCount; i++) {
      const x = envelope[i];
      y = x > y ? y + (x - y) * atk : y + (x - y) * rel;
      envelope[i] = y;
    }
  }

  // Velocity & acceleration from excursion timeline (per-frame finite diff), light smoothing
  const velocity = new Float32Array(frameCount);
  const acceleration = new Float32Array(frameCount);
  const dt = 1 / fps;
  for (let i = 0; i < frameCount - 1; i++) velocity[i] = (excursionM[i + 1] - excursionM[i]) / dt;
  if (frameCount > 1) velocity[frameCount - 1] = velocity[frameCount - 2] || 0;
  for (let i = 0; i < frameCount - 1; i++) acceleration[i] = (velocity[i + 1] - velocity[i]) / dt;
  if (frameCount > 1) acceleration[frameCount - 1] = acceleration[frameCount - 2] || 0;
  smooth3(velocity); smooth3(velocity);
  smooth3(acceleration); smooth3(acceleration);

  // Waveform display peaks (per ~2048 samples)
  const colCount = Math.max(1, Math.floor(mono.length / 2048));
  const peaksMin = new Float32Array(colCount);
  const peaksMax = new Float32Array(colCount);
  for (let c = 0; c < colCount; c++) {
    let mn = 0, mx = 0;
    const s = c * 2048, e = Math.min(s + 2048, mono.length);
    for (let i = s; i < e; i++) { if (mono[i] < mn) mn = mono[i]; if (mono[i] > mx) mx = mono[i]; }
    peaksMin[c] = mn; peaksMax[c] = mx;
  }

  // stats
  const sortedBass = Array.from(bassRMS).concat(Array.from(subRMS)).sort((a, b) => a - b);
  const bassP95 = sortedBass.length ? sortedBass[Math.floor(sortedBass.length * 0.95)] : 0;
  let fullPeak = 0;
  for (let i = 0; i < frameCount; i++) fullPeak = Math.max(fullPeak, fullRMS[i]);
  let sumSq = 0;
  for (let i = 0; i < frameCount; i++) sumSq += fullRMS[i] * fullRMS[i];
  const lufsApprox = 20 * Math.log10(Math.max(Math.sqrt(sumSq / Math.max(frameCount, 1)), 1e-6)) - 0.691;
  let bassPeak = 0, bassMean = 1e-9;
  for (let i = 0; i < frameCount; i++) { bassPeak = Math.max(bassPeak, bassRMS[i] + subRMS[i]); bassMean += bassRMS[i] + subRMS[i]; }
  bassMean /= Math.max(frameCount, 1);

  return {
    sampleRate, durationSec: mono.length / sampleRate, hop: HOP, fps, frameCount,
    excursionM, waveform, envelope, subRMS, bassRMS, upperRMS, fullRMS,
    bandRMS, bandEdges: [20, 40, 63, 100, 160, 250, 400],
    bandCenterHz: BANDS.map(([lo, hi]) => Math.sqrt(lo * hi)),
    bandSPLCoef: BANDS.map(([lo, hi]) => {
      const fc = Math.sqrt(lo * hi);
      const hx = excursionTransfer(driver, box, fc).mag; // m RMS per V RMS
      // p_rms = rho0 * f * U / 2 ; U = Sd * (2*pi*f) * x_rms ; x = |Hx| * V
      return (RHO0 * fc * fc * driver.sdM2 * 2 * Math.PI * hx) / 2;
    }),
    velocity, acceleration, portVelocity: portVel,
    peaksMin, peaksMax,
    stats: {
      bassP95, fullPeak,
      integratedLUFSapprox: lufsApprox,
      crestBass: bassPeak / bassMean,
    },
    calibrationVoltsPerUnit: cal,
  };
}

function invRePeakSigned(re: Float64Array, n: number): number {
  let val = 0, mag = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(re[i]); if (a > mag) { mag = a; val = re[i]; } }
  return val;
}

function smooth3(a: Float32Array): void {
  let prev = a[0];
  for (let i = 0; i < a.length; i++) {
    const cur = a[i];
    const next = a[Math.min(i + 1, a.length - 1)];
    a[i] = (prev + 2 * cur + next) / 4;
    prev = cur;
  }
}

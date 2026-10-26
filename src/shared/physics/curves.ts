/**
 * Frequency sweep curves + summary metrics for the Results workspace.
 */
import {
  DriverModel, BoxModel, solvePoint, splAtExcursion, fbHz, fcHz,
  RHO0, C_AIR, PREF, SQRT2,
} from './model';
import { PhysicsCurves, PhysicsSummary } from '../types';

export function logSweep(fMin: number, fMax: number, n: number): Float64Array {
  const out = new Float64Array(n);
  const lo = Math.log10(fMin), hi = Math.log10(fMax);
  for (let i = 0; i < n; i++) out[i] = Math.pow(10, lo + ((hi - lo) * i) / (n - 1));
  return out;
}

export function computeCurves(d: DriverModel, b: BoxModel, voltsRMS: number): PhysicsCurves {
  const freq = logSweep(10, 500, 160);
  const n = freq.length;
  const splDB = new Float64Array(n);
  const excursionMM = new Float64Array(n);
  const impedanceOhm = new Float64Array(n);
  const portVelMS = new Float64Array(n);
  const phaseDeg = new Float64Array(n);
  const splXmaxDB = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const f = freq[i];
    const p = solvePoint(d, b, f);
    splDB[i] = p.splPerV + 20 * Math.log10(Math.max(voltsRMS, 1e-6));
    excursionMM[i] = p.xMPerV * SQRT2 * voltsRMS * 1000; // peak mm
    impedanceOhm[i] = p.zOhm;
    phaseDeg[i] = (p.zPhaseRad * 180) / Math.PI;
    // port velocity: U_port RMS / area
    portVelMS[i] = b.type === 'ported' ? p.upM3PerV * voltsRMS / Math.max(b.portAreaM2, 1e-9) : 0;
    splXmaxDB[i] = splAtExcursion(d, b, f, d.xmaxM);
  }
  return { freq, splDB, excursionMM, impedanceOhm, portVelMS, phaseDeg, splXmaxDB };
}

function findF3(curves: PhysicsCurves): number {
  const { freq, splDB } = curves;
  let max = -Infinity;
  for (let i = 0; i < splDB.length; i++) max = Math.max(max, splDB[i]);
  const target = max - 3;
  for (let i = 0; i < splDB.length; i++) {
    if (splDB[i] >= target) return freq[i];
  }
  return freq[0];
}

export function computeSummary(
  d: DriverModel, b: BoxModel, voltsRMS: number, curves: PhysicsCurves,
  netVolumeL: number,
): PhysicsSummary {
  const warnings: string[] = [];
  const { fc, qtc } = fcHz(d, b);
  const fb = fbHz(b);

  let idxPeakX = 0, idxMaxPort = 0, idxMaxSpl = 0;
  for (let i = 0; i < curves.freq.length; i++) {
    if (curves.excursionMM[i] > curves.excursionMM[idxPeakX]) idxPeakX = i;
    if (curves.portVelMS[i] > curves.portVelMS[idxMaxPort]) idxMaxPort = i;
    if (curves.splDB[i] > curves.splDB[idxMaxSpl]) idxMaxSpl = i;
  }
  const excursionAtPe = curves.excursionMM[idxPeakX];
  const portVel = curves.portVelMS[idxMaxPort];
  const splAtPe = curves.splDB[idxMaxSpl];
  const maxSplXmax = Math.max(...Array.from(curves.splXmaxDB));

  if (excursionAtPe > d.xmaxM * 1000) {
    warnings.push(`Excursion ${excursionAtPe.toFixed(1)} mm exceeds Xmax (${(d.xmaxM * 1000).toFixed(1)} mm) at ${voltsRMS.toFixed(1)} V — high distortion / bottoming risk below ${(curves.freq[idxPeakX]).toFixed(0)} Hz.`);
  }
  if (b.type === 'ported' && portVel > 17) {
    warnings.push(`Port air velocity ${portVel.toFixed(1)} m/s exceeds 17 m/s chuffing threshold — enlarge port diameter or add flare.`);
  }
  if (b.type === 'ported' && fb > 0.9 * d.fsHz) {
    warnings.push(`Tuning Fb ${fb.toFixed(1)} Hz is close to driver Fs ${d.fsHz.toFixed(1)} Hz — consider lower tuning for sub-bass extension.`);
  }
  if (qtc > 1.2 && b.type === 'sealed') {
    warnings.push(`Qtc ${qtc.toFixed(2)} > 1.2 — sealed alignment is under-damped (boomy transient response).`);
  }
  if (b.type === 'sealed' && qtc < 0.5) {
    warnings.push(`Qtc ${qtc.toFixed(2)} < 0.5 — over-damped, early bass rolloff.`);
  }
  const airL = d.sdM2 * (d.xmaxM * 2) * 1000;

  return {
    fsHz: d.fsHz,
    qtcOrFbHz: b.type === 'ported' ? fb : fc,
    qtc,
    sdCM2: d.sdM2 * 1e4,
    mmsG: d.mmsKg * 1000,
    cmsMMN: d.cmsMperN * 1e6,
    blTM: d.blTM,
    rmsKgS: d.rmsMech,
    f3Hz: findF3(curves),
    volumeNetL: netVolumeL,
    portVelocityAtPeMS: portVel,
    excursionAtPeMM: excursionAtPe,
    splAtPeDB: splAtPe,
    maxSplXmaxDB: maxSplXmax,
    airVolumeDisplacedL: airL,
    warnings,
  };
}

/** Displacement-limited input power (watts) at a given frequency. */
export function powerForXmax(d: DriverModel, b: BoxModel, fHz: number): number {
  const p = solvePoint(d, b, fHz);
  if (p.xMPerV <= 1e-12) return Infinity;
  const vNeeded = (d.xmaxM / SQRT2) / p.xMPerV; // volts RMS for Xmax peak
  return (vNeeded * vNeeded) / Math.max(d.reOhm, 0.5);
}

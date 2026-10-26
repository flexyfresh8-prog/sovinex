/**
 * Sonivex Studio - Electro-mechanical lumped parameter driver/box model.
 *
 * Derived-parameter chain (user inputs Fs, Qes, Qms, Vas, Re, Le, Sd):
 *   Cms = Vas / (Sd^2 * rho * c^2)
 *   Mms = 1 / ((2*pi*Fs)^2 * Cms)
 *   Bl  = sqrt(omega_s * Mms * Re / Qes)
 *   Rms = omega_s * Mms / Qms
 *
 * Sealed box: single-DOF system with combined compliance Cmt = Cms*Cb/(Cms+Cb)
 * Ported box: two-DOF system (cone + port air mass) coupled by box compliance:
 *   [Rms+Bl²/Re+jωMms+1/(jωCms)+Kb·Sd²   Kb·Sd·Sp        ] [X1]   [Bl/Re·Ve]
 *   [Kb·Sd·Sp                             Kb·Sp²−ω²Mp+jωR2] [X2] = [0       ]
 *   where Kb = ρc²/Vb (pressure per volume displacement), Mp = ρ·Leff·Sp.
 *
 * Internal phasors are RMS (driven by Ve = 1 V RMS).
 * Excursion results are RMS per volt; convert to peak with sqrt(2).
 */
import { Cx, cx, cadd, csub, cmul, cdiv, cabs, cargs, solve2x2, cscale } from './complex';

export const RHO0 = 1.204;   // air density kg/m^3 @ 20C
export const C_AIR = 343.0;  // speed of sound m/s
export const PREF = 20e-6;   // reference pressure Pa
export const SQRT2 = Math.SQRT2;

export interface DriverModel {
  sdM2: number;
  mmsKg: number;
  cmsMperN: number;
  blTM: number;
  rmsMech: number;
  reOhm: number;
  leH: number;
  fsHz: number;
  qes: number;
  qms: number;
  qts: number;
  xmaxM: number;
  vasM3: number;
}

export interface BoxModel {
  type: 'sealed' | 'ported';
  vbM3: number;
  portAreaM2: number;
  portLenEffM: number;
}

export function buildDriverModel(p: {
  effectiveDiameterCM: number; fsHz: number; qes: number; qms: number;
  vasL: number; reOhm: number; leMH: number; xmaxMM: number;
}): DriverModel {
  const sd = Math.PI * Math.pow((p.effectiveDiameterCM / 100) / 2, 2);
  const vas = p.vasL / 1000;
  const cms = vas / (sd * sd * RHO0 * C_AIR * C_AIR);
  const ws = 2 * Math.PI * p.fsHz;
  const mms = 1 / (ws * ws * cms);
  const bl = Math.sqrt(ws * mms * p.reOhm / Math.max(p.qes, 1e-4));
  const rmsMech = ws * mms / Math.max(p.qms, 1e-4);
  const qts = (p.qes * p.qms) / (p.qes + p.qms);
  return {
    sdM2: sd, mmsKg: mms, cmsMperN: cms, blTM: bl, rmsMech: rmsMech,
    reOhm: p.reOhm, leH: p.leMH / 1000, fsHz: p.fsHz, qes: p.qes, qms: p.qms,
    qts, xmaxM: p.xmaxMM / 1000, vasM3: vas,
  };
}

export function buildBoxModel(p: {
  type: 'sealed' | 'ported'; netVolumeL: number; portDiameterCM: number;
  portLengthCM: number; portCount: number;
}): BoxModel {
  const vb = Math.max(p.netVolumeL, 0.5) / 1000;
  const dp = p.portDiameterCM / 100;
  const area = Math.PI * (dp / 2) * (dp / 2) * Math.max(1, Math.round(p.portCount));
  const lenEff = p.type === 'ported' ? (p.portLengthCM / 100) + 0.732 * dp : 0;
  return { type: p.type, vbM3: vb, portAreaM2: p.type === 'ported' ? area : 0, portLenEffM: lenEff };
}

/** Net box volume (L) from external dims + wall thickness, minus driver+port displacement. */
export function netVolumeL(externalCM: { wCM: number; hCM: number; dCM: number }, wallCM: number, driverDisplacementL = 4): number {
  const iw = Math.max(externalCM.wCM - 2 * wallCM, 2) / 10;
  const ih = Math.max(externalCM.hCM - 2 * wallCM, 2) / 10;
  const id = Math.max(externalCM.dCM - 2 * wallCM, 2) / 10;
  return Math.max(iw * ih * id - driverDisplacementL, 0.5);
}

/** Helmholtz tuning frequency of a ported enclosure (Hz). */
export function fbHz(b: BoxModel): number {
  if (b.type !== 'ported' || b.portAreaM2 <= 0 || b.portLenEffM <= 0) return 0;
  return (1 / (2 * Math.PI)) * Math.sqrt((C_AIR * C_AIR * b.portAreaM2) / (b.vbM3 * b.portLenEffM));
}

/** System resonance / Q of a sealed box. */
export function fcHz(d: DriverModel, b: BoxModel): { fc: number; qtc: number } {
  const qtc = d.qts * Math.sqrt(1 + d.vasM3 / Math.max(b.vbM3, 1e-4));
  // mechanical-domain box compliance (Vb reflected through Sd²)
  const cbM = b.vbM3 / (RHO0 * C_AIR * C_AIR * d.sdM2 * d.sdM2);
  const cmt = (d.cmsMperN * cbM) / (d.cmsMperN + cbM);
  const wc = 1 / Math.sqrt(d.mmsKg * cmt);
  return { fc: wc / (2 * Math.PI), qtc };
}

export interface SolvePoint {
  /** cone excursion, RMS meters per volt RMS input */
  xMPerV: number;
  xPhaseRad: number;
  /** port volume velocity, RMS m^3/s per volt RMS (0 if sealed) */
  upM3PerV: number;
  /** electrical impedance ohm */
  zOhm: number;
  zPhaseRad: number;
  /** SPL dB @1m on-axis per volt RMS */
  splPerV: number;
}

/** Solve the coupled system at frequency f (Hz), 1 V RMS input.
 *  All coefficients are in DISPLACEMENT form: a·X with X in meters.
 *  Mass → −ω²M, damping (mech + back-EMF) → jω·R, stiffness → K (+K_box), suspension → 1/(jωC). */
export function solvePoint(d: DriverModel, b: BoxModel, fHz: number): SolvePoint {
  const w = 2 * Math.PI * Math.max(fHz, 0.5);
  const w2 = w * w;
  const bl2Re = (d.blTM * d.blTM) / d.reOhm;  // electrical damping coeff (N·s/m)
  const drive = cx(d.blTM / d.reOhm, 0);      // Bl/Re · Ve
  const kb = (RHO0 * C_AIR * C_AIR) / b.vbM3; // Pa per (m³ volume displacement)

  if (b.type === 'sealed') {
    // mechanical-domain box compliance: Cb = Vb / (ρc²·Sd²); series with Cms
    const cbM = b.vbM3 / (RHO0 * C_AIR * C_AIR * d.sdM2 * d.sdM2);
    const cmt = (d.cmsMperN * cbM) / (d.cmsMperN + cbM);
    // Displacement-form EOM: A = (K − ω²M) + j·ω·Rtot, K = 1/Cmt, Rtot = Rms + Bl²/Re
    const A = cx(
      1 / cmt - w2 * d.mmsKg,
      w * (d.rmsMech + bl2Re),
    );
    const x = cdiv(drive, A);
    const v = cmul(cx(0, w), x);
    // electrical: Z_el = Re + jωLe + Bl²/Zm, Zm(velocity) = A/(jω)  [= Rtot at resonance]
    const zmMech = cdiv(A, cx(0, w));
    const zElExact = cadd(cx(d.reOhm, w * d.leH), cdiv(cx(d.blTM * d.blTM, 0), zmMech));
    const u = cscale(v, d.sdM2);
    const pRMS = (RHO0 * fHz * cabs(u)) / 2;
    const spl = 20 * Math.log10(Math.max(pRMS, 1e-12) / PREF);
    return { xMPerV: cabs(x), xPhaseRad: cargs(x), upM3PerV: 0, zOhm: cabs(zElExact), zPhaseRad: cargs(zElExact), splPerV: spl };
  }

  // Ported: 2-DOF coupled solve (displacement form)
  const sp = b.portAreaM2;
  const mp = RHO0 * b.portLenEffM * sp;
  // Port damping modeled as constant Q (Qp = 25) — flared port, typical lossless-ish behavior
  const rm2 = (w * mp) / 25.0;
  const a11 = cx(
    1 / d.cmsMperN + kb * d.sdM2 * d.sdM2 - w2 * d.mmsKg,
    w * (d.rmsMech + bl2Re),
  );
  const a12 = cx(kb * d.sdM2 * sp, 0);
  const a22 = cadd(cx(kb * sp * sp - w2 * mp, 0), cx(0, w * rm2));
  const [x1, x2] = solve2x2(a11, a12, a12, a22, drive, cx(0, 0));
  const v1 = cmul(cx(0, w), x1);
  const v2 = cmul(cx(0, w), x2);
  // electrical: I = (Ve − Bl·v1)/Re, Z = Ve/I
  const current = cdiv(csub(cx(1, 0), cmul(cx(d.blTM, 0), v1)), cx(d.reOhm, 0));
  const zEl = cdiv(cx(1, 0), current);
  const uTotal = cadd(cscale(v1, d.sdM2), cscale(v2, sp));
  const pRMS = (RHO0 * fHz * cabs(uTotal)) / 2;
  const spl = 20 * Math.log10(Math.max(pRMS, 1e-12) / PREF);
  return {
    xMPerV: cabs(x1), xPhaseRad: cargs(x1), upM3PerV: cabs(cscale(v2, sp)),
    zOhm: cabs(zEl), zPhaseRad: cargs(zEl), splPerV: spl,
  };
}

/** Complex excursion transfer X/Ve (RMS m per RMS V) for waveform reconstruction. */
export function excursionTransfer(d: DriverModel, b: BoxModel, fHz: number): { mag: number; phase: number } {
  const p = solvePoint(d, b, fHz);
  return { mag: p.xMPerV, phase: p.xPhaseRad };
}

/** Port volume velocity transfer Up/Ve (RMS m^3/s per RMS V). */
export function portTransfer(d: DriverModel, b: BoxModel, fHz: number): { mag: number; phase: number } {
  if (b.type !== 'ported') return { mag: 0, phase: 0 };
  const p = solvePoint(d, b, fHz);
  return { mag: p.upM3PerV, phase: 0 };
}

/** SPL when excursion equals Xmax (displacement-limited SPL), dB @1m. */
export function splAtExcursion(d: DriverModel, b: BoxModel, fHz: number, xPeakM: number): number {
  const w = 2 * Math.PI * fHz;
  const xRMS = xPeakM / SQRT2;
  const uRMS = w * xRMS * d.sdM2; // cone-only radiation (conservative below port tuning)
  const pRMS = (RHO0 * fHz * uRMS) / 2;
  return 20 * Math.log10(Math.max(pRMS, 1e-12) / PREF);
}

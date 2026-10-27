/**
 * Driver Studio — centralized driver configuration (single source of truth).
 *
 * Every dimension is stored in MILLIMETERS. The geometry engine converts to
 * scene meters (÷1000). Config is fully decoupled from the physics
 * DriverParams (Thiele/Small): geometry drives the 3D model, T-S drives the
 * simulation, exactly as the studio spec requires.
 *
 * All colors are clamped to grayscale — the studio is a strict black &
 * white environment. Material presets differ by roughness/metalness/surface
 * detail, never by hue.
 */

export type DriverType = 'subwoofer' | 'woofer' | 'midrange' | 'tweeter';

export type ConeMaterialKey =
  | 'pressedPaper' | 'polypropylene' | 'composite' | 'carbonFiber' | 'aluminum';
export type SoftMaterialKey = 'rubber' | 'foam' | 'fabric';
export type CoilMaterialKey = 'copper' | 'aluminum' | 'copperCladAluminum';
export type MagnetMaterialKey = 'ferrite' | 'neodymium';
export type BasketMaterialKey = 'stampedSteel' | 'castAluminum';
export type FinishKey = 'matte' | 'satin' | 'gloss';
export type DustCapShape = 'dome' | 'shallow' | 'flat' | 'inverted';
export type RollProfile = 'halfroll' | 'flat' | 'wroll';
export type TerminalType = 'block' | 'cup';

export interface DriverStudioConfig {
  driverType: DriverType;

  // ---- general ----
  nominalDiameterMM: number;      // frame flange outer diameter
  frontSpacingMM: number;         // cone edge height above the flange plane
  gasketThicknessMM: number;

  // ---- cone ----
  coneOuterDiameterMM: number;
  coneDepthMM: number;
  coneProfile: number;            // 0.55 straight-ish … 1.8 deep curve (exponent)
  coneThicknessMM: number;
  coneNeckDiameterMM: number;     // diameter where the cone meets the former
  coneMaterial: ConeMaterialKey;
  coneColor: string;              // grayscale hex
  coneFinish: FinishKey;

  // ---- dust cap ----
  dustCapDiameterMM: number;
  dustCapHeightMM: number;
  dustCapShape: DustCapShape;
  dustCapMaterial: ConeMaterialKey | 'rubber';
  dustCapColor: string;
  dustCapFinish: FinishKey;

  // ---- surround ----
  surroundInnerDiameterMM: number;   // default linked to cone OD
  surroundOuterDiameterMM: number;
  rollHeightMM: number;
  rollWidthMM: number;
  rollThicknessMM: number;
  rollProfile: RollProfile;
  surroundMaterial: SoftMaterialKey;
  surroundColor: string;
  linkSurroundToCone: boolean;

  // ---- voice coil ----
  voiceCoilDiameterMM: number;    // winding outer diameter
  windingHeightMM: number;
  windingThicknessMM: number;
  windingLayers: number;          // visible layer bands
  formerHeightMM: number;         // total former tube length
  formerThicknessMM: number;
  coilMaterial: CoilMaterialKey;
  coilColor: string;

  // ---- magnet / motor ----
  magnetDiameterMM: number;
  magnetHeightMM: number;         // per layer
  magnetLayers: number;
  magnetMaterial: MagnetMaterialKey;
  topPlateThicknessMM: number;
  bottomPlateThicknessMM: number;
  poleDiameterMM: number;
  poleExtendMM: number;           // pole proud of top plate face
  poleVent: boolean;

  // ---- basket ----
  basketDepthMM: number;          // flange plane → rear ring
  spokeCount: number;
  spokeWidthMM: number;
  frameThicknessMM: number;
  flangeThicknessMM: number;
  mountingHoleCount: number;
  basketMaterial: BasketMaterialKey;
  basketColor: string;

  // ---- spider ----
  spiderOuterDiameterMM: number;
  corrugationCount: number;
  corrugationDepthMM: number;
  spiderMaterial: SoftMaterialKey;
  spiderColor: string;
  spiderRestZMM: number;          // inner attachment depth below winding bottom

  // ---- terminals / hardware ----
  terminalType: TerminalType;
  screwCount: number;
  screwColor: string;
  leadColor: string;
}

// ============================================================ defaults

export const MONO = {
  black: '#0a0a0a',
  nearBlack: '#141414',
  darkGray: '#1f1f1f',
  midGray: '#3a3a3a',
  gray: '#5c5c5c',
  lightGray: '#9a9a9a',
  silver: '#c9c9c9',
  white: '#f2f2f2',
} as const;

export function defaultStudioConfig(type: DriverType = 'subwoofer'): DriverStudioConfig {
  const P: Record<DriverType, Partial<DriverStudioConfig>> = {
    subwoofer: {
      nominalDiameterMM: 318, coneOuterDiameterMM: 270, coneDepthMM: 68,
      coneNeckDiameterMM: 62, voiceCoilDiameterMM: 76.2, windingHeightMM: 34,
      magnetDiameterMM: 156, magnetHeightMM: 20, magnetLayers: 2,
      spiderOuterDiameterMM: 150, surroundOuterDiameterMM: 302,
      rollHeightMM: 15, rollWidthMM: 16, basketDepthMM: 118,
    },
    woofer: {
      nominalDiameterMM: 210, coneOuterDiameterMM: 172, coneDepthMM: 46,
      coneNeckDiameterMM: 40, voiceCoilDiameterMM: 38, windingHeightMM: 16,
      magnetDiameterMM: 108, magnetHeightMM: 16, magnetLayers: 1,
      spiderOuterDiameterMM: 96, surroundOuterDiameterMM: 200,
      rollHeightMM: 10, rollWidthMM: 11, basketDepthMM: 84,
    },
    midrange: {
      nominalDiameterMM: 130, coneOuterDiameterMM: 96, coneDepthMM: 26,
      coneNeckDiameterMM: 25.4, voiceCoilDiameterMM: 25.4, windingHeightMM: 8,
      magnetDiameterMM: 76, magnetHeightMM: 12, magnetLayers: 1,
      spiderOuterDiameterMM: 66, surroundOuterDiameterMM: 116,
      rollHeightMM: 6, rollWidthMM: 7, basketDepthMM: 56,
    },
    tweeter: {
      nominalDiameterMM: 104, coneOuterDiameterMM: 28, coneDepthMM: 7,
      coneNeckDiameterMM: 20, voiceCoilDiameterMM: 25.4, windingHeightMM: 4,
      magnetDiameterMM: 60, magnetHeightMM: 8, magnetLayers: 1,
      spiderOuterDiameterMM: 0, surroundOuterDiameterMM: 60,
      rollHeightMM: 3.5, rollWidthMM: 4, basketDepthMM: 32,
    },
  };
  const base: DriverStudioConfig = {
    driverType: type,
    nominalDiameterMM: 318,
    frontSpacingMM: 2.5,
    gasketThicknessMM: 2.5,

    coneOuterDiameterMM: 270,
    coneDepthMM: 68,
    coneProfile: 0.85,
    coneThicknessMM: 1.6,
    coneNeckDiameterMM: 62,
    coneMaterial: 'composite',
    coneColor: MONO.darkGray,
    coneFinish: 'matte',

    dustCapDiameterMM: 92,
    dustCapHeightMM: 26,
    dustCapShape: 'dome',
    dustCapMaterial: 'rubber',
    dustCapColor: MONO.nearBlack,
    dustCapFinish: 'gloss',

    surroundInnerDiameterMM: 270,
    surroundOuterDiameterMM: 302,
    rollHeightMM: 15,
    rollWidthMM: 16,
    rollThicknessMM: 3.2,
    rollProfile: 'halfroll',
    surroundMaterial: 'rubber',
    surroundColor: MONO.black,
    linkSurroundToCone: true,

    voiceCoilDiameterMM: 76.2,
    windingHeightMM: 34,
    windingThicknessMM: 2.4,
    windingLayers: 2,
    formerHeightMM: 62,
    formerThicknessMM: 0.8,
    coilMaterial: 'copper',
    coilColor: MONO.midGray,

    magnetDiameterMM: 156,
    magnetHeightMM: 20,
    magnetLayers: 2,
    magnetMaterial: 'ferrite',
    topPlateThicknessMM: 12,
    bottomPlateThicknessMM: 8,
    poleDiameterMM: 30,
    poleExtendMM: 1.5,
    poleVent: true,

    basketDepthMM: 118,
    spokeCount: 8,
    spokeWidthMM: 9,
    frameThicknessMM: 3.2,
    flangeThicknessMM: 4.5,
    mountingHoleCount: 8,
    basketMaterial: 'castAluminum',
    basketColor: MONO.gray,

    spiderOuterDiameterMM: 150,
    corrugationCount: 9,
    corrugationDepthMM: 2.6,
    spiderMaterial: 'fabric',
    spiderColor: MONO.lightGray,
    spiderRestZMM: 8,

    terminalType: 'block',
    screwCount: 8,
    screwColor: MONO.nearBlack,
    leadColor: MONO.silver,
  };
  return { ...base, ...(P[type] ?? {}), driverType: type };
}

// ============================================================ field metadata

export type FieldDef = {
  key: keyof DriverStudioConfig;
  label: string;
  unit: 'mm' | 'cm' | 'x' | '°' | 'count' | 'preset';
  min?: number; max?: number; step?: number; decimals?: number;
  kind: 'number' | 'select' | 'color' | 'toggle';
  options?: { value: string; label: string }[];
  /** assembly section this field belongs to */
  section: ComponentGroup;
  hint?: string;
};

export type ComponentGroup =
  | 'general' | 'cone' | 'dustcap' | 'surround' | 'voicecoil'
  | 'magnet' | 'motor' | 'basket' | 'spider' | 'terminal' | 'hardware';

export const SECTION_META: { id: ComponentGroup; label: string; assembly: string; hint: string }[] = [
  { id: 'general', label: 'General Driver', assembly: 'Driver', hint: 'Overall size, spacing and unit-wide settings' },
  { id: 'cone', label: 'Cone', assembly: 'Cone Assembly', hint: 'Curved diaphragm surface' },
  { id: 'dustcap', label: 'Dust Cap', assembly: 'Dust Cap Assembly', hint: 'Center dome protecting the voice coil' },
  { id: 'surround', label: 'Surround Roll', assembly: 'Surround Assembly', hint: 'Flexible suspension connecting cone to frame' },
  { id: 'voicecoil', label: 'Voice Coil & Former', assembly: 'Voice Coil Assembly', hint: 'Motor coil and its supporting tube' },
  { id: 'magnet', label: 'Magnet', assembly: 'Magnet Assembly', hint: 'Permanent magnet stack' },
  { id: 'motor', label: 'Motor Structure', assembly: 'Motor Structure', hint: 'Plates and center pole completing the magnetic circuit' },
  { id: 'basket', label: 'Basket / Frame', assembly: 'Basket Assembly', hint: 'Chassis carrying every component' },
  { id: 'spider', label: 'Spider (Damper)', assembly: 'Spider Assembly', hint: 'Corrugated rear suspension' },
  { id: 'terminal', label: 'Terminals', assembly: 'Terminal Assembly', hint: 'Input connection block' },
  { id: 'hardware', label: 'Gasket & Mounting Hardware', assembly: 'Mounting Hardware', hint: 'Sealing gasket and flange screws' },
];

const MAT_CONE: FieldDef['options'] = [
  { value: 'pressedPaper', label: 'Pressed paper' },
  { value: 'polypropylene', label: 'Polypropylene' },
  { value: 'composite', label: 'Composite weave' },
  { value: 'carbonFiber', label: 'Carbon fiber' },
  { value: 'aluminum', label: 'Aluminum' },
];
const MAT_SOFT: FieldDef['options'] = [
  { value: 'rubber', label: 'Rubber' },
  { value: 'foam', label: 'Foam' },
  { value: 'fabric', label: 'Fabric' },
];

export const FIELDS: FieldDef[] = [
  // general
  { key: 'driverType', label: 'Driver class', unit: 'preset', kind: 'select', section: 'general',
    options: [
      { value: 'subwoofer', label: 'Subwoofer 12″' }, { value: 'woofer', label: 'Woofer 8″' },
      { value: 'midrange', label: 'Midrange 5″' }, { value: 'tweeter', label: 'Tweeter 4″' },
    ] },
  { key: 'nominalDiameterMM', label: 'Frame diameter', unit: 'mm', kind: 'number', min: 60, max: 560, step: 1, decimals: 0, section: 'general' },
  { key: 'frontSpacingMM', label: 'Cone edge offset', unit: 'mm', kind: 'number', min: -4, max: 30, step: 0.5, decimals: 1, section: 'general' },
  { key: 'gasketThicknessMM', label: 'Gasket thickness', unit: 'mm', kind: 'number', min: 0.5, max: 12, step: 0.5, decimals: 1, section: 'general' },

  // cone
  { key: 'coneOuterDiameterMM', label: 'Cone diameter', unit: 'mm', kind: 'number', min: 20, max: 540, step: 1, decimals: 0, section: 'cone' },
  { key: 'coneDepthMM', label: 'Cone depth', unit: 'mm', kind: 'number', min: 4, max: 140, step: 0.5, decimals: 1, section: 'cone' },
  { key: 'coneProfile', label: 'Profile curvature', unit: 'x', kind: 'number', min: 0.55, max: 1.8, step: 0.05, decimals: 2, section: 'cone', hint: '1.0 = straight conical, higher = curved' },
  { key: 'coneThicknessMM', label: 'Wall thickness', unit: 'mm', kind: 'number', min: 0.4, max: 8, step: 0.1, decimals: 1, section: 'cone' },
  { key: 'coneNeckDiameterMM', label: 'Neck diameter', unit: 'mm', kind: 'number', min: 10, max: 200, step: 0.5, decimals: 1, section: 'cone' },
  { key: 'coneMaterial', label: 'Material', unit: 'preset', kind: 'select', options: MAT_CONE, section: 'cone' },
  { key: 'coneColor', label: 'Color', unit: 'preset', kind: 'color', section: 'cone' },
  { key: 'coneFinish', label: 'Finish', unit: 'preset', kind: 'select', options: [
    { value: 'matte', label: 'Matte' }, { value: 'satin', label: 'Satin' }, { value: 'gloss', label: 'Gloss' },
  ], section: 'cone' },

  // dust cap
  { key: 'dustCapDiameterMM', label: 'Cap diameter', unit: 'mm', kind: 'number', min: 8, max: 260, step: 1, decimals: 0, section: 'dustcap' },
  { key: 'dustCapHeightMM', label: 'Cap height', unit: 'mm', kind: 'number', min: 1, max: 90, step: 0.5, decimals: 1, section: 'dustcap' },
  { key: 'dustCapShape', label: 'Shape', unit: 'preset', kind: 'select', options: [
    { value: 'dome', label: 'Full dome' }, { value: 'shallow', label: 'Shallow dome' },
    { value: 'flat', label: 'Flat disc' }, { value: 'inverted', label: 'Inverted (concave)' },
  ], section: 'dustcap' },
  { key: 'dustCapMaterial', label: 'Material', unit: 'preset', kind: 'select',
    options: [...MAT_CONE.filter((o) => o.value !== 'pressedPaper'), { value: 'rubber', label: 'Rubber' }], section: 'dustcap' },
  { key: 'dustCapColor', label: 'Color', unit: 'preset', kind: 'color', section: 'dustcap' },
  { key: 'dustCapFinish', label: 'Finish', unit: 'preset', kind: 'select', options: [
    { value: 'matte', label: 'Matte' }, { value: 'satin', label: 'Satin' }, { value: 'gloss', label: 'Gloss' },
  ], section: 'dustcap' },

  // surround
  { key: 'linkSurroundToCone', label: 'Link inner Ø to cone', unit: 'preset', kind: 'toggle', section: 'surround' },
  { key: 'surroundInnerDiameterMM', label: 'Inner diameter', unit: 'mm', kind: 'number', min: 20, max: 540, step: 1, decimals: 0, section: 'surround' },
  { key: 'surroundOuterDiameterMM', label: 'Outer diameter', unit: 'mm', kind: 'number', min: 24, max: 560, step: 1, decimals: 0, section: 'surround' },
  { key: 'rollHeightMM', label: 'Roll height', unit: 'mm', kind: 'number', min: 2, max: 40, step: 0.5, decimals: 1, section: 'surround' },
  { key: 'rollWidthMM', label: 'Roll width', unit: 'mm', kind: 'number', min: 2, max: 60, step: 0.5, decimals: 1, section: 'surround' },
  { key: 'rollThicknessMM', label: 'Roll thickness', unit: 'mm', kind: 'number', min: 0.6, max: 12, step: 0.1, decimals: 1, section: 'surround' },
  { key: 'rollProfile', label: 'Roll profile', unit: 'preset', kind: 'select', options: [
    { value: 'halfroll', label: 'Half roll' }, { value: 'flat', label: 'Flat crown' }, { value: 'wroll', label: 'W-roll (double)' },
  ], section: 'surround' },
  { key: 'surroundMaterial', label: 'Material', unit: 'preset', kind: 'select', options: MAT_SOFT, section: 'surround' },
  { key: 'surroundColor', label: 'Color', unit: 'preset', kind: 'color', section: 'surround' },

  // voice coil
  { key: 'voiceCoilDiameterMM', label: 'Coil diameter (winding Ø)', unit: 'mm', kind: 'number', min: 8, max: 160, step: 0.1, decimals: 1, section: 'voicecoil' },
  { key: 'windingHeightMM', label: 'Winding height', unit: 'mm', kind: 'number', min: 2, max: 90, step: 0.5, decimals: 1, section: 'voicecoil' },
  { key: 'windingThicknessMM', label: 'Winding thickness', unit: 'mm', kind: 'number', min: 0.4, max: 12, step: 0.1, decimals: 1, section: 'voicecoil' },
  { key: 'windingLayers', label: 'Visible winding layers', unit: 'count', kind: 'number', min: 1, max: 4, step: 1, decimals: 0, section: 'voicecoil' },
  { key: 'formerHeightMM', label: 'Former height', unit: 'mm', kind: 'number', min: 6, max: 160, step: 0.5, decimals: 1, section: 'voicecoil' },
  { key: 'formerThicknessMM', label: 'Former wall', unit: 'mm', kind: 'number', min: 0.3, max: 4, step: 0.1, decimals: 1, section: 'voicecoil' },
  { key: 'coilMaterial', label: 'Wire material', unit: 'preset', kind: 'select', options: [
    { value: 'copper', label: 'Copper' }, { value: 'aluminum', label: 'Aluminum' }, { value: 'copperCladAluminum', label: 'CCAW' },
  ], section: 'voicecoil' },
  { key: 'coilColor', label: 'Coil tint', unit: 'preset', kind: 'color', section: 'voicecoil' },

  // magnet
  { key: 'magnetDiameterMM', label: 'Magnet diameter', unit: 'mm', kind: 'number', min: 20, max: 320, step: 1, decimals: 0, section: 'magnet' },
  { key: 'magnetHeightMM', label: 'Layer height', unit: 'mm', kind: 'number', min: 4, max: 60, step: 0.5, decimals: 1, section: 'magnet' },
  { key: 'magnetLayers', label: 'Magnet layers', unit: 'count', kind: 'number', min: 1, max: 4, step: 1, decimals: 0, section: 'magnet' },
  { key: 'magnetMaterial', label: 'Magnet material', unit: 'preset', kind: 'select', options: [
    { value: 'ferrite', label: 'Ferrite (ring)' }, { value: 'neodymium', label: 'Neodymium (slug)' },
  ], section: 'magnet' },

  // motor
  { key: 'topPlateThicknessMM', label: 'Top plate thickness', unit: 'mm', kind: 'number', min: 2, max: 40, step: 0.5, decimals: 1, section: 'motor' },
  { key: 'bottomPlateThicknessMM', label: 'Bottom plate thickness', unit: 'mm', kind: 'number', min: 2, max: 40, step: 0.5, decimals: 1, section: 'motor' },
  { key: 'poleDiameterMM', label: 'Pole diameter', unit: 'mm', kind: 'number', min: 6, max: 140, step: 0.5, decimals: 1, section: 'motor' },
  { key: 'poleExtendMM', label: 'Pole extension', unit: 'mm', kind: 'number', min: 0, max: 40, step: 0.5, decimals: 1, section: 'motor' },
  { key: 'poleVent', label: 'Pole vent', unit: 'preset', kind: 'toggle', section: 'motor' },

  // basket
  { key: 'basketDepthMM', label: 'Basket depth', unit: 'mm', kind: 'number', min: 20, max: 320, step: 1, decimals: 0, section: 'basket' },
  { key: 'spokeCount', label: 'Spoke count', unit: 'count', kind: 'number', min: 3, max: 16, step: 1, decimals: 0, section: 'basket' },
  { key: 'spokeWidthMM', label: 'Spoke width', unit: 'mm', kind: 'number', min: 2, max: 40, step: 0.5, decimals: 1, section: 'basket' },
  { key: 'frameThicknessMM', label: 'Frame thickness', unit: 'mm', kind: 'number', min: 1, max: 12, step: 0.2, decimals: 1, section: 'basket' },
  { key: 'flangeThicknessMM', label: 'Flange thickness', unit: 'mm', kind: 'number', min: 1.5, max: 20, step: 0.5, decimals: 1, section: 'basket' },
  { key: 'mountingHoleCount', label: 'Mounting holes', unit: 'count', kind: 'number', min: 3, max: 12, step: 1, decimals: 0, section: 'basket' },
  { key: 'basketMaterial', label: 'Frame material', unit: 'preset', kind: 'select', options: [
    { value: 'stampedSteel', label: 'Stamped steel' }, { value: 'castAluminum', label: 'Cast aluminum' },
  ], section: 'basket' },
  { key: 'basketColor', label: 'Frame color', unit: 'preset', kind: 'color', section: 'basket' },

  // spider
  { key: 'spiderOuterDiameterMM', label: 'Spider diameter', unit: 'mm', kind: 'number', min: 0, max: 300, step: 1, decimals: 0, section: 'spider', hint: '0 hides the spider (tweeters)' },
  { key: 'corrugationCount', label: 'Corrugation count', unit: 'count', kind: 'number', min: 3, max: 18, step: 1, decimals: 0, section: 'spider' },
  { key: 'corrugationDepthMM', label: 'Corrugation depth', unit: 'mm', kind: 'number', min: 0.5, max: 10, step: 0.1, decimals: 1, section: 'spider' },
  { key: 'spiderRestZMM', label: 'Rest position (below coil)', unit: 'mm', kind: 'number', min: 2, max: 60, step: 0.5, decimals: 1, section: 'spider' },
  { key: 'spiderMaterial', label: 'Material', unit: 'preset', kind: 'select', options: MAT_SOFT, section: 'spider' },
  { key: 'spiderColor', label: 'Color', unit: 'preset', kind: 'color', section: 'spider' },

  // terminal
  { key: 'terminalType', label: 'Terminal style', unit: 'preset', kind: 'select', options: [
    { value: 'block', label: 'Block (push posts)' }, { value: 'cup', label: 'Round cup' },
  ], section: 'terminal' },

  // hardware
  { key: 'screwCount', label: 'Screw count', unit: 'count', kind: 'number', min: 0, max: 16, step: 1, decimals: 0, section: 'hardware' },
  { key: 'screwColor', label: 'Screw color', unit: 'preset', kind: 'color', section: 'hardware' },
  { key: 'leadColor', label: 'Tinsel lead color', unit: 'preset', kind: 'color', section: 'hardware' },
];

// ============================================================ validation

export interface ValidationIssue {
  level: 'error' | 'warn';
  msg: string;
}

/** Clamp helper — numeric fields stay inside their metadata limits. */
export function clampConfig(cfg: DriverStudioConfig): DriverStudioConfig {
  const out = { ...cfg };
  for (const f of FIELDS) {
    if (f.kind !== 'number' || f.min === undefined || f.max === undefined) continue;
    const v = out[f.key] as unknown as number;
    if (typeof v !== 'number' || !Number.isFinite(v)) { (out as Record<string, unknown>)[f.key] = f.min; continue; }
    (out as Record<string, unknown>)[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  out.windingLayers = Math.max(1, Math.round(out.windingLayers));
  out.magnetLayers = Math.max(1, Math.round(out.magnetLayers));
  out.spokeCount = Math.round(out.spokeCount);
  out.mountingHoleCount = Math.round(out.mountingHoleCount);
  out.screwCount = Math.round(out.screwCount);
  out.corrugationCount = Math.round(out.corrugationCount);
  if (out.surroundOuterDiameterMM < out.surroundInnerDiameterMM + 6) {
    out.surroundOuterDiameterMM = out.surroundInnerDiameterMM + 6;
  }
  if (out.dustCapDiameterMM > out.coneNeckDiameterMM * 1.6) {
    out.dustCapDiameterMM = Math.round(out.coneNeckDiameterMM * 1.6);
  }
  return out;
}

/** Mechanical plausibility checks — warnings shown live in the studio panel. */
export function validateConfig(cfg: DriverStudioConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const vcOD = cfg.voiceCoilDiameterMM;
  const neckID = cfg.coneNeckDiameterMM;
  const neckClear = neckID - 2 * cfg.coneThicknessMM;

  if (vcOD > neckClear + 0.6) {
    issues.push({ level: 'error', msg: `Voice coil Ø${vcOD} mm does not fit through the cone neck (Ø${neckClear} mm clear) — coil would jam at the neck.` });
  } else if (vcOD > neckClear - 4) {
    issues.push({ level: 'warn', msg: `Tight neck clearance: coil Ø${vcOD} mm vs neck clear Ø${neckClear} mm (< 4 mm side gap).` });
  }

  if (!cfg.linkSurroundToCone) {
    const coneOD = cfg.coneOuterDiameterMM;
    if (Math.abs(cfg.surroundInnerDiameterMM - coneOD) > 3) {
      issues.push({ level: 'warn', msg: `Surround inner Ø${cfg.surroundInnerDiameterMM} mm is not glued to the cone edge (Ø${coneOD} mm) — ${cfg.surroundInnerDiameterMM > coneOD ? 'a gap' : 'an overlap'} of ${Math.abs(cfg.surroundInnerDiameterMM - coneOD).toFixed(1)} mm breaks the seal.` });
    }
  }

  const formerID = cfg.voiceCoilDiameterMM - 2 * cfg.windingThicknessMM - 2 * cfg.formerThicknessMM;
  if (cfg.poleDiameterMM >= formerID - 1.5) {
    issues.push({ level: 'error', msg: `Center pole Ø${cfg.poleDiameterMM} mm leaves no magnetic gap for the coil (former ID ≈ Ø${formerID.toFixed(1)} mm).` });
  } else if (cfg.poleDiameterMM > formerID - 4) {
    issues.push({ level: 'warn', msg: `Narrow magnetic gap: pole Ø${cfg.poleDiameterMM} mm vs former ID Ø${formerID.toFixed(1)} mm.` });
  }

  if (cfg.magnetDiameterMM > cfg.nominalDiameterMM - 20) {
    issues.push({ level: 'warn', msg: `Magnet Ø${cfg.magnetDiameterMM} mm nearly spans the frame Ø${cfg.nominalDiameterMM} mm — basket ribs may not close.` });
  }

  if (cfg.spiderOuterDiameterMM > 0) {
    const shelfID = cfg.magnetDiameterMM + 8;
    if (cfg.spiderOuterDiameterMM > shelfID) {
      issues.push({ level: 'warn', msg: `Spider Ø${cfg.spiderOuterDiameterMM} mm is wider than the basket shelf (Ø${shelfID} mm) — it will overhang the shelf ring.` });
    }
    if (cfg.spiderOuterDiameterMM < vcOD + 10) {
      issues.push({ level: 'warn', msg: `Spider Ø${cfg.spiderOuterDiameterMM} mm barely clears the coil (Ø${vcOD} mm) — excursion may collide.` });
    }
  }

  const travel = cfg.windingHeightMM - cfg.topPlateThicknessMM;
  if (travel < 4) {
    issues.push({ level: 'warn', msg: `Winding height ${cfg.windingHeightMM} mm vs top plate ${cfg.topPlateThicknessMM} mm leaves only ${travel.toFixed(1)} mm of over-hang — expect high distortion past ±${(travel / 2).toFixed(1)} mm.` });
  }

  if (cfg.dustCapDiameterMM > cfg.coneOuterDiameterMM * 0.75) {
    issues.push({ level: 'warn', msg: `Dust cap Ø${cfg.dustCapDiameterMM} mm covers ${(100 * cfg.dustCapDiameterMM / cfg.coneOuterDiameterMM).toFixed(0)}% of the cone — stiffness dominated, low blast output.` });
  }

  if (cfg.rollHeightMM < cfg.rollWidthMM * 0.25) {
    issues.push({ level: 'warn', msg: `Very low roll height (${cfg.rollHeightMM} mm) for a ${cfg.rollWidthMM} mm wide surround — the roll will self-contact at excursion.` });
  }

  if (cfg.magnetLayers * cfg.magnetHeightMM > cfg.basketDepthMM * 0.7) {
    issues.push({ level: 'warn', msg: `Motor stack (${(cfg.magnetLayers * cfg.magnetHeightMM).toFixed(0)} mm of magnets + plates) approaches the basket depth (${cfg.basketDepthMM} mm).` });
  }

  return issues;
}

// ============================================================ colors

/** Force any color into grayscale (theme is strictly black & white). */
export function monochrome(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return MONO.darkGray;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const v = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const s = v.toString(16).padStart(2, '0');
  return `#${s}${s}${s}`;
}

export const MM_PER_IN = 25.4;

/** mm → display string in the active unit system. */
export function fmtLen(mm: number, units: 'metric' | 'imperial', decimals = 1): string {
  return units === 'metric' ? `${mm.toFixed(decimals)} mm` : `${(mm / MM_PER_IN).toFixed(decimals < 1 ? 3 : 2)}″`;
}

/** Component ids used across the engine, UI and motion mapping. */
export const COMP_IDS = [
  'cone', 'dustcap', 'surround', 'voicecoil', 'spider',
  'magnet', 'topPlate', 'bottomPlate', 'pole', 'basket',
  'gasket', 'terminals', 'leads', 'hardware',
] as const;
export type ComponentId = (typeof COMP_IDS)[number];

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  cone: 'Cone', dustcap: 'Dust Cap', surround: 'Surround Roll', voicecoil: 'Voice Coil & Former',
  spider: 'Spider (Damper)', magnet: 'Magnet Stack', topPlate: 'Top Plate', bottomPlate: 'Bottom Plate',
  pole: 'Center Pole', basket: 'Basket / Frame', gasket: 'Mounting Gasket', terminals: 'Terminal Block',
  leads: 'Tinsel Leads', hardware: 'Mounting Hardware',
};

export const COMPONENT_GROUP: Record<ComponentId, ComponentGroup> = {
  cone: 'cone', dustcap: 'dustcap', surround: 'surround', voicecoil: 'voicecoil',
  spider: 'spider', magnet: 'magnet', topPlate: 'motor', bottomPlate: 'motor', pole: 'motor',
  basket: 'basket', gasket: 'hardware', terminals: 'terminal', leads: 'cone', hardware: 'hardware',
};

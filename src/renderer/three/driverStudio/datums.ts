/**
 * Driver Studio — derived geometry datums.
 *
 * computeDatums() converts the millimeter config into every scalar the part
 * builders need (all meters, axis = +Z front, mounting-flange plane at z = 0).
 * Each component declares which datums it consumes; the assembly engine diffs
 * datums after a config change and rebuilds ONLY the components whose datums
 * actually changed — no full-scene rebuilds on slider drags.
 *
 * Axial layout (mm, front = +z):
 *
 *   z=0 ─ flange/mounting plane · surround outer edge lands here
 *   frontSpacing ─ cone edge plane (above flange)
 *   cone depth   ─ cone slopes back to the neck
 *   former+winding hang below the neck
 *   spider inner clamps the former, outer lands on the basket shelf
 *   top plate / magnet stack / bottom plate below, pole reaching up through
 */
import { DriverStudioConfig } from './config';

export interface Datums {
  // radii (m)
  flangeR: number;
  flangeInnerR: number;
  holeR: number;              // mounting bolt circle radius
  coneR: number;              // cone outer radius
  coneNeckR: number;
  surroundInnerR: number;
  surroundOuterR: number;
  capR: number;
  windOuterR: number;
  windInnerR: number;
  formerOuterR: number;
  formerInnerR: number;
  spiderInnerR: number;
  spiderOuterR: number;
  magnetR: number;
  magnetInnerR: number;
  plateR: number;
  poleR: number;
  spiderShelfR: number;
  basketRearR: number;

  // axial stations (m, +z front)
  zConeEdge: number;
  zConeTip: number;
  zWindTop: number;
  zWindBot: number;
  zFormerBot: number;
  zSpider: number;
  zSpiderOuter: number;
  zTPFront: number;
  zTPBack: number;
  zMagTop: number;
  zMagBot: number;
  zBPBot: number;
  zPoleFront: number;
  zRearRing: number;
  flangeT: number;

  // scalars
  coneDepth: number;
  coneProfileExp: number;
  totalDepthM: number;
  magnetHTotal: number;
  corrCount: number;
  xmaxM: number;             // half winding over-hang — realistic excursion budget
}

/** Which components consume which datums — keyed by datum group. */
export const DATUM_CONSUMERS = {
  frame: ['cone', 'dustcap', 'surround', 'voicecoil', 'spider', 'magnet', 'topPlate',
    'bottomPlate', 'pole', 'basket', 'gasket', 'terminals', 'leads', 'hardware'] as const,
  coneSurf: ['cone', 'leads'] as const,
  cap: ['dustcap'] as const,
  surround: ['surround', 'gasket'] as const,
  coil: ['voicecoil', 'spider'] as const,
  motor: ['magnet', 'topPlate', 'bottomPlate', 'pole', 'basket'] as const,
  basket: ['basket', 'gasket', 'hardware', 'terminals'] as const,
  spider: ['spider'] as const,
  finish: ['cone', 'dustcap', 'surround', 'voicecoil', 'spider', 'magnet', 'topPlate',
    'bottomPlate', 'pole', 'basket', 'gasket', 'terminals', 'leads', 'hardware'] as const,
};

/** Map a config change to the components that must be rebuilt. */
export function componentsAffectedBy(keys: (keyof DriverStudioConfig)[]): string[] {
  const groups = new Set<string>();
  const GEOM: Partial<Record<keyof DriverStudioConfig, keyof typeof DATUM_CONSUMERS>> = {
    driverType: 'frame',
    nominalDiameterMM: 'frame',
    frontSpacingMM: 'frame',
    gasketThicknessMM: 'frame',
    coneOuterDiameterMM: 'coneSurf',
    coneDepthMM: 'coneSurf',
    coneProfile: 'coneSurf',
    coneThicknessMM: 'coneSurf',
    coneNeckDiameterMM: 'coneSurf',
    coneMaterial: 'finish', coneColor: 'finish', coneFinish: 'finish',
    dustCapDiameterMM: 'cap', dustCapHeightMM: 'cap', dustCapShape: 'cap',
    dustCapMaterial: 'finish', dustCapColor: 'finish', dustCapFinish: 'finish',
    surroundInnerDiameterMM: 'surround', surroundOuterDiameterMM: 'surround',
    rollHeightMM: 'surround', rollWidthMM: 'surround', rollThicknessMM: 'surround',
    rollProfile: 'surround', surroundMaterial: 'finish', surroundColor: 'finish',
    linkSurroundToCone: 'surround',
    voiceCoilDiameterMM: 'coil', windingHeightMM: 'coil', windingThicknessMM: 'coil',
    windingLayers: 'coil', formerHeightMM: 'coil', formerThicknessMM: 'coil',
    coilMaterial: 'finish', coilColor: 'finish',
    magnetDiameterMM: 'motor', magnetHeightMM: 'motor', magnetLayers: 'motor',
    magnetMaterial: 'finish',
    topPlateThicknessMM: 'motor', bottomPlateThicknessMM: 'motor',
    poleDiameterMM: 'motor', poleExtendMM: 'motor', poleVent: 'motor',
    basketDepthMM: 'basket', spokeCount: 'basket', spokeWidthMM: 'basket',
    frameThicknessMM: 'basket', flangeThicknessMM: 'basket', mountingHoleCount: 'basket',
    basketMaterial: 'finish', basketColor: 'finish',
    spiderOuterDiameterMM: 'spider', corrugationCount: 'spider', corrugationDepthMM: 'spider',
    spiderRestZMM: 'spider', spiderMaterial: 'finish', spiderColor: 'finish',
    terminalType: 'basket',
    screwCount: 'basket', screwColor: 'finish', leadColor: 'finish',
  };
  for (const k of keys) {
    const g = GEOM[k];
    if (g) for (const c of DATUM_CONSUMERS[g]) groups.add(c);
  }
  return [...groups];
}

const MM = 1 / 1000;

export function computeDatums(cfg: DriverStudioConfig): Datums {
  const coneR = (cfg.coneOuterDiameterMM / 2) * MM;
  const coneNeckR = (cfg.coneNeckDiameterMM / 2) * MM;
  const surroundInnerR = cfg.linkSurroundToCone
    ? coneR + 1.0 * MM
    : (cfg.surroundInnerDiameterMM / 2) * MM;
  const surroundOuterR = Math.max(surroundInnerR + 2.5 * MM, (cfg.surroundOuterDiameterMM / 2) * MM);

  const windOuterR = (cfg.voiceCoilDiameterMM / 2) * MM;
  const windInnerR = Math.max(1 * MM, windOuterR - cfg.windingThicknessMM * MM);
  const formerOuterR = windInnerR;
  const formerInnerR = Math.max(0.5 * MM, formerOuterR - cfg.formerThicknessMM * MM);

  const spiderInnerR = formerOuterR + 1.2 * MM;
  const spiderOuterR = Math.max(spiderInnerR + 6 * MM, (cfg.spiderOuterDiameterMM / 2) * MM);

  const magnetR = (cfg.magnetDiameterMM / 2) * MM;
  const magnetInnerR = Math.max(poleRof(cfg) + 6 * MM, cfg.magnetMaterial === 'neodymium' ? 0.0 : magnetR * 0.42);
  const plateR = Math.max(magnetR * 0.92, windOuterR + 6 * MM);
  const flangeR = (cfg.nominalDiameterMM / 2) * MM;
  const flangeInnerR = Math.min(flangeR - 6 * MM, surroundOuterR + 2 * MM);
  const flangeT = cfg.flangeThicknessMM * MM;

  const zConeEdge = cfg.frontSpacingMM * MM;
  const coneDepth = cfg.coneDepthMM * MM;
  const zConeTip = zConeEdge - coneDepth;
  const zWindTop = zConeTip - 4 * MM;
  const zWindBot = zWindTop - cfg.windingHeightMM * MM;
  const formerLen = cfg.formerHeightMM * MM;
  const zFormerBot = zWindTop - formerLen;

  const zSpider = zWindBot - Math.max(3 * MM, cfg.spiderRestZMM * MM);
  const zSpiderOuter = zSpider - Math.max(2 * MM, cfg.corrugationDepthMM * 1.6 * MM);

  const zTPFront = zWindBot - 3 * MM;
  const zTPBack = zTPFront - cfg.topPlateThicknessMM * MM;
  const magnetHTotal = cfg.magnetLayers * cfg.magnetHeightMM * MM;
  const zMagTop = zTPBack - 0.8 * MM;
  const zMagBot = zMagTop - magnetHTotal;
  const zBPTop = zMagBot - 0.8 * MM;
  const zBPBot = zBPTop - cfg.bottomPlateThicknessMM * MM;
  const zPoleFront = zTPFront + cfg.poleExtendMM * MM;

  const basketDepth = cfg.basketDepthMM * MM;
  const zRearRing = Math.min(zConeEdge - basketDepth, zBPBot - 3 * MM);
  const spiderShelfR = Math.max(spiderOuterR + 2.5 * MM, magnetR + 3 * MM);
  const basketRearR = Math.max(magnetR + 2.2 * MM, spiderShelfR * 0.94);

  const totalDepthM = zConeEdge - zBPBot;

  return {
    flangeR, flangeInnerR,
    holeR: (flangeInnerR + surroundOuterR) / 2 + 1.5 * MM,
    coneR, coneNeckR, surroundInnerR, surroundOuterR,
    capR: Math.min((cfg.dustCapDiameterMM / 2) * MM, coneNeckR * 1.4),
    windOuterR, windInnerR, formerOuterR, formerInnerR,
    spiderInnerR, spiderOuterR,
    magnetR, magnetInnerR, plateR,
    poleR: Math.min((cfg.poleDiameterMM / 2) * MM, formerInnerR - 1.0 * MM),
    spiderShelfR, basketRearR,
    zConeEdge, zConeTip, zWindTop, zWindBot, zFormerBot,
    zSpider, zSpiderOuter, zTPFront, zTPBack, zMagTop, zMagBot,
    zBPBot, zPoleFront, zRearRing, flangeT,
    coneDepth, coneProfileExp: cfg.coneProfile,
    totalDepthM, magnetHTotal,
    corrCount: cfg.corrugationCount,
    xmaxM: Math.max(1 * MM, (cfg.windingHeightMM - cfg.topPlateThicknessMM) / 2 * MM),
  };

  function poleRof(c: DriverStudioConfig): number {
    return Math.min((c.poleDiameterMM / 2), (c.voiceCoilDiameterMM / 2 - c.windingThicknessMM - c.formerThicknessMM - 1)) * MM;
  }
}

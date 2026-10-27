/**
 * Driver Studio — component geometry builders.
 *
 * Every part is an independent, named group built from real mechanical
 * relationships (radii and axial stations come exclusively from the shared
 * datums), so parts stay aligned and connected under any customization.
 *
 * Geometry convention: lathe profiles are authored in (radius, y) space with
 * +y = front; rotateX(π/2) maps +Y → +Z, giving a driver that fires along
 * +Z with the mounting flange plane at z = 0. Radial coordinates therefore
 * live in the X/Y plane — exactly what the flex shader's Z-axis falloff and
 * MotionSystem expect.
 *
 * Roles are assigned AT CONSTRUCTION TIME:
 *   moving  — cone, dust cap, voice coil, tinsel leads (rigid, driven)
 *   flex    — surround, spider (vertex-shader bend, never translated)
 *   static  — everything else (never touched by motion)
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DriverStudioConfig, ComponentId, COMPONENT_LABELS } from './config';
import { Datums } from './datums';
import { studioMaterial, cavityMaterial, MaterialPresetKey } from './materials';

export type PartRole = 'moving' | 'flex' | 'static';

export interface PartBuild {
  id: ComponentId;
  name: string;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  role: PartRole;
  explodeOffset: THREE.Vector3;
}

const MM = 1 / 1000;

// ---------------------------------------------------------------- helpers

/** Lathe a (radius, y) profile; +y becomes +z (driver axis). */
function lathe(profile: [number, number][], segments = 96, phiStart = 0, phiLength = Math.PI * 2): THREE.LatheGeometry {
  const v = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-5), z));
  const geo = new THREE.LatheGeometry(v, segments, phiStart, phiLength);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** Closed shell: outer surface forward + inner surface back, welded at ends. */
function shell(profile: [number, number][], thickness: number, segments = 96): THREE.LatheGeometry {
  const back = profile.map(([r, z]) => [r, z - thickness] as [number, number]).reverse();
  return lathe([...profile, ...back], segments);
}

/** Chamfered rectangular ring cross-section (plates, gaskets, flanges). */
function ringProfile(
  rIn: number, rOut: number, z0: number, z1: number, chamfer = 0,
): [number, number][] {
  const c = Math.min(chamfer, (rOut - rIn) / 2.2, (z1 - z0) / 2.2);
  const pts: [number, number][] = [];
  if (c > 1e-5) {
    pts.push([rIn + c, z0], [rOut - c, z0], [rOut, z0 + c], [rOut, z1 - c], [rOut - c, z1], [rIn + c, z1], [rIn, z1 - c], [rIn, z0 + c]);
  } else {
    pts.push([rIn, z0], [rOut, z0], [rOut, z1], [rIn, z1]);
  }
  return pts;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Circumferential feature (ribs, clamp rings) centered at r, z. */
function rib(rCenter: number, zCenter: number, rHalf: number, zHalf: number, segments = 96): THREE.LatheGeometry {
  return lathe([
    [rCenter - rHalf, zCenter], [rCenter, zCenter + zHalf], [rCenter + rHalf, zCenter],
    [rCenter, zCenter - zHalf],
  ], segments);
}

// cone curve: radius at parameter u (0=edge → 1=neck)
function coneRadiusAt(d: Datums, u: number): number {
  return d.coneR + (d.coneNeckR - d.coneR) * u;
}
function coneZAt(d: Datums, u: number): number {
  return d.zConeEdge - d.coneDepth * Math.pow(u, d.coneProfileExp);
}

// ---------------------------------------------------------------- CONE

function buildCone(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial(cfg.coneMaterial as MaterialPresetKey, cfg.coneColor, cfg.coneFinish);
  const meshes: THREE.Mesh[] = [];

  // main shell — 26-point profile with a rolled outer edge and neck land
  const prof: [number, number][] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    prof.push([coneRadiusAt(d, u), coneZAt(d, u)]);
  }
  // outer attachment lip (wraps slightly under the surround)
  prof.unshift([d.coneR + 0.8 * MM, d.zConeEdge - 1.2 * MM]);
  prof.unshift([d.coneR + 0.8 * MM, d.zConeEdge + 0.6 * MM]);
  // neck land — short parallel section joining the former
  prof.push([d.coneNeckR, d.zConeTip - 1.5 * MM]);
  prof.push([d.coneNeckR - 0.4 * MM, d.zConeTip - 3.2 * MM]);
  const body = mesh(shell(prof, cfg.coneThicknessMM * MM, 128), mat, 'cone_body');
  meshes.push(body);
  g.add(body);

  // stiffening ribs following the front surface
  for (const u of [0.3, 0.58, 0.8]) {
    const rr = coneRadiusAt(d, u);
    const zz = coneZAt(d, u) + 0.7 * MM;
    const geo = rib(rr, zz, 1.5 * MM, 0.9 * MM, 128);
    const ribM = mesh(geo, mat, `cone_rib_${u}`);
    meshes.push(ribM);
    g.add(ribM);
  }

  // neck reinforcement collar
  const collar = mesh(lathe(ringProfile(
    d.coneNeckR - 1.2 * MM, d.coneNeckR + 1.6 * MM, d.zConeTip - 4.5 * MM, d.zConeTip - 1 * MM, 0.4 * MM,
  ), 96), mat, 'cone_neck_collar');
  meshes.push(collar);
  g.add(collar);

  return { id: 'cone', name: COMPONENT_LABELS.cone, group: g, meshes, role: 'moving', explodeOffset: new THREE.Vector3(0, 0, 0.030) };
}

// ---------------------------------------------------------------- DUST CAP

function buildDustCap(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial(cfg.dustCapMaterial === 'rubber' ? 'rubber' : cfg.dustCapMaterial as MaterialPresetKey, cfg.dustCapColor, cfg.dustCapFinish);
  const meshes: THREE.Mesh[] = [];
  const R = d.capR;
  const H = Math.max(0.5 * MM, cfg.dustCapHeightMM * MM);
  const zBase = d.zConeTip + 0.8 * MM;

  let prof: [number, number][];
  switch (cfg.dustCapShape) {
    case 'flat':
      prof = [[R, zBase], [R * 0.86, zBase + H * 0.06], [R * 0.4, zBase + H * 0.12], [0.02 * MM, zBase + H * 0.15]];
      break;
    case 'inverted':
      prof = [[R, zBase], [R * 0.9, zBase - H * 0.12], [R * 0.5, zBase - H * 0.62], [0.02 * MM, zBase - H * 0.9]];
      break;
    case 'shallow':
      prof = [[R, zBase], [R * 0.88, zBase + H * 0.45], [R * 0.55, zBase + H * 0.8], [0.02 * MM, zBase + H]];
      break;
    default: { // dome — spherical cap
      prof = [];
      const M = 16;
      for (let i = 0; i <= M; i++) {
        const t = i / M;
        const a = t * Math.PI / 2;
        prof.push([R * Math.cos(a) * (1 - 0.04 * Math.sin(a)), zBase + H * Math.sin(a) * (0.94 + 0.06 * t)]);
      }
    }
  }
  const body = mesh(shell(prof, 0.9 * MM, 96), mat, 'dustcap_body');
  meshes.push(body);
  g.add(body);

  // attachment skirt tucks behind the cone neck
  const skirt = mesh(lathe([[R + 0.9 * MM, zBase - 0.4 * MM], [R + 0.4 * MM, zBase - 2.6 * MM]], 96), mat, 'dustcap_skirt');
  meshes.push(skirt);
  g.add(skirt);

  return { id: 'dustcap', name: COMPONENT_LABELS.dustcap, group: g, meshes, role: 'moving', explodeOffset: new THREE.Vector3(0, 0, 0.046) };
}

// ---------------------------------------------------------------- SURROUND

function buildSurround(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial(cfg.surroundMaterial as MaterialPresetKey, cfg.surroundColor, 'matte');
  const meshes: THREE.Mesh[] = [];

  const rIn = d.surroundInnerR;
  const rOut = d.surroundOuterR;
  const W = rOut - rIn;
  const rollH = Math.max(1.5 * MM, cfg.rollHeightMM * MM);
  const zInner = d.zConeEdge + 0.4 * MM;              // glued to the cone front edge
  const zOuter = d.flangeT - 0.4 * MM;                // glued to the flange top
  const crown = Math.max(zInner, zOuter) + rollH;

  const prof: [number, number][] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = rIn + t * W;
    let z: number;
    switch (cfg.rollProfile) {
      case 'flat': {
        // trapezoid crown: fast rise, flat top, drop to the outer foot
        z = t < 0.22 ? zInner + (crown - zInner) * (t / 0.22) * 0.96
          : t < 0.78 ? crown
            : zOuter + (crown - zOuter) * (1 - (t - 0.78) / 0.22) * 0.96;
        break;
      }
      case 'wroll': {
        const s = Math.sin(t * Math.PI * 2);
        z = (t < 0.5 ? zInner : zOuter) + (crown - Math.max(zInner, zOuter)) * Math.abs(s) * 0.9 + Math.sin(t * Math.PI) * rollH * 0.28;
        break;
      }
      default: { // halfroll — semicircular bead
        const arc = Math.sin(t * Math.PI);
        const rise = Math.pow(arc, 0.82);
        const base = zInner + (zOuter - zInner) * t;
        z = base + (crown - Math.max(zInner, zOuter)) * rise * 0.92 + rollH * 0.18 * Math.sin(t * Math.PI);
      }
    }
    prof.push([r, z]);
  }
  // feet: inner overlaps the cone rim, outer lands on the flange
  prof.unshift([rIn - 0.9 * MM, zInner - 1.4 * MM]);
  prof.push([rOut + 0.6 * MM, zOuter - 0.8 * MM]);

  const body = mesh(shell(prof, Math.max(0.5 * MM, cfg.rollThicknessMM * MM), 128), mat, 'surround_roll');
  meshes.push(body);
  g.add(body);

  return { id: 'surround', name: COMPONENT_LABELS.surround, group: g, meshes, role: 'flex', explodeOffset: new THREE.Vector3(0, 0, 0.017) };
}

// ---------------------------------------------------------------- VOICE COIL

function buildVoiceCoil(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const formerMat = studioMaterial(cfg.coilMaterial === 'aluminum' ? 'aluminum' : 'polypropylene', '#b9b9b9', 'satin');
  const wireMat = studioMaterial(cfg.coilMaterial === 'aluminum' ? 'aluminum' : 'copper', cfg.coilColor, 'satin');
  const meshes: THREE.Mesh[] = [];

  // former tube: from inside the neck joint down past the winding
  const zTop = d.zConeTip - 2.0 * MM;
  const zBot = d.zFormerBot;
  (formerMat as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
  const former = mesh(shell(
    [[d.formerOuterR, zTop], [d.formerOuterR, zBot]], cfg.formerThicknessMM * MM, 96,
  ), formerMat, 'vc_former');
  meshes.push(former);
  g.add(former);

  // winding: visible layer bands, outermost at full winding radius
  const layers = Math.max(1, Math.round(cfg.windingLayers));
  const bandH = (d.zWindTop - d.zWindBot) / layers;
  const bandT = (d.windOuterR - d.windInnerR) / layers;
  for (let i = 0; i < layers; i++) {
    const rOut = d.windOuterR - i * bandT;
    const rIn = rOut - bandT * 0.92;
    const zA = d.zWindTop - i * bandH - 0.15 * MM;
    const zB = zA - bandH + 0.3 * MM;
    const band = mesh(lathe(ringProfile(rIn, rOut, zB, zA, Math.min(0.2 * MM, bandT / 4)), 112),
      wireMat, `vc_winding_${i + 1}`);
    meshes.push(band);
    g.add(band);
  }

  // top collar (epoxy capture ring) + bottom lead-out stubs
  const collar = mesh(lathe(ringProfile(d.formerOuterR, d.formerOuterR + 1.1 * MM, d.zWindTop, d.zWindTop + 1.8 * MM, 0.3 * MM), 96),
    studioMaterial('aluminum', '#cfcfcf', 'satin'), 'vc_collar');
  meshes.push(collar);
  g.add(collar);
  for (const s of [-1, 1]) {
    const stub = mesh(new RoundedBoxGeometry(2.2 * MM, 1.2 * MM, 5 * MM, 2, 0.4 * MM),
      wireMat, `vc_leadout_${s}`);
    stub.position.set(s * d.formerOuterR * 0.85, 0, d.zWindBot + 1.5 * MM);
    meshes.push(stub);
    g.add(stub);
  }

  return { id: 'voicecoil', name: COMPONENT_LABELS.voicecoil, group: g, meshes, role: 'moving', explodeOffset: new THREE.Vector3(0, 0, -0.027) };
}

// ---------------------------------------------------------------- SPIDER

function buildSpider(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  if (cfg.spiderOuterDiameterMM <= 0) {
    return { id: 'spider', name: COMPONENT_LABELS.spider, group: g, meshes: [], role: 'flex', explodeOffset: new THREE.Vector3() };
  }
  const mat = studioMaterial(cfg.spiderMaterial as MaterialPresetKey, cfg.spiderColor, 'matte');
  const meshes: THREE.Mesh[] = [];

  const rIn = d.spiderInnerR;
  const rOut = Math.min(d.spiderOuterR, d.spiderShelfR);
  const corr = Math.max(0.4 * MM, cfg.corrugationDepthMM * MM);
  const count = Math.max(3, Math.round(cfg.corrugationCount));
  const zIn = d.zSpider;
  const zOut = d.zSpiderOuter;

  const prof: [number, number][] = [];
  const N = count * 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = rIn + t * (rOut - rIn);
    const pleat = Math.sin(t * Math.PI * count);
    const z = zIn + (zOut - zIn) * Math.pow(t, 0.9) - corr * 0.5 * pleat;
    prof.push([r, z]);
  }
  const body = mesh(shell(prof, 0.45 * MM, 128), mat, 'spider_body');
  (mat as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
  meshes.push(body);
  g.add(body);

  // inner clamp bonded to the former + outer edge foot on the shelf
  const clamp = mesh(lathe(ringProfile(rIn - 0.8 * MM, rIn + 1.6 * MM, zIn - 2.4 * MM, zIn + 1.2 * MM, 0.4 * MM), 96),
    mat, 'spider_clamp');
  meshes.push(clamp);
  g.add(clamp);
  const foot = mesh(lathe(ringProfile(rOut - 1.6 * MM, rOut + 1.2 * MM, zOut - 1.6 * MM, zOut + 0.9 * MM, 0.4 * MM), 96),
    mat, 'spider_foot');
  meshes.push(foot);
  g.add(foot);

  return { id: 'spider', name: COMPONENT_LABELS.spider, group: g, meshes, role: 'flex', explodeOffset: new THREE.Vector3(0, 0, -0.015) };
}

// ---------------------------------------------------------------- MAGNET

function buildMagnet(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial(cfg.magnetMaterial === 'neodymium' ? 'neodymium' : 'ferrite', undefined, 'matte');
  const meshes: THREE.Mesh[] = [];
  const layers = Math.max(1, Math.round(cfg.magnetLayers));
  const layerH = d.magnetHTotal / layers;

  if (cfg.magnetMaterial === 'neodymium') {
    const slug = mesh(shell([
      [d.poleR + 3.5 * MM, d.zMagTop], [d.magnetR, d.zMagTop], [d.magnetR, d.zMagBot], [d.poleR + 3.5 * MM, d.zMagBot],
    ], 0, 96), mat, 'magnet_slug');
    meshes.push(slug);
    g.add(slug);
  } else {
    for (let i = 0; i < layers; i++) {
      const z1 = d.zMagTop - i * layerH;
      const z0 = z1 - layerH + (i < layers - 1 ? 0.3 * MM : 0); // paper separator lines
      const ring = mesh(lathe(ringProfile(d.magnetInnerR, d.magnetR, z0, z1, Math.min(1.5 * MM, layerH / 4)), 112), mat, `magnet_layer_${i + 1}`);
      meshes.push(ring);
      g.add(ring);
    }
  }

  return { id: 'magnet', name: COMPONENT_LABELS.magnet, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3(0, 0, -0.052) };
}

// ---------------------------------------------------------------- MOTOR PLATES

function buildTopPlate(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial('steel', undefined, 'satin');
  const meshes: THREE.Mesh[] = [];
  const bore = d.windOuterR + 0.7 * MM;   // plate bore clears the winding
  const plate = mesh(lathe(ringProfile(bore, d.plateR, d.zTPBack, d.zTPFront, 0.9 * MM), 112), mat, 'top_plate');
  meshes.push(plate);
  g.add(plate);
  return { id: 'topPlate', name: COMPONENT_LABELS.topPlate, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3(0, 0, -0.040) };
}

function buildBottomPlate(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial('steel', undefined, 'satin');
  const meshes: THREE.Mesh[] = [];
  const zTop = d.zMagBot - 0.8 * MM;
  const bore = d.poleR + 0.4 * MM;
  const plate = mesh(lathe(ringProfile(bore, d.plateR, d.zBPBot, zTop, 0.9 * MM), 112), mat, 'bottom_plate');
  meshes.push(plate);
  g.add(plate);
  return { id: 'bottomPlate', name: COMPONENT_LABELS.bottomPlate, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3(0, 0, -0.064) };
}

function buildPole(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial('steel', undefined, 'satin');
  const meshes: THREE.Mesh[] = [];
  const zBot = d.zBPBot - 1.5 * MM;

  // column with a slightly domed, chamfered front
  const body = mesh(lathe([
    [d.poleR, zBot], [d.poleR, d.zPoleFront - 1.2 * MM],
    [d.poleR - 0.5 * MM, d.zPoleFront - 0.3 * MM], [d.poleR - 1.4 * MM, d.zPoleFront],
    [0.05 * MM, d.zPoleFront],
  ], 96), mat, 'pole_body');
  meshes.push(body);
  g.add(body);

  if (cfg.poleVent) {
    // vent: recessed dark bore + flared mouth ring on the front face
    const ventR = Math.max(2.5 * MM, d.poleR * 0.38);
    const bore = mesh(new THREE.CylinderGeometry(ventR, ventR, (d.zPoleFront - zBot) * 0.98, 40, 1, true).rotateX(Math.PI / 2),
      cavityMaterial(), 'pole_vent_bore');
    bore.position.z = (d.zPoleFront + zBot) / 2;
    meshes.push(bore);
    g.add(bore);
    const mouth = mesh(lathe(ringProfile(ventR, ventR + 1.6 * MM, d.zPoleFront - 1.4 * MM, d.zPoleFront + 0.4 * MM, 0.4 * MM), 64),
      mat, 'pole_vent_mouth');
    meshes.push(mouth);
    g.add(mouth);
  }

  return { id: 'pole', name: COMPONENT_LABELS.pole, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3(0, 0, -0.078) };
}

// ---------------------------------------------------------------- BASKET

function buildBasket(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const cast = cfg.basketMaterial === 'castAluminum';
  const mat = studioMaterial(cast ? 'castAluminum' : 'stampedSteel', cfg.basketColor, cast ? 'satin' : 'matte');
  const meshes: THREE.Mesh[] = [];
  const t = Math.max(1.2 * MM, cfg.frameThicknessMM * MM);
  const flangeT = d.flangeT;
  const flangeIn = Math.min(d.flangeInnerR + 1.2 * MM, d.surroundOuterR + 2.2 * MM);
  const shelfR = d.spiderShelfR;
  const rearR = d.basketRearR;
  const zShelf = d.zSpiderOuter - 1.6 * MM;
  const zRear = d.zRearRing;
  const spokes = Math.max(3, Math.round(cfg.spokeCount));

  // 1) mounting flange (full ring, countersunk top)
  const flange = mesh(lathe(ringProfile(flangeIn, d.flangeR, 0, flangeT, 0.9 * MM), 128), mat, 'basket_flange');
  meshes.push(flange);
  g.add(flange);
  // gasket seat step under the flange
  const seat = mesh(lathe(ringProfile(flangeIn - 1.2 * MM, flangeIn + 0.2 * MM, -1.2 * MM, 0.2 * MM, 0.3 * MM), 96), mat, 'basket_seat');
  meshes.push(seat);
  g.add(seat);

  // 2) windowed shells: N arc segments between spokes (real openings)
  const bandOuter: [number, number][] = [
    [flangeIn, flangeT], [shelfR + t, zShelf + t * 0.4], [rearR, zRear + t],
  ];
  const winCount = spokes;
  const gapFrac = cast ? 0.34 : 0.42;            // fraction of pitch occupied by the window
  const pitch = (Math.PI * 2) / winCount;
  for (let i = 0; i < winCount; i++) {
    const center = pitch * (i + 0.5);
    const half = pitch * gapFrac / 2;
    const seg = mesh(lathe(bandOuter, 18, center - half, half * 2), mat, `basket_window_${i}`);
    seg.material = mat;
    meshes.push(seg);
    g.add(seg);
  }

  // 3) shelf ring under the spider (full ring)
  const shelf = mesh(lathe(ringProfile(shelfR - t, shelfR + 2.4 * MM, zShelf - t, zShelf + t * 0.6, 0.8 * MM), 112), mat, 'basket_shelf');
  meshes.push(shelf);
  g.add(shelf);
  // spider landing ledge
  const ledge = mesh(lathe(ringProfile(d.spiderOuterR - 0.4 * MM, shelfR + 2.4 * MM, zShelf - 0.9 * MM, zShelf + 0.5 * MM, 0.4 * MM), 112),
    mat, 'basket_shelf_ledge');
  meshes.push(ledge);
  g.add(ledge);

  // 4) rear ring wrapping the magnet + vent lip
  const rear = mesh(lathe(ringProfile(rearR - t, rearR + 1.6 * MM, zRear - 5 * MM, zRear + t, 0.8 * MM), 112), mat, 'basket_rear_ring');
  meshes.push(rear);
  g.add(rear);
  const rearLip = mesh(lathe(ringProfile(rearR - t, rearR + 3.2 * MM, zRear - 5 * MM, zRear - 3.4 * MM, 0.5 * MM), 96), mat, 'basket_rear_lip');
  meshes.push(rearLip);
  g.add(rearLip);

  // 5) spokes: rounded bridges across the windows, connecting flange → rear ring
  const spokeW = Math.max(2 * MM, cfg.spokeWidthMM * MM);
  for (let i = 0; i < winCount; i++) {
    const a = pitch * i;
    // exact endpoints on the flange ring and the rear ring, oriented by quaternion
    const pTop = new THREE.Vector3(Math.cos(a) * flangeIn, Math.sin(a) * flangeIn, flangeT - t * 0.4);
    const pBot = new THREE.Vector3(Math.cos(a) * (rearR - t * 0.2), Math.sin(a) * (rearR - t * 0.2), zRear + t);
    const dir = pBot.clone().sub(pTop);
    const len = dir.length();
    const spoke = mesh(new RoundedBoxGeometry(spokeW, t * 1.25, len, 2, Math.min(spokeW, t) * 0.3), mat, `basket_spoke_${i}`);
    spoke.position.copy(pTop).add(pBot).multiplyScalar(0.5);
    spoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    meshes.push(spoke);
    g.add(spoke);
  }

  return { id: 'basket', name: COMPONENT_LABELS.basket, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3() };
}

// ---------------------------------------------------------------- GASKET

function buildGasket(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial('gasket', cfg.surroundColor, 'matte');
  const meshes: THREE.Mesh[] = [];
  const t = Math.max(0.6 * MM, cfg.gasketThicknessMM * MM);
  const rIn = Math.max(d.surroundOuterR - 0.4 * MM, d.surroundInnerR + 2 * MM);
  const rOut = d.flangeR - 0.5 * MM;
  const gasket = mesh(lathe(ringProfile(rIn, rOut, d.flangeT - 0.3 * MM, d.flangeT + t, 0.6 * MM), 128), mat, 'gasket_ring');
  meshes.push(gasket);
  g.add(gasket);
  return { id: 'gasket', name: COMPONENT_LABELS.gasket, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3(0, 0, 0.009) };
}

// ---------------------------------------------------------------- TERMINALS

function buildTerminals(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const bodyMat = studioMaterial('polypropylene', '#141414', 'matte');
  const postMat = studioMaterial('chrome', undefined, 'gloss');
  const meshes: THREE.Mesh[] = [];

  // mount low on the rear band, at -Y, facing outward
  const a = -Math.PI / 2;
  const rr = d.basketRearR - 1.5 * MM;
  const z = d.zRearRing - 6 * MM;
  const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), -0.35).normalize();

  if (cfg.terminalType === 'cup') {
    const cup = mesh(new THREE.CylinderGeometry(11 * MM, 12.5 * MM, 6 * MM, 40).rotateX(Math.PI / 2), bodyMat, 'terminal_cup');
    cup.position.set(dir.x * (rr + 5 * MM), dir.y * (rr + 5 * MM), z + 4 * MM);
    cup.rotation.y = a + Math.PI / 2;
    cup.rotateX(0.3);
    meshes.push(cup);
    g.add(cup);
    for (const s of [-1, 1]) {
      const sock = mesh(new THREE.CylinderGeometry(2.1 * MM, 2.1 * MM, 3.4 * MM, 20).rotateX(Math.PI / 2), postMat, `terminal_socket_${s}`);
      sock.position.set(cup.position.x + s * 4.6 * MM * Math.cos(a + Math.PI / 2), cup.position.y + s * 4.6 * MM * Math.sin(a + Math.PI / 2), cup.position.z + 2.6 * MM);
      sock.rotation.copy(cup.rotation);
      meshes.push(sock);
      g.add(sock);
    }
  } else {
    const block = mesh(new RoundedBoxGeometry(26 * MM, 12 * MM, 9 * MM, 2, 1.2 * MM), bodyMat, 'terminal_block');
    block.position.set(dir.x * (rr + 4.5 * MM), dir.y * (rr + 4.5 * MM), z + 5 * MM);
    block.rotation.z = a + Math.PI / 2;
    block.rotateX(-0.22);
    meshes.push(block);
    g.add(block);
    // + and − push posts with polarity rings
    for (const s of [-1, 1]) {
      const px = block.position.x + s * 6.5 * MM * Math.cos(a + Math.PI / 2);
      const py = block.position.y + s * 6.5 * MM * Math.sin(a + Math.PI / 2);
      const post = mesh(new THREE.CylinderGeometry(1.6 * MM, 1.6 * MM, 8 * MM, 16).rotateX(Math.PI / 2), postMat, `terminal_post_${s}`);
      post.position.set(px, py, block.position.z + 5.2 * MM);
      post.rotation.copy(block.rotation);
      meshes.push(post);
      g.add(post);
      const ring = mesh(new THREE.TorusGeometry(2.6 * MM, 0.55 * MM, 10, 28), postMat, `terminal_ring_${s}`);
      ring.position.copy(post.position);
      ring.position.z += 2.6 * MM;
      ring.rotation.copy(block.rotation);
      meshes.push(ring);
      g.add(ring);
    }
  }

  return { id: 'terminals', name: COMPONENT_LABELS.terminals, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3(0, -0.018, -0.020) };
}

// ---------------------------------------------------------------- TINSEL LEADS

function buildLeads(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial('copper', cfg.leadColor, 'satin');
  const meshes: THREE.Mesh[] = [];

  // from the terminal area, arcing up to the former tail — flexible-looking S-bend
  const a = -Math.PI / 2;
  const rr = d.basketRearR - 3 * MM;
  const startZ = d.zRearRing - 8 * MM;
  const endR = d.formerOuterR + 0.4 * MM;
  const endZ = d.zFormerBot + 3 * MM;
  for (const s of [0.35, -0.35]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr + s * 4 * MM, startZ),
      new THREE.Vector3(Math.cos(a) * (rr * 0.8), Math.sin(a) * (rr * 0.86) + s * 7 * MM, startZ + (endZ - startZ) * 0.3),
      new THREE.Vector3(Math.cos(a) * (endR + 6 * MM), Math.sin(a) * (endR + 7 * MM) + s * 5 * MM, endZ + (startZ - endZ) * 0.18),
      new THREE.Vector3(Math.cos(a) * endR, Math.sin(a) * endR + s * 1.5 * MM, endZ),
    ]);
    const tube = mesh(new THREE.TubeGeometry(curve, 40, 0.8 * MM, 8, false), mat, `tinsel_lead_${s}`);
    meshes.push(tube);
    g.add(tube);
  }

  return { id: 'leads', name: COMPONENT_LABELS.leads, group: g, meshes, role: 'moving', explodeOffset: new THREE.Vector3(0, 0, 0.030) };
}

// ---------------------------------------------------------------- HARDWARE

function buildHardware(d: Datums, cfg: DriverStudioConfig): PartBuild {
  const g = new THREE.Group();
  const mat = studioMaterial('screw', cfg.screwColor, 'satin');
  const meshes: THREE.Mesh[] = [];
  const holes = Math.max(3, Math.round(cfg.mountingHoleCount));
  const screws = Math.max(0, Math.round(cfg.screwCount));

  // mounting hole markers (countersunk bores)
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2;
    const hole = mesh(new THREE.CylinderGeometry(2.4 * MM, 2.4 * MM, d.flangeT + 0.6 * MM, 18).rotateX(Math.PI / 2),
      cavityMaterial(), `mount_hole_${i}`);
    hole.position.set(Math.cos(a) * d.holeR, Math.sin(a) * d.holeR, d.flangeT / 2);
    meshes.push(hole);
    g.add(hole);
  }

  // hex flange screws into every hole that has a screw assigned
  for (let i = 0; i < Math.min(screws, holes); i++) {
    const a = (i / holes) * Math.PI * 2;
    const head = mesh(new THREE.CylinderGeometry(3.1 * MM, 3.4 * MM, 2.2 * MM, 6).rotateX(Math.PI / 2), mat, `screw_${i}`);
    head.position.set(Math.cos(a) * d.holeR, Math.sin(a) * d.holeR, d.flangeT + 1.0 * MM);
    meshes.push(head);
    g.add(head);
    const washer = mesh(new THREE.CylinderGeometry(4.2 * MM, 4.2 * MM, 0.6 * MM, 24).rotateX(Math.PI / 2), mat, `screw_washer_${i}`);
    washer.position.set(Math.cos(a) * d.holeR, Math.sin(a) * d.holeR, d.flangeT + 0.25 * MM);
    meshes.push(washer);
    g.add(washer);
  }

  return { id: 'hardware', name: COMPONENT_LABELS.hardware, group: g, meshes, role: 'static', explodeOffset: new THREE.Vector3(0, 0, 0.023) };
}

// ---------------------------------------------------------------- registry

type Builder = (d: Datums, cfg: DriverStudioConfig) => PartBuild;

export const PART_BUILDERS: Record<ComponentId, Builder> = {
  cone: buildCone,
  dustcap: buildDustCap,
  surround: buildSurround,
  voicecoil: buildVoiceCoil,
  spider: buildSpider,
  magnet: buildMagnet,
  topPlate: buildTopPlate,
  bottomPlate: buildBottomPlate,
  pole: buildPole,
  basket: buildBasket,
  gasket: buildGasket,
  terminals: buildTerminals,
  leads: buildLeads,
  hardware: buildHardware,
};

/** Explode direction magnitudes are scaled with driver size at build time. */
export function scaleExplodeOffset(part: PartBuild, scale: number): void {
  part.explodeOffset.multiplyScalar(scale);
}

/**
 * Sonivex Studio — ULTRA-DETAIL procedural reference subwoofer.
 * Pure black & white edition: every material is neutral grayscale.
 *
 * 15 numbered parts (1-based part #3 = the cone), matching the historic
 * Tripo layout contract: p2 = cone (moving), p3 = dust cap (moving),
 * p5 = surround (deformable). Additional unnumbered dress-up geometry
 * (gasket, feet, tinsel leads, port flare) is added without breaking the
 * 15-slot contract.
 *
 * Built at real scale in meters. Driver axis = +Z (LatheGeometry revolves
 * around Y, so every axial profile is rotated with rotateX(PI/2) to map
 * profile-Y onto world-Z).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getTextures } from './textures';
import { DriverParams, BoxParams } from '../../shared/types';

export interface BuiltPart {
  id: string;
  name: string;
  meshIndex: number;
  object: THREE.Object3D;   // contains one or more meshes
  mesh: THREE.Mesh;         // primary pick target
}

export interface AssemblyBuild {
  root: THREE.Group;
  parts: BuiltPart[];
  coneRadiusM: number;
  axis: 'x' | 'y' | 'z';
}

const M = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

/** lathe with profile mapped onto the +Z driver axis */
function latheZ(pts: [number, number][], segments = 144): THREE.LatheGeometry {
  const v = pts.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z));
  return new THREE.LatheGeometry(v, segments).rotateX(Math.PI / 2);
}

/** chamfered disc facing +Z */
function chamferDiscZ(r: number, rTop: number, h: number, seg = 80): THREE.LatheGeometry {
  return latheZ([
    [r, -h / 2], [r, -h * 0.32], [rTop, -h * 0.12], [rTop, h * 0.12], [r, h * 0.32], [r, h / 2],
  ], seg);
}

/** rectangular plate with a circular driver cutout, thickness along +Z */
function holedPlateZ(w: number, h: number, depth: number, holeR: number, seg = 96): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath();
  const hole = new THREE.Path();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.cos(a) * holeR, y = Math.sin(a) * holeR;
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
  }
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.0018, bevelSize: 0.0018, bevelSegments: 2, curveSegments: 6,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

export function buildProceduralSubwoofer(driver: DriverParams, box: BoxParams): AssemblyBuild {
  const tex = getTextures();
  const root = new THREE.Group();
  root.name = 'SonivexReferenceSub';
  const parts: BuiltPart[] = [];
  let idx = 0;
  const add = (name: string, obj: THREE.Object3D, mesh: THREE.Mesh) => {
    obj.name = `sonivex_part_${idx}`;
    obj.userData.partId = `p${idx}`;
    root.add(obj);
    parts.push({ id: `p${idx}`, name, meshIndex: idx, object: obj, mesh });
    idx++;
  };
  const tagMeshes = (obj: THREE.Object3D, partId: string) => {
    obj.traverse((c) => { c.userData.partId = partId; });
  };

  // ---- dimensions (meters)
  const coneR = ((driver.effectiveDiameterCM / 100) / 2) + driver.surroundWidthMM / 1000; // outer incl. surround
  const baffleW = Math.max(box.wCM / 100, coneR * 2.6);
  const baffleH = Math.max(box.hCM / 100, coneR * 2.6);
  const cabD = Math.max(box.dCM / 100, 0.30);
  const cy = baffleH / 2;           // driver centerline height
  const zFace = cabD / 2;           // front face z
  const driverZ = zFace + 0.004;    // driver mounting plane (surface mount on the baffle)

  // ---- materials (strictly neutral grayscale)
  const cabinetMat = new THREE.MeshPhysicalMaterial({
    color: '#0f0f0f', roughness: 0.44, metalness: 0.08,
    clearcoat: 0.8, clearcoatRoughness: 0.24,
    normalMap: tex.micro!, normalScale: new THREE.Vector2(0.16, 0.16),
    envMapIntensity: 0.9, side: THREE.DoubleSide,
  });
  const baffleMat = new THREE.MeshPhysicalMaterial({
    color: '#131313', roughness: 0.5, metalness: 0.05,
    normalMap: tex.micro!, normalScale: new THREE.Vector2(0.12, 0.12),
    envMapIntensity: 0.85, side: THREE.DoubleSide,
  });
  const coneMat = new THREE.MeshPhysicalMaterial({
    color: driver.coneColor, roughness: 0.68, metalness: 0.06,
    normalMap: driver.coneMaterial === 'aluminum' ? tex.brushed! : driver.coneMaterial === 'composite' ? tex.weave! : tex.paper!,
    normalScale: new THREE.Vector2(0.5, 0.5),
    envMapIntensity: 0.8, side: THREE.DoubleSide,
  });
  const surroundMat = new THREE.MeshPhysicalMaterial({
    color: '#181818', roughness: 0.86, metalness: 0.0,
    normalMap: tex.rubber!, normalScale: new THREE.Vector2(0.35, 0.35),
    sheen: 0.35, sheenColor: new THREE.Color('#2a2a2a'),
    side: THREE.DoubleSide,
  });
  const capMat = new THREE.MeshPhysicalMaterial({
    color: '#9e9e9e', roughness: 0.18, metalness: 0.92,
    clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.3, side: THREE.DoubleSide,
  });
  const motorMat = new THREE.MeshPhysicalMaterial({   // cast aluminum
    color: '#4b4b4b', roughness: 0.38, metalness: 0.9,
    normalMap: tex.brushed!, normalScale: new THREE.Vector2(0.4, 0.4), side: THREE.DoubleSide,
  });
  const darkMetal = new THREE.MeshPhysicalMaterial({
    color: '#2c2c2c', roughness: 0.5, metalness: 0.85,
    normalMap: tex.brushed!, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide,
  });
  const steelMat = new THREE.MeshPhysicalMaterial({   // polished steel accents (was teal)
    color: '#d6d6d6', roughness: 0.32, metalness: 0.95,
    normalMap: tex.brushed!, normalScale: new THREE.Vector2(0.25, 0.25),
    envMapIntensity: 1.2, side: THREE.DoubleSide,
  });
  const magnetMat = new THREE.MeshPhysicalMaterial({
    color: '#262626', roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide,
  });
  const rubberMat = new THREE.MeshPhysicalMaterial({
    color: '#141414', roughness: 0.92, metalness: 0.0,
    normalMap: tex.rubber!, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide,
  });
  const voidMat = new THREE.MeshStandardMaterial({    // deep recesses / port throats
    color: '#050505', roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
  });

  // ================= Part 1: Enclosure =================
  {
    const g = new THREE.Group();
    // shell: rear section (front is the baffle plate)
    const shellDepth = cabD - 0.024;
    const shell = M(new RoundedBoxGeometry(baffleW, baffleH, shellDepth, 5, 0.024), cabinetMat, 'Enclosure');
    shell.position.set(0, cy, -0.012);
    g.add(shell);
    // front baffle plate with a real driver cutout
    const baffle = M(holedPlateZ(baffleW * 0.96, baffleH * 0.97, 0.026, coneR * 1.005), baffleMat, 'Baffle');
    baffle.position.set(0, cy, zFace - 0.011);
    g.add(baffle);
    // driver rebate collar
    const rebate = M(latheZ([
      [coneR * 1.015, 0.0], [coneR * 1.015, 0.008], [coneR * 1.06, 0.012], [coneR * 1.06, 0.016], [coneR * 1.005, 0.016],
    ], 96), baffleMat, 'Rebate');
    rebate.position.set(0, cy, zFace + 0.003);
    g.add(rebate);
    // gasket ring (static rubber)
    const gasket = M(latheZ([
      [coneR * 1.0, 0.0], [coneR * 1.0, 0.0045], [coneR * 1.02, 0.006], [coneR * 1.02, 0.0],
    ], 96), rubberMat, 'Gasket');
    gasket.position.set(0, cy, zFace + 0.003);
    g.add(gasket);
    // 8 flange bolt bosses around the driver
    const boltR = coneR * 1.045;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const boss = M(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 20).rotateX(Math.PI / 2), steelMat, 'flangeBolt');
      boss.position.set(Math.cos(a) * boltR, cy + Math.sin(a) * boltR, zFace + 0.009);
      g.add(boss);
    }
    // 4 rubber feet
    const footOff = Math.min(baffleW, baffleH) * 0.32;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      const foot = M(new THREE.CylinderGeometry(0.021, 0.024, 0.012, 24), rubberMat, 'Foot');
      foot.position.set(sx * footOff, 0.006, sy * (cabD * 0.34));
      g.add(foot);
    });
    add('Enclosure', g, shell);
    tagMeshes(g, 'p0');
  }

  // ================= Part 2: Driver Motor / Basket =================
  {
    const g = new THREE.Group();
    const flangeR = coneR * 1.04;
    const flange = M(latheZ([
      [coneR * 0.42, -0.004], [coneR * 0.42, 0.02], [coneR * 0.86, 0.026], [flangeR, 0.02], [flangeR, 0.006], [coneR * 0.98, 0.0],
    ], 112), darkMetal, 'Flange');
    g.add(flange);
    // 8 cast spokes with I-beam look
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const web = M(new THREE.BoxGeometry(0.014, 0.012, coneR * 0.45), motorMat, 'spokeWeb');
      web.position.set(Math.cos(a) * coneR * 0.62, Math.sin(a) * coneR * 0.62, -0.068);
      web.rotation.z = a + Math.PI / 2;
      web.rotation.x = 0.30;
      const perpX = Math.cos(a + Math.PI / 2), perpY = Math.sin(a + Math.PI / 2);
      const fl1 = M(new THREE.BoxGeometry(0.004, 0.016, coneR * 0.72), motorMat, 'spokeFlange');
      fl1.position.set(web.position.x + perpX * 0.009, web.position.y + perpY * 0.009, web.position.z);
      fl1.rotation.copy(web.rotation);
      const fl2 = M(new THREE.BoxGeometry(0.004, 0.016, coneR * 0.72), motorMat, 'spokeFlange');
      fl2.position.set(web.position.x - perpX * 0.009, web.position.y - perpY * 0.009, web.position.z);
      fl2.rotation.copy(web.rotation);
      g.add(web, fl1, fl2);
    }
    // spider mount shelf
    const spiderShelf = M(latheZ([
      [coneR * 0.34, -0.066], [coneR * 0.36, -0.058], [coneR * 0.44, -0.054], [coneR * 0.44, -0.066],
    ], 96), motorMat, 'SpiderShelf');
    g.add(spiderShelf);
    // magnet stack (double disc, chamfered)
    const magR = Math.max(driver.magnetDiameterCM / 200, coneR * 0.52);
    const magH = Math.max(driver.magnetHeightCM / 100, 0.028);
    const topPlate = M(chamferDiscZ(magR * 0.94, magR * 0.88, 0.012), motorMat, 'TopPlate');
    topPlate.position.z = -0.075;
    const magA = M(chamferDiscZ(magR, magR * 0.96, magH * 0.52), magnetMat, 'MagnetA');
    magA.position.z = -0.081 - magH * 0.26;
    const magB = M(chamferDiscZ(magR, magR * 0.96, magH * 0.52), magnetMat, 'MagnetB');
    magB.position.z = -0.081 - magH * 0.52 - 0.004 - magH * 0.26;
    const botPlate = M(chamferDiscZ(magR * 0.94, magR * 0.88, 0.012), motorMat, 'BotPlate');
    botPlate.position.z = -0.081 - magH - 0.008;
    g.add(topPlate, magA, magB, botPlate);
    // pole piece bullet + vent
    const poleR = magR * 0.34;
    const poleBack = -0.086 - magH;
    const pole = M(latheZ([
      [0.0001, poleBack - 0.014], [poleR * 0.7, poleBack - 0.012], [poleR, poleBack - 0.006],
      [poleR, poleBack + 0.058], [poleR * 0.92, poleBack + 0.064], [0.0001, poleBack + 0.064],
    ], 72), motorMat, 'Pole');
    g.add(pole);
    const poleVent = M(new THREE.CylinderGeometry(poleR * 0.45, poleR * 0.45, 0.02, 32, 1, true).rotateX(Math.PI / 2), voidMat, 'PoleVent');
    poleVent.position.z = poleBack - 0.006;
    g.add(poleVent);
    const plugRing = M(new THREE.TorusGeometry(magR * 0.96, 0.004, 10, 72), darkMetal, 'PlugRing');
    plugRing.position.z = -0.081 - magH - 0.004;
    g.add(plugRing);
    g.position.set(0, cy, driverZ);
    add('Driver Motor / Basket', g, flange);
    tagMeshes(g, 'p1');
  }

  // ================= Part 3: CONE (motion-ready) =================
  {
    const depth = driver.coneDepthMM / 1000;
    const g = new THREE.Group();
    const profile: [number, number][] = [
      [coneR * 0.985, 0.0],
      [coneR * 0.975, -0.004],
      [coneR * 0.955, -depth * 0.16],
      [coneR * 0.895, -depth * 0.38],
      [coneR * 0.80, -depth * 0.58],
      [coneR * 0.68, -depth * 0.76],
      [coneR * 0.55, -depth * 0.90],
      [coneR * 0.455, -depth * 0.985],
      [coneR * 0.42, -depth],
      [coneR * 0.40, -depth],
    ];
    const cone = M(latheZ(profile, 160), coneMat, 'Cone');
    g.add(cone);
    const rib1 = M(latheZ([
      [coneR * 0.865, -depth * 0.47], [coneR * 0.855, -depth * 0.50], [coneR * 0.808, -depth * 0.615], [coneR * 0.818, -depth * 0.588],
    ], 160), coneMat, 'RibA');
    const rib2 = M(latheZ([
      [coneR * 0.615, -depth * 0.79], [coneR * 0.607, -depth * 0.815], [coneR * 0.566, -depth * 0.90], [coneR * 0.574, -depth * 0.878],
    ], 160), coneMat, 'RibB');
    g.add(rib1, rib2);
    const collar = M(new THREE.CylinderGeometry(coneR * 0.40, coneR * 0.40, 0.010, 96, 1, true).rotateX(Math.PI / 2), coneMat, 'Collar');
    collar.position.z = -depth + 0.005;
    g.add(collar);
    g.position.set(0, cy, driverZ + 0.0015);
    add('Cone', g, cone);
    tagMeshes(g, 'p2');
  }

  // ================= Part 4: Dust Cap / Dome =================
  {
    const capR = coneR * driver.dustCapRatio;
    const h = Math.max(driver.dustCapHeight / 1000, 0.012);
    const depth = driver.coneDepthMM / 1000;
    const g = new THREE.Group();
    const cap = M(latheZ([
      [0.0001, h], [capR * 0.38, h * 0.92], [capR * 0.68, h * 0.66], [capR * 0.88, h * 0.34], [capR, 0.0], [capR * 1.015, -0.005],
    ], 112), capMat, 'DustCap');
    cap.position.z = -depth + 0.004;
    const seam = M(new THREE.TorusGeometry(capR * 1.01, 0.0016, 8, 96), capMat, 'CapSeam');
    seam.position.z = -depth + 0.004;
    g.add(cap, seam);
    g.position.set(0, cy, driverZ + 0.0015);
    add('Dust Cap / Dome', g, cap);
    tagMeshes(g, 'p3');
  }

  // ================= Part 5: Motor Rear Plug =================
  {
    const magR = Math.max(driver.magnetDiameterCM / 200, coneR * 0.52);
    const magH = Math.max(driver.magnetHeightCM / 100, 0.028);
    const g = new THREE.Group();
    const plug = M(chamferDiscZ(magR * 0.97, magR * 0.9, 0.026), darkMetal, 'RearPlug');
    plug.position.set(0, cy, -zFace - 0.013);
    g.add(plug);
    add('Motor Rear Plug', g, plug);
    tagMeshes(g, 'p4');
  }

  // ================= Part 6: Surround Ring (deformable) =================
  {
    const w = driver.surroundWidthMM / 1000;
    const rIn = coneR * 0.985, rOut = rIn + w;
    const rollPts: [number, number][] = [];
    const N = 36;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      rollPts.push([rIn + t * w, Math.sin(t * Math.PI) * w * 0.95 - w * 0.30]);
    }
    rollPts.push([rOut + 0.006, -w * 0.34], [rOut + 0.006, -w * 0.40]);
    const roll = M(latheZ(rollPts, 160), surroundMat, 'Surround');
    const g = new THREE.Group();
    g.add(roll);
    g.position.set(0, cy, driverZ + 0.0015);
    add('Surround Ring', g, roll);
    tagMeshes(g, 'p5');
  }

  // ================= Parts 7-10: Side vents =================
  const ventNames = ['Side Vent L-Upper', 'Side Vent L-Lower', 'Side Vent R-Upper', 'Side Vent R-Lower'];
  ventNames.forEach((name, i) => {
    const upper = i % 2 === 0;
    const side = i < 2 ? -1 : 1;
    const g = new THREE.Group();
    const vr = 0.032 + 0.006 * (upper ? 1 : 0);
    const tube = M(new THREE.CylinderGeometry(vr, vr, 0.014, 40).rotateZ(Math.PI / 2), darkMetal, name);
    tube.position.set(side * baffleW / 2 - side * 0.002, baffleH * (upper ? 0.55 : 0.42), cabD * (i < 2 ? -0.66 : 0.66) * 0.47);
    const bezel = M(new THREE.TorusGeometry(vr + 0.002, 0.0035, 12, 48).rotateY(Math.PI / 2), steelMat, name + '_bezel');
    bezel.position.copy(tube.position);
    const grill = M(new THREE.CircleGeometry(vr - 0.002, 32).rotateY(Math.PI / 2 * (side > 0 ? -1 : 1)), voidMat, name + '_grill');
    grill.position.set(side * baffleW / 2 + side * 0.006, tube.position.y, tube.position.z);
    g.add(tube, bezel, grill);
    add(name, g, tube);
    tagMeshes(g, `p${idx - 1}`);
  });

  // ================= Parts 11-12: Trim details =================
  ['Trim Detail A', 'Trim Detail B'].forEach((name, i) => {
    const g = new THREE.Group();
    const strip = M(new RoundedBoxGeometry(0.014, 0.10, 0.018, 2, 0.004), steelMat, name);
    strip.position.set(baffleW * (i === 0 ? 0.30 : 0.36), baffleH * (i === 0 ? 0.74 : 0.70), cabD / 2 * (i === 0 ? 1 : -1) * 0.86);
    g.add(strip);
    for (let s = 0; s < 2; s++) {
      const screw = M(new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 12).rotateX(Math.PI / 2), darkMetal, name + '_screw');
      screw.position.set(strip.position.x, strip.position.y + (s === 0 ? 0.038 : -0.038), strip.position.z + (strip.position.z > 0 ? 0.01 : -0.01));
      g.add(screw);
    }
    add(name, g, strip);
    tagMeshes(g, `p${idx - 1}`);
  });

  // ================= Part 13: Terminal badge =================
  {
    const g = new THREE.Group();
    const plate = M(new RoundedBoxGeometry(0.11, 0.075, 0.012, 2, 0.004), darkMetal, 'TerminalPlate');
    plate.position.set(baffleW * 0.3, baffleH * 0.82, -zFace - 0.006);
    g.add(plate);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      const screw = M(new THREE.CylinderGeometry(0.005, 0.005, 0.005, 14).rotateX(Math.PI / 2), steelMat, 'terminalScrew');
      screw.position.set(plate.position.x + sx * 0.046, plate.position.y + sy * 0.027, plate.position.z - 0.006);
      g.add(screw);
    });
    [[-0.024, '#e8e8e8'], [0.024, '#2c2c2c']].forEach(([dx, col]) => {
      const px = plate.position.x + (dx as number);
      const stud = M(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 20).rotateX(Math.PI / 2), steelMat, 'postStud');
      stud.position.set(px, plate.position.y, plate.position.z - 0.014);
      g.add(stud);
      for (let k = 0; k < 4; k++) {
        const knurl = M(new THREE.TorusGeometry(0.0105, 0.0016, 8, 24), steelMat, 'postKnurl');
        knurl.position.set(px, plate.position.y, plate.position.z - 0.010 - k * 0.0035);
        g.add(knurl);
      }
      const capTop = M(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 20).rotateX(Math.PI / 2),
        new THREE.MeshPhysicalMaterial({ color: col as string, roughness: 0.35, metalness: 0.2, clearcoat: 0.6 }), 'postCap');
      capTop.position.set(px, plate.position.y, plate.position.z - 0.024);
      g.add(capTop);
    });
    add('Terminal Badge', g, plate);
    tagMeshes(g, `p${idx - 1}`);
  }

  // ================= Part 14: Top control strip =================
  {
    const g = new THREE.Group();
    const strip = M(new RoundedBoxGeometry(0.07, 0.007, cabD * 0.5, 2, 0.002), steelMat, 'TopStrip');
    strip.position.set(-baffleW * 0.28, baffleH + 0.002, 0);
    g.add(strip);
    ['#f2f2f2', '#8a8a8a', '#1a1a1a'].forEach((c, k) => {
      const dot = M(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 16),
        new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.25, clearcoat: 1, metalness: 0.1 }), 'indicator');
      dot.position.set(-baffleW * 0.28 + 0.018 + k * 0.016, baffleH + 0.007, 0);
      g.add(dot);
    });
    add('Top Control Strip', g, strip);
    tagMeshes(g, `p${idx - 1}`);
  }

  // ================= Part 15: Micro detail (footer logo medallion) =================
  {
    const g = new THREE.Group();
    const medallion = M(new THREE.CylinderGeometry(0.024, 0.024, 0.004, 48).rotateX(Math.PI / 2), darkMetal, 'LogoDisc');
    medallion.position.set(baffleW * 0.32, 0.016, cabD * 0.3);
    const ring = M(new THREE.TorusGeometry(0.021, 0.0028, 10, 48), steelMat, 'LogoRing');
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(medallion.position).z += 0.002;
    g.add(medallion, ring);
    add('Micro Detail', g, medallion);
    tagMeshes(g, `p${idx - 1}`);
  }

  // ---- ported-box dress-up: front port with double flare ----
  if (box.type === 'ported') {
    const pr = Math.max(box.portDiameterCM / 200, 0.030);
    const px = -baffleW * 0.27, py = baffleH * 0.30;
    const flare = M(latheZ([
      [pr * 1.32, 0.0], [pr * 1.28, 0.006], [pr * 1.10, 0.012], [pr, 0.012], [pr, -0.012], [pr * 1.06, -0.018], [pr * 1.02, -0.018],
    ], 96), baffleMat, 'PortFlare');
    flare.position.set(px, py, zFace + 0.014);
    const throat = M(new THREE.CylinderGeometry(pr, pr, 0.02, 72, 1, true).rotateX(Math.PI / 2), voidMat, 'PortThroat');
    throat.position.set(px, py, zFace - 0.006);
    root.add(flare, throat);
  }

  return { root, parts, coneRadiusM: coneR, axis: 'z' };
}

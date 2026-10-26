/**
 * Procedural reference subwoofer — 15 parts, 1-based part #3 is the cone,
 * matching the user's Tripo model layout (tripo_part_0..14 → parts 1..15).
 * High-detail geometry: lathe profiles with smooth normals, rounded cabinet,
 * rolled surround, motor stack, vents, trim details.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getTextures } from './textures';
import { DriverParams, BoxParams } from '../../shared/types';

export interface BuiltPart {
  id: string;
  name: string;
  meshIndex: number;
  object: THREE.Object3D;   // contains a single mesh
  mesh: THREE.Mesh;
}

export interface AssemblyBuild {
  root: THREE.Group;
  parts: BuiltPart[];
  /** approx cone outer radius (m) for pivot defaults */
  coneRadiusM: number;
  /** driver axis direction (unit) — procedural model fires along +Z */
  axis: 'x' | 'y' | 'z';
}

const M = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

function latheFromPoints(pts: [number, number][], segments = 128): THREE.LatheGeometry {
  const v = pts.map(([x, y]) => new THREE.Vector2(Math.max(x, 1e-4), y));
  return new THREE.LatheGeometry(v, segments);
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
    mesh.userData.partId = `p${idx}`;
    root.add(obj);
    parts.push({ id: `p${idx}`, name, meshIndex: idx, object: obj, mesh });
    idx++;
  };

  // ---- dimensions (meters)
  const coneR = (driver.effectiveDiameterCM / 100) / 2 + driver.surroundWidthMM / 1000; // outer incl. surround
  const baffleW = Math.max(box.wCM / 100, coneR * 2.6);
  const baffleH = Math.max(box.hCM / 100, coneR * 2.6);
  const cabD = Math.max(box.dCM / 100, 0.28);
  const driverDepth = 0.12 + driver.magnetHeightCM / 100 + 0.05;

  // ---- materials
  const cabinetMat = new THREE.MeshPhysicalMaterial({
    color: '#0e1116', roughness: 0.42, metalness: 0.1,
    clearcoat: 0.85, clearcoatRoughness: 0.22,
    normalMap: tex.micro!, normalScale: new THREE.Vector2(0.18, 0.18),
    envMapIntensity: 1.0,
  });
  const coneMat = new THREE.MeshPhysicalMaterial({
    color: driver.coneColor, roughness: 0.68, metalness: 0.06,
    normalMap: driver.coneMaterial === 'aluminum' ? tex.brushed! : driver.coneMaterial === 'composite' ? tex.weave! : tex.paper!,
    normalScale: new THREE.Vector2(0.5, 0.5),
    envMapIntensity: 0.8,
  });
  const surroundMat = new THREE.MeshPhysicalMaterial({
    color: '#17191e', roughness: 0.86, metalness: 0.0,
    normalMap: tex.rubber!, normalScale: new THREE.Vector2(0.35, 0.35),
    sheen: 0.4, sheenColor: new THREE.Color('#20242c'),
  });
  const capMat = new THREE.MeshPhysicalMaterial({
    color: '#181c23', roughness: 0.15, metalness: 0.3,
    clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.4,
  });
  const motorMat = new THREE.MeshPhysicalMaterial({
    color: '#3b4048', roughness: 0.34, metalness: 0.92,
    normalMap: tex.brushed!, normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const darkMetal = new THREE.MeshPhysicalMaterial({
    color: '#22262c', roughness: 0.5, metalness: 0.85,
    normalMap: tex.brushed!, normalScale: new THREE.Vector2(0.3, 0.3),
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: '#0e7f8f', roughness: 0.3, metalness: 0.6,
    emissive: '#0aa4bb', emissiveIntensity: 0.25,
  });

  // ================= Part 1: Enclosure =================
  {
    const geo = new RoundedBoxGeometry(baffleW, baffleH, cabD, 5, 0.022);
    const mesh = M(geo, cabinetMat, 'Enclosure');
    mesh.position.set(0, baffleH / 2, 0);
    add('Enclosure', mesh, mesh);
  }

  // baffle plate (visual detail, part of enclosure look but separate slot not needed)
  // ================= Part 2: Driver Motor / Basket =================
  {
    const g = new THREE.Group();
    // frame ring
    const ring = M(new THREE.CylinderGeometry(coneR * 1.04, coneR * 1.02, 0.035, 96, 1, false).rotateX(Math.PI / 2), darkMetal, 'frame');
    ring.position.z = 0.012;
    g.add(ring);
    // basket cone shell
    const basket = M(latheFromPoints([
      [coneR * 0.42, -0.10], [coneR * 0.5, -0.02], [coneR * 0.86, 0.045], [coneR * 1.0, 0.03],
    ], 96), motorMat, 'basket');
    g.add(basket);
    // spokes
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const sp = M(new THREE.BoxGeometry(0.016, 0.012, 0.16), motorMat, 'spoke');
      sp.position.set(Math.cos(a) * coneR * 0.7, Math.sin(a) * coneR * 0.7, -0.03);
      sp.rotation.z = a + Math.PI / 2;
      sp.rotation.x = 0.35;
      g.add(sp);
    }
    // magnet stack (behind)
    const magR = driver.magnetDiameterCM / 200;
    const topPlate = M(new THREE.CylinderGeometry(magR * 0.9, magR * 0.9, 0.012, 64).rotateX(Math.PI / 2), motorMat, 'topPlate');
    topPlate.position.z = -0.115;
    const magnet = M(new THREE.CylinderGeometry(magR, magR, driver.magnetHeightCM / 100, 64).rotateX(Math.PI / 2), darkMetal, 'magnet');
    magnet.position.z = -0.115 - driver.magnetHeightCM / 200 - 0.006;
    const botPlate = M(new THREE.CylinderGeometry(magR * 0.9, magR * 0.9, 0.012, 64).rotateX(Math.PI / 2), motorMat, 'botPlate');
    botPlate.position.z = -0.115 - driver.magnetHeightCM / 100 - 0.012;
    g.add(topPlate, magnet, botPlate);
    // pole vent
    const pole = M(new THREE.CylinderGeometry(magR * 0.32, magR * 0.36, 0.03, 32).rotateX(Math.PI / 2), motorMat, 'pole');
    pole.position.z = -0.115 - driver.magnetHeightCM / 100 - 0.02;
    g.add(pole);
    g.position.z = cabD / 2 - 0.02;
    add('Driver Motor / Basket', g, ring);
  }

  // ================= Part 3: CONE (user-designated) =================
  let coneObj: THREE.Object3D;
  {
    const depth = driver.coneDepthMM / 1000;
    const g = new THREE.Group();
    // cone profile: outer rim → apex plateau
    const profile: [number, number][] = [
      [coneR * 0.985, 0.0],
      [coneR * 0.96, -depth * 0.25],
      [coneR * 0.80, -depth * 0.62],
      [coneR * 0.55, -depth * 0.88],
      [coneR * 0.40, -depth],
      [coneR * 0.38, -depth],
    ];
    const cone = M(latheFromPoints(profile, 128), coneMat, 'Cone');
    g.add(cone);
    // stiffening rib
    const rib = M(latheFromPoints([
      [coneR * 0.86, -depth * 0.5], [coneR * 0.845, -depth * 0.52], [coneR * 0.795, -depth * 0.655], [coneR * 0.81, -depth * 0.635],
    ], 128), coneMat, 'rib');
    g.add(rib);
    coneObj = g;
    g.position.z = cabD / 2 + 0.008;
    add('Cone', g, cone);
  }

  // ================= Part 4: Dust Cap / Dome =================
  {
    const capR = coneR * driver.dustCapRatio;
    const h = driver.dustCapHeight / 1000;
    const geo = latheFromPoints([
      [0.0001, h], [capR * 0.45, h * 0.86], [capR * 0.8, h * 0.52], [capR, 0.0], [capR * 1.02, -0.004],
    ], 96);
    const cap = M(geo, capMat, 'DustCap');
    cap.position.z = -driver.coneDepthMM / 1000 + 0.004;
    const g = new THREE.Group();
    g.add(cap);
    g.position.z = cabD / 2 + 0.008;
    add('Dust Cap / Dome', g, cap);
  }

  // ================= Part 5: Motor Rear Plug =================
  {
    const plug = M(new THREE.CylinderGeometry(coneR * 0.36, coneR * 0.42, 0.03, 64).rotateX(Math.PI / 2), darkMetal, 'RearPlug');
    plug.position.set(0, 0, -cabD / 2 - 0.005);
    add('Motor Rear Plug', plug, plug);
  }

  // ================= Part 6: Surround Ring (deformable) =================
  let surroundObj: THREE.Object3D;
  {
    const w = driver.surroundWidthMM / 1000;
    const rollPts: [number, number][] = [];
    const rIn = coneR * 0.985, rOut = rIn + w;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const r = rIn + t * w;
      const z = Math.sin(t * Math.PI) * w * 0.92 - w * 0.28;
      rollPts.push([r, z]);
    }
    const geo = latheFromPoints(rollPts, 128);
    const roll = M(geo, surroundMat, 'Surround');
    const g = new THREE.Group();
    g.add(roll);
    g.position.z = cabD / 2 + 0.008;
    surroundObj = g;
    add('Surround Ring', g, roll);
  }

  // ================= Parts 7-10: Side vents =================
  const ventNames = ['Side Vent L-Upper', 'Side Vent L-Lower', 'Side Vent R-Upper', 'Side Vent R-Lower'];
  ventNames.forEach((name, i) => {
    const upper = i % 2 === 0;
    const side = i < 2 ? -1 : 1;
    const v = M(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 32).rotateZ(Math.PI / 2), darkMetal, name);
    v.position.set(side * baffleW / 2 - side * 0.002, baffleH * (upper ? 0.52 : 0.44), cabD * (i < 2 ? -0.72 : 0.72) * 0.47);
    const ringA = M(new THREE.TorusGeometry(0.036, 0.004, 12, 32).rotateY(Math.PI / 2), accentMat, name + '_ring');
    ringA.position.copy(v.position);
    const g = new THREE.Group();
    g.add(v, ringA);
    add(name, g, v);
  });

  // ================= Parts 11-12: Trim details =================
  ['Trim Detail A', 'Trim Detail B'].forEach((name, i) => {
    const strip = M(new THREE.BoxGeometry(0.012, 0.09, 0.02), accentMat, name);
    strip.position.set(baffleW * 0.28 * (i === 0 ? 1 : 1.25), baffleH * 0.72, cabD / 2 * (i === 0 ? 1 : -1) * 0.86);
    const g = new THREE.Group();
    g.add(strip);
    add(name, g, strip);
  });

  // ================= Part 13: Terminal badge =================
  {
    const plate = M(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 48).rotateX(Math.PI / 2), darkMetal, 'TerminalBadge');
    plate.position.set(baffleW * 0.3, baffleH * 0.78, -cabD / 2 - 0.004);
    const screws = M(new THREE.CylinderGeometry(0.006, 0.006, 0.016, 12).rotateX(Math.PI / 2), motorMat, 'screws');
    screws.position.copy(plate.position).z -= 0.002;
    const g = new THREE.Group();
    g.add(plate, screws);
    add('Terminal Badge', g, plate);
  }

  // ================= Part 14: Top control strip =================
  {
    const strip = M(new RoundedBoxGeometry(0.06, 0.006, cabD * 0.5, 2, 0.002), accentMat, 'TopStrip');
    strip.position.set(-baffleW * 0.28, baffleH + 0.002, 0);
    const g = new THREE.Group();
    g.add(strip);
    add('Top Control Strip', g, strip);
  }

  // ================= Part 15: Micro detail (footer logo) =================
  {
    const logo = M(new THREE.TorusGeometry(0.02, 0.0035, 10, 40), motorMat, 'Logo');
    logo.rotation.x = Math.PI / 2;
    logo.position.set(baffleW * 0.32, 0.012, cabD * 0.3);
    const g = new THREE.Group();
    g.add(logo);
    add('Micro Detail', g, logo);
  }

  // port on baffle if ported
  if (box.type === 'ported') {
    // visual port flare included in enclosure look (not a numbered part)
    const pr = box.portDiameterCM / 200;
    const flare = M(new THREE.CylinderGeometry(pr * 1.25, pr, 0.02, 64, 1, true).rotateX(Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: '#07080a', roughness: 0.6, side: THREE.DoubleSide }), 'portFlare');
    flare.position.set(-baffleW * 0.27, baffleH * 0.3, cabD / 2 - 0.002);
    root.add(flare);
  }

  return { root, parts, coneRadiusM: coneR, axis: 'z' };
}

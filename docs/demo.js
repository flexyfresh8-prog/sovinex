/**
 * Sonivex Studio — mobile GitHub Pages 3D preview (black & white edition).
 * No GLB, no download: the subwoofer is built procedurally at load time —
 * an ultra-detailed 15-part driver assembly (cone, half-roll surround,
 * cast basket, double magnet stack, pole piece, tinsel leads, flange bolts,
 * gasket, feet, port flare …) in neutral grayscale studio materials.
 *
 * Motion contract (same as the desktop app's MotionSystem):
 *  - the cone (part #3) oscillates along the driver axis (+Z);
 *  - the surround is flex-only: a vertex shader bends it along +Z with a
 *    radial falloff so its inner edge tracks the cone 1:1 while its outer
 *    edge stays bolted to the frame — the cone never detaches.
 * A synthesized 120 BPM kick drives the excursion through a 36 Hz carrier.
 */

const CARRIER_HZ = 36;
const BPM = 120;
const PATTERN = [1, 0, 0.5, 0, 1, 0, 0.55, 0.3]; // eighth-note velocity map

let booted = false;
let raf = 0;

/* ------------------------------------------------------------------ */
/*  ultra-detailed procedural subwoofer (black & white materials)      */
/* ------------------------------------------------------------------ */

function buildSubwoofer(THREE) {
  const root = new THREE.Group();
  root.name = 'SonivexBWSub';
  const named = {};            // role → { obj, mesh }
  const parts = [];

  const M = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const latheZ = (pts, seg) => {
    const v = pts.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z));
    return new THREE.LatheGeometry(v, seg).rotateX(Math.PI / 2);
  };
  const holedPlateZ = (w, h, depth, holeR, seg = 80) => {
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
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 5 });
    geo.translate(0, 0, -depth / 2);
    return geo;
  };
  const chamferDiscZ = (r, rTop, h, seg) => latheZ([
    [r, -h / 2], [r, -h * 0.32], [rTop, -h * 0.12], [rTop, h * 0.12], [r, h * 0.32], [r, h / 2],
  ], seg);
  const addPart = (key, name, obj, mesh) => {
    obj.name = `sonivex_part_${parts.length}`;
    root.add(obj);
    parts.push({ key, name, obj, mesh });
    if (key) named[key] = { obj, mesh };
  };

  // ---- dimensions (meters)
  const coneR = 0.155;
  const baffleW = 0.56, baffleH = 0.96, cabD = 0.42;
  const cy = baffleH / 2, zFace = cabD / 2, driverZ = zFace + 0.004;

  // ---- strictly neutral grayscale materials
  const cabinetMat = new THREE.MeshPhysicalMaterial({ color: 0x0f0f0f, roughness: 0.44, metalness: 0.08, clearcoat: 0.8, clearcoatRoughness: 0.24, envMapIntensity: 0.9 , side: THREE.DoubleSide });
  const baffleMat  = new THREE.MeshPhysicalMaterial({ color: 0x131313, roughness: 0.50, metalness: 0.05, envMapIntensity: 0.85 , side: THREE.DoubleSide });
  const coneMat    = new THREE.MeshPhysicalMaterial({ color: 0xd2d2d2, roughness: 0.62, metalness: 0.10, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.9 , side: THREE.DoubleSide });
  const surroundMat= new THREE.MeshPhysicalMaterial({ color: 0x181818, roughness: 0.86, metalness: 0.0, sheen: 0.35, sheenColor: new THREE.Color(0x2a2a2a) , side: THREE.DoubleSide });
  const capMat     = new THREE.MeshPhysicalMaterial({ color: 0x9e9e9e, roughness: 0.18, metalness: 0.92, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.3 , side: THREE.DoubleSide });
  const motorMat   = new THREE.MeshPhysicalMaterial({ color: 0x4b4b4b, roughness: 0.38, metalness: 0.9, envMapIntensity: 1.1 , side: THREE.DoubleSide });
  const darkMetal  = new THREE.MeshPhysicalMaterial({ color: 0x2c2c2c, roughness: 0.50, metalness: 0.85 , side: THREE.DoubleSide });
  const steelMat   = new THREE.MeshPhysicalMaterial({ color: 0xd6d6d6, roughness: 0.32, metalness: 0.95, envMapIntensity: 1.2 , side: THREE.DoubleSide });
  const magnetMat  = new THREE.MeshPhysicalMaterial({ color: 0x262626, roughness: 0.62, metalness: 0.35 , side: THREE.DoubleSide });
  const rubberMat  = new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.92, metalness: 0.0 , side: THREE.DoubleSide });
  const voidMat    = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });

  // ================= Part 1: Enclosure =================
  {
    const g = new THREE.Group();
    const shell = M(new THREE.BoxGeometry(baffleW, baffleH, cabD - 0.024, 1, 2, 1), cabinetMat, 'Enclosure');
    shell.position.set(0, cy, -0.012);
    g.add(shell);
    const baffle = M(holedPlateZ(baffleW * 0.96, baffleH * 0.97, 0.026, coneR * 1.005), baffleMat, 'Baffle');
    baffle.position.set(0, cy, zFace - 0.011);
    g.add(baffle);
    const rebate = M(latheZ([
      [coneR * 1.015, 0], [coneR * 1.015, 0.008], [coneR * 1.06, 0.012], [coneR * 1.06, 0.016], [coneR * 1.005, 0.016],
    ], 64), baffleMat, 'Rebate');
    rebate.position.set(0, cy, zFace + 0.003);
    g.add(rebate);
    const gasket = M(latheZ([
      [coneR * 1.0, 0], [coneR * 1.0, 0.0045], [coneR * 1.02, 0.006], [coneR * 1.02, 0],
    ], 64), rubberMat, 'Gasket');
    gasket.position.set(0, cy, zFace + 0.003);
    g.add(gasket);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const boss = M(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 14).rotateX(Math.PI / 2), steelMat, 'flangeBolt');
      boss.position.set(Math.cos(a) * coneR * 1.045, cy + Math.sin(a) * coneR * 1.045, zFace + 0.009);
      g.add(boss);
    }
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      const foot = M(new THREE.CylinderGeometry(0.021, 0.024, 0.012, 20), rubberMat, 'Foot');
      foot.position.set(sx * baffleW * 0.34, 0.006, sy * cabD * 0.34);
      g.add(foot);
    });
    addPart(null, 'Enclosure', g, shell);
  }

  // ================= Part 2: Driver Motor / Basket =================
  {
    const g = new THREE.Group();
    const flange = M(latheZ([
      [coneR * 0.42, -0.004], [coneR * 0.42, 0.02], [coneR * 0.86, 0.026], [coneR * 1.04, 0.02], [coneR * 1.04, 0.006], [coneR * 0.98, 0],
    ], 96), darkMetal, 'Flange');
    g.add(flange);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const web = M(new THREE.BoxGeometry(0.014, 0.012, coneR * 0.45), motorMat, 'spokeWeb');
      web.position.set(Math.cos(a) * coneR * 0.62, Math.sin(a) * coneR * 0.62, -0.068);
      web.rotation.z = a + Math.PI / 2;
      web.rotation.x = 0.30;
      const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
      const f1 = M(new THREE.BoxGeometry(0.004, 0.016, coneR * 0.72), motorMat, 'spokeFlange');
      f1.position.set(web.position.x + px * 0.009, web.position.y + py * 0.009, web.position.z);
      f1.rotation.copy(web.rotation);
      const f2 = M(new THREE.BoxGeometry(0.004, 0.016, coneR * 0.72), motorMat, 'spokeFlange');
      f2.position.set(web.position.x - px * 0.009, web.position.y - py * 0.009, web.position.z);
      f2.rotation.copy(web.rotation);
      g.add(web, f1, f2);
    }
    const shelf = M(latheZ([
      [coneR * 0.34, -0.066], [coneR * 0.36, -0.058], [coneR * 0.44, -0.054], [coneR * 0.44, -0.066],
    ], 72), motorMat, 'SpiderShelf');
    g.add(shelf);
    const magR = 0.085, magH = 0.034;
    const topPlate = M(chamferDiscZ(magR * 0.94, magR * 0.88, 0.012, 64), motorMat, 'TopPlate');
    topPlate.position.z = -0.075;
    const magA = M(chamferDiscZ(magR, magR * 0.96, magH * 0.52, 64), magnetMat, 'MagnetA');
    magA.position.z = -0.081 - magH * 0.26;
    const magB = M(chamferDiscZ(magR, magR * 0.96, magH * 0.52, 64), magnetMat, 'MagnetB');
    magB.position.z = -0.081 - magH * 0.52 - 0.004 - magH * 0.26;
    const botPlate = M(chamferDiscZ(magR * 0.94, magR * 0.88, 0.012, 64), motorMat, 'BotPlate');
    botPlate.position.z = -0.081 - magH - 0.008;
    g.add(topPlate, magA, magB, botPlate);
    const poleBack = -0.086 - magH;
    const pole = M(latheZ([
      [1e-4, poleBack - 0.014], [magR * 0.24, poleBack - 0.012], [magR * 0.34, poleBack - 0.006],
      [magR * 0.34, poleBack + 0.058], [magR * 0.31, poleBack + 0.064], [1e-4, poleBack + 0.064],
    ], 56), motorMat, 'Pole');
    g.add(pole);
    const poleVent = M(new THREE.CylinderGeometry(magR * 0.15, magR * 0.15, 0.02, 24, 1, true).rotateX(Math.PI / 2), voidMat, 'PoleVent');
    poleVent.position.z = poleBack - 0.006;
    g.add(poleVent);
    const plugRing = M(new THREE.TorusGeometry(magR * 0.96, 0.004, 8, 56), darkMetal, 'PlugRing');
    plugRing.position.z = -0.081 - magH - 0.004;
    g.add(plugRing);
    g.position.set(0, cy, driverZ);
    addPart(null, 'Driver Motor / Basket', g, flange);
  }

  // ================= Part 3: CONE (motion-ready) =================
  const depth = 0.062;
  {
    const g = new THREE.Group();
    const cone = M(latheZ([
      [coneR * 0.985, 0], [coneR * 0.975, -0.004], [coneR * 0.955, -depth * 0.16], [coneR * 0.895, -depth * 0.38],
      [coneR * 0.80, -depth * 0.58], [coneR * 0.68, -depth * 0.76], [coneR * 0.55, -depth * 0.90],
      [coneR * 0.455, -depth * 0.985], [coneR * 0.42, -depth], [coneR * 0.40, -depth],
    ], 128), coneMat, 'Cone');
    g.add(cone);
    g.add(M(latheZ([
      [coneR * 0.865, -depth * 0.47], [coneR * 0.855, -depth * 0.50], [coneR * 0.808, -depth * 0.615], [coneR * 0.818, -depth * 0.588],
    ], 128), coneMat, 'RibA'));
    g.add(M(latheZ([
      [coneR * 0.615, -depth * 0.79], [coneR * 0.607, -depth * 0.815], [coneR * 0.566, -depth * 0.90], [coneR * 0.574, -depth * 0.878],
    ], 128), coneMat, 'RibB'));
    const collar = M(new THREE.CylinderGeometry(coneR * 0.40, coneR * 0.40, 0.010, 72, 1, true).rotateX(Math.PI / 2), coneMat, 'Collar');
    collar.position.z = -depth + 0.005;
    g.add(collar);
    g.position.set(0, cy, driverZ + 0.0015);
    addPart('cone', 'Cone', g, cone);
  }

  // ================= Part 4: Dust Cap =================
  {
    const capR = coneR * 0.34, h = 0.022;
    const g = new THREE.Group();
    const cap = M(latheZ([
      [1e-4, h], [capR * 0.38, h * 0.92], [capR * 0.68, h * 0.66], [capR * 0.88, h * 0.34], [capR, 0], [capR * 1.015, -0.005],
    ], 96), capMat, 'DustCap');
    cap.position.z = -depth + 0.004;
    const seam = M(new THREE.TorusGeometry(capR * 1.01, 0.0016, 6, 72), capMat, 'CapSeam');
    seam.position.z = -depth + 0.004;
    g.add(cap, seam);
    g.position.set(0, cy, driverZ + 0.0015);
    addPart('cap', 'Dust Cap', g, cap);
  }

  // ================= Part 5: Motor Rear Plug =================
  {
    const plug = M(chamferDiscZ(0.083, 0.077, 0.026, 64), darkMetal, 'RearPlug');
    plug.position.set(0, cy, -zFace - 0.013);
    const g = new THREE.Group();
    g.add(plug);
    addPart(null, 'Motor Rear Plug', g, plug);
  }

  // ================= Part 6: Surround Ring (flex-only deformable) =================
  {
    const w = 0.016, rIn = coneR * 0.985, rOut = rIn + w;
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      pts.push([rIn + t * w, Math.sin(t * Math.PI) * w * 0.95 - w * 0.30]);
    }
    pts.push([rOut + 0.006, -w * 0.34], [rOut + 0.006, -w * 0.40]);
    const roll = M(latheZ(pts, 128), surroundMat, 'Surround');
    const g = new THREE.Group();
    g.add(roll);
    g.position.set(0, cy, driverZ + 0.0015);
    addPart('surround', 'Surround Ring', g, roll);
  }

  // ================= Parts 7-10: Side vents =================
  ['Side Vent L-Upper', 'Side Vent L-Lower', 'Side Vent R-Upper', 'Side Vent R-Lower'].forEach((name, i) => {
    const upper = i % 2 === 0, side = i < 2 ? -1 : 1;
    const g = new THREE.Group();
    const vr = 0.032 + 0.006 * (upper ? 1 : 0);
    const tube = M(new THREE.CylinderGeometry(vr, vr, 0.014, 32).rotateZ(Math.PI / 2), darkMetal, name);
    tube.position.set(side * baffleW / 2 - side * 0.002, baffleH * (upper ? 0.55 : 0.42), cabD * (i < 2 ? -0.66 : 0.66) * 0.47);
    const bezel = M(new THREE.TorusGeometry(vr + 0.002, 0.0035, 8, 36).rotateY(Math.PI / 2), steelMat, name + '_bezel');
    bezel.position.copy(tube.position);
    const grill = M(new THREE.CircleGeometry(vr - 0.002, 24).rotateY(Math.PI / 2 * (side > 0 ? -1 : 1)), voidMat, name + '_grill');
    grill.position.set(side * baffleW / 2 + side * 0.006, tube.position.y, tube.position.z);
    g.add(tube, bezel, grill);
    addPart(null, name, g, tube);
  });

  // ================= Parts 11-12: Trim details =================
  ['Trim Detail A', 'Trim Detail B'].forEach((name, i) => {
    const g = new THREE.Group();
    const strip = M(new THREE.BoxGeometry(0.014, 0.10, 0.018), steelMat, name);
    strip.position.set(baffleW * (i === 0 ? 0.30 : 0.36), baffleH * (i === 0 ? 0.74 : 0.70), cabD / 2 * (i === 0 ? 1 : -1) * 0.86);
    g.add(strip);
    for (let s = 0; s < 2; s++) {
      const screw = M(new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 10).rotateX(Math.PI / 2), darkMetal, name + '_screw');
      screw.position.set(strip.position.x, strip.position.y + (s === 0 ? 0.038 : -0.038), strip.position.z + (strip.position.z > 0 ? 0.01 : -0.01));
      g.add(screw);
    }
    addPart(null, name, g, strip);
  });

  // ================= Part 13: Terminal badge =================
  {
    const g = new THREE.Group();
    const plate = M(new THREE.BoxGeometry(0.11, 0.075, 0.012), darkMetal, 'TerminalPlate');
    plate.position.set(baffleW * 0.3, baffleH * 0.82, -zFace - 0.006);
    g.add(plate);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      const screw = M(new THREE.CylinderGeometry(0.005, 0.005, 0.005, 10).rotateX(Math.PI / 2), steelMat, 'terminalScrew');
      screw.position.set(plate.position.x + sx * 0.046, plate.position.y + sy * 0.027, plate.position.z - 0.006);
      g.add(screw);
    });
    [[-0.024, 0xe8e8e8], [0.024, 0x2c2c2c]].forEach(([dx, col]) => {
      const stud = M(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 16).rotateX(Math.PI / 2), steelMat, 'postStud');
      stud.position.set(plate.position.x + dx, plate.position.y, plate.position.z - 0.014);
      g.add(stud);
      for (let k = 0; k < 4; k++) {
        const knurl = M(new THREE.TorusGeometry(0.0105, 0.0016, 6, 20), steelMat, 'postKnurl');
        knurl.position.set(plate.position.x + dx, plate.position.y, plate.position.z - 0.010 - k * 0.0035);
        g.add(knurl);
      }
      const capTop = M(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 16).rotateX(Math.PI / 2),
        new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.35, metalness: 0.2, clearcoat: 0.6 }), 'postCap');
      capTop.position.set(plate.position.x + dx, plate.position.y, plate.position.z - 0.024);
      g.add(capTop);
    });
    addPart(null, 'Terminal Badge', g, plate);
  }

  // ================= Part 14: Top control strip =================
  {
    const g = new THREE.Group();
    const strip = M(new THREE.BoxGeometry(0.07, 0.007, cabD * 0.5), steelMat, 'TopStrip');
    strip.position.set(-baffleW * 0.28, baffleH + 0.002, 0);
    g.add(strip);
    [0xf2f2f2, 0x8a8a8a, 0x1a1a1a].forEach((c, k) => {
      const dot = M(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 12),
        new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.25, clearcoat: 1, metalness: 0.1 }), 'indicator');
      dot.position.set(-baffleW * 0.28 + 0.018 + k * 0.016, baffleH + 0.007, 0);
      g.add(dot);
    });
    addPart(null, 'Top Control Strip', g, strip);
  }

  // ================= Part 15: Micro detail (logo medallion) =================
  {
    const g = new THREE.Group();
    const medallion = M(new THREE.CylinderGeometry(0.024, 0.024, 0.004, 36).rotateX(Math.PI / 2), darkMetal, 'LogoDisc');
    medallion.position.set(baffleW * 0.32, 0.016, cabD * 0.3);
    const ring = M(new THREE.TorusGeometry(0.021, 0.0028, 8, 36), steelMat, 'LogoRing');
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(medallion.position).z += 0.002;
    g.add(medallion, ring);
    addPart(null, 'Micro Detail', g, medallion);
  }

  // ================= dress-up: front port with double flare =================
  {
    const pr = 0.051, px = -baffleW * 0.27, py = baffleH * 0.30;
    const flare = M(latheZ([
      [pr * 1.32, 0], [pr * 1.28, 0.006], [pr * 1.10, 0.012], [pr, 0.012], [pr, -0.012], [pr * 1.06, -0.018], [pr * 1.02, -0.018],
    ], 56), baffleMat, 'PortFlare');
    flare.position.set(px, py, zFace + 0.014);
    const throat = M(new THREE.CylinderGeometry(pr, pr, 0.02, 48, 1, true).rotateX(Math.PI / 2), voidMat, 'PortThroat');
    throat.position.set(px, py, zFace - 0.006);
    root.add(flare, throat);
  }

  return { root, parts, named, coneR, depth };
}

export async function launchDemo() {
  if (booted) return;
  booted = true;

  const overlay = document.getElementById('stageOverlay');
  const stage = document.getElementById('stage');
  const status = document.getElementById('stageStatus');
  const bar = document.getElementById('demoBar');
  const setStatus = (t) => { status.textContent = t; };

  setStatus('loading three.js from CDN …');
  const THREE = await import('three');
  // neutral studio environment — without it, metals (metalness > 0.8) render black
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');

  // ---- renderer / scene (pure black & white stage) ----
  setStatus('building the model …');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060606);
  scene.fog = new THREE.Fog(0x060606, 8, 17);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xf2f2f2, 0x0a0a0a, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3.2, 4.4, 3.0);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc9c9c9, 0.45);
  fill.position.set(-3.4, 1.4, 2.2);
  scene.add(fill);
  const front = new THREE.DirectionalLight(0xffffff, 0.55);
  front.position.set(0.6, 1.2, 5.0);
  scene.add(front);
  const rim = new THREE.PointLight(0xffffff, 9, 14, 2);
  rim.position.set(-2.6, 1.6, -3.0);
  scene.add(rim);

  const grid = new THREE.GridHelper(14, 28, 0x3a3a3a, 0x1c1c1c);
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  grid.position.y = -1.72;
  scene.add(grid);

  // ---- build the 15-part assembly ----
  const built = buildSubwoofer(THREE);
  const root = built.root;
  const cone = built.named.cone.obj;
  const surround = built.named.surround.obj.children[0]; // the roll mesh
  console.log('[sonivex-demo] procedural build:', built.parts.map((p) => p.name).join(', '));

  // normalize + center
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 3.0 / maxDim;
  root.scale.setScalar(s);
  root.position.sub(center.multiplyScalar(s));
  scene.add(root);

  // ---- cone excursion (model-local units = meters pre-normalization) ----
  const restZ = cone.position.z;
  // ~9% of the cone radius ≈ realistic Xmax-scale stroke for a 12" driver
  const amp = 0.09 * built.coneR;

  // ---- surround flex: inner edge (cone side) tracks the cone 1:1 ----
  // Radial falloff is computed in the X/Y plane (⊥ to the +Z drive axis);
  // the outer edge (frame side) never moves — the cone stays attached.
  const flexMats = [];
  {
    const geo = surround.geometry;
    const pos = geo.getAttribute('position');
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2, cyy = (bb.min.y + bb.max.y) / 2;
    let rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i) - cx, pos.getY(i) - cyy);
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }
    const span = Math.max(rMax - rMin, 1e-6);
    const arr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i) - cx, pos.getY(i) - cyy);
      const t = 1 - (r - rMin) / span; // 1 at cone side → 0 at frame side
      arr[i] = t * t;
    }
    geo.setAttribute('aFalloff', new THREE.BufferAttribute(arr, 1));
    const mat = surround.material.clone();
    surround.material = mat;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDisp = { value: 0 };
      shader.uniforms.uAxis = { value: new THREE.Vector3(0, 0, 1) };
      shader.vertexShader = 'attribute float aFalloff;\nuniform float uDisp;\nuniform vec3 uAxis;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n transformed += uAxis * (aFalloff * uDisp);',
        );
      mat.userData.shaderRef = shader;
    };
    mat.needsUpdate = true;
    flexMats.push(mat);
  }

  // ---- camera orbit (touch + mouse) ----
  const target = new THREE.Vector3(0, 0, 0);
  const cam = { radius: 6.8, theta: 0.30, phi: 1.35 }; // level 3/4 view, whole cabinet in frame
  const camHome = { ...cam };
  let interacting = false;
  const applyCam = () => {
    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    camera.position.set(
      target.x + cam.radius * sp * Math.sin(cam.theta),
      target.y + cam.radius * cp,
      target.z + cam.radius * sp * Math.cos(cam.theta),
    );
    camera.lookAt(target);
  };
  applyCam();

  const el = renderer.domElement;
  let dragging = false, px = 0, py = 0, pinchD = 0;
  const onDown = (x, y) => { dragging = true; interacting = true; px = x; py = y; };
  const onMove = (x, y) => {
    if (!dragging) return;
    cam.theta -= (x - px) * 0.0062;
    cam.phi = Math.min(Math.PI - 0.18, Math.max(0.25, cam.phi - (y - py) * 0.0052));
    px = x; py = y;
    applyCam();
  };
  const onUp = () => { dragging = false; };
  el.addEventListener('pointerdown', (e) => { try { el.setPointerCapture(e.pointerId); } catch (_) {} onDown(e.clientX, e.clientY); });
  el.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', (e) => {
    e.preventDefault(); interacting = true;
    cam.radius = Math.min(11, Math.max(2.4, cam.radius * (1 + Math.sign(e.deltaY) * 0.09)));
    applyCam();
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault(); interacting = true;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchD) {
        cam.radius = Math.min(11, Math.max(2.4, cam.radius * (pinchD / d)));
        applyCam();
      }
      pinchD = d;
    }
  }, { passive: false });
  el.addEventListener('touchend', () => { pinchD = 0; });

  // ---- beat engine (WebAudio, gesture-gated) ----
  let actx = null, master = null;
  let playing = false, soundOn = true;
  let nextNote = 0, step = 0;
  const kicks = []; // {t, v}
  // Animation clock: use the audio clock ONLY when the context is actually
  // running. A suspended/blocked context (autoplay policy, no audio device,
  // headless) must never freeze the visuals — fall back to performance.now().
  const audioClockOk = () => !!(actx && soundOn && actx.state === 'running');
  const now = () => (audioClockOk() ? actx.currentTime : performance.now() / 1000);

  const kick = (t0, v) => {
    if (!actx || !soundOn) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(54, t0);
    o.frequency.exponentialRampToValueAtTime(29, t0 + 0.22);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.85 * v, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + 0.34);
  };
  const ensureCtx = () => {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { soundOn = false; return; }
    actx = new AC();
    const comp = actx.createDynamicsCompressor();
    master = actx.createGain();
    master.gain.value = 0.9;
    master.connect(comp); comp.connect(actx.destination);
  };
  let clockWasAudio = false;
  const scheduler = () => {
    if (!playing) return;
    // clock source switched mid-play (context resumed/suspended) → rebase
    const isAudio = audioClockOk();
    if (isAudio !== clockWasAudio) {
      kicks.length = 0;
      nextNote = now() + 0.08;
      clockWasAudio = isAudio;
    }
    const t = now();
    while (nextNote < t + 0.16) {
      const v = PATTERN[step % PATTERN.length];
      if (v > 0) {
        if (actx && soundOn) kick(nextNote, v);
        kicks.push({ t: nextNote, v });
        if (kicks.length > 8) kicks.shift();
      }
      step++;
      nextNote += 60 / BPM / 2; // eighth notes
    }
  };
  setInterval(scheduler, 90);

  const startBeat = () => {
    if (playing) return;
    playing = true;
    if (soundOn) { ensureCtx(); actx && actx.resume && actx.resume(); }
    clockWasAudio = audioClockOk();
    nextNote = now() + 0.08;
    step = 0;
  };
  const stopBeat = () => { playing = false; kicks.length = 0; };

  // ---- UI wiring ----
  const btnBeat = document.getElementById('btnBeat');
  const btnMute = document.getElementById('btnMute');
  const btnReset = document.getElementById('btnReset');
  const hudX = document.getElementById('hudX');
  const hudHz = document.getElementById('hudHz');
  hudHz.textContent = String(CARRIER_HZ);

  btnBeat.addEventListener('click', () => {
    playing ? stopBeat() : startBeat();
    btnBeat.classList.toggle('on', playing);
  });
  btnMute.addEventListener('click', () => {
    soundOn = !soundOn;
    btnMute.classList.toggle('on', soundOn);
    if (soundOn) { ensureCtx(); actx && actx.resume && actx.resume(); }
    if (playing) { clockWasAudio = audioClockOk(); kicks.length = 0; nextNote = now() + 0.08; } // rebase after clock switch
  });
  btnReset.addEventListener('click', () => {
    Object.assign(cam, camHome); interacting = false; applyCam();
  });

  // ---- resize ----
  const resize = () => {
    const w = stage.clientWidth || 320, h = stage.clientHeight || 340;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) { stopBeat(); btnBeat.classList.remove('on'); }
  });

  // ---- frame loop ----
  const envAt = (t) => {
    let e = 0;
    for (const k of kicks) if (t >= k.t) e += k.v * Math.exp(-(t - k.t) / 0.16);
    return Math.min(1.35, e);
  };
  let lastHud = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!interacting) { cam.theta += 0.0016; applyCam(); }
    const t = now();
    const env = playing ? envAt(t) : 0;
    const disp = env * Math.sin(2 * Math.PI * CARRIER_HZ * t) * amp;
    cone.position.z = restZ + disp;
    // surround inner edge follows the cone (same model-space units)
    for (const mat of flexMats) {
      const ref = mat.userData.shaderRef;
      if (ref) ref.uniforms.uDisp.value = disp;
    }
    if (t - lastHud > 0.1) {
      lastHud = t;
      hudX.textContent = (disp * 1000).toFixed(1); // real mm (model units are meters)
    }
    renderer.render(scene, camera);
  };
  loop();

  // shareable deep link: /?autostart=1 boots straight into the beat
  // (visuals only — audio still needs the WebAudio resume gesture, which
  // the first tap anywhere provides)
  if (new URLSearchParams(location.search).has('autostart')) {
    startBeat();
    btnBeat.classList.add('on');
    const resumeOnce = () => {
      if (actx && actx.state !== 'running') actx.resume().catch(() => {});
      window.removeEventListener('pointerdown', resumeOnce);
    };
    window.addEventListener('pointerdown', resumeOnce);
  }

  // ---- done ----
  overlay.style.transition = 'opacity .5s';
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.remove(); }, 520);
  bar.hidden = false;
  setStatus('live · drag to orbit · pinch to zoom');
  console.log('[sonivex-demo] preview online · 15-part procedural B&W build · cone motion-ready · surround flex =',
    flexMats.length ? 'on' : 'off');
}

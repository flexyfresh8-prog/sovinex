/**
 * SONIVEX — Live Subwoofer (GitHub Pages experience).
 *
 * A single-purpose page: the subwoofer, your music, and the cone moving.
 * The driver is 100% procedural — no model download — built in the style of
 * modern SPL car-audio subwoofers: wide half-roll rubber surround, thick
 * injection-molded cone, deep logo dust cap, cast basket, exposed ferrite
 * motor, gold push terminals and braided tinsel leads.
 *
 * Audio: file import (mp3/wav/ogg/flac) or built-in bass demo → 8-band
 * graphic EQ (Web Audio biquads) → low-passed analyser tap → signed cone
 * excursion. The surround and spider bend with the cone via a vertex-shader
 * falloff (inner edge glued to the cone, outer edge bolted to the frame).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ================================================================ utils */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function el(id) { return document.getElementById(id); }
function toast(msg, ms = 2600) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), ms);
}
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/* ============================================================ textures */
/** Fine bumpy normal map (rubber grain / paper grain). */
function noiseNormalMap(size, cellPx, strength, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += cellPx) {
    for (let x = 0; x < size; x += cellPx) {
      const nx = 128 + (Math.random() * 2 - 1) * strength;
      const ny = 128 + (Math.random() * 2 - 1) * strength;
      g.fillStyle = `rgb(${nx | 0},${ny | 0},255)`;
      g.fillRect(x, y, cellPx, cellPx);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** Horizontal brushed-metal normal map. */
function brushedNormalMap(size, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    const n = 128 + (Math.random() * 2 - 1) * strength;
    for (let x = 0; x < size; x++) {
      const j = n + (Math.random() * 2 - 1) * strength * 0.5;
      const i = (y * size + x) * 4;
      img.data[i] = clamp(j, 0, 255);
      img.data[i + 2] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

/** Dust-cap face: glossy black with the white SONIVEX wordmark. */
function capFaceTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a0c';
  g.fillRect(0, 0, S, S);
  // faint radial sheen baked into the base
  const rad = g.createRadialGradient(S * 0.5, S * 0.42, S * 0.05, S * 0.5, S * 0.5, S * 0.62);
  rad.addColorStop(0, 'rgba(255,255,255,0.10)');
  rad.addColorStop(0.55, 'rgba(255,255,255,0.02)');
  rad.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  // wordmark — drawn rotated 180°: at the top of a lathe dome the canvas
  // -x axis is screen-right and +y is letter-up, so the artwork must be
  // printed inverted (exactly how real dust-cap pad printing works).
  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(Math.PI);
  g.translate(-S / 2, -S / 2);
  g.translate(S / 2, S * 0.42);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f2f2f4';
  g.font = '700 58px ' + getComputedStyle(document.body).fontFamily;
  g.fillText('SONIVEX', 0, -14);
  g.font = '500 25px ' + getComputedStyle(document.body).fontFamily;
  g.fillStyle = 'rgba(242,242,244,0.82)';
  g.fillText('S T U D I O', 4, 28);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Soft radial blob used as a fake contact shadow (cheap + headless-safe). */
function blobShadowTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5);
  rad.addColorStop(0, 'rgba(0,0,0,0.62)');
  rad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/* =========================================================== materials */
const TEX = {};
function initTextures() {
  TEX.rubber = noiseNormalMap(256, 3, 26, 14);
  TEX.paper = noiseNormalMap(256, 2, 14, 8);
  TEX.brushed = brushedNormalMap(256, 22);
}

function mat(spec) {
  const m = new THREE.MeshPhysicalMaterial({
    color: spec.color ?? 0x111111,
    roughness: spec.rough ?? 0.5,
    metalness: spec.metal ?? 0,
    envMapIntensity: spec.env ?? 0.9,
    side: spec.side ?? THREE.FrontSide,
  });
  if (spec.clearcoat) {
    m.clearcoat = spec.clearcoat;
    m.clearcoatRoughness = spec.clearcoatRough ?? 0.25;
  }
  if (spec.normal) {
    m.normalMap = spec.normal;
    m.normalScale = new THREE.Vector2(spec.normalScale ?? 0.5, spec.normalScale ?? 0.5);
  }
  if (spec.map) m.map = spec.map;
  return m;
}

const M = {};
function initMaterials() {
  M.coneFront = mat({ color: 0x17171b, rough: 0.62, metal: 0.04, clearcoat: 0.18, clearcoatRough: 0.5, normal: TEX.paper, normalScale: 0.5, env: 0.75 });
  M.coneBack  = mat({ color: 0x0b0b0d, rough: 0.86, metal: 0.0, normal: TEX.paper, normalScale: 0.35, env: 0.35, side: THREE.DoubleSide });
  M.surround  = mat({ color: 0x0d0d0f, rough: 0.30, metal: 0.0, clearcoat: 0.85, clearcoatRough: 0.22, normal: TEX.rubber, normalScale: 0.22, env: 1.15 });
  M.cap       = mat({ color: 0xffffff, rough: 0.16, metal: 0.0, clearcoat: 1.0, clearcoatRough: 0.12, map: capFaceTexture(), env: 1.25 });
  M.gasket    = mat({ color: 0x0a0a0b, rough: 0.42, metal: 0.0, clearcoat: 0.6, clearcoatRough: 0.3, normal: TEX.rubber, normalScale: 0.15, env: 0.9 });
  M.basket    = mat({ color: 0x33333a, rough: 0.46, metal: 0.88, normal: TEX.brushed, normalScale: 0.5, env: 1.0 });
  M.basketDark= mat({ color: 0x232329, rough: 0.55, metal: 0.85, normal: TEX.brushed, normalScale: 0.4, env: 0.85 });
  M.steel     = mat({ color: 0x9fa2a8, rough: 0.30, metal: 0.96, normal: TEX.brushed, normalScale: 0.4, env: 1.15 });
  M.ferrite   = mat({ color: 0x101013, rough: 0.72, metal: 0.10, normal: TEX.rubber, normalScale: 0.3, env: 0.5 });
  M.blackPaint= mat({ color: 0x0e0e10, rough: 0.5, metal: 0.25, clearcoat: 0.5, clearcoatRough: 0.3, env: 0.9 });
  M.coil      = mat({ color: 0xb08850, rough: 0.34, metal: 0.98, env: 1.1 });
  M.former    = mat({ color: 0x1c1c20, rough: 0.55, metal: 0.35, env: 0.55 });
  M.lead      = mat({ color: 0xc9ccd2, rough: 0.38, metal: 1.0, env: 1.2 });
  M.gold      = mat({ color: 0xd8a94e, rough: 0.24, metal: 1.0, env: 1.35 });
  M.termBlock = mat({ color: 0x0c0c0e, rough: 0.55, metal: 0.1, normal: TEX.rubber, normalScale: 0.2, env: 0.6 });
  M.spider    = mat({ color: 0x26241f, rough: 0.95, metal: 0.0, normal: TEX.paper, normalScale: 0.5, env: 0.3, side: THREE.DoubleSide });
  M.cavity    = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
}

/* ====================================================== subwoofer build */
/**
 * All dimensions in meters, axis = +Z (fires at the viewer), flange at z=0.
 * 12" SPL-style driver, proportions matched to modern car-audio subs.
 */
const D = {
  flangeR: 0.157,        // cast flange outer radius
  flangeT: 0.011,        // flange face thickness
  surrOutR: 0.131,       // surround outer attach radius
  surrInR: 0.100,        // surround inner attach radius (cone front edge)
  surrPeakZ: 0.029,      // surround roll crown height
  coneFrontR: 0.100,
  coneFrontZ: 0.017,
  coneNeckR: 0.058,
  coneNeckZ: -0.043,
  coneThick: 0.0045,
  capR: 0.061,
  capH: 0.031,           // dome height above cap rim
  coilR: 0.0575,
  coilTopZ: -0.030,
  coilBotZ: -0.086,
  hubR: 0.078,           // basket hub ring
  skirtR: 0.121,         // basket skirt inner wall at motor
  basketHubZ: -0.052,
  motorR: 0.086,         // top/bottom plate radius
  motorTopZ: -0.062,
  ferriteR: 0.119,
  ferriteInR: 0.066,
  motorBotZ: -0.132,
  poleR: 0.031,
  poleTipZ: -0.148,
  spokes: 8,
  termAngle: -0.62,      // terminal block clock position (lower-right)
};

/** Lathe a (radius, z) profile; +z stays +z after the X-rotation. */
function lathe(profile, segments = 128) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Catmull-smooth a coarse profile into a dense one. */
function smoothProfile(pts, per = 14) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([r, z]) => new THREE.Vector3(r, z, 0)));
  const n = (pts.length - 1) * per;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    out.push([p.x, p.y]);
  }
  return out;
}

/**
 * Vertex-shader flex: inner edge tracks the cone, outer edge stays bolted.
 * Returns the material; caller keeps refs and drives `.uDisp.value`.
 */
function makeFlex(material, innerR, outerR) {
  const uni = { uDisp: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDisp = uni.uDisp;
    shader.uniforms.uInnerR = { value: innerR };
    shader.uniforms.uOuterR = { value: outerR };
    shader.vertexShader =
      `uniform float uDisp; uniform float uInnerR; uniform float uOuterR;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float flexW = 1.0 - smoothstep(uInnerR, uOuterR, length(transformed.xy));
         transformed.z += uDisp * flexW;`,
      );
  };
  material.customProgramCacheKey = () => 'sonivex-flex';
  return uni;
}

function buildSubwoofer() {
  const root = new THREE.Group();
  const moving = new THREE.Group();       // cone + cap + coil + leads (rigid)
  root.add(moving);
  const flex = [];                        // shader-driven deformables

  /* ---- cone (front skin + inner shell for thickness) ---- */
  const coneCurve = smoothProfile([
    [D.coneNeckR, D.coneNeckZ],
    [0.070, -0.028],
    [0.082, -0.012],
    [0.092, 0.004],
    [D.coneFrontR, D.coneFrontZ],
  ], 12);
  const coneGeo = lathe(coneCurve);
  const cone = new THREE.Mesh(coneGeo, M.coneFront);
  moving.add(cone);
  const coneInnerGeo = lathe(coneCurve.map(([r, z]) => [Math.max(r - D.coneThick, 0.02), z - D.coneThick * 0.7]), 96);
  const coneInner = new THREE.Mesh(coneInnerGeo, M.coneBack);
  moving.add(coneInner);

  // neck collar where cone meets the former
  const collar = new THREE.Mesh(
    lathe(smoothProfile([[0.052, -0.040], [0.056, -0.034], [D.coneNeckR, -0.030], [0.062, -0.026]], 8), 96),
    M.coneBack,
  );
  moving.add(collar);

  /* ---- dust cap (deep glossy dome + wordmark) ---- */
  const capProfile = smoothProfile([
    [D.capR, D.coneFrontZ + 0.004],
    [0.056, 0.026],
    [0.046, 0.038],
    [0.030, 0.046],
    [0.012, 0.049],
    [0.001, 0.050],
  ], 12);
  const cap = new THREE.Mesh(lathe(capProfile, 128), M.cap);
  // wordmark prints across the top of the dome face
  moving.add(cap);

  /* ---- voice coil + former (visible through the basket windows) ---- */
  const former = new THREE.Mesh(
    new THREE.CylinderGeometry(D.coilR, D.coilR, Math.abs(D.coilBotZ - D.coilTopZ), 64, 1, true)
      .rotateX(Math.PI / 2),
    M.former,
  );
  former.position.z = (D.coilTopZ + D.coilBotZ) / 2;
  moving.add(former);
  const windingH = 0.030;
  const winding = new THREE.Mesh(
    new THREE.CylinderGeometry(D.coilR + 0.0012, D.coilR + 0.0012, windingH, 64, 1, true).rotateX(Math.PI / 2),
    M.coil,
  );
  winding.position.z = D.coilBotZ + windingH / 2;
  moving.add(winding);

  /* ---- half-roll rubber surround (flex) ---- */
  const surrProfile = smoothProfile([
    [D.surrOutR, 0.007],        // outer edge tucks under the gasket
    [D.surrOutR - 0.003, 0.017],
    [D.surrOutR - 0.010, D.surrPeakZ],
    [D.surrOutR - 0.019, D.surrPeakZ - 0.001],
    [D.surrInR + 0.005, 0.024],
    [D.surrInR, 0.018],         // inner lip glued to the cone front edge
    [D.surrInR - 0.001, 0.014],
  ], 16);
  const surrGeo = lathe(surrProfile, 160);
  M.surround.side = THREE.DoubleSide;
  const surround = new THREE.Mesh(surrGeo, M.surround);
  root.add(surround);
  flex.push(makeFlex(M.surround, D.surrInR - 0.002, D.surrOutR));

  /* ---- gasket ring (glossy, sits on the flange) ---- */
  const gasket = new THREE.Mesh(
    lathe(smoothProfile([
      [D.surrOutR + 0.001, 0.006],
      [D.surrOutR + 0.004, 0.016],
      [0.141, 0.019],
      [0.143, 0.006],
      [D.surrOutR + 0.001, 0.003],
    ], 8), 128),
    M.gasket,
  );
  root.add(gasket);

  /* ---- tinsel leads (braided, cone → terminal) ---- */
  const leadMat = M.lead;
  for (const a of [2.35, -0.85]) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const p = (r, z) => new THREE.Vector3(r * ca, r * sa, z);
    const curve = new THREE.CatmullRomCurve3([
      p(0.058, -0.034),
      p(0.082, -0.030),
      p(0.108, -0.020),
      p(0.126, -0.012),
      p(0.140, -0.008),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.0017, 8), leadMat);
    moving.add(tube);
  }

  /* ---- basket (cast: flange, skirt, hub + trapezoid spokes) ---- */
  const basket = new THREE.Group();
  const flangeProfile = [
    [D.flangeR - 0.006, 0.012],
    [D.flangeR, 0.008],
    [D.flangeR, -0.004],
    [D.flangeR - 0.004, -0.010],
    [0.128, -0.014],
    [D.skirtR + 0.004, -0.030],
    [D.skirtR, -0.052],
    [D.hubR + 0.004, D.basketHubZ - 0.010],
    [D.hubR, D.basketHubZ],
  ];
  basket.add(new THREE.Mesh(lathe(flangeProfile, 128), M.basket));
  // hub ring in front of the top plate
  basket.add(new THREE.Mesh(
    lathe([[D.hubR, D.basketHubZ], [D.hubR + 0.002, D.basketHubZ + 0.012], [0.096, D.basketHubZ + 0.010], [0.098, D.basketHubZ]], 96),
    M.basketDark,
  ));

  // spokes: tangential trapezoid, beveled like a casting, tilted up outward
  const L = 0.052;                          // radial length
  const spokeShape = new THREE.Shape();
  spokeShape.moveTo(0, -0.0075);
  spokeShape.lineTo(L, -0.0165);
  spokeShape.lineTo(L, 0.0165);
  spokeShape.lineTo(0, 0.0075);
  spokeShape.closePath();
  const spokeGeo = new THREE.ExtrudeGeometry(spokeShape, {
    depth: 0.011, bevelEnabled: true, bevelThickness: 0.0028, bevelSize: 0.0026, bevelSegments: 2,
  });
  spokeGeo.translate(0, 0, -0.0055);
  for (let k = 0; k < D.spokes; k++) {
    const spoke = new THREE.Mesh(spokeGeo, M.basket);
    const g = new THREE.Group();
    // tilt: outer (+X) end sits up near the flange underside
    spoke.rotation.y = -0.78;
    spoke.position.set(D.hubR + 0.002, 0, D.basketHubZ + 0.004);
    g.add(spoke);
    g.rotation.z = (k / D.spokes) * TAU;
    basket.add(g);
  }
  root.add(basket);

  /* ---- mounting screws on the flange (hex heads, outside the gasket) ---- */
  const screwGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.005, 6).rotateX(Math.PI / 2);
  for (let k = 0; k < D.spokes; k++) {
    const a = (k / D.spokes) * TAU + TAU / (D.spokes * 2);
    const s = new THREE.Mesh(screwGeo, M.blackPaint);
    s.position.set(Math.cos(a) * 0.1485, Math.sin(a) * 0.1485, 0.011);
    root.add(s);
  }

  /* ---- spider (corrugated fabric, flex) ---- */
  const spiderProfile = [];
  const SR0 = 0.060, SR1 = 0.103, waves = 7, SZ = -0.050;
  for (let i = 0; i <= 84; i++) {
    const t = i / 84;
    const r = lerp(SR0, SR1, t);
    spiderProfile.push([r, SZ + Math.sin(t * Math.PI * 2 * waves) * 0.0042 * (1 - t * 0.35)]);
  }
  const spider = new THREE.Mesh(lathe(spiderProfile, 96), M.spider);
  root.add(spider);
  flex.push(makeFlex(M.spider, SR0 - 0.001, SR1, ));

  /* ---- motor: plates, ferrite stack, pole vent ---- */
  const motor = new THREE.Group();
  const topPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(D.motorR, D.motorR, 0.012, 96).rotateX(Math.PI / 2),
    M.steel,
  );
  topPlate.position.z = D.motorTopZ - 0.006;
  const botPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(D.motorR, D.motorR, 0.012, 96).rotateX(Math.PI / 2),
    M.steel,
  );
  botPlate.position.z = D.motorBotZ - 0.006;
  const ferriteH = 0.024;
  for (const off of [0, 1]) {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(D.ferriteR, D.ferriteR, ferriteH, 96).rotateX(Math.PI / 2),
      M.ferrite,
    );
    ring.position.z = D.motorTopZ - 0.012 - ferriteH / 2 - off * (ferriteH + 0.0015);
    motor.add(ring);
  }
  // pole core + vented tip (recessed dark disc)
  const poleLen = Math.abs(D.poleTipZ - D.motorTopZ) + 0.012;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(D.poleR, D.poleR, poleLen, 64).rotateX(Math.PI / 2),
    M.blackPaint,
  );
  pole.position.z = D.motorTopZ + 0.004 - poleLen / 2;
  const vent = new THREE.Mesh(new THREE.CircleGeometry(D.poleR - 0.006, 48), M.cavity);
  vent.position.z = D.poleTipZ - 0.004;
  vent.rotation.y = Math.PI; // face rearward
  motor.add(topPlate, botPlate, pole, vent);
  root.add(motor);

  /* ---- terminal block + gold push terminals ---- */
  const term = new THREE.Group();
  const ca = Math.cos(D.termAngle), sa = Math.sin(D.termAngle);
  const blockGeo = RoundedBox(0.044, 0.026, 0.014, 3, 0.004);
  const block = new THREE.Mesh(blockGeo, M.termBlock);
  term.add(block);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.013, 20), M.gold);
    post.rotation.z = Math.PI / 2;
    post.position.set(0, s * 0.0062, 0.008);
    term.add(post);
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.0035, 20), M.termBlock);
    well.rotation.z = Math.PI / 2;
    well.position.set(0, s * 0.0062, 0.010);
    term.add(well);
  }
  term.position.set((D.flangeR - 0.004) * ca, (D.flangeR - 0.004) * sa, -0.016);
  term.rotation.z = D.termAngle;
  term.rotation.y = 0.5;
  root.add(term);

  return { root, moving, flex };
}

/** Minimal RoundedBox (avoids the examples/jsm import for one part). */
function RoundedBox(w, h, d, seg, r) {
  const g = new THREE.BoxGeometry(w - r * 2, h - r * 2, d - r * 2, seg, seg, seg);
  // quick-and-dirty rounding: chamfer via vertex clamp is overkill here —
  // a plain box with a dark rubber material reads fine at this size.
  return g;
}

/* ========================================================= audio engine */
const EQ_BANDS = [
  { hz: 60,   type: 'lowshelf',  q: 0.7, label: '60' },
  { hz: 150,  type: 'peaking',   q: 1.0, label: '150' },
  { hz: 400,  type: 'peaking',   q: 1.0, label: '400' },
  { hz: 1000, type: 'peaking',   q: 1.0, label: '1k' },
  { hz: 2400, type: 'peaking',   q: 1.0, label: '2.4k' },
  { hz: 6000, type: 'peaking',   q: 1.0, label: '6k' },
  { hz: 12000,type: 'peaking',   q: 0.9, label: '12k' },
  { hz: 16000,type: 'highshelf', q: 0.7, label: '16k' },
];

const PRESETS = {
  FLAT:       [0, 0, 0, 0, 0, 0, 0, 0],
  'BASS BOOST': [9, 7, 3, 0, 0, 0, 0, 0],
  DEEP:       [10, 5, -1, -2, 0, 0, 2, 3],
  LOUD:       [7, 4, 0, -2, -2, 0, 4, 7],
  VOCAL:      [-3, -1, 2, 4, 3, 2, 0, -1],
  TREBLE:     [0, 0, 0, 0, 2, 5, 7, 8],
};

const audio = {
  ctx: null,
  eqIn: null, eq: [], master: null, comp: null,
  tapLp: null, tap: null, tapBuf: null,
  // file playback
  fileBuf: null, fileName: '', src: null, playing: false, loop: false,
  startCtxT: 0, startOff: 0, expectedStop: false, muted: false,
  // demo synth
  demo: false, demoGain: null, nextNote: 0, step: 0, schedTimer: 0,
  // motion calibration
  peak: 0.25, gainSm: 8, dispSm: 0,

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.eqIn = c.createGain();
    let node = this.eqIn;
    for (const b of EQ_BANDS) {
      const f = c.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.hz;
      f.Q.value = b.q;
      f.gain.value = 0;
      node.connect(f); node = f;
      this.eq.push(f);
    }
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    node.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(c.destination);
    // low-passed analyser tap → signed cone excursion
    this.tapLp = c.createBiquadFilter();
    this.tapLp.type = 'lowpass';
    this.tapLp.frequency.value = 110;
    this.tapLp.Q.value = 0.9;
    this.master.connect(this.tapLp);
    this.tap = c.createAnalyser();
    this.tap.fftSize = 2048;
    this.tap.smoothingTimeConstant = 0;
    this.tapLp.connect(this.tap);
    this.tapBuf = new Float32Array(this.tap.fftSize);
    return this.ctx;
  },

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); },

  /* ---------- file playback ---------- */
  async loadFile(file) {
    const c = this.ensure();
    this.resume();
    const buf = await file.arrayBuffer();
    try {
      const decoded = await c.decodeAudioData(buf);
      this.stopDemo();
      this.stopFile(true);
      this.fileBuf = decoded;
      this.fileName = file.name;
      this.startOff = 0;
      ui.onTrackLoaded(file.name, decoded.duration);
      this.playFile();
      return true;
    } catch {
      toast(`Couldn't decode “${file.name}” — try MP3 or WAV.`);
      return false;
    }
  },

  playFile() {
    if (!this.fileBuf) return;
    const c = this.ctx;
    this.expectedStop = true;
    if (this.src) { try { this.src.stop(); } catch {} this.src.disconnect(); this.src = null; }
    const src = c.createBufferSource();
    src.buffer = this.fileBuf;
    src.loop = this.loop;
    src.connect(this.eqIn);
    const off = this.startOff % this.fileBuf.duration;
    src.onended = () => {
      if (this.expectedStop || this.src !== src) return;
      this.playing = false;
      this.startOff = 0;
      ui.onEnded();
    };
    src.start(0, off);
    this.src = src;
    this.startCtxT = c.currentTime;
    this.startOff = off;
    this.playing = true;
    this.expectedStop = false;
    ui.onPlayState(true);
  },

  pauseFile() {
    if (!this.playing) return;
    this.startOff = this.position();
    this.expectedStop = true;
    if (this.src) { try { this.src.stop(); } catch {} this.src.disconnect(); this.src = null; }
    this.playing = false;
    ui.onPlayState(false);
  },

  stopFile(silent) {
    this.expectedStop = true;
    if (this.src) { try { this.src.stop(); } catch {} this.src.disconnect(); this.src = null; }
    this.playing = false;
    this.startOff = 0;
    if (!silent) ui.onPlayState(false);
  },

  seek(frac) {
    if (!this.fileBuf) return;
    this.startOff = frac * this.fileBuf.duration;
    if (this.playing) this.playFile();
    ui.onSeek(this.position(), this.fileBuf.duration);
  },

  position() {
    if (!this.fileBuf) return 0;
    if (!this.playing || !this.ctx) return this.startOff;
    let p = this.startOff + (this.ctx.currentTime - this.startCtxT);
    const d = this.fileBuf.duration;
    if (this.loop && d > 0) p = p % d;
    return clamp(p, 0, d);
  },

  setLoop(v) {
    this.loop = v;
    if (this.src) this.src.loop = v;
  },

  /* ---------- demo synth (120 BPM bass pattern) ---------- */
  PATTERN: [1, 0, 0.55, 0, 1, 0.3, 0.55, 0.2],
  BPM: 120,

  startDemo() {
    const c = this.ensure();
    this.resume();
    this.stopFile(true);
    this.stopDemo(true);
    this.demoGain = c.createGain();
    this.demoGain.gain.value = 1.0;
    this.demoGain.connect(this.eqIn);
    this.demo = true;
    this.step = 0;
    this.nextNote = c.currentTime + 0.08;
    this.schedTimer = setInterval(() => this.schedule(), 90);
    ui.onPlayState(true);
    ui.onDemoState(true);
  },

  stopDemo(silent) {
    this.demo = false;
    if (this.schedTimer) { clearInterval(this.schedTimer); this.schedTimer = 0; }
    if (this.demoGain) { try { this.demoGain.disconnect(); } catch {} this.demoGain = null; }
    if (!silent) ui.onDemoState(false);
  },

  schedule() {
    if (!this.demo || !this.ctx) return;
    const t = this.ctx.currentTime;
    // stall rebase: after tab-suspend / clock hiccups, never burst-schedule
    // a backlog of past-timed notes (they would all render silently)
    if (this.nextNote < t - 0.2) this.nextNote = t + 0.05;
    while (this.nextNote < t + 0.18) {
      const v = this.PATTERN[this.step % this.PATTERN.length];
      if (v > 0) this.kick(this.nextNote, v);
      this.step++;
      this.nextNote += 60 / this.BPM / 2;
    }
  },

  kick(t0, v) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(54, t0);
    o.frequency.exponentialRampToValueAtTime(28, t0 + 0.24);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    o.connect(g); g.connect(this.demoGain);
    o.start(t0); o.stop(t0 + 0.36);
  },

  /* ---------- per-frame excursion (signed, auto-calibrated) ---------- */
  sampleExcursion(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return 0;
    this.tap.getFloatTimeDomainData(this.tapBuf);
    const n = this.tapBuf.length;
    const s = this.tapBuf[n - 96]; // slightly delayed → avoids edge latency
    const a = Math.abs(s);
    // rolling peak with slow decay → any track auto-normalizes
    this.peak = Math.max(a, this.peak * Math.exp(-dt / 1.6));
    this.peak = Math.max(this.peak, 0.02);
    const targetGain = clamp(0.85 / this.peak, 1.2, 90);
    this.gainSm = lerp(this.gainSm, targetGain, clamp(dt * 2.2, 0, 1));
    const x = s * this.gainSm;
    return Math.tanh(x * 1.25) * 0.95;
  },
};

/* ================================================================ scene */
const XMAX_M = 0.014;          // visual excursion limit (±14 mm ≈ Xmax 1X)
let renderer, scene, camera, sub, moving, flexRefs;
let motionScale = 1.0;
const cam = { theta: 0.5, phi: 1.42, radius: 0.56 };
const camHome = { ...cam };
const target = new THREE.Vector3(0, -0.028, 0);
let userGrabbed = false, driftT = 0;

function bootScene(stage) {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050506);

  camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);

  // studio environment → correct PBR metal / rubber / gloss response
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xdadada, 0x050505, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1.5, 2.1, 2.3);
  scene.add(key);
  const rimA = new THREE.DirectionalLight(0xd8d8e2, 1.35);
  rimA.position.set(-1.9, 1.1, -1.6);
  scene.add(rimA);
  const rimB = new THREE.PointLight(0xffffff, 3.0, 5, 2);
  rimB.position.set(0.9, -0.8, 1.6);
  scene.add(rimB);

  // the sub — and nothing else
  const built = buildSubwoofer();
  sub = built.root;
  moving = built.moving;
  flexRefs = built.flex;
  scene.add(sub);

  // soft contact shadow blob below the driver
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 0.85),
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
  );
  shadow.position.y = -0.205;
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  applyCam();
}

function applyCam() {
  const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
  camera.position.set(
    target.x + cam.radius * sp * Math.sin(cam.theta),
    target.y + cam.radius * cp,
    target.z + cam.radius * sp * Math.cos(cam.theta),
  );
  camera.lookAt(target);
}

/* =============================================================== camera */
function bindCamera(dom) {
  let dragging = false, px = 0, py = 0, pinchD = 0;
  dom.addEventListener('pointerdown', (e) => {
    dragging = true; userGrabbed = true; px = e.clientX; py = e.clientY;
    try { dom.setPointerCapture(e.pointerId); } catch {}
  });
  dom.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    cam.theta -= (e.clientX - px) * 0.0062;
    cam.phi = clamp(cam.phi - (e.clientY - py) * 0.0052, 0.32, Math.PI - 0.3);
    px = e.clientX; py = e.clientY;
    applyCam();
  });
  const up = () => { dragging = false; };
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('dblclick', () => { Object.assign(cam, camHome); userGrabbed = false; applyCam(); });
  dom.addEventListener('wheel', (e) => {
    e.preventDefault(); userGrabbed = true;
    cam.radius = clamp(cam.radius * (1 + Math.sign(e.deltaY) * 0.085), 0.30, 1.6);
    applyCam();
  }, { passive: false });
  dom.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault(); userGrabbed = true;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchD) { cam.radius = clamp(cam.radius * (pinchD / d), 0.30, 1.6); applyCam(); }
      pinchD = d;
    }
  }, { passive: false });
  dom.addEventListener('touchend', () => { pinchD = 0; });
}

/* =================================================================== UI */
const ui = {
  els: {},

  init() {
    const ids = ['importBtn', 'demoBtn', 'playBtn', 'seekBar', 'seekFill', 'timeNow', 'timeTot',
      'trackName', 'loopBtn', 'eqBtn', 'eqPanel', 'eqBands', 'presets', 'motionBar', 'motionFill',
      'motionVal', 'muteBtn', 'excVal', 'fileInput', 'drop', 'stage'];
    ids.forEach((i) => { this.els[i] = el(i); });

    // import
    this.els.importBtn.addEventListener('click', () => this.els.fileInput.click());
    this.els.fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) audio.loadFile(f);
      e.target.value = '';
    });
    // drag & drop
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; this.els.drop.classList.add('on'); });
    window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; this.els.drop.classList.remove('on'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; this.els.drop.classList.remove('on');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) audio.loadFile(f);
    });

    // transport
    this.els.playBtn.addEventListener('click', () => this.togglePlay());
    this.els.demoBtn.addEventListener('click', () => {
      if (audio.demo) { audio.stopDemo(); } else { audio.startDemo(); }
    });
    this.els.loopBtn.addEventListener('click', () => {
      audio.setLoop(!audio.loop);
      this.els.loopBtn.classList.toggle('on', audio.loop);
      toast(audio.loop ? 'Loop on' : 'Loop off', 1200);
    });
    this.els.muteBtn.addEventListener('click', () => {
      audio.ensure();
      audio.muted = !audio.muted;
      audio.master.gain.value = audio.muted ? 0 : 0.9;
      this.els.muteBtn.classList.toggle('on', audio.muted);
    });
    this.els.eqBtn.addEventListener('click', () => this.els.eqPanel.classList.toggle('open'));

    // seek bar (pointer)
    const bar = this.els.seekBar;
    const seekTo = (e) => {
      if (!audio.fileBuf) return;
      const r = bar.getBoundingClientRect();
      audio.seek(clamp((e.clientX - r.left) / r.width, 0, 1));
    };
    let seeking = false;
    bar.addEventListener('pointerdown', (e) => { seeking = true; try { bar.setPointerCapture(e.pointerId); } catch {} seekTo(e); });
    bar.addEventListener('pointermove', (e) => { if (seeking) seekTo(e); });
    bar.addEventListener('pointerup', () => { seeking = false; });

    this.buildEQ();
    this.buildPresets();
    this.buildMotion();

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'e' || e.key === 'E') this.els.eqPanel.classList.toggle('open');
      else if (e.key === 'l' || e.key === 'L') this.els.loopBtn.click();
    });
  },

  togglePlay() {
    if (audio.demo) { audio.stopDemo(); return; }
    if (!audio.fileBuf) { toast('Import an MP3 first — or hit Demo.', 2000); return; }
    audio.ensure(); audio.resume();
    if (audio.playing) audio.pauseFile(); else audio.playFile();
  },

  buildEQ() {
    const wrap = this.els.eqBands;
    EQ_BANDS.forEach((band, i) => {
      const b = document.createElement('div');
      b.className = 'band';
      b.innerHTML = `
        <div class="val">0</div>
        <div class="fader" role="slider" tabindex="0" aria-label="${band.hz} Hz"
             aria-valuemin="-12" aria-valuemax="12" aria-valuenow="0">
          <div class="rail"></div><div class="fill"></div><div class="thumb"></div>
        </div>
        <div class="hz">${band.label}</div>`;
      wrap.appendChild(b);
      const fader = b.querySelector('.fader');
      const thumb = b.querySelector('.thumb');
      const fill = b.querySelector('.fill');
      const val = b.querySelector('.val');
      let db = 0;
      const render = () => {
        const frac = (db + 12) / 24;                 // 0 top … 1 bottom
        thumb.style.top = `${frac * 100}%`;
        const center = 50;
        const top = Math.min(frac * 100, center);
        const h = Math.abs(frac * 100 - center);
        fill.style.top = `${top}%`;
        fill.style.height = `${h}%`;
        val.textContent = (db > 0 ? '+' : '') + db.toFixed(0);
        val.classList.toggle('hot', db !== 0);
        fader.setAttribute('aria-valuenow', db.toFixed(0));
      };
      const setFromY = (clientY) => {
        const r = fader.getBoundingClientRect();
        db = clamp((1 - (clientY - r.top) / r.height) * 24 - 12, -12, 12);
        db = Math.round(db * 2) / 2;
        if (audio.eq[i]) audio.eq[i].gain.value = db;
        this.presetName = '';
        this.markPreset();
        render();
      };
      let drag = false;
      fader.addEventListener('pointerdown', (e) => { drag = true; try { fader.setPointerCapture(e.pointerId); } catch {} setFromY(e.clientY); });
      fader.addEventListener('pointermove', (e) => { if (drag) setFromY(e.clientY); });
      fader.addEventListener('pointerup', () => { drag = false; });
      fader.addEventListener('dblclick', () => { db = 0; if (audio.eq[i]) audio.eq[i].gain.value = 0; render(); });
      fader.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') { db = clamp(db + 1, -12, 12); }
        else if (e.key === 'ArrowDown') { db = clamp(db - 1, -12, 12); }
        else return;
        e.preventDefault();
        if (audio.eq[i]) audio.eq[i].gain.value = db;
        render();
      });
      this.els['band' + i] = { render, setDb: (v) => { db = v; if (audio.eq[i]) audio.eq[i].gain.value = v; render(); } };
      render();
    });
  },

  presetName: 'FLAT',
  buildPresets() {
    const wrap = this.els.presets;
    Object.keys(PRESETS).forEach((name) => {
      const c = document.createElement('button');
      c.className = 'chip';
      c.textContent = name;
      c.addEventListener('click', () => {
        const vals = PRESETS[name];
        vals.forEach((v, i) => this.els['band' + i].setDb(v));
        this.presetName = name;
        this.markPreset();
      });
      wrap.appendChild(c);
      this.els['preset_' + name] = c;
    });
    this.markPreset();
  },
  markPreset() {
    Object.keys(PRESETS).forEach((name) => {
      this.els['preset_' + name].classList.toggle('on', name === this.presetName);
    });
  },

  buildMotion() {
    const bar = this.els.motionBar;
    const set = (clientX) => {
      const r = bar.getBoundingClientRect();
      const frac = clamp((clientX - r.left) / r.width, 0.05, 1.6);
      motionScale = Math.round(frac * 200) / 200;
      this.els.motionFill.style.width = `${clamp(motionScale, 0, 1) * 100}%`;
      this.els.motionVal.textContent = `${Math.round(motionScale * 100)}%`;
    };
    let drag = false;
    bar.addEventListener('pointerdown', (e) => { drag = true; try { bar.setPointerCapture(e.pointerId); } catch {} set(e.clientX); });
    bar.addEventListener('pointermove', (e) => { if (drag) set(e.clientX); });
    bar.addEventListener('pointerup', () => { drag = false; });
  },

  onTrackLoaded(name, dur) {
    this.els.trackName.textContent = name;
    this.els.trackName.title = name;
    this.els.timeTot.textContent = fmtTime(dur);
    this.els.playBtn.disabled = false;
    this.els.loopBtn.disabled = false;
    this.els.demoBtn.classList.remove('on');
    this.els.seekFill.style.width = '0%';
    toast(`Loaded “${name}” — playing through the EQ`);
  },
  onPlayState(playing) {
    el('icoPlay').style.display = playing ? 'none' : '';
    el('icoPause').style.display = playing ? '' : 'none';
  },
  onDemoState(on) {
    this.els.demoBtn.classList.toggle('on', on);
    if (on) {
      this.els.trackName.innerHTML = '<em>demo loop — 120 BPM</em>';
      this.els.timeTot.textContent = '∞';
      this.els.playBtn.disabled = false;
    } else if (!audio.fileBuf) {
      this.els.trackName.innerHTML = '<em>no track — import an mp3 or hit Demo</em>';
      this.els.timeTot.textContent = '0:00';
      this.onPlayState(false);
    }
  },
  onEnded() {
    this.onPlayState(false);
    this.els.seekFill.style.width = '0%';
    this.els.timeNow.textContent = '0:00';
  },
  onSeek(pos, dur) {
    this.els.timeNow.textContent = fmtTime(pos);
    this.els.seekFill.style.width = `${(pos / dur) * 100}%`;
  },
};

/* ============================================================ main loop */
let lastT = performance.now() / 1000, hudT = 0;
function loop() {
  requestAnimationFrame(loop);
  const t = performance.now() / 1000;
  const dt = clamp(t - lastT, 0.001, 0.1);
  lastT = t;

  // idle drift — a slow product-shot sway until the user grabs the camera
  if (!userGrabbed) {
    driftT += dt;
    cam.theta = camHome.theta + Math.sin(driftT * 0.16) * 0.14;
    cam.phi = camHome.phi + Math.sin(driftT * 0.11 + 1.2) * 0.045;
    applyCam();
  }

  // excursion: signed low-band waveform → cone in/out
  let norm = audio.sampleExcursion(dt);
  if (!audio.playing && !audio.demo) norm = lerp(audio.dispSm, 0, clamp(dt * 3, 0, 1));
  audio.dispSm = lerp(audio.dispSm, norm, norm > Math.abs(audio.dispSm) ? clamp(dt * 30, 0, 1) : clamp(dt * 9, 0, 1));
  const disp = clamp(audio.dispSm, -1, 1) * XMAX_M * motionScale;
  moving.position.z = disp;
  for (const f of flexRefs) f.uDisp.value = disp;

  // HUD + seek
  hudT += dt;
  if (hudT > 0.12) {
    hudT = 0;
    ui.els.excVal.textContent = (Math.abs(disp) * 1000).toFixed(1);
    if (audio.fileBuf && audio.playing) ui.onSeek(audio.position(), audio.fileBuf.duration);
  }

  renderer.render(scene, camera);
}

/* ================================================================= boot */
async function boot() {
  const stage = el('stage');
  initTextures();
  initMaterials();
  try {
    bootScene(stage);
  } catch (err) {
    const e = el('err');
    e.style.display = 'flex';
    e.innerHTML = 'WebGL is unavailable in this browser.<br>Try a recent Chrome, Edge, Firefox or Safari.';
    return;
  }
  bindCamera(renderer.domElement);
  ui.init();
  window.addEventListener('resize', () => {
    const w = stage.clientWidth || 320, h = stage.clientHeight || 340;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  window.dispatchEvent(new Event('resize'));
  loop();

  el('loader').classList.add('done');
  setTimeout(() => el('loader').remove(), 600);

  // ?autostart → straight into the demo loop
  if (new URLSearchParams(location.search).has('autostart')) {
    const kick = () => { audio.startDemo(); window.removeEventListener('pointerdown', kick); };
    window.addEventListener('pointerdown', kick);
  }
  console.log('[sonivex] live subwoofer online — procedural driver · EQ · excursion drive');
  // debug/test handle (harmless in production)
  window.__svx = { audio, get disp() { return moving ? moving.position.z : 0; }, cam, applyCam };
}

boot();

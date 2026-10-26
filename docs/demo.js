/**
 * Sonivex Studio — mobile GitHub Pages 3D preview.
 * Loads the real 15-part Tripo GLB, applies studio fallback materials,
 * and drives the cone (part #3 = tripo_part_2, driver axis X) with a
 * synthesized bass beat through a first-order excursion envelope.
 * Simplified visualization of the desktop app's motion system.
 */

const MODEL_URL = 'assets/models/loudspeaker.glb';
// Geometry-verified: tripo_part_3 is the cone dish (spans the full radius to the
// axis). tripo_part_2 is the thin surround ring around it — never animated.
const CONE_NAME = 'tripo_part_3';
const CONE_FALLBACK_INDEX = 3;
const CARRIER_HZ = 36;
const BPM = 120;
const PATTERN = [1, 0, 0.5, 0, 1, 0, 0.55, 0.3]; // eighth-note velocity map

let booted = false;
let raf = 0;

export async function launchDemo() {
  if (booted) return;
  booted = true;

  const overlay = document.getElementById('stageOverlay');
  const stage = document.getElementById('stage');
  const prog = document.getElementById('prog');
  const progFill = document.getElementById('progFill');
  const status = document.getElementById('stageStatus');
  const bar = document.getElementById('demoBar');

  const setStatus = (t) => { status.textContent = t; };
  const setProg = (p) => { prog.classList.add('on'); progFill.style.width = `${Math.round(p * 100)}%`; };

  setStatus('loading three.js from CDN …');
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

  // ---- fetch with progress ----
  setStatus('fetching model …');
  const resp = await fetch(MODEL_URL);
  if (!resp.ok) throw new Error(`model fetch failed: ${resp.status}`);
  const total = Number(resp.headers.get('content-length')) || 0;
  let buf;
  if (resp.body && total) {
    const reader = resp.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      setProg(got / total);
    }
    buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    buf = buf.buffer;
  } else {
    setProg(0.8);
    buf = await resp.arrayBuffer();
  }

  // ---- renderer / scene ----
  setStatus('preparing scene …');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);
  scene.fog = new THREE.Fog(0x07090c, 8, 17);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);

  scene.add(new THREE.HemisphereLight(0x46586c, 0x05070a, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(3.2, 4.4, 3.0);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd6e4, 0.5);
  fill.position.set(-3.4, 1.4, 2.2);
  scene.add(fill);
  const rim = new THREE.PointLight(0x22d3ee, 14, 14, 2);
  rim.position.set(-2.6, 1.6, -3.0);
  scene.add(rim);

  const grid = new THREE.GridHelper(14, 28, 0x1c2530, 0x131a23);
  grid.material.transparent = true;
  grid.material.opacity = 0.42;
  grid.position.y = -1.72;
  scene.add(grid);

  // ---- parse model ----
  setStatus('parsing 15 parts …');
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
  const root = gltf.scene;

  // studio fallback materials for blank Tripo exports
  const palette = [
    { c: 0x3a434f, r: 0.38, m: 0.85 }, // gunmetal
    { c: 0x151a20, r: 0.92, m: 0.05 }, // rubber
    { c: 0x707884, r: 0.30, m: 0.90 }, // aluminum
    { c: 0x1b2027, r: 0.55, m: 0.35 }, // dark steel
  ];
  let mi = 0;
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    const mat = o.material;
    const blank = mat && !mat.map && (mat.color?.getHex() ?? 0xffffff) === 0xffffff
      && (mat.metalness ?? 0) === 0 && (mat.roughness ?? 1) === 1;
    if (blank) {
      const isCone = o.name === CONE_NAME;
      const p = isCone
        ? { c: 0x23272e, r: 0.50, m: 0.18 } // composite cone
        : palette[mi % palette.length];
      o.material = new THREE.MeshStandardMaterial({ color: p.c, roughness: p.r, metalness: p.m });
    }
    mi++;
  });
  console.log('[sonivex-demo] meshes:', meshes.map((m) => m.name).join(', '));

  // normalize + center
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 3.0 / maxDim;
  root.scale.setScalar(s);
  root.position.sub(center.multiplyScalar(s));

  scene.add(root);

  // cone part — driver axis is X (verified in app inspection)
  let cone = meshes.find((m) => m.name === CONE_NAME)
    || meshes[CONE_FALLBACK_INDEX]
    || meshes.find((m) => /cone/i.test(m.name))
    || null;
  let restX = 0, amp = 0.1;
  if (cone) {
    cone.updateWorldMatrix(true, false);
    restX = cone.position.x;
    const cbox = new THREE.Box3().setFromObject(cone);
    const csize = new THREE.Vector3(); cbox.getSize(csize);
    amp = 0.045 * Math.max(csize.y, csize.z) * s; // ~4.5% of cone radius
    // animated directly as a rigid body — same contract as desktop motion modes
  }

  // ---- camera orbit (touch + mouse) ----
  const target = new THREE.Vector3(0, 0, 0);
  const cam = { radius: 5.4, theta: 0.9, phi: 1.18 };
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
  let nextNote = 0, step = 0, clockOrigin = 0;
  const kicks = []; // {t, v}
  const now = () => (actx && soundOn ? actx.currentTime : performance.now() / 1000);

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
  const scheduler = () => {
    if (!playing) return;
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
    if (playing) { kicks.length = 0; nextNote = now() + 0.08; } // rebase timeline after clock switch
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
    if (cone) cone.position.x = restX + disp;
    if (t - lastHud > 0.1) {
      lastHud = t;
      hudX.textContent = (disp / (amp || 1) * 7).toFixed(1);
    }
    renderer.render(scene, camera);
  };
  loop();

  // ---- done ----
  overlay.style.transition = 'opacity .5s';
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.remove(); }, 520);
  bar.hidden = false;
  setStatus('live · drag to orbit · pinch to zoom');
  console.log('[sonivex-demo] preview online. cone =', cone ? cone.name : 'n/a');
}

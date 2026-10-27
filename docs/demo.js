/**
 * Sonivex Studio — mobile GitHub Pages 3D preview.
 *
 * v1.0.3: NO downloaded model. The driver is generated in code by the same
 * Driver Studio engine the desktop app uses (bundled to driver-model.js):
 * 14 independently modeled components — cone, dust cap, surround roll,
 * voice coil + former, spider, magnet stack, plates, pole, basket, gasket,
 * terminals, tinsel leads, hardware — assembled with real mechanical
 * relationships and rendered in strict black & white.
 *
 * Motion uses the desktop app's MotionSystem: cone / dust cap / coil / leads
 * translate as a rigid group; the surround and spider are flex-only
 * deformables whose inner edges track the cone exactly while their outer
 * edges stay bolted to the frame — the same attachment contract, pinned by
 * unit tests on both ends.
 */
import { DriverStudio, MotionSystem, defaultStudioConfig } from './driver-model.js';

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
  setProg(0.35);

  // ---- renderer / scene (strict monochrome) ----
  setStatus('building procedural driver …');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070708);
  scene.fog = new THREE.Fog(0x070708, 1.4, 3.4);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);

  scene.add(new THREE.HemisphereLight(0xe8e8e8, 0x0a0a0a, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.6, 2.2, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8c8c8, 0.5);
  fill.position.set(-1.8, 0.8, 1.2);
  scene.add(fill);
  const rim = new THREE.PointLight(0xf0f0f0, 5.5, 6, 2);
  rim.position.set(-1.2, 1.0, -1.6);
  scene.add(rim);

  const grid = new THREE.GridHelper(2.4, 24, 0x232326, 0x141417);
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  grid.position.y = -0.235;
  scene.add(grid);

  // ---- procedural driver (no model download) ----
  const studio = new DriverStudio(defaultStudioConfig('subwoofer'));
  scene.add(studio.root);
  setProg(0.75);

  // display stand (same as the desktop Driver Only view)
  const standMat = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.55, metalness: 0.35 });
  const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.013, 12, 64), standMat);
  cradle.rotation.x = Math.PI / 2;
  cradle.position.z = -0.08;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.3, 32), standMat);
  pedestal.position.y = -0.2;
  pedestal.castShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.02, 48), standMat);
  base.position.y = -0.36;
  scene.add(cradle, pedestal, base);

  // ---- motion: identical attachment contract to the desktop app ----
  const motion = new MotionSystem(scene);
  const group = {
    id: 'g1', name: 'Cone Assembly', partIds: studio.movingPartIds(), enabled: true,
    axis: 'z', pivot: [0, 0, 0], maxDisplacementMM: 0, gain: 1, smoothingMs: 60,
    mode: 'A', bandLowHz: 20, bandHighHz: 120, invert: false,
  };
  const XMAX_M = 0.013; // ~half of the winding over-hang for the 12″ default
  motion.rebuild([group], studio.partObjects(), studio.flexPartIds(), XMAX_M);
  motion.setAxis('g1', 'z');
  setProg(1);

  // ---- exploded view ----
  let explodeTarget = 0;
  let explodeCur = 0;
  const applyExplode = (f) => {
    studio.applyExplode(f);
    const offsets = new Map();
    studio.components.forEach((c) => offsets.set(c.object, c.explodeOffset.clone().multiplyScalar(f)));
    motion.setPartOffsets(offsets);
  };

  // ---- camera orbit (touch + mouse) ----
  const target = new THREE.Vector3(0, 0, -0.03);
  const cam = { radius: 0.72, theta: 0.85, phi: 1.25 };
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
    cam.radius = Math.min(1.8, Math.max(0.34, cam.radius * (1 + Math.sign(e.deltaY) * 0.09)));
    applyCam();
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault(); interacting = true;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchD) {
        cam.radius = Math.min(1.8, Math.max(0.34, cam.radius * (pinchD / d)));
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
  // running. A suspended/blocked context must never freeze the visuals.
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
  const btnExplode = document.getElementById('btnExplode');
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
    if (playing) { clockWasAudio = audioClockOk(); kicks.length = 0; nextNote = now() + 0.08; }
  });
  btnExplode.addEventListener('click', () => {
    explodeTarget = explodeTarget > 0.5 ? 0 : 1;
    btnExplode.classList.toggle('on', explodeTarget > 0.5);
    btnExplode.querySelector('span').textContent = explodeTarget > 0.5 ? 'Assemble' : 'Explode';
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
  let lastT = now();
  let lastHud = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const t = now();
    const dt = Math.min(t - lastT, 0.1) || 0.016;
    lastT = t;

    if (!interacting) { cam.theta += 0.0016; applyCam(); }

    // exploded view easing
    if (Math.abs(explodeTarget - explodeCur) > 1e-3) {
      explodeCur += (explodeTarget - explodeCur) * Math.min(dt * 6, 1);
      if (Math.abs(explodeTarget - explodeCur) < 1e-3) explodeCur = explodeTarget;
      applyExplode(explodeCur);
    }

    const env = playing ? envAt(t) : 0;
    const disp = env * Math.sin(2 * Math.PI * CARRIER_HZ * t) * XMAX_M * 0.92;
    motion.apply('g1', disp, dt);

    if (t - lastHud > 0.1) {
      lastHud = t;
      hudX.textContent = (Math.abs(disp) * 1000).toFixed(1);
    }
    renderer.render(scene, camera);
  };
  loop();

  // shareable deep link: /?autostart=1 boots straight into the beat
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
  setStatus('live · drag to orbit · pinch to zoom · no model was downloaded');
  console.log('[sonivex-demo] procedural driver online — components:',
    [...studio.components.keys()].join(', '),
    '· moving:', studio.movingPartIds().join('/'),
    '· flex:', studio.flexPartIds().join('/'));
}

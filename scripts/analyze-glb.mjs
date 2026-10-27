#!/usr/bin/env node
/**
 * Geometry inspector for the 15-part Tripo GLB.
 * Decodes the JSON + POSITION accessor min/max, applies node transforms,
 * and prints per-part bbox, radial extents around the candidate driver
 * axis, and axial ordering — used to verify cone/surround identification
 * and the surround's inner (cone-side) vs outer (frame-side) radii.
 *
 * Usage: node scripts/analyze-glb.mjs [path-to-glb]
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../docs/assets/models/loudspeaker.glb', import.meta.url).pathname;
const buf = readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// ---- GLB header ----
if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (magic)');
const jsonLen = dv.getUint32(12, true);
const jsonType = dv.getUint32(16, true);
if (jsonType !== 0x4e4f534a) throw new Error('first chunk is not JSON');
// NB: buf is a Node Buffer (a Uint8Array view) — always use subarray, never
// `new Uint8Array(buf, off, len)` (that form copies and ignores off/len).
const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));

// ---- matrix helpers ----
function decompose(m) {
  // column-major 4x4 → translation, quaternion-based scale (assumes uniform-ish)
  const t = [m[12], m[13], m[14]];
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  // rotation extraction (no shear assumed)
  const r = [
    [m[0] / sx, m[4] / sy, m[8] / sz],
    [m[1] / sx, m[5] / sy, m[9] / sz],
    [m[2] / sx, m[6] / sy, m[10] / sz],
  ];
  return { t, r, s: [sx, sy, sz] };
}
function apply({ t, r, s }, p) {
  const x = r[0][0] * p[0] * s[0] + r[0][1] * p[1] * s[1] + r[0][2] * p[2] * s[2] + t[0];
  const y = r[1][0] * p[0] * s[0] + r[1][1] * p[1] * s[1] + r[1][2] * p[2] * s[2] + t[1];
  const z = r[2][0] * p[0] * s[0] + r[2][1] * p[1] * s[1] + r[2][2] * p[2] * s[2] + t[2];
  return [x, y, z];
}

// collect nodes with meshes, world transforms
const nodes = json.nodes || [];
const world = new Map();
(function walk(i, parentM) {
  const n = nodes[i];
  const local = n.matrix
    ? [...n.matrix]
    : (() => {
      // build TRS matrix
      const q = n.rotation || [0, 0, 0, 1];
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
      ];
      const sc = n.scale || [1, 1, 1];
      const t = n.translation || [0, 0, 0];
      // column-major
      return [
        r[0][0] * sc[0], r[1][0] * sc[0], r[2][0] * sc[0], 0,
        r[0][1] * sc[1], r[1][1] * sc[1], r[2][1] * sc[1], 0,
        r[0][2] * sc[2], r[1][2] * sc[2], r[2][2] * sc[2], 0,
        t[0], t[1], t[2], 1,
      ];
    })();
  const m = parentM
    ? mul(parentM, local)
    : local;
  world.set(i, m);
  (n.children || []).forEach((c) => walk(c, m));
})(0, null) /* single root assumed */;

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let rI = 0; rI < 4; rI++)
      for (let k = 0; k < 4; k++) o[c * 4 + rI] += a[k * 4 + rI] * b[c * 4 + k];
  return o;
}

const BIN_OFF = 20 + jsonLen + 8; // skip JSON chunk header
const bin = buf.subarray(BIN_OFF, BIN_OFF + dv.getUint32(20 + jsonLen, true));

function readPositions(accI) {
  const acc = json.accessors[accI];
  const bv = json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  // NOTE: assumes tightly packed (stride 12) — true for this export
  const f32 = new Float32Array(bin.buffer, bin.byteOffset + off, acc.count * 3);
  const out = [];
  for (let i = 0; i < acc.count; i++) out.push([f32[i * 3], f32[i * 3 + 1], f32[i * 3 + 2]]);
  return { out, count: acc.count, min: acc.min, max: acc.max };
}

// walk scene nodes in order, print per-mesh stats
const scenes = json.scenes || [{ nodes: [0] }];
const rows = [];
for (const nodeIdx of scenes[0].nodes) {
  (function rec(i, seen = new Set()) {
    if (seen.has(i)) return; seen.add(i);
    const n = nodes[i];
    if (n.mesh !== undefined) {
      const M = decompose(world.get(i));
      const prim = json.meshes[n.mesh].primitives[0];
      const { out, count } = readPositions(prim.attributes.POSITION);
      // world-space bbox
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      const pts = out.map((p) => apply(M, p));
      for (const p of pts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); }
      const size = mx.map((v, a) => v - mn[a]);
      const ctr = mn.map((v, a) => (v + mx[a]) / 2);
      rows.push({ name: n.name || `mesh_${n.mesh}`, count, mn, mx, size, ctr });
    }
    (n.children || []).forEach((c) => rec(c, seen));
  })(nodeIdx);
}

// global axis center (radial center across all parts, per candidate axis)
const gCtr = [0, 1, 2].map((a) => rows.reduce((s, r) => s + r.ctr[a], 0) / rows.length);

console.log(`file: ${file}`);
console.log(`meshes: ${rows.length}`);
console.log(`global centroid: x=${gCtr[0].toFixed(4)} y=${gCtr[1].toFixed(4)} z=${gCtr[2].toFixed(4)}`);
console.log();
console.log('idx | name                | verts | size x/y/z            | center x/y/z            | rX (y-z radial) | rY (x-z radial) | rZ (x-y radial)');
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const radial = (axA, axB) => {
    // min/max radius of vertices around axis center using dims axA/axB (world pts)
    let rMin = 1e9, rMax = -1;
    // re-derive from bbox corners is wrong for rings; do proper per-vertex scan
    return { rMin, rMax, needVerts: true };
  };
  console.log(
    `${String(i).padStart(3)} | ${r.name.padEnd(19)} | ${String(r.count).padStart(5)} | ` +
    r.size.map((v) => v.toFixed(3).padStart(5)).join('/') + ' | ' +
    r.ctr.map((v) => v.toFixed(3).padStart(5)).join('/') + ' | ' +
    '—',
  );
}

// precise radial scan for the interesting parts (all of them; cheap enough)
console.log();
console.log('== radial scan (per-vertex, world space) ==');
for (let i = 0; i < rows.length; i++) {
  const n = nodes[nodeIndexForMesh(rows[i].name)];
  if (!n) continue;
}
function nodeIndexForMesh() { return -1; }

// simpler: rescan by re-walking
const scanRows = [];
for (const nodeIdx of scenes[0].nodes) {
  (function rec(i, seen = new Set()) {
    if (seen.has(i)) return; seen.add(i);
    const n = nodes[i];
    if (n.mesh !== undefined) {
      const M = decompose(world.get(i));
      const prim = json.meshes[n.mesh].primitives[0];
      const { out } = readPositions(prim.attributes.POSITION);
      const pts = out.map((p) => apply(M, p));
      const stats = {};
      for (const [axis, [a, b]] of Object.entries({ X: [1, 2], Y: [0, 2], Z: [0, 1] })) {
        let rMin = 1e9, rMax = -1;
        for (const p of pts) {
          const rr = Math.hypot(p[a] - gCtr[a], p[b] - gCtr[b]);
          if (rr < rMin) rMin = rr;
          if (rr > rMax) rMax = rr;
        }
        stats[axis] = { rMin, rMax };
      }
      const axial = (ax) => pts.reduce((s, p) => s + p[ax], 0) / pts.length;
      scanRows.push({ name: n.name, stats, axialX: axial(0), axialY: axial(1), axialZ: axial(2), verts: pts.length });
    }
    (n.children || []).forEach((c) => rec(c, seen));
  })(nodeIdx);
}
for (let i = 0; i < scanRows.length; i++) {
  const r = scanRows[i];
  const fmt = (s) => `${s.rMin.toFixed(3)}–${s.rMax.toFixed(3)}`;
  console.log(
    `${String(i).padStart(3)} ${r.name.padEnd(19)} rX=${fmt(r.stats.X)} rY=${fmt(r.stats.Y)} rZ=${fmt(r.stats.Z)} | meanAxial x=${r.axialX.toFixed(3)} y=${r.axialY.toFixed(3)} z=${r.axialZ.toFixed(3)}`,
  );
}

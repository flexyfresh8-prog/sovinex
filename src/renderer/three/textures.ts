/**
 * Procedural canvas textures for studio-grade materials.
 * All generated at runtime — zero binary assets.
 */
import * as THREE from 'three';

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function toNormalTexture(canvas: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = toTexture(canvas, repeat);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Fine carbon-fiber weave normal map. */
export function weaveNormalMap(size = 512, scale = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);
  const cell = size / (16 * scale);
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const horiz = ((x / cell) + (y / cell)) % 2 === 0;
      const g = ctx.createLinearGradient(x, y, horiz ? x + cell : x, horiz ? y : y + cell);
      g.addColorStop(0, 'rgb(90,90,220)');
      g.addColorStop(0.5, 'rgb(160,160,255)');
      g.addColorStop(1, 'rgb(90,90,220)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
      // strand grooves
      ctx.strokeStyle = 'rgba(60,60,180,0.5)';
      ctx.lineWidth = 1;
      for (let s = 0; s < cell; s += Math.max(2, cell / 6)) {
        ctx.beginPath();
        if (horiz) { ctx.moveTo(x, y + s); ctx.lineTo(x + cell, y + s); }
        else { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + cell); }
        ctx.stroke();
      }
    }
  }
  return toNormalTexture(c, 4);
}

/** Brushed metal normal map — horizontal streaks. */
export function brushedNormalMap(size = 512): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const y = Math.random() * size;
    const len = 30 + Math.random() * 200;
    const x = Math.random() * size;
    const bright = Math.random() > 0.5;
    ctx.strokeStyle = bright ? `rgba(200,200,255,${0.05 + Math.random() * 0.12})` : `rgba(60,60,140,${0.05 + Math.random() * 0.12})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 1.5);
    ctx.stroke();
  }
  return toNormalTexture(c, 2);
}

/** Subtle paper/pulp noise normal map for cones. */
export function paperNormalMap(size = 512): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = 128 + (Math.random() - 0.5) * 26;
    // slight directional stipple
    const x = i % size, y = (i / size) | 0;
    const streak = Math.sin(x * 0.7 + Math.sin(y * 0.2) * 3) * 4;
    img.data[i * 4] = 128 + streak + (Math.random() - 0.5) * 10;
    img.data[i * 4 + 1] = 128 + (Math.random() - 0.5) * 14;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toNormalTexture(c, 6);
}

/** Rubber grain roughness/bump map. */
export function rubberBumpMap(size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (Math.random() - 0.5) * 40;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toNormalTexture(c, 8);
}

/** Radial gradient ground disc (soft dark platform). */
export function groundTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512);
  const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 256);
  g.addColorStop(0, 'rgba(28,28,28,0.95)');
  g.addColorStop(0.55, 'rgba(15,15,15,0.85)');
  g.addColorStop(1, 'rgba(10,10,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Scatter noise used for cabinet micro-normal. */
export function microNoiseNormal(size = 256, strength = 8): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = 128 + (Math.random() - 0.5) * strength;
    img.data[i * 4 + 1] = 128 + (Math.random() - 0.5) * strength;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toNormalTexture(c, 3);
}

let cache: {
  weave?: THREE.CanvasTexture; brushed?: THREE.CanvasTexture; paper?: THREE.CanvasTexture;
  rubber?: THREE.CanvasTexture; micro?: THREE.CanvasTexture;
} = {};

export function getTextures() {
  if (!cache.weave) cache = {
    weave: weaveNormalMap(),
    brushed: brushedNormalMap(),
    paper: paperNormalMap(),
    rubber: rubberBumpMap(),
    micro: microNoiseNormal(),
  };
  return cache;
}

export function disposeTextures(): void {
  Object.values(cache).forEach((t) => t?.dispose());
  cache = {};
}

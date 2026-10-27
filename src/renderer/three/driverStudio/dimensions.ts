/**
 * Driver Studio — measurement guides for the selected component.
 *
 * Draws engineering-style dimension lines around the selected component's
 * world bounding box: a radial diameter callout and an axial depth callout,
 * each with a monochrome text sprite. Pure geometry + canvas sprites,
 * rebuilt only when the selection or units change.
 */
import * as THREE from 'three';

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(8,8,8,0.82)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 62);
  ctx.font = '600 26px "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.09, 0.0225, 1);
  sprite.renderOrder = 20;
  return sprite;
}

export class DimensionGuides {
  readonly group = new THREE.Group();
  private mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

  constructor() {
    this.group.name = 'dimensionGuides';
    this.group.renderOrder = 20;
  }

  /**
   * Show diameter + depth guides for an object (world space).
   * axis: the driver axis — depth is measured along it.
   */
  show(obj: THREE.Object3D, axis: 'x' | 'y' | 'z', labelDiameter: string, labelDepth: string): void {
    this.clear();
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const [r1, r2] = axis === 'z' ? [0, 1] : axis === 'x' ? [1, 2] : [0, 2];

    // diameter line across the radial middle, offset to the front of the part
    const radialSpan = Math.max(size.getComponent(r1), size.getComponent(r2));
    const front = box.max.getComponent(ai);
    const mid1 = center.getComponent(r1);
    const mid2 = center.getComponent(r2);
    const offset = radialSpan * 0.12;

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    pA.setComponent(r1, mid1 - radialSpan / 2);
    pB.setComponent(r1, mid1 + radialSpan / 2);
    pA.setComponent(r2, mid2);
    pB.setComponent(r2, mid2);
    pA.setComponent(ai, front + offset);
    pB.setComponent(ai, front + offset);
    this.dimLine(pA, pB, labelDiameter, radialSpan);

    // depth line along the axis, offset radially outward
    const radialOut = Math.max(size.getComponent(r1), size.getComponent(r2)) / 2;
    const dA = new THREE.Vector3();
    const dB = new THREE.Vector3();
    dA.setComponent(ai, box.min.getComponent(ai));
    dB.setComponent(ai, box.max.getComponent(ai));
    const side = new THREE.Vector3();
    side.setComponent(r2, radialOut + radialSpan * 0.1);
    side.setComponent(r1, mid1);
    dA.add(side);
    dB.add(side);
    this.dimLine(dA, dB, labelDepth, size.getComponent(ai));

    this.group.add(new THREE.Box3Helper(box, new THREE.Color(0x6a6a6a)));
  }

  private dimLine(a: THREE.Vector3, b: THREE.Vector3, label: string, spanM: number): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.normalize();
    const tick = dir.clone().cross(new THREE.Vector3(0, 0, 1));
    if (tick.lengthSq() < 1e-6) tick.set(0, 1, 0);
    tick.normalize().multiplyScalar(Math.min(spanM * 0.06, 0.02));

    const pts: THREE.Vector3[] = [
      a.clone().add(tick), a.clone().sub(tick),
      a, b,
      b.clone().add(tick), b.clone().sub(tick),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const lines = new THREE.LineSegments(geo, this.mat);
    this.group.add(lines);

    const sprite = makeLabelSprite(label);
    sprite.position.copy(a).add(b).multiplyScalar(0.5).add(tick.clone().multiplyScalar(2.4));
    const dist = sprite.position.length();
    sprite.scale.setScalar(Math.max(0.05, dist * 0.085));
    sprite.scale.y = sprite.scale.x * 0.25;
    this.group.add(sprite);
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const any = child as unknown as {
        geometry?: THREE.BufferGeometry; material?: THREE.Material & { map?: THREE.Texture };
      };
      any.geometry?.dispose();
      if (any.material) {
        any.material.map?.dispose();
        any.material.dispose();
      }
    }
  }

  dispose(): void {
    this.clear();
    this.mat.dispose();
  }
}

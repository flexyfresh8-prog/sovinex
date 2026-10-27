/**
 * Sonivex Studio - 3D viewport.
 * PBR + environment lighting + soft shadows + subtle bloom, orbit controls,
 * hover/selection outlines, explode view, shading modes, camera presets,
 * standard views with eased tweens.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { groundTexture } from './textures';

export interface ViewportCallbacks {
  onHover: (partId: string | null) => void;
  onSelect: (partId: string, additive: boolean) => void;
  onEmptyClick: () => void;
}

export type StandardView = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso';

const easeInOutQuint = (t: number): number => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2);

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orthoCamera: THREE.OrthographicCamera;
  activeCamera: THREE.Camera;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;

  private modelRoot: THREE.Group | null = null;
  private pickables: THREE.Mesh[] = [];
  private partObjects = new Map<string, THREE.Object3D>();
  private selected = new Set<string>();
  private hoverId: string | null = null;
  private edgesLayer: THREE.Group;
  private selectionOutlines = new Map<string, THREE.LineSegments>();
  private grid: THREE.Group;
  private ground: THREE.Mesh;
  private shadowGround: THREE.Mesh;
  private explodeFactor = 0;
  private explodeTarget = 0;
  private restTransforms = new Map<THREE.Object3D, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
  private camTween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number; dur: number } | null = null;
  private useOrtho = false;
  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number; time: number } | null = null;
  private autoRotate = false;
  private cb: ViewportCallbacks;
  private disposed = false;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement, cb: ViewportCallbacks) {
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0A0A0A');
    this.scene.fog = new THREE.Fog('#0A0A0A', 6, 18);

    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.02, 60);
    this.camera.position.set(1.9, 1.15, 2.4);
    const frustum = 1.6;
    this.orthoCamera = new THREE.OrthographicCamera(-frustum * aspect, frustum * aspect, frustum, -frustum, 0.02, 60);
    this.orthoCamera.position.copy(this.camera.position);
    this.activeCamera = this.camera;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.55, 0);
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.55;

    // environment
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    pmrem.dispose();

    // lights
    const key = new THREE.DirectionalLight('#FFFFFF', 2.6);
    key.position.set(2.6, 4.2, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2; key.shadow.camera.right = 2;
    key.shadow.camera.top = 2.6; key.shadow.camera.bottom = -1;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 5;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#CCCCCC', 0.55);
    fill.position.set(-3, 1.6, -2.4);
    this.scene.add(fill);

    const rim = new THREE.SpotLight('#FFFFFF', 13, 9, 0.7, 0.55, 1.6);
    rim.position.set(-2.2, 2.4, -2.8);
    this.scene.add(rim);

    const rim2 = new THREE.SpotLight('#A8A8A8', 8, 9, 0.8, 0.6, 1.8);
    rim2.position.set(2.4, 1.2, -3.0);
    this.scene.add(rim2);

    // ground: soft gradient disc + shadow catcher
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: groundTexture(), transparent: true, depthWrite: false }),
    );
    this.ground.position.y = -0.001;
    this.scene.add(this.ground);

    this.shadowGround = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.42 }),
    );
    this.shadowGround.position.y = 0.0005;
    this.shadowGround.receiveShadow = true;
    this.scene.add(this.shadowGround);

    // grid: rings + axes, engineering look
    this.grid = new THREE.Group();
    const gridMat = new THREE.LineBasicMaterial({ color: '#303030', transparent: true, opacity: 0.5 });
    for (let r = 0.5; r <= 2.5; r += 0.5) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      this.grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    const axisMatX = new THREE.LineBasicMaterial({ color: '#6e6e6e', transparent: true, opacity: 0.65 });
    const axisMatZ = new THREE.LineBasicMaterial({ color: '#e0e0e0', transparent: true, opacity: 0.65 });
    this.grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.6, 0, 0), new THREE.Vector3(2.6, 0, 0)]), axisMatX));
    this.grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -2.6), new THREE.Vector3(0, 0, 2.6)]), axisMatZ));
    const vertAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0)]), new THREE.LineBasicMaterial({ color: '#2C2C2C', transparent: true, opacity: 0.5 }));
    this.grid.add(vertAxis);
    this.scene.add(this.grid);

    // edges layer for selection outlines
    this.edgesLayer = new THREE.Group();
    this.scene.add(this.edgesLayer);

    // postprocessing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.28, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // events
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.animate();
  }

  setModel(root: THREE.Group, partObjects: Map<string, THREE.Object3D>, pickables: THREE.Mesh[]): void {
    if (this.modelRoot) this.scene.remove(this.modelRoot);
    this.clearOutlines();
    this.modelRoot = root;
    this.partObjects = partObjects;
    this.pickables = pickables;
    this.scene.add(root);
    this.restTransforms.clear();
    partObjects.forEach((obj) => {
      this.restTransforms.set(obj, { pos: obj.position.clone(), quat: obj.quaternion.clone() });
    });
    this.explodeFactor = 0; this.explodeTarget = 0;
  }

  /** Explode offset vectors from assembly center per part. */
  setExplode(f: number): void {
    this.explodeTarget = THREE.MathUtils.clamp(f, 0, 1);
  }

  fitToModel(): void {
    if (!this.modelRoot) return;
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.9;
    const dir = new THREE.Vector3(0.72, 0.36, 1).normalize();
    this.tweenCamera(center.clone().add(dir.multiplyScalar(dist)), center);
    this.controls.minDistance = maxDim * 0.25;
    this.controls.maxDistance = maxDim * 8;
  }

  tweenCamera(pos: THREE.Vector3, target: THREE.Vector3, dur = 0.85): void {
    this.camTween = {
      from: this.activeCamera.position.clone(), to: pos.clone(),
      tFrom: this.controls.target.clone(), tTo: target.clone(),
      start: performance.now(), dur: dur * 1000,
    };
  }

  setStandardView(view: StandardView): void {
    if (!this.modelRoot) return;
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.55;
    const dirs: Record<StandardView, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0.02, 1), back: new THREE.Vector3(0, 0.02, -1),
      left: new THREE.Vector3(-1, 0.02, 0), right: new THREE.Vector3(1, 0.02, 0),
      top: new THREE.Vector3(0.001, 1, 0.001), iso: new THREE.Vector3(0.72, 0.36, 1),
    };
    const pos = center.clone().add(dirs[view].normalize().multiplyScalar(dist));
    this.tweenCamera(pos, center);
  }

  setProjection(ortho: boolean): void {
    if (ortho === this.useOrtho) return;
    this.useOrtho = ortho;
    const container = this.renderer.domElement.parentElement!;
    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    if (ortho) {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const frustum = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
      this.orthoCamera.left = -frustum * aspect; this.orthoCamera.right = frustum * aspect;
      this.orthoCamera.top = frustum; this.orthoCamera.bottom = -frustum;
      this.orthoCamera.position.copy(this.camera.position);
      this.orthoCamera.updateProjectionMatrix();
      this.activeCamera = this.orthoCamera;
    } else {
      this.activeCamera = this.camera;
    }
    this.controls.object = this.activeCamera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    (this.composer.passes[0] as RenderPass).camera = this.activeCamera;
  }

  setShading(mode: 'shaded' | 'wireframe' | 'ghost'): void {
    this.pickables.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mode === 'wireframe') {
        mat.wireframe = true;
        mat.transparent = false; mat.opacity = 1;
      } else if (mode === 'ghost') {
        mat.wireframe = false;
        mat.transparent = true; mat.opacity = 0.28; mat.depthWrite = false;
      } else {
        mat.wireframe = false;
        if (!(mat as THREE.MeshPhysicalMaterial).userData.keepTransparent) {
          mat.transparent = false; mat.opacity = 1; mat.depthWrite = true;
        }
      }
    });
  }

  setPartVisible(partId: string, visible: boolean): void {
    const obj = this.partObjects.get(partId);
    if (obj) obj.visible = visible;
  }

  setAutoRotate(on: boolean): void { this.autoRotate = on; }
  setGridVisible(on: boolean): void { this.grid.visible = on; this.ground.visible = on; }

  setSelected(ids: string[]): void {
    this.clearOutlines();
    this.selected = new Set(ids);
    ids.forEach((id) => {
      const obj = this.partObjects.get(id);
      if (!obj) return;
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry, 24),
            new THREE.LineBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.95 }),
          );
          edges.raycast = () => { /* no pick */ };
          mesh.add(edges);
          this.selectionOutlines.set(id + ':' + mesh.uuid, edges);
        }
      });
      // emissive pulse base
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive) {
          (mesh.material as THREE.MeshStandardMaterial).emissive.set('#8A8A8A');
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12;
        }
      });
    });
  }

  clearHover(): void {
    if (!this.hoverId) return;
    const obj = this.partObjects.get(this.hoverId);
    if (obj && !this.selected.has(this.hoverId)) {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive) {
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
          (mesh.material as THREE.MeshStandardMaterial).emissive.set('#000000');
        }
      });
    }
    this.hoverId = null;
  }

  private clearOutlines(): void {
    this.selectionOutlines.forEach((edges) => edges.parent?.remove(edges));
    this.selectionOutlines.clear();
    this.partObjects.forEach((obj) => {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive) {
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
          (mesh.material as THREE.MeshStandardMaterial).emissive.set('#000000');
        }
      });
    });
  }

  private pick(ev: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.activeCamera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      if (!h.object.visible) continue;
      let parent: THREE.Object3D | null = h.object;
      while (parent && !parent.userData.partId) parent = parent.parent;
      if (parent?.userData.partId) return parent.userData.partId as string;
    }
    return null;
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.modelRoot) return;
    const id = this.pick(ev);
    if (id !== this.hoverId) {
      this.clearHover();
      if (id && !this.selected.has(id)) {
        const obj = this.partObjects.get(id);
        obj?.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive) {
            (mesh.material as THREE.MeshStandardMaterial).emissive.set('#4A4A4A');
            (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1;
          }
        });
      }
      this.hoverId = id;
      this.cb.onHover(id);
      this.renderer.domElement.style.cursor = id ? 'pointer' : 'default';
    }
  };

  private onPointerDown = (ev: PointerEvent): void => {
    this.pointerDown = { x: ev.clientX, y: ev.clientY, time: performance.now() };
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (!this.pointerDown) return;
    const dx = ev.clientX - this.pointerDown.x;
    const dy = ev.clientY - this.pointerDown.y;
    const dt = performance.now() - this.pointerDown.time;
    this.pointerDown = null;
    if (Math.hypot(dx, dy) < 5 && dt < 400) {
      const id = this.pick(ev);
      if (id) this.cb.onSelect(id, ev.ctrlKey || ev.metaKey || ev.shiftKey);
      else if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) this.cb.onEmptyClick();
    }
  };

  private onResize = (): void => {
    const container = this.renderer.domElement.parentElement;
    if (!container) return;
    const w = container.clientWidth, h = Math.max(container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.useOrtho) {
      const frustum = this.orthoCamera.top;
      this.orthoCamera.left = -frustum * aspect; this.orthoCamera.right = frustum * aspect;
      this.orthoCamera.updateProjectionMatrix();
    }
  };

  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this.camTween) {
      const t = Math.min((performance.now() - this.camTween.start) / this.camTween.dur, 1);
      const e = easeInOutQuint(t);
      this.activeCamera.position.lerpVectors(this.camTween.from, this.camTween.to, e);
      this.controls.target.lerpVectors(this.camTween.tFrom, this.camTween.tTo, e);
      if (t >= 1) this.camTween = null;
    }

    if (this.autoRotate && !this.camTween) {
      const target = this.controls.target;
      const offset = this.activeCamera.position.clone().sub(target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.22);
      this.activeCamera.position.copy(target).add(offset);
    }

    // explode easing
    if (Math.abs(this.explodeTarget - this.explodeFactor) > 1e-4) {
      this.explodeFactor += (this.explodeTarget - this.explodeFactor) * Math.min(dt * 7, 1);
      this.applyExplode();
    }

    this.controls.update();
    this.composer.render();
  };

  private applyExplode(): void {
    if (!this.modelRoot) return;
    const center = new THREE.Box3().setFromObject(this.modelRoot).getCenter(new THREE.Vector3());
    this.partObjects.forEach((obj) => {
      const rest = this.restTransforms.get(obj);
      if (!rest) return;
      const dir = obj.position.clone().sub(center);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      dir.normalize();
      // scale explode strength with part distance for depth
      const strength = this.explodeFactor * 0.42;
      obj.position.copy(rest.pos).add(dir.multiplyScalar(strength));
    });
  }

  /** world-space box of current model */
  modelBox(): THREE.Box3 | null {
    return this.modelRoot ? new THREE.Box3().setFromObject(this.modelRoot) : null;
  }

  dispose(): void {
    this.disposed = true;
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m?.dispose());
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

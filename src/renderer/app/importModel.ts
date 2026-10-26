/**
 * 3D model import pipeline: GLB / GLTF / OBJ / FBX.
 * - preserves every mesh (never merges or deletes geometry)
 * - reads scene hierarchy + mesh names
 * - assigns stable part ids (p0..pN in traversal order)
 * - computes per-part metrics (bbox, size, center, symmetry)
 * - optionally smooths normals + assigns studio PBR materials when the
 *   source material is blank (e.g. Tripo exports with a single empty material)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PartMetrics } from '../../shared/types';
import { getTextures } from '../three/textures';

export interface ImportedPartNode {
  id: string;
  name: string;
  sourceName: string;
  meshIndex: number;
  object: THREE.Object3D;      // direct child of model root (one per mesh)
  mesh: THREE.Mesh;
  metrics: PartMetrics;
  hadRealMaterial: boolean;
}

export interface ImportResult {
  root: THREE.Group;
  parts: ImportedPartNode[];
  format: 'glb' | 'gltf' | 'obj' | 'fbx';
}

function computeMetrics(mesh: THREE.Mesh, worldMatrix: THREE.Matrix4): PartMetrics {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const vertexCount = pos ? pos.count : 0;
  const triCount = geo.index ? geo.index.count / 3 : (pos ? pos.count / 3 : 0);

  mesh.geometry.computeBoundingBox();
  const localBox = mesh.geometry.boundingBox!.clone();
  const box = localBox.clone().applyMatrix4(worldMatrix);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const radiusMaxM = size.length() / 2;

  // symmetry analysis: radius distribution around each axis through centroid
  const sampleN = Math.min(1500, vertexCount);
  const step = Math.max(1, Math.floor(vertexCount / sampleN));
  const v = new THREE.Vector3();
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  let bestAxis: 'x' | 'y' | 'z' = 'z';
  let bestCV = 99, bestRMin = 0, bestRMax = 1;
  for (const axis of axes) {
    const radii: number[] = [];
    const others = axes.filter((a) => a !== axis) as ('x' | 'y' | 'z')[];
    for (let i = 0; i < vertexCount; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(worldMatrix);
      const r = Math.hypot(v[others[0]] - center[others[0]], v[others[1]] - center[others[1]]);
      radii.push(r);
    }
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
    if (mean < 1e-6) continue;
    const sd = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length);
    const cv = sd / mean;
    const rMin = Math.min(...radii), rMax = Math.max(...radii);
    if (cv < bestCV) { bestCV = cv; bestAxis = axis; bestRMin = rMin; bestRMax = rMax; }
  }

  return {
    vertexCount, triangleCount: Math.round(triCount),
    sizeM: [size.x, size.y, size.z], centerM: [center.x, center.y, center.z],
    radiusMaxM, symmetryAxis: bestAxis, symmetryCV: bestCV,
    rMinOverRMax: bestRMax > 1e-9 ? bestRMin / bestRMax : 0,
  };
}

function isBlankMaterial(mat: THREE.Material | undefined): boolean {
  if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return true;
  const m = mat as THREE.MeshStandardMaterial;
  const noMaps = !m.map && !m.normalMap && !m.roughnessMap && !m.metalnessMap && !m.emissiveMap;
  const whiteDefault = !m.map && m.color.getHex() === 0xffffff;
  return noMaps && whiteDefault && m.roughness >= 0.95 && m.metalness <= 0.05;
}

/** Studio PBR material per role-derived look. */
export function studioMaterialFor(partName: string, index: number): THREE.MeshPhysicalMaterial {
  const tex = getTextures();
  const lower = partName.toLowerCase();
  if (lower.includes('cone')) {
    return new THREE.MeshPhysicalMaterial({
      color: '#15181d', roughness: 0.62, metalness: 0.08,
      normalMap: tex.weave!, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.85,
      sheen: 0.25, sheenColor: new THREE.Color('#2a3038'),
    });
  }
  if (lower.includes('surround') || lower.includes('ring')) {
    return new THREE.MeshPhysicalMaterial({
      color: '#141619', roughness: 0.88, metalness: 0,
      normalMap: tex.rubber!, normalScale: new THREE.Vector2(0.4, 0.4),
    });
  }
  if (lower.includes('cap') || lower.includes('dome')) {
    return new THREE.MeshPhysicalMaterial({
      color: '#1a1e25', roughness: 0.16, metalness: 0.25,
      clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3,
    });
  }
  if (lower.includes('enclosure') || lower.includes('cabinet')) {
    return new THREE.MeshPhysicalMaterial({
      color: '#0e1116', roughness: 0.4, metalness: 0.12,
      clearcoat: 0.8, clearcoatRoughness: 0.24,
      normalMap: tex.micro!, normalScale: new THREE.Vector2(0.2, 0.2),
    });
  }
  if (lower.includes('magnet') || lower.includes('motor') || lower.includes('basket')) {
    return new THREE.MeshPhysicalMaterial({
      color: '#3b4048', roughness: 0.35, metalness: 0.9,
      normalMap: tex.brushed!, normalScale: new THREE.Vector2(0.35, 0.35),
    });
  }
  if (index % 3 === 0) {
    return new THREE.MeshPhysicalMaterial({
      color: '#101318', roughness: 0.5, metalness: 0.4,
      normalMap: tex.micro!, normalScale: new THREE.Vector2(0.25, 0.25),
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: '#2a2f37', roughness: 0.45, metalness: 0.55,
    normalMap: tex.brushed!, normalScale: new THREE.Vector2(0.25, 0.25),
  });
}

/** Smooth normals: weld close vertices then recompute. Returns processed geometry. */
function smoothGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  try {
    const welded = BufferGeometryUtils.mergeVertices(geo, 1e-4);
    welded.computeVertexNormals();
    return welded;
  } catch {
    geo.computeVertexNormals();
    return geo;
  }
}

export async function parseModel(
  fileName: string, data: Uint8Array,
  opts: { smooth: boolean; studioMaterials: boolean },
  onProgress?: (pct: number, stage: string) => void,
): Promise<ImportResult> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const arrayBuffer = data.slice().buffer;
  onProgress?.(10, 'Parsing geometry');

  let scene: THREE.Object3D;
  let format: ImportResult['format'];
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    try {
      const draco = new DRACOLoader();
      // bundled locally by the build (copied from three/examples/jsm/libs/draco/gltf)
      draco.setDecoderPath('draco/');
      loader.setDRACOLoader(draco);
    } catch { /* draco optional */ }
    const gltf = await loader.parseAsync(arrayBuffer, '');
    scene = gltf.scene;
    format = ext as 'glb' | 'gltf';
  } else if (ext === 'obj') {
    scene = new OBJLoader().parse(new TextDecoder().decode(data));
    format = 'obj';
  } else if (ext === 'fbx') {
    const loader = new FBXLoader();
    scene = loader.parse(arrayBuffer, '');
    format = 'fbx';
  } else {
    throw new Error(`Unsupported model format: .${ext}`);
  }
  onProgress?.(45, 'Collecting meshes');

  // collect every mesh in traversal order
  const meshes: THREE.Mesh[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  if (meshes.length === 0) throw new Error('No meshes found in model file');

  const root = new THREE.Group();
  root.name = 'ImportedModel';

  // normalize: center on origin, ground at y=0
  const sceneBox = new THREE.Box3().setFromObject(scene);
  const sceneCenter = sceneBox.getCenter(new THREE.Vector3());
  const rootOffset = new THREE.Vector3(-sceneCenter.x, -sceneBox.min.y, -sceneCenter.z);

  const parts: ImportedPartNode[] = [];
  for (let i = 0; i < meshes.length; i++) {
    const srcMesh = meshes[i];
    onProgress?.(45 + Math.round((i / meshes.length) * 40), `Processing part ${i + 1}/${meshes.length}`);

    // clone geometry (process a copy; original file untouched by definition)
    let geo = srcMesh.geometry.clone();
    if (opts.smooth) geo = smoothGeometry(geo);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();

    const hadRealMaterial = !isBlankMaterial(srcMesh.material as THREE.Material);
    const material = hadRealMaterial && !opts.studioMaterials
      ? (srcMesh.material as THREE.Material).clone()
      : studioMaterialFor(srcMesh.name || `Part ${i + 1}`, i);

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = srcMesh.name || `part_${i}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const wrapper = new THREE.Group();
    wrapper.name = mesh.name;
    wrapper.userData.partId = `p${i}`;
    mesh.userData.partId = `p${i}`;
    wrapper.add(mesh);

    // preserve original world transform of the source mesh relative to scene
    srcMesh.updateWorldMatrix(true, false);
    const world = srcMesh.matrixWorld.clone();
    const rel = world.clone().multiply(new THREE.Matrix4().makeTranslation(-0, -0, 0));
    // position wrapper so mesh lands at original world location (offset by root normalization)
    const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
    rel.decompose(pos, quat, scl);
    pos.add(rootOffset);
    wrapper.position.copy(pos);
    wrapper.quaternion.copy(quat);
    wrapper.scale.copy(scl);
    // mesh at local origin of wrapper
    mesh.position.set(0, 0, 0);

    const metrics = computeMetrics(mesh, wrapper.matrix.clone());
    parts.push({
      id: `p${i}`,
      name: srcMesh.name || `Part ${i + 1}`,
      sourceName: srcMesh.name || `mesh_${i}`,
      meshIndex: i,
      object: wrapper, mesh, metrics, hadRealMaterial,
    });
    root.add(wrapper);
  }
  onProgress?.(92, 'Analyzing geometry');
  root.updateMatrixWorld(true);
  onProgress?.(100, 'Import complete');
  return { root, parts, format };
}

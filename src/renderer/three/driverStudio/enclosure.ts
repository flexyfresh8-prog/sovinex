/**
 * Driver Studio — enclosure for the "Complete System" view mode.
 *
 * Built in the driver's local frame: the driver flange plane is z = 0 and the
 * baffle face sits at z = +baffleT, so the driver drops straight into the
 * cutout at any size. In Driver Only mode the whole group is removed from
 * rendering — not made transparent — so nothing obstructs the driver.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getTextures } from '../textures';
import { monochrome } from './config';

export interface EnclosureBuild {
  group: THREE.Group;
  /** world y offset that puts the cabinet bottom on the ground (y=0) */
  groundOffsetY: number;
}

export function buildEnclosure(
  wCM: number, hCM: number, dCM: number, ported: boolean,
  portDiameterCM: number, portCount: number, driverFlangeR: number,
): EnclosureBuild {
  const g = new THREE.Group();
  g.name = 'EnclosureSystem';
  const tex = getTextures();
  const W = wCM / 100, H = hCM / 100, D = dCM / 100;
  const wall = 0.019;
  const baffleT = 0.024;

  const vinylMat = new THREE.MeshPhysicalMaterial({
    color: monochrome('#111214'), roughness: 0.38, metalness: 0.06,
    clearcoat: 0.7, clearcoatRoughness: 0.24,
    normalMap: tex.micro, normalScale: new THREE.Vector2(0.16, 0.16),
    envMapIntensity: 0.85,
  });
  const baffleMat = new THREE.MeshPhysicalMaterial({
    color: monochrome('#0c0d0f'), roughness: 0.3, metalness: 0.1,
    clearcoat: 0.9, clearcoatRoughness: 0.16, envMapIntensity: 1.0,
  });
  const cavity = new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 0.96, side: THREE.BackSide });

  // cabinet — driver axis sits at 55% of the cabinet height from the bottom
  const yc = -(0.55 * H - H / 2);              // local center y of the cabinet
  const cab = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.014), vinylMat);
  cab.name = 'enclosure_cabinet';
  cab.position.set(0, yc, baffleT - D / 2);
  cab.castShadow = true;
  cab.receiveShadow = true;
  g.add(cab);

  // baffle plate with a recessed driver cutout ring
  const baffle = new THREE.Mesh(new RoundedBoxGeometry(W * 0.965, H * 0.965, baffleT, 3, 0.008), baffleMat);
  baffle.name = 'enclosure_baffle';
  baffle.position.set(0, yc, baffleT / 2);
  baffle.castShadow = true;
  baffle.receiveShadow = true;
  g.add(baffle);

  const cutR = Math.max(driverFlangeR * 0.86, driverFlangeR - 0.012);
  const cut = new THREE.Mesh(
    new THREE.CylinderGeometry(cutR, cutR, baffleT + 0.002, 96, 1, false).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.9 }),
  );
  cut.name = 'enclosure_cutout';
  cut.position.set(0, 0, baffleT / 2);
  g.add(cut);

  const recess = new THREE.Mesh(
    new THREE.CylinderGeometry(cutR + 0.008, cutR + 0.008, 0.004, 96, 1, false).rotateX(Math.PI / 2),
    baffleMat,
  );
  recess.name = 'enclosure_recess';
  recess.position.set(0, 0, baffleT - 0.001);
  g.add(recess);

  // internal dark liner (visible through ports)
  const liner = new THREE.Mesh(
    new THREE.BoxGeometry(W - wall * 2, H - wall * 2, D - wall * 2),
    cavity,
  );
  liner.name = 'enclosure_liner';
  liner.position.set(0, yc, baffleT - D / 2);
  g.add(liner);

  // ports — front-mounted, flared
  if (ported) {
    const pr = Math.max(0.02, portDiameterCM / 200);
    for (let i = 0; i < Math.max(1, portCount); i++) {
      const px = ((i % 2 === 0 ? -1 : 1) * (0.22 + Math.floor(i / 2) * 0.16)) * W;
      const pz = baffleT;
      const py = yc - H * 0.3;
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(pr, pr, 0.05, 48, 1, true).rotateX(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.7, side: THREE.DoubleSide }),
      );
      tube.name = `enclosure_port_${i}`;
      tube.position.set(px, py, pz - 0.025);
      g.add(tube);
      const flare = new THREE.Mesh(
        new THREE.TorusGeometry(pr + 0.002, 0.004, 12, 48),
        vinylMat,
      );
      flare.name = `enclosure_port_flare_${i}`;
      flare.position.set(px, py, pz + 0.001);
      g.add(flare);
    }
  }

  // terminal cup on the rear panel
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.023, 0.012, 32).rotateX(Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0x0d0d0d, roughness: 0.4, metalness: 0.3 }),
  );
  cup.name = 'enclosure_terminal_cup';
  cup.position.set(0, yc, baffleT - D - 0.002);
  g.add(cup);

  // feet
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.02, 0.018, 24),
        new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.85 }),
      );
      foot.name = 'enclosure_foot';
      foot.position.set(sx * W * 0.36, yc - H / 2 - 0.009, baffleT - D / 2 + sz * D * 0.36);
      foot.castShadow = true;
      g.add(foot);
    }
  }

  const groundOffsetY = H * 0.55 + 0.018;
  return { group: g, groundOffsetY };
}

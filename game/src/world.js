// Builds the Foundry District's three.js scene from the map data: ground,
// colliders as styled boxes, the smelter line, depot containers, site paint,
// lamps and a dusk sky. Pure presentation: every solid mesh stands exactly on
// its collider from map.js, so the picture and the physics never disagree.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { COLLIDERS, SITES } from './map.js';

const KIND_STYLE = {
  wall: { color: PALETTE.wallDark, rough: 0.9 },
  block: { color: PALETTE.wall, rough: 0.85 },
  crate: { color: PALETTE.crate, rough: 0.95 },
  stack: { color: PALETTE.crateDark, rough: 0.95 },
  machine: { color: 0x5a4a42, rough: 0.6, metal: 0.6 },
  container: { color: PALETTE.containerTeal, rough: 0.7, metal: 0.35 },
};

export function createWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);

  const hemi = new THREE.HemisphereLight(0xbdd0e4, 0x4a4038, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9b0, 1.8);
  sun.position.set(-28, 34, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // Ground: one slab, plus a darker stained apron under the smelter.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 48),
    new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 15),
    new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(23.5, 0.01, -15);
  apron.receiveShadow = true;
  scene.add(apron);

  // Yard markings: lane centre lines and the mid stripe, painted thin planes.
  const paintMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c4, transparent: true, opacity: 0.28 });
  for (const [w, d, x, z] of [[56, 0.18, 0, -18.4], [56, 0.18, 0, 18.4], [56, 0.18, 0, 0]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paintMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.02, z);
    scene.add(line);
  }

  // Every collider becomes one box mesh in its kind's material. Container
  // boxes alternate teal and rust so the depot reads as stacked freight.
  const geoCache = new Map();
  const matCache = new Map();
  let containerFlip = false;
  for (const c of COLLIDERS) {
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    const key = `${w}x${c.h}x${d}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, c.h, d));
    let style = KIND_STYLE[c.kind];
    let matKey = c.kind;
    if (c.kind === 'container') {
      containerFlip = !containerFlip;
      style = { ...style, color: containerFlip ? PALETTE.containerTeal : PALETTE.containerRust };
      matKey = containerFlip ? 'containerA' : 'containerB';
    }
    if (!matCache.has(matKey)) {
      matCache.set(matKey, new THREE.MeshStandardMaterial({
        color: style.color, roughness: style.rough, metalness: style.metal ?? 0.05,
      }));
    }
    const mesh = new THREE.Mesh(geoCache.get(key), matCache.get(matKey));
    mesh.position.set((c.minX + c.maxX) / 2, c.h / 2, (c.minZ + c.maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // A lighter cap strip on crates and containers sells the low-poly look.
    if (c.kind === 'crate' || c.kind === 'stack' || c.kind === 'container') {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.96, 0.07, d * 0.96),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, transparent: true, opacity: 0.18 }),
      );
      cap.position.set(mesh.position.x, c.h + 0.035, mesh.position.z);
      scene.add(cap);
    }
  }

  // Smelter dressing: three chimney stacks with ember-lit rims, and a furnace
  // mouth that glows on site A. Pure decoration above the machine colliders.
  const stackMat = new THREE.MeshStandardMaterial({ color: 0x6e5a4e, roughness: 0.55, metalness: 0.6 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, emissive: PALETTE.furnace, emissiveIntensity: 1.6 });
  for (const x of [20, 23.6, 27.2]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 4.6, 10), stackMat);
    stack.position.set(x, 5.2 + 2.3, -19.2);
    stack.castShadow = true;
    scene.add(stack);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.87, 0.87, 0.3, 10), rimMat);
    rim.position.set(x, 9.65, -19.2);
    scene.add(rim);
  }
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.7, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x140b06, emissive: PALETTE.furnace, emissiveIntensity: 2.6 }),
  );
  mouth.position.set(28.5, 1.15, -14);
  mouth.rotation.y = -Math.PI / 2;
  scene.add(mouth);
  const furnaceLight = new THREE.PointLight(PALETTE.furnace, 30, 16, 1.8);
  furnaceLight.position.set(27.6, 1.6, -14);
  scene.add(furnaceLight);

  // Site paint: a bright outline ring and letter on each site's floor.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const color = key === 'A' ? PALETTE.siteA : PALETTE.siteB;
    const w = s.maxX - s.minX, d = s.maxZ - s.minZ;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.56, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(5.2);
    ring.position.set(s.plantX, 0.03, s.plantZ);
    scene.add(ring);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide }),
    );
    frame.rotation.x = -Math.PI / 2;
    frame.position.set((s.minX + s.maxX) / 2, 0.025, (s.minZ + s.maxZ) / 2);
    scene.add(frame);
  }

  // Yard lamps: poles with warm heads, two real point lights kept cheap.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.6, metalness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: PALETTE.lamp, emissiveIntensity: 2.2 });
  const lampSpots = [[-16, -16], [8, -18], [-16, 16], [8, 18], [-4.6, -4.4]];
  lampSpots.forEach(([x, z], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), poleMat);
    pole.position.set(x, 2.7, z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), headMat);
    head.position.set(x, 5.45, z);
    scene.add(head);
    if (i % 2 === 0) {
      const light = new THREE.PointLight(PALETTE.lamp, 16, 15, 1.9);
      light.position.set(x, 5.3, z);
      scene.add(light);
    }
  });

  return { sun, furnaceLight };
}

// A low-poly soldier figure for a bot: boots, legs, torso in team colour, a
// head with a visor band, and a held rifle. Built once per bot and posed by
// the bot brain (lean, crouch squash, death fall). Returns the group plus the
// parts the pose code moves.
export function buildSoldier(team) {
  const color = team === 'ember' ? PALETTE.ember : PALETTE.warden;
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.9 });
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  torso.position.y = 1.06;
  torso.castShadow = true;
  group.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.36), dark);
  vest.position.y = 1.08;
  group.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.09, 0.31),
    new THREE.MeshStandardMaterial({ color: 0x10151a, roughness: 0.25, metalness: 0.6 }));
  visor.position.y = 1.58;
  group.add(visor);
  const legGeo = new THREE.BoxGeometry(0.19, 0.78, 0.22);
  const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.14, 0.39, 0);
  const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.14, 0.39, 0);
  group.add(legL, legR);
  const armGeo = new THREE.BoxGeometry(0.13, 0.55, 0.15);
  const armL = new THREE.Mesh(armGeo, suit); armL.position.set(-0.34, 1.12, 0.08); armL.rotation.x = -0.9;
  const armR = new THREE.Mesh(armGeo, suit); armR.position.set(0.34, 1.12, 0.08); armR.rotation.x = -0.9;
  group.add(armL, armR);
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.78),
    new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.45, metalness: 0.55 }));
  gunBody.position.z = 0.1;
  gun.add(gunBody);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.6 }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.6);
  gun.add(barrel);
  gun.position.set(0.18, 1.22, 0.28);
  group.add(gun);
  return { group, torso, head, legL, legR, gun };
}

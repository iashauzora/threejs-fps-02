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
  barrel: { color: 0x74513a, rough: 0.55, metal: 0.5 },
  pipe: { color: 0x3d454e, rough: 0.45, metal: 0.65 },
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
    // Barrels and pipes get their round profile on top of the honest box:
    // drums clustered inside the footprint, a pipe barrel along the run.
    if (c.kind === 'barrel') {
      const drumGeo = new THREE.CylinderGeometry(0.21, 0.21, c.h, 9);
      const drumMat = matCache.get(matKey);
      for (const [ox, oz] of [[-0.2, -0.18], [0.22, 0.05], [-0.02, 0.24]]) {
        const drum = new THREE.Mesh(drumGeo, drumMat);
        drum.position.set(mesh.position.x + ox, c.h / 2 + 0.06, mesh.position.z + oz);
        drum.castShadow = true;
        scene.add(drum);
      }
      mesh.visible = false; // the drums alone read better; collision is unchanged
    }
    if (c.kind === 'pipe') {
      const len = Math.max(w, d);
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, len, 10),
        matCache.get(matKey),
      );
      tube.rotation.z = Math.PI / 2;
      if (d > w) tube.rotation.set(Math.PI / 2, 0, 0);
      tube.position.set(mesh.position.x, c.h + 0.1, mesh.position.z);
      tube.castShadow = true;
      scene.add(tube);
    }
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
  const lampSpots = [[-16, -16], [8, -18], [-16, 16], [8, 18], [-4.6, -4.4], [14.5, -4.4], [14.5, 4.4]];
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
  // One accent light over the depot so site B reads teal against A's ember.
  const depotLight = new THREE.PointLight(PALETTE.wardenSoft, 14, 14, 1.9);
  depotLight.position.set(24, 3.2, 14);
  scene.add(depotLight);

  // --- v2 dressing: panels, signage, decals, skyline -----------------------
  // Building panels: a coloured stripe and a lighter cap on every separator
  // building, alternating palette tints, so the long walls stop reading as
  // one flat grey. Pure decoration pinned to the collider faces.
  const stripeTints = [0x7a8894, 0x8a6f4d, 0x5f7a72, 0x946b54];
  let stripeIdx = 0;
  for (const c of COLLIDERS) {
    if (c.kind !== 'block') continue;
    const tint = stripeTints[stripeIdx++ % stripeTints.length];
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(c.maxX - c.minX - 0.6, 0.5, 0.06),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7, metalness: 0.3 }),
    );
    stripe.position.set((c.minX + c.maxX) / 2, c.h - 0.55, c.minZ - 0.04);
    scene.add(stripe);
    const stripeS = stripe.clone();
    stripeS.position.z = c.maxZ + 0.04;
    scene.add(stripeS);
  }

  // Site signage: a letter board on posts at each site's west entrance,
  // painted on a canvas (letter + name in the site's colour). Boards face
  // the attacking approach, so they read in play and in screenshots.
  function signTexture(letter, name, colorCss) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#20262e'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = colorCss; g.lineWidth = 10; g.strokeRect(10, 10, 236, 236);
    g.fillStyle = colorCss;
    g.font = 'bold 150px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(letter, 128, 168);
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillText(name, 128, 224);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }
  const postMat = new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.6, metalness: 0.5 });
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const colorCss = key === 'A' ? '#ff8c3a' : '#53c7bd';
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 2.3),
      new THREE.MeshStandardMaterial({ map: signTexture(key, s.name.toUpperCase(), colorCss), roughness: 0.8 }),
    );
    board.position.set(s.minX - 0.7, 2.15, s.plantZ);
    board.rotation.y = -Math.PI / 2;
    scene.add(board);
    for (const dz of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6), postMat);
      post.position.set(s.minX - 0.62, 1.05, s.plantZ + dz);
      scene.add(post);
    }
    // Approach chevrons painted toward the plant spot.
    for (let i = 0; i < 3; i++) {
      const chev = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.5),
        new THREE.MeshBasicMaterial({ color: key === 'A' ? PALETTE.siteA : PALETTE.siteB, transparent: true, opacity: 0.32 }),
      );
      chev.rotation.x = -Math.PI / 2;
      chev.rotation.z = Math.PI / 2;
      chev.position.set(s.minX - 2.2 - i * 1.7, 0.02, s.plantZ);
      scene.add(chev);
    }
  }

  // Skyline silhouettes beyond the walls: dead stacks, a gantry crane and
  // storage tanks in fog-dark steel. Outside the play space, visual only —
  // they give the dusk something to end on in every screenshot.
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x39424d, roughness: 0.9 });
  const skyGlow = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, emissive: PALETTE.furnace, emissiveIntensity: 1.1 });
  for (const [x, z, h, r] of [[-42, -12, 17, 1.6], [-39, 10, 13, 1.3], [43, -18, 19, 1.8], [41, 16, 14, 1.4], [-8, -40, 16, 1.5], [18, 39, 15, 1.5]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.25, h, 10), skyMat);
    stack.position.set(x, h / 2, z);
    scene.add(stack);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.4, 10), skyGlow);
    rim.position.set(x, h + 0.2, z);
    scene.add(rim);
  }
  for (const [x, z, w, h] of [[-44, 20, 7, 6], [45, -6, 8, 7], [6, -42, 9, 6], [-20, 41, 8, 7]]) {
    const tank = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyMat);
    tank.position.set(x, h / 2, z);
    scene.add(tank);
  }
  // Gantry crane straddling the north wall: two legs and a beam, mid-frame
  // in any shot looking north across mid.
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0x46505b, roughness: 0.7, metalness: 0.4 });
  for (const gx of [-6, 10]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 11, 0.7), gantryMat);
    leg.position.set(gx, 5.5, -27.5);
    scene.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(19, 0.8, 0.9), gantryMat);
  beam.position.set(2, 10.6, -27.5);
  scene.add(beam);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x2c333c, emissive: PALETTE.lamp, emissiveIntensity: 0.7 }));
  cab.position.set(4, 9.6, -27.5);
  scene.add(cab);

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

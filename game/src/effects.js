// Transient visuals, all pooled: tracers, muzzle flashes, impact sparks,
// hit puffs, a flash pop and the charge's explosion. Nothing allocates in
// the hot loop — fixed meshes and one shared Points cloud cycle through.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 240;

export function createEffects(scene) {
 // Tracers: thin stretched boxes with an additive material read as light.
 const tracerMat = new THREE.MeshBasicMaterial({
  color: PALETTE.tracer, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
 });
 const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
 const tracers = [];
 for (let i = 0; i < MAX_TRACERS; i++) {
  const mesh = new THREE.Mesh(tracerGeo, tracerMat);
  mesh.visible = false;
  scene.add(mesh);
  tracers.push({ mesh, life: 0 });
 }
 let tracerIdx = 0;

 // Muzzle flash: one shared additive plane with a radial star texture
 // (canvas gradient: hot core, spiked falloff) + one shared point light.
 const flashCanvas = document.createElement('canvas');
 flashCanvas.width = flashCanvas.height = 128;
 const fx = flashCanvas.getContext('2d');
 const grad = fx.createRadialGradient(64, 64, 2, 64, 64, 62);
 grad.addColorStop(0, 'rgba(255,240,200,1)');
 grad.addColorStop(0.25, 'rgba(255,190,90,0.85)');
 grad.addColorStop(0.6, 'rgba(255,120,40,0.28)');
 grad.addColorStop(1, 'rgba(255,90,20,0)');
 fx.fillStyle = grad;
 fx.fillRect(0, 0, 128, 128);
 fx.globalCompositeOperation = 'destination-out';
 for (const [x, y, w, h] of [[0, 0, 40, 40], [88, 0, 40, 40], [0, 88, 40, 40], [88, 88, 40, 40]]) {
  fx.fillRect(x, y, w, h); // bite the corners away: a four-point star
 }
 const flashMat = new THREE.MeshBasicMaterial({
  map: new THREE.CanvasTexture(flashCanvas), color: PALETTE.muzzle, transparent: true, opacity: 0.95,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
 });
 const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
 flash.visible = false;
 scene.add(flash);
 const flashLight = new THREE.PointLight(PALETTE.muzzle, 0, 9, 2);
 scene.add(flashLight);
 let flashLife = 0;

 // Particles: one Points cloud for sparks, hit puffs and explosion debris.
 const pGeo = new THREE.BufferGeometry();
 const pPos = new Float32Array(MAX_PARTICLES * 3);
 const pVel = new Float32Array(MAX_PARTICLES * 3);
 const pLife = new Float32Array(MAX_PARTICLES);
 const pMax = new Float32Array(MAX_PARTICLES);
 pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
 const pMat = new THREE.PointsMaterial({
  color: 0xffc98a, size: 0.09, transparent: true, opacity: 0.95,
  blending: THREE.AdditiveBlending, depthWrite: false,
 });
 const points = new THREE.Points(pGeo, pMat);
 points.frustumCulled = false;
 scene.add(points);
 let pIdx = 0;
 for (let i = 0; i < MAX_PARTICLES; i++) { pPos[i * 3 + 1] = -10; }

 // Explosion fireball: a sphere that swells and fades, plus its light.
 const ball = new THREE.Mesh(
  new THREE.SphereGeometry(1, 14, 10),
  new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
 );
 ball.visible = false;
 scene.add(ball);
 const ballLight = new THREE.PointLight(0xff7a26, 0, 26, 1.6);
 scene.add(ballLight);
 let ballLife = 0;

 const _mid = new THREE.Vector3();
 const _dir = new THREE.Vector3();

 // Impact flash: a small additive sprite pool that pops at a hit point
 // and dies in a tenth of a second, over the spark particles.
 const pops = [];
 for (let i = 0; i < 5; i++) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
   map: flash.material.map, color: 0xffd9a0, transparent: true, opacity: 0,
   blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  spr.visible = false;
  spr.scale.setScalar(0.42);
  scene.add(spr);
  pops.push({ spr, life: 0 });
 }
 let popIdx = 0;

 // Floating damage numbers: a sprite pool, each sprite's canvas redrawn
 // only when a number spawns. Rise and fade run on the effects clock;
 // the sideways jitter is hashed from the spawn counter, so the same
 // fight floats the same numbers everywhere. Kinds: 'hit' white, 'head'
 // ember and larger, 'kill' red with a ✕ — the kill confirmation.
 const DMG_N = 14;
 const dmgPool = [];
 for (let i = 0; i < DMG_N; i++) {
  const cv = document.createElement('canvas');
  cv.width = 192; cv.height = 96;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
   map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, depthWrite: false,
  }));
  spr.visible = false;
  spr.scale.set(1.35, 0.675, 1);
  scene.add(spr);
  dmgPool.push({ spr, cv, life: 0, max: 0.85, x: 0, y: 0, z: 0 });
 }
 let dmgIdx = 0;
 let dmgSpawned = 0;
 const dmgHash = (n) => { const s = Math.sin(n * 17.31) * 31337.7; return s - Math.floor(s); };

 function spawnParticles(origin, count, speed, spread, up, life) {
  for (let n = 0; n < count; n++) {
   const i = pIdx; pIdx = (pIdx + 1) % MAX_PARTICLES;
   pPos[i * 3] = origin.x; pPos[i * 3 + 1] = origin.y; pPos[i * 3 + 2] = origin.z;
   pVel[i * 3] = (Math.random() - 0.5) * 2 * spread * speed;
   pVel[i * 3 + 1] = Math.random() * up * speed;
   pVel[i * 3 + 2] = (Math.random() - 0.5) * 2 * spread * speed;
   pLife[i] = pMax[i] = life * (0.6 + Math.random() * 0.7);
  }
 }

 return {
  tracer(from, to) {
   const slot = tracers[tracerIdx]; tracerIdx = (tracerIdx + 1) % MAX_TRACERS;
   _mid.addVectors(from, to).multiplyScalar(0.5);
   _dir.subVectors(to, from);
   const len = _dir.length();
   if (len < 0.5) return;
   slot.mesh.position.copy(_mid);
   slot.mesh.scale.set(1, 1, len);
   slot.mesh.lookAt(to);
   slot.mesh.visible = true;
   slot.life = 0.045;
  },
  muzzleFlash(pos, dir) {
   flash.position.copy(pos).addScaledVector(dir, 0.12);
   flash.lookAt(_mid.copy(pos).add(dir));
   flash.rotation.z = Math.random() * Math.PI;
   flash.visible = true;
   flash.scale.setScalar(0.85 + Math.random() * 0.4);
   flashLife = 0.04;
   flashLight.position.copy(flash.position);
   flashLight.intensity = 3;
  },
  impact(point, wasActor) {
   spawnParticles(point, wasActor ? 7 : 5, wasActor ? 1.6 : 2.2, 0.5, 0.7, 0.3);
   const pop = pops[popIdx]; popIdx = (popIdx + 1) % pops.length;
   pop.spr.position.copy(point);
   pop.spr.visible = true;
   pop.life = 0.09;
  },
  // Float a damage number at a world point (see the pool above).
  damageNumber(point, amount, kind) {
   const d = dmgPool[dmgIdx]; dmgIdx = (dmgIdx + 1) % DMG_N;
   dmgSpawned++;
   const g = d.cv.getContext('2d');
   g.clearRect(0, 0, 192, 96);
   g.font = `800 ${kind === 'hit' ? 46 : 56}px system-ui, sans-serif`;
   g.textAlign = 'center';
   g.lineWidth = 7;
   g.strokeStyle = 'rgba(10,8,6,0.85)';
   const label = kind === 'kill' ? `✕ ${amount}` : `${amount}`;
   g.strokeText(label, 96, 62);
   g.fillStyle = kind === 'kill' ? '#ff5040' : kind === 'head' ? '#ffb37a' : '#f2ede4';
   g.fillText(label, 96, 62);
   d.spr.material.map.needsUpdate = true;
   d.x = point.x + (dmgHash(dmgSpawned * 2) - 0.5) * 0.34;
   d.y = point.y + 0.12;
   d.z = point.z + (dmgHash(dmgSpawned * 2 + 1) - 0.5) * 0.34;
   d.life = d.max;
   d.spr.visible = true;
   d.spr.material.opacity = 1;
  },
  deathPuff(point) {
   spawnParticles(point, 16, 1.8, 0.7, 0.9, 0.5);
  },
  explosion(pos) {
   ball.position.copy(pos).setY(pos.y + 0.6);
   ball.visible = true;
   ballLife = 0.55;
   ballLight.position.copy(ball.position);
   spawnParticles(ball.position, 60, 6.5, 1, 0.8, 0.8);
  },
  flashPop(pos) {
   ball.position.copy(pos).setY(pos.y + 0.3);
   ball.visible = true;
   ballLife = 0.22;
   ballLight.position.copy(ball.position);
   ballLight.color.set(0xffffff);
   spawnParticles(ball.position, 18, 3, 1, 0.6, 0.3);
  },
  update(dt) {
   for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.visible = false; }
   }
   if (flashLife > 0) {
    flashLife -= dt;
    if (flashLife <= 0) { flash.visible = false; flashLight.intensity = 0; }
   }
   if (ballLife > 0) {
    ballLife -= dt;
    const k = Math.max(0, ballLife / 0.55);
    const s = 1 + (1 - k) * 5.2;
    ball.scale.setScalar(s);
    ball.material.opacity = k * 0.85;
    ballLight.intensity = k * 60;
    if (ballLife <= 0) { ball.visible = false; ballLight.intensity = 0; ballLight.color.set(0xff7a26); }
   }
   for (const p of pops) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.spr.material.opacity = Math.max(0, p.life / 0.09) * 0.9;
    if (p.life <= 0) p.spr.visible = false;
   }
   for (const d of dmgPool) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.spr.visible = false; continue; }
    const k = 1 - d.life / d.max; // 0 at spawn, 1 at death
    d.spr.position.set(d.x, d.y + k * 1.05, d.z);
    d.spr.material.opacity = Math.min(1, d.life / 0.28);
   }
   let any = false;
   for (let i = 0; i < MAX_PARTICLES; i++) {
    if (pLife[i] <= 0) continue;
    any = true;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -10; continue; }
    pVel[i * 3 + 1] -= 5.5 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pPos[i * 3 + 1] < 0.03) pPos[i * 3 + 1] = 0.03;
   }
   if (any) pGeo.attributes.position.needsUpdate = true;
  },
 };
}

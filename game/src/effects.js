// Transient visuals, all pooled: tracers, muzzle flashes, impact sparks, hit
// puffs, a flash pop and the charge's explosion. Nothing here allocates in
// the hot loop — a fixed set of meshes and one shared Points cloud cycle
// through the effects, and a spent effect simply hides until it is reused.
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

  // Muzzle flash: one shared additive plane with a radial star texture (a
  // canvas gradient: hot core, spiked falloff) + one shared point light.
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

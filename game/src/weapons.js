// The armoury: five firearms, two grenades, the firing model, the
// viewmodel. Accuracy is the heart: spread grows with movement, sustained
// fire (bloom) and air time, and shrinks stopped or crouched — pause-and-
// tap beats the spray. Each weapon carries a penetration value (pen):
// the Pike ignores a vest entirely — see hurtActor in actor.js.
import * as THREE from 'three';
import { raycastWorld } from './map.js';
import { eyePos, lookDir, rayHitActor, hurtActor } from './actor.js';

export const WEAPONS = {
 sidearm: { id: 'sidearm', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
  damage: 26, rpm: 360, auto: false, mag: 12, reserve: 48, reload: 1.35,
  spread: 0.55, moveSpread: 1.5, bloomPerShot: 0.35, recoil: 0.011, range: 42, pen: 0.5, kind: 'pistol', zoom: 1 },
 rook: { id: 'rook', name: 'Rook .45', slot: 'sidearm', price: 450,
  damage: 34, rpm: 330, auto: false, mag: 15, reserve: 60, reload: 1.5,
  spread: 0.45, moveSpread: 1.4, bloomPerShot: 0.32, recoil: 0.015, range: 46, pen: 0.6, kind: 'pistol', zoom: 1 },
 dart: { id: 'dart', name: 'Dart-9 SMG', slot: 'primary', price: 1250,
  damage: 22, rpm: 820, auto: true, mag: 32, reserve: 128, reload: 2.0,
  spread: 0.85, moveSpread: 1.1, bloomPerShot: 0.16, recoil: 0.007, range: 38, pen: 0.55, kind: 'smg', zoom: 1 },
 longarm: { id: 'longarm', name: 'Longarm AR', slot: 'primary', price: 2700,
  damage: 36, rpm: 600, auto: true, mag: 30, reserve: 120, reload: 2.3,
  spread: 0.5, moveSpread: 1.9, bloomPerShot: 0.22, recoil: 0.012, range: 70, pen: 0.75, kind: 'rifle', zoom: 1 },
 pike: { id: 'pike', name: 'Pike Longshot', slot: 'primary', price: 4300,
  damage: 96, rpm: 48, auto: false, mag: 5, reserve: 25, reload: 2.9,
  spread: 0.06, moveSpread: 6.0, bloomPerShot: 1.4, recoil: 0.055, range: 120, pen: 1.0, kind: 'sniper', zoom: 3.2 },
};

export const GRENADES = {
 frag: { id: 'frag', name: 'Frag Grenade', price: 300, fuse: 1.5, radius: 5.5, damage: 112 },
 flash: { id: 'flash', name: 'Flash Grenade', price: 200, fuse: 1.3, radius: 23 },
};

// Buy menu rows in display order: [kind, id].
export const BUY_MENU = [
 ['weapon', 'rook'], ['weapon', 'dart'], ['weapon', 'longarm'], ['weapon', 'pike'],
 ['armor', 'armor'], ['grenade', 'frag'], ['grenade', 'flash'],
];
export const ARMOR_PRICE = 650;

export function makeWeaponInstance(defId) {
 const def = WEAPONS[defId];
 return { defId, mag: def.mag, reserve: def.reserve };
}

export function makeLoadout() {
 return { primary: null, sidearm: makeWeaponInstance('sidearm'), grenades: [] };
}

export function activeInstance(actor) {
 return actor.loadout[actor.activeSlot];
}

// Degrees of spread for the shooter's state: still + crouched is the
// tightest cone in the game; sprinting triples a rifle's.
export function currentSpreadDeg(actor, def) {
 const move = Math.min(1, actor.speedNow / 4.6) * def.moveSpread;
 const air = actor.onGround ? 0 : 2.2;
 const crouch = actor.crouch ? 0.62 : 1;
 return (def.spread + actor.bloom + move + air) * crouch;
}

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hit = { t: 0, part: '', mult: 1 };

// The bearing damage came from, for the HUD's damage wedge: atan2 of the
// right/forward parts of (from - victim) — 0 ahead, positive right.
export function damageBearing(victim, fromX, fromZ) {
 const dx = fromX - victim.pos.x, dz = fromZ - victim.pos.z;
 const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
 const rx = Math.cos(victim.yaw), rz = -Math.sin(victim.yaw);
 return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

// Fire one hitscan round: ammo, spread, the wall/actor race, damage with
// head multiplier and falloff, tracer, impact, noise, recoil. True when a
// round left the barrel.
export function fireHitscan(G, shooter) {
 const inst = activeInstance(shooter);
 if (!inst || shooter.reloading > 0) return false;
 const def = WEAPONS[inst.defId];
 if (inst.mag <= 0) {
  if (shooter.isPlayer) G.audio.dryFire();
  startReload(G, shooter);
  return false;
 }
 inst.mag--;
 shooter.nextShotAt = G.time + 60 / def.rpm;
 shooter.bloom = Math.min(2.4, shooter.bloom + def.bloomPerShot);

 eyePos(shooter, _eye);
 lookDir(shooter, _dir);
 const spreadRad = currentSpreadDeg(shooter, def) * Math.PI / 180;
 G.rng.cone(_dir, spreadRad, _shotDir);

 const tWorld = raycastWorld(_eye.x, _eye.y, _eye.z, _shotDir.x, _shotDir.y, _shotDir.z, _hitPoint);
 let victim = null, victimT = Infinity, hitPart = '', hitMult = 1;
 for (const other of G.actors) {
  if (other === shooter || !other.alive) continue;
  if (rayHitActor(_eye.x, _eye.y, _eye.z, _shotDir.x, _shotDir.y, _shotDir.z, other, _hit)) {
   if (_hit.t < tWorld && _hit.t < victimT) {
    victim = other; victimT = _hit.t;
    hitPart = _hit.part; hitMult = _hit.mult;
   }
  }
 }

 // Muzzle point: ahead of the eyes, offset to the gun side.
 _muzzle.copy(_eye)
  .addScaledVector(_dir, 0.55);
 _muzzle.y -= 0.14;
 _muzzle.x += Math.cos(shooter.yaw) * 0.16;
 _muzzle.z += -Math.sin(shooter.yaw) * 0.16;

 if (victim) {
  _hitPoint.copy(_eye).addScaledVector(_shotDir, victimT);
  const falloff = victimT <= def.range ? 1 : Math.max(0.35, 1 - (victimT - def.range) / 60);
  if (victim.bot) victim.bot.lastHurtBy = shooter; // being shot at reveals the shooter
  const died = hurtActor(victim, def.damage * hitMult * falloff, def.pen);
  G.effects.impact(_hitPoint, true);
  G.effects.damageNumber(_hitPoint, Math.round(def.damage * hitMult * falloff),
   died ? 'kill' : hitPart === 'head' ? 'head' : 'hit');
  G.effects.tracer(_muzzle, _hitPoint);
  if (shooter.isPlayer) {
   G.audio.hit(hitPart === 'head');
   G.hud.hitmarker(hitPart === 'head', died);
  }
  if (victim.isPlayer) {
   G.audio.hurt();
   G.hud.damageFlash();
   G.hud.damageFrom(damageBearing(victim, shooter.pos.x, shooter.pos.z));
  }
  if (died) G.onKill(shooter, victim, hitPart === 'head', def);
 } else {
  if (tWorld !== Infinity) G.effects.impact(_hitPoint, false);
  else _hitPoint.copy(_eye).addScaledVector(_shotDir, 60);
  G.effects.tracer(_muzzle, _hitPoint);
 }
 G.effects.muzzleFlash(_muzzle, _dir);
 G.audio.shot(def.kind === 'sniper' ? 'sniper' : def.kind === 'smg' ? 'smg' : def.kind === 'pistol' ? 'pistol' : 'rifle',
  shooter.isPlayer ? 0 : _eye.distanceTo(G.playerEye));
 // Gunfire is information: every bot in earshot learns where it came from.
 G.bus.emit(shooter.pos.x, shooter.pos.z, shooter.team, 30, 'shot', G.time);
 // Recoil climbs the view; a bot's aim-error model absorbs it.
 shooter.pitch = Math.min(1.35, shooter.pitch + def.recoil * (0.75 + G.rng.next() * 0.5));
 if (inst.mag === 0) startReload(G, shooter);
 return true;
}

export function startReload(G, actor) {
 const inst = activeInstance(actor);
 if (!inst) return;
 const def = WEAPONS[inst.defId];
 if (actor.reloading > 0 || inst.mag >= def.mag || inst.reserve <= 0) return;
 actor.reloading = def.reload;
 if (actor.isPlayer) G.audio.reload();
}

// Steps every actor's reload timer; called once per fixed step from main.
export function stepReloads(G, dt) {
 for (const actor of G.actors) {
  if (actor.reloading <= 0) continue;
  actor.reloading -= dt;
  if (actor.reloading <= 0) {
   const inst = activeInstance(actor);
   const def = WEAPONS[inst.defId];
   const take = Math.min(def.mag - inst.mag, inst.reserve);
   inst.mag += take;
   inst.reserve -= take;
   actor.reloading = 0;
  }
 }
}

// --- Grenades ---------------------------------------------------------------

const _gvel = new THREE.Vector3();

export function throwGrenade(G, thrower, kind) {
 const idx = thrower.loadout.grenades.indexOf(kind);
 if (idx === -1) return false;
 thrower.loadout.grenades.splice(idx, 1);
 eyePos(thrower, _eye);
 lookDir(thrower, _dir);
 const mesh = new THREE.Mesh(
  G.grenadeGeo,
  kind === 'frag' ? G.grenadeMats.frag : G.grenadeMats.flash,
 );
 mesh.position.copy(_eye).addScaledVector(_dir, 0.4);
 scene_add(G, mesh);
 G.grenades.push({
  kind, mesh,
  pos: mesh.position,
  vel: new THREE.Vector3().copy(_dir).multiplyScalar(13.5).add(_gvel.set(0, 2.6, 0)),
  fuse: GRENADES[kind].fuse,
  thrower,
  settled: false,
 });
 G.audio.throwIt();
 return true;
}

function scene_add(G, mesh) { G.scene.add(mesh); }

export function stepGrenades(G, dt) {
 for (let i = G.grenades.length - 1; i >= 0; i--) {
  const g = G.grenades[i];
  g.fuse -= dt;
  if (!g.settled) {
   g.vel.y -= 16 * dt;
   moveAxis(G, g, 'x', g.vel.x * dt);
   moveAxis(G, g, 'z', g.vel.z * dt);
   g.pos.y += g.vel.y * dt;
   if (g.pos.y < 0.13) {
    g.pos.y = 0.13;
    if (Math.abs(g.vel.y) > 1.4) G.audio.bounce();
    g.vel.y = Math.abs(g.vel.y) > 1.2 ? -g.vel.y * 0.38 : 0;
    g.vel.x *= 0.72; g.vel.z *= 0.72;
    if (g.vel.y === 0 && Math.hypot(g.vel.x, g.vel.z) < 0.4) g.settled = true;
   }
   g.mesh.rotation.x += dt * 5;
   g.mesh.rotation.z += dt * 3;
  }
  if (g.fuse <= 0) {
   detonate(G, g);
   G.scene.remove(g.mesh);
   G.grenades.splice(i, 1);
  }
 }
}

// Axis-separated wall bounce for the grenade body (a 0.13 sphere).
function moveAxis(G, g, axis, delta) {
 g.pos[axis] += delta;
 for (const c of G.colliders) {
  if (g.pos.y > c.h) continue;
  if (g.pos.x > c.minX - 0.13 && g.pos.x < c.maxX + 0.13 &&
    g.pos.z > c.minZ - 0.13 && g.pos.z < c.maxZ + 0.13) {
   g.pos[axis] -= delta;
   g.vel[axis] = -g.vel[axis] * 0.42;
   return;
  }
 }
 const lim = axis === 'x' ? 30.8 : 22.8;
 if (g.pos[axis] > lim || g.pos[axis] < -lim) {
  g.pos[axis] = Math.max(-lim, Math.min(lim, g.pos[axis]));
  g.vel[axis] = -g.vel[axis] * 0.42;
 }
}

const _chest = new THREE.Vector3();

function detonate(G, g) {
 const def = GRENADES[g.kind];
 if (g.kind === 'flash') {
  G.audio.flashPop();
  G.effects.flashPop(g.pos);
  for (const actor of G.actors) {
   if (!actor.alive) continue;
   const d = actor.pos.distanceTo(g.pos);
   if (d > def.radius) continue;
   eyePos(actor, _eye);
   if (!G.losClear(_eye, g.pos)) continue;
   lookDir(actor, _dir);
   _chest.copy(g.pos).sub(_eye).normalize();
   const facing = _dir.dot(_chest);
   if (actor.isPlayer) {
    if (facing > 0.15) G.hud.flashBlind(Math.max(0.25, facing) * (1 - d / def.radius) * 2.6);
   } else if (facing > -0.1) {
    actor.blindTime = Math.max(actor.blindTime, (0.6 + facing) * (1 - d / def.radius) * 3.2);
   }
  }
  return;
 }
 // Frag: radial damage, quartered by hard cover between blast and body.
 G.audio.explosion();
 G.effects.explosion(g.pos);
 G.bus.emit(g.pos.x, g.pos.z, g.thrower.team, 34, 'explosion', G.time);
 for (const actor of G.actors) {
  if (!actor.alive) continue;
  _chest.set(actor.pos.x, actor.pos.y + 1.0, actor.pos.z);
  const d = _chest.distanceTo(g.pos);
  if (d > def.radius + 0.5) continue;
  let dmg = def.damage * Math.max(0, 1 - d / (def.radius + 0.5));
  if (!G.losClear(_chest, g.pos)) dmg *= 0.25;
  if (actor.team === g.thrower.team && actor !== g.thrower) dmg *= 0.35;
  if (dmg < 4) continue;
  if (actor.bot) actor.bot.lastHurtBy = g.thrower;
  const died = hurtActor(actor, dmg, 0.35); // frag shrapnel defeats little armour
  G.effects.damageNumber(_chest, Math.round(dmg), died ? 'kill' : 'hit');
  if (actor.isPlayer) {
   G.audio.hurt();
   G.hud.damageFlash();
   G.hud.damageFrom(damageBearing(actor, g.pos.x, g.pos.z));
  }
  if (died) G.onKill(g.thrower, actor, false, null);
 }
}

// --- Viewmodel ---------------------------------------------------------------

// The gun in the player's hands: one shared group, rebuilt on switch;
// kicks when firing, dips through a reload, bobs with movement.
export function createViewmodel(camera) {
 const group = new THREE.Group();
 group.position.set(0.25, -0.24, -0.5);
 camera.add(group);
 const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.42, metalness: 0.55 });
 const grip = new THREE.MeshStandardMaterial({ color: 0x3a3129, roughness: 0.85 });
 let parts = [];
 let kick = 0;
 let kind = '';

 function clear() {
  for (const p of parts) { group.remove(p); }
  parts = [];
 }
 function add(geo, mat, x, y, z, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  group.add(m);
  parts.push(m);
  return m;
 }

 // Part rows per kind: [w, h, d, grip?, x, y, z] boxes, dark metal unless
 // the grip flag picks the wooden grip material.
 const PARTS = {
  pistol: [[0.055, 0.11, 0.24, 0, 0, 0, -0.05], [0.05, 0.14, 0.06, 1, 0, -0.1, 0.05]],
  smg: [[0.06, 0.13, 0.42, 0, 0, 0, -0.12], [0.045, 0.2, 0.05, 0, 0, -0.15, -0.05], [0.05, 0.13, 0.06, 1, 0, -0.09, 0.1]],
  rifle: [[0.065, 0.14, 0.62, 0, 0, 0, -0.2], [0.05, 0.22, 0.055, 0, 0, -0.16, -0.12], [0.055, 0.12, 0.07, 1, 0, -0.09, 0.12], [0.04, 0.05, 0.16, 0, 0, 0.1, -0.3]],
  sniper: [[0.06, 0.13, 0.85, 0, 0, 0, -0.3], [0.05, 0.2, 0.05, 0, 0, -0.15, -0.2], [0.055, 0.12, 0.07, 1, 0, -0.09, 0.12]],
 };
 function build(defId) {
  clear();
  kind = WEAPONS[defId].kind;
  for (const [w, h, d, g, x, y, z] of PARTS[kind]) {
   add(new THREE.BoxGeometry(w, h, d), g ? grip : dark, x, y, z);
  }
  if (kind === 'sniper') { // the scope tube rides on top
   add(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), dark, 0, 0.11, -0.25, Math.PI / 2);
  }
 }

 return {
  group,
  build,
  get kind() { return kind; },
  fire() { kick = Math.min(1, kick + 0.55); },
  update(dt, actor, reloading, scoped) {
   kick = Math.max(0, kick - dt * 7);
   const bob = actor && actor.onGround ? Math.sin(actor.stepPhase * 2) * 0.008 * Math.min(1, actor.speedNow / 4) : 0;
   group.position.z = -0.5 + kick * 0.07;
   group.position.y = -0.24 + bob - kick * 0.02;
   group.rotation.x = kick * 0.05 + (reloading > 0 ? -0.7 * Math.sin(Math.min(1, reloading) * Math.PI) * 0.4 : 0);
   group.visible = !scoped;
  },
 };
}

// One actor model for the player and every bot: a capsule-ish body on the
// ground plane with acceleration/friction movement, crouch, jumping, health,
// armour and three hitbox bands (legs, torso, head). Sharing the model means
// the player's movement and a bot's movement obey exactly the same rules, and
// a bullet checks the same boxes no matter who it hits.
import * as THREE from 'three';
import { collideXZ, rayBox } from './map.js';

export const RADIUS = 0.35;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
const SPEED_RUN = 4.6;
const SPEED_WALK = 2.35;
const SPEED_CROUCH = 2.15;
const GRAVITY = 20;
const JUMP_VEL = 5.4;

let nextId = 1;

export function createActor(team, name, isPlayer) {
  return {
    id: nextId++,
    team, name, isPlayer,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    crouch: false, onGround: true,
    eyeH: EYE_STAND,
    hp: 100, armorHp: 0,
    alive: true,
    speedNow: 0,
    bloom: 0,          // firing inaccuracy that decays between shots
    blindTime: 0,      // flashbang seconds remaining
    money: 800, kills: 0, deaths: 0,
    loadout: null,     // filled by weapons.makeLoadout
    activeSlot: 'sidearm',
    reloading: 0,
    nextShotAt: 0,
    bot: null,         // bot brain state, or null for the player
    mesh: null,        // soldier figure (bots only)
    stepPhase: 0,      // walk-cycle phase for the figure's legs
  };
}

export function resetActor(actor, spawn) {
  actor.pos.set(spawn.x, 0, spawn.z);
  actor.vel.set(0, 0, 0);
  actor.yaw = spawn.yaw;
  actor.pitch = 0;
  actor.crouch = false;
  actor.hp = 100;
  actor.alive = true;
  actor.bloom = 0;
  actor.blindTime = 0;
  actor.reloading = 0;
  actor.nextShotAt = 0;
  actor.eyeH = EYE_STAND;
}

export function eyeHeight(actor) {
  return actor.crouch ? EYE_CROUCH : EYE_STAND;
}

export function eyePos(actor, out) {
  return out.set(actor.pos.x, actor.pos.y + actor.eyeH, actor.pos.z);
}

// Unit look direction from yaw/pitch (yaw 0 faces -z, pitch up positive).
export function lookDir(actor, out) {
  const cp = Math.cos(actor.pitch);
  return out.set(-Math.sin(actor.yaw) * cp, Math.sin(actor.pitch), -Math.cos(actor.yaw) * cp);
}

// wish: {x, z} desired world-space move direction (any length), plus flags.
// Acceleration is a fast exponential approach on the ground and weak in the
// air, so strafing has weight, stopping is quick, and a full sprint is the
// least accurate way to move (weapons read speedNow for spread).
export function stepActor(actor, dt, wish) {
  const maxSpeed = actor.crouch ? SPEED_CROUCH : (wish.walk ? SPEED_WALK : SPEED_RUN);
  const wl = Math.hypot(wish.x, wish.z);
  const tx = wl > 0.01 ? (wish.x / wl) * maxSpeed * Math.min(1, wl) : 0;
  const tz = wl > 0.01 ? (wish.z / wl) * maxSpeed * Math.min(1, wl) : 0;
  const rate = actor.onGround ? (wl > 0.01 ? 11 : 9) : 1.6;
  const k = Math.min(1, rate * dt);
  actor.vel.x += (tx - actor.vel.x) * k;
  actor.vel.z += (tz - actor.vel.z) * k;

  if (wish.jump && actor.onGround) {
    actor.vel.y = JUMP_VEL;
    actor.onGround = false;
  }
  actor.vel.y -= GRAVITY * dt;
  actor.pos.x += actor.vel.x * dt;
  actor.pos.z += actor.vel.z * dt;
  actor.pos.y += actor.vel.y * dt;
  if (actor.pos.y <= 0) {
    actor.pos.y = 0;
    actor.vel.y = 0;
    actor.onGround = true;
  }
  collideXZ(actor.pos, RADIUS, actor.pos.y);

  actor.speedNow = Math.hypot(actor.vel.x, actor.vel.z);
  const targetEye = eyeHeight(actor);
  actor.eyeH += (targetEye - actor.eyeH) * Math.min(1, 14 * dt);
  actor.bloom = Math.max(0, actor.bloom - dt * 2.6);
  if (actor.blindTime > 0) actor.blindTime = Math.max(0, actor.blindTime - dt);
  actor.stepPhase += actor.speedNow * dt * 2.4;
}

// The three hitbox bands for an actor's current pose. Heights are fractions
// of the pose height so a crouched target is genuinely smaller.
const BANDS = [
  { part: 'legs', from: 0.0, to: 0.46, mult: 0.75 },
  { part: 'torso', from: 0.46, to: 0.8, mult: 1.0 },
  { part: 'head', from: 0.8, to: 1.0, mult: 4.0 },
];

// Nearest band hit along a unit ray, or null. Writes into `hit` {t, part, mult}.
export function rayHitActor(ox, oy, oz, dx, dy, dz, actor, hit) {
  const height = (actor.crouch ? 1.25 : 1.7);
  const base = actor.pos.y;
  let best = Infinity, bestBand = null;
  for (const band of BANDS) {
    const t = rayBox(ox, oy, oz, dx, dy, dz,
      actor.pos.x - 0.34, base + band.from * height, actor.pos.z - 0.34,
      actor.pos.x + 0.34, base + band.to * height, actor.pos.z + 0.34);
    if (t !== -1 && t < best) { best = t; bestBand = band; }
  }
  if (!bestBand) return null;
  hit.t = best; hit.part = bestBand.part; hit.mult = bestBand.mult;
  return hit;
}

// Apply damage through armour. A weapon's penetration `pen` (0..1) is the
// share of damage armour cannot stop: armour negates up to (1 - pen) of the
// hit, wearing down by what it negates, and the rest reaches health. A
// rifle (pen 0.75) therefore chews through a vest a pistol (pen 0.5, the
// default) barely dents. Returns true when the actor dies. Kill
// bookkeeping, feed and sound belong to the caller.
export function hurtActor(actor, rawDamage, pen = 0.5) {
  let dmg = rawDamage;
  if (actor.armorHp > 0) {
    const absorbed = Math.min(actor.armorHp, dmg * (1 - pen));
    actor.armorHp -= absorbed;
    dmg -= absorbed;
  }
  actor.hp -= dmg;
  if (actor.hp <= 0 && actor.alive) {
    actor.hp = 0;
    actor.alive = false;
    actor.deaths++;
    return true;
  }
  return false;
}

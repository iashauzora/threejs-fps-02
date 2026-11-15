// Bot brains: perception, team plans and a small state machine per bot.
// A bot perceives the world the way a player does — through a vision cone
// with line-of-sight, and through hearing: every noise in the world is an
// event on the hearing bus (bus.js), and a bot only reacts to fresh enemy
// noise inside its range. Sightings are published to G.spotted (the HUD
// minimap reads them) and called out on team radio (radio.js). Each round
// the plan assigns named roles — attackers: entry (carries the charge),
// support (flashes the site entry), flex (trades behind the entry), lurker
// (mid, late); defenders: two anchors per site and a flex rotating through
// mid. In a fight a bot fires disciplined bursts: its aim error grows while
// it moves and shrinks when it stops, mirroring the spread model its
// bullets obey.
import * as THREE from 'three';
import { SITES, HOLD_POINTS, findPath, makePathScratch, losClear, siteAt } from './map.js';
import { eyePos, lookDir } from './actor.js';
import { WEAPONS, activeInstance, fireHitscan, startReload, throwGrenade } from './weapons.js';
import { zoneName } from './radio.js';

const FOV_COS = Math.cos(1.05); // ~120 degree total vision cone
const SIGHT_RANGE = 46;
const HEAR_RANGE = 30;

const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _scratch = makePathScratch();

export function createBrain(actor, role) {
  return {
    role,                    // movement family: 'attack' | 'defend' | 'mid' | 'lurk'
    planRole: 'flex',        // named plan role: entry|support|flex|lurker|anchor
    radioAt: 0,              // radio cooldown: next time a callout may go out
    objCallAt: -99,          // last plant/defuse callout (channel can churn)
    hurtCalled: false,       // the low-health callout went out this round
    utilityUsed: false,      // the support's entry flash is spent this round
    state: 'advance',
    targetPos: { x: actor.pos.x, z: actor.pos.z },
    holdPos: null,
    enemy: null,             // actor currently engaged
    lastSeenPos: { x: 0, z: 0 },
    lastSeenAt: -99,
    thinkAt: 0,              // next perception tick
    burstLeft: 0,
    burstWait: 0,
    strafeDir: 1,
    strafeAt: 0,
    aimYaw: actor.yaw,
    aimPitch: 0,
    hasCharge: false,
    path: null,              // cached waypoint route to the current goal
    pathGoalX: 0,
    pathGoalZ: 0,
    channelAt: 0,            // plant/defuse progress handled by rounds.js
    reactedAt: 0,            // when the current enemy was first seen
    grenadeAt: 0,
  };
}

// Per-round team plans for the 5v5. Attackers pick a site and stack roles on
// it: the entry carries the charge and leads, support plays behind him with
// the entry flash, flex trades, the lurker works mid late. The human player
// is the fifth attacker and plays free — a bot still carries. Defenders
// split 2/2/1: two anchors on each site, one flex holding mid who rotates
// to whichever site the noise bus reports. Called by rounds.js at every
// round start; positions come from HOLD_POINTS so the defence sets up on
// real angles, not on the objective itself.
const ATTACK_ROLES = ['entry', 'support', 'flex', 'lurker'];
export function assignPlans(G, rng) {
  const attackers = G.actors.filter((a) => a.team === 'ember');
  const defenders = G.actors.filter((a) => a.team === 'warden');
  const site = rng.chance(0.55) ? 'A' : 'B';
  G.plan = { site, carrier: null };
  const emberBots = attackers.filter((a) => a.bot);
  emberBots.forEach((a, i) => {
    const planRole = ATTACK_ROLES[i % ATTACK_ROLES.length];
    a.bot.planRole = planRole;
    a.bot.role = planRole === 'lurker' ? 'lurk' : 'attack';
    a.bot.hasCharge = planRole === 'entry';
    if (a.bot.hasCharge) G.plan.carrier = a;
    a.bot.state = 'advance';
    a.bot.enemy = null;
    a.bot.path = null;
    a.bot.hurtCalled = false;
    a.bot.utilityUsed = false;
  });
  const DEFENCE = [
    { planRole: 'anchor', role: 'defend', pool: HOLD_POINTS.A },
    { planRole: 'anchor', role: 'defend', pool: HOLD_POINTS.A },
    { planRole: 'anchor', role: 'defend', pool: HOLD_POINTS.B },
    { planRole: 'anchor', role: 'defend', pool: HOLD_POINTS.B },
    { planRole: 'flex', role: 'mid', pool: HOLD_POINTS.mid },
  ];
  defenders.filter((a) => a.bot).forEach((a, i) => {
    const post = DEFENCE[i % DEFENCE.length];
    a.bot.planRole = post.planRole;
    a.bot.role = post.role;
    a.bot.holdPos = post.pool[i % 2] || post.pool[0];
    a.bot.state = 'advance';
    a.bot.enemy = null;
    a.bot.path = null;
    a.bot.hurtCalled = false;
    a.bot.utilityUsed = false;
  });
}

function visible(G, bot, other) {
  if (!other.alive) return false;
  eyePos(bot, _eye);
  eyePos(other, _targetEye);
  _toTarget.subVectors(_targetEye, _eye);
  const dist = _toTarget.length();
  if (dist > SIGHT_RANGE) return false;
  _toTarget.divideScalar(dist || 1);
  lookDir(bot, _fwd);
  const facing = _fwd.dot(_toTarget);
  // A target dead ahead is seen; at the cone's edge it must be close; a bot
  // that was just shot at turns toward its attacker regardless.
  if (facing < FOV_COS && dist > 7 && bot.lastHurtBy !== other) return false;
  if (bot.blindTime > 0.4) return false;
  return losClear(_eye.x, _eye.y, _eye.z, _targetEye.x, _targetEye.y, _targetEye.z);
}

function perceive(G, actor, dt) {
  const bot = actor.bot;
  bot.thinkAt -= dt;
  // Hearing is checked every step off the bus (cheap, few events); vision
  // runs on a tick. Heard enemy noise turns a holding bot to investigate.
  for (const ev of G.bus.events) {
    if (ev.team === actor.team || ev.time < G.time - 0.4) continue;
    const d = Math.hypot(ev.x - actor.pos.x, ev.z - actor.pos.z);
    if (d < HEAR_RANGE && d < ev.radius + 12) {
      if (!bot.enemy) {
        bot.lastSeenPos.x = ev.x; bot.lastSeenPos.z = ev.z;
        bot.lastSeenAt = ev.time;
        if (bot.state === 'hold') bot.state = 'investigate';
      }
    }
  }
  if (bot.thinkAt > 0) return;
  bot.thinkAt = 0.09 + G.rng.next() * 0.05;

  let best = null, bestD = Infinity;
  for (const other of G.actors) {
    if (other.team === actor.team || !other.alive) continue;
    if (visible(G, actor, other)) {
      const d = actor.pos.distanceTo(other.pos);
      if (d < bestD) { bestD = d; best = other; }
    }
  }
  if (best) {
    if (bot.enemy !== best) {
      bot.enemy = best;
      bot.reactedAt = G.time;
      // First contact is called on the radio and published as a spotting:
      // the whole team (and the player's minimap) learns the zone.
      G.radio.say(actor, `Contact ${zoneName(best.pos.x, best.pos.z)}!`);
    }
    bot.lastSeenPos.x = best.pos.x; bot.lastSeenPos.z = best.pos.z;
    bot.lastSeenAt = G.time;
    G.spotted.set(best.id, { x: best.pos.x, z: best.pos.z, at: G.time });
  } else if (bot.enemy && (!bot.enemy.alive || G.time - bot.lastSeenAt > 1.6)) {
    bot.enemy = null;
  }
}

// Desired movement for this step, written into wish {x, z, crouch, walk, jump}.
export function stepBot(G, actor, dt, wish) {
  const bot = actor.bot;
  wish.x = 0; wish.z = 0; wish.crouch = false; wish.walk = false; wish.jump = false;
  if (!actor.alive) return;
  perceive(G, actor, dt);

  const phase = G.round.phase;
  const planted = phase === 'planted';

  // Badly hurt and still standing: one callout, then the retreat below.
  if (actor.hp < 30 && !bot.hurtCalled) {
    bot.hurtCalled = true;
    G.radio.say(actor, "I'm hit — falling back");
  }

  // Support utility: the entry flash goes in just before the carrier hits
  // the site — aimed over the plant spot, called on the radio, once a round.
  if (bot.planRole === 'support' && !bot.utilityUsed && actor.team === 'ember' &&
      phase === 'live' && actor.loadout.grenades.includes('flash')) {
    const site = SITES[G.plan.site];
    const carrier = G.plan.carrier;
    const dSite = Math.hypot(site.plantX - actor.pos.x, site.plantZ - actor.pos.z);
    const dCarrier = carrier && carrier.alive
      ? Math.hypot(site.plantX - carrier.pos.x, site.plantZ - carrier.pos.z) : 99;
    if (dSite < 17 && dCarrier < 12) {
      bot.utilityUsed = true;
      actor.yaw = Math.atan2(-(site.plantX - actor.pos.x), -(site.plantZ - actor.pos.z));
      actor.pitch = 0.32;
      if (throwGrenade(G, actor, 'flash')) G.radio.say(actor, 'Flashing in — go!', true);
      actor.pitch = 0;
    }
  }

  // --- choose a goal from state and team plan ------------------------------
  let goal = null;
  let wantCrouch = false;
  if (bot.enemy && bot.enemy.alive && G.time - bot.lastSeenAt < 1.2) {
    bot.state = 'engage';
  } else if (bot.state === 'engage') {
    bot.state = 'advance';
  }

  if (actor.hp < 26 && bot.state !== 'engage' && !planted) bot.state = 'retreat';

  if (bot.state === 'engage') {
    goal = combatMove(G, actor, dt, wish);
  } else if (bot.state === 'retreat') {
    const spawn = actor.team === 'ember' ? { x: -27, z: 0 } : { x: 27, z: 0 };
    goal = spawn;
    if (actor.hp > 45) bot.state = 'advance';
  } else if (planted) {
    goal = plantedGoal(G, actor);
  } else if (actor.team === 'ember') {
    goal = attackGoal(G, actor);
  } else {
    goal = defendGoal(G, actor);
  }

  // --- steer toward the goal along the waypoint graph ----------------------
  if (goal) {
    const dx = goal.x - actor.pos.x, dz = goal.z - actor.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > (goal.slow ? 0.4 : 0.9)) {
      let tx = goal.x, tz = goal.z;
      if (dist > 6 && !goal.slow) {
        // Follow a cached route through the waypoint graph (see findPath):
        // a fresh per-step hop can reverse at nearest-node boundaries and
        // pin the bot; a cached route is followed node by node instead.
        if (!bot.path || Math.abs(bot.pathGoalX - goal.x) > 1.5 || Math.abs(bot.pathGoalZ - goal.z) > 1.5) {
          bot.path = findPath(actor.pos.x, actor.pos.z, goal.x, goal.z, _scratch);
          bot.pathGoalX = goal.x;
          bot.pathGoalZ = goal.z;
        }
        while (bot.path.length && Math.hypot(bot.path[0].x - actor.pos.x, bot.path[0].z - actor.pos.z) < 1.3) bot.path.shift();
        if (bot.path.length) { tx = bot.path[0].x; tz = bot.path[0].z; }
      }
      const hx = tx - actor.pos.x, hz = tz - actor.pos.z;
      const hl = Math.hypot(hx, hz) || 1;
      wish.x = hx / hl; wish.z = hz / hl;
      // Face travel direction unless engaging or holding an angle.
      if (bot.state !== 'engage' && bot.state !== 'hold') {
        turnToward(actor, Math.atan2(-wish.x, -wish.z), dt, 3.4);
        actor.pitch += (0 - actor.pitch) * Math.min(1, 6 * dt);
      }
      // Slow to a walk near the goal or when a contact is fresh: quieter and
      // steadier, and it keeps bots from overshooting doorways.
      if (dist < 3 || G.time - bot.lastSeenAt < 2.5) wish.walk = true;
    } else if (bot.state === 'advance') {
      onArrive(G, actor);
    }
  }
  if (wantCrouch) wish.crouch = true;

  // --- face the enemy when holding or investigating -------------------------
  if ((bot.state === 'hold' || bot.state === 'investigate') && G.time - bot.lastSeenAt < 6) {
    const a = Math.atan2(-(bot.lastSeenPos.x - actor.pos.x), -(bot.lastSeenPos.z - actor.pos.z));
    turnToward(actor, a, dt, 2.2);
  }

  combatAct(G, actor, dt);
}

function turnToward(actor, targetYaw, dt, speed) {
  let d = targetYaw - actor.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  actor.yaw += THREE.MathUtils.clamp(d, -speed * dt, speed * dt);
}

// Where an attacker goes: the carrier and its escorts head for the plan site
// (the lurker slips through mid), and once inside the site the carrier plants.
function attackGoal(G, actor) {
  const bot = actor.bot;
  const site = SITES[G.plan.site];
  if (bot.role === 'lurk') {
    const mid = { x: 4, z: actor.pos.z > 0 ? -6 : 6 };
    if (Math.hypot(mid.x - actor.pos.x, mid.z - actor.pos.z) > 3) return mid;
    bot.role = 'attack';
  }
  if (bot.hasCharge) {
    const inside = siteAt(actor.pos.x, actor.pos.z);
    if (inside && inside.id === site.id) {
      G.requestPlant(actor);
      return { x: site.plantX, z: site.plantZ, slow: true };
    }
    return { x: site.plantX, z: site.plantZ };
  }
  // Escorts take a shoulder position near the plant spot.
  return { x: site.plantX - 4 + (actor.id % 3) * 3.5, z: site.plantZ + (actor.id % 2 ? 3.5 : -3.5) };
}

function defendGoal(G, actor) {
  const bot = actor.bot;
  if (bot.state === 'investigate') {
    if (Math.hypot(bot.lastSeenPos.x - actor.pos.x, bot.lastSeenPos.z - actor.pos.z) < 2.2) {
      bot.state = 'hold';
    }
    return bot.lastSeenPos;
  }
  bot.state = 'hold';
  return bot.holdPos || { x: actor.pos.x, z: actor.pos.z };
}

// After the plant: attackers guard the charge from the site's edges,
// defenders converge — the nearest starts the defuse, the rest cover.
function plantedGoal(G, actor) {
  const bot = actor.bot;
  const charge = G.charge;
  if (actor.team === 'ember') {
    bot.state = 'hold';
    return { x: charge.x + (actor.id % 3 - 1) * 4.5, z: charge.z + (actor.id % 2 ? 4 : -4) };
  }
  let nearest = null, nd = Infinity;
  for (const a of G.actors) {
    if (a.team !== 'warden' || !a.alive) continue;
    const d = Math.hypot(a.pos.x - charge.x, a.pos.z - charge.z);
    if (d < nd) { nd = d; nearest = a; }
  }
  if (nearest === actor) {
    if (nd < 1.6) { G.requestDefuse(actor); return { x: charge.x, z: charge.z, slow: true }; }
    return { x: charge.x, z: charge.z };
  }
  bot.state = 'hold';
  return { x: charge.x + (actor.id % 3 - 1) * 5, z: charge.z + (actor.id % 2 ? 5 : -5) };
}

function onArrive(G, actor) {
  const bot = actor.bot;
  if (actor.team === 'warden') bot.state = 'hold';
}

// Combat movement: keep a fighting distance, strafe between bursts, crouch
// for the accurate shots. Returns the position to hold around the enemy.
function combatMove(G, actor, dt, wish) {
  const bot = actor.bot;
  const foe = bot.enemy;
  if (G.time > bot.strafeAt) {
    bot.strafeAt = G.time + 0.5 + G.rng.next() * 0.9;
    bot.strafeDir = G.rng.chance(0.5) ? 1 : -1;
    if (G.rng.chance(0.3)) bot.strafeDir = 0;
  }
  const dx = foe.pos.x - actor.pos.x, dz = foe.pos.z - actor.pos.z;
  const dist = Math.hypot(dx, dz) || 1;
  const px = (-dz / dist) * bot.strafeDir, pz = (dx / dist) * bot.strafeDir;
  let gx = actor.pos.x + px * 2.2, gz = actor.pos.z + pz * 2.2;
  if (dist > 26) { gx = foe.pos.x - (dx / dist) * 18; gz = foe.pos.z - (dz / dist) * 18; }
  if (dist < 5) { gx = actor.pos.x - (dx / dist) * 2; gz = actor.pos.z - (dz / dist) * 2; }
  wish.crouch = bot.burstWait > 0 && dist > 8;
  return { x: gx, z: gz, slow: true };
}

// Aiming and trigger discipline, plus grenade judgement. Aim tracks the
// enemy's chest with a skill-based error that decays after first sight (the
// reaction window), then bursts of 3–5 with pauses — and the same spread
// model as a human's bullets punishes firing mid-strafe.
function combatAct(G, actor, dt) {
  const bot = actor.bot;
  const inst = activeInstance(actor);
  if (!inst) return;
  if (inst.mag === 0 && actor.reloading <= 0) { startReload(G, actor); return; }
  if (actor.reloading > 0) return;
  const foe = bot.enemy;
  if (!foe || !foe.alive || G.round.phase === 'buy' || G.round.phase === 'end') return;
  if (G.time - bot.lastSeenAt > 0.35) return; // only fire on fresh information
  if (actor.blindTime > 0.3) return;

  // Aim: lead the chest slightly, with error that shrinks as the bot settles.
  eyePos(actor, _eye);
  _targetEye.set(foe.pos.x, foe.pos.y + (foe.crouch ? 0.95 : 1.25), foe.pos.z);
  const settle = Math.min(1, (G.time - bot.reactedAt) / 0.7);
  // Angular error (radians): wide just after first sight, tightening as the
  // bot settles — so the offset at the target grows with range, like a human's.
  const errRad = (1 - settle) * 0.045 + 0.010 + Math.min(0.02, actor.speedNow * 0.004);
  const aimDist = actor.pos.distanceTo(foe.pos);
  _targetEye.x += (G.rng.next() - 0.5) * 2 * errRad * aimDist;
  _targetEye.z += (G.rng.next() - 0.5) * 2 * errRad * aimDist;
  _toTarget.subVectors(_targetEye, _eye);
  _toTarget.divideScalar(_toTarget.length() || 1); // normalized: the trigger-
  // discipline check below projects teammates onto this direction.
  const targetYaw = Math.atan2(-_toTarget.x, -_toTarget.z);
  const targetPitch = Math.asin(THREE.MathUtils.clamp(_toTarget.y, -1, 1));
  turnToward(actor, targetYaw, dt, 7.5);
  actor.pitch += THREE.MathUtils.clamp(targetPitch - actor.pitch, -5 * dt, 5 * dt);

  // A grenade before the first burst, when the enemy is mid-range: a frag
  // onto the spotted position if the bot carries one. The support's flash
  // is saved for the site entry (see stepBot) and never spent here.
  if (bot.grenadeAt < G.time && actor.loadout.grenades.length && settle >= 1) {
    const dist = actor.pos.distanceTo(foe.pos);
    const kind = actor.loadout.grenades.includes('frag') ? 'frag' : actor.loadout.grenades[0];
    const savedFlash = kind === 'flash' && bot.planRole === 'support' && !bot.utilityUsed;
    if (!savedFlash && dist > 8 && dist < 20 && G.rng.chance(0.5)) {
      throwGrenade(G, actor, kind);
      bot.grenadeAt = G.time + 6;
      return;
    }
    bot.grenadeAt = G.time + 2;
  }

  if (bot.burstWait > 0) { bot.burstWait -= dt; return; }
  if (G.time < actor.nextShotAt) return;
  const def = WEAPONS[inst.defId];
  // Only pull the trigger when the muzzle is roughly on the target.
  let dy = targetYaw - actor.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  if (Math.abs(dy) > 0.06) return;
  // Trigger discipline: never fire through a teammate. If a friendly body is
  // within half a metre of the line to the target and nearer than it, hold.
  // (_toTarget already holds the normalized aim direction from the aim step.)
  eyePos(actor, _eye);
  const targetDist = Math.hypot(bot.enemy.pos.x - actor.pos.x, bot.enemy.pos.z - actor.pos.z);
  for (const mate of G.actors) {
    if (mate === actor || mate.team !== actor.team || !mate.alive) continue;
    const mx = mate.pos.x - _eye.x, mz = mate.pos.z - _eye.z;
    const along = mx * _toTarget.x + mz * _toTarget.z;
    if (along < 0 || along > targetDist) continue;
    const px = _eye.x + _toTarget.x * along, pz = _eye.z + _toTarget.z * along;
    if (Math.hypot(mate.pos.x - px, mate.pos.z - pz) < 0.55) return;
  }
  fireHitscan(G, actor);
  if (def.auto) {
    bot.burstLeft--;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(G.rng.next() * 3);
      bot.burstWait = 0.4 + G.rng.next() * 0.5;
    }
  } else {
    bot.burstWait = def.id === 'pike' ? 0.5 : 0.16 + G.rng.next() * 0.2;
  }
}

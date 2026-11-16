// The match: rounds of buy -> live -> (planted) -> end between Ember and
// the Wardens. A round is won by elimination, detonation, the clock, or a
// defuse; money is earned for kills, plants and outcomes. First to 7 —
// with a halftime side swap (below) after round 6.
import * as THREE from 'three';
import { SPAWNS, SITES, siteAt } from './map.js';
import { resetActor, hurtActor } from './actor.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, makeWeaponInstance, makeLoadout } from './weapons.js';
import { assignPlans, replanOnPlant } from './bots.js';
import { siteLabel } from './radio.js';

export const ROUND_TIME = 100;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const CHARGE_TIME = 35;
export const BUY_TIME = 12;
export const END_TIME = 4.5;
export const WIN_SCORE = 7;
export const START_MONEY = 800;
export const HALF_AT = 6; // rounds per half: the swap lands as round 7 opens

const AWARD = { kill: 300, plant: 300, win: 1400, winPlant: 1700, loss: 900, lossBonusStep: 200 };

export function createMatch(G) {
 const round = {
  number: 0,
  phase: 'buy',
  phaseAt: 0,          // G.time when the phase began
  timer: BUY_TIME,
  score: { ember: 0, warden: 0 },
  winner: null,
  winReason: '',
  lossStreak: { ember: 0, warden: 0 },
  over: false,
  half: 1,             // 1 or 2; the sides swap at the half (startRound)
  attack: 'ember',     // the team attacking this half — roles read this,
             // never the team name, from here on
 };
 G.round = round;
 G.charge = { state: 'carried', x: 0, z: 0, site: null, plantedAt: 0, mesh: null, beepAt: 0 };
 G.channel = null; // {actor, kind: 'plant'|'defuse', t, need}
 buildChargeMesh(G);
 return round;
}

function buildChargeMesh(G) {
 const group = new THREE.Group();
 const body = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.26, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.4 }),
 );
 body.position.y = 0.13;
 group.add(body);
 const light = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 0.05, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff2a1a, emissiveIntensity: 2.4 }),
 );
 light.position.set(0, 0.28, 0);
 group.add(light);
 const glow = new THREE.PointLight(0xff3a22, 3, 5, 2);
 glow.position.y = 0.5;
 group.add(glow);
 group.visible = false;
 G.scene.add(group);
 G.charge.mesh = group;
 G.charge.lightMesh = light;
 G.charge.glow = glow; // main.js pulses both once the charge is planted
}

// Halftime, landed once as round HALF_AT + 1 opens: round.attack flips
// (every role decision reads it, not a team name), each team spawns from
// the other's row for the rest of the match, and the match resets to a
// pistol round — starting money, sidearms, no armour. Both teams hear it
// on the radio; main.js answers with the dusk lighting.
function halftimeSwap(G) {
 const round = G.round;
 round.half = 2;
 round.attack = round.attack === 'ember' ? 'warden' : 'ember';
 for (const actor of G.actors) {
  actor.money = START_MONEY;
  actor.loadout = makeLoadout();
  actor.activeSlot = 'sidearm';
  actor.armorHp = 0;
 }
 G.radio.teamSay(round.attack, 'Second half — we attack now, pistols out');
 G.radio.teamSay(round.attack === 'ember' ? 'warden' : 'ember', 'Halftime — sides swap, hold the sites');
}

// Full reset for a new round: everyone back to spawn at full health, the
// charge back in the attackers' hands, loadouts kept (halftime aside).
export function startRound(G) {
 const round = G.round;
 round.number++;
 const swapped = round.half === 1 && round.number > HALF_AT;
 if (swapped) halftimeSwap(G);
 round.phase = 'buy';
 round.phaseAt = G.time;
 round.timer = BUY_TIME;
 round.winner = null;
 round.winReason = '';
 G.channel = null;
 // The human carries a charge only while their team attacks; in the
 // second half they hold sites (and defuse) instead.
 G.playerHasCharge = G.player.team === round.attack;
 G.grenades.length = 0;
 G.bus.clear();
 G.spotted.clear();
 G.charge.state = 'carried';
 G.charge.site = null;
 G.charge.mesh.visible = false;

 for (const team of ['ember', 'warden']) {
  // After the swap each team spawns from the other team's row.
  const spawnTeam = round.half === 1 ? team : (team === 'ember' ? 'warden' : 'ember');
  const mates = G.actors.filter((a) => a.team === team);
  mates.forEach((actor, i) => {
   const keepArmor = actor.armorHp > 0;
   resetActor(actor, SPAWNS[spawnTeam][i % SPAWNS[spawnTeam].length]);
   if (!keepArmor) actor.armorHp = 0;
   // A dead player's bought gun is gone; survivors keep theirs.
   for (const slot of ['primary', 'sidearm']) {
    const inst = actor.loadout[slot];
    if (inst) { inst.mag = WEAPONS[inst.defId].mag; }
   }
   if (actor.bot) {
    actor.bot.state = 'advance';
    actor.bot.enemy = null;
    actor.bot.hasCharge = false;
    actor.bot.burstLeft = 0;
    actor.bot.burstWait = 0;
   }
   if (actor.mesh) actor.mesh.group.visible = true;
  });
 }
 assignPlans(G, G.rng);
 botBuyPhase(G);
 // The intro card, spoken from the player's side; the swap round's
 // card says so outright.
 const atkName = round.attack === 'ember' ? 'Ember' : 'Wardens';
 const defName = round.attack === 'ember' ? 'Wardens' : 'Ember';
 const playerAttacks = G.player.team === round.attack;
 G.hud.roundIntro(round.number, round.score,
  `${swapped ? 'HALFTIME — sides swap · ' : ''}${atkName} attack — ${
   playerAttacks ? `plant at the ${siteLabel(G.plan.site)}, or eliminate the ${defName}`
    : `hold the sites, or eliminate ${atkName}`} · first to ${WIN_SCORE}`);
 // The plan call opens the round on team radio, from the carrier himself.
 if (G.plan.carrier) {
  G.radio.say(G.plan.carrier, `Going ${siteLabel(G.plan.site)} — stack on me`, true);
 }
}

// The team economy decision, once per team per round before anyone shops,
// from average money and loss streak: streak >= 2 or avg < $1,600 = save
// (no primaries; vest only if $1,600 stays in pocket); streak 1 or avg
// < $3,000 = force (SMGs outright, Rook if $900 stays back, vests last);
// else full (per-bot rules below). Utility is bought in every mode; save
// and force are announced on radio; modes stay on round.ecoModes. Bots
// only — the human is untouched.
function teamEcoMode(G, team) {
 const mates = G.actors.filter((a) => a.team === team && a.bot);
 const avg = mates.reduce((n, a) => n + a.money, 0) / Math.max(1, mates.length);
 const streak = G.round.lossStreak[team];
 if (streak >= 2 || avg < 1600) return 'save';
 if (streak === 1 || avg < 3000) return 'force';
 return 'full';
}

function botBuyPhase(G) {
 const round = G.round;
 round.ecoModes = { ember: teamEcoMode(G, 'ember'), warden: teamEcoMode(G, 'warden') };
 for (const team of ['ember', 'warden']) {
  if (round.ecoModes[team] === 'save') G.radio.teamSay(team, 'Eco round — pistols only, save it');
  else if (round.ecoModes[team] === 'force') G.radio.teamSay(team, 'Force buy — SMGs and vests out');
 }
 for (const actor of G.actors) {
  if (!actor.bot || !actor.alive) continue;
  const mode = round.ecoModes[actor.team];
  const rich = actor.money >= 3900;
  const mid = actor.money >= 2000;
  if (!actor.loadout.primary) {
   if (mode === 'full' && rich) buyWeapon(G, actor, 'longarm');
   else if (mode === 'full' && mid) buyWeapon(G, actor, 'dart');
   else if (mode === 'force' && actor.money >= 1250) buyWeapon(G, actor, 'dart');
   else if (mode === 'full' && actor.money >= 1000 && G.rng.chance(0.4)) buyWeapon(G, actor, 'dart');
   // save: no primary, whatever the pocket holds — that is the point.
  }
  if (actor.armorHp <= 0) {
   if (mode === 'save') { if (actor.money >= ARMOR_PRICE + 1600) buyArmor(G, actor); }
   else if (actor.money >= ARMOR_PRICE + 300) buyArmor(G, actor);
  }
  if (!actor.loadout.sidearm || actor.loadout.sidearm.defId === 'sidearm') {
   if (mode === 'force' && actor.money >= 1350) buyWeapon(G, actor, 'rook');
   else if (mode === 'full' && actor.money >= 2900 && G.rng.chance(0.5)) buyWeapon(G, actor, 'rook');
  }
  // Utility follows the plan role (entry frag, support flash), every mode.
  if (!actor.loadout.grenades.length) {
   const role = actor.bot.planRole;
   if (role === 'entry' && actor.money >= 300) buyGrenade(G, actor, 'frag');
   else if (role === 'support' && actor.money >= 200) buyGrenade(G, actor, 'flash');
   else if (mode !== 'save' && actor.money >= 2400 && G.rng.chance(0.45)) {
    buyGrenade(G, actor, G.rng.chance(0.5) ? 'frag' : 'flash');
   }
  }
  actor.activeSlot = actor.loadout.primary ? 'primary' : 'sidearm';
 }
}

export function buyWeapon(G, actor, defId) {
 const def = WEAPONS[defId];
 if (!def || actor.money < def.price) return false;
 if (actor.loadout[def.slot] && actor.loadout[def.slot].defId === defId) return false;
 actor.money -= def.price;
 actor.loadout[def.slot] = makeWeaponInstance(defId);
 if (actor.isPlayer) G.audio.buy();
 return true;
}

export function buyArmor(G, actor) {
 if (actor.money < ARMOR_PRICE || actor.armorHp >= 100) return false;
 actor.money -= ARMOR_PRICE;
 actor.armorHp = 100;
 if (actor.isPlayer) G.audio.buy();
 return true;
}

export function buyGrenade(G, actor, kind) {
 const def = GRENADES[kind];
 if (!def || actor.money < def.price || actor.loadout.grenades.length >= 2) return false;
 if (actor.loadout.grenades.includes(kind)) return false;
 actor.money -= def.price;
 actor.loadout.grenades.push(kind);
 if (actor.isPlayer) G.audio.buy();
 return true;
}

// --- plant / defuse channels -------------------------------------------------

// The plant/defuse callout, throttled per bot so a churning channel
// cannot spam the radio.
function objectiveCall(G, actor, text) {
 if (!actor.bot || G.time - actor.bot.objCallAt < 8) return;
 actor.bot.objCallAt = G.time;
 G.radio.say(actor, text, true);
}

export function requestPlant(G, actor) {
 const round = G.round;
 if (round.phase !== 'live' || G.charge.state !== 'carried') return;
 if (actor.isPlayer) { if (!G.playerHasCharge) return; }
 else if (!actor.bot || !actor.bot.hasCharge) return;
 const site = siteAt(actor.pos.x, actor.pos.z);
 if (!site) return;
 if (G.channel && G.channel.actor === actor && G.channel.kind === 'plant') return;
 G.channel = { actor, kind: 'plant', t: 0, need: PLANT_TIME, site };
 objectiveCall(G, actor, 'Planting — cover me');
}

export function requestDefuse(G, actor) {
 const round = G.round;
 if (round.phase !== 'planted' || G.charge.state !== 'planted') return;
 if (Math.hypot(actor.pos.x - G.charge.x, actor.pos.z - G.charge.z) > 1.7) return;
 if (G.channel && G.channel.actor === actor && G.channel.kind === 'defuse') return;
 G.channel = { actor, kind: 'defuse', t: 0, need: DEFUSE_TIME };
 objectiveCall(G, actor, 'Defusing — cover me');
}

function stepChannel(G, dt) {
 const ch = G.channel;
 if (!ch) return;
 const actor = ch.actor;
 const moved = actor.speedNow > 0.6;
 const leftSite = ch.kind === 'plant' && !siteAt(actor.pos.x, actor.pos.z);
 const leftCharge = ch.kind === 'defuse' &&
  Math.hypot(actor.pos.x - G.charge.x, actor.pos.z - G.charge.z) > 1.7;
 if (!actor.alive || moved || leftSite || leftCharge) {
  G.channel = null;
  if (actor.isPlayer) G.hud.channel(0, '');
  return;
 }
 ch.t += dt;
 if (actor.isPlayer) G.hud.channel(ch.t / ch.need, ch.kind === 'plant' ? 'PLANTING' : 'DEFUSING');
 if (ch.kind === 'plant' && G.rng.next() < dt * 2) G.audio.plantBeep(false);
 if (ch.t >= ch.need) {
  G.channel = null;
  if (actor.isPlayer) G.hud.channel(0, '');
  if (ch.kind === 'plant') completePlant(G, actor, ch.site);
  else completeDefuse(G, actor);
 }
}

function completePlant(G, actor, site) {
 const round = G.round;
 G.charge.state = 'planted';
 G.charge.site = site;
 G.charge.x = site.plantX;
 G.charge.z = site.plantZ;
 G.charge.plantedAt = G.time;
 G.charge.mesh.position.set(site.plantX, 0, site.plantZ);
 G.charge.mesh.visible = true;
 if (actor.bot) actor.bot.hasCharge = false;
 if (actor.isPlayer) G.playerHasCharge = false;
 actor.money += AWARD.plant;
 round.phase = 'planted';
 round.phaseAt = G.time;
 round.timer = CHARGE_TIME;
 G.audio.plantBeep(true);
 G.hud.banner('CHARGE PLANTED', `Site ${site.id} — ${site.name}`, 2.2);
 G.bus.emit(site.plantX, site.plantZ, round.attack, 60, 'plant', G.time);
 // Both teams re-plan around the planted charge (bots.js): routes and
 // stale engagements drop, the defence converges, the calls are made there.
 replanOnPlant(G);
}

function completeDefuse(G, actor) {
 G.charge.state = 'defused';
 G.charge.mesh.visible = false;
 G.audio.defuseDone();
 endRound(G, defendTeam(G), 'Charge defused');
}

// The team holding the sites this half — the one not attacking.
function defendTeam(G) {
 return G.round.attack === 'ember' ? 'warden' : 'ember';
}

// --- the round clock -----------------------------------------------------------

export function stepRound(G, dt) {
 const round = G.round;
 if (round.over) return;
 round.timer -= dt;
 stepChannel(G, dt);

 if (round.phase === 'buy' && round.timer <= 0) {
  round.phase = 'live';
  round.phaseAt = G.time;
  round.timer = ROUND_TIME;
  G.hud.banner('ROUND LIVE', '', 1.4);
 } else if (round.phase === 'live') {
  if (round.timer <= 0) endRound(G, defendTeam(G), 'Time expired — site held');
 } else if (round.phase === 'planted') {
  const remain = round.timer; // the planted charge beeps faster as it runs down
  const interval = remain < 5 ? 0.25 : remain < 12 ? 0.5 : 1;
  if (G.time >= G.charge.beepAt) {
   G.charge.beepAt = G.time + interval;
   G.audio.plantBeep(remain < 1.2);
   G.charge.lightMesh.material.emissiveIntensity = 3.4;
  }
  if (round.timer <= 0) {
   detonateCharge(G);
   return;
  }
 } else if (round.phase === 'end' && round.timer <= 0) {
  if (round.score.ember >= WIN_SCORE || round.score.warden >= WIN_SCORE) {
   round.over = true;
   G.hud.matchEnd(round.score.ember > round.score.warden ? 'ember' : 'warden', round.score);
  } else {
   startRound(G);
  }
 }

 // Elimination check (not during buy: nobody can be dead yet). After a
 // plant, the attackers win even if their last player falls — the charge
 // ticks on and the defenders can still defuse it.
 if (round.phase === 'live' || round.phase === 'planted') {
  const emberAlive = G.actors.some((a) => a.team === 'ember' && a.alive);
  const wardenAlive = G.actors.some((a) => a.team === 'warden' && a.alive);
  if (!wardenAlive) endRound(G, 'ember', 'Wardens eliminated');
  else if (!emberAlive && round.phase === 'live') endRound(G, 'warden', 'Ember eliminated');
 }
}

function detonateCharge(G) {
 const charge = G.charge;
 charge.state = 'detonated';
 charge.mesh.visible = false;
 G.audio.explosion();
 G.effects.explosion({ x: charge.x, y: 0.4, z: charge.z });
 // The blast is lethal at the plant spot: anyone standing on the site dies.
 for (const actor of G.actors) {
  if (!actor.alive) continue;
  const d = Math.hypot(actor.pos.x - charge.x, actor.pos.z - charge.z);
  if (d < 4.2 && hurtActor(actor, 1000)) G.onKill(null, actor, false, null);
 }
 endRound(G, G.round.attack, 'Charge detonated');
}

function endRound(G, winner, reason) {
 const round = G.round;
 if (round.phase === 'end') return;
 round.phase = 'end';
 round.phaseAt = G.time;
 round.timer = END_TIME;
 round.winner = winner;
 round.winReason = reason;
 round.score[winner]++;
 const loser = winner === 'ember' ? 'warden' : 'ember';
 round.lossStreak[loser]++;
 round.lossStreak[winner] = 0;
 const plantedBonus = G.charge.state === 'detonated' || G.charge.state === 'planted';
 for (const actor of G.actors) {
  if (actor.team === winner) actor.money += plantedBonus && winner === round.attack ? AWARD.winPlant : AWARD.win;
  else actor.money += AWARD.loss + Math.min(3, round.lossStreak[loser] - 1) * AWARD.lossBonusStep;
  actor.money = Math.min(16000, actor.money);
 }
 G.channel = null;
 if (G.player.isPlayer) {
  if (winner === G.player.team) G.audio.roundWin(); else G.audio.roundLose();
 }
 G.hud.roundEnd(winner, reason, round.score);
 G.radio.teamSay(winner, winner === 'ember' ? 'Site is ours — round won' : 'Round ours — reset and hold');
 G.radio.teamSay(loser, 'Fall back — save what you can');
}

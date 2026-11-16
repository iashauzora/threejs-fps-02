// Foundry District — a round-based tactical FPS, five a side, one map.
// Systems: rounds/economy + a halftime side swap (rounds.js; roles read
// round.attack, and the second half plays at dusk via world setDusk), bot
// plans on a waypoint graph with mid-round re-plans (bots.js), a hearing
// bus (bus.js) feeding perception and team radio (radio.js), minimap,
// scoreboard, a living world posed from the sim clock (world.js update),
// floating damage numbers and impact sparks (effects.js), spread/recoil
// gunplay with armour penetration and three hitbox bands (weapons.js,
// actor.js). Boot, the fixed-step loop (1/60 from an accumulator; frames
// only read state), the player controller and the screenshot setups live
// here. One state object, G, is shared. ?shot=start|buy|play|end&seed=N
// composes one deterministic frame, freezes, sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRng } from './rng.js';
import { COLLIDERS, SITES, losClear as mapLos, siteAt } from './map.js';
import { createWorld, buildSoldier } from './world.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createActor, stepActor, eyePos, lookDir } from './actor.js';
import {
 WEAPONS, BUY_MENU, makeLoadout, activeInstance, fireHitscan, startReload,
 stepReloads, throwGrenade, stepGrenades, currentSpreadDeg, createViewmodel,
} from './weapons.js';
import { createBrain, stepBot } from './bots.js';
import { createBus } from './bus.js';
import { createRadio } from './radio.js';
import { createMinimap } from './minimap.js';
import { createScoreboard } from './scoreboard.js';
import {
 createMatch, startRound, stepRound, buyWeapon, buyArmor, buyGrenade,
 requestPlant, requestDefuse,
} from './rounds.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

// --- renderer / scene ---

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
camera.rotation.order = 'YXZ';
scene.add(camera);
const worldAnim = createWorld(scene); // its update(t) poses the living world

// --- the shared game state ---

const G = {
 scene, camera, renderer,
 rng: createRng(shot ? seed * 7919 + 13 : (Date.now() % 90000) + 1),
 time: 0,
 actors: [],
 player: null,
 playerEye: new THREE.Vector3(),
 effects: createEffects(scene),
 audio: createAudio(),
 hud: createHud(!!shot),
 colliders: COLLIDERS,
 grenades: [],
 bus: createBus(),       // hearing bus: all noise events (bus.js)
 spotted: new Map(),     // actorId -> {x, z, at}: team sightings for the minimap
 radio: null,            // wired just below (needs G.hud and G.audio first)
 grenadeGeo: new THREE.SphereGeometry(0.11, 10, 8),
 grenadeMats: {
  frag: new THREE.MeshStandardMaterial({ color: 0x3d4436, roughness: 0.6 }),
  flash: new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.35, metalness: 0.5 }),
 },
 plan: { site: 'A', carrier: null },
 playerHasCharge: true,
 losClear: (a, b) => mapLos(a.x, a.y, a.z, b.x, b.y, b.z),
 requestPlant: (actor) => requestPlant(G, actor),
 requestDefuse: (actor) => requestDefuse(G, actor),
 onKill: (attacker, victim, headshot, def) => onKill(attacker, victim, headshot, def),
};

G.radio = createRadio(G);
const minimap = createMinimap(G);
const scoreboard = createScoreboard(G);

// --- cast ---

const EMBER_BOTS = ['Vex', 'Ondo', 'Pell', 'Sorin'];
const WARDEN_BOTS = ['Sable', 'Rurik', 'Tamsin', 'Yara', 'Mira'];

const player = createActor('ember', 'You', true);
player.loadout = makeLoadout();
G.player = player;
G.actors.push(player);
for (const name of EMBER_BOTS) {
 const bot = createActor('ember', name, false);
 bot.loadout = makeLoadout();
 bot.bot = createBrain(bot, 'attack');
 G.actors.push(bot);
}
for (const name of WARDEN_BOTS) {
 const bot = createActor('warden', name, false);
 bot.loadout = makeLoadout();
 bot.bot = createBrain(bot, 'defend');
 G.actors.push(bot);
}
for (const actor of G.actors) {
 if (actor.isPlayer) continue;
 actor.mesh = buildSoldier(actor.team);
 scene.add(actor.mesh.group);
}

const viewmodel = createViewmodel(camera);
viewmodel.build('sidearm');
createMatch(G);

function onKill(attacker, victim, headshot, def) {
 if (attacker && attacker !== victim) {
  attacker.kills++;
  attacker.money = Math.min(16000, attacker.money + 300);
  if (attacker.isPlayer) G.audio.kill();
  if (attacker.bot) G.radio.say(attacker, headshot ? 'Target down — clean' : 'Target down');
 }
 if (victim.bot) G.spotted.delete(victim.id);
 if (victim.bot && victim.bot.hasCharge) {
  // The charge passes to the nearest living attacking bot.
  victim.bot.hasCharge = false;
  let best = null, bd = Infinity;
  for (const a of G.actors) {
   if (a.team !== G.round.attack || !a.alive || !a.bot) continue;
   const d = a.pos.distanceTo(victim.pos);
   if (d < bd) { bd = d; best = a; }
  }
  if (best) { best.bot.hasCharge = true; G.plan.carrier = best; }
 }
 const chest = new THREE.Vector3(victim.pos.x, victim.pos.y + 1.1, victim.pos.z);
 G.effects.deathPuff(chest);
 // The feed names the weapon: the firing def, the frag (def null), or
 // the charge itself (no attacker).
 const weaponName = def ? def.name : (attacker ? 'Frag Grenade' : 'Charge');
 G.hud.kill(attacker ? attacker.name : null, victim.name, headshot,
  attacker ? attacker.team : (victim.team === 'ember' ? 'warden' : 'ember'), weaponName);
}

// --- player controller ---

const input = createInput(renderer.domElement, (locked) => {
 if (!locked && started && !G.round.over && !shot) overlay.hidden = false;
});
const overlay = document.getElementById('overlay');
const weaponNameEl = document.getElementById('weapon-name');
let started = false;
let prevFiring = false;
let scoped = false;
let rightDown = false;
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 2) rightDown = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) rightDown = false; });
document.getElementById('play').addEventListener('click', () => {
 G.audio.unlock();
 overlay.hidden = true;
 if (G.round.over) restartMatch();
 started = true;
 input.requestLock();
});
document.getElementById('buy-rows').addEventListener('click', (e) => {
 const row = e.target.closest('[data-buy-index]');
 if (row) doBuy(Number(row.dataset.buyIndex));
});

function restartMatch() {
 for (const actor of G.actors) {
  actor.money = 800;
  actor.kills = 0; actor.deaths = 0;
  actor.armorHp = 0;
  actor.loadout = makeLoadout();
  actor.activeSlot = 'sidearm';
 }
 createMatch(G);
 G.playerHasCharge = true;
 lastHalf = 1;
 worldAnim.setDusk(false);
 viewmodel.build('sidearm');
 startRound(G);
}

function setSlot(slot) {
 if (!player.loadout[slot] || player.activeSlot === slot) return;
 player.activeSlot = slot;
 player.reloading = 0;
 viewmodel.build(player.loadout[slot].defId);
 refreshAmmoHud();
}

function refreshAmmoHud() {
 const inst = activeInstance(player);
 G.hud.setAmmo(inst);
 if (inst) weaponNameEl.textContent = WEAPONS[inst.defId].name;
}

function doBuy(index) {
 if (G.round.phase !== 'buy' || !player.alive) return;
 const [kind, id] = BUY_MENU[index];
 let ok = false;
 if (kind === 'weapon') {
  ok = buyWeapon(G, player, id);
  if (ok) setSlot(WEAPONS[id].slot);
 } else if (kind === 'armor') ok = buyArmor(G, player);
 else ok = buyGrenade(G, player, id);
 if (!ok) G.audio.denied();
 G.hud.showBuy(player, G.round);
 G.hud.setMoney(player.money);
}

const _wish = { x: 0, z: 0, crouch: false, walk: false, jump: false };
const _eye = new THREE.Vector3();

function stepPlayer(dt) {
 const pressed = new Set(input.peekPressed()); // copy: consumeStep clears the live set
 const step = input.consumeStep();
 if (!player.alive) return;

 const sens = scoped ? 0.00075 : 0.0021;
 player.yaw -= step.dx * sens;
 player.pitch = THREE.MathUtils.clamp(player.pitch - step.dy * sens, -1.45, 1.45);

 const phase = G.round.phase;
 // Buy keys work while the buy menu is up; B toggles it during buy phase.
 if (phase === 'buy') {
  if (pressed.has('KeyB')) {
   if (G.hud.buyVisible) G.hud.hideBuy(); else G.hud.showBuy(player, G.round);
  }
  for (let i = 0; i < BUY_MENU.length; i++) {
   if (pressed.has(`Digit${i + 1}`) && G.hud.buyVisible) doBuy(i);
  }
 }
 if (pressed.has('Tab')) scoreboard.toggle();
 if (pressed.has('KeyR')) startReload(G, player);
 if (pressed.has('Digit1')) setSlot('primary');
 if (pressed.has('Digit2')) setSlot('sidearm');
 if (pressed.has('Digit3') && player.loadout.grenades.includes('frag')) throwGrenade(G, player, 'frag');
 if (pressed.has('Digit4') && player.loadout.grenades.includes('flash')) throwGrenade(G, player, 'flash');

 // Hold E at a site to plant (attacking), or at the charge to defuse it
 // (defending — the second half, for the human) — channels live in rounds.js.
 if (input.down('KeyE') && phase === 'live' && siteAt(player.pos.x, player.pos.z)) {
  G.requestPlant(player);
 }
 if (input.down('KeyE') && phase === 'planted') {
  G.requestDefuse(player);
 }

 if (phase === 'buy' || phase === 'end') return; // frozen while shopping / celebrating

 const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
 const r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
 const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
 const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
 _wish.x = fx * f + rx * r;
 _wish.z = fz * f + rz * r;
 _wish.crouch = input.down('ControlLeft') || input.down('KeyC');
 _wish.walk = input.down('ShiftLeft');
 _wish.jump = input.down('Space');
 player.crouch = _wish.crouch;
 stepActor(player, dt, _wish);

 // Trigger: full-auto weapons fire while held; semi-autos need a fresh click.
 const inst = activeInstance(player);
 const def = inst ? WEAPONS[inst.defId] : null;
 scoped = rightDown && def && def.id === 'pike' && player.alive;
 if (def && input.firing && G.time >= player.nextShotAt && player.reloading <= 0) {
  if (def.auto || !prevFiring) {
   if (fireHitscan(G, player)) viewmodel.fire();
  }
 }
 prevFiring = input.firing;
}

// --- bot meshes ---

function poseActors() {
 for (const actor of G.actors) {
  if (!actor.mesh) continue;
  const g = actor.mesh.group;
  g.position.copy(actor.pos);
  if (!actor.alive) {
   g.rotation.set(-Math.PI / 2, 0, 0);
   g.position.y = 0.18;
   continue;
  }
  g.rotation.set(0, actor.yaw + Math.PI, 0);
  const swing = Math.sin(actor.stepPhase) * 0.55 * Math.min(1, actor.speedNow / 4);
  actor.mesh.legL.rotation.x = swing;
  actor.mesh.legR.rotation.x = -swing;
  g.position.y = Math.abs(Math.sin(actor.stepPhase)) * 0.045 * Math.min(1, actor.speedNow / 4);
  g.scale.y = actor.crouch ? 0.8 : 1;
  const isCarrier = actor.bot && actor.bot.hasCharge && G.charge.state === 'carried'; // carrier wears the charge
  if (isCarrier) {
   G.charge.mesh.visible = true;
   G.charge.mesh.position.set(actor.pos.x, 1.15, actor.pos.z);
   G.charge.mesh.rotation.y = actor.yaw + Math.PI;
  }
 }
}

// --- the fixed-step loop ---

const _botWish = { x: 0, z: 0, crouch: false, walk: false, jump: false };
let lastPhase = '';
let lastHalf = 1;

function step(dt) {
 G.time += dt;
 stepRound(G, dt);
 const phase = G.round.phase;

 // The halftime swap (rounds.js) also turns the light: the second half is
 // played at dusk, and the viewmodel follows the pistol-round reset.
 if (G.round.half !== lastHalf) {
  lastHalf = G.round.half;
  worldAnim.setDusk(lastHalf === 2);
  const inst = activeInstance(player);
  if (inst) viewmodel.build(inst.defId);
 }

 if (phase !== lastPhase) {
  lastPhase = phase;
  if (phase === 'buy' && player.alive && !shot) G.hud.showBuy(player, G.round);
  if (phase !== 'buy') G.hud.hideBuy();
 }

 // The planted charge breathes on the sim clock (presentation only).
 if (G.charge.state === 'planted') {
  const pulse = 0.5 + 0.5 * Math.sin(G.time * 7);
  G.charge.lightMesh.material.emissiveIntensity = 1.7 + pulse * 2.1;
  if (G.charge.glow) G.charge.glow.intensity = 2 + pulse * 3.5;
 }
 scoreboard.update();

 const frozen = phase === 'buy' || phase === 'end';
 if (!frozen) {
  for (const actor of G.actors) {
   if (!actor.bot || !actor.alive) continue;
   stepBot(G, actor, dt, _botWish);
   actor.crouch = _botWish.crouch;
   stepActor(actor, dt, _botWish);
  }
  stepGrenades(G, dt);
 }
 stepPlayer(dt);
 stepReloads(G, dt);

 // Bus events age out fast; bots only hear the fresh ones.
 G.bus.step(G.time);

 // Camera: the player's eyes, or a living teammate's when the player is down.
 const viewActor = player.alive ? player : (G.actors.find((a) => a.team === 'ember' && a.alive && a.bot) || player);
 eyePos(viewActor, _eye);
 camera.position.copy(_eye);
 camera.rotation.set(viewActor.pitch, viewActor.yaw, 0);
 G.playerEye.copy(_eye);
 const targetFov = scoped ? 74 / 3.2 : 74;
 if (Math.abs(camera.fov - targetFov) > 0.1) {
  camera.fov += (targetFov - camera.fov) * 0.4;
  camera.updateProjectionMatrix();
 }
 G.hud.setScope(scoped);

 // HUD state.
 G.hud.setVitals(player);
 refreshAmmoHud();
 G.hud.setMoney(player.money);
 G.hud.setClock(G.round);
 let ea = 0, wa = 0;
 for (const a of G.actors) if (a.alive) { if (a.team === 'ember') ea++; else wa++; }
 G.hud.setAlive(ea, wa);
 G.hud.setObjective(objectiveText());
 const spread = player.alive ? currentSpreadDeg(player, WEAPONS[activeInstance(player).defId]) : 0;
 G.hud.setCrosshairGap(4 + spread * 5);
 viewmodel.update(dt, player, player.reloading, scoped);
 poseActors();
}

function objectiveText() {
 const round = G.round;
 if (round.over) return '';
 if (round.phase === 'buy') return 'Buy phase — gear up';
 const attacking = player.team === round.attack;
 if (round.phase === 'planted') return `Charge planted at site ${G.charge.site.id} — ${attacking ? 'defend it' : 'defuse it'}`;
 if (round.phase === 'live') {
  return attacking ? 'Plant the charge at site A or B — or eliminate the defenders' : 'Hold the sites';
 }
 return '';
}

let accumulator = 0;
let lastTime = performance.now();
let frozenFrame = false;

function frame(now) {
 if (frozenFrame) return;
 requestAnimationFrame(frame);
 const dtMs = Math.min(100, now - lastTime);
 lastTime = now;
 if (started || shot) {
  accumulator += dtMs / 1000;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 10) {
   step(FIXED_STEP);
   accumulator -= FIXED_STEP;
   steps++;
  }
  if (steps === 10) accumulator = 0;
 }
 G.effects.update(Math.min(0.05, dtMs / 1000));
 G.hud.update();
 minimap.draw();
 worldAnim.update(G.time); // the living world is posed by the sim clock
 renderer.render(scene, camera);
}

// --- screenshot setups ---

function giveKit(actor, primaryId, money, armor) {
 actor.money = money;
 if (primaryId) { actor.loadout.primary = { defId: primaryId, mag: WEAPONS[primaryId].mag, reserve: WEAPONS[primaryId].reserve }; actor.activeSlot = 'primary'; }
 if (armor) actor.armorHp = 100;
}

function place(actor, x, z, yaw) {
 actor.pos.set(x, 0, z);
 actor.yaw = yaw;
 actor.vel.set(0, 0, 0);
}

function setupShot(name) {
 started = true;
 overlay.hidden = true; // screenshots show the game, not the menu panel
 startRound(G); // round 1, buy phase, plans assigned
 const emberBots = G.actors.filter((a) => a.team === 'ember' && a.bot);
 const wardens = G.actors.filter((a) => a.team === 'warden');

 if (name === 'start') {
  // The cover: a first-person round intro at the west mouth of mid.
  G.round.phase = 'live';
  G.round.timer = 96;
  giveKit(player, 'longarm', 800, false);
  viewmodel.build('longarm');
  place(player, -10.5, 1.8, -Math.PI / 2 + 0.18);
  player.pitch = 0.015;
  giveKit(emberBots[0], 'dart', 0, false);
  place(emberBots[0], -8.5, -3.6, -Math.PI / 2);
  place(emberBots[1], -13.5, 5.5, -Math.PI / 2);
  place(emberBots[2], -4, -3.5, -Math.PI / 2);
  place(emberBots[3], -12, 8.5, -Math.PI / 2);
  place(wardens[0], 14, -4.5, Math.PI / 2);
  place(wardens[1], 17.5, 2.5, Math.PI / 2);
  place(wardens[2], 12, -9.5, Math.PI / 2);
  place(wardens[3], 24, -14, Math.PI / 2);
  place(wardens[4], 22, 12, Math.PI / 2);
  G.spotted.set(wardens[0].id, { x: wardens[0].pos.x, z: wardens[0].pos.z, at: G.time });
  G.radio.say(emberBots[1], 'Copy — flash ready', true); // support answers the plan call
  G.hud.banner('ROUND 1', 'Foundry District — plant at the Smelter or the Depot', 30);
  const eye = new THREE.Vector3(); eyePos(player, eye);
  camera.position.copy(eye);
  camera.rotation.set(player.pitch, player.yaw, 0);
 } else if (name === 'buy') {
  // The second half's buy: sides swapped, dusk light, pistols long gone.
  G.round.half = 2;
  G.round.attack = 'warden';
  G.round.number = 9;
  G.round.score.ember = 4; G.round.score.warden = 4;
  worldAnim.setDusk(true);
  // The card and the radio must tell the same story as the light: clear
  // round 1's calls and deal the halftime card for round 9.
  G.radio.log.length = 0;
  document.getElementById('radio-log').innerHTML = '';
  G.hud.banner('ROUND 9', 'HALFTIME — sides swap · Wardens attack — hold the sites, or eliminate Ember · first to 7', 30);
  player.money = 4600;
  giveKit(emberBots[0], 'longarm', 650, true, ['frag']);
  giveKit(emberBots[1], 'dart', 650, false, ['flash']);
  giveKit(emberBots[2], 'dart', 0, false);
  giveKit(emberBots[3], 'rook', 650, false);
  place(emberBots[0], -26, -5, -Math.PI / 2);
  place(emberBots[1], -27, 3, -Math.PI / 2);
  place(emberBots[2], -24, 0.5, -Math.PI / 2);
  place(emberBots[3], -28, -1.5, -Math.PI / 2);
  G.radio.say(emberBots[0], 'Rifles out — I take point', true);
  G.hud.showBuy(player, G.round);
  camera.position.set(player.pos.x, 1.62, player.pos.z);
  camera.rotation.set(0, player.yaw, 0);
 } else if (name === 'play') {
  G.round.phase = 'live';
  G.round.timer = 63;
  G.round.number = 6;
  G.round.score.ember = 3; G.round.score.warden = 2;
  giveKit(player, 'longarm', 2350, true);
  viewmodel.build('longarm');
  player.hp = 72;
  player.loadout.primary.mag = 24; // mid-magazine, mid-fight
  G.hud.clearBanner();
  // South of the mid stack, so the sightline to the first Warden is open.
  place(player, -4.6, 3.6, -1.4);
  player.pitch = 0.01;
  const w0 = wardens[0], w1 = wardens[1];
  giveKit(w0, 'longarm', 0, true); giveKit(w1, 'dart', 0, false);
  place(w0, 5.5, 1.8, Math.PI / 2);
  place(w1, 7.5, 0.5, Math.PI / 2 - 0.3);
  w0.bot.enemy = player; w1.bot.enemy = player;
  place(emberBots[0], -0.5, 5.2, -Math.PI / 2);
  giveKit(emberBots[0], 'dart', 0, false);
  place(emberBots[1], -8.5, -1.5, -Math.PI / 2);
  place(emberBots[2], -9.5, 10.5, -Math.PI / 2);
  giveKit(emberBots[2], 'dart', 0, false);
  place(wardens[2], 16, -8, Math.PI / 2);
  place(wardens[3], 11.5, 5.2, Math.PI / 2 + 0.3);
  giveKit(wardens[3], 'dart', 0, false);
  // Both visible Wardens are spotted: the minimap shows them in red.
  G.spotted.set(w0.id, { x: w0.pos.x, z: w0.pos.z, at: G.time });
  G.spotted.set(w1.id, { x: w1.pos.x, z: w1.pos.z, at: G.time });
  G.radio.say(emberBots[1], 'Contact mid — two crossing!', true);
  G.radio.say(emberBots[0], 'Holding south — cover me', true);
  G.radio.say(wardens[0], 'Eyes on mid, engaging', true);
  // A tracer mid-flight from the player's muzzle toward w0, flash lit.
  const eye = new THREE.Vector3(); eyePos(player, eye);
  const dir = new THREE.Vector3(); lookDir(player, dir);
  const muzzle = eye.clone().addScaledVector(dir, 0.6); muzzle.y -= 0.14;
  const hit = new THREE.Vector3(w0.pos.x, 1.25, w0.pos.z);
  G.effects.tracer(muzzle, hit);
  G.effects.muzzleFlash(muzzle, dir);
  G.effects.impact(hit, true);
  // The hit reads back at a glance: a white 36 on the Warden in the
  // crosshair, an ember 104 headshot number over the second, mid-rise.
  G.effects.damageNumber(hit, 36, 'hit');
  G.effects.damageNumber(new THREE.Vector3(w1.pos.x, 1.45, w1.pos.z), 104, 'head');
  G.effects.update(0.16); // pose both numbers part-way up their rise
  G.effects.update(0.05);
  G.effects.update(0.06); // sparks settle off the first number
  G.hud.kill('You', 'Mira', false, 'ember', 'Longarm AR');
  G.hud.kill('Sable', 'Sorin', false, 'warden', 'Dart-9 SMG');
  wardens[4].alive = false; wardens[4].hp = 0;
  emberBots[3].alive = false; emberBots[3].hp = 0;
  // The fight is on the player too: a hitmarker from the shot just fired
  // and the damage wedge pointing at w0, near enough dead ahead.
  G.hud.hitmarker(false, false);
  G.hud.damageFrom(0.05);
  camera.position.copy(eye);
  camera.rotation.set(player.pitch, player.yaw, 0);
 } else if (name === 'end') {
  G.round.phase = 'end';
  G.round.score.ember = 5; G.round.score.warden = 3;
  G.round.number = 8;
  G.charge.state = 'planted'; // still on the minimap as it goes off
  G.charge.x = SITES.A.plantX; G.charge.z = SITES.A.plantZ;
  giveKit(player, 'longarm', 3900, true);
  viewmodel.build('longarm');
  place(player, 19.2, -10.2, -0.93); // facing the plant spot on site A
  player.pitch = 0.02;
  place(emberBots[0], 21, -16.5, -Math.PI / 2);
  giveKit(emberBots[0], 'longarm', 0, true);
  place(emberBots[1], 16.5, -12, -Math.PI / 2);
  place(emberBots[2], 18, -7.5, -Math.PI / 2);
  wardens[0].alive = false; wardens[0].hp = 0; place(wardens[0], 24, -13, 0);
  wardens[1].alive = false; wardens[1].hp = 0; place(wardens[1], 20.5, -18.5, 0);
  place(wardens[2], 27, -6, Math.PI / 2);
  G.effects.explosion(new THREE.Vector3(SITES.A.plantX, 0.4, SITES.A.plantZ));
  G.round.winner = 'ember';
  G.round.winReason = 'Charge detonated';
  G.hud.roundEnd('ember', 'Charge detonated', G.round.score);
  G.radio.say(emberBots[0], 'Charge planted — hold positions', true);
  G.radio.say(emberBots[1], 'Site is ours — round won', true);
  // A match's worth of scoreboard lines, not a blank table.
  const lines = [
   [player, 9, 4, 3900], [emberBots[0], 7, 5, 4100], [emberBots[1], 5, 6, 2350],
   [emberBots[2], 4, 5, 2900], [emberBots[3], 3, 6, 1800],
   [wardens[0], 6, 6, 2400], [wardens[1], 5, 6, 1950], [wardens[2], 6, 5, 3300],
   [wardens[3], 4, 5, 2600], [wardens[4], 2, 6, 1200],
  ];
  for (const [actor, k, d, money] of lines) {
   actor.kills = k; actor.deaths = d; actor.money = money;
  }
  scoreboard.update(); // phase 'end': the board shows itself
  const eye = new THREE.Vector3(); eyePos(player, eye);
  camera.position.copy(eye);
  camera.rotation.set(player.pitch, player.yaw, 0);
  G.effects.update(0.16); // let the fireball bloom before the frame freezes
  G.effects.update(0.05);
 }
 worldAnim.update(7.35); // pose the living world mid-breath for the still
 poseActors();
 G.hud.setVitals(player);
 refreshAmmoHud();
 G.hud.setMoney(player.money);
 G.hud.setClock(G.round);
 let ea = 0, wa = 0;
 for (const a of G.actors) if (a.alive) { if (a.team === 'ember') ea++; else wa++; }
 G.hud.setAlive(ea, wa);
 minimap.draw(true);
 renderer.render(scene, camera);
 renderer.render(scene, camera);
 frozenFrame = true;
 window.__shotReady = true;
}

if (shot) {
 setupShot(shot);
} else {
 startRound(G);
 requestAnimationFrame(frame);
}

// Exposed for automated playtests; the game itself never reads it.
window.__foundry = G;

window.addEventListener('resize', () => {
 camera.aspect = window.innerWidth / window.innerHeight;
 camera.updateProjectionMatrix();
 renderer.setSize(window.innerWidth, window.innerHeight);
});

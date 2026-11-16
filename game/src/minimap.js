// The HUD minimap: a top-down read of the yard on a small 2D canvas —
// collider footprints, both sites lettered, the player's team as ember
// dots, enemies only while a teammate's spotting is fresh (brains publish
// sightings to G.spotted; the player's own line of sight counts too), and
// the charge once planted. Redrawn at ~10 Hz.
import * as THREE from 'three';
import { COLLIDERS, SITES, losClear } from './map.js';
import { eyePos } from './actor.js';

const W = 184, H = 138;          // canvas pixels; map is 64 x 48 m
const SX = W / 64, SZ = H / 48;  // metres to pixels
const SPOT_FRESH = 4;            // seconds a spotting stays on the map

const _eye = new THREE.Vector3();

export function createMinimap(G) {
 const canvas = document.getElementById('minimap');
 const ctx = canvas.getContext('2d');
 let lastDraw = -1;

 function px(x) { return (x + 32) * SX; }
 function pz(z) { return (z + 24) * SZ; }

 function draw(force = false) {
  const now = performance.now();
  if (!force && now - lastDraw < 100) return;
  lastDraw = now;
  ctx.fillStyle = '#232a33';
  ctx.fillRect(0, 0, W, H);
  // Sites first (under the geometry): tinted footprints + letters.
  for (const key of ['A', 'B']) {
   const s = SITES[key];
   ctx.fillStyle = key === 'A' ? 'rgba(255,140,58,0.20)' : 'rgba(83,199,189,0.18)';
   ctx.fillRect(px(s.minX), pz(s.minZ), (s.maxX - s.minX) * SX, (s.maxZ - s.minZ) * SZ);
   ctx.fillStyle = key === 'A' ? '#ff8c3a' : '#53c7bd';
   ctx.font = 'bold 11px ui-monospace, monospace';
   ctx.fillText(key, px(s.plantX) - 3, pz(s.plantZ) + 4);
  }
  // Solid geometry as flat footprints.
  ctx.fillStyle = '#4a5058';
  for (const c of COLLIDERS) {
   ctx.fillRect(px(c.minX), pz(c.minZ), (c.maxX - c.minX) * SX, (c.maxZ - c.minZ) * SZ);
  }
  // The planted charge: a pulsing red square (wall-clock blink — the map
  // is a live read, not sim state).
  if (G.charge && G.charge.state === 'planted') {
   const blink = Math.floor(now / 400) % 2 === 0;
   ctx.fillStyle = blink ? '#ff2a1a' : '#ffb0a0';
   ctx.fillRect(px(G.charge.x) - 3, pz(G.charge.z) - 3, 6, 6);
  }
  // Enemies only while spotted: a fresh brain sighting, or the player's
  // own eyes right now.
  const player = G.player;
  eyePos(player, _eye);
  for (const a of G.actors) {
   if (a.team === player.team || !a.alive) continue;
   const seen = G.spotted.get(a.id);
   const fresh = seen && G.time - seen.at < SPOT_FRESH;
   const own = player.alive &&
    losClear(_eye.x, _eye.y, _eye.z, a.pos.x, a.pos.y + 1.4, a.pos.z);
   if (!fresh && !own) continue;
   const x = fresh ? seen.x : a.pos.x, z = fresh ? seen.z : a.pos.z;
   ctx.fillStyle = '#ff4b33';
   ctx.beginPath(); ctx.arc(px(x), pz(z), 3, 0, 7); ctx.fill();
  }
  // Teammates, then the player picked out with a facing wedge.
  for (const a of G.actors) {
   if (a.team !== player.team || !a.alive || a === player) continue;
   ctx.fillStyle = '#ff7a26';
   ctx.beginPath(); ctx.arc(px(a.pos.x), pz(a.pos.z), 2.6, 0, 7); ctx.fill();
  }
  if (player.alive) {
   const x = px(player.pos.x), z = pz(player.pos.z);
   ctx.fillStyle = '#f2ede4';
   ctx.beginPath();
   ctx.moveTo(x + -Math.sin(player.yaw) * 5, z + -Math.cos(player.yaw) * 5);
   ctx.lineTo(x + Math.cos(player.yaw) * 3.4, z + -Math.sin(player.yaw) * 3.4);
   ctx.lineTo(x - Math.cos(player.yaw) * 3.4, z + Math.sin(player.yaw) * 3.4);
   ctx.closePath(); ctx.fill();
  }
 }

 return { draw };
}

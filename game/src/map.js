// Foundry District: an original compact yard map, described as data.
// Two charge sites (A "Smelter" north-east, B "Depot" south-east), a mid band,
// north and south lanes, and vertical connectors between them, so every round
// offers at least three routes to either site. Everything solid is an
// axis-aligned box; the same list drives rendering, collision, line-of-sight
// and bot pathing, so what you see is exactly what blocks bullets and bodies.
//
// Coordinates: x runs west(-) to east(+), z north(-) to south(+), y up.
// The yard floor is the square [-32,32] x [-24,24].

export const MAP_NAME = 'Foundry District';
export const TEAM_EMBER = 'ember';   // attackers: plant the charge
export const TEAM_WARDEN = 'warden'; // defenders: stop them

// kind: 'wall' (full height steel), 'block' (building), 'crate' (timber),
// 'stack' (double crate), 'machine' (smelter iron), 'container' (depot steel).
// h is the box height; boxes under 1.35 high are cover you can see over when
// standing, everything taller blocks sight completely.
function box(minX, maxX, minZ, maxZ, h, kind) {
  return { minX, maxX, minZ, maxZ, h, kind };
}

export const COLLIDERS = [
  // Perimeter walls.
  box(-32, 32, -24, -23, 4.2, 'wall'),
  box(-32, 32, 23, 24, 4.2, 'wall'),
  box(-32, -31, -24, 24, 4.2, 'wall'),
  box(31, 32, -24, 24, 4.2, 'wall'),
  // Lane-separator buildings, north row (gaps at x -14..-6, 2..8 are doors).
  box(-22, -14, -13, -5, 3.4, 'block'),
  box(-6, 2, -13, -5, 3.4, 'block'),
  box(8, 16, -13, -5, 3.4, 'block'),
  // Lane-separator buildings, south row.
  box(-22, -14, 5, 13, 3.4, 'block'),
  box(-6, 2, 5, 13, 3.4, 'block'),
  box(8, 16, 5, 13, 3.4, 'block'),
  // Defender spawn screen: Wardens leave around its north and south ends.
  box(19, 25, -3, 3, 3.4, 'block'),
  // Smelter line on site A: three furnace housings and the furnace mouth.
  box(18.8, 21.2, -20.4, -18, 5.2, 'machine'),
  box(22.4, 24.8, -20.4, -18, 5.2, 'machine'),
  box(26, 28.4, -20.4, -18, 5.2, 'machine'),
  box(27, 30, -15.5, -12.5, 3.0, 'machine'),
  // Depot containers on site B.
  box(18, 23, 17.6, 20.2, 2.6, 'container'),
  box(24, 29, 9.6, 12.2, 2.6, 'container'),
  // Mid cover: one double stack at the centre, singles on the diagonals.
  box(-1.1, 1.1, -1.1, 1.1, 2.2, 'stack'),
  box(-8, -6.8, 1.5, 2.7, 1.1, 'crate'),
  box(5, 6.2, -2.7, -1.5, 1.1, 'crate'),
  box(11.5, 12.7, -0.6, 0.6, 1.1, 'crate'),
  // Corridor chicanes: no straight sightline runs from mid into either spawn.
  box(-13.4, -10.8, -4.1, -1.5, 1.35, 'crate'),
  box(-13.2, -11, 2.2, 4.4, 2.2, 'stack'),
  box(10.8, 13.4, 1.5, 4.1, 1.35, 'crate'),
  // North lane and site A cover.
  box(-2, -0.8, -18, -16.8, 1.1, 'crate'),
  box(10, 11.2, -15, -13.8, 1.1, 'crate'),
  box(19, 21, -16.6, -15.4, 1.1, 'crate'),
  box(24, 25.2, -12, -10.8, 2.2, 'stack'),
  box(-18, -16.8, -20, -18.8, 1.1, 'crate'),
  // South lane and site B cover.
  box(-2, -0.8, 16.8, 18, 1.1, 'crate'),
  box(10, 11.2, 13.8, 15, 1.1, 'crate'),
  box(19, 21, 15.4, 16.6, 1.1, 'crate'),
  box(24, 25.2, 10.8, 12, 1.1, 'crate'),
  box(-18, -16.8, 18.8, 20, 1.1, 'crate'),
  // Spawn-yard cover.
  box(-27, -25.8, -8, -6.8, 1.1, 'crate'),
  box(-27, -25.8, 6.8, 8, 1.1, 'crate'),
  box(26.4, 27.6, -8.6, -7.4, 1.1, 'crate'),
  box(26.4, 27.6, 7.4, 8.6, 1.1, 'crate'),
];

// Sight blockers: only boxes tall enough to hide a standing actor.
export const BLOCKERS = COLLIDERS.filter((c) => c.h >= 1.35);

export const SITES = {
  A: { id: 'A', name: 'Smelter', minX: 16.5, maxX: 30, minZ: -21.5, maxZ: -8.5, plantX: 23.5, plantZ: -13.5 },
  B: { id: 'B', name: 'Depot', minX: 16.5, maxX: 30, minZ: 8.5, maxZ: 21.5, plantX: 23.5, plantZ: 13.5 },
};

export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s;
  }
  return null;
}

// Yaw convention (actor.js): forward is (-sin yaw, -cos yaw), so Ember at the
// west edge faces east with yaw -PI/2 and the Wardens face west with +PI/2.
export const SPAWNS = {
  ember: [
    { x: -29, z: -3, yaw: -Math.PI / 2 }, { x: -29, z: -1, yaw: -Math.PI / 2 },
    { x: -29, z: 1, yaw: -Math.PI / 2 }, { x: -29, z: 3, yaw: -Math.PI / 2 },
  ],
  warden: [
    { x: 29.2, z: -6, yaw: Math.PI / 2 }, { x: 29.2, z: -2, yaw: Math.PI / 2 },
    { x: 29.2, z: 2, yaw: Math.PI / 2 }, { x: 29.2, z: 6, yaw: Math.PI / 2 },
  ],
};

// Defensive hold points and attacker staging points, per site.
export const HOLD_POINTS = {
  A: [{ x: 21.5, z: -17 }, { x: 26.5, z: -10.5 }, { x: 17.5, z: -12 }],
  B: [{ x: 21.5, z: 17 }, { x: 26.5, z: 10.5 }, { x: 17.5, z: 12 }],
  mid: [{ x: 13.5, z: -2.5 }, { x: 13.5, z: 2.5 }, { x: -3, z: 0 }],
};

// Waypoint graph nodes: lane corners, door mouths, site entries. Edges are
// derived below from straight-line clearance, so the graph can never promise
// a route through a wall.
export const WAYPOINTS = [
  [-28, 0], [-25, -8], [-25, 8], [-26, -16], [-26, 16],
  [-18, -18], [-18, 18], [-10, -17], [-10, 17], [-10, -9], [-10, 9],
  [5, -9], [5, 9], [-2, -21], [-2, 21], [8, -17], [8, 17],
  [-8, 0], [0, -3.4], [0, 3.4], [8, 0], [18, -9], [18, 9],
  [16.5, 0], [18, -13], [18, 13], [23.5, -13.5], [23.5, 13.5],
  [27.5, 18.5], [28, 0], [24, -6.5], [24, 6.5],
  [-18, -3.4], [-18, 3.4], [12, -18], [12, 18],
].map(([x, z], i) => ({ id: i, x, z, next: [] }));

const CLEARANCE = 0.55; // a walking body needs this much room from box faces

function segmentHitsBox(x1, z1, x2, z2, b, pad) {
  // 2D slab test of the segment against the padded box.
  const minX = b.minX - pad, maxX = b.maxX + pad, minZ = b.minZ - pad, maxZ = b.maxZ + pad;
  const dx = x2 - x1, dz = z2 - z1;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) { if (x1 < minX || x1 > maxX) return false; }
  else {
    let ta = (minX - x1) / dx, tb = (maxX - x1) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (z1 < minZ || z1 > maxZ) return false; }
  else {
    let ta = (minZ - z1) / dz, tb = (maxZ - z1) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export function walkClear(x1, z1, x2, z2) {
  for (const c of COLLIDERS) if (segmentHitsBox(x1, z1, x2, z2, c, CLEARANCE)) return false;
  return true;
}

for (const a of WAYPOINTS) {
  for (const b of WAYPOINTS) {
    if (a === b) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d <= 15 && walkClear(a.x, a.z, b.x, b.z)) a.next.push(b.id);
  }
}

export function nearestWaypoint(x, z) {
  let best = null, bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

// Breadth-first next hop: returns the waypoint to walk to in order to reach
// (tx,tz) from (fx,fz), or null when a straight walk already works.
export function nextHop(fx, fz, tx, tz, scratch) {
  if (walkClear(fx, fz, tx, tz)) return null;
  const from = nearestWaypoint(fx, fz);
  const to = nearestWaypoint(tx, tz);
  if (from === to) return to;
  const prev = scratch.prev;
  const seen = scratch.seen;
  prev.fill(-2); seen.fill(false);
  const queue = scratch.queue;
  let qh = 0, qt = 0;
  queue[qt++] = from.id; seen[from.id] = true; prev[from.id] = -1;
  while (qh < qt) {
    const cur = WAYPOINTS[queue[qh++]];
    if (cur === to) break;
    for (const nid of cur.next) {
      if (!seen[nid]) { seen[nid] = true; prev[nid] = cur.id; queue[qt++] = nid; }
    }
  }
  if (!seen[to.id]) return from;
  let node = to.id;
  while (prev[node] !== -1 && prev[node] !== from.id) node = prev[node];
  return WAYPOINTS[node];
}

// Full route from (fx,fz) to (tx,tz): the waypoints to walk through, in
// order. Empty when a straight walk already works or no route exists —
// callers then steer straight at the goal. Bots cache this route and follow
// it node by node: recomputing a fresh "next hop" every step from a moving
// position flips direction wherever the nearest node changes, which can pin
// a bot against nothing at all, oscillating across the boundary forever.
export function findPath(fx, fz, tx, tz, scratch) {
  if (walkClear(fx, fz, tx, tz)) return NO_PATH;
  const from = nearestWaypoint(fx, fz);
  const to = nearestWaypoint(tx, tz);
  const prev = scratch.prev;
  const seen = scratch.seen;
  prev.fill(-2); seen.fill(false);
  const queue = scratch.queue;
  let qh = 0, qt = 0;
  queue[qt++] = from.id; seen[from.id] = true; prev[from.id] = -1;
  while (qh < qt) {
    const cur = WAYPOINTS[queue[qh++]];
    if (cur === to) break;
    for (const nid of cur.next) {
      if (!seen[nid]) { seen[nid] = true; prev[nid] = cur.id; queue[qt++] = nid; }
    }
  }
  if (!seen[to.id]) return NO_PATH;
  const route = [];
  let node = to.id;
  while (node !== -1 && node !== from.id) { route.push(WAYPOINTS[node]); node = prev[node]; }
  route.reverse();
  return route;
}
const NO_PATH = [];

export function makePathScratch() {
  return {
    prev: new Int16Array(WAYPOINTS.length),
    seen: new Array(WAYPOINTS.length).fill(false),
    queue: new Int16Array(WAYPOINTS.length),
  };
}

// 3D line of sight between two eye points: blocked only by tall boxes.
// a and b are {x,y,z}-like. Low cover never blocks a standing eye line.
export function losClear(ax, ay, az, bx, by, bz) {
  for (const c of BLOCKERS) {
    if (segmentHitsBox3(ax, ay, az, bx, by, bz, c)) return false;
  }
  return true;
}

function segmentHitsBox3(ax, ay, az, bx, by, bz, b) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let t0 = 0, t1 = 1;
  // x slab
  if (Math.abs(dx) < 1e-9) { if (ax < b.minX || ax > b.maxX) return false; }
  else {
    let ta = (b.minX - ax) / dx, tb = (b.maxX - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
  }
  // y slab (box stands on the ground)
  if (Math.abs(dy) < 1e-9) { if (ay < 0 || ay > b.h) return false; }
  else {
    let ta = (0 - ay) / dy, tb = (b.h - ay) / dy;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
  }
  // z slab
  if (Math.abs(dz) < 1e-9) { if (az < b.minZ || az > b.maxZ) return false; }
  else {
    let ta = (b.minZ - az) / dz, tb = (b.maxZ - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
  }
  return true;
}

// Ray vs the solid world: nearest hit distance along a unit ray, or Infinity.
// Writes the hit point into `out` when one is given. Used by hitscan fire and
// by grenade bounces; the ground plane y=0 is included.
export function raycastWorld(ox, oy, oz, dx, dy, dz, out) {
  let best = Infinity;
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t > 0) best = t;
  }
  for (const c of COLLIDERS) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, c.minX, 0, c.minZ, c.maxX, c.h, c.maxZ);
    if (t !== -1 && t < best) best = t;
  }
  // Perimeter sky walls are colliders already; also stop rays at the yard edge.
  if (out && best !== Infinity) out.set(ox + dx * best, oy + dy * best, oz + dz * best);
  return best;
}

export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < minX || ox > maxX) return -1; }
  else {
    let ta = (minX - ox) / dx, tb = (maxX - ox) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < minY || oy > maxY) return -1; }
  else {
    let ta = (minY - oy) / dy, tb = (maxY - oy) / dy;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < minZ || oz > maxZ) return -1; }
  else {
    let ta = (minZ - oz) / dz, tb = (maxZ - oz) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1;
  }
  return t0;
}

// Circle-vs-boxes collision resolve on the ground plane. Mutates pos {x,z}
// so a body of `radius` never overlaps a collider whose top is above its feet.
export function collideXZ(pos, radius, feetY) {
  for (const c of COLLIDERS) {
    if (feetY + 0.3 >= c.h) continue; // feet are above this box: no block
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    let dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest exit.
      const left = pos.x - c.minX, right = c.maxX - pos.x;
      const top = pos.z - c.minZ, bottom = c.maxZ - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) pos.x = c.minX - radius;
      else if (m === right) pos.x = c.maxX + radius;
      else if (m === top) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  // Stay inside the yard.
  pos.x = Math.max(-30.6, Math.min(30.6, pos.x));
  pos.z = Math.max(-22.6, Math.min(22.6, pos.z));
}

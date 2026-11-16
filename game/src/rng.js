// A tiny deterministic random source (mulberry32). The whole simulation
// draws from one of these, seeded per match, so a screenshot setup with a
// fixed seed composes the exact same frame on every machine.
export function mulberry32(initialSeed) {
 let a = initialSeed | 0;
 return function next() {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

export function createRng(seed) {
 const next = mulberry32(seed);
 return {
  next,
  range(min, max) { return min + (max - min) * next(); },
  int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
  pick(list) { return list[Math.floor(next() * list.length)]; },
  chance(p) { return next() < p; },
  // A point in a cone of half-angle `spreadRad` around a unit direction,
  // written into `out` (no allocation in the firing loop).
  cone(dir, spreadRad, out) {
   const a = next() * Math.PI * 2;
   const r = Math.sqrt(next()) * spreadRad;
   // Orthonormal basis around the direction: helper axis not near-parallel
   // to dir, then tangent = helper x dir.
   const hx = Math.abs(dir.y) < 0.99 ? 0 : 1;
   const hy = Math.abs(dir.y) < 0.99 ? 1 : 0;
   let tx = hy * dir.z;
   let ty = -hx * dir.z;
   let tz = hx * dir.y - hy * dir.x;
   const tl = Math.hypot(tx, ty, tz) || 1;
   tx /= tl; ty /= tl; tz /= tl;
   // bitangent = dir x tangent
   const cx = dir.y * tz - dir.z * ty;
   const cy = dir.z * tx - dir.x * tz;
   const cz = dir.x * ty - dir.y * tx;
   const s = Math.sin(r), c = Math.cos(r);
   const px = Math.cos(a) * s, py = Math.sin(a) * s;
   out.set(
    dir.x * c + (tx * px + cx * py),
    dir.y * c + (ty * px + cy * py),
    dir.z * c + (tz * px + cz * py),
   );
   return out;
  },
 };
}

// The hearing bus: one named channel for every noise the world makes.
// Gunfire, explosions and the plant all emit here with a position, a team,
// a carry radius and the game time; bot perception reads the bus (a bot
// only reacts to fresh enemy noise inside its hearing), and the radio
// module listens on the same bus, so a loud event can also become a
// callout. Events live in one array, aged out by step() each tick.
export function createBus() {
  const events = [];
  return {
    events,
    emit(x, z, team, radius, kind, time) {
      events.push({ x, z, team, radius, kind, time });
    },
    clear() { events.length = 0; },
    step(now, maxAge = 0.5) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (now - events[i].time > maxAge) events.splice(i, 1);
      }
    },
  };
}

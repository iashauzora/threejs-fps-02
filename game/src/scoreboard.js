// The match scoreboard: all ten players — name, plan role, kills, deaths,
// money, alive state — read straight out of the records the simulation
// keeps (actor.js counts, rounds.js moves money, bots.js names roles), so
// the board can never disagree with the game. main.js calls update() once
// per step. Visibility is the board's call: automatic at round end,
// Tab by hand, manual choices forgotten at the next buy phase. Rendering
// is signature-gated on round, phase, score and every line; rows sort
// kills, then fewest deaths, then name; the dead stay on, dimmed.

function el(id) { return document.getElementById(id); }

export function createScoreboard(G) {
 const box = el('scoreboard');
 const title = el('sb-title');
 const sub = el('sb-sub');
 const rowsBox = el('sb-rows');

 let manual = null;   // null: automatic; true/false: the player's Tab choice
 let lastPhase = '';
 let lastSig = '';

 function roleOf(actor) {
  if (actor.isPlayer) return 'player';
  return actor.bot ? actor.bot.planRole : '—';
 }

 function signature() {
  const r = G.round;
  let sig = `${r.number}|${r.phase}|${r.score.ember}-${r.score.warden}|${r.winner}|${r.winReason}`;
  for (const a of G.actors) {
   sig += `|${a.name}:${roleOf(a)}:${a.kills}:${a.deaths}:${a.money}:${a.alive ? 1 : 0}`;
  }
  return sig;
 }

 // One row as HTML (fixed roster strings and numbers — safe to template).
 function rowHtml(name, role, k, d, money, state, cls) {
  return `<div class="sb-row ${cls}"><span>${name}</span><span class="num">${role}</span>` +
   `<span class="num">${k}</span><span class="num">${d}</span><span class="num">${money}</span>` +
   `<span class="st">${state}</span></div>`;
 }

 function render() {
  const r = G.round;
  title.textContent = `ROUND ${r.number} · EMBER ${r.score.ember} — ${r.score.warden} WARDENS`;
  sub.textContent = r.over
   ? 'Match over — click to play again'
   : r.phase === 'end' && r.winner
    ? `${r.winner === 'ember' ? 'Ember' : 'Wardens'} take the round — ${r.winReason}`
    : r.phase === 'planted' ? `Charge planted at site ${G.charge.site.id}`
    : 'First to 7 rounds takes the match';
  let html = '';
  for (const team of ['ember', 'warden']) {
   html += `<div class="sb-team" style="color:var(--${team})">${team === 'ember' ? 'EMBER' : 'WARDENS'} — ${team === r.attack ? 'ATTACK' : 'DEFENCE'}</div>`;
   html += rowHtml('PLAYER', 'ROLE', 'K', 'D', 'MONEY', '', 'head');
   const mates = G.actors
    .filter((a) => a.team === team)
    .sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths) || (a.name < b.name ? -1 : 1));
   for (const a of mates) {
    html += rowHtml(
     `<span class="team-${team}">${a.name}</span>`, roleOf(a), a.kills, a.deaths,
     `$${a.money}`, a.alive ? 'ALIVE' : 'DOWN', a.alive ? '' : 'dead');
   }
  }
  rowsBox.innerHTML = html;
 }

 return {
  // Tab: invert what is on screen.
  toggle() {
   const auto = G.round.phase === 'end' || G.round.over;
   manual = !(manual !== null ? manual : auto);
  },
  // Per-step housekeeping from main: a fresh buy phase clears any manual
  // choice; then show or hide, re-rendering only on a signature change.
  update() {
   const phase = G.round.phase;
   if (phase !== lastPhase) {
    if (phase === 'buy') manual = null;
    lastPhase = phase;
   }
   const visible = manual !== null ? manual : (phase === 'end' || G.round.over);
   box.hidden = !visible;
   if (!visible) return;
   const sig = signature();
   if (sig === lastSig) return;
   lastSig = sig;
   render();
  },
 };
}

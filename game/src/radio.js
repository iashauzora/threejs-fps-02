// Team radio: bots talk. Game events become short callouts — the plan call,
// first contact, the plant, a defuse in progress, a bot badly hurt, the
// round result — each a fading line in the HUD's radio log (speaker in team
// colour) with a soft squelch blip, and kept in a match log. Callouts are
// information, not decoration: a contact call names the zone the bot saw
// the enemy in, and teammates hear the same zones.
import { SITES, siteAt } from './map.js';

// Coarse zone name for a position: a site, mid, or a lane.
export function zoneName(x, z) {
  const site = siteAt(x, z);
  if (site) return `site ${site.id}`;
  if (x > 14) return z < 0 ? 'A yard' : 'B yard';
  if (Math.abs(z) < 5.5) return 'mid';
  return z < 0 ? 'north lane' : 'south lane';
}

export function siteLabel(siteId) {
  const s = SITES[siteId];
  return `${s.name} ${s.id}`;
}

export function createRadio(G) {
  const log = []; // {name, team, text, at} — the match's radio record
  return {
    log,
    // One callout from one actor. The per-actor cooldown lives on the brain
    // (bot.radioAt); scripted calls pass force=true.
    say(actor, text, force = false) {
      if (!actor) return;
      if (!force && actor.bot && G.time < actor.bot.radioAt) return;
      if (actor.bot) actor.bot.radioAt = G.time + 6;
      log.push({ name: actor.name, team: actor.team, text, at: G.time });
      if (log.length > 40) log.shift();
      G.hud.radio(actor.name, actor.team, text);
      G.audio.radioBlip();
    },
    // A callout from a whole team: spoken by its first living bot, or its
    // first bot if all are down.
    teamSay(team, text) {
      const mates = G.actors.filter((a) => a.team === team && a.bot);
      const speaker = mates.find((a) => a.alive) || mates[0];
      if (speaker) this.say(speaker, text, true);
    },
  };
}

// The heads-up display: pure DOM over the canvas. Health and armour bottom
// left, money and ammunition bottom right, the round clock and score top
// centre, a killfeed on the right (killer, weapon, victim), centre banners
// for round events, a channel bar for planting and defusing, and the buy
// menu. Two centre-screen tells serve the player mid-fight: the hitmarker
// (white for a hit, ember for a headshot, red for a kill) and the damage
// wedge — a red arc on a ring around the crosshair, rotated to the bearing
// the damage came from. The simulation calls the small setters here once
// per step; nothing reads the DOM back.
import { WEAPONS, GRENADES, ARMOR_PRICE, BUY_MENU } from './weapons.js';

function el(id) { return document.getElementById(id); }

// holdFeed (screenshot mode): feed and radio rows never expire.
export function createHud(holdFeed = false) {
  const health = el('health-value'), armor = el('armor-value');
  const healthBar = el('health-bar'), armorBar = el('armor-bar');
  const ammoMag = el('ammo-mag'), ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo'), money = el('money-value');
  const clock = el('clock'), scoreEmber = el('score-ember'), scoreWarden = el('score-warden');
  const aliveEmber = el('alive-ember'), aliveWarden = el('alive-warden');
  const feed = el('killfeed');
  const radioLog = el('radio-log');
  const banner = el('banner'), bannerTitle = el('banner-title'), bannerSub = el('banner-sub');
  const channelBox = el('channel'), channelFill = el('channel-fill'), channelLabel = el('channel-label');
  const buyMenu = el('buy-menu'), buyRows = el('buy-rows'), buyMoney = el('buy-money');
  const hitmarkerEl = el('hitmarker');
  const dmgDir = el('dmgdir'), dmgWedge = el('dmgwedge');
  const vignette = el('vignette'), flashEl = el('flashblind');
  const crosshair = el('crosshair');
  const scopeEl = el('scope');
  const objective = el('objective');

  let bannerUntil = 0;
  let hitUntil = 0;
  let dmgUntil = 0;
  let flashStrength = 0;

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setVitals(actor) {
      health.textContent = Math.ceil(actor.hp);
      armor.textContent = Math.ceil(actor.armorHp);
      healthBar.style.width = `${Math.max(0, actor.hp)}%`;
      armorBar.style.width = `${Math.max(0, actor.armorHp)}%`;
      health.classList.toggle('low', actor.hp <= 30);
    },
    setAmmo(inst) {
      if (!inst) { ammoMag.textContent = '—'; ammoReserve.textContent = ''; return; }
      ammoMag.textContent = inst.mag;
      ammoReserve.textContent = `/ ${inst.reserve}`;
      ammoBox.classList.toggle('empty', inst.mag === 0);
    },
    setMoney(v) { money.textContent = `$${v}`; },
    setClock(round) {
      clock.textContent = round.phase === 'buy' ? `BUY ${fmtTime(round.timer)}` : fmtTime(round.timer);
      clock.classList.toggle('urgent', round.phase !== 'buy' && round.timer <= 10);
      scoreEmber.textContent = round.score.ember;
      scoreWarden.textContent = round.score.warden;
    },
    setAlive(ember, warden) {
      aliveEmber.textContent = '◆'.repeat(ember) || '—';
      aliveWarden.textContent = '◆'.repeat(warden) || '—';
    },
    setObjective(text) { objective.textContent = text; },
    // One killfeed row: killer and victim in their team colours, the weapon
    // between them (⌖ = headshot). Rows stack newest-first, cap at five,
    // and fade on wall-clock timers — presentation only.
    kill(killerName, victimName, headshot, killerTeam, weaponName) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = '';
      const k = document.createElement('span');
      k.textContent = killerName ?? '💥';
      k.className = killerTeam === 'ember' ? 'team-ember' : 'team-warden';
      const mid = document.createElement('span');
      mid.textContent = weaponName
        ? (headshot ? ` ${weaponName} ⌖ ` : ` ${weaponName} ▸ `)
        : (headshot ? ' ⌖ ' : ' ▸ ');
      const v = document.createElement('span');
      v.textContent = victimName;
      v.className = killerTeam === 'ember' ? 'team-warden' : 'team-ember';
      row.append(k, mid, v);
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      if (!holdFeed) {
        setTimeout(() => row.classList.add('fade'), 3600);
        setTimeout(() => row.remove(), 4300);
      }
    },
    // One team-radio callout: speaker in team colour, text after it. Lines
    // stack newest-first under the minimap and fade like the killfeed.
    radio(name, team, text) {
      const row = document.createElement('div');
      row.className = 'radio-row';
      const who = document.createElement('span');
      who.textContent = `▸ ${name}`;
      who.className = team === 'ember' ? 'team-ember' : 'team-warden';
      const what = document.createElement('span');
      what.textContent = ` ${text}`;
      row.append(who, what);
      radioLog.prepend(row);
      while (radioLog.children.length > 4) radioLog.lastChild.remove();
      if (!holdFeed) {
        setTimeout(() => row.classList.add('fade'), 4200);
        setTimeout(() => row.remove(), 4900);
      }
    },
    banner(title, sub, seconds) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub || '';
      banner.hidden = false;
      bannerUntil = performance.now() + seconds * 1000;
    },
    clearBanner() { banner.hidden = true; bannerUntil = 0; },
    // The round intro card: round number, the running score, and the one
    // line a player needs — their side and how the round is won.
    roundIntro(number, score, sub) {
      this.banner(`ROUND ${number}`,
        sub || `Ember ${score.ember} — ${score.warden} Wardens`, 2.6);
    },
    roundEnd(winner, reason, score) {
      this.banner(winner === 'ember' ? 'EMBER TAKES THE ROUND' : 'WARDENS TAKE THE ROUND',
        `${reason} · ${score.ember} — ${score.warden}`, 4.2);
    },
    matchEnd(winner, score) {
      this.banner(winner === 'ember' ? 'EMBER WINS THE MATCH' : 'WARDENS WIN THE MATCH',
        `Final score ${score.ember} — ${score.warden} · Click to play again`, 60);
    },
    channel(frac, label) {
      channelBox.hidden = frac <= 0;
      channelFill.style.width = `${Math.round(frac * 100)}%`;
      channelLabel.textContent = label;
    },
    hitmarker(head, kill) {
      hitmarkerEl.classList.toggle('head', head);
      hitmarkerEl.classList.toggle('kill', kill);
      hitmarkerEl.classList.add('on');
      hitUntil = performance.now() + (kill ? 220 : 110);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 130);
    },
    // Directional damage: bearing is the direction the damage came FROM,
    // relative to where the player faces — 0 ahead, positive to the right
    // (weapons.js computes it from the shooter's position). The wedge is a
    // conic-gradient arc masked to a ring; rotating it by the bearing puts
    // the arc on the side the shot arrived from.
    damageFrom(bearing) {
      dmgWedge.style.transform = `rotate(${bearing}rad)`;
      dmgDir.style.opacity = '1';
      dmgUntil = performance.now() + 420;
    },
    flashBlind(seconds) {
      flashStrength = Math.max(flashStrength, Math.min(1, seconds / 2.2));
      flashEl.style.opacity = flashStrength.toFixed(2);
    },
    setScope(on) { scopeEl.hidden = !on; crosshair.style.opacity = on ? '0' : '1'; },
    setCrosshairGap(px) { crosshair.style.setProperty('--gap', `${px}px`); },
    showBuy(actor, round) {
      buyMenu.hidden = false;
      buyMoney.textContent = `$${actor.money}`;
      buyRows.innerHTML = '';
      BUY_MENU.forEach(([kind, id], i) => {
        const row = document.createElement('div');
        row.className = 'buy-row';
        let name, price, owned = false;
        if (kind === 'weapon') {
          const def = WEAPONS[id];
          name = def.name; price = def.price;
          owned = actor.loadout[def.slot]?.defId === id;
        } else if (kind === 'armor') {
          name = 'Kevlar Vest'; price = ARMOR_PRICE;
          owned = actor.armorHp >= 100;
        } else {
          const def = GRENADES[id];
          name = def.name; price = def.price;
          owned = actor.loadout.grenades.includes(id);
        }
        row.classList.toggle('owned', owned);
        row.classList.toggle('poor', !owned && actor.money < price);
        row.dataset.buyIndex = i;
        const key = document.createElement('kbd'); key.textContent = i + 1;
        const label = document.createElement('span'); label.textContent = name;
        const cost = document.createElement('span');
        cost.textContent = owned ? 'OWNED' : `$${price}`;
        row.append(key, label, cost);
        buyRows.append(row);
      });
    },
    hideBuy() { buyMenu.hidden = true; },
    get buyVisible() { return !buyMenu.hidden; },
    // Per-frame housekeeping: banner lifetime, hitmarker, damage wedge, flash decay.
    update() {
      if (!banner.hidden && performance.now() > bannerUntil) banner.hidden = true;
      if (hitmarkerEl.classList.contains('on') && performance.now() > hitUntil) {
        hitmarkerEl.classList.remove('on');
      }
      if (dmgUntil && performance.now() > dmgUntil) {
        dmgDir.style.opacity = '0';
        dmgUntil = 0;
      }
      if (flashStrength > 0) {
        flashStrength = Math.max(0, flashStrength - 0.008);
        flashEl.style.opacity = flashStrength.toFixed(2);
      }
    },
  };
}

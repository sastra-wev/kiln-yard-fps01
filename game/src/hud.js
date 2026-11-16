// hud.js — everything drawn over the canvas: vitals, ammunition, money, the round
// clock, the killfeed, banners, the plant/defuse bar, the buy menu, the
// scoreboard, the dynamic crosshair, the damage-direction ring and the minimap.
// It only reads the game state and drains the game's event queue; it never
// changes the simulation.

import { BUY_MENU, PRICES, currentSpread } from './weapons.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export class Hud {
  constructor(game, sounds) {
    this.game = game;
    this.sounds = sounds;
    this.buyOpen = false;
    this.bannerUntil = 0;
    this.hitmarkUntil = 0;
    this.hitmarkHead = false;
    this.hurtUntil = 0;
    this.hurtDirUntil = 0;
    this.el = {
      health: $('healthvalue'), healthFill: $('healthfill'), armor: $('armorline'),
      weapon: $('weaponname'), ammo: $('ammo'), money: $('money'),
      timer: $('timer'), scoreAtk: $('score-atk'), scoreDef: $('score-def'),
      aliveAtk: $('alive-atk'), aliveDef: $('alive-def'), phase: $('phase'),
      killfeed: $('killfeed'), banner: $('banner'), plantWrap: $('plantwrap'),
      plantLabel: $('plantlabel'), plantFill: $('plantfill'), bombState: $('bombstate'),
      buyMenu: $('buymenu'), buyGrid: $('buygrid'), buyMoney: $('buymoney'),
      hitmarker: $('hitmarker'), damage: $('damageflash'), scope: $('scope'),
      scoreboard: $('scoreboard'), scoreBody: $('scorebody'),
      crosshair: $('crosshair'), dmgDir: $('dmgdir'),
    };
    this.minimap = new Minimap($('minimap'), game);
    this.buildBuyGrid();
  }

  buildBuyGrid() {
    this.el.buyGrid.innerHTML = '';
    this.buyItems = new Map();
    for (const item of BUY_MENU) {
      const div = document.createElement('div');
      div.className = 'buyitem';
      div.innerHTML = `<span><span class="key">${item.key.replace('Digit', '')}</span><span class="nm">${item.label}</span><br><span class="ds">${item.desc}</span></span><span class="pr">$${PRICES[item.id]}</span>`;
      div.addEventListener('click', () => this.buy(item.id));
      this.el.buyGrid.appendChild(div);
      this.buyItems.set(item.id, div);
    }
  }

  setBuyOpen(open) {
    this.buyOpen = open;
    this.el.buyMenu.style.display = open ? 'flex' : 'none';
    if (open) this.refreshBuy();
  }

  refreshBuy() {
    const p = this.game.player;
    this.el.buyMoney.textContent = `$${p.money}`;
    this.el.money.textContent = `$${p.money}`;
    for (const item of BUY_MENU) {
      const div = this.buyItems.get(item.id);
      let owned = false;
      if (item.kind === 'weapon') owned = !!(p.weapons.primary && p.weapons.primary.def.id === item.id);
      if (item.kind === 'armor') owned = p.armor > 0;
      if (item.kind === 'frag') owned = p.frags >= 2;
      if (item.kind === 'smoke') owned = p.smokes >= 1;
      div.classList.toggle('owned', owned);
      div.classList.toggle('cant', !owned && p.money < PRICES[item.id]);
    }
  }

  buy(itemId) {
    if (this.game.applyBuy(this.game.player, itemId)) this.sounds.buy();
    else this.sounds.denied();
    this.refreshBuy();
  }

  buyKey(code) {
    const item = BUY_MENU.find((i) => i.key === code);
    if (item) this.buy(item.id);
  }

  showBanner(title, sub, seconds = 3) {
    this.el.banner.querySelector('h1').textContent = title;
    this.el.banner.querySelector('p').textContent = sub || '';
    this.el.banner.style.display = 'block';
    this.bannerUntil = performance.now() + seconds * 1000;
  }

  addKillfeed(ev) {
    const div = document.createElement('div');
    const k = ev.killer;
    const v = ev.victim;
    div.innerHTML = `<span class="${k.team}">${k.name}</span> ▸ ${ev.weapon}${ev.part === 'head' ? ' ⌖' : ''} ▸ <span class="${v.team}">${v.name}</span>`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0.35'; }, 6000);
    setTimeout(() => div.remove(), 9000);
  }

  renderScoreboard() {
    const rows = [...this.game.characters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.el.scoreBody.innerHTML = rows.map((c) =>
      `<tr><td>${c.name}${c.alive ? '' : ' †'}</td><td>${c.team === 'atk' ? 'Casters' : 'Wardens'}</td><td>${c.kills}</td><td>${c.deaths}</td><td>$${c.money}</td></tr>`).join('');
  }

  /** Drain the game's events into sounds, banners, the killfeed and flashes. */
  drainEvents() {
    const g = this.game;
    const p = g.player;
    for (const ev of g.events) {
      if (ev.type === 'kill') this.addKillfeed(ev);
      else if (ev.type === 'hitmark') {
        this.hitmarkUntil = performance.now() + 110;
        this.hitmarkHead = ev.part === 'head';
      } else if (ev.type === 'hurt') {
        this.hurtUntil = performance.now() + 320;
        // Point the damage ring at the shooter: 0 rad is dead ahead, positive is
        // clockwise (to the right), matching a CSS rotation of the ring segment.
        if (ev.from) {
          const dx = ev.from.x - p.pos.x;
          const dz = ev.from.z - p.pos.z;
          const fx = -Math.sin(p.yaw);
          const fz = -Math.cos(p.yaw);
          const rx = Math.cos(p.yaw);
          const rz = -Math.sin(p.yaw);
          const rel = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
          this.el.dmgDir.style.transform = `rotate(${rel}rad)`;
          this.hurtDirUntil = performance.now() + 700;
        }
      } else if (ev.type === 'planted') {
        this.showBanner('Charge planted', `${ev.site.name} — defend it`, 2.4);
      } else if (ev.type === 'roundEnd') {
        const won = (ev.winner === 'atk') === (p.team === 'atk');
        if (ev.matchWinner) {
          this.showBanner(
            ev.matchWinner === 'atk' ? 'CASTERS WIN THE MATCH' : 'WARDENS WIN THE MATCH',
            `Final score ${g.scoreAtk} – ${g.scoreDef}. A new match starts shortly.`,
            6,
          );
        } else {
          this.showBanner(won ? 'Round won' : 'Round lost', ev.reason, 3.2);
        }
      } else if (ev.type === 'round') {
        this.el.killfeed.innerHTML = '';
        if (ev.round > 1) this.showBanner(`Round ${ev.round}`, 'First to 9 takes the match', 1.6);
      }
    }
    g.events.length = 0;
  }

  /** Refresh every readout from the game state. Called once per rendered frame. */
  frame() {
    const g = this.game;
    const p = g.player;
    this.drainEvents();

    this.el.health.textContent = Math.max(0, Math.round(p.health));
    this.el.healthFill.style.width = `${Math.max(0, p.health)}%`;
    this.el.healthFill.style.background = p.health <= 30 ? '#c33d21' : 'var(--accent)';
    this.el.armor.textContent = p.armor > 0 ? 'ARMOR ▮▮▮ VEST + HELM' : 'ARMOR — NONE';

    const w = p.weapon;
    this.el.weapon.textContent = w.def.name + (p.hasBomb ? ' · CARRYING THE CHARGE' : '');
    const lowAmmo = !w.reloading && w.mag <= Math.max(2, w.def.mag * 0.25);
    this.el.ammo.innerHTML = `${w.mag} <small>/ ${w.reserve === Infinity ? '∞' : w.reserve}${w.reloading ? ' · RELOADING' : ''}</small>`;
    this.el.ammo.style.color = lowAmmo ? '#e86a4a' : 'var(--ink)';
    this.el.money.textContent = `$${p.money}`;

    const clock = g.phase === 'planted' ? g.bomb.timer : g.phaseT;
    this.el.timer.textContent = fmtTime(clock);
    this.el.timer.style.color = (g.phase === 'live' && clock < 11) || g.phase === 'planted' ? '#e86a4a' : 'var(--ink)';
    this.el.scoreAtk.querySelector('b').textContent = g.scoreAtk;
    this.el.scoreDef.querySelector('b').textContent = g.scoreDef;
    this.el.aliveAtk.textContent = `${g.aliveCount('atk')} alive`;
    this.el.aliveDef.textContent = `${g.aliveCount('def')} alive`;
    this.el.phase.textContent =
      g.phase === 'buy' ? `Round ${g.round} · buy phase — B for the shop` :
      g.phase === 'live' ? (p.hasBomb ? 'Plant the charge at A or B — hold E in a site' : `Round ${g.round}`) :
      g.phase === 'planted' ? '' :
      g.phase === 'end' ? (g.matchWinner ? 'Match over' : 'Round over') : '';

    if (g.phase === 'planted' && g.bomb.site) {
      this.el.bombState.style.display = 'block';
      this.el.bombState.textContent = `⚠ CHARGE PLANTED AT ${g.bomb.site.id} — ${g.bomb.site.name.toUpperCase()} — ${fmtTime(g.bomb.timer)}`;
    } else {
      this.el.bombState.style.display = 'none';
    }

    // Plant / defuse progress — the two channels that decide rounds.
    if (g.plantChannel > 0 && g.plantingChar === p) {
      this.el.plantWrap.style.display = 'block';
      this.el.plantLabel.textContent = 'Planting the charge';
      this.el.plantFill.style.width = `${Math.min(100, g.plantChannel / 3 * 100)}%`;
    } else if (g.defuseChannel > 0) {
      this.el.plantWrap.style.display = 'block';
      this.el.plantLabel.textContent = 'A Warden is defusing';
      this.el.plantFill.style.width = `${Math.min(100, g.defuseChannel / 5 * 100)}%`;
    } else {
      this.el.plantWrap.style.display = 'none';
    }

    // The crosshair breathes with the gun: its gap IS the current spread, so a
    // player can see accuracy instead of guessing it. Hidden while scoped (the
    // scope overlay replaces it) and while dead.
    const spread = currentSpread(p);
    const gap = 5 + spread * 1500;
    this.el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    this.el.crosshair.style.opacity = p.alive && !p.scoped ? '1' : '0';

    // Overlays with lifetimes.
    const now = performance.now();
    if (this.bannerUntil && now > this.bannerUntil) {
      this.el.banner.style.display = 'none';
      this.bannerUntil = 0;
    }
    this.el.hitmarker.style.opacity = now < this.hitmarkUntil ? '1' : '0';
    this.el.hitmarker.style.color = this.hitmarkHead ? '#e86a4a' : '#fff';
    this.el.damage.style.opacity = now < this.hurtUntil
      ? String(0.25 + 0.75 * (this.hurtUntil - now) / 320)
      : '0';
    this.el.dmgDir.style.opacity = now < this.hurtDirUntil ? '0.9' : '0';
    this.el.scope.style.display = p.scoped && p.alive ? 'block' : 'none';
    this.minimap.draw();
    if (this.buyOpen) this.refreshBuy();
  }
}

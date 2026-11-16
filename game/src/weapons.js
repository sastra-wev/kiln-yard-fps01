// weapons.js — the gun model: definitions, per-weapon live state, the hitscan shot,
// the damage falloff, and thrown grenades. One model serves the player and every bot,
// so a duel is decided by position and nerve, never by whose code path is kinder.
//
// The tactical rules the numbers encode:
//   - The head pays four times the body on the automatics. Aim high or lose.
//   - Spread is honest standing still and blooms while you move (moveSpread), while
//     you spray (recoil heat), and worst of all while airborne — so the game rewards
//     the stop-crouch-shoot rhythm instead of run-and-gun.
//   - Damage is whole at point blank, then fades with distance toward `falloff`.

import * as THREE from 'three';
import { rayHitWalls } from './map.js';

// tracer: colour of the gun's tracer streaks. kick: view punch (radians) per shot.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    damage: 26, headMult: 4, rpm: 340, auto: false,
    mag: 12, reserve: Infinity, reloadTime: 1.1,
    spread: 0.011, moveSpread: 2.4, recoil: 0.011, kick: 0.012,
    range: 42, falloff: 0.55, speed: 4.6, pellets: 1, sound: 'pistol',
    tracer: 0xffd9a0,
  },
  smg: {
    id: 'smg', name: 'Viper SMG', slot: 'primary', price: 1500,
    damage: 22, headMult: 4, rpm: 800, auto: true,
    mag: 30, reserve: 90, reloadTime: 1.9,
    spread: 0.017, moveSpread: 2.0, recoil: 0.007, kick: 0.007,
    range: 34, falloff: 0.5, speed: 4.9, pellets: 1, sound: 'smg',
    tracer: 0xffc37a,
  },
  rifle: {
    id: 'rifle', name: 'KR-7 Rifle', slot: 'primary', price: 2700,
    damage: 34, headMult: 4, rpm: 600, auto: true,
    mag: 30, reserve: 90, reloadTime: 2.3,
    spread: 0.008, moveSpread: 2.6, recoil: 0.013, kick: 0.014,
    range: 60, falloff: 0.7, speed: 4.35, pellets: 1, sound: 'rifle',
    tracer: 0xffb36b,
  },
  sniper: {
    id: 'sniper', name: 'Longshot', slot: 'primary', price: 4750,
    damage: 110, headMult: 2, rpm: 42, auto: false,
    mag: 5, reserve: 25, reloadTime: 3.1,
    spread: 0.055, moveSpread: 3.2, recoil: 0.05, kick: 0.06,
    range: 120, falloff: 0.95, speed: 3.9, pellets: 1, sound: 'sniper',
    scopedSpread: 0.0006, scope: true, tracer: 0xfff1cf,
  },
};

// The buy menu, in key order; `kind` is what Game.applyBuy switches on.
export const BUY_MENU = [
  { key: 'Digit1', kind: 'weapon', id: 'smg', label: 'Viper SMG', desc: 'Fast, close-range shredder' },
  { key: 'Digit2', kind: 'weapon', id: 'rifle', label: 'KR-7 Rifle', desc: 'The all-round rifle' },
  { key: 'Digit3', kind: 'weapon', id: 'sniper', label: 'Longshot', desc: 'One shot, scoped, bolt-action' },
  { key: 'Digit4', kind: 'armor', id: 'armor', label: 'Kevlar vest + helm', desc: 'Halves body damage taken' },
  { key: 'Digit5', kind: 'frag', id: 'frag', label: 'Frag grenade', desc: '90 damage at the core' },
  { key: 'Digit6', kind: 'smoke', id: 'smoke', label: 'Smoke grenade', desc: '12 s of blind ground' },
  { key: 'Digit7', kind: 'ammo', id: 'ammo', label: 'Reserve ammo', desc: 'Refill every magazine' },
];

export const PRICES = {
  smg: 1500, rifle: 2700, sniper: 4750,
  armor: 650, frag: 300, smoke: 200, ammo: 150,
};

/**
 * One shooter's live weapon: definition plus magazine, reserve, cooldown, reload
 * timer and recoil heat. Heat is the spray tax: each shot adds the definition's
 * `recoil`, it bleeds off in about a third of a second, and spread grows with it —
 * bursts stay honest, mag-dumps wander.
 */
export class WeaponState {
  constructor(def) {
    this.def = def;
    this.mag = def.mag;
    this.reserve = def.reserve;
    this.cooldown = 0;   // seconds until the next shot may leave
    this.reloadLeft = 0;  // seconds until the reload lands; 0 = not reloading
    this.recoilHeat = 0;  // accumulated spray, feeds currentSpread
  }

  get reloading() { return this.reloadLeft > 0; }

  /** 0..1 reload progress, for the view model's dip. */
  get reloadProgress() {
    return this.reloading ? 1 - this.reloadLeft / this.def.reloadTime : 0;
  }

  /** Start a reload when one is possible and needed. True when it started. */
  startReload() {
    if (this.reloading || this.mag >= this.def.mag || this.reserve <= 0) return false;
    this.reloadLeft = this.def.reloadTime;
    return true;
  }

  /** Top the reserve back up to the definition's full amount (buy menu, ammo line). */
  refillReserve() { this.reserve = this.def.reserve; }

  step(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoilHeat = Math.max(0, this.recoilHeat - dt * 3.2);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        const take = Math.min(this.def.mag - this.mag, this.reserve);
        this.mag += take;
        if (this.reserve !== Infinity) this.reserve -= take;
        this.reloadLeft = 0;
      }
    }
  }
}

/**
 * The spread, in radians, of `shooter`'s next shot. Shared by the shot itself and by
 * the HUD crosshair, so the gap you see is the cone you get. The Longshot is the
 * exception that teaches the rule: pinpoint while scoped, hopeless while not.
 */
export function currentSpread(shooter) {
  const state = shooter.weapon;
  const def = state.def;
  if (def.scope && shooter.scoped) return def.scopedSpread;
  let s = def.spread;
  const pace = Math.hypot(shooter.vel.x, shooter.vel.z);
  if (pace > 0.6) s *= 1 + (def.moveSpread - 1) * Math.min(1, pace / 4.6);
  if (!shooter.grounded) s *= 4;
  if (shooter.crouching) s *= 0.62;
  s *= 1 + state.recoilHeat * 1.6;
  return s;
}

const _dir = new THREE.Vector3();
const _point = new THREE.Vector3();

/**
 * Fire one hitscan shot for `shooter`, from eye point `from` along unit vector `aim`.
 * The aim is scattered inside the current spread cone, then raced against every
 * character's head and body boxes and the map's walls; the nearest hit wins.
 * Returns { kind: 'head'|'body'|'wall'|'none', point, dist, target, dir }.
 * Damage is the caller's to apply (shotDamage) — one model for every shooter.
 */
export function fireHitscan(shooter, from, aim, characters) {
  const spread = currentSpread(shooter);
  _dir.copy(aim);
  // Scatter: three small random tilts, then renormalise. Preallocated vectors only.
  _dir.x += (Math.random() * 2 - 1) * spread;
  _dir.y += (Math.random() * 2 - 1) * spread;
  _dir.z += (Math.random() * 2 - 1) * spread;
  _dir.normalize();

  const wallDist = rayHitWalls(from, _dir, 160);
  let best = wallDist;
  let bestChar = null;
  let bestPart = null;
  for (const c of characters) {
    if (c === shooter || !c.alive) continue;
    for (const part of ['head', 'body']) {
      const t = rayVsBox(from, _dir, part === 'head' ? c.headBox : c.bodyBox);
      if (t !== null && t < best) { best = t; bestChar = c; bestPart = part; }
    }
  }

  _point.copy(from).addScaledVector(_dir, best);
  if (bestChar) return { kind: bestPart, point: _point.clone(), dist: best, target: bestChar, dir: _dir.clone() };
  if (wallDist < Infinity) return { kind: 'wall', point: _point.clone(), dist: wallDist, target: null, dir: _dir.clone() };
  return { kind: 'none', point: _point.clone(), dist: best, target: null, dir: _dir.clone() };
}

/** Ray vs one hit box ({ minX..maxZ }); entry distance, or null for a miss. */
function rayVsBox(origin, dir, box) {
  const lo = { x: box.minX, y: box.minY, z: box.minZ };
  const hi = { x: box.maxX, y: box.maxY, z: box.maxZ };
  let tmin = 0;
  let tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < lo[axis] || o > hi[axis]) return null;
    } else {
      let t1 = (lo[axis] - o) / d;
      let t2 = (hi[axis] - o) / d;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/**
 * Damage of a connecting shot. Full inside 45% of `range`, then a slide toward the
 * `falloff` floor. Kevlar halves a body shot and takes a quarter off a headshot —
 * a helmeted head still loses to two clean hits, which keeps the head king.
 */
export function shotDamage(def, part, dist, victim) {
  const fadeStart = def.range * 0.45;
  const fall = dist <= fadeStart
    ? 1
    : Math.max(def.falloff, 1 - (dist - fadeStart) / def.range);
  let dmg = def.damage * fall * (part === 'head' ? def.headMult : 1);
  if (victim.armor > 0) dmg *= part === 'head' ? 0.75 : 0.5;
  return Math.round(dmg);
}

/**
 * A thrown grenade: a gravity arc, one honest bounce, then it settles and the fuse
 * runs out wherever it lies. `justBounced` is true for exactly the step the bounce
 * lands on, so the game can play the clatter without the grenade owning a sound bank.
 */
export class Grenade {
  constructor(kind, from, dir, power) {
    this.kind = kind; // 'frag' | 'smoke'
    this.pos = from.clone();
    this.vel = dir.clone().multiplyScalar(power);
    this.vel.y += 3.2; // the lob every throw gets
    this.fuse = kind === 'frag' ? 1.5 : 1.1;
    this.settled = false;
    this.dead = false;
    this.bounced = false;
    this.justBounced = false;
  }

  step(dt) {
    if (this.dead) return;
    this.justBounced = false;
    if (!this.settled) {
      this.vel.y -= 16 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= 0.25) {
        this.pos.y = 0.25;
        if (Math.abs(this.vel.y) > 2 && !this.bounced) {
          this.vel.y *= -0.35;
          this.vel.x *= 0.6;
          this.vel.z *= 0.6;
          this.bounced = true;
          this.justBounced = true;
        } else {
          this.settled = true;
          this.vel.set(0, 0, 0);
        }
      }
      // The yard walls are the only bounce a grenade this size needs.
      this.pos.x = Math.max(-31.5, Math.min(31.5, this.pos.x));
      this.pos.z = Math.max(-23.5, Math.min(23.5, this.pos.z));
    }
    this.fuse -= dt;
    if (this.fuse <= 0) this.dead = true;
  }
}

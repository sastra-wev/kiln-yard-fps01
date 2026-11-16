// bots.js — the nine AI fighters. Each bot runs the loop a player runs: perceive,
// decide, move, shoot — through the same Character physics and the same gunplay
// model, so a bot that fires on the move sprays exactly like a player would.
//
// Perception is a vision cone plus line of sight plus hearing: gunfire is a noise
// event on the game, and a bot that hears a shot turns toward it. Plans come from
// game.js each round and carry squad roles, because teams win rounds, not bots:
//   attackers — an entry pair that takes the site, a support who trades behind
//     them, and a lurk who works the far lane late and quiet;
//   defenders — anchors who own a site each, and a rotator in mid who answers
//     noise and the plant call.
// After a plant the defenders stage at the rally node outside the site and push
// the charge together — one defuses, the rest hold the doors — and the attackers
// fall back to post-plant angles and converge the moment a defuse starts.

import { NODES, nearestNode, nextHop } from './map.js';

const TURN_RATE = 3.4;  // rad/s while navigating
const AIM_RATE = 6.5;   // rad/s while engaging
const PERCEIVE_EVERY = 0.12;
const SIGHT_RANGE = 62;
const HEAR_RANGE = 26;
const MEMORY = 4;       // seconds a last-seen position stays worth chasing

function yawToward(from, to) { return Math.atan2(-(to.x - from.x), -(to.z - from.z)); }
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// Post-plant cover, per site: the angles an attacker watches the charge from.
const POST_PLANT = {
  A: ['a_hold1', 'a_hold2', 'a_door'],
  B: ['b_hold1', 'b_hold2', 'b_door'],
};

export class BotMind {
  constructor(character, skill = 1) {
    this.c = character;
    this.skill = skill; // reaction/aim multiplier; varied per bot so fights are not metronomes
    this.plan = { route: [], role: 'anchor', holdNode: null };
    this.routeIndex = 0;
    this.state = 'advance';
    this.perceiveT = Math.random() * PERCEIVE_EVERY;
    this.visible = null;    // the enemy currently in the bot's sights
    this.lastSeen = null;   // { x, z, at } — memory of the last contact or noise
    this.seenFor = 0;       // seconds the current target has been tracked
    this.burstLeft = 0;
    this.burstPause = 0;
    this.strafeDir = 1;
    this.aimPitch = 0;
    this.stuckT = 0;
    this.lastX = 0;
    this.lastZ = 0;
    this.scanYaw = character.yaw;
    this.scanT = 0;
    this.nodeWait = 0;      // lurk's pause at each node
    this.threwSmoke = false;
    this.threwFrag = false;
    this.rallyAt = 0;       // game time this bot reached its retake rally node
    this.rallyPushed = false;
  }

  setPlan(plan) {
    this.plan = plan;
    this.routeIndex = 0;
    this.state = plan.role === 'anchor' || plan.role === 'rotate' ? 'hold' : 'advance';
    this.lastSeen = null;
    this.visible = null;
    this.threwSmoke = false;
    this.threwFrag = false;
    this.rallyAt = 0;
    this.rallyPushed = false;
    this.nodeWait = 0;
  }

  step(dt, game, canAct) {
    const c = this.c;
    if (!c.alive) return;
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = PERCEIVE_EVERY;
      this.perceive(game);
    }
    if (!canAct) { c.move(dt, { x: 0, z: 0 }, 0, false); return; }

    const now = game.time;
    // State selection, most urgent first: a visible enemy outranks every plan.
    if (this.visible) this.state = 'engage';
    else if (this.state === 'engage') {
      this.state = this.lastSeen && now - this.lastSeen.at < MEMORY
        ? 'seek'
        : (this.plan.role === 'anchor' || this.plan.role === 'rotate' ? 'hold' : 'advance');
    }
    if (game.phase === 'planted') {
      if (c.team === 'def') this.state = this.visible ? 'engage' : 'retake';
      else if (this.state !== 'engage') this.state = 'holdsite';
    }

    // A dropped charge outranks the plan: the nearest living Caster goes back for
    // it while the rest fight. (stepBombPickup re-plans him as entry on pickup.)
    if (this.state === 'fetch' && game.bomb.state !== 'dropped') {
      this.state = this.plan.role === 'anchor' || this.plan.role === 'rotate' ? 'hold' : 'advance';
    }
    if (game.bomb.state === 'dropped' && c.team === 'atk' && this.state !== 'engage') {
      if (this.nearestToBomb(game)) this.state = 'fetch';
    }

    switch (this.state) {
      case 'engage': this.doEngage(dt, game); break;
      case 'fetch': this.moveToward(dt, game.bomb.pos, game, true); break;
      case 'seek': this.moveToward(dt, this.lastSeen, game, true); break;
      case 'retake': this.doRetake(dt, game); break;
      case 'holdsite': this.doHoldSite(dt, game); break;
      case 'hold': this.doHold(dt, game); break;
      default: this.doAdvance(dt, game);
    }
  }

  perceive(game) {
    const c = this.c;
    let best = null;
    let bestDist = Infinity;
    for (const e of game.characters) {
      if (e.team === c.team || !e.alive) continue;
      const d = game.distanceTo(c, e);
      if (d > SIGHT_RANGE) continue;
      if (!game.canSee(c, e)) continue;
      if (d < bestDist) { bestDist = d; best = e; }
    }
    if (best) {
      if (this.visible !== best) this.seenFor = 0;
      this.visible = best;
      this.lastSeen = { x: best.pos.x, z: best.pos.z, at: game.time };
      // Contact is team information: the squad's shared picture updates.
      game.spotted.set(best, game.time);
      return;
    }
    this.visible = null;
    // Hearing: a recent shot near enough becomes a place worth watching or checking.
    const noise = game.recentNoise(c.pos, HEAR_RANGE);
    if (noise && (!this.lastSeen || game.time - this.lastSeen.at > 2.5)) {
      this.lastSeen = { x: noise.x, z: noise.z, at: game.time };
      if (this.state === 'hold') this.scanYaw = yawToward(c.pos, noise);
    }
  }

  doEngage(dt, game) {
    const c = this.c;
    const e = this.visible;
    this.seenFor += dt;
    // Aim walks up the body as the bot settles: chest first, head once it is sure.
    // Turn fast, stand still to fire, strafe between bursts — the spread model
    // rewards exactly the discipline it rewards in a player.
    const settle = Math.min(1, this.seenFor / 0.7);
    const aimY = e.pos.y + (e.crouching ? 0.85 : 1.12) + settle * 0.32;
    const dx = e.pos.x - c.pos.x;
    const dz = e.pos.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(aimY - (c.pos.y + c.eyeHeight), dist);
    const turn = AIM_RATE * dt;
    c.yaw += Math.max(-turn, Math.min(turn, angDiff(wantYaw, c.yaw)));
    this.aimPitch += Math.max(-turn, Math.min(turn, angDiff(wantPitch, this.aimPitch)));
    const wobble = (1.4 - settle) / this.skill;
    c.pitch = this.aimPitch + (Math.random() - 0.5) * 0.012 * wobble;
    c.yaw += (Math.random() - 0.5) * 0.01 * wobble;
    c.crouching = dist > 16 && settle > 0.5;

    if (this.burstPause > 0) {
      // Between bursts: a short counter-strafe so the bot is no sitting silhouette,
      // stopping dead the moment the next burst starts.
      this.burstPause -= dt;
      const px = Math.cos(c.yaw) * this.strafeDir;
      const pz = -Math.sin(c.yaw) * this.strafeDir;
      c.move(dt, { x: px, z: pz }, c.weapon.def.speed * 0.55, false);
    } else {
      c.move(dt, { x: 0, z: 0 }, 0, false);
    }

    // Fire control: a human reaction delay, then bursts of 3–5 and a thinking pause.
    if (this.seenFor < 0.32 / this.skill) return;
    if (c.weapon.reloading) return;
    if (c.weapon.mag === 0) {
      if (c.weapon.startReload()) game.onReloadStart(c);
      return;
    }
    if (this.burstPause > 0) return;
    if (this.burstLeft <= 0) this.burstLeft = 3 + Math.floor(Math.random() * 3);
    if (game.tryFire(c)) {
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        this.burstPause = 0.34 + Math.random() * 0.3;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
    }
    // A nearly-dry magazine gets topped up in the pause, not mid-duel at zero.
    if (c.weapon.mag <= 4 && Math.random() < 0.3) {
      if (c.weapon.startReload()) game.onReloadStart(c);
    }
  }

  doAdvance(dt, game) {
    const c = this.c;
    const route = this.plan.route;
    if (this.routeIndex >= route.length) {
      // Arrived: the carrier plants; everyone else takes a hold posture on site.
      if (c.hasBomb) { game.botPlant(this); return; }
      this.state = 'hold';
      this.doHold(dt, game);
      return;
    }
    // The support trails the entry: never crowd the man in front, never lag so far
    // the trade is gone. The lurk walks quiet and pauses to listen at each node.
    if (this.plan.role === 'support' && this.teammateAhead(game, 5)) {
      c.move(dt, { x: 0, z: 0 }, 0, false);
      return;
    }
    const nodeId = route[this.routeIndex];
    const [nx, nz] = NODES[nodeId];
    if (Math.hypot(nx - c.pos.x, nz - c.pos.z) < 1.6) {
      this.routeIndex++;
      if (this.plan.role === 'lurk') this.nodeWait = 1.1 + Math.random() * 0.8;
      return;
    }
    if (this.nodeWait > 0) {
      this.nodeWait -= dt;
      c.crouching = true;
      c.move(dt, { x: 0, z: 0 }, 0, false);
      return;
    }
    // One graph hop at a time, from wherever the bot actually stands.
    const here = nearestNode(c.pos.x, c.pos.z);
    const hop = here === nodeId ? nodeId : nextHop(here, nodeId);
    const [hx, hz] = NODES[hop];
    this.moveToward(dt, { x: hx, z: hz }, game, this.plan.role === 'lurk');
    // A smoke across mid covers the crossing, once a round.
    if (!this.threwSmoke && c.smokes > 0 && Math.abs(c.pos.z) < 9 && Math.abs(c.pos.x) < 9) {
      this.threwSmoke = true;
      game.throwGrenade(c, 'smoke', { x: c.pos.x * 0.4, z: -6 });
    }
    // The entry frags a remembered contact near the site door instead of walking in dry.
    if (!this.threwFrag && c.frags > 0 && this.plan.role === 'entry'
        && this.lastSeen && game.time - this.lastSeen.at < MEMORY
        && Math.hypot(this.lastSeen.x - c.pos.x, this.lastSeen.z - c.pos.z) < 14) {
      this.threwFrag = true;
      game.throwGrenade(c, 'frag', this.lastSeen);
    }
  }

  /** True when this bot is the living Caster closest to the dropped charge. */
  nearestToBomb(game) {
    const c = this.c;
    const mine = Math.hypot(game.bomb.pos.x - c.pos.x, game.bomb.pos.z - c.pos.z);
    for (const other of game.characters) {
      if (other === c || !other.alive || other.team !== c.team) continue;
      if (Math.hypot(game.bomb.pos.x - other.pos.x, game.bomb.pos.z - other.pos.z) < mine) return false;
    }
    return true;
  }

  /** True when a teammate is within `dist` metres roughly along this bot's route. */
  teammateAhead(game, dist) {
    const c = this.c;
    for (const other of game.characters) {
      if (other === c || !other.alive || other.team !== c.team) continue;
      if (game.distanceTo(c, other) < dist) return true;
    }
    return false;
  }

  doHold(dt, game) {
    const c = this.c;
    // The rotator answers information: a heard fight on a site pulls him off mid
    // toward that site's door before the plant ever happens.
    if (this.plan.role === 'rotate' && this.lastSeen && game.time - this.lastSeen.at < MEMORY
        && Math.abs(this.lastSeen.x) > 10) {
      const door = this.lastSeen.x < 0 ? 'a_door' : 'b_door';
      const hop = nextHop(nearestNode(c.pos.x, c.pos.z), door);
      const [hx, hz] = NODES[hop];
      this.moveToward(dt, { x: hx, z: hz }, game, true);
      return;
    }
    const holdId = this.plan.holdNode;
    if (holdId && NODES[holdId]) {
      const [hx, hz] = NODES[holdId];
      const dist = Math.hypot(hx - c.pos.x, hz - c.pos.z);
      if (dist > 6) {
        // Far away: walk the graph, not a straight line through walls.
        const hop = nextHop(nearestNode(c.pos.x, c.pos.z), holdId);
        const [px, pz] = NODES[hop];
        this.moveToward(dt, { x: px, z: pz }, game, false);
        return;
      }
      if (dist > 1.8) { this.moveToward(dt, { x: hx, z: hz }, game, false); return; }
    }
    // Settled: crouch behind the angle and scan slowly across the approach. The
    // scan bias alternates by bot id, so two anchors on one site cross their fire
    // instead of staring down the same line.
    c.crouching = true;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 1.6 + Math.random() * 1.6;
      const bias = (c.id % 2 === 0 ? 1 : -1) * 0.45;
      this.scanYaw = c.yaw + bias + (Math.random() - 0.5) * 1.1;
    }
    c.yaw += Math.max(-1.1 * dt, Math.min(1.1 * dt, angDiff(this.scanYaw, c.yaw)));
    c.pitch = 0;
    c.move(dt, { x: 0, z: 0 }, 0, false);
    if (c.weapon.mag < c.weapon.def.mag * 0.5 && c.weapon.startReload()) game.onReloadStart(c);
  }

  doHoldSite(dt, game) {
    // Attackers after the plant: fall back to a post-plant angle and watch the
    // charge — but a defuse in progress is the emergency: converge and stop it.
    const c = this.c;
    const bomb = game.bomb;
    let defusing = false;
    for (const e of game.characters) {
      if (e.team === c.team || !e.alive) continue;
      if (Math.hypot(e.pos.x - bomb.pos.x, e.pos.z - bomb.pos.z) < 1.6) { defusing = true; break; }
    }
    if (defusing) {
      const d = Math.hypot(bomb.pos.x - c.pos.x, bomb.pos.z - c.pos.z);
      if (d > 2.5) { this.moveToward(dt, bomb.pos, game, true); return; }
    }
    const siteId = bomb.site ? bomb.site.id : (bomb.pos.x < 0 ? 'A' : 'B');
    const spots = POST_PLANT[siteId];
    const spot = spots[c.id % spots.length];
    const [sx, sz] = NODES[spot];
    if (Math.hypot(sx - c.pos.x, sz - c.pos.z) > 2.2) {
      const hop = nextHop(nearestNode(c.pos.x, c.pos.z), spot);
      const [hx, hz] = NODES[hop];
      this.moveToward(dt, { x: hx, z: hz }, game, false);
      return;
    }
    // On the angle: hold, facing the charge.
    c.crouching = true;
    c.yaw += Math.max(-1.4 * dt, Math.min(1.4 * dt, angDiff(yawToward(c.pos, bomb.pos), c.yaw)));
    c.pitch = 0;
    c.move(dt, { x: 0, z: 0 }, 0, false);
  }

  doRetake(dt, game) {
    // Defenders after the plant: stage at the rally node outside the planted site
    // and push together instead of trickling in one by one. On the push, the first
    // bot to the charge smokes it (cover to defuse in), the nearest defuses, and
    // the rest stop short and hold the doors.
    const c = this.c;
    const bomb = game.bomb;
    const siteId = bomb.site ? bomb.site.id : (bomb.pos.x < 0 ? 'A' : 'B');
    const rallyId = siteId === 'B' ? 'b_rally' : 'a_rally';
    const siteNode = siteId === 'B' ? 'b_site' : 'a_site';
    const [rx, rz] = NODES[rallyId];
    const dBomb = Math.hypot(bomb.pos.x - c.pos.x, bomb.pos.z - c.pos.z);
    if (dBomb < 9) this.rallyPushed = true;

    if (!this.rallyPushed) {
      const here = nearestNode(c.pos.x, c.pos.z);
      const hop = here === rallyId ? rallyId : nextHop(here, rallyId);
      const [hx, hz] = NODES[hop];
      if (hop !== rallyId || Math.hypot(hx - c.pos.x, hz - c.pos.z) > 1.6) {
        this.moveToward(dt, { x: hx, z: hz }, game, false);
        return;
      }
      // Staged: crouch, watch the charge, wait for a teammate — or 2.5 s, then go.
      if (!this.rallyAt) this.rallyAt = game.time;
      let staged = 1; // this bot
      for (const [other, otherMind] of game.minds) {
        if (other === c || other.team !== c.team || !other.alive) continue;
        if (otherMind.state !== 'retake') continue;
        if (Math.hypot(other.pos.x - rx, other.pos.z - rz) < 3.5) staged++;
      }
      // A dying clock overrides the squad: under 12 s, push with whoever is here.
      const urgent = bomb.timer < 12;
      if (staged < 2 && game.time - this.rallyAt < 2.5 && !urgent) {
        c.crouching = true;
        c.yaw += Math.max(-1.1 * dt, Math.min(1.1 * dt, angDiff(yawToward(c.pos, bomb.pos), c.yaw)));
        c.move(dt, { x: 0, z: 0 }, 0, false);
        return;
      }
      this.rallyPushed = true;
      if (c.smokes > 0 && !this.threwSmoke) {
        this.threwSmoke = true;
        game.throwGrenade(c, 'smoke', bomb.pos);
      }
    }

    // Push: graph-hop to the site node, then straight to the charge.
    const here = nearestNode(c.pos.x, c.pos.z);
    const hop = here === siteNode ? siteNode : nextHop(here, siteNode);
    if (hop !== siteNode) {
      const [hx, hz] = NODES[hop];
      this.moveToward(dt, { x: hx, z: hz }, game, false);
      return;
    }
    // Somebody is already on the defuse: this bot guards the doors instead of
    // stacking a second body on the charge.
    if (bomb.defuser && bomb.defuser !== c && dBomb < 5.5) {
      c.crouching = true;
      c.yaw += Math.max(-1.4 * dt, Math.min(1.4 * dt, angDiff(yawToward(c.pos, bomb.pos), c.yaw)));
      c.move(dt, { x: 0, z: 0 }, 0, false);
      return;
    }
    if (dBomb > 1.4) { this.moveToward(dt, bomb.pos, game, true); return; }
    c.move(dt, { x: 0, z: 0 }, 0, false);
    c.yaw = yawToward(c.pos, bomb.pos);
    game.botDefuse(this, dt);
  }

  moveToward(dt, target, game, cautious) {
    const c = this.c;
    // Separation: aim a little off any teammate crowding the same ground, so a
    // squad in a lane spreads across it instead of stacking into one silhouette.
    let tx = target.x;
    let tz = target.z;
    for (const other of game.characters) {
      if (other === c || !other.alive || other.team !== c.team) continue;
      const sx = c.pos.x - other.pos.x;
      const sz = c.pos.z - other.pos.z;
      const sd = Math.hypot(sx, sz);
      if (sd > 0.01 && sd < 1.2) { tx += (sx / sd) * (1.2 - sd); tz += (sz / sd) * (1.2 - sd); }
    }
    const dx = tx - c.pos.x;
    const dz = tz - c.pos.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    c.yaw += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, angDiff(wantYaw, c.yaw)));
    c.pitch = 0;
    c.crouching = false;
    const facing = Math.abs(angDiff(wantYaw, c.yaw)) < 0.5;
    const speed = c.weapon.def.speed * (cautious && dist < 6 ? 0.55 : 1);
    const wish = facing
      ? { x: -Math.sin(c.yaw), z: -Math.cos(c.yaw) }
      : { x: 0, z: 0 };
    c.move(dt, wish, speed, false);
    // Stuck detection: barely moving while trying means a wall won — sidestep.
    const moved = Math.hypot(c.pos.x - this.lastX, c.pos.z - this.lastZ);
    if (facing && moved < dt * 0.4) {
      this.stuckT += dt;
      if (this.stuckT > 0.7) {
        c.yaw += 0.9;
        this.stuckT = 0;
      }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt);
    }
    this.lastX = c.pos.x;
    this.lastZ = c.pos.z;
  }
}

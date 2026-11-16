// minimap.js — the CS-style corner map: walls, sites, teammates, the charge, and
// only the enemies your team has actually earned information about.
//
// Information discipline is the point. A dot appears for an enemy in exactly two
// cases: a teammate currently sees them, or they fired within the last two
// seconds (firing is giving yourself away — the game tracks it as `spotted`).
// Everything else stays hidden, so the map rewards sound and callouts instead of
// handing out wallhacks. North is up; the yard is 66 m by 50 m.

import { SOLIDS, SITES } from './map.js';

const WORLD_W = 66;  // x: -33..33
const WORLD_H = 50;  // z: -25..25
const SPOT_MEMORY = 2.0; // seconds an enemy dot lingers after contact

export class Minimap {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.game = game;
    this.frame = 0; // redrawn every other HUD frame; 30 Hz is plenty for dots
  }

  /** World (x, z) to canvas pixels. */
  px(x) { return (x + WORLD_W / 2) / WORLD_W * this.canvas.width; }
  pz(z) { return (z + WORLD_H / 2) / WORLD_H * this.canvas.height; }

  draw() {
    if ((this.frame++ & 1) === 1) return;
    const { g, game } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Ground and walls: the yard's shape in two quiet tones.
    g.fillStyle = '#241a12';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#4a3826';
    for (const s of SOLIDS) {
      g.fillRect(
        this.px(s.cx - s.w / 2), this.pz(s.cz - s.d / 2),
        s.w / WORLD_W * W, s.d / WORLD_H * H,
      );
    }

    // Sites: ring and letter, in their paint colours.
    for (const site of SITES) {
      g.strokeStyle = site.id === 'A' ? '#e8a33d' : '#3fb8a6';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(this.px(site.x), this.pz(site.z), site.r / WORLD_W * W, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = '700 10px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(site.id, this.px(site.x), this.pz(site.z));
    }

    // Smoke is information too: where the blind ground is.
    g.fillStyle = 'rgba(200,200,200,0.35)';
    for (const sm of game.smokes) {
      g.beginPath();
      g.arc(this.px(sm.pos.x), this.pz(sm.pos.z), sm.r / WORLD_W * W, 0, Math.PI * 2);
      g.fill();
    }

    // The charge: carried shows nothing (it is on a person, drawn below), dropped
    // blinks amber, planted pulses red at its site.
    const bomb = game.bomb;
    if (bomb.state === 'dropped' || bomb.state === 'planted') {
      const blink = bomb.state === 'dropped'
        ? (Math.floor(game.time * 2) % 2 === 0)
        : (Math.floor(game.time * 3) % 2 === 0);
      g.fillStyle = bomb.state === 'planted' ? '#ff5340' : '#e8a33d';
      if (blink) {
        g.beginPath();
        g.arc(this.px(bomb.pos.x), this.pz(bomb.pos.z), 3.4, 0, Math.PI * 2);
        g.fill();
      }
    }

    const me = game.player;
    for (const c of game.characters) {
      if (!c.alive || c === me) continue;
      if (c.team === me.team) {
        this.dot(c, '#e8e3da');
      } else if (game.time - (game.spotted.get(c) || -Infinity) < SPOT_MEMORY) {
        this.dot(c, '#ff5340');
      }
    }
    // The player: a wedge pointing where they look. Canvas rotation is clockwise
    // (y runs south), and facing is (-sin yaw, -cos yaw) in world (x, z), which
    // works out to a rotation of exactly -yaw.
    if (me.alive) {
      g.save();
      g.translate(this.px(me.pos.x), this.pz(me.pos.z));
      g.rotate(-me.yaw);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -5);
      g.lineTo(3.6, 4);
      g.lineTo(-3.6, 4);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  dot(c, color) {
    const g = this.g;
    g.fillStyle = color;
    g.beginPath();
    g.arc(this.px(c.pos.x), this.pz(c.pos.z), 2.6, 0, Math.PI * 2);
    g.fill();
    // The bomb carrier's dot carries a ring, on either team — that is the point of him.
    if (c.hasBomb) {
      g.strokeStyle = '#e8a33d';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(this.px(c.pos.x), this.pz(c.pos.z), 4.4, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

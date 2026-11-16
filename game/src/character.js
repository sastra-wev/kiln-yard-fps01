// character.js — one fighter, human or bot: body, hitboxes, health and armour,
// movement physics, and the mesh the others see.
//
// Movement is the shared tactical model, and it is the gunplay's other half: ground
// friction is fierce (you stop fast, which is why stopping to shoot works),
// acceleration is brisk, a crouch slows you and steadies the gun, and a jump ruins
// accuracy until you land. Collision is a circle against the map's boxes.

import * as THREE from 'three';
import { resolveCollision } from './map.js';
import { WeaponState, WEAPONS } from './weapons.js';

const RADIUS = 0.35;
const GRAVITY = 24;
const JUMP_VEL = 7.4;
const GROUND_FRICTION = 9;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 6;

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.16;

// Shared geometries — a fighter is boxes, and boxes are cheap to share.
const GEO = {
  torso: new THREE.BoxGeometry(0.58, 0.78, 0.34),
  vest: new THREE.BoxGeometry(0.62, 0.5, 0.38),
  leg: new THREE.BoxGeometry(0.24, 0.62, 0.3),
  arm: new THREE.BoxGeometry(0.13, 0.13, 0.5),
  head: new THREE.BoxGeometry(0.3, 0.32, 0.3),
  gun: new THREE.BoxGeometry(0.09, 0.16, 0.78),
};

let nextId = 1;

export class Character {
  constructor(team, name, mats, isHuman = false) {
    this.id = nextId++;
    this.team = team; // 'atk' (Casters) or 'def' (Wardens)
    this.name = name;
    this.isHuman = isHuman;
    this.pos = new THREE.Vector3(0, 0, 0); // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.crouching = false;
    this.grounded = true;
    this.scoped = false;
    this.alive = true;
    this.health = 100;
    this.armor = 0; // 0 or 1: kevlar bought or not
    this.money = 800;
    this.kills = 0;
    this.deaths = 0;
    this.weapons = { sidearm: new WeaponState(WEAPONS.pistol), primary: null };
    this.currentSlot = 'sidearm';
    this.frags = 0;
    this.smokes = 0;
    this.hasBomb = false;
    this.flashUntil = 0;  // hit-flash deadline, in performance.now() ms
    this.walkPhase = 0;   // stride cycle, drives the limb swing and footstep sounds
    this.strideAcc = 0;   // metres since the last footstep the game played
    this.bodyBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    this.headBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    this.mesh = this.buildMesh(mats);
  }

  get weapon() { return this.weapons[this.currentSlot] || this.weapons.sidearm; }
  get eyeHeight() { return this.crouching ? EYE_CROUCH : EYE_STAND; }
  eye(out) { return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); }
  get speedNow() { return Math.hypot(this.vel.x, this.vel.z); }

  /**
   * The visible fighter: uniform torso, team-colour vest, head, gun and swinging
   * limbs. The vest material is cloned per fighter so a hit flash lights up only
   * the one who was hit; everything else shares the palette's materials.
   */
  buildMesh(mats) {
    const g = new THREE.Group();
    const uniform = this.team === 'atk' ? mats.uniformAtk : mats.uniformDef;
    this.vestMat = (this.team === 'atk' ? mats.vestAtk : mats.vestDef).clone();

    const legL = new THREE.Mesh(GEO.leg, mats.dark);
    legL.position.set(-0.15, 0.31, 0);
    const legR = new THREE.Mesh(GEO.leg, mats.dark);
    legR.position.set(0.15, 0.31, 0);

    const body = new THREE.Mesh(GEO.torso, uniform);
    body.position.y = 1.01;
    const vestMesh = new THREE.Mesh(GEO.vest, this.vestMat);
    vestMesh.position.y = 1.06;
    const head = new THREE.Mesh(GEO.head, mats.skin);
    head.position.y = 1.56;
    const gun = new THREE.Mesh(GEO.gun, mats.dark);
    gun.position.set(0.18, 1.32, -0.42);
    const arm = new THREE.Mesh(GEO.arm, uniform);
    arm.position.set(0.18, 1.3, -0.2);

    for (const m of [legL, legR, body, vestMesh, head, gun, arm]) {
      m.castShadow = true;
      g.add(m);
    }
    this.parts = { legL, legR, body, head, gun, arm };
    g.visible = false;
    return g;
  }

  /** Place at a spawn point, alive and reset for a new round (loadout/money kept). */
  spawnAt(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.alive = true;
    this.crouching = false;
    this.scoped = false;
    this.hasBomb = false;
    this.mesh.visible = !this.isHuman;
    this.syncMesh(0);
    this.updateHitboxes();
  }

  /**
   * Move one fixed step. `wishDir` is a unit vector on the ground plane (or zero),
   * `maxSpeed` the cap for the current weapon and stance. Source-engine style:
   * friction bleeds speed first, then acceleration adds toward the wish, capped so
   * strafing is quick but never free.
   */
  move(dt, wishDir, maxSpeed, wantJump) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && speed > 0) {
      const keep = Math.max(0, speed - speed * GROUND_FRICTION * dt) / speed;
      this.vel.x *= keep;
      this.vel.z *= keep;
    }
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const along = this.vel.x * wishDir.x + this.vel.z * wishDir.z;
    const add = Math.min(accel * dt * maxSpeed, maxSpeed - along);
    if (add > 0) {
      this.vel.x += wishDir.x * add;
      this.vel.z += wishDir.z * add;
    }
    if (wantJump && this.grounded) {
      this.vel.y = JUMP_VEL;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    const [cx, cz] = resolveCollision(this.pos.x, this.pos.z, RADIUS);
    this.pos.x = cx;
    this.pos.z = cz;
    this.pos.x = Math.max(-31.4, Math.min(31.4, this.pos.x));
    this.pos.z = Math.max(-23.4, Math.min(23.4, this.pos.z));
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    }
    // Stride bookkeeping for the walk cycle and the game's footstep sounds.
    const pace = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && pace > 0.3) {
      this.walkPhase += dt * pace * 1.9;
      this.strideAcc += pace * dt;
    }
    this.updateHitboxes();
  }

  /** The two boxes bullets test against: body, and the smaller, richer head. */
  updateHitboxes() {
    const { x, y, z } = this.pos;
    const bodyTop = y + (this.crouching ? 1.04 : 1.4);
    this.bodyBox.minX = x - 0.33;
    this.bodyBox.maxX = x + 0.33;
    this.bodyBox.minZ = z - 0.33;
    this.bodyBox.maxZ = z + 0.33;
    this.bodyBox.minY = y;
    this.bodyBox.maxY = bodyTop;
    const headY = y + (this.crouching ? 1.06 : 1.42);
    this.headBox.minX = x - 0.2;
    this.headBox.maxX = x + 0.2;
    this.headBox.minZ = z - 0.2;
    this.headBox.maxZ = z + 0.2;
    this.headBox.minY = headY;
    this.headBox.maxY = headY + 0.36;
  }

  /**
   * Copy simulation state into the mesh: position, facing, crouch squash, the gun's
   * pitch, the walk swing, the hit flash, and the fall of the dead. Called once per
   * render frame; the human's own mesh stays hidden (the view model replaces it).
   */
  syncMesh() {
    if (this.isHuman) return;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.mesh.scale.y = this.crouching ? 0.78 : 1;
    this.parts.gun.rotation.x = this.pitch;
    this.parts.arm.rotation.x = this.pitch;

    const swing = this.alive ? Math.sin(this.walkPhase) * Math.min(1, this.speedNow / 3) * 0.55 : 0;
    this.parts.legL.rotation.x = swing;
    this.parts.legR.rotation.x = -swing;

    const flash = performance.now() < this.flashUntil;
    this.vestMat.emissive.setHex(flash ? 0x661111 : 0x000000);

    if (!this.alive) {
      this.mesh.rotation.z = Math.PI / 2 * 0.92;
      this.mesh.position.y = 0.25;
    } else {
      this.mesh.rotation.z = 0;
    }
  }

  /** Apply damage that has already been through the gunplay model. True if it killed. */
  takeDamage(amount) {
    if (!this.alive) return false;
    this.health -= amount;
    this.flashUntil = performance.now() + 90;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      return true;
    }
    return false;
  }

  /** Fresh pistol, no armour, no grenades. Money and score are the game's to keep. */
  resetLoadout() {
    this.weapons = { sidearm: new WeaponState(WEAPONS.pistol), primary: null };
    this.currentSlot = 'sidearm';
    this.frags = 0;
    this.smokes = 0;
    this.armor = 0;
  }
}

// player.js — the human behind one Character: mouse look, WASD movement, firing,
// reloading, weapon and grenade keys, the interact hold, and the first-person view
// model — the gun you see. It turns input into intents and lets game.js resolve
// them, so the player and the bots are judged by exactly the same rules.
//
// The feel lives here and in weapons.js: stopping steadies the gun, the crouch is
// slow and accurate, the Longshot only settles through its scope, and every shot
// punches the view up by the gun's `kick`, which then settles back.

import * as THREE from 'three';

const SENS = 0.0022;
const SENS_SCOPED = 0.0009;
const FOV_NORMAL = 78;
const FOV_SCOPED = 22;

export class PlayerController {
  constructor(character, camera, mats) {
    this.c = character;
    this.camera = camera;
    camera.rotation.order = 'YXZ';
    this.bobPhase = 0;
    this.kick = 0;        // view punch still to settle, radians
    this.swayX = 0;       // view-model lag behind fast looks
    this.swayY = 0;
    this.interactHeld = false;
    this.wasFiring = false;
    this.flashUntil = 0;
    this.viewModel = this.buildViewModel(mats);
    camera.add(this.viewModel);
    this.flashLight = new THREE.PointLight(0xffc37a, 0, 9, 1.8);
    this.flashLight.position.set(0.25, -0.15, -1.1);
    camera.add(this.flashLight);
  }

  buildViewModel(mats) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.62), mats.dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), mats.steelLight);
    barrel.position.set(0, 0.05, -0.48);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.1), mats.woodDark);
    grip.position.set(0, -0.16, 0.08);
    grip.rotation.x = 0.35;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.03), mats.steelLight);
    sight.position.set(0, 0.12, -0.1);
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false }),
    );
    flash.position.set(0, 0.05, -0.72);
    g.add(body, barrel, grip, sight, flash);
    g.position.set(0.26, -0.24, -0.55);
    this.muzzleFlash = flash;
    return g;
  }

  /**
   * One fixed step of human control. Frozen phases pass canAct=false: you may look
   * around, but not move or shoot. Weapon keys double as buy keys during the buy
   * phase — the HUD owns them then, so step() leaves Digit1..7 alone unless live.
   */
  step(dt, input, game, canAct) {
    const c = this.c;
    if (!c.alive) return;
    const def = c.weapon.def;

    const look = input.takeLook();
    const sens = c.scoped ? SENS_SCOPED : SENS;
    c.yaw -= look.dx * sens;
    c.pitch -= look.dy * sens;
    c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch));
    // The view model trails a fast look by a frame or two, then catches up.
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(-look.dx * 0.0006, -0.03, 0.03), 0.4);
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(look.dy * 0.0006, -0.02, 0.02), 0.4);

    const pressed = input.consumePressed();
    c.crouching = input.down('ControlLeft') || input.down('KeyC');
    const walking = input.down('ShiftLeft');
    this.interactHeld = input.down('KeyE');

    let wx = 0;
    let wz = 0;
    if (canAct) {
      const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      const r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
      const sin = Math.sin(c.yaw);
      const cos = Math.cos(c.yaw);
      wx = -sin * f + cos * r;
      wz = -cos * f - sin * r;
      const len = Math.hypot(wx, wz);
      if (len > 0) { wx /= len; wz /= len; }
    }
    let maxSpeed = def.speed;
    if (c.crouching) maxSpeed *= 0.45;
    else if (walking) maxSpeed *= 0.52;
    if (c.scoped) maxSpeed *= 0.4;
    c.move(dt, { x: wx, z: wz }, canAct ? maxSpeed : 0, canAct && input.down('Space'));

    // Scoping: right mouse, Longshot only, never mid-reload.
    c.scoped = !!(def.scope && input.mouseDownRight && !c.weapon.reloading);

    if (!canAct) return;

    if (game.phase !== 'buy') {
      if (pressed.has('Digit1') && c.weapons.primary) { c.currentSlot = 'primary'; game.onWeaponSwitch(c); }
      if (pressed.has('Digit2')) { c.currentSlot = 'sidearm'; game.onWeaponSwitch(c); }
      if (pressed.has('Digit4') && c.frags > 0) game.throwGrenade(c, 'frag');
      if (pressed.has('Digit5') && c.smokes > 0) game.throwGrenade(c, 'smoke');
    }
    if (pressed.has('KeyR') && c.weapon.startReload()) game.onReloadStart(c);

    const wantFire = def.auto ? input.firing : (input.firing && !this.wasFiring);
    this.wasFiring = input.firing;
    if (wantFire && game.tryFire(c)) {
      // A shot actually left: punch the view and light the muzzle.
      this.kick = Math.min(0.09, this.kick + def.kick);
      this.showMuzzleFlash();
    }
    if (this.interactHeld) game.interact(c, dt);
  }

  /** Per-frame: camera at the eyes, and the view model's bob, sway, dip and kick. */
  syncView(dt) {
    const c = this.c;
    this.kick *= Math.pow(0.0001, dt); // fast settle, ~90% gone in a quarter second
    if (this.kick < 0.0004) this.kick = 0;
    this.swayX = THREE.MathUtils.lerp(this.swayX, 0, 1 - Math.pow(0.001, dt));
    this.swayY = THREE.MathUtils.lerp(this.swayY, 0, 1 - Math.pow(0.001, dt));

    this.camera.position.set(c.pos.x, c.pos.y + c.eyeHeight, c.pos.z);
    this.camera.rotation.y = c.yaw;
    this.camera.rotation.x = c.pitch + c.weapon.recoilHeat * 0.012 + this.kick;
    this.camera.rotation.z = 0;

    const targetFov = c.scoped ? FOV_SCOPED : FOV_NORMAL;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.pow(0.000001, dt));
      this.camera.updateProjectionMatrix();
    }

    const speed = c.speedNow;
    this.bobPhase += dt * (2 + speed * 1.6);
    const bob = Math.min(1, speed / 4) * 0.016;
    const reloadDip = c.weapon.reloadProgress * 0.13;
    this.viewModel.position.set(
      0.26 + Math.sin(this.bobPhase) * bob * 0.6 + this.swayX,
      -0.24 + Math.sin(this.bobPhase * 2) * bob - reloadDip + this.swayY,
      -0.55,
    );
    this.viewModel.rotation.x = c.weapon.reloadProgress * 0.7 - c.weapon.recoilHeat * 0.06 - this.kick * 1.6;
    this.viewModel.visible = c.alive && !c.scoped;

    const flashT = Math.max(0, this.flashUntil - performance.now()) / 70;
    this.muzzleFlash.material.opacity = flashT * 0.95;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.flashLight.intensity = flashT * 14;
  }

  showMuzzleFlash() { this.flashUntil = performance.now() + 70; }
}

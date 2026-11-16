// main.js — bootstrap and the frame loop.
//
// The simulation runs at a fixed 60 steps a second from an accumulator, apart
// from rendering: however fast the display is, the game underneath ticks the
// same, so a 144 Hz monitor and a 60 Hz one play the same match. Three ways in:
//   play — click the start card, pointer lock, you lead the Casters;
//   demo — ?demo=1: the bots play each other under a roaming camera (attract mode);
//   shots — ?shot=start|play|plant|end&seed=n: the demo with a fixed seed and a
//     set camera, so a screenshot is reproducible and agrees with the code.

import * as THREE from 'three';
import { buildMaterials, buildLights } from './palette.js';
import { buildWorld } from './map.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { PlayerController } from './player.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const demo = params.has('demo') || !!shot;

// A seeded RNG for staged shots: same seed, same demo, same screenshot.
if (params.has('seed')) {
  let s = (parseInt(params.get('seed'), 10) || 1) >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const mats = buildMaterials();
buildLights(scene);
buildWorld(scene, mats);

const sounds = new SoundBank();
const game = new Game(scene, mats, sounds, { demo });
const hud = new Hud(game, sounds);
const input = demo ? null : new Input(renderer.domElement);
const playerCtrl = demo ? null : new PlayerController(game.player, camera, mats);
if (demo) game.player.mesh.visible = true;

// ----- staged shots: set the scene the screenshot will show -----
function stageShot() {
  game.startMatch();
  if (shot === 'start') {
    // Buy phase at the Casters' yard: the whole map north of you, team at your back.
    camera.position.set(0, 4.3, 23);
    camera.lookAt(0, 0.7, -18);
  } else if (shot === 'play') {
    game.phase = 'live';
    game.phaseT = 88;
    camera.userData.followMid = true;
  } else if (shot === 'plant') {
    game.phase = 'live';
    game.phaseT = 60;
    const planter = game.characters.find((c) => c.team === 'atk' && !c.isHuman);
    planter.pos.set(-19.5, 0, -11.5);
    const siteA = game.targetSite && game.targetSite.id === 'A'
      ? game.targetSite
      : { id: 'A', name: 'Kiln Hall' };
    game.plantBomb(planter, siteA);
    camera.position.set(-11, 3.4, -5.5);
    camera.lookAt(-21, 0.7, -13);
  } else if (shot === 'end') {
    game.phase = 'live';
    game.phaseT = 50;
    camera.position.set(6, 3.8, 8);
    camera.lookAt(-6, 1, -8);
    setTimeout(() => game.endRound('atk', 'Wardens eliminated'), 1400);
  }
}

// ----- demo camera: roam to whoever is fighting -----
let camTarget = null;
let camT = 0;
const _v = new THREE.Vector3();
function demoCamera(dt) {
  if (shot === 'start' || shot === 'plant' || shot === 'end') return; // fixed cameras
  camT -= dt;
  const fighters = game.characters.filter((c) => c.alive);
  if (!fighters.length) return;
  if (camT <= 0 || !camTarget || !camTarget.alive) {
    camTarget = fighters[Math.floor(Math.random() * fighters.length)];
    camT = 5 + Math.random() * 3;
  }
  const c = camTarget;
  _v.set(
    c.pos.x + Math.sin(c.yaw) * 4.6,
    c.pos.y + 2.4,
    c.pos.z + Math.cos(c.yaw) * 4.6,
  );
  camera.position.lerp(_v, Math.min(1, dt * 3));
  camera.lookAt(
    c.pos.x - Math.sin(c.yaw) * 8,
    c.pos.y + 1.3,
    c.pos.z - Math.cos(c.yaw) * 8,
  );
}

// ----- play flow -----
const startScreen = document.getElementById('startscreen');
const playBtn = document.getElementById('playbtn');
let started = false;
if (demo) {
  startScreen.classList.add('hidden');
  stageShot();
  started = true;
} else {
  playBtn.addEventListener('click', () => {
    sounds.unlock();
    renderer.domElement.requestPointerLock();
    startScreen.classList.add('hidden');
    if (!started) {
      game.startMatch();
      started = true;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && started && !hud.buyOpen) {
      startScreen.classList.remove('hidden');
    }
  });
}

// Buy menu + scoreboard keys. The sim's own keys live in Input/PlayerController.
window.addEventListener('keydown', (e) => {
  if (demo) return;
  if (e.code === 'Tab') {
    e.preventDefault();
    hud.renderScoreboard();
    hud.el.scoreboard.style.display = 'flex';
  }
  if (e.code === 'KeyB' && game.phase === 'buy') hud.setBuyOpen(!hud.buyOpen);
  else if (e.code === 'Escape' && hud.buyOpen) hud.setBuyOpen(false);
  else if (hud.buyOpen && e.code.startsWith('Digit')) hud.buyKey(e.code);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') hud.el.scoreboard.style.display = 'none';
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- the loop: fixed-step simulation, free-running render -----
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;

  const playerStep = demo
    ? null
    : (sdt, canAct) => playerCtrl.step(sdt, input, game, canAct && started);
  while (acc >= STEP) {
    game.step(STEP, started || demo ? playerStep : null);
    acc -= STEP;
  }
  // The shop closes itself when the buy phase ends.
  if (hud.buyOpen && game.phase !== 'buy') hud.setBuyOpen(false);

  for (const c of game.characters) c.syncMesh();
  if (demo) demoCamera(dt);
  else if (started) {
    if (game.player.alive) playerCtrl.syncView(dt);
    else spectate(dt);
  }
  hud.frame();
  renderer.render(scene, camera);
}

// Dead players watch a living teammate from just behind the shoulder.
let specTarget = null;
function spectate(dt) {
  const mates = game.characters.filter((c) => c.team === 'atk' && c.alive);
  if (!mates.length) return;
  if (!specTarget || !specTarget.alive) specTarget = mates[0];
  const c = specTarget;
  _v.set(
    c.pos.x + Math.sin(c.yaw) * 3.4,
    c.pos.y + 2.1,
    c.pos.z + Math.cos(c.yaw) * 3.4,
  );
  camera.position.lerp(_v, Math.min(1, dt * 5));
  camera.lookAt(
    c.pos.x - Math.sin(c.yaw) * 8,
    c.pos.y + 1.4,
    c.pos.z - Math.cos(c.yaw) * 8,
  );
  if (camera.fov !== 78) {
    camera.fov = 78;
    camera.updateProjectionMatrix();
  }
}

requestAnimationFrame(frame);

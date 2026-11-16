// palette.js — Kiln Yard's single source of look: a brick foundry yard at dusk.
//
// Every colour, material and light in the game is decided here and nowhere else, so the
// scene reads as one place: warm brick and sand under a low orange sun, charcoal steel,
// and the two team colours — Casters amber, Wardens teal — repeated on vests, site paint,
// tracers and HUD accents until a player can read a fight at a glance.

import * as THREE from 'three';

// The dusk ramp. Surfaces sit in the warm browns; anything the player must notice
// (accents, site paint, team colours) is pulled out of that ramp on purpose.
export const COLORS = {
  // Atmosphere
  sky: 0x3a241a,        // burnt umber overhead
  fog: 0x453025,        // dust hanging over the yard
  sun: 0xffc38a,        // low sun, warm peach
  hemiSky: 0x8a6a58,    // bounce off the sky
  hemiGround: 0x33241a, // bounce off the yard floor
  // Surfaces
  ground: 0x77644e,
  groundDark: 0x63523e,
  brick: 0x99573d,
  brickDark: 0x7c4430,
  plaster: 0xbb9a68,
  steel: 0x454b54,
  steelLight: 0x6a7076,
  wood: 0x84683f,
  woodDark: 0x66502f,
  coal: 0x232120,
  // Signals
  accent: 0xe8a33d,     // Casters amber — also the generic "look here" colour
  ally: 0x3fb8a6,       // Wardens teal
  siteA: 0xe8a33d,
  siteB: 0x3fb8a6,
  // Characters
  uniformAtk: 0x4a4038,
  uniformDef: 0x37424a,
  skin: 0xc9a186,
};

// One flat-shaded material per surface. MeshStandardMaterial with high roughness keeps
// the dusk light soft; steel trades a little roughness for a readable sheen.
function flat(color, roughness) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

/** Shared materials, built once and reused by every mesh in the game. */
export function buildMaterials() {
  return {
    ground: flat(COLORS.ground, 1),
    groundDark: flat(COLORS.groundDark, 1),
    brick: flat(COLORS.brick, 0.95),
    brickDark: flat(COLORS.brickDark, 0.95),
    plaster: flat(COLORS.plaster, 0.95),
    steel: flat(COLORS.steel, 0.6),
    steelLight: flat(COLORS.steelLight, 0.55),
    wood: flat(COLORS.wood, 0.95),
    woodDark: flat(COLORS.woodDark, 0.95),
    coal: flat(COLORS.coal, 1),
    accent: flat(COLORS.accent, 0.7),
    uniformAtk: flat(COLORS.uniformAtk, 0.95),
    uniformDef: flat(COLORS.uniformDef, 0.95),
    // Vests carry the team colour at full strength: friend-or-foe in one glance.
    vestAtk: flat(COLORS.accent, 0.8),
    vestDef: flat(COLORS.ally, 0.8),
    skin: flat(COLORS.skin, 0.8),
    // Near-black for the backdrop silhouettes beyond the walls.
    dark: flat(0x1c1a19, 0.9),
  };
}

/**
 * The dusk rig: one shadow-casting sun low in the west, one hemisphere fill so shadowed
 * lanes stay readable, and fog that swallows the far wall before it can look empty.
 * Returns the lights so callers can reach the sun if they ever need to.
 */
export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(COLORS.sun, 2.7);
  sun.position.set(-28, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -42;
  shadowCam.right = 42;
  shadowCam.top = 36;
  shadowCam.bottom = -36;
  shadowCam.far = 110;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  scene.fog = new THREE.Fog(COLORS.fog, 70, 175);
  scene.background = new THREE.Color(COLORS.sky);
  return { hemi, sun };
}

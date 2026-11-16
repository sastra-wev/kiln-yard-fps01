// Kiln Yard — a threejs-fps-01 entry (Node 22, standard library only).
//
// The game itself is this directory's game/ folder: plain static files the
// browser loads as ES modules, three.js 0.187.0 vendored beside them and
// reached through an import map. This program is the hand-in. It copies game/
// and screenshots/ from beside this file into the output directory and writes
// dossier.json — the summary the judge reads — using the vendored make.fun
// library, so the dossier on disk is byte for byte the one the scorer rebuilds
// from the same files.
//
// Play it locally by serving game/ with any static file server and opening
// index.html; run the attract mode (bots versus bots) with ?demo=1, or a staged
// scene with ?shot=start|play|plant|end&seed=1.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The scorer's own caps. They are passed to the dossier builder so an entry the
// scorer would refuse — too many game files, an oversize screenshot — fails
// here first, at the maker's desk, instead of at judging time.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Copy one directory tree into the output, creating the target first. */
function handIn(name) {
  const from = join(here, name);
  const to = join(out, name);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

mkdirSync(out, { recursive: true });
handIn('game');
handIn('screenshots');

writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));
process.stdout.write(
  `kiln yard: handed in game/ and screenshots/ with a fresh dossier.json under ${out}\n`,
);

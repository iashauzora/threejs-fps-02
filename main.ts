// Foundry District — the hand-in program (Node 22, standard library only).
// The game itself is the static site under game/ (ES modules, three.js from an
// import map, no build step). This program copies game/ and screenshots/ into
// the output directory and writes dossier.json there with the kit's vendored
// buildDossier, byte for byte as the grader will rebuild it. Outside the
// grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own: the dossier text is capped at 160 KiB, and
// the remaining limits make this program refuse exactly what the gate would
// refuse (over 4 screenshots or one over 256 KiB; over 993 entries or 48 MiB
// under game/, which shares /output's 1,000-entry budget with the rest).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);

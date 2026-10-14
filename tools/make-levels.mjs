// Builds the levels into js/levels.js. Deterministic: the same script always makes the same levels.
// Usage: node tools/make-levels.mjs
//
// Each band is a range of levels with one recipe. For a band we build several candidates per
// level, measure them, sort them from easy to hard and take evenly spaced ones, so difficulty
// climbs inside the band too. Every level is built backwards from a played game, so it can
// always be solved (see buildLevel in js/sheep.js).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../js/sheep.js';

const ALL = [0, 1, 2, 3, 4, 5];
const BANDS = [
  // count, recipe, least number of order dependencies
  [3, { w: 4, h: 4, pens: 1, shapes: [0], drags: [1, 1], walk: [3, 6], sheep: [2, 3], hedge: 0.3 }, 0],
  [7, { w: 4, h: 5, pens: 2, shapes: [0, 1, 2], drags: [1, 2], walk: [2, 5], sheep: [2, 3], hedge: 0.4 }, 0],
  [20, { w: 5, h: 6, pens: 3, shapes: [0, 1, 2, 3], drags: [1, 2], walk: [2, 5], sheep: [3, 4], hedge: 0.8 }, 1],
  [30, { w: 6, h: 7, pens: 4, shapes: ALL, drags: [1, 2], walk: [2, 5], sheep: [3, 5], hedge: 0.9 }, 2],
  [30, { w: 6, h: 8, pens: 5, shapes: ALL, drags: [1, 2], walk: [2, 5], sheep: [3, 5], hedge: 0.9 }, 3],
  [30, { w: 6, h: 8, pens: 6, shapes: ALL, drags: [1, 2], walk: [2, 4], sheep: [3, 4], hedge: 0.95 }, 4],
];
const PER_LEVEL = 6; // candidates built per level
const MAX_STATES = 120000; // solver budget when measuring

// Higher is harder: more pens, sheep and order dependencies, and extra drags when the solver
// can prove the best way needs to come back to a pen.
function score(st, sol) {
  const extra = sol ? sol.drags - st.pens.length : 2;
  return st.pens.length * 2 + S.sheepTotal(st) * 0.3 + st.deps * 1.5 + extra * 3;
}

const levels = [];
const seen = new Set();
let seed = 1;
for (const [count, spec, minDeps] of BANDS) {
  const pool = [];
  while (pool.length < count * PER_LEVEL) {
    const st = S.buildLevel(spec, seed++);
    if (st.pens.length < spec.pens || st.deps < minDeps) continue;
    const L = S.encodeLevel(st);
    if (seen.has(L.g)) continue;
    seen.add(L.g);
    const sol = S.solve(S.parseLevel(L), { maxStates: MAX_STATES });
    pool.push({ L, score: score(st, sol), drags: sol ? sol.drags : 0 });
  }
  pool.sort((a, b) => a.score - b.score);
  for (let k = 0; k < count; k++) {
    const c = pool[Math.round(((k + 0.5) / count) * (pool.length - 1))];
    levels.push({ ...c.L, d: c.drags });
  }
  process.stdout.write(`${levels.length} levels\n`);
}

const out = fileURLToPath(new URL('../js/levels.js', import.meta.url));
const body = levels.map((L) => '  ' + JSON.stringify(L)).join(',\n');
writeFileSync(
  out,
  `// Made by tools/make-levels.mjs – do not edit by hand.\n// { w, h, g: grid ('.' grass, '#' hedge, 'a'..'f' sheep), p: pens [colour, x, y, w, h], d: fewest drags (0 = not measured) }\nexport const LEVELS = [\n${body},\n];\n`,
);
console.log(`wrote ${levels.length} levels to js/levels.js`);

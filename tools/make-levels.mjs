// Builds the levels into js/levels.js. Deterministic: the same script always makes the same levels.
// Usage: node tools/make-levels.mjs   (a few minutes)
//
// Each band is a range of levels with one recipe, and brings in the rules one at a time:
// queues first, then more shapes, pens that change colour, and locks. For a band we build
// several candidates per level, measure them, sort them from easy to hard and take evenly
// spaced ones, so difficulty climbs inside the band too. Every level is built by playing a
// game backwards (buildLevel in js/sheep.js) and then solved forwards to prove it works.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../js/sheep.js';

const RECT = ['one', 'two', 'three', 'square'];
const ALL = [...RECT, 'four', 'corner', 'L', 'T', 'S'];
const base = { perStage: [2, 4], drop: 0.12, toQueue: 0.85, queues: 40 };
const BANDS = [
  // count, recipe, least share of the meadow under pens, budget for the exact solver (par), most queues
  [5, { ...base, w: 4, h: 5, pens: [2, 3], shapes: ['one', 'two'], perStage: [2, 3], twoStage: 0, lock: 0, shuffle: 10 }, 0.25, 150000, 4],
  [15, { ...base, w: 5, h: 6, pens: [4, 5], shapes: RECT, twoStage: 0, lock: 0, shuffle: 30 }, 0.4, 100000, 6],
  [30, { ...base, w: 5, h: 6, pens: [5, 6], shapes: [...RECT, 'corner', 'L', 'T', 'S'], twoStage: 0.1, lock: 0.3, shuffle: 40 }, 0.45, 40000, 8],
  [35, { ...base, w: 6, h: 7, pens: [7, 8], shapes: ALL, twoStage: 0.15, lock: 0.5, shuffle: 60 }, 0.5, 0, 10],
  [35, { ...base, w: 6, h: 8, pens: [8, 10], shapes: ALL, twoStage: 0.2, lock: 0.6, shuffle: 80 }, 0.52, 0, 12],
];
const PER_LEVEL = 4; // candidates built per level

const fill = (L) => L.pens.reduce((a, p) => a + p.cells.length, 0) / (L.w * L.h);

// Higher is harder: more drags than pens (pens must make room for each other), how long the
// search wandered before finding the way, and the special pens.
function score(L, sol) {
  const extra = sol.drags - L.pens.length;
  const special = L.pens.filter((p) => p.stages.length > 1).length + (L.keys ? 2 : 0);
  return extra * 3 + Math.log2(sol.explored) + L.pens.length + special;
}

const levels = [];
let seed = 1;
for (const [count, spec, minFill, exactBudget, maxQueues] of BANDS) {
  const pool = [];
  while (pool.length < count * PER_LEVEL) {
    const raw = S.buildLevel(spec, seed++);
    if (!raw || raw.q.length > maxQueues) continue;
    const L = S.parseLevel(raw);
    if (fill(L) < minFill) continue;
    const s0 = S.startState(L);
    const quick = S.search(L, s0, { maxStates: 300000 });
    if (!quick) continue;
    const exact = exactBudget ? S.solve(L, s0, { maxStates: exactBudget }) : null;
    const par = Math.min(quick.drags, exact ? exact.drags : Infinity);
    pool.push({ raw: { ...raw, d: par }, score: score(L, quick) });
  }
  pool.sort((a, b) => a.score - b.score);
  for (let k = 0; k < count; k++) levels.push(pool[Math.round(((k + 0.5) / count) * (pool.length - 1))].raw);
  console.log(`${levels.length} levels (seed ${seed})`);
}

const out = fileURLToPath(new URL('../js/levels.js', import.meta.url));
const body = levels.map((L) => '  ' + JSON.stringify(L)).join(',\n');
writeFileSync(
  out,
  `// Made by tools/make-levels.mjs – do not edit by hand. The format is described in js/sheep.js (parseLevel).\nexport const LEVELS = [\n${body},\n];\n`,
);
console.log(`wrote ${levels.length} levels to js/levels.js`);

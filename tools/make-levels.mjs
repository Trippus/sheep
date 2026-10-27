// Builds the levels into js/levels.js. Deterministic: the same script always makes the same levels.
// Usage: node tools/make-levels.mjs   (about an hour – it is checking a lot of crowded meadows)
//
// Each band is a range of levels with one recipe, and brings in the rules one at a time:
// shelters first, then more shapes, locks and pens that change colour. A level is built by
// playing a game backwards (buildLevel), then crowded with extra sheep as long as it stays
// solvable (fillLevel), then solved forwards to set its par and the solution the hint follows.
// For each band we build a few candidates per level, sort them by how hard they were to
// solve, and keep the harder half, spread from easier to harder.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../js/sheep.js';

const RECT = ['one', 'two', 'three', 'square'];
const ALL = [...RECT, 'four', 'corner', 'L', 'T', 'S'];
const base = { perStage: [2, 4], drop: 0.2, toQueue: 0.85, queues: 40, mix: 0.75 };
const BANDS = [
  // count, recipe, share of the meadow under pens or sheep, budget for the exact solver, most shelters
  [5, { ...base, w: 5, h: 5, pens: [3, 4], shapes: ['one', 'two', 'three'], perStage: [2, 3], twoStage: 0, lock: 0, shuffle: 20 }, 0.6, 150000, 5],
  [15, { ...base, w: 6, h: 6, pens: [5, 7], shapes: [...RECT, 'corner'], twoStage: 0, lock: 0, shuffle: 50 }, 0.7, 60000, 9],
  [30, { ...base, w: 6, h: 7, pens: [7, 8], shapes: ALL, twoStage: 0.1, lock: 0.3, shuffle: 70 }, 0.75, 0, 11],
  [35, { ...base, w: 7, h: 8, pens: [9, 10], shapes: ALL, twoStage: 0.15, lock: 0.5, shuffle: 90 }, 0.78, 0, 14],
  [35, { ...base, w: 7, h: 8, pens: [10, 12], shapes: ALL, twoStage: 0.2, lock: 0.6, shuffle: 110 }, 0.82, 0, 14],
];
const PER_LEVEL = 3; // candidates built per level

// The solution as text, two characters a step: the pen (a, b, c …) and the direction (0–3).
const encode = (steps) => steps.map(([i, dx, dy]) => String.fromCharCode(97 + i) + S.DIRS.findIndex(([x, y]) => x === dx && y === dy)).join('');

const levels = [];
let seed = 1;
for (const [count, spec, full, exactBudget, maxQueues] of BANDS) {
  const pool = [];
  while (pool.length < count * PER_LEVEL) {
    const built = S.buildLevel(spec, seed);
    seed++;
    if (!built || built.q.length > maxQueues) continue;
    const raw = S.fillLevel(built, { full, seed, maxStates: 100000 });
    const L = S.parseLevel(raw);
    const s0 = S.startState(L);
    // the quick search, a slower one that cares more about few drags, and on small levels the exact solver
    const tries = [S.search(L, s0, { maxStates: 300000 }), S.search(L, s0, { maxStates: 300000, weight: 0.5 })];
    if (exactBudget) tries.push(S.solve(L, s0, { maxStates: exactBudget }));
    const sols = tries.filter(Boolean);
    if (!sols.length) continue;
    const best = sols.reduce((a, b) => (b.drags < a.drags ? b : a));
    // harder: more drags than pens (pens must make room for each other), and a longer search
    const score = (best.drags - L.pens.length) * 3 + Math.log2(tries[0]?.explored || 1e6) * 2 + L.pens.length;
    pool.push({ raw: { ...raw, d: best.drags, s: encode(best.steps) }, score });
  }
  pool.sort((a, b) => a.score - b.score);
  const top = pool.slice(Math.floor(pool.length / 2));
  for (let k = 0; k < count; k++) levels.push(top[Math.round(((k + 0.5) / count) * (top.length - 1))].raw);
  console.log(`${levels.length} levels (seed ${seed})`);
}

const out = fileURLToPath(new URL('../js/levels.js', import.meta.url));
const body = levels.map((L) => '  ' + JSON.stringify(L)).join(',\n');
writeFileSync(
  out,
  `// Made by tools/make-levels.mjs – do not edit by hand. The format is described in js/sheep.js (parseLevel);\n// s is a solution (pen letter + direction per step) that the hint follows.\nexport const LEVELS = [\n${body},\n];\n`,
);
console.log(`wrote ${levels.length} levels to js/levels.js`);

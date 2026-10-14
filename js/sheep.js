// Rules for Bring the Sheep Home. Pure functions, no DOM, so they run in Node and in tests.
//
// The meadow is a w×h grid. Each cell is a hedge, empty, or holds one sheep of a colour.
// Every colour has one pen: a rectangle the player drags one cell at a time. A pen may move
// onto empty cells and onto sheep of its own colour (the sheep goes home). Edges, hedges,
// other pens and sheep of other colours stop it. When every sheep of a colour is home, its
// pen closes and leaves the board. The level is won when all sheep are home.
//
// Moves never make a level unsolvable: steps can be walked back, and catching a sheep only
// removes an obstacle. So there are no dead ends, only longer and shorter ways home.

export const HEDGE = -2;
export const EMPTY = -1;
export const COLORS = 6;
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left

/* ---------- levels and state ---------- */

// A level is stored compactly: { w, h, g, p }.
//   g: w*h characters, row by row: '.' empty, '#' hedge, 'a'..'f' a sheep of colour 0..5
//   p: pens as [colour, x, y, width, height]
export function parseLevel(L) {
  const cells = [...L.g].map((ch) => (ch === '#' ? HEDGE : ch === '.' ? EMPTY : ch.charCodeAt(0) - 97));
  const pens = L.p.map(([c, x, y, w, h]) => ({ c, x, y, w, h, need: 0, home: 0, done: false }));
  for (const v of cells) if (v >= 0) pens.find((p) => p.c === v).need++;
  return { w: L.w, h: L.h, cells, pens };
}

export function encodeLevel(st) {
  const g = st.cells.map((v) => (v === HEDGE ? '#' : v === EMPTY ? '.' : String.fromCharCode(97 + v))).join('');
  return { w: st.w, h: st.h, g, p: st.pens.map((p) => [p.c, p.x, p.y, p.w, p.h]) };
}

export const clone = (st) => ({ w: st.w, h: st.h, cells: st.cells.slice(), pens: st.pens.map((p) => ({ ...p })) });

export const sheepLeft = (st) => st.cells.reduce((n, v) => n + (v >= 0), 0);
export const sheepTotal = (st) => st.pens.reduce((n, p) => n + p.need, 0);
export const isWon = (st) => st.pens.every((p) => p.done);

// Index of the pen covering cell (x, y), or -1.
export function penAt(st, x, y) {
  return st.pens.findIndex((p) => !p.done && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

/* ---------- moving ---------- */

// Why pen i cannot step (dx, dy), or '' when it can.
export function blocked(st, i, dx, dy) {
  const p = st.pens[i];
  if (!p || p.done) return 'done';
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (nx < 0 || ny < 0 || nx + p.w > st.w || ny + p.h > st.h) return 'edge';
  for (let y = ny; y < ny + p.h; y++) {
    for (let x = nx; x < nx + p.w; x++) {
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) continue; // already under the pen
      const v = st.cells[y * st.w + x];
      if (v === HEDGE) return 'hedge';
      if (v >= 0 && v !== p.c) return 'sheep';
      const q = penAt(st, x, y);
      if (q >= 0 && q !== i) return 'pen';
    }
  }
  return '';
}

// Steps pen i one cell. Changes st in place and returns { caught: [cell indexes], closed },
// or null when the step is not allowed.
export function step(st, i, dx, dy) {
  if (blocked(st, i, dx, dy)) return null;
  const p = st.pens[i];
  p.x += dx;
  p.y += dy;
  const caught = [];
  for (let y = p.y; y < p.y + p.h; y++) {
    for (let x = p.x; x < p.x + p.w; x++) {
      const k = y * st.w + x;
      if (st.cells[k] === p.c) {
        st.cells[k] = EMPTY;
        caught.push(k);
      }
    }
  }
  p.home += caught.length;
  const closed = caught.length > 0 && p.home >= p.need;
  if (closed) p.done = true;
  return { caught, closed };
}

/* ---------- solver ---------- */

// Finds a shortest way home. A "drag" is a run of steps with the same pen, which is what the
// player does with one finger, so mode 'drags' minimises drags (0-1 BFS) and mode 'steps'
// minimises single steps (plain BFS, smaller and faster, used for hints).
// Returns { steps: [[pen, dx, dy], …], drags, explored } or null (unsolvable or too big).
export function solve(st0, { mode = 'drags', maxStates = 200000 } = {}) {
  const { w, h } = st0;
  const n = st0.pens.length;
  const sheep = [];
  st0.cells.forEach((v, k) => v >= 0 && sheep.push(k));
  if (sheep.length > 30) throw new Error('solver supports at most 30 sheep');
  if (sheep.length === 0) return { steps: [], drags: 0, explored: 1 };
  const full = (1 << sheep.length) - 1;
  const sheepBit = new Int32Array(w * h);
  sheep.forEach((k, b) => (sheepBit[k] = 1 << b));
  const colorMask = new Array(COLORS).fill(0);
  sheep.forEach((k, b) => (colorMask[st0.cells[k]] |= 1 << b));
  const pens = st0.pens;
  const byDrags = mode === 'drags';

  // A position is a cell index, or OFF when the pen has closed. A state is coded as one
  // number (positions in base B, times the last pen moved) plus the mask of caught sheep.
  const OFF = w * h;
  const B = OFF + 1;
  const pow = Array.from({ length: n }, (_, i) => B ** i);
  const encode = (pos) => pos.reduce((s, p, i) => s + p * pow[i], 0);

  // nodes live in parallel arrays
  const nCode = [];
  const nMask = [];
  const nLast = [];
  const nCost = [];
  const nParent = [];
  const nMove = [];
  const seen = new Map(); // mask -> Map(code * (n + 1) + last + 1 -> node)
  const remember = (code, mask, last, cost, parent, move) => {
    let m = seen.get(mask);
    if (!m) seen.set(mask, (m = new Map()));
    const key = code * (n + 1) + (byDrags ? last + 1 : 0);
    const old = m.get(key);
    if (old !== undefined && nCost[old] <= cost) return -1;
    nCode.push(code);
    nMask.push(mask);
    nLast.push(last);
    nCost.push(cost);
    nParent.push(parent);
    nMove.push(move);
    m.set(key, nCode.length - 1);
    return nCode.length - 1;
  };

  remember(encode(pens.map((p) => (p.done ? OFF : p.y * w + p.x))), 0, -1, 0, -1, -1);
  let front = [0];
  let back = [];
  let head = 0;
  const grid = new Int16Array(w * h);
  const pos = new Array(n);

  while (head < front.length || back.length) {
    // 0-1 BFS: front holds the current cost (read in order), back the cost one higher
    if (head >= front.length) {
      front = back;
      back = [];
      head = 0;
    }
    const idx = front[head++];
    const mask0 = nMask[idx];
    if (mask0 === full) return finish(idx);

    let code = nCode[idx];
    for (let i = 0; i < n; i++) {
      pos[i] = code % B;
      code = Math.floor(code / B);
    }
    // occupancy: -3 hedge, -2 empty, 0..n-1 pen, 100+c uncaught sheep of colour c
    for (let k = 0; k < OFF; k++) {
      const v = st0.cells[k];
      grid[k] = v === HEDGE ? -3 : v >= 0 && !(mask0 & sheepBit[k]) ? 100 + v : -2;
    }
    for (let i = 0; i < n; i++) {
      if (pos[i] === OFF) continue;
      const px = pos[i] % w;
      const py = (pos[i] - px) / w;
      for (let y = py; y < py + pens[i].h; y++) for (let x = px; x < px + pens[i].w; x++) grid[y * w + x] = i;
    }

    const base = nCode[idx];
    for (let i = 0; i < n; i++) {
      if (pos[i] === OFF) continue;
      const P = pens[i];
      const px = pos[i] % w;
      const py = (pos[i] - px) / w;
      for (let d = 0; d < 4; d++) {
        const nx = px + DIRS[d][0];
        const ny = py + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx + P.w > w || ny + P.h > h) continue;
        let ok = true;
        let mask = mask0;
        for (let y = ny; y < ny + P.h && ok; y++) {
          for (let x = nx; x < nx + P.w; x++) {
            const v = grid[y * w + x];
            if (v === -2 || v === i) continue;
            if (v === 100 + P.c) mask |= sheepBit[y * w + x];
            else {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        let np = ny * w + nx;
        let last = i;
        if (mask !== mask0 && (mask & colorMask[P.c]) === colorMask[P.c]) {
          np = OFF; // the pen closes and leaves
          last = -1;
        }
        const extra = byDrags ? (nLast[idx] !== i ? 1 : 0) : 1;
        const cost = nCost[idx] + extra;
        const at = remember(base + (np - pos[i]) * pow[i], mask, last, cost, idx, i * 4 + d);
        if (at < 0) continue;
        if (nCode.length >= maxStates) return null;
        if (extra) back.push(at);
        else front.push(at);
      }
    }
  }
  return null;

  function finish(idx) {
    const steps = [];
    for (let k = idx; nParent[k] >= 0; k = nParent[k]) {
      const m = nMove[k];
      steps.push([m >> 2, DIRS[m & 3][0], DIRS[m & 3][1]]);
    }
    steps.reverse();
    let drags = 0;
    steps.forEach((s, k) => (k === 0 || steps[k - 1][0] !== s[0]) && drags++);
    return { steps, drags, explored: nCode.length };
  }
}

// The steps of the first drag in a solution: the pen to move and where it goes.
export function firstDrag(sol) {
  if (!sol || !sol.steps.length) return null;
  const pen = sol.steps[0][0];
  const steps = [];
  for (const s of sol.steps) {
    if (s[0] !== pen) break;
    steps.push([s[1], s[2]]);
  }
  return { pen, steps };
}

// A cheap hint when the full solver gives up: the shortest path for one pen, with the
// others standing still, to the nearest sheep of its own colour it can reach.
export function nearestCatch(st) {
  let best = null;
  st.pens.forEach((p, i) => {
    if (p.done) return;
    const seen = new Set([p.x * 64 + p.y]);
    const queue = [[p.x, p.y, []]];
    for (let q = 0; q < queue.length; q++) {
      const [x, y, path] = queue[q];
      if (best && path.length >= best.steps.length) break;
      for (const [dx, dy] of DIRS) {
        const t = clone(st);
        t.pens[i].x = x;
        t.pens[i].y = y;
        if (blocked(t, i, dx, dy)) continue;
        const key = (x + dx) * 64 + (y + dy);
        if (seen.has(key)) continue;
        seen.add(key);
        const r = step(t, i, dx, dy);
        const next = [...path, [dx, dy]];
        if (r.caught.length) {
          if (!best || next.length < best.steps.length) best = { pen: i, steps: next };
          continue;
        }
        queue.push([x + dx, y + dy, next]);
      }
    }
  });
  return best;
}

/* ---------- generator ---------- */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEN_SHAPES = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3]];

// One meadow built backwards from a solution, so it can always be solved:
// 1. place the pens on an open meadow,
// 2. play a random game: drags of random pens in random order, each pen closing after its
//    last drag,
// 3. put a pen's sheep only on cells that this pen was the first to reach (so nothing else
//    passed there before the sheep went home), always including the cell its very last step
//    reached (so the pen closes exactly when the played game says it did),
// 4. let hedges grow on cells that no pen ever touched.
// tools/make-levels.mjs then solves the result to measure how hard it is.
//   spec: { w, h, pens, shapes, drags: [min, max] per pen, walk: [min, max] steps per drag,
//           sheep: [min, max] per pen, hedge: share of untouched cells that become hedges }
export function buildLevel(spec, seed) {
  const rnd = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const { w, h } = spec;
  const N = w * h;
  const st = { w, h, cells: new Array(N).fill(EMPTY), pens: [] };
  const colors = [0, 1, 2, 3, 4, 5].sort(() => rnd() - 0.5).slice(0, spec.pens).sort((a, b) => a - b);
  const cover = (p) => {
    const out = [];
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) out.push(y * w + x);
    return out;
  };

  // 1. pens
  for (const c of colors) {
    for (let tries = 0; tries < 80; tries++) {
      const [pw, ph] = PEN_SHAPES[spec.shapes[int(0, spec.shapes.length - 1)]];
      const p = { c, x: int(0, w - pw), y: int(0, h - ph), w: pw, h: ph, need: 0, home: 0, done: false };
      if (cover(p).some((k) => penAt(st, k % w, (k / w) | 0) >= 0)) continue;
      st.pens.push(p);
      break;
    }
  }
  const n = st.pens.length;
  const first = new Array(N).fill(-1); // pen that reached the cell first (time 0 counts)
  const firstAt = new Array(N).fill(-1); // and when
  const touched = new Array(N).fill(false);
  const later = Array.from({ length: N }, () => new Set()); // pens that came by after the first
  st.pens.forEach((p, i) => cover(p).forEach((k) => ((first[k] = i), (firstAt[k] = 0), (touched[k] = true))));

  // 2. play
  const sim = clone(st);
  const plan = [];
  st.pens.forEach((_, i) => {
    for (let d = int(spec.drags[0], spec.drags[1]); d > 0; d--) plan.push(i);
  });
  for (let k = plan.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [plan[k], plan[j]] = [plan[j], plan[k]];
  }
  const lastDrag = new Array(n).fill(-1);
  plan.forEach((i, k) => (lastDrag[i] = k));
  const lastNew = new Array(n).fill(-1); // newest first-reached cell of each pen
  let time = 0;
  plan.forEach((i, k) => {
    const p = sim.pens[i];
    let [dx, dy] = DIRS[int(0, 3)];
    let len = int(spec.walk[0], spec.walk[1]);
    // the last drag keeps walking until it reaches a new cell, so the pen has a cell to close on
    for (let s = 0; s < len + 12; s++) {
      if (s >= len && (k !== lastDrag[i] || lastNew[i] >= 0 && firstAt[lastNew[i]] === time)) break;
      if (rnd() < 0.3) [dx, dy] = DIRS[int(0, 3)];
      let moved = false;
      for (let t = 0; t < 4 && !moved; t++) {
        if (!blocked(sim, i, dx, dy)) {
          p.x += dx;
          p.y += dy;
          moved = true;
        } else [dx, dy] = DIRS[int(0, 3)];
      }
      if (!moved) break;
      time++;
      for (const c of cover(p)) {
        touched[c] = true;
        if (first[c] >= 0 && first[c] !== i) later[c].add(i);
        if (first[c] < 0) {
          first[c] = i;
          firstAt[c] = time;
          lastNew[i] = c;
        }
      }
    }
    if (k === lastDrag[i]) p.done = true; // the pen closes and leaves the meadow
  });

  // 3. sheep
  st.pens.forEach((p, i) => {
    const mine = [];
    for (let c = 0; c < N; c++) if (first[c] === i && firstAt[c] > 0) mine.push(c);
    if (!mine.length) return;
    const want = Math.min(mine.length, int(spec.sheep[0], spec.sheep[1]));
    const chosen = new Set([lastNew[i]]);
    while (chosen.size < want) chosen.add(mine[int(0, mine.length - 1)]);
    chosen.forEach((c) => (st.cells[c] = p.c));
    p.need = chosen.size;
  });
  // Order: pen d depends on pen c when d's way crosses a cell where c's sheep stood.
  const deps = new Set();
  st.cells.forEach((v, c) => v >= 0 && later[c].forEach((d) => deps.add(st.pens[first[c]].c * 8 + st.pens[d].c)));
  st.deps = deps.size;
  st.pens = st.pens.filter((p) => p.need > 0);

  // 4. hedges
  for (let c = 0; c < N; c++) if (!touched[c] && rnd() < spec.hedge) st.cells[c] = HEDGE;
  return st;
}

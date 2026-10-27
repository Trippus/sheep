// Rules for Bring the Sheep Home. Pure functions, no DOM, so they run in Node and in tests.
//
// The meadow is a w×h grid packed with pens: shapes of 1–4 cells (bars, squares, L, T, S).
// The player drags one pen at a time, one cell per step. Pens stop at the edge and at each
// other, so most of the puzzle is getting them past one another.
//
// Sheep stand on the meadow and in queues just outside its edge. A pen has stages: a colour
// and how many sheep it holds, e.g. '3 pink, then 2 blue'. Driving onto a sheep of its colour
// brings it home, but only if there is room; sheep of other colours block the way. A pen that
// covers the edge cell next to a queue takes the sheep at the front of the queue, as long as
// they have its colour and there is room. When a stage is full the pen turns to its next
// colour; after the last stage it closes and leaves. Some pens are locked until every sheep
// carrying a key is home. The level is won when all pens have closed.
//
// The state is split in two: the level (what never changes) and a small state object (where
// the pens are and who is home), so states are cheap to copy, save and search.

export const COLORS = 6;
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left

/* ---------- shapes ---------- */

// A shape is written as its cells 'x y' in one string: '00 10 11' is a small L.
export const parseShape = (str) => str.split(' ').map(([x, y]) => [+x, +y]);
const shapeKey = (cells) => cells.map(([x, y]) => `${x}${y}`).sort().join(' ');

function normalize(cells) {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]);
}

// Every rotation and mirror image of a few base shapes, grouped by family.
const BASE = {
  one: '00',
  two: '00 10',
  three: '00 10 20',
  corner: '00 01 11',
  square: '00 10 01 11',
  four: '00 10 20 30',
  L: '00 01 02 12',
  T: '00 10 20 11',
  S: '10 20 01 11',
};
export const SHAPES = {};
for (const [family, base] of Object.entries(BASE)) {
  const seen = new Set();
  let cells = parseShape(base);
  for (let m = 0; m < 2; m++) {
    for (let r = 0; r < 4; r++) {
      cells = normalize(cells.map(([x, y]) => [-y, x]));
      seen.add(shapeKey(cells));
    }
    cells = normalize(cells.map(([x, y]) => [-x, y]));
  }
  SHAPES[family] = [...seen];
}

/* ---------- levels ---------- */

// A level is stored compactly:
//   g: w*h characters, row by row: '.' grass, 'a'..'f' a sheep of colour 0..5, 'A'..'F' one carrying a key
//   q: queues [x, y, side, sheep]: outside edge cell (x, y) on side n/e/s/w, front sheep first ('abA')
//   p: pens [shape, x, y, stages, locked]: stages like 'a3b2' = 3 of colour a, then 2 of colour b
//   d: the fewest drags that solve it (par), 0 when unknown
const colorOf = (ch) => ch.toLowerCase().charCodeAt(0) - 97;
const isKey = (ch) => ch !== ch.toLowerCase();

export function parseLevel(raw) {
  const { w, h } = raw;
  const sheep = [];
  const sheepAt = new Int16Array(w * h).fill(-1);
  [...raw.g].forEach((ch, k) => {
    if (ch === '.') return;
    sheepAt[k] = sheep.length;
    sheep.push({ k, c: colorOf(ch), key: isKey(ch) });
  });
  const queues = (raw.q || []).map(([x, y, side, str]) => ({ x, y, side, sheep: [...str].map((ch) => ({ c: colorOf(ch), key: isKey(ch) })) }));
  const anchors = Array.from({ length: w * h }, () => []);
  queues.forEach((q, i) => anchors[q.y * w + q.x].push(i));
  const pens = raw.p.map(([shape, x, y, st, lock]) => {
    const cells = parseShape(shape);
    const stages = [...st.matchAll(/([a-f])(\d+)/g)].map((m) => [colorOf(m[1]), +m[2]]);
    return { shape, cells, x0: x, y0: y, stages, lock: !!lock };
  });
  const keys = sheep.filter((s) => s.key).length + queues.reduce((n, q) => n + q.sheep.filter((s) => s.key).length, 0);
  return { w, h, sheep, sheepAt, queues, anchors, pens, keys, par: raw.d || 0 };
}

export function startState(L) {
  const s = {
    x: L.pens.map((p) => p.x0),
    y: L.pens.map((p) => p.y0),
    stage: L.pens.map(() => 0),
    got: L.pens.map(() => 0),
    done: L.pens.map(() => false),
    caught: L.sheep.map(() => false),
    qh: L.queues.map(() => 0),
  };
  L.pens.forEach((_, i) => settle(L, s, i, {}));
  return s;
}

export const clone = (s) => ({
  x: s.x.slice(),
  y: s.y.slice(),
  stage: s.stage.slice(),
  got: s.got.slice(),
  done: s.done.slice(),
  caught: s.caught.slice(),
  qh: s.qh.slice(),
});

export const stateKey = (s) =>
  s.x.map((x, i) => (s.done[i] ? '-' : `${x},${s.y[i]},${s.stage[i]},${s.got[i]}`)).join(';') +
  '|' + s.caught.map((c) => (c ? 1 : 0)).join('') + '|' + s.qh.join(',');

/* ---------- reading a state ---------- */

export const penColor = (L, s, i) => L.pens[i].stages[s.stage[i]][0];
export const room = (L, s, i) => L.pens[i].stages[s.stage[i]][1] - s.got[i];
export const isWon = (s) => s.done.every(Boolean);
export const sheepTotal = (L) => L.sheep.length + L.queues.reduce((n, q) => n + q.sheep.length, 0);
export const sheepLeft = (L, s) => s.caught.filter((c) => !c).length + L.queues.reduce((n, q, i) => n + q.sheep.length - s.qh[i], 0);

export function keysLeft(L, s) {
  let n = 0;
  L.sheep.forEach((sh, i) => sh.key && !s.caught[i] && n++);
  L.queues.forEach((q, i) => {
    for (let k = s.qh[i]; k < q.sheep.length; k++) if (q.sheep[k].key) n++;
  });
  return n;
}
export const isLocked = (L, s, i) => L.pens[i].lock && keysLeft(L, s) > 0;

// Which pen covers each cell (-1 for none).
export function penGrid(L, s) {
  const grid = new Int16Array(L.w * L.h).fill(-1);
  L.pens.forEach((p, i) => {
    if (s.done[i]) return;
    for (const [dx, dy] of p.cells) grid[(s.y[i] + dy) * L.w + s.x[i] + dx] = i;
  });
  return grid;
}

export const penCells = (L, s, i) => L.pens[i].cells.map(([dx, dy]) => [s.x[i] + dx, s.y[i] + dy]);

/* ---------- moving ---------- */

// Why pen i cannot step (dx, dy), or '' when it can:
// 'done', 'locked', 'edge', 'pen', 'sheep' (another colour) or 'full' (more sheep than room).
export function blocked(L, s, i, dx, dy, grid = penGrid(L, s)) {
  if (s.done[i]) return 'done';
  if (L.pens[i].lock && keysLeft(L, s) > 0) return 'locked';
  const c = penColor(L, s, i);
  let mine = 0;
  for (const [cx, cy] of L.pens[i].cells) {
    const x = s.x[i] + cx + dx;
    const y = s.y[i] + cy + dy;
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return 'edge';
    const k = y * L.w + x;
    if (grid[k] >= 0 && grid[k] !== i) return 'pen';
    const sh = L.sheepAt[k];
    if (sh >= 0 && !s.caught[sh]) {
      if (L.sheep[sh].c !== c) return 'sheep';
      mine++;
    }
  }
  return mine > room(L, s, i) ? 'full' : '';
}

// Turns to the next stage when the current one is full; closes after the last.
function advance(L, s, i, ev) {
  while (!s.done[i] && room(L, s, i) === 0) {
    s.got[i] = 0;
    if (++s.stage[i] >= L.pens[i].stages.length) {
      s.done[i] = true;
      s.stage[i] = L.pens[i].stages.length - 1;
      ev.closed = true;
      ev.log?.push({ t: 'close' });
    } else {
      (ev.turned ||= []).push(penColor(L, s, i));
      ev.log?.push({ t: 'turn', c: penColor(L, s, i), room: room(L, s, i) });
    }
  }
}

// Takes sheep from the queues the pen touches, as long as the front one fits.
function settle(L, s, i, ev) {
  let more = true;
  while (more && !s.done[i]) {
    more = false;
    for (const [x, y] of penCells(L, s, i)) {
      for (const q of L.anchors[y * L.w + x]) {
        const Q = L.queues[q];
        while (!s.done[i] && s.qh[q] < Q.sheep.length && Q.sheep[s.qh[q]].c === penColor(L, s, i) && room(L, s, i) > 0) {
          (ev.fromQueue ||= []).push(q);
          ev.log?.push({ t: 'sheep', q, k: s.qh[q] });
          s.qh[q]++;
          s.got[i]++;
          more = true;
          advance(L, s, i, ev);
        }
      }
    }
  }
}

// Steps pen i one cell, changing s in place. Returns what happened:
// { caught: [board sheep indexes], fromQueue: [queue indexes, one per sheep], turned: [new colours],
//   log: the same in the order it happened: { t: 'sheep', sh } from the meadow, { t: 'sheep', q, k } from
//   queue q (its k-th sheep), { t: 'turn', c, room } and { t: 'close' } – the animations follow it,
//   closed, unlocked } – or null when the step is not allowed.
export function step(L, s, i, dx, dy, grid) {
  if (blocked(L, s, i, dx, dy, grid)) return null;
  const hadKeys = L.keys && keysLeft(L, s) > 0;
  s.x[i] += dx;
  s.y[i] += dy;
  const ev = { caught: [], log: [] };
  for (const [x, y] of penCells(L, s, i)) {
    const sh = L.sheepAt[y * L.w + x];
    if (sh >= 0 && !s.caught[sh]) {
      s.caught[sh] = true;
      s.got[i]++;
      ev.caught.push(sh);
      ev.log.push({ t: 'sheep', sh });
    }
  }
  advance(L, s, i, ev);
  settle(L, s, i, ev);
  if (hadKeys && keysLeft(L, s) === 0) ev.unlocked = true;
  return ev;
}

/* ---------- solver ---------- */

// Finds a shortest way home from state s0. A 'drag' is a run of steps with the same pen,
// which is what the player does with one finger, so mode 'drags' minimises drags (0-1 BFS)
// and mode 'steps' minimises single steps (plain BFS). Returns
// { steps: [[pen, dx, dy], …], drags, explored }, or null when there is no way (or it is too big).
export function solve(L, s0, { mode = 'drags', maxStates = 200000, info = {} } = {}) {
  const byDrags = mode === 'drags';
  const states = [s0];
  const last = [-1];
  const cost = [0];
  const parent = [-1];
  const move = [null];
  const seen = new Map([[stateKey(s0) + (byDrags ? '#-1' : ''), 0]]);
  let front = [0];
  let back = [];
  let head = 0;
  while (head < front.length || back.length) {
    if (head >= front.length) {
      front = back;
      back = [];
      head = 0;
    }
    const at = front[head++];
    const s = states[at];
    if (isWon(s)) return finish(at);
    const grid = penGrid(L, s);
    for (let i = 0; i < L.pens.length; i++) {
      if (s.done[i]) continue;
      for (const [dx, dy] of DIRS) {
        if (blocked(L, s, i, dx, dy, grid)) continue;
        const t = clone(s);
        step(L, t, i, dx, dy, grid);
        const nl = t.done[i] ? -1 : i;
        const extra = byDrags ? (last[at] === i ? 0 : 1) : 1;
        const c = cost[at] + extra;
        const key = stateKey(t) + (byDrags ? '#' + nl : '');
        const old = seen.get(key);
        if (old !== undefined && cost[old] <= c) continue;
        if (states.length >= maxStates) {
          info.why = 'too big';
          return null;
        }
        states.push(t);
        last.push(nl);
        cost.push(c);
        parent.push(at);
        move.push([i, dx, dy]);
        seen.set(key, states.length - 1);
        (extra ? back : front).push(states.length - 1);
      }
    }
  }
  info.why = 'no way';
  return null;

  function finish(at) {
    const steps = [];
    for (let k = at; parent[k] >= 0; k = parent[k]) steps.push(move[k]);
    steps.reverse();
    let drags = 0;
    steps.forEach((m, k) => (k === 0 || steps[k - 1][0] !== m[0]) && drags++);
    return { steps, drags, explored: states.length };
  }
}

// A quick search for some way home, not always the shortest: it always looks next at the
// state with the fewest sheep left, then the fewest drags so far. Used where the exact solver
// is too slow: to check that big levels can be solved, to set their par, and for hints.
// Explores every reachable state before saying null, so null with info.why 'no way' is certain.
// A smaller weight cares more about few drags and less about speed, for a better par.
export function search(L, s0, { maxStates = 300000, info = {}, weight = 1000 } = {}) {
  const states = [s0];
  const drags = [0];
  const last = [-1];
  const parent = [-1];
  const move = [null];
  const seen = new Set([stateKey(s0)]);
  const left = (s) => sheepLeft(L, s) * 4 + s.done.filter((d) => !d).length;
  const heap = new Heap();
  heap.push(0, left(s0));
  while (heap.size) {
    const at = heap.pop();
    const s = states[at];
    if (isWon(s)) return finish(at);
    const grid = penGrid(L, s);
    for (let i = 0; i < L.pens.length; i++) {
      if (s.done[i]) continue;
      for (const [dx, dy] of DIRS) {
        if (blocked(L, s, i, dx, dy, grid)) continue;
        const t = clone(s);
        step(L, t, i, dx, dy, grid);
        const key = stateKey(t);
        if (seen.has(key)) continue;
        if (states.length >= maxStates) {
          info.why = 'too big';
          return null;
        }
        seen.add(key);
        states.push(t);
        const d = drags[at] + (last[at] === i ? 0 : 1);
        drags.push(d);
        last.push(t.done[i] ? -1 : i);
        parent.push(at);
        move.push([i, dx, dy]);
        heap.push(states.length - 1, left(t) * weight + d);
      }
    }
  }
  info.why = 'no way';
  return null;

  function finish(at) {
    const steps = [];
    for (let k = at; parent[k] >= 0; k = parent[k]) steps.push(move[k]);
    steps.reverse();
    let n = 0;
    steps.forEach((m, k) => (k === 0 || steps[k - 1][0] !== m[0]) && n++);
    return { steps, drags: n, explored: states.length };
  }
}

// A small binary min-heap of (item, priority).
class Heap {
  constructor() {
    this.items = [];
    this.prio = [];
  }
  get size() {
    return this.items.length;
  }
  push(item, p) {
    const { items, prio } = this;
    let k = items.length;
    items.push(item);
    prio.push(p);
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (prio[up] <= p) break;
      items[k] = items[up];
      prio[k] = prio[up];
      k = up;
    }
    items[k] = item;
    prio[k] = p;
  }
  pop() {
    const { items, prio } = this;
    const top = items[0];
    const item = items.pop();
    const p = prio.pop();
    if (items.length) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= items.length) break;
        if (c + 1 < items.length && prio[c + 1] < prio[c]) c++;
        if (prio[c] >= p) break;
        items[k] = items[c];
        prio[k] = prio[c];
        k = c;
      }
      items[k] = item;
      prio[k] = p;
    }
    return top;
  }
}

// The steps of the first drag in a solution: the pen to move and where it goes.
export function firstDrag(sol) {
  if (!sol || !sol.steps.length) return null;
  const pen = sol.steps[0][0];
  const steps = [];
  for (const m of sol.steps) {
    if (m[0] !== pen) break;
    steps.push([m[1], m[2]]);
  }
  return { pen, steps };
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

// One meadow built by playing a game backwards, so it can (almost always) be solved.
// Backwards, a pen appears where it closed, and every step it takes away from a cell may
// leave behind a sheep of its colour (the sheep it caught going forward). Standing on an edge
// cell it may put sheep back at the front of a queue. When a pen has given back every sheep
// of a stage, it turns to the colour of the stage before. When every pen has appeared and
// given back all its sheep, the meadow is the start of a level. A locked pen stops moving
// once it is done; sheep given back after that can carry its keys, so going forward they are
// home before the pen has to move. tools/make-levels.mjs then solves each level forward to
// check it and to set its par.
//   spec: { w, h, pens: [min, max], shapes: [families], perStage: [min, max] sheep,
//           twoStage: chance of two colours, queues: max queues, toQueue: chance to fill a
//           queue when standing at the edge, drop: chance to leave a sheep on a cell,
//           lock: chance of a locked pen, shuffle: extra steps once all sheep are out }
export function buildLevel(spec, seed) {
  const rnd = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const { w, h } = spec;
  const N = w * h;

  // the pens and their stages
  const n = int(spec.pens[0], spec.pens[1]);
  const palette = [0, 1, 2, 3, 4, 5].sort(() => rnd() - 0.5).slice(0, Math.min(6, n));
  const pens = [];
  for (let i = 0; i < n; i++) {
    const shape = pick(SHAPES[pick(spec.shapes)]);
    const c = i < palette.length ? palette[i] : pick(palette);
    const stages = [[c, int(spec.perStage[0], spec.perStage[1])]];
    if (palette.length > 1 && rnd() < spec.twoStage) stages.push([pick(palette.filter((x) => x !== c)), int(spec.perStage[0], spec.perStage[1])]);
    pens.push({ shape, cells: parseShape(shape), stages, x: -1, y: -1, stage: stages.length - 1, given: 0, done: false, out: false });
  }
  const lockPen = n > 2 && rnd() < spec.lock ? int(0, n - 1) : -1;
  let frozen = false;

  const occ = new Int16Array(N).fill(-1);
  const sheep = new Array(N).fill(-1); // colour on each cell
  const late = []; // sheep given back after the locked pen froze: ['g', cell] or ['q', queue, sheep]
  const queues = new Map(); // 'x,y,side' -> { x, y, side, sheep: [colour…] front first, keys: Set }
  const fits = (p, x, y, me) =>
    p.cells.every(([cx, cy]) => {
      const X = x + cx;
      const Y = y + cy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) return false;
      const k = Y * w + X;
      return (occ[k] < 0 || occ[k] === me) && sheep[k] < 0;
    });
  const place = (i, v) => pens[i].cells.forEach(([cx, cy]) => (occ[(pens[i].y + cy) * w + pens[i].x + cx] = v));
  const color = (p) => p.stages[p.stage][0];
  // one sheep given back; turns to the stage before when this stage is all out
  const giveBack = (p) => {
    p.given++;
    if (p.given >= p.stages[p.stage][1]) {
      p.given = 0;
      if (--p.stage < 0) {
        p.stage = 0;
        p.done = true;
        if (p === pens[lockPen]) frozen = true; // from now on, sheep given back can carry its keys
      }
    }
  };

  const penAtOwnQueue = (p) =>
    p.cells.some(([cx, cy]) => {
      const X = p.x + cx;
      const Y = p.y + cy;
      return ['n', 's', 'w', 'e'].some((side) => queues.get(`${X},${Y},${side}`)?.sheep[0] === p.stages[0][0]);
    });
  const atOwnQueue = () => pens.some(penAtOwnQueue);
  const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
  // the locked pen closes last going forward, so it appears first here and others give back keys after it
  if (lockPen >= 0) order.unshift(...order.splice(order.indexOf(lockPen), 1));
  let appeared = 0;
  let extra = spec.shuffle;
  for (let iter = 0; iter < 6000; iter++) {
    // once done, the locked pen keeps still, unless it waits at its own queue and must step away
    const active = pens.map((p, i) => i).filter((i) => pens[i].out && !(i === lockPen && frozen && !penAtOwnQueue(pens[i])));
    const working = active.filter((i) => !pens[i].done);
    if (appeared < n && (!working.length || rnd() < 0.25)) {
      // the next pen appears where it will close: at the edge, by a queue
      const i = order[appeared];
      const p = pens[i];
      for (let t = 0; t < 80; t++) {
        const x = int(0, w - 1);
        const y = int(0, h - 1);
        const edge = p.cells.some(([cx, cy]) => x + cx === 0 || y + cy === 0 || x + cx === w - 1 || y + cy === h - 1);
        if (!edge || !fits(p, x, y, i)) continue;
        p.x = x;
        p.y = y;
        p.out = true;
        place(i, i);
        appeared++;
        break;
      }
      continue;
    }
    if (!working.length) {
      if (appeared < n) continue;
      // a few free moves to tangle the start, and on until no pen waits at a queue of its colour
      if (!active.length || (extra-- <= 0 && !atOwnQueue())) break;
    }
    // a done locked pen still standing at its own queue steps away first, so the keys come after
    const leaving = lockPen >= 0 && frozen && penAtOwnQueue(pens[lockPen]);
    const i = leaving ? lockPen : working.length ? pick(working) : pick(active);
    const p = pens[i];

    // at the edge: maybe put sheep back at the front of a queue
    if (!p.done && rnd() < spec.toQueue) {
      const spots = [];
      for (const [cx, cy] of p.cells) {
        const X = p.x + cx;
        const Y = p.y + cy;
        if (Y === 0) spots.push([X, Y, 'n']);
        if (Y === h - 1) spots.push([X, Y, 's']);
        if (X === 0) spots.push([X, Y, 'w']);
        if (X === w - 1) spots.push([X, Y, 'e']);
      }
      if (spots.length) {
        const [X, Y, side] = pick(spots);
        const id = `${X},${Y},${side}`;
        if (queues.has(id) || queues.size < spec.queues) {
          if (!queues.has(id)) queues.set(id, { x: X, y: Y, side, sheep: [], keys: new Set() });
          const Q = queues.get(id);
          const c = color(p);
          // going forward the pen takes the whole run of its colour at the front, so only
          // put sheep back if the sheep behind is another colour or the stage starts here
          if (!Q.sheep.length || Q.sheep[0] !== c || p.given === 0) {
            // mostly one sheep at a time, so the colours in a shelter end up well mixed
            const m = rnd() < (spec.mix ?? 0) ? 1 : int(1, p.stages[p.stage][1] - p.given);
            for (let k = 0; k < m; k++) {
              Q.sheep.unshift(c);
              if (frozen) late.push(['q', Q]);
              giveBack(p);
            }
            continue;
          }
        }
      }
    }

    // a short walk; cells left behind may get a sheep of the pen's colour
    let [dx, dy] = pick(DIRS);
    for (let s = int(1, 4); s > 0; s--) {
      if (rnd() < 0.3) [dx, dy] = pick(DIRS);
      if (!fits(p, p.x + dx, p.y + dy, i)) break;
      const before = p.cells.map(([cx, cy]) => (p.y + cy) * w + p.x + cx);
      if (i === lockPen && frozen) late.length = 0; // keys must come home after its last move
      place(i, -1);
      p.x += dx;
      p.y += dy;
      place(i, i);
      const stage = p.stage;
      for (const k of before) {
        if (occ[k] === i || p.done || p.stage !== stage || rnd() >= spec.drop) continue;
        sheep[k] = color(p);
        if (frozen) late.push(['g', k]);
        giveBack(p);
      }
      if (p.stage !== stage || p.done) break;
    }
  }
  if (appeared < n || pens.some((p) => !p.done)) return null;

  const g = sheep.map((c) => (c < 0 ? '.' : String.fromCharCode(97 + c)));
  const qs = [...queues.values()].filter((Q) => Q.sheep.length);
  const qStr = qs.map((Q) => Q.sheep.map((c) => String.fromCharCode(97 + c)));
  let lock = 0;
  if (lockPen >= 0) {
    const mine = new Set(pens[lockPen].stages.map(([c]) => c));
    const cand = late.filter((e) => (e[0] === 'g' ? !mine.has(sheep[e[1]]) : true));
    if (cand.length) {
      lock = 1;
      for (const e of cand.sort(() => rnd() - 0.5).slice(0, int(1, 2))) {
        if (e[0] === 'g') g[e[1]] = g[e[1]].toUpperCase();
        else {
          // the front of a queue that got sheep late was itself given back late
          const qi = qs.indexOf(e[1]);
          const ch = qStr[qi][0];
          if (ch === ch.toLowerCase() && !mine.has(colorOf(ch))) qStr[qi][0] = ch.toUpperCase();
        }
      }
    }
  }
  const raw = {
    w,
    h,
    g: g.join(''),
    q: qs.map((Q, qi) => [Q.x, Q.y, Q.side, qStr[qi].join('')]),
    p: pens.map((p, i) => [p.shape, p.x, p.y, p.stages.map(([c, m]) => String.fromCharCode(97 + c) + m).join(''), i === lockPen && lock ? 1 : 0]),
  };
  // a pen standing at its queue at the start would take sheep before the player moves
  const L = parseLevel(raw);
  const s0 = startState(L);
  if (s0.qh.some(Boolean) || s0.got.some(Boolean) || s0.stage.some(Boolean)) return null;
  return raw;
}

// Fills a built level up with extra sheep, one at a time on free cells, until `full` of the
// meadow is pens or sheep. Each extra sheep gives a pen of its colour one more place, and is
// only kept if the level can still be solved, so the meadow gets crowded but stays fair.
export function fillLevel(raw, { full, seed, maxStates = 150000 }) {
  const rnd = mulberry32(seed);
  const N = raw.w * raw.h;
  let cur = JSON.parse(JSON.stringify(raw));
  const L0 = parseLevel(cur);
  const s0 = startState(L0);
  const covered = new Set();
  L0.pens.forEach((p, i) => penCells(L0, s0, i).forEach(([x, y]) => covered.add(y * raw.w + x)));
  const used = () => covered.size + [...cur.g].filter((ch) => ch !== '.').length;
  const free = [...Array(N).keys()].filter((k) => !covered.has(k) && cur.g[k] === '.').sort(() => rnd() - 0.5);
  for (const k of free) {
    if (used() >= full * N) break;
    const pi = Math.floor(rnd() * cur.p.length);
    const stages = [...cur.p[pi][3].matchAll(/([a-f])(\d+)/g)].map((m) => [m[1], +m[2]]);
    const si = Math.floor(rnd() * stages.length);
    if (stages[si][1] >= 9) continue;
    stages[si][1]++;
    const next = JSON.parse(JSON.stringify(cur));
    next.g = cur.g.slice(0, k) + stages[si][0] + cur.g.slice(k + 1);
    next.p[pi][3] = stages.map(([c, n]) => c + n).join('');
    const L = parseLevel(next);
    const s = startState(L);
    if (s.qh.some(Boolean) || s.got.some(Boolean)) continue;
    if (search(L, s, { maxStates })) cur = next;
  }
  return cur;
}

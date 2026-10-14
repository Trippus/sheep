// Unit tests for the rules in js/sheep.js. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../js/sheep.js';
import { LEVELS } from '../../js/levels.js';

// A small meadow written as rows; pens as [colour, x, y, w, h].
const meadow = (rows, pens) => S.parseLevel({ w: rows[0].length, h: rows.length, g: rows.join(''), p: pens });

// Plays a list of [pen, dx, dy] steps and fails if one is not allowed.
function play(st, steps) {
  for (const [i, dx, dy] of steps) assert.ok(S.step(st, i, dx, dy), `step ${i} ${dx},${dy} allowed`);
  return st;
}

test('parseLevel counts sheep per pen, and encodeLevel gives the level back', () => {
  const L = { w: 3, h: 2, g: '.a#b.a', p: [[0, 0, 0, 1, 1], [1, 2, 1, 1, 1]] };
  const st = S.parseLevel(L);
  assert.deepEqual(st.pens.map((p) => p.need), [2, 1]);
  assert.equal(S.sheepTotal(st), 3);
  assert.deepEqual(S.encodeLevel(st), L);
});

test('a pen catches sheep of its own colour', () => {
  const st = meadow(['.a.'], [[0, 0, 0, 1, 1]]);
  const r = S.step(st, 0, 1, 0);
  assert.deepEqual(r, { caught: [1], closed: true });
  assert.equal(st.cells[1], S.EMPTY);
  assert.equal(st.pens[0].done, true);
  assert.equal(S.isWon(st), true);
});

test('edges, hedges, other pens and sheep of other colours stop a pen', () => {
  const st = meadow(['.#.', '.b.', '...'], [[0, 0, 0, 1, 1], [1, 2, 2, 1, 1], [2, 0, 2, 1, 1]]);
  st.pens[2].need = 1; // keep pen 2 on the meadow even though it has no sheep here
  st.pens[0].need = 1;
  assert.equal(S.blocked(st, 0, -1, 0), 'edge');
  assert.equal(S.blocked(st, 0, 1, 0), 'hedge');
  assert.equal(S.blocked(st, 0, 0, 1), '');
  play(st, [[0, 0, 1]]);
  assert.equal(S.blocked(st, 0, 1, 0), 'sheep');
  assert.equal(S.blocked(st, 0, 0, 1), 'pen');
  assert.equal(S.step(st, 0, 1, 0), null, 'a blocked step changes nothing');
  assert.deepEqual([st.pens[0].x, st.pens[0].y], [0, 1]);
});

test('a big pen catches every sheep it covers, and only counts what is left', () => {
  const st = meadow(['...', 'aa.', 'a..'], [[0, 0, 0, 2, 1]]);
  assert.equal(st.pens[0].need, 3);
  const r = S.step(st, 0, 0, 1);
  assert.deepEqual(r.caught, [3, 4]);
  assert.equal(r.closed, false);
  assert.equal(st.pens[0].need - st.pens[0].home, 1);
  play(st, [[0, 0, 1]]);
  assert.equal(S.isWon(st), true);
});

test('a closed pen leaves the meadow and makes room', () => {
  // the blue pen is boxed in until the pink pen has fetched its sheep and closed
  const st = meadow(['b#', '.a', '#.'], [[0, 0, 1, 1, 1], [1, 1, 2, 1, 1]]);
  assert.equal(S.blocked(st, 1, 0, -1), 'sheep');
  play(st, [[0, 1, 0]]);
  assert.equal(st.pens[0].done, true);
  assert.equal(S.penAt(st, 1, 1), -1);
  play(st, [[1, 0, -1], [1, -1, 0], [1, 0, -1]]);
  assert.equal(S.isWon(st), true);
});

test('the solver finds the fewest drags, and its steps really win', () => {
  const L = meadow(['b#', '.a', '#.'], [[0, 0, 1, 1, 1], [1, 1, 2, 1, 1]]);
  const sol = S.solve(S.clone(L));
  assert.equal(sol.drags, 2);
  assert.equal(S.isWon(play(S.clone(L), sol.steps)), true);
  const fast = S.solve(S.clone(L), { mode: 'steps' });
  assert.equal(fast.steps.length, 4);
});

test('the solver says null when there is no way home', () => {
  const st = meadow(['.#a'], [[0, 0, 0, 1, 1]]);
  assert.equal(S.solve(st), null);
});

test('buildLevel: the same seed gives the same meadow (F11)', () => {
  const spec = { w: 6, h: 7, pens: 4, shapes: [0, 1, 2, 3, 4, 5], drags: [1, 2], walk: [2, 5], sheep: [3, 5], hedge: 0.9 };
  assert.deepEqual(S.encodeLevel(S.buildLevel(spec, 4242)), S.encodeLevel(S.buildLevel(spec, 4242)));
  assert.notDeepEqual(S.encodeLevel(S.buildLevel(spec, 4242)), S.encodeLevel(S.buildLevel(spec, 4243)));
});

test('buildLevel always makes meadows that can be solved', () => {
  const spec = { w: 5, h: 6, pens: 3, shapes: [0, 1, 2, 3], drags: [1, 2], walk: [2, 5], sheep: [3, 4], hedge: 0.8 };
  for (let seed = 1; seed <= 20; seed++) {
    const st = S.buildLevel(spec, seed);
    assert.ok(S.solve(st, { maxStates: 2000000 }), `seed ${seed} can be solved`);
  }
});

test('every level is well formed', () => {
  assert.equal(LEVELS.length, 120);
  LEVELS.forEach((L, n) => {
    const st = S.parseLevel(L);
    assert.equal(L.g.length, L.w * L.h, `level ${n + 1} grid size`);
    assert.match(L.g, /^[.#a-f]+$/);
    const colors = st.pens.map((p) => p.c);
    assert.equal(new Set(colors).size, colors.length, `level ${n + 1}: one pen per colour`);
    for (const v of st.cells) if (v >= 0) assert.ok(colors.includes(v), `level ${n + 1}: every sheep has a pen`);
    st.pens.forEach((p, i) => {
      assert.ok(p.need > 0, `level ${n + 1}: pen ${i} has sheep`);
      for (let y = p.y; y < p.y + p.h; y++) {
        for (let x = p.x; x < p.x + p.w; x++) {
          assert.ok(x < st.w && y < st.h, `level ${n + 1}: pen inside the meadow`);
          assert.equal(st.cells[y * st.w + x], S.EMPTY, `level ${n + 1}: pen stands on grass`);
          assert.equal(S.penAt(st, x, y), i, `level ${n + 1}: pens do not overlap`);
        }
      }
    });
  });
});

test('levels with a measured best are solved in exactly that many drags', () => {
  LEVELS.forEach((L, n) => {
    if (!L.d || L.w * L.h > 30) return; // keep the test quick: the small ones
    const sol = S.solve(S.parseLevel(L), { maxStates: 400000 });
    assert.equal(sol?.drags, L.d, `level ${n + 1}`);
  });
});

test('levels get bigger as you go', () => {
  const size = (L) => L.p.length;
  assert.ok(size(LEVELS[0]) <= size(LEVELS[30]) && size(LEVELS[30]) <= size(LEVELS[119]));
});

test('no dead ends: after random moves every small level can still be solved', () => {
  const rnd = S.mulberry32(7);
  LEVELS.slice(0, 30).forEach((L, n) => {
    const st = S.parseLevel(L);
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(rnd() * st.pens.length);
      const [dx, dy] = S.DIRS[Math.floor(rnd() * 4)];
      S.step(st, i, dx, dy);
    }
    assert.ok(S.isWon(st) || S.solve(st, { maxStates: 400000 }), `level ${n + 1} still solvable`);
  });
});

test('hints are legal moves that bring a sheep closer to home', () => {
  for (const n of [0, 5, 20, 50, 100]) {
    const st = S.parseLevel(LEVELS[n]);
    const h = S.firstDrag(S.solve(S.clone(st), { mode: 'steps', maxStates: 40000 })) || S.nearestCatch(st);
    assert.ok(h, `level ${n + 1} has a hint`);
    const before = S.sheepLeft(st);
    play(st, h.steps.map(([dx, dy]) => [h.pen, dx, dy]));
    assert.ok(S.sheepLeft(st) <= before);
  }
});

test('nearestCatch walks a pen to its closest sheep', () => {
  const st = meadow(['....', '#..a', 'a...'], [[0, 0, 0, 1, 1]]);
  const h = S.nearestCatch(st);
  assert.equal(h.pen, 0);
  assert.equal(h.steps.length, 4); // around the hedge, or along the top: both 4 steps
  play(st, h.steps.map(([dx, dy]) => [0, dx, dy]));
  assert.equal(S.sheepLeft(st), 1);
});

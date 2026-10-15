// Unit tests for the rules in js/sheep.js. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../js/sheep.js';
import { LEVELS } from '../../js/levels.js';

// A small meadow written as rows, with queues and pens in the level format.
function meadow(rows, pens, queues = []) {
  const L = S.parseLevel({ w: rows[0].length, h: rows.length, g: rows.join(''), q: queues, p: pens });
  return { L, s: S.startState(L) };
}
// Plays [pen, dx, dy] steps and fails if one is not allowed.
function play(L, s, steps) {
  for (const [i, dx, dy] of steps) assert.ok(S.step(L, s, i, dx, dy), `step ${i} ${dx},${dy} allowed`);
  return s;
}

test('shapes come in every rotation and mirror image', () => {
  const counts = Object.fromEntries(Object.entries(S.SHAPES).map(([k, v]) => [k, v.length]));
  assert.deepEqual(counts, { one: 1, two: 2, three: 2, corner: 4, square: 1, four: 2, L: 8, T: 4, S: 4 });
});

test('parseLevel reads sheep, keys, queues, stages and locks', () => {
  const { L } = meadow(['.aB', '...'], [['00 10', 0, 1, 'a1b2', 0], ['00', 2, 1, 'c2', 1]], [[2, 0, 'n', 'Cc']]);
  assert.equal(L.sheep.length, 2);
  assert.equal(L.sheep[1].key, true);
  assert.deepEqual(L.pens[0].stages, [[0, 1], [1, 2]]);
  assert.equal(L.pens[1].lock, true);
  assert.equal(L.keys, 2);
  assert.equal(S.sheepTotal(L), 4);
  assert.deepEqual(L.anchors[2], [0]);
});

test('a pen brings sheep of its colour home and closes when full', () => {
  const { L, s } = meadow(['.aa'], [['00', 0, 0, 'a2', 0]]);
  const ev = S.step(L, s, 0, 1, 0);
  assert.deepEqual(ev.caught, [0]);
  assert.equal(S.room(L, s, 0), 1);
  const ev2 = S.step(L, s, 0, 1, 0);
  assert.equal(ev2.closed, true);
  assert.equal(S.isWon(s), true);
});

test('edges, other pens, other colours and a full pen stop a move', () => {
  const { L, s } = meadow(['.b.', '...', 'aa.'], [['00', 0, 0, 'a1b1', 0], ['00', 2, 1, 'b1', 0], ['00 10', 0, 1, 'a2', 0]]);
  assert.equal(S.blocked(L, s, 0, -1, 0), 'edge');
  assert.equal(S.blocked(L, s, 0, 1, 0), 'sheep');
  assert.equal(S.blocked(L, s, 0, 0, 1), 'pen');
  assert.equal(S.blocked(L, s, 2, 0, 1), '', 'two sheep, room for two');
  const u = meadow(['..', 'aa'], [['00 10', 0, 0, 'a1a1', 0]]);
  assert.equal(S.blocked(u.L, u.s, 0, 0, 1), 'full', 'two sheep but room for one');
  assert.equal(S.step(u.L, u.s, 0, 0, 1), null, 'a blocked step changes nothing');
  assert.deepEqual([u.s.x[0], u.s.y[0]], [0, 0]);
});

test('a pen at a queue takes the front sheep of its colour, as many as there is room for', () => {
  const { L, s } = meadow(['..', '..'], [['00', 0, 1, 'a2', 0]], [[0, 0, 'n', 'aaab']]);
  const ev = S.step(L, s, 0, 0, -1);
  assert.deepEqual(ev.fromQueue, [0, 0]);
  assert.equal(ev.closed, true);
  assert.equal(s.qh[0], 2, 'the third pink sheep waits for another pen');
});

test('a queue stops at a sheep of another colour', () => {
  const { L, s } = meadow(['..', '..'], [['00', 1, 1, 'a3', 0]], [[1, 0, 'e', 'aba']]);
  S.step(L, s, 0, 0, -1);
  assert.equal(s.qh[0], 1);
  assert.equal(S.room(L, s, 0), 2);
});

test('a pen turns to its next colour and goes on taking from the queue', () => {
  const { L, s } = meadow(['..', '..'], [['00', 0, 1, 'a1b2', 0]], [[0, 0, 'w', 'abbb']]);
  const ev = S.step(L, s, 0, 0, -1);
  assert.deepEqual(ev.turned, [1]);
  assert.equal(ev.closed, true);
  assert.equal(s.qh[0], 3);
});

test('a locked pen cannot move until every sheep with a key is home', () => {
  const { L, s } = meadow(['.A', '..'], [['00', 0, 0, 'a1', 0], ['00', 0, 1, 'b1', 1]], [[1, 1, 'e', 'b']]);
  assert.equal(S.isLocked(L, s, 1), true);
  assert.equal(S.blocked(L, s, 1, 1, 0), 'locked');
  const ev = S.step(L, s, 0, 1, 0);
  assert.equal(ev.unlocked, true);
  assert.equal(S.isLocked(L, s, 1), false);
  play(L, s, [[1, 1, 0]]);
  assert.equal(S.isWon(s), true);
});

test('a closed pen leaves and makes room', () => {
  const { L, s } = meadow(['.a.', '..b'], [['00', 0, 0, 'a1', 0], ['00', 0, 1, 'b1', 0]]);
  assert.equal(S.blocked(L, s, 1, 0, -1), 'pen');
  play(L, s, [[0, 1, 0]]);
  assert.equal(s.done[0], true);
  assert.equal(S.penGrid(L, s)[1], -1, 'the cell is free again');
  assert.equal(S.blocked(L, s, 1, 0, -1), '');
});

test('the exact solver finds the fewest drags, and its steps really win', () => {
  // the blue pen is boxed in until pink has fetched its sheep and closed
  const { L, s } = meadow(['.a.', 'b..'], [['00', 0, 0, 'a1', 0], ['00 10', 1, 1, 'b1', 0]]);
  const sol = S.solve(L, s);
  assert.equal(sol.drags, 2);
  assert.equal(S.isWon(play(L, S.clone(s), sol.steps)), true);
  const quick = S.search(L, s);
  assert.equal(S.isWon(play(L, S.clone(s), quick.steps)), true);
  assert.ok(quick.drags >= sol.drags);
});

test('solver and search say "no way" when there is none', () => {
  // pink can never pass the blue sheep, and blue has no pen
  const { L, s } = meadow(['.ba'], [['00', 0, 0, 'a1', 0]]);
  const info = {};
  assert.equal(S.solve(L, s, { info }), null);
  assert.equal(info.why, 'no way');
  const info2 = {};
  assert.equal(S.search(L, s, { info: info2 }), null);
  assert.equal(info2.why, 'no way');
});

test('buildLevel: the same seed gives the same meadow (F11), and built meadows can be solved', () => {
  const spec = { w: 5, h: 6, pens: [4, 5], shapes: ['one', 'two', 'three', 'square', 'L', 'T'], perStage: [2, 4], twoStage: 0.3, lock: 0.5, drop: 0.12, toQueue: 0.85, queues: 40, shuffle: 30 };
  let built = 0;
  for (let seed = 1; built < 8 && seed < 500; seed++) {
    const raw = S.buildLevel(spec, seed);
    if (!raw) continue;
    built++;
    assert.deepEqual(S.buildLevel(spec, seed), raw);
    const L = S.parseLevel(raw);
    assert.ok(S.search(L, S.startState(L), { maxStates: 300000 }), `seed ${seed} can be solved`);
  }
  assert.equal(built, 8);
});

test('every level is well formed', () => {
  assert.equal(LEVELS.length, 120);
  LEVELS.forEach((raw, n) => {
    const L = S.parseLevel(raw);
    const s = S.startState(L);
    assert.equal(raw.g.length, raw.w * raw.h, `level ${n + 1} grid size`);
    assert.match(raw.g, /^[.a-fA-F]+$/);
    // every sheep has a place in some pen: per colour, sheep = room in stages
    const need = new Array(6).fill(0);
    L.pens.forEach((p) => p.stages.forEach(([c, k]) => (need[c] += k)));
    const have = new Array(6).fill(0);
    L.sheep.forEach((sh) => have[sh.c]++);
    L.queues.forEach((q) => q.sheep.forEach((sh) => have[sh.c]++));
    assert.deepEqual(have, need, `level ${n + 1}: sheep match the pens`);
    // pens inside, on grass, not overlapping
    const seen = new Set();
    L.pens.forEach((p, i) =>
      S.penCells(L, s, i).forEach(([x, y]) => {
        assert.ok(x >= 0 && y >= 0 && x < L.w && y < L.h, `level ${n + 1}: pen inside`);
        assert.equal(L.sheepAt[y * L.w + x], -1, `level ${n + 1}: pen on grass`);
        assert.ok(!seen.has(`${x},${y}`), `level ${n + 1}: pens do not overlap`);
        seen.add(`${x},${y}`);
      }),
    );
    assert.ok(!s.qh.some(Boolean) && !s.got.some(Boolean), `level ${n + 1}: nothing happens before the first move`);
    assert.ok(raw.d >= L.pens.length - 1, `level ${n + 1}: par is set`);
  });
});

test('the first levels can be solved, in no more drags than their par', () => {
  LEVELS.slice(0, 30).forEach((raw, n) => {
    const L = S.parseLevel(raw);
    const sol = S.search(L, S.startState(L), { maxStates: 300000 });
    assert.ok(sol, `level ${n + 1} can be solved`);
    assert.ok(sol.drags >= raw.d, `level ${n + 1}: par ${raw.d} is not beaten by the quick search`);
  });
});

test('levels get bigger and bring in the rules one at a time', () => {
  const pens = (n) => LEVELS[n].p.length;
  assert.ok(pens(0) <= pens(30) && pens(30) <= pens(119));
  assert.ok(LEVELS.slice(0, 5).every((l) => l.p.every((p) => p[4] === 0 && p[3].length <= 2)), 'first levels: no locks, one colour per pen');
  assert.ok(LEVELS.slice(50).some((l) => l.p.some((p) => p[4])), 'later levels have locks');
  assert.ok(LEVELS.slice(50).some((l) => l.p.some((p) => p[3].length > 2)), 'later levels have pens that change colour');
});

test('the hint is a legal first drag of a way home', () => {
  for (const n of [0, 10, 40, 80]) {
    const L = S.parseLevel(LEVELS[n]);
    const s = S.startState(L);
    const h = S.firstDrag(S.search(L, S.clone(s), { maxStates: 60000 }));
    assert.ok(h, `level ${n + 1} has a hint`);
    play(L, s, h.steps.map(([dx, dy]) => [h.pen, dx, dy]));
  }
});

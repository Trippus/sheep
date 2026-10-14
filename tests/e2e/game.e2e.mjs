// End-to-end tests: the real game in headless Edge, driven through its buttons and drags.
// Run: npm run test:e2e
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startGame, DOM } from './harness.mjs';

let g;
before(async () => (g = await startGame()));
after(async () => g?.stop());
beforeEach(async () => g.fresh());
afterEach(() => assert.deepEqual(g.page.errors, [], 'no errors in the browser console'));

const run = (js) => g.page.eval(DOM + js);
// Level 1: a 1×1 pen at (0, 3), its two sheep at (1, 2) and (1, 3), a hedge at (1, 0).

test('F1/F2: intro shows on launch and "Spil bane 1" opens the first meadow', async () => {
  const r = await run(`
    const introOpen = $('#intro').classList.contains('open');
    const label = $('#iPlay').textContent;
    $('#iPlay').click();
    await wait(400);
    return { introOpen, label, introAfter: $('#intro').classList.contains('open'), level: A.state.level,
      hud: $('#levelNo').textContent, home: $('#home').textContent,
      pens: document.querySelectorAll('.pen').length, sheep: document.querySelectorAll('.sheep').length };
  `);
  assert.equal(r.introOpen, true);
  assert.equal(r.label, 'Spil bane 1');
  assert.equal(r.introAfter, false);
  assert.equal(r.level, 0);
  assert.equal(r.hud, '1');
  assert.equal(r.home, '0/2');
  assert.equal(r.pens, 1);
  assert.equal(r.sheep, 2);
});

test('F3: dragging a pen over its sheep brings it home and counts one move', async () => {
  const r = await run(`
    await startAt(0);
    await dragPen(0, [[1, 3]]);
    await wait(400);
    return { moves: A.state.moves, hud: $('#moves').textContent, home: $('#home').textContent,
      sheepLeft: document.querySelectorAll('.sheep').length, tag: $('.pen b').textContent, undo: $('#undoBtn').disabled };
  `);
  assert.equal(r.moves, 1);
  assert.equal(r.hud, '1');
  assert.equal(r.home, '1/2');
  assert.equal(r.sheepLeft, 1);
  assert.equal(r.tag, '1', 'the pen shows how many sheep are missing');
  assert.equal(r.undo, false);
});

test('F4: a pen cannot go through a hedge or the edge, and nothing is counted', async () => {
  const r = await run(`
    await startAt(0);
    await dragPen(0, [[-1, 3]]);
    const p = pens()[0];
    return { x: p.x, y: p.y, moves: A.state.moves, bumped: $('.pen').classList.contains('bump'), undo: $('#undoBtn').disabled };
  `);
  assert.deepEqual([r.x, r.y], [0, 3]);
  assert.equal(r.moves, 0);
  assert.equal(r.bumped, true, 'the pen gives a little bump');
  assert.equal(r.undo, true);
});

test('F4: a sheep of another colour stops a pen and gives a gentle nudge', async () => {
  const r = await run(`
    await startAt(3);
    // find a pen and a direction where a sheep of another colour is right next to it
    const { st } = A.state;
    let found = null;
    st.pens.forEach((p, i) => A.S.DIRS.forEach(([dx, dy]) => {
      if (!found && A.S.blocked(st, i, dx, dy) === 'sheep') found = { i, dx, dy };
    }));
    const p = pens()[found.i];
    const before = [p.x, p.y];
    await dragPen(found.i, [[p.x + found.dx, p.y + found.dy]]);
    return { same: p.x === before[0] && p.y === before[1], moves: A.state.moves, nudged: document.querySelectorAll('.sheep.nudge').length };
  `);
  assert.equal(r.same, true);
  assert.equal(r.moves, 0);
  assert.ok(r.nudged >= 1);
});

test('F5: undo takes a drag back, sheep and all; the button is off when there is nothing to undo', async () => {
  const r = await run(`
    await startAt(0);
    const off = $('#undoBtn').disabled;
    await dragPen(0, [[1, 3]]);
    await wait(400);
    $('#undoBtn').click();
    await wait(100);
    const p = pens()[0];
    return { off, pos: [p.x, p.y], moves: A.state.moves, sheep: document.querySelectorAll('.sheep').length,
      home: $('#home').textContent, offAgain: $('#undoBtn').disabled };
  `);
  assert.equal(r.off, true);
  assert.deepEqual(r.pos, [0, 3]);
  assert.equal(r.moves, 0);
  assert.equal(r.sheep, 2);
  assert.equal(r.home, '0/2');
  assert.equal(r.offAgain, true);
});

test('F6: the hint moves a pen on a way home', async () => {
  const r = await run(`
    await startAt(4);
    const before = A.S.sheepLeft(A.state.st);
    const pos = JSON.stringify(pens().map((p) => [p.x, p.y]));
    $('#hintBtn').click();
    await wait(2500);
    return { hints: A.state.hints, moves: A.state.moves, moved: JSON.stringify(pens().map((p) => [p.x, p.y])) !== pos,
      fewer: A.S.sheepLeft(A.state.st) <= before, toast: $('#toast').textContent };
  `);
  assert.equal(r.hints, 1);
  assert.equal(r.moves, 1);
  assert.equal(r.moved, true);
  assert.equal(r.fewer, true);
  assert.match(r.toast, /fold/);
});

test('F7: bringing every sheep home shows the victory screen and saves the best', async () => {
  const r = await run(`
    await startAt(2);
    await playSteps(solveNow());
    await wait(1600);
    const saved = JSON.parse(localStorage.getItem('sheep.v1'));
    return { won: A.state.won, modal: $('#winModal').classList.contains('open'), best: saved.progress.best['2'],
      moves: A.state.moves, wonCount: saved.stats.won, shown: $('#wMoves').textContent, sub: $('#wSub').textContent };
  `);
  assert.equal(r.won, true);
  assert.equal(r.modal, true);
  assert.equal(r.best, r.moves);
  assert.equal(r.wonCount, 1);
  assert.equal(r.shown, String(r.moves));
  assert.equal(r.sub, 'Bane 3 klaret');
});

test('"Næste bane" after a win opens the next level, which is now unlocked', async () => {
  const r = await run(`
    await startAt(0);
    await dragPen(0, [[1, 3], [1, 2]]);
    await wait(1600);
    $('#wNext').click();
    await wait(400);
    $('#levelsBtn').click();
    await wait(300);
    const b = (n) => $('#levelGrid [data-level="' + n + '"]');
    return { level: A.state.level, modal: $('#winModal').classList.contains('open'),
      done1: b(0).classList.contains('done'), open2: !b(1).disabled, locked3: b(2).disabled };
  `);
  assert.equal(r.level, 1);
  assert.equal(r.modal, false);
  assert.equal(r.done1, true);
  assert.equal(r.open2, true);
  assert.equal(r.locked3, true);
});

test('F8: reloading in the middle of a level offers "Fortsæt" with exactly the same meadow', async () => {
  await run(`await startAt(0); await dragPen(0, [[1, 3]]); await wait(400);`);
  const before = await run('return JSON.stringify(A.state)');
  await g.reload();
  const r = await run(`
    const label = $('#iPlay').textContent;
    const same = JSON.stringify(A.state);
    $('#iPlay').click();
    await wait(300);
    return { label, same, undo: $('#undoBtn').disabled, home: $('#home').textContent };
  `);
  assert.equal(r.label, 'Fortsæt bane 1');
  assert.equal(r.same, before);
  assert.equal(r.undo, false, 'undo history survives a reload');
  assert.equal(r.home, '1/2');
});

test('F9: picking another level mid-game asks first, and "Spil videre" keeps the game', async () => {
  await g.fresh({ progress: { best: { 0: 1 } } });
  const r = await run(`
    await startAt(1);
    const { st } = A.state;
    // make one legal drag
    let done = false;
    for (let i = 0; i < st.pens.length && !done; i++) for (const [dx, dy] of A.S.DIRS) {
      if (!A.S.blocked(st, i, dx, dy)) { await dragPen(i, [[pens()[i].x + dx, pens()[i].y + dy]]); done = true; break; }
    }
    const snap = JSON.stringify(A.state);
    $('#levelsBtn').click(); await wait(300);
    $('#levelGrid [data-level="0"]').click(); await wait(200);
    const asked = $('#confirmModal').classList.contains('open');
    $('#confirmModal [data-act="cancel"]').click(); await wait(200);
    const kept = JSON.stringify(A.state) === snap;
    $('#levelsBtn').click(); await wait(300);
    $('#levelGrid [data-level="0"]').click(); await wait(200);
    $('#confirmModal [data-act="ok"]').click(); await wait(400);
    return { asked, kept, level: A.state.level };
  `);
  assert.equal(r.asked, true);
  assert.equal(r.kept, true);
  assert.equal(r.level, 0);
});

test('F10: settings are remembered after a reload', async () => {
  await run(`
    $('#iPlay').click(); await wait(300);
    $('#menuBtn').click(); await wait(200);
    $('#optSymbols').click(); $('#optSound').click();
    $('#themeSeg [data-v="dark"]').click();
  `);
  await g.reload();
  const r = await run(`return { theme: document.documentElement.dataset.theme, noSymbols: document.body.classList.contains('no-symbols'),
    sound: JSON.parse(localStorage.getItem('sheep.v1')).settings.sound }`);
  assert.equal(r.theme, 'dark');
  assert.equal(r.noSymbols, true);
  assert.equal(r.sound, false);
});

test('restart puts the meadow back, and undo brings the moves back', async () => {
  const r = await run(`
    await startAt(0);
    await dragPen(0, [[1, 3]]);
    await wait(400);
    $('#restartBtn').click(); await wait(200);
    const after = { moves: A.state.moves, sheep: document.querySelectorAll('.sheep').length };
    $('#undoBtn').click(); await wait(200);
    return { after, undone: { moves: A.state.moves, home: $('#home').textContent } };
  `);
  assert.deepEqual(r.after, { moves: 0, sheep: 2 });
  assert.deepEqual(r.undone, { moves: 1, home: '1/2' });
});

test('every pen of a big level can be dragged and the level can be finished by dragging', async () => {
  const r = await run(`
    await startAt(35);
    await playSteps(solveNow());
    await wait(1600);
    return { won: A.state.won, modal: $('#winModal').classList.contains('open') };
  `);
  assert.equal(r.won, true);
  assert.equal(r.modal, true);
});

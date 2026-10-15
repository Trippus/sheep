// End-to-end tests: the real game in headless Edge, driven through its buttons and drags.
// The tests read the level from window.__sheep instead of assuming what a level looks like,
// so they keep working when the levels are made again.
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

test('F1/F2: intro shows on launch and "Spil bane 1" opens the first meadow', async () => {
  const r = await run(`
    const introOpen = $('#intro').classList.contains('open');
    const label = $('#iPlay').textContent;
    $('#iPlay').click();
    await wait(400);
    const L = A.level;
    return { introOpen, label, introAfter: $('#intro').classList.contains('open'), level: A.state.level, hud: $('#levelNo').textContent,
      home: $('#home').textContent, total: A.S.sheepTotal(L), par: $('#par').textContent, d: A.LEVELS[0].d,
      pens: document.querySelectorAll('.pen').length, nPens: L.pens.length,
      sheep: document.querySelectorAll('.sheep').length, nSheep: L.sheep.length,
      queues: document.querySelectorAll('.queue:not([hidden])').length, nQueues: L.queues.length };
  `);
  assert.equal(r.introOpen, true);
  assert.equal(r.label, 'Spil bane 1');
  assert.equal(r.introAfter, false);
  assert.equal(r.level, 0);
  assert.equal(r.hud, '1');
  assert.equal(r.home, `0/${r.total}`);
  assert.equal(r.par, String(r.d), 'the HUD shows the par');
  assert.equal(r.pens, r.nPens);
  assert.equal(r.sheep, r.nSheep);
  assert.equal(r.queues, r.nQueues);
});

test('F3: a drag on the way home moves the pen and counts one move', async () => {
  const r = await run(`
    await startAt(0);
    const h = A.findHint();
    const left = A.S.sheepLeft(A.level, st());
    let x = st().x[h.pen], y = st().y[h.pen];
    await dragPen(h.pen, h.steps.map(([dx, dy]) => [(x += dx), (y += dy)]));
    await wait(400);
    return { moves: A.state.moves, hud: $('#moves').textContent, at: [st().x[h.pen], st().y[h.pen]], want: [x, y], done: st().done[h.pen],
      fewer: A.S.sheepLeft(A.level, st()) <= left, undo: $('#undoBtn').disabled };
  `);
  assert.equal(r.moves, 1);
  assert.equal(r.hud, '1');
  if (!r.done) assert.deepEqual(r.at, r.want);
  assert.equal(r.fewer, true);
  assert.equal(r.undo, false);
});

test('F4: a pen cannot go over the edge, and nothing is counted', async () => {
  const r = await run(`
    await startAt(0);
    const b = findBlocked('edge');
    const before = [st().x[b.i], st().y[b.i]];
    await dragPen(b.i, [[before[0] + b.dx, before[1] + b.dy]]);
    return { same: st().x[b.i] === before[0] && st().y[b.i] === before[1], moves: A.state.moves,
      bumped: document.querySelectorAll('.pen')[b.i].classList.contains('bump'), undo: $('#undoBtn').disabled };
  `);
  assert.equal(r.same, true);
  assert.equal(r.moves, 0);
  assert.equal(r.bumped, true, 'the pen gives a little bump');
  assert.equal(r.undo, true);
});

test('F4: a sheep of another colour stops a pen with a gentle nudge and a word', async () => {
  const r = await run(`
    $('#iPlay').click(); await wait(300);
    let b = null;
    for (let n = 0; n < 40 && !b; n++) { A.startLevel(n); await wait(50); b = findBlocked('sheep'); }
    const before = [st().x[b.i], st().y[b.i]];
    await dragPen(b.i, [[before[0] + b.dx, before[1] + b.dy]]);
    return { same: st().x[b.i] === before[0] && st().y[b.i] === before[1], moves: A.state.moves,
      nudged: document.querySelectorAll('.sheep.nudge').length, toast: $('#toast').textContent };
  `);
  assert.equal(r.same, true);
  assert.equal(r.moves, 0);
  assert.ok(r.nudged >= 1);
  assert.match(r.toast, /anden farve/);
});

test('a locked pen does not move, and says why', async () => {
  const r = await run(`
    $('#iPlay').click(); await wait(300);
    let n = A.LEVELS.findIndex((l) => l.p.some((p) => p[4]));
    A.startLevel(n); await wait(200);
    const i = A.level.pens.findIndex((p) => p.lock);
    const before = [st().x[i], st().y[i]];
    const free = A.S.DIRS.find(([dx, dy]) => { const t = A.S.clone(st()); A.level.pens[i].lock = false; const ok = !A.S.blocked(A.level, t, i, dx, dy); A.level.pens[i].lock = true; return ok; }) || [1, 0];
    await dragPen(i, [[before[0] + free[0], before[1] + free[1]]]);
    return { locked: document.querySelectorAll('.pen')[i].classList.contains('locked'), same: st().x[i] === before[0] && st().y[i] === before[1],
      moves: A.state.moves, toast: $('#toast').textContent };
  `);
  assert.equal(r.locked, true, 'the pen shows its lock');
  assert.equal(r.same, true);
  assert.equal(r.moves, 0);
  assert.match(r.toast, /låst/);
});

test('F5: undo takes a drag back; the button is off when there is nothing to undo', async () => {
  const r = await run(`
    await startAt(0);
    const off = $('#undoBtn').disabled;
    const start = JSON.stringify(st());
    await playSteps(solveNow().slice(0, 1));
    await wait(400);
    const moved = JSON.stringify(st()) !== start;
    $('#undoBtn').click();
    await wait(100);
    return { off, moved, back: JSON.stringify(st()) === start, moves: A.state.moves, sheep: document.querySelectorAll('.sheep').length,
      nSheep: A.level.sheep.length, offAgain: $('#undoBtn').disabled };
  `);
  assert.equal(r.off, true);
  assert.equal(r.moved, true);
  assert.equal(r.back, true);
  assert.equal(r.moves, 0);
  assert.equal(r.sheep, r.nSheep);
  assert.equal(r.offAgain, true);
});

test('F6: the hint moves a pen on a way home', async () => {
  const r = await run(`
    await startAt(12);
    const start = JSON.stringify(st());
    $('#hintBtn').click();
    await wait(3000);
    return { hints: A.state.hints, moves: A.state.moves, moved: JSON.stringify(st()) !== start, toast: $('#toast').textContent,
      solvable: !!A.S.search(A.level, A.S.clone(st()), { maxStates: 300000 }) };
  `);
  assert.equal(r.hints, 1);
  assert.equal(r.moves, 1);
  assert.equal(r.moved, true);
  assert.equal(r.solvable, true, 'after the hint the level can still be solved');
  assert.match(r.toast, /fold/);
});

test('F7: bringing every sheep home shows the victory screen with stars, and saves the best', async () => {
  const r = await run(`
    await startAt(2);
    await playSteps(solveNow());
    await winShown();
    const saved = JSON.parse(localStorage.getItem('sheep.v2'));
    return { won: A.state.won, modal: $('#winModal').classList.contains('open'), best: saved.progress.best['2'],
      moves: A.state.moves, wonCount: saved.stats.won, shown: $('#wMoves').textContent, sub: $('#wSub').textContent,
      stars: $('#wStars').textContent, par: A.LEVELS[2].d };
  `);
  assert.equal(r.won, true);
  assert.equal(r.modal, true);
  assert.equal(r.best, r.moves);
  assert.equal(r.wonCount, 1);
  assert.equal(r.shown, String(r.moves));
  assert.equal(r.sub, 'Bane 3 klaret');
  assert.match(r.stars, /^[★☆]{3}$/);
  if (r.moves <= r.par) assert.equal(r.stars, '★★★');
});

test('"Næste bane" after a win opens the next level, which is now unlocked', async () => {
  const r = await run(`
    await startAt(0);
    await playSteps(solveNow());
    await winShown();
    $('#wNext').click();
    await wait(400);
    $('#levelsBtn').click();
    await wait(300);
    const b = (n) => $('#levelGrid [data-level="' + n + '"]');
    return { level: A.state.level, modal: $('#winModal').classList.contains('open'),
      done1: b(0).classList.contains('done'), stars1: b(0).querySelector('small')?.textContent, open2: !b(1).disabled, locked3: b(2).disabled };
  `);
  assert.equal(r.level, 1);
  assert.equal(r.modal, false);
  assert.equal(r.done1, true);
  assert.match(r.stars1, /^[★☆]{3}$/);
  assert.equal(r.open2, true);
  assert.equal(r.locked3, true);
});

test('"Prøv igen" after a win plays the same level again', async () => {
  const r = await run(`
    await startAt(0);
    await playSteps(solveNow());
    await winShown();
    $('#wRetry').click();
    await wait(400);
    return { level: A.state.level, moves: A.state.moves, won: A.state.won };
  `);
  assert.deepEqual(r, { level: 0, moves: 0, won: false });
});

test('F8: reloading in the middle of a level offers "Fortsæt" with exactly the same meadow', async () => {
  await run(`await startAt(5); await playSteps(solveNow().slice(0, 2)); await wait(400);`);
  const before = await run('return JSON.stringify(A.state)');
  await g.reload();
  const r = await run(`
    const label = $('#iPlay').textContent;
    const same = JSON.stringify(A.state);
    $('#iPlay').click();
    await wait(300);
    return { label, same, undo: $('#undoBtn').disabled };
  `);
  assert.equal(r.label, 'Fortsæt bane 6');
  assert.equal(r.same, before);
  assert.equal(r.undo, false, 'undo history survives a reload');
});

test('F9: picking another level mid-game asks first, and "Spil videre" keeps the game', async () => {
  await g.fresh({ progress: { best: { 0: 1 } } });
  const r = await run(`
    await startAt(1);
    await playSteps(solveNow().slice(0, 1));
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
    sound: JSON.parse(localStorage.getItem('sheep.v2')).settings.sound }`);
  assert.equal(r.theme, 'dark');
  assert.equal(r.noSymbols, true);
  assert.equal(r.sound, false);
});

test('restart puts the meadow back, and undo brings the moves back', async () => {
  const r = await run(`
    await startAt(3);
    const start = JSON.stringify(st());
    await playSteps(solveNow().slice(0, 2));
    await wait(400);
    const mid = JSON.stringify(st());
    const moves = A.state.moves;
    $('#restartBtn').click(); await wait(200);
    const after = { fresh: JSON.stringify(st()) === start, moves: A.state.moves };
    $('#undoBtn').click(); await wait(200);
    return { after, undone: { same: JSON.stringify(st()) === mid, moves: A.state.moves === moves } };
  `);
  assert.deepEqual(r.after, { fresh: true, moves: 0 });
  assert.deepEqual(r.undone, { same: true, moves: true });
});

test('a big level with queues, colour changes and a lock can be finished by dragging', async () => {
  const r = await run(`
    $('#iPlay').click(); await wait(300);
    const n = A.LEVELS.findIndex((l, k) => k > 50 && l.p.some((p) => p[4]) && l.p.some((p) => p[3].length > 2));
    A.startLevel(n); await wait(200);
    await playSteps(solveNow());
    await winShown();
    return { n, won: A.state.won, modal: $('#winModal').classList.contains('open'), left: A.S.sheepLeft(A.level, st()) };
  `);
  assert.ok(r.n > 0, 'such a level exists');
  assert.equal(r.won, true);
  assert.equal(r.modal, true);
  assert.equal(r.left, 0);
});

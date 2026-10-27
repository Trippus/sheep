import * as S from './sheep.js';
import { LEVELS } from './levels.js';
import { Sound } from './audio.js';
import { Ads } from './ads.js';

const $ = (s) => document.querySelector(s);
const board = $('#board');
const STORE = 'sheep.v2'; // v2: packed meadows with queues; v1 progress does not carry over

// ︎ keeps the symbols as plain text, not emoji
const COLORS = [
  { name: 'lyserøde', pen: '#e0607e', wool: '#f6c1cf', edge: '#c97f93', sym: '♥︎' },
  { name: 'blå', pen: '#3f86d8', wool: '#bcd6f5', edge: '#7c9fcb', sym: '★︎' },
  { name: 'gule', pen: '#d39d0c', wool: '#f8e39a', edge: '#c9a94a', sym: '●︎' },
  { name: 'brune', pen: '#8a5a3c', wool: '#dcc0a3', edge: '#a9825f', sym: '▲︎' },
  { name: 'lilla', pen: '#8a5cc4', wool: '#dccbf2', edge: '#a58bcb', sym: '■︎' },
  { name: 'orange', pen: '#e8803a', wool: '#f8c9a0', edge: '#d0915a', sym: '◆︎' },
];
const SIDE = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const MARGIN = 1; // one row of queue fields around the meadow, in cells

const settings = { sound: true, symbols: true, theme: 'auto' };
const blankStats = () => ({ won: 0, sheep: 0, moves: 0, noHint: 0 });
const stats = blankStats();
const progress = { best: {} }; // level index -> fewest moves

let game = null; // { level, s, moves, hints, started, won }
let L = null; // the parsed level (never changes while playing it)
let history = []; // snapshots of { s, moves } before each drag
let busy = false;
let drag = null;
let penEls = [];
let sheepEls = new Map(); // board sheep index -> element
let queueEls = [];
// The rules move on at once, but the meadow shows it one sheep at a time. Each pen has a
// view (the colour and number on its tag) and a chain of animations; each queue shows the
// sheep that have not walked over yet. A new epoch (undo, restart, new level) stops them all.
let views = [];
let chains = [];
let shownHead = [];
let epoch = 0;

/* ---------- persistence ---------- */

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!d) return;
    Object.assign(settings, d.settings);
    Object.assign(stats, d.stats);
    Object.assign(progress.best, d.progress?.best);
    if (d.game && LEVELS[d.game.level]) {
      game = d.game;
      history = d.history || [];
    }
  } catch {
    /* corrupted or blocked storage: start fresh */
  }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ settings, stats, progress, game, history: history.slice(-100) }));
  } catch {
    /* private mode etc. */
  }
}

/* ---------- levels, par and stars ---------- */

const solvedCount = () => Object.keys(progress.best).length;
const isSolved = (i) => progress.best[i] !== undefined;
const furthest = () => Math.max(-1, ...Object.keys(progress.best).map(Number));
const unlocked = (i) => i <= furthest() + 1 || isSolved(i);
// Three stars for the par (the fewest drags we know of), two for a little more, one for any win.
function stars(level, moves) {
  const par = LEVELS[level].d;
  if (!par || moves <= par) return 3;
  return moves <= par + Math.max(2, Math.round(par * 0.25)) ? 2 : 1;
}
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const totalStars = () => Object.entries(progress.best).reduce((t, [i, m]) => t + stars(+i, m), 0);

function nextLevel() {
  if (game && !game.won) return game.level;
  for (let i = game ? game.level + 1 : 0; i < LEVELS.length; i++) if (!isSolved(i)) return i;
  for (let i = 0; i < LEVELS.length; i++) if (!isSolved(i)) return i;
  return Math.min(LEVELS.length - 1, (game ? game.level : -1) + 1);
}

function newGame(level) {
  return { level, s: S.startState(S.parseLevel(LEVELS[level])), moves: 0, hints: 0, started: false, won: false };
}

const snapshot = () => ({ s: S.clone(game.s), moves: game.moves });

/* ---------- drawing ---------- */

const pos = (el, x, y) => {
  el.style.setProperty('--x', x);
  el.style.setProperty('--y', y);
};

function sheepHtml(c, key) {
  const col = COLORS[c];
  return `<svg style="--wool:${col.wool};--wool-edge:${col.edge}"><use href="#sheep"/></svg><span class="sym" style="--pen:${col.pen}">${col.sym}</span>${key ? '<span class="key">🔑︎</span>' : ''}`;
}

// Rebuilds the meadow from the state (new level, undo, restart).
function build(deal = false) {
  epoch++;
  L = S.parseLevel(LEVELS[game.level]);
  const { s } = game;
  views = L.pens.map((p, i) => ({ c: S.penColor(L, s, i), n: S.room(L, s, i), stage: s.stage[i], closing: false }));
  chains = L.pens.map(() => Promise.resolve());
  shownHead = s.qh.slice();
  board.style.setProperty('--cols', L.w);
  board.style.setProperty('--rows', L.h);
  board.style.setProperty('--m', MARGIN);
  board.classList.remove('won');
  board.classList.toggle('deal', deal);
  board.innerHTML = '<div class="meadow"></div>';

  // the queue fields, each one cell outside the edge
  queueEls = L.queues.map((q) => {
    const el = document.createElement('div');
    el.className = `piece queue side-${q.side}`;
    pos(el, q.x + SIDE[q.side][0], q.y + SIDE[q.side][1]);
    board.appendChild(el);
    return el;
  });

  sheepEls = new Map();
  L.sheep.forEach((sh, i) => {
    if (s.caught[i]) return;
    const el = document.createElement('div');
    el.className = 'piece sheep';
    el.innerHTML = sheepHtml(sh.c, sh.key);
    pos(el, sh.k % L.w, (sh.k / L.w) | 0);
    el.style.setProperty('--d', `${((sh.k % L.w) + ((sh.k / L.w) | 0)) * 40}ms`);
    board.appendChild(el);
    sheepEls.set(i, el);
  });

  penEls = L.pens.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'piece pen';
    el.dataset.i = i;
    el.setAttribute('role', 'button');
    const [tx, ty] = tagCell(p);
    // the outline is one shape for the whole pen (see #penEdge in index.html); the cells on
    // top are just what a finger grabs, and one of them carries the tag
    const bw = Math.max(...p.cells.map((c) => c[0])) + 1;
    const bh = Math.max(...p.cells.map((c) => c[1])) + 1;
    const rects = p.cells.map(([x, y]) => `<rect x="${x * 100 - 1}" y="${y * 100 - 1}" width="102" height="102"/>`).join('');
    const shape = `<svg class="shape" viewBox="0 0 ${bw * 100} ${bh * 100}" style="--bw:${bw};--bh:${bh}">
      <g class="edge" filter="url(#penEdge)">${rects}</g><g class="floor" filter="url(#penFill)">${rects}</g></svg>`;
    el.innerHTML =
      shape +
      p.cells
        .map(([x, y]) => {
          const tag = x === tx && y === ty ? '<span class="tag"><i></i><b></b></span><span class="lock">🔒︎</span>' : '';
          return `<div class="cell" style="--cx:${x};--cy:${y}">${tag}</div>`;
        })
        .join('');
    board.appendChild(el);
    return el;
  });
  if (deal) setTimeout(() => board.classList.remove('deal'), 1200);
  render();
}

// The tag sits on the cell closest to the middle of the shape; sheep walk to it.
function tagCell(p) {
  const mx = p.cells.reduce((a, c) => a + c[0], 0) / p.cells.length;
  const my = p.cells.reduce((a, c) => a + c[1], 0) / p.cells.length;
  return p.cells.reduce((b, c) => (Math.hypot(c[0] - mx, c[1] - my) < Math.hypot(b[0] - mx, b[1] - my) ? c : b));
}

function render() {
  const { s } = game;
  L.pens.forEach((p, i) => {
    const el = penEls[i];
    const v = views[i];
    if (!el || el.classList.contains('closing')) return;
    el.hidden = s.done[i] && !v.closing;
    if (el.hidden) return;
    pos(el, s.x[i], s.y[i]);
    el.style.setProperty('--pen', COLORS[v.c].pen);
    el.querySelector('i').textContent = COLORS[v.c].sym;
    el.querySelector('b').textContent = v.n;
    el.classList.toggle('locked', S.isLocked(L, s, i));
    el.setAttribute('aria-label', `${COLORS[v.c].name} fold, plads til ${v.n} får${S.isLocked(L, s, i) ? ', låst' : ''}`);
  });
  L.queues.forEach((q, i) => renderQueue(i));
  updateHud();
}

// A queue field shows its front sheep, and dots for the next few behind it.
function renderQueue(i) {
  const q = L.queues[i];
  const el = queueEls[i];
  const left = q.sheep.slice(shownHead[i]);
  el.classList.toggle('empty', !left.length);
  const key = `${shownHead[i]}`;
  if (el._k === key) return;
  el._k = key;
  if (!left.length) {
    el.innerHTML = '';
    el.setAttribute('aria-label', 'Tomt læskur');
    return;
  }
  // the queue stands in a box: the front sheep in full, the next two only glimpsed behind it
  const behind = left
    .slice(1, 3)
    .map((sh, k) => `<div class="behind b${k + 1}"><svg style="--wool:${COLORS[sh.c].wool};--wool-edge:${COLORS[sh.c].edge}"><use href="#sheep"/></svg></div>`)
    .reverse()
    .join('');
  el.innerHTML = `${behind}<div class="front">${sheepHtml(left[0].c, left[0].key)}</div>`;
  el.setAttribute('aria-label', `Læskur med ${left.length} får`);
}

function updateHud() {
  const total = S.sheepTotal(L);
  $('#levelNo').textContent = game.level + 1;
  $('#home').textContent = `${total - S.sheepLeft(L, game.s)}/${total}`;
  $('#moves').textContent = game.moves;
  $('#par').textContent = LEVELS[game.level].d || '–';
  $('#undoBtn').disabled = !history.length || game.won || busy;
  $('#restartBtn').disabled = !game.started || game.won || busy;
}

function floatText(x, y, text) {
  const el = document.createElement('div');
  el.className = 'baa';
  pos(el, x, y);
  el.textContent = text;
  board.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

const replay = (el, cls) => {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

/* ---------- animations ---------- */

// Plays what one step did, in order, after whatever the pen is still showing.
function animate(i, log) {
  if (!log.length) return;
  const ep = epoch;
  for (const e of log) chains[i] = chains[i].then(() => ep === epoch && play(i, e, ep));
}

const SHEEP_MS = 290;

async function play(i, e, ep) {
  const v = views[i];
  const pe = penEls[i];
  if (e.t === 'sheep') {
    // the sheep hops from where it stood into the pen, and the number counts down as it lands
    let el;
    if (e.sh !== undefined) {
      el = sheepEls.get(e.sh);
      sheepEls.delete(e.sh);
    } else {
      const Q = L.queues[e.q];
      const sh = Q.sheep[e.k];
      shownHead[e.q] = e.k + 1;
      renderQueue(e.q);
      el = document.createElement('div');
      el.className = 'piece sheep';
      el.innerHTML = sheepHtml(sh.c, sh.key);
      pos(el, Q.x + SIDE[Q.side][0], Q.y + SIDE[Q.side][1]);
      board.appendChild(el);
    }
    if (el) {
      const [tx, ty] = tagCell(L.pens[i]);
      el.style.setProperty('--tx', game.s.x[i] + tx);
      el.style.setProperty('--ty', game.s.y[i] + ty);
      void el.offsetWidth;
      el.classList.add('caught');
      Sound.play('step', { vol: 0.8 });
      await wait(SHEEP_MS);
      el.remove();
    }
    if (ep !== epoch) return;
    v.n--;
    Sound.play('chime', { note: L.pens[i].stages[v.stage][1] - v.n - 1 });
    replay(pe, 'gulp');
    render();
    await wait(40);
  } else if (e.t === 'turn') {
    // a full stage: the pen flips over and shows its next colour
    await wait(200);
    if (ep !== epoch) return;
    v.c = e.c;
    v.n = e.room;
    v.stage++;
    replay(pe, 'flip');
    render();
    floatText(game.s.x[i], game.s.y[i], `Nu ${COLORS[e.c].sym}`);
    Sound.play('hint');
    await wait(450);
  } else if (e.t === 'close') {
    // the last sheep is in: the fence closes up tile by tile and the pen dissolves
    await wait(150);
    if (ep !== epoch) return;
    pe.classList.add('closing');
    floatText(game.s.x[i], game.s.y[i], 'Mæh!');
    Sound.play('close');
    await wait(750);
    if (ep !== epoch) return;
    v.closing = false;
    pe.classList.remove('closing', 'grab');
    pe.hidden = true;
  }
}

/* ---------- moving ---------- */

// Takes one step and starts its animations. Returns false when the pen cannot go that way.
function tryStep(i, dx, dy) {
  const { s } = game;
  const ev = S.step(L, s, i, dx, dy);
  if (!ev) return false;
  pos(penEls[i], s.x[i], s.y[i]);
  Sound.play('step', { vol: 0.5 });
  stats.sheep += ev.caught.length + (ev.fromQueue?.length || 0);
  if (ev.closed) views[i].closing = true;
  // a sheep that is on its way home sits above the pens until it lands
  for (const sh of ev.caught) sheepEls.get(sh)?.classList.add('going');
  animate(i, ev.log);
  if (ev.unlocked) {
    const ep = epoch;
    Promise.all(chains).then(() => {
      if (ep !== epoch) return;
      Sound.play('close');
      toast('Alle nøglefår er hjemme. Den låste fold kan nu flyttes.');
      penEls.forEach((el) => el.classList.contains('locked') && replay(el, 'unlock'));
    });
  }
  render();
  return true;
}

let bumpedAt = 0;
let toldAbout = '';
function bump(i, dx, dy) {
  if (Date.now() - bumpedAt < 350) return;
  bumpedAt = Date.now();
  const why = S.blocked(L, game.s, i, dx, dy);
  const pe = penEls[i];
  pe.classList.remove('bump');
  void pe.offsetWidth;
  pe.classList.add('bump');
  Sound.play('bump', { vol: 0.6 });
  if (why === 'sheep') {
    for (const [x, y] of S.penCells(L, game.s, i)) {
      const sh = L.sheepAt[(y + dy) * L.w + x + dx];
      const el = sh >= 0 ? sheepEls.get(sh) : null;
      if (!el) continue;
      el.classList.remove('nudge');
      void el.offsetWidth;
      el.classList.add('nudge');
    }
  }
  const msg = {
    locked: 'Folden er låst. Få fårene med nøgler hjem først.',
    full: 'Der er ikke plads til så mange får i folden.',
    sheep: 'Et får i en anden farve står i vejen.',
  }[why];
  if (msg && toldAbout !== why) {
    toldAbout = why;
    toast(msg);
  }
}

function cellFromEvent(e) {
  const r = board.getBoundingClientRect();
  const cs = cellSize();
  const off = 8 + MARGIN * cs;
  return { x: (e.clientX - r.left - off) / cs, y: (e.clientY - r.top - off) / cs };
}
const cellSize = () => parseFloat(board.style.getPropertyValue('--cs')) || 56;

function onDown(e) {
  const el = e.target.closest('.pen');
  if (!el || busy || game.won || drag) return;
  const i = +el.dataset.i;
  if (game.s.done[i]) return;
  e.preventDefault();
  if (S.isLocked(L, game.s, i)) return bump(i, 0, 0);
  const c = cellFromEvent(e);
  drag = { i, ox: c.x - game.s.x[i], oy: c.y - game.s.y[i], before: snapshot(), moved: false, pid: e.pointerId };
  try {
    board.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic events in tests have no real pointer */
  }
  el.classList.add('grab');
  Sound.play('pick');
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  const c = cellFromEvent(e);
  const { i } = drag;
  const { s } = game;
  const tx = Math.round(c.x - drag.ox);
  const ty = Math.round(c.y - drag.oy);
  for (let guard = 0; guard < 24 && !s.done[i]; guard++) {
    const ex = tx - s.x[i];
    const ey = ty - s.y[i];
    if (!ex && !ey) break;
    const sx = Math.sign(ex);
    const sy = Math.sign(ey);
    // try the longer way first, then slide along the other axis
    const order = (Math.abs(ex) >= Math.abs(ey) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]]).filter(([a, b]) => a || b);
    let moved = false;
    for (const [dx, dy] of order) {
      if (tryStep(i, dx, dy)) {
        moved = true;
        if (!drag.moved) {
          drag.moved = true;
          history.push(drag.before);
          game.started = true;
        }
        break;
      }
    }
    if (!moved) {
      bump(i, ...order[0]);
      break;
    }
  }
  if (s.done[i]) endDrag();
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  penEls[d.i]?.classList.remove('grab');
  try {
    board.releasePointerCapture(d.pid);
  } catch {}
  if (d.moved) {
    game.moves++;
    stats.moves++;
    updateHud();
    if (S.isWon(game.s)) win();
    save();
  }
}

/* ---------- undo, restart, hint ---------- */

function undo() {
  if (busy || game.won || drag || !history.length) return;
  const h = history.pop();
  game.s = h.s;
  game.moves = h.moves;
  Sound.play('undo');
  build();
  save();
}

function restart() {
  if (busy || game.won || drag || !game.started) return;
  history.push(snapshot());
  game.s = S.startState(L);
  game.moves = 0;
  Sound.play('undo');
  build(true);
  save();
  toast('Banen er startet forfra. Fortryd bringer dine træk tilbage.');
}

// The next drag on a way home from here, or why there is none.
// Each level carries a solution. While the meadow is somewhere on that path the hint simply
// shows its next drag; otherwise it searches from here, which is fine on small meadows.
function findHint() {
  const sol = LEVELS[game.level].s;
  if (sol) {
    const steps = [...sol.matchAll(/([a-z])(\d)/g)].map((m) => [m[1].charCodeAt(0) - 97, ...S.DIRS[+m[2]]]);
    const here = S.stateKey(game.s);
    const t = S.startState(L);
    for (let k = 0; k <= steps.length; k++) {
      if (S.stateKey(t) === here) return S.firstDrag({ steps: steps.slice(k) });
      if (k < steps.length) S.step(L, t, ...steps[k]);
    }
  }
  const info = {};
  const found = S.search(L, S.clone(game.s), { maxStates: 60000, info });
  return found ? S.firstDrag(found) : { none: info.why };
}

async function hint() {
  if (busy || game.won || drag) return;
  const h = findHint();
  if (h.none) {
    Sound.play('bump');
    toast(
      h.none === 'no way'
        ? 'Herfra kan fårene ikke komme hjem. Fortryd et par træk, eller start forfra.'
        : 'Tip kan ikke se vejen herfra. Fortryd nogle træk, eller start forfra – så kan Tip vise vejen hele vejen.',
    );
    return;
  }
  busy = true;
  game.hints++;
  history.push(snapshot());
  game.started = true;
  updateHud();
  const pe = penEls[h.pen];
  pe.classList.add('hint');
  Sound.play('hint');
  toast(`Prøv at flytte den ${COLORS[S.penColor(L, game.s, h.pen)].name} fold sådan her.`);
  await wait(500);
  for (const [dx, dy] of h.steps) {
    if (!tryStep(h.pen, dx, dy)) break;
    await wait(170);
  }
  pe.classList.remove('hint');
  game.moves++;
  stats.moves++;
  busy = false;
  updateHud();
  if (S.isWon(game.s)) win();
  save();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- winning ---------- */

function win() {
  game.won = true;
  busy = true;
  const prev = progress.best[game.level];
  const newBest = prev === undefined || game.moves < prev;
  if (newBest) progress.best[game.level] = game.moves;
  stats.won++;
  if (!game.hints) stats.noHint++;
  save();
  updateHud();
  // celebrate once the last sheep has landed and the last pen has dissolved
  const ep = epoch;
  Promise.all(chains).then(() => {
    if (ep !== epoch) return;
    board.classList.add('won');
    Sound.play('win', { delay: 0.2 });
    setTimeout(() => ep === epoch && showWin(newBest && prev !== undefined), 900);
  });
}

function showWin(newBest) {
  const par = LEVELS[game.level].d;
  const n = stars(game.level, game.moves);
  $('#wSub').textContent = `Bane ${game.level + 1} klaret`;
  $('#wStars').textContent = starText(n);
  $('#wStars').setAttribute('aria-label', `${n} af 3 stjerner`);
  $('#wMoves').textContent = game.moves;
  $('#wPar').textContent = par || '–';
  $('#wBest').textContent = progress.best[game.level];
  const badges = [];
  if (newBest) badges.push('Ny rekord!');
  if (par && game.moves < par) badges.push('Bedre end vores bedste!');
  if (!game.hints) badges.push('Uden tip');
  if (n < 3 && par) badges.push(`Klar den på ${par} træk for ★★★`);
  $('#wBadges').innerHTML = badges.map((b) => `<span>${b}</span>`).join('');
  const last = game.level >= LEVELS.length - 1;
  $('#wNext').textContent = last ? 'Vælg bane' : 'Næste bane';
  openModal('#winModal');
  Ads.showBanner();
  busy = false;
}

/* ---------- starting levels ---------- */

function startLevel(level) {
  Ads.hideBanner();
  closeModal('#winModal');
  game = newGame(level);
  history = [];
  busy = false;
  drag = null;
  toldAbout = '';
  layout();
  build(true);
  save();
  if (level === 0) firstTimeTip();
}

function firstTimeTip() {
  // only if the player is still looking at level 1 and has not moved yet
  setTimeout(() => game.level === 0 && !game.started && !introOpen() && toast('Træk folden hen til fårene i samme farve. Fårene i læskurene går ind, når folden står ud for dem.'), 600);
}

function confirmThen(fn) {
  if (busy) return;
  if (game.started && !game.won && game.moves > 0) {
    pendingAction = fn;
    openModal('#confirmModal');
  } else fn();
}
let pendingAction = null;

// Moving on from one level to the next is the natural break where an ad may show.
let advancing = false;
async function goToLevel(level) {
  if (advancing) return;
  advancing = true;
  try {
    if (game.won) await Ads.interstitial();
    startLevel(level);
  } finally {
    advancing = false;
  }
}

/* ---------- chrome: modals, sheets, toast ---------- */

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(2600, msg.length * 55));
}

function openModal(sel) {
  $(sel).classList.add('open');
  if (sel !== '#winModal') $('#backdrop').classList.add('open');
}
function closeModal(sel) {
  $(sel).classList.remove('open');
  if (!document.querySelector('.sheet.open, #confirmModal.open')) $('#backdrop').classList.remove('open');
}
function closeAll() {
  document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
  $('#confirmModal').classList.remove('open');
  $('#backdrop').classList.remove('open');
}

function openSheet(sel) {
  if (busy || drag) return;
  if (sel === '#menu') {
    renderStats();
    syncSettingsUi();
  } else renderLevels();
  $(sel).classList.add('open');
  $('#backdrop').classList.add('open');
}

function renderStats() {
  $('#statsBox').innerHTML = [
    ['Baner klaret', solvedCount()],
    ['Stjerner', totalStars()],
    ['Får talt hjem', stats.sheep.toLocaleString('da-DK')],
  ]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`)
    .join('');
}

function renderLevels() {
  $('#levelsInfo').textContent = `${solvedCount()} af ${LEVELS.length} baner klaret · ${totalStars()} af ${LEVELS.length * 3} stjerner.`;
  $('#levelGrid').innerHTML = LEVELS.map((_, i) => {
    const solved = isSolved(i);
    const cls = [solved ? 'done' : '', i === game.level && !game.won ? 'cur' : ''].join(' ');
    const st = solved ? stars(i, progress.best[i]) : 0;
    const label = `Bane ${i + 1}${solved ? `, ${st} stjerner` : ''}`;
    return `<button type="button" class="${cls}" data-level="${i}" aria-label="${label}"${unlocked(i) ? '' : ' disabled'}>${i + 1}${solved ? `<small>${starText(st)}</small>` : ''}</button>`;
  }).join('');
  requestAnimationFrame(() => $('#levelGrid .cur, #levelGrid button:not(.done):not(:disabled)')?.scrollIntoView({ block: 'center' }));
}

function syncSettingsUi() {
  $('#optSound').checked = settings.sound;
  $('#optSymbols').checked = settings.symbols;
  document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.theme));
  $('#seedNo').textContent = game.level + 1;
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#161b16' : '#eaf2dc';
  document.body.classList.toggle('no-symbols', !settings.symbols);
  Sound.enabled = settings.sound;
}

function buildMenu() {
  const toggles = { optSound: 'sound', optSymbols: 'symbols' };
  for (const [id, key] of Object.entries(toggles)) {
    $('#' + id).addEventListener('change', (e) => {
      settings[key] = e.target.checked;
      applyTheme();
      save();
    });
  }
  $('#themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.theme = b.dataset.v;
    applyTheme();
    syncSettingsUi();
    save();
  });
  $('#mReset').addEventListener('click', () => {
    Object.assign(stats, blankStats());
    save();
    renderStats();
    toast('Statistikken er nulstillet. Dine klarede baner er der stadig.');
  });
  $('#levelGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const level = +b.dataset.level;
    closeAll();
    if (level === game.level && !game.won) {
      if (introOpen()) closeIntro();
      return;
    }
    if (introOpen()) {
      closeIntro();
      setTimeout(() => startLevel(level), 250);
      return;
    }
    confirmThen(() => goToLevel(level));
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
}

/* ---------- intro screen ---------- */

const introOpen = () => $('#intro').classList.contains('open');

function buildIntro() {
  $('#iPlay').addEventListener('click', () => {
    const level = nextLevel();
    closeIntro();
    // The intro covers the launch, so no ad here.
    if (level !== game.level || game.won) setTimeout(() => startLevel(level), 250);
  });
  $('#iLevels').addEventListener('click', () => openSheet('#levels'));
  $('#iRules').addEventListener('click', () => {
    const open = $('#introRules').hidden;
    $('#introRules').hidden = !open;
    $('#iRules').textContent = open ? 'Skjul reglerne' : 'Sådan spiller du';
  });
}

function syncIntro() {
  const level = nextLevel();
  const resumable = game.started && !game.won && level === game.level;
  $('#iPlay').textContent = resumable ? `Fortsæt bane ${level + 1}` : `Spil bane ${level + 1}`;
  const n = stats.sheep;
  $('#introStats').textContent = n ? `Du har talt ${n.toLocaleString('da-DK')} får hjem · ${totalStars()} ★` : '';
}

function openIntro() {
  closeModal('#winModal');
  Ads.hideBanner();
  syncIntro();
  $('#intro').classList.add('open');
}

function closeIntro() {
  $('#intro').classList.remove('open');
  if (game.level === 0 && !game.started) firstTimeTip();
  setTimeout(installHint, 900);
}

function installHint() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let seen = false;
  try {
    seen = !!localStorage.getItem('sheep.installHint');
  } catch {}
  if (!ios || standalone || seen) return;
  const el = $('#install');
  el.classList.add('show');
  el.querySelector('button').addEventListener('click', () => {
    el.classList.remove('show');
    try {
      localStorage.setItem('sheep.installHint', '1');
    } catch {}
  });
}

/* ---------- layout ---------- */

// Sizes the cells so the meadow and its queues fit next to (or above) the tool bar.
function layout() {
  const play = $('#play');
  play.classList.remove('wide');
  const r = play.getBoundingClientRect();
  const raw = LEVELS[game.level];
  const cols = raw.w + 2 * MARGIN;
  const rows = raw.h + 2 * MARGIN;
  const wide = r.width > r.height * 1.25;
  play.classList.toggle('wide', wide);
  const tools = $('.tools').getBoundingClientRect();
  const availW = (wide ? r.width - tools.width - 60 : r.width - 16) - 16;
  const availH = (wide ? r.height - 24 : r.height - tools.height - 36) - 16;
  const cs = Math.max(28, Math.floor(Math.min(availW / cols, availH / rows, 84)));
  board.style.setProperty('--cs', `${cs}px`);
  play.style.setProperty('--bw', `${Math.round(cs * cols) + 16}px`);
}

/* ---------- boot ---------- */

function init() {
  load();
  applyTheme();
  buildMenu();

  board.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', (e) => drag && e.pointerId === drag.pid && endDrag());
  window.addEventListener('pointercancel', (e) => drag && e.pointerId === drag.pid && endDrag());
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown']) document.addEventListener(ev, () => Sound.unlock(), { capture: true });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  darkQuery.addEventListener?.('change', applyTheme);

  $('#undoBtn').addEventListener('click', undo);
  $('#restartBtn').addEventListener('click', restart);
  $('#hintBtn').addEventListener('click', hint);
  $('#levelsBtn').addEventListener('click', () => openSheet('#levels'));
  $('#menuBtn').addEventListener('click', () => openSheet('#menu'));
  $('#backdrop').addEventListener('click', closeAll);
  $('#wNext').addEventListener('click', () => {
    if (game.level >= LEVELS.length - 1) return openSheet('#levels');
    goToLevel(game.level + 1);
  });
  $('#wRetry').addEventListener('click', () => goToLevel(game.level));
  $('#wHome').addEventListener('click', openIntro);
  $('#confirmModal').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    closeAll();
    if (act === 'ok' && pendingAction) pendingAction();
    pendingAction = null;
  });

  window.addEventListener('keydown', (e) => {
    if (document.querySelector('.sheet.open, .modal.open, .intro.open, .ad-layer.open')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') return undo();
    if (e.key === 'h') hint();
  });

  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(layout, 60);
  });
  document.addEventListener('visibilitychange', () => document.hidden && save());
  window.addEventListener('pagehide', save);

  // Show the saved level (or the next one, untouched) behind the intro screen.
  if (!game || game.won) {
    game = newGame(nextLevel());
    history = [];
  }
  layout();
  build();
  buildIntro();
  openIntro();

  if ('serviceWorker' in navigator && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Debugging hook for the browser console (also used by tests and tools/store-shots.mjs).
  window.__sheep = {
    get state() { return game; },
    set state(g) { game = g; history = []; layout(); build(); },
    get level() { return L; },
    get history() { return history; },
    get progress() { return progress; },
    get stats() { return stats; },
    S,
    LEVELS,
    startLevel,
    findHint,
  };
}

init();

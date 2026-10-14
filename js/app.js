import * as S from './sheep.js';
import { LEVELS } from './levels.js';
import { Sound } from './audio.js';
import { Ads } from './ads.js';

const $ = (s) => document.querySelector(s);
const board = $('#board');
const STORE = 'sheep.v1';

// ︎ keeps the symbols as plain text, not emoji
const COLORS = [
  { name: 'lyserøde', pen: '#e0607e', wool: '#f6c1cf', edge: '#c97f93', sym: '♥︎' },
  { name: 'blå', pen: '#3f86d8', wool: '#bcd6f5', edge: '#7c9fcb', sym: '★︎' },
  { name: 'gule', pen: '#d39d0c', wool: '#f8e39a', edge: '#c9a94a', sym: '●︎' },
  { name: 'brune', pen: '#8a5a3c', wool: '#dcc0a3', edge: '#a9825f', sym: '▲︎' },
  { name: 'lilla', pen: '#8a5cc4', wool: '#dccbf2', edge: '#a58bcb', sym: '■︎' },
  { name: 'orange', pen: '#e8803a', wool: '#f8c9a0', edge: '#d0915a', sym: '◆︎' },
];

const settings = { sound: true, symbols: true, theme: 'auto' };
const blankStats = () => ({ won: 0, sheep: 0, moves: 0, noHint: 0 });
const stats = blankStats();
const progress = { best: {} }; // level index -> fewest moves

let game = null; // { level, st, moves, hints, started, won }
let history = []; // snapshots of { st, moves } before each drag
let busy = false;
let drag = null;
let penEls = [];
let sheepEls = new Map(); // cell index -> element

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

/* ---------- levels ---------- */

const solvedCount = () => Object.keys(progress.best).length;
const isSolved = (i) => progress.best[i] !== undefined;
// You may play every solved level and the first one after the furthest solved level.
const furthest = () => Math.max(-1, ...Object.keys(progress.best).map(Number));
const unlocked = (i) => i <= furthest() + 1 || isSolved(i);
// The level "Fortsæt" leads to: the current one if unfinished, else the next unsolved one.
function nextLevel() {
  if (game && !game.won) return game.level;
  for (let i = (game ? game.level + 1 : 0); i < LEVELS.length; i++) if (!isSolved(i)) return i;
  for (let i = 0; i < LEVELS.length; i++) if (!isSolved(i)) return i;
  return Math.min(LEVELS.length - 1, (game ? game.level : -1) + 1);
}

function newGame(level) {
  return { level, st: S.parseLevel(LEVELS[level]), moves: 0, hints: 0, started: false, won: false };
}

const snapshot = () => ({ st: S.clone(game.st), moves: game.moves });

function markStarted() {
  game.started = true;
}

/* ---------- drawing ---------- */

const OBSTACLES = ['hedge', 'hedge', 'hedge', 'hedge', 'hedge', 'stone', 'tree'];
const obstacleFor = (k) => OBSTACLES[(Math.imul(k + 7 * game.level, 2654435761) >>> 24) % OBSTACLES.length];

function sheepEl(k, c) {
  const el = document.createElement('div');
  const col = COLORS[c];
  el.className = 'piece sheep';
  el.dataset.k = k;
  el.style.cssText = `--x:${k % game.st.w};--y:${(k / game.st.w) | 0};--wool:${col.wool};--wool-edge:${col.edge};--pen:${col.pen}`;
  el.innerHTML = `<svg><use href="#sheep"/></svg><span class="sym">${col.sym}</span>`;
  return el;
}

// Rebuilds the meadow from the state (new level, undo, restart).
function build(deal = false) {
  const st = game.st;
  board.style.setProperty('--cols', st.w);
  board.style.setProperty('--rows', st.h);
  board.classList.remove('won');
  board.classList.toggle('deal', deal);
  let html = '<div class="meadow"></div>';
  st.cells.forEach((v, k) => {
    if (v === S.HEDGE) html += `<div class="piece obstacle" style="--x:${k % st.w};--y:${(k / st.w) | 0}"><svg><use href="#${obstacleFor(k)}"/></svg></div>`;
  });
  board.innerHTML = html;
  sheepEls = new Map();
  st.cells.forEach((v, k) => {
    if (v < 0) return;
    const el = sheepEl(k, v);
    el.style.setProperty('--d', `${(k % st.w + ((k / st.w) | 0)) * 40}ms`);
    board.appendChild(el);
    sheepEls.set(k, el);
  });
  penEls = st.pens.map((p, i) => {
    const el = document.createElement('div');
    const col = COLORS[p.c];
    el.className = 'piece pen';
    el.dataset.i = i;
    el.setAttribute('role', 'button');
    el.style.cssText = `--w:${p.w};--h:${p.h};--pen:${col.pen}`;
    el.innerHTML = '<div class="fence"><span class="tag"><i></i><b></b></span></div>';
    el.querySelector('i').textContent = col.sym;
    if (p.done) el.hidden = true;
    board.appendChild(el);
    return el;
  });
  if (deal) setTimeout(() => board.classList.remove('deal'), 1200);
  render();
}

function render() {
  const st = game.st;
  st.pens.forEach((p, i) => {
    const el = penEls[i];
    if (!el || el.classList.contains('closing')) return;
    el.hidden = p.done;
    el.style.setProperty('--x', p.x);
    el.style.setProperty('--y', p.y);
    el.querySelector('b').textContent = p.need - p.home;
    el.setAttribute('aria-label', `${COLORS[p.c].name} fold, mangler ${p.need - p.home} får`);
  });
  updateHud();
}

function updateHud() {
  const total = S.sheepTotal(game.st);
  $('#levelNo').textContent = game.level + 1;
  $('#home').textContent = `${total - S.sheepLeft(game.st)}/${total}`;
  $('#moves').textContent = game.moves;
  $('#undoBtn').disabled = !history.length || game.won || busy;
  $('#restartBtn').disabled = !game.started || game.won || busy;
}

function floatText(x, y, text) {
  const el = document.createElement('div');
  el.className = 'baa';
  el.style.cssText = `--x:${x};--y:${y}`;
  el.textContent = text;
  board.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ---------- moving ---------- */

// Takes one step and plays its effects. Returns false when the pen cannot go that way.
function tryStep(i, dx, dy) {
  const st = game.st;
  const why = S.blocked(st, i, dx, dy);
  if (why) return false;
  const p = st.pens[i];
  const r = S.step(st, i, dx, dy);
  const pe = penEls[i];
  pe.style.setProperty('--x', p.x);
  pe.style.setProperty('--y', p.y);
  pe.querySelector('b').textContent = p.need - p.home;
  Sound.play('step');
  if (r.caught.length) {
    stats.sheep += r.caught.length;
    for (const k of r.caught) {
      const el = sheepEls.get(k);
      sheepEls.delete(k);
      if (!el) continue;
      el.style.setProperty('--tx', p.x + (p.w - 1) / 2);
      el.style.setProperty('--ty', p.y + (p.h - 1) / 2);
      el.classList.add('caught');
      setTimeout(() => el.remove(), 360);
    }
    Sound.play('baa', { pitch: 0.9 + Math.random() * 0.3 });
    pe.classList.remove('gulp');
    void pe.offsetWidth;
    pe.classList.add('gulp');
  }
  if (r.closed) {
    pe.classList.add('closing');
    floatText(p.x + p.w / 2 - 0.5, p.y, 'Mæh!');
    Sound.play('close', { delay: 0.15 });
    setTimeout(() => {
      pe.classList.remove('closing', 'grab');
      pe.hidden = true;
    }, 650);
  }
  updateHud();
  return true;
}

// Cells holding sheep of another colour that stop pen i from stepping (dx, dy).
function blockers(i, dx, dy) {
  const { st } = game;
  const p = st.pens[i];
  const out = [];
  for (let y = p.y + dy; y < p.y + dy + p.h; y++) {
    for (let x = p.x + dx; x < p.x + dx + p.w; x++) {
      if (x < 0 || y < 0 || x >= st.w || y >= st.h) continue;
      const v = st.cells[y * st.w + x];
      if (v >= 0 && v !== p.c) out.push(y * st.w + x);
    }
  }
  return out;
}

let bumpedAt = 0;
function bump(i, dx, dy) {
  if (Date.now() - bumpedAt < 350) return;
  bumpedAt = Date.now();
  const pe = penEls[i];
  pe.classList.remove('bump');
  void pe.offsetWidth;
  pe.classList.add('bump');
  Sound.play('bump', { vol: 0.6 });
  for (const k of blockers(i, dx, dy)) {
    const el = sheepEls.get(k);
    if (!el) continue;
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
  }
  if (blockers(i, dx, dy).length && !stats.won && !game.hints) {
    toast('Et får i en anden farve står i vejen. Få det hjem først, eller kør udenom.');
  }
}

function cellFromEvent(e) {
  const r = board.getBoundingClientRect();
  const cs = cellSize();
  return { x: (e.clientX - r.left - 8) / cs, y: (e.clientY - r.top - 8) / cs };
}
const cellSize = () => parseFloat(getComputedStyle(board).getPropertyValue('--cs')) || 56;

function onDown(e) {
  const el = e.target.closest('.pen');
  if (!el || busy || game.won || drag) return;
  const i = +el.dataset.i;
  const p = game.st.pens[i];
  if (p.done) return;
  e.preventDefault();
  const c = cellFromEvent(e);
  drag = { i, ox: c.x - p.x, oy: c.y - p.y, before: snapshot(), moved: false, pid: e.pointerId };
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
  const p = game.st.pens[i];
  const tx = Math.round(c.x - drag.ox);
  const ty = Math.round(c.y - drag.oy);
  for (let guard = 0; guard < 24 && !p.done; guard++) {
    const ex = tx - p.x;
    const ey = ty - p.y;
    if (!ex && !ey) break;
    const sx = Math.sign(ex);
    const sy = Math.sign(ey);
    // try the longer way first, then slide along the other axis
    const order = Math.abs(ex) >= Math.abs(ey) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
    let moved = false;
    for (const [dx, dy] of order) {
      if (!dx && !dy) continue;
      if (tryStep(i, dx, dy)) {
        moved = true;
        if (!drag.moved) {
          drag.moved = true;
          history.push(drag.before);
          markStarted();
        }
        break;
      }
    }
    if (!moved) {
      const [dx, dy] = order[0][0] || order[0][1] ? order[0] : order[1];
      bump(i, dx, dy);
      break;
    }
  }
  if (p.done) endDrag();
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
    if (S.isWon(game.st)) win();
    save();
  }
}

/* ---------- undo, restart, hint ---------- */

function undo() {
  if (busy || game.won || drag || !history.length) return;
  const h = history.pop();
  game.st = h.st;
  game.moves = h.moves;
  Sound.play('undo');
  build();
  save();
}

function restart() {
  if (busy || game.won || drag || !game.started) return;
  history.push(snapshot());
  game.st = S.parseLevel(LEVELS[game.level]);
  game.moves = 0;
  Sound.play('undo');
  build(true);
  save();
  toast('Banen er startet forfra. Fortryd bringer dine træk tilbage.');
}

// The next drag on a shortest way home. On big meadows the solver may give up; then the
// hint walks a pen to the nearest sheep it can fetch, which is always a step forward.
function findHint() {
  const sol = S.solve(S.clone(game.st), { mode: 'steps', maxStates: 40000 });
  return S.firstDrag(sol) || S.nearestCatch(game.st);
}

async function hint() {
  if (busy || game.won || drag) return;
  const h = findHint();
  if (!h) return;
  busy = true;
  game.hints++;
  history.push(snapshot());
  markStarted();
  updateHud();
  const pe = penEls[h.pen];
  pe.classList.add('hint');
  Sound.play('hint');
  toast(`Prøv at flytte den ${COLORS[game.st.pens[h.pen].c].name} fold sådan her.`);
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
  if (S.isWon(game.st)) win();
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
  board.classList.add('won');
  Sound.play('win', { delay: 0.4 });
  setTimeout(() => {
    showWin({ newBest: newBest && prev !== undefined, prev });
  }, 1100);
}

function showWin({ newBest }) {
  const L = LEVELS[game.level];
  $('#wSub').textContent = `Bane ${game.level + 1} klaret`;
  $('#wMoves').textContent = game.moves;
  $('#wBest').textContent = progress.best[game.level];
  $('#wSheep').textContent = stats.sheep.toLocaleString('da-DK');
  const badges = [];
  if (newBest) badges.push('Ny rekord!');
  if (L.d && game.moves <= L.d) badges.push('Færrest mulige træk');
  if (!game.hints) badges.push('Uden tip');
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
  layout();
  build(true);
  save();
  if (level === 0) firstTimeTip();
}

function firstTimeTip() {
  setTimeout(() => toast('Træk folden med fingeren hen over fårene i samme farve.'), 600);
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
    ['Får talt hjem', stats.sheep.toLocaleString('da-DK')],
    ['Uden tip', stats.noHint],
  ]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`)
    .join('');
}

function renderLevels() {
  $('#levelsInfo').textContent = `${solvedCount()} af ${LEVELS.length} baner klaret. Klarer du en bane, åbner den næste.`;
  $('#levelGrid').innerHTML = LEVELS.map((_, i) => {
    const cls = [isSolved(i) ? 'done' : '', i === game.level && !game.won ? 'cur' : ''].join(' ');
    const label = `Bane ${i + 1}${isSolved(i) ? `, klaret på ${progress.best[i]} træk` : ''}`;
    return `<button type="button" class="${cls}" data-level="${i}" aria-label="${label}"${unlocked(i) ? '' : ' disabled'}>${i + 1}</button>`;
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
    if (level === game.level && !game.won) return;
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
  $('#introStats').textContent = n ? `Du har talt ${n.toLocaleString('da-DK')} får hjem` : '';
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

// Sizes the cells so the whole meadow fits next to (or above) the tool bar.
function layout() {
  const play = $('#play');
  play.classList.remove('wide');
  const r = play.getBoundingClientRect();
  const { w, h } = game.st;
  const wide = r.width > r.height * 1.25;
  play.classList.toggle('wide', wide);
  const tools = $('.tools').getBoundingClientRect();
  const availW = (wide ? r.width - tools.width - 60 : r.width - 24) - 16;
  const availH = (wide ? r.height - 24 : r.height - tools.height - 40) - 16;
  const cs = Math.max(30, Math.floor(Math.min(availW / w, availH / h, 92)));
  board.style.setProperty('--cs', `${cs}px`);
  play.style.setProperty('--bw', `${cs * w + 16}px`);
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

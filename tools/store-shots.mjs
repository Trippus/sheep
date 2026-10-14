// Renders the Google Play store graphics with headless Microsoft Edge:
// phone screenshots (1080×1920) and the feature graphic (1024×500).
// Usage: start the dev server (npm start), then: npm run shots
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withEdge } from './edge.mjs';

const BASE = process.env.BASE || 'http://localhost:5182/';
const out = fileURLToPath(new URL('../store/', import.meta.url));

const PHONE = { width: 412, height: 732, deviceScaleFactor: 2.625, mobile: true }; // → 1081×1921
const BANNER = { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false };
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;

// A player who has solved the first `n` levels and counted plenty of sheep home.
const saved = (n, settings = {}) => JSON.stringify({
  settings: { sound: true, symbols: true, theme: 'light', ...settings },
  stats: { won: n + 3, sheep: 1240, moves: 512, noHint: n - 4 },
  progress: { best: Object.fromEntries(Array.from({ length: n }, (_, i) => [i, 2 + (i % 5)])) },
});

// Plays level `level` up to drag `upTo` (a fraction of the solution, or 'last' for all but
// the final drag). Earlier drags are applied directly; the final one is a real pointer drag,
// so the HUD, undo button and animations look just like when a player does it.
const play = (level, upTo) => `
  document.querySelector('#iPlay').click();
  ${wait(400)}
  const A = window.__sheep, S = A.S;
  A.startLevel(${level});
  ${wait(1400)}
  const g = A.state;
  const steps = S.solve(S.clone(g.st), { maxStates: 2000000 }).steps;
  const drags = [];
  for (const s of steps) {
    if (!drags.length || drags[drags.length - 1][0][0] !== s[0]) drags.push([]);
    drags[drags.length - 1].push(s);
  }
  const k = ${upTo === 'last' ? 'drags.length' : `Math.max(1, Math.round(drags.length * ${upTo}))`};
  for (const d of drags.slice(0, k - 1)) for (const [i, dx, dy] of d) S.step(g.st, i, dx, dy);
  g.moves = k - 1;
  g.started = true;
  A.state = g;
  ${wait(300)}
  const board = document.querySelector('#board');
  const b = board.getBoundingClientRect();
  const cs = parseFloat(getComputedStyle(board).getPropertyValue('--cs'));
  const d = drags[k - 1];
  const pen = g.st.pens[d[0][0]];
  let x = pen.x, y = pen.y;
  const at = (x, y) => ({ clientX: b.left + 8 + (x + 0.5) * cs, clientY: b.top + 8 + (y + 0.5) * cs, pointerId: 1, bubbles: true });
  document.querySelector('.pen[data-i="' + d[0][0] + '"]').dispatchEvent(new PointerEvent('pointerdown', at(x, y)));
  for (const [, dx, dy] of d) {
    x += dx; y += dy;
    window.dispatchEvent(new PointerEvent('pointermove', at(x, y)));
    ${wait(120)}
  }
  window.dispatchEvent(new PointerEvent('pointerup', at(x, y)));`;

const MID_GAME = `${play(60, 0.2)} ${wait(900)}`;
const WIN = `${play(18, 'last')} ${wait(2600)}`;
const LEVELS = `
  document.querySelector('#iPlay').click();
  ${wait(1200)}
  document.querySelector('#levelsBtn').click();
  ${wait(900)}`;
const MENU = `
  document.querySelector('#iPlay').click();
  ${wait(1200)}
  document.querySelector('#menuBtn').click();
  ${wait(700)}`;
const DARK = `${play(66, 0.5)} ${wait(900)}`;

const shots = [
  { file: 'screenshots/1-intro.png', view: PHONE, url: BASE, storage: saved(38), setup: wait(1800) },
  { file: 'screenshots/2-spil.png', view: PHONE, url: BASE, storage: saved(60), setup: MID_GAME },
  { file: 'screenshots/3-sejr.png', view: PHONE, url: BASE, storage: saved(18), setup: WIN },
  { file: 'screenshots/4-baner.png', view: PHONE, url: BASE, storage: saved(38), setup: LEVELS },
  { file: 'screenshots/5-menu.png', view: PHONE, url: BASE, storage: saved(38), setup: MENU },
  { file: 'screenshots/6-moerk.png', view: PHONE, url: BASE, storage: saved(66, { theme: 'dark' }), setup: DARK },
  { file: 'feature-graphic-da.png', view: BANNER, url: BASE + 'store/feature-graphic.html', setup: wait(800) },
  { file: 'feature-graphic-en.png', view: BANNER, url: BASE + 'store/feature-graphic.html?lang=en', setup: wait(800) },
];

mkdirSync(out + 'screenshots', { recursive: true });
await withEdge(async (page) => {
  for (const shot of shots) {
    // Start every shot from a clean slate (optionally with a saved player). The storage is
    // prepared on a page without the game, so the game can't save over it on unload.
    await page.open(BASE + 'privacy.html', shot.view);
    const seed = shot.storage ? `localStorage.setItem('sheep.v1', ${JSON.stringify(shot.storage)});` : '';
    await page.eval(`localStorage.clear(); ${seed}`);
    await page.open(shot.url, shot.view);
    await page.eval(shot.setup);
    writeFileSync(out + shot.file, await page.shot());
    console.log('store/' + shot.file);
  }
});

// Shared setup for the end-to-end tests: starts the game's own dev server on a free
// port and a headless Edge, and gives each test a fresh page with empty storage.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchEdge, sleep } from '../../tools/edge.mjs';

export { sleep };
export const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function startGame() {
  const port = 5600 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, ['tools/serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve());
    server.on('exit', (code) => reject(new Error(`dev server exited (${code})`)));
  });
  const base = `http://localhost:${port}/`;
  const { page, close } = await launchEdge();

  return {
    page,
    base,
    // Opens the game with clean storage, optionally seeded with a saved game (an object).
    async fresh(saved = null, query = '') {
      await page.open(base + 'privacy.html', PHONE);
      await page.eval(`localStorage.clear(); ${saved ? `localStorage.setItem('sheep.v1', ${JSON.stringify(JSON.stringify(saved))});` : ''}`);
      page.errors.length = 0;
      await page.open(base + query, PHONE);
      await sleep(300);
    },
    async reload() {
      await page.eval('window.dispatchEvent(new Event("pagehide"))');
      await page.open(base, PHONE);
      await sleep(300);
    },
    async stop() {
      await close();
      server.kill();
    },
  };
}

// Small DOM helpers that run inside the page. They act through the real buttons and
// the board's pointer events, the same way a player does.
export const DOM = `
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const A = window.__sheep;
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const pens = () => A.state.st.pens;
  // Drags pen i with pointer events, through the given cells [x, y] (top-left of the pen).
  const dragPen = async (i, cells) => {
    const board = $('#board');
    const b = board.getBoundingClientRect();
    const cs = parseFloat(getComputedStyle(board).getPropertyValue('--cs'));
    const p = pens()[i];
    const at = (x, y) => ({ clientX: b.left + 8 + (x + 0.5) * cs, clientY: b.top + 8 + (y + 0.5) * cs, pointerId: 1, bubbles: true });
    document.querySelector('.pen[data-i="' + i + '"]').dispatchEvent(new PointerEvent('pointerdown', at(p.x, p.y)));
    for (const [x, y] of cells) {
      window.dispatchEvent(new PointerEvent('pointermove', at(x, y)));
      await wait(40);
    }
    const [lx, ly] = cells[cells.length - 1];
    window.dispatchEvent(new PointerEvent('pointerup', at(lx, ly)));
    await wait(40);
  };
  // Plays steps [pen, dx, dy] as drags: each run of steps with the same pen is one drag.
  const playSteps = async (steps) => {
    let k = 0;
    while (k < steps.length) {
      const i = steps[k][0];
      let x = pens()[i].x, y = pens()[i].y;
      const cells = [];
      for (; k < steps.length && steps[k][0] === i; k++) {
        x += steps[k][1];
        y += steps[k][2];
        cells.push([x, y]);
      }
      await dragPen(i, cells);
    }
  };
  const solveNow = () => A.S.solve(A.S.clone(A.state.st), { maxStates: 400000 }).steps;
  const startAt = async (n) => { $('#iPlay').click(); await wait(300); A.startLevel(n); await wait(200); };
`;

// Headless playtest: boots the built game, plays a bot for a while, and
// reports console errors plus a snapshot of game state. Screenshots land in
// tools/shots/. Run with: npm run playtest
//
// Playwright is resolved from wherever it is installed (this repo or a sibling
// project), so it stays an optional dev dependency.

import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(root, 'tools', 'shots');
const SECONDS = Number(process.argv[2] || 70);
// `god` tops the bot's lives up so a run can reach the later stages.
const GOD = process.argv.includes('god');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

await mkdir(SHOTS, { recursive: true });

const server = await createServer({ root, server: { port: 0, open: false, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(url);
await page.waitForFunction(() => window.game && window.game.keys);
await page.keyboard.press('Space');

const seen = new Set();
const timeline = [];

for (let t = 0; t < SECONDS; t++) {
  // Bot: hold fire, and track the nearest threat below the formation.
  await page.evaluate((god) => {
    const g = window.game;
    if (god && g.state !== 'title' && g.lives < 3) g.lives = 3;
    g.keys.add('Space');
    const p = g.player;
    if (!p || !p.alive) return;
    const threats = g.enemies.filter((e) => e.state === 'dive' || e.state === 'return');
    const bullets = g.enemyBullets;
    let target = threats.sort((a, b) => b.y - a.y)[0];
    let want = target ? target.x : g.enemies.length ? g.enemies[0].x : 112;
    // Dodge anything about to land on us.
    const near = bullets.find((b) => b.y > 180 && Math.abs(b.x - p.x) < 14);
    if (near) want = p.x + (near.x < p.x ? 26 : -26);
    g.keys.delete('ArrowLeft');
    g.keys.delete('ArrowRight');
    if (want < p.x - 2) g.keys.add('ArrowLeft');
    else if (want > p.x + 2) g.keys.add('ArrowRight');
  }, GOD);

  const snap = await page.evaluate(() => {
    const g = window.game;
    return {
      state: g.state,
      stage: g.stage,
      score: g.score,
      lives: g.lives,
      enemies: g.enemies.length,
      states: g.enemies.reduce((a, e) => ((a[e.state] = (a[e.state] || 0) + 1), a), {}),
      dual: !!g.player?.dual,
      captured: !!g.captive || g.enemies.some((e) => e.captive),
      beaming: g.enemies.some((e) => e.state === 'beam'),
    };
  });

  timeline.push({ t, ...snap });
  for (const s of Object.keys(snap.states)) seen.add(s);
  if (snap.dual) seen.add('DUAL_FIGHTER');
  if (snap.captured) seen.add('CAPTURE');
  if (snap.beaming) seen.add('TRACTOR_BEAM');
  seen.add(`stage${snap.stage}`);

  if (t % 10 === 0 || snap.beaming || snap.captured) {
    await page.locator('#game').screenshot({ path: join(SHOTS, `t${String(t).padStart(3, '0')}.png`) });
  }
  if (snap.state === 'title') break;
  await page.waitForTimeout(1000);
}

const last = timeline[timeline.length - 1];
console.log('--- playtest ---');
console.log('final:', last);
console.log('behaviours seen:', [...seen].sort().join(', '));
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.join('\n') : 'no console errors');

await writeFile(join(SHOTS, 'timeline.json'), JSON.stringify(timeline, null, 2));
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);

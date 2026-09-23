// Iteration harness for the cockpit field of view: puts threats out on the
// beam, where the question "are my wings clear?" is actually asked.
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = '/Users/ianblaney/projects/galaga';
const OUT = process.argv[2] || 'before';
const SHOTS = join('/private/tmp/claude-501/-Users-ianblaney-projects-galaga/3c1f2188-7402-408a-82ee-88f5a6413fd4/scratchpad', 'shots');
const { chromium } = await import('playwright');

await mkdir(SHOTS, { recursive: true });
const server = await createServer({ root, server: { port: 0, open: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto(url);
await page.waitForFunction(() => window.game && window.game.keys);
console.log('3d:', await page.evaluate(() => !!window.view3d));

await page.keyboard.press('Space');
await page.waitForFunction(
  () => window.game.enemies.filter((e) => e.state === 'form').length > 30,
  null, { timeout: 40000 },
);
await page.evaluate(() => { window.game.diveTimer = 1e9; window.game.pendingDives = []; });
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, `${OUT}-formation.png`) });

// The dodge: fire abeam the ship, at the offsets you actually have to read.
const stage = async (name, fn) => {
  await page.evaluate(fn);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(SHOTS, `${OUT}-${name}.png`) });
};

await stage('abeam', () => {
  const g = window.game;
  g.player.x = 112;
  g.player.invuln = 999;
  g.enemyBullets.length = 0;
  // Offsets either side, at the rows where a dodge is decided.
  for (const dx of [-46, -30, -16, 16, 30, 46]) {
    for (const y of [214, 236, 252]) {
      g.enemyBullets.push({ x: 112 + dx, y, vx: 0, vy: 60 });
    }
  }
});

await stage('wingtip', () => {
  const g = window.game;
  g.enemyBullets.length = 0;
  // The one that matters: level with you, just off the wing.
  for (const dx of [-24, -12, 12, 24]) g.enemyBullets.push({ x: 112 + dx, y: 256, vx: 0, vy: 60 });
  // And a diver coming in from the side rather than down the boresight.
  const e = g.enemies.find((x) => x.state === 'form');
  if (e) { e.path = null; e.state = 'toslot'; e.x = 60; e.y = 238; e.angle = Math.PI / 2; }
  const e2 = g.enemies.filter((x) => x.state === 'form')[3];
  if (e2) { e2.path = null; e2.state = 'toslot'; e2.x = 168; e2.y = 244; e2.angle = Math.PI / 2; }
});

await page.close();

const phone = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
await phone.goto(url);
await phone.waitForFunction(() => window.game && window.game.keys, null, { timeout: 60000 });
await phone.tap('#pad');
await phone.waitForTimeout(3000);
await phone.screenshot({ path: join(SHOTS, `${OUT}-phone.png`) });
await phone.close();

await browser.close();
await server.close();
if (errors.length) { console.log('ERRORS'); for (const e of errors) console.log(' ', e); }
console.log('shots ->', SHOTS, OUT);

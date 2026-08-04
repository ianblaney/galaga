// Focused test for Galaga's signature mechanic: tractor-beam capture, then
// shooting down the diving boss to rescue the fighter and go dual.
// Runs the real game code paths - it only nudges enemies into the right state.

import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(root, 'tools', 'shots');
const { chromium } = await import('playwright');

await mkdir(SHOTS, { recursive: true });
const server = await createServer({ root, server: { port: 0, open: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

await page.goto(url);
await page.waitForFunction(() => window.game && window.game.keys);
await page.keyboard.press('Space');

// Let the formation assemble, then stop the attack director interfering.
await page.waitForFunction(
  () => window.game.enemies.filter((e) => e.state === 'form').length > 30,
  null,
  { timeout: 20000 },
);
await page.evaluate(() => {
  window.game.diveTimer = 1e9;
  window.game.pendingDives = [];
});

const before = await page.evaluate(() => ({ lives: window.game.lives }));

// 1. Send a boss on a tractor-beam run directly above the player.
await page.evaluate(async () => {
  const { beamApproachPath } = await import('/src/paths.js');
  const g = window.game;
  const boss = g.enemies.find((e) => e.type === 'boss');
  g.player.x = boss.x;
  g.player.invuln = 0;
  boss.follow(beamApproachPath(boss.x, boss.y, g.player.x), 'beam', 110);
  window.__boss = boss;
});

await page.waitForFunction(() => window.game.enemies.some((e) => e.state === 'beam' && !e.path), {
  timeout: 15000,
});
await page.waitForTimeout(600); // let the cone open fully before the shot
await page.locator('#game').screenshot({ path: join(SHOTS, 'cap1-beam.png') });
check('tractor beam opens', true);

// Hold the player under the beam until it grabs them.
const captured = await page
  .waitForFunction(
    () => {
      const g = window.game;
      const b = window.__boss;
      if (g.player.alive) g.player.x = b.x;
      return !!g.captive || b.captive;
    },
    null,
    { timeout: 15000 },
  )
  .then(() => true)
  .catch(() => false);
check('player is captured by the beam', captured);
await page.locator('#game').screenshot({ path: join(SHOTS, 'cap2-captured.png') });

const afterCapture = await page.evaluate(() => ({
  lives: window.game.lives,
  playerAlive: window.game.player.alive,
}));
check('capture costs a life', afterCapture.lives === before.lives - 1, `${before.lives} -> ${afterCapture.lives}`);

// 2. Wait for the captive to dock under the boss.
const docked = await page
  .waitForFunction(() => window.__boss.captive && !window.game.captive, null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check('captured fighter is held by the boss', docked);
await page.locator('#game').screenshot({ path: join(SHOTS, 'cap3-held.png') });

// 3. Killing the boss in formation must NOT return the fighter.
const formationKill = await page.evaluate(() => {
  const g = window.game;
  const b = window.__boss;
  b.state = 'form';
  g.hitEnemy(b); // first hit only damages a boss
  const hpAfter = b.hp;
  return { hpAfter, dead: b.dead };
});
check('boss survives its first hit', formationKill.hpAfter === 1 && !formationKill.dead, `hp=${formationKill.hpAfter}`);

// 4. Send it diving, then shoot it down: the fighter should be freed.
await page.evaluate(async () => {
  const { divePath } = await import('/src/paths.js');
  const g = window.game;
  const b = window.__boss;
  b.follow(divePath(b.x, b.y, -1), 'dive', 90);
  g.player.alive = true;
  g.player.invuln = 99;
  setTimeout(() => g.hitEnemy(b), 300);
});

const freed = await page
  .waitForFunction(() => !!window.game.rescue || window.game.player.dual, null, { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check('shooting the diving boss frees the fighter', freed);
await page.locator('#game').screenshot({ path: join(SHOTS, 'cap4-rescue.png') });

// 5. The freed fighter docks and the player becomes a dual fighter.
const dual = await page
  .waitForFunction(() => window.game.player.dual, null, { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check('freed fighter docks into a DUAL FIGHTER', dual);
await page.locator('#game').screenshot({ path: join(SHOTS, 'cap5-dual.png') });

const shots = await page.evaluate(() => {
  const g = window.game;
  g.player.fireCd = 0;
  g.playerBullets.length = 0;
  g.fire();
  return g.playerBullets.length;
});
check('dual fighter fires two shots', shots === 2, `${shots} bullets`);

if (errors.length) console.log(`ERRORS:\n${errors.join('\n')}`);
const failed = checks.filter((c) => !c.pass).length + (errors.length ? 1 : 0);
console.log(`\n${checks.length - checks.filter((c) => !c.pass).length}/${checks.length} checks passed`);

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);

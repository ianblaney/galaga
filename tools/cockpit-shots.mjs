// Screenshots of the cockpit view at the moments worth looking at: the title,
// the formation assembling, a settled formation, a dive on the boresight, and
// a tractor beam open overhead — plus the chase view, where the thing being
// looked at is the ship itself.
//
// Visual iteration only — the assertions about whether the game still *works*
// live in playtest.mjs and capture-test.mjs, which are renderer-agnostic
// because they read window.game rather than pixels.

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

// Headless Chromium needs to be told to use the software GL stack, or there is
// no WebGL context at all and the game quietly falls back to the flat view.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
// Reported as they happen, not just at the end: a render error kills the frame
// loop, so the next waitForFunction hangs and the run dies without saying why.
const note = (line) => {
  errors.push(line);
  console.log(`  ! ${line}`);
};
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && note(`console: ${m.text()}`));

const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

await page.goto(url);
await page.waitForFunction(() => window.game && window.game.keys);

const using3d = await page.evaluate(() => !!window.view3d);
console.log(using3d ? 'cockpit view active' : 'FLAT fallback — no WebGL');

await page.waitForTimeout(600);
await shot('fps-title');

await page.keyboard.press('Space');
await page.waitForTimeout(1800);
await shot('fps-entry');

// Let the formation assemble, then hold the attack director off so the shot
// is of a full, settled formation.
await page.waitForFunction(
  () => window.game.enemies.filter((e) => e.state === 'form').length > 30,
  null,
  { timeout: 25000 },
);
await page.evaluate(() => {
  window.game.diveTimer = 1e9;
  window.game.pendingDives = [];
});
await page.waitForTimeout(400);
await shot('fps-formation');

// Steer, so the stick is deflected and the ship is banked in the frame.
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(500);
await shot('fps-bank');
await page.keyboard.up('ArrowLeft');

// Outside the ship. The formation has to still be up there, the Viper has to
// sit in the lower part of the frame without hiding it, and the ship has to
// visibly roll when you steer.
await page.keyboard.press('KeyV');
await page.waitForTimeout(400);
console.log('chase view:', await page.evaluate(() => window.view3d.chase));
await shot('fps-chase');
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(600);
await shot('fps-chase-bank');
await page.keyboard.up('ArrowRight');

// The dual fighter, which in this view is a second airframe on your wing.
await page.evaluate(() => { window.game.player.dual = true; });
await page.waitForTimeout(400);
await shot('fps-chase-dual');
await page.evaluate(() => { window.game.player.dual = false; });

await page.keyboard.press('KeyV');
await page.waitForTimeout(300);
if (await page.evaluate(() => window.view3d.chase)) note('V did not swap back to the cockpit');

// A dive, aimed straight down the boresight. `dir` is not optional — leaving
// it out builds the dive path from NaN and the enemy vanishes.
await page.evaluate(() => {
  const g = window.game;
  const e = g.enemies.find((x) => x.state === 'form' && x.type === 'butterfly');
  g.player.x = e.x;
  g.startDive(e, 1);
});
await page.waitForTimeout(700);
await shot('fps-dive');
await page.waitForTimeout(700);
await shot('fps-dive-close');

// A diver parked right on top of the player, which is the frame where the
// scale of the mapping either works or falls apart.
await page.evaluate(() => {
  const g = window.game;
  const e = g.enemies.find((x) => x.state === 'dive') || g.enemies[0];
  e.path = null;
  e.state = 'toslot';
  e.x = g.player.x + 6;
  e.y = 212;
  e.angle = Math.PI / 2;
});
await page.waitForTimeout(60);
await shot('fps-close-pass');

// A tractor beam, opened right overhead.
await page.evaluate(() => {
  const g = window.game;
  const boss = g.enemies.find((x) => x.type === 'boss' && x.state === 'form');
  boss.state = 'beam';
  boss.path = null;
  boss.beamT = 0.7;
  boss.x = g.player.x;
  boss.y = 120;
  boss.angle = Math.PI / 2;
  g.player.invuln = 99; // watch the cone, don't get taken by it
});
await page.waitForTimeout(500);
await shot('fps-beam');

// Fire, so a tracer is in flight.
await page.keyboard.press('Space');
await page.waitForTimeout(90);
await shot('fps-fire');

// And the phone: the slide strip has to drive the stick, and the cockpit has
// to survive being squeezed into a portrait playfield.
// The desktop page goes first: two live WebGL contexts on the software
// rasteriser starve each other and the second page never finishes booting.
await page.close();

const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
phone.on('pageerror', (e) => note(`phone pageerror: ${e.message}`));
phone.on('console', (m) => m.type() === 'error' && note(`phone console: ${m.text()}`));
await phone.goto(url);
await phone.waitForFunction(() => window.game && window.game.keys, null, { timeout: 60000 });
await phone.tap('#pad');
await phone.waitForTimeout(2500);

// Slide the thumb hard left, and catch the stick while it is still moving.
const pad = await phone.locator('#pad').boundingBox();
await phone.touchscreen.tap(pad.x + pad.width * 0.85, pad.y + pad.height / 2);
await phone.waitForTimeout(400);
await phone.touchscreen.tap(pad.x + pad.width * 0.15, pad.y + pad.height / 2);
await phone.waitForTimeout(80);
console.log('phone state:', await phone.evaluate(() => ({
  state: window.game.state,
  beaming: window.game.enemies.some((e) => e.state === 'beam'),
  captured: !!window.game.captive,
  shots: window.game.shots,
})));
await phone.screenshot({ path: join(SHOTS, 'fps-phone.png') });
await phone.close();

// ?flat has to keep working: it is the fallback when there is no WebGL, and
// it is the view the other tools read the playfield from.
const flat = await browser.newPage({ viewport: { width: 900, height: 1000 } });
flat.on('pageerror', (e) => note(`flat pageerror: ${e.message}`));
flat.on('console', (m) => m.type() === 'error' && note(`flat console: ${m.text()}`));
await flat.goto(`${url}?flat`);
await flat.waitForFunction(() => window.game && window.game.keys, null, { timeout: 60000 });
const flatIs3d = await flat.evaluate(() => !!window.view3d);
console.log(flatIs3d ? '?flat FAILED — 3D view still built' : '?flat falls back to the arcade view');
await flat.keyboard.press('Space');
await flat.waitForTimeout(2500);
await flat.screenshot({ path: join(SHOTS, 'fps-flat-fallback.png') });
await flat.close();
if (flatIs3d) note('?flat did not disable the cockpit view');

await browser.close();
await server.close();

if (errors.length) {
  console.log('\nERRORS');
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
console.log(`\nshots written to tools/shots/`);

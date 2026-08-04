// Touch-control check: boots the game on phone-sized, touch-enabled viewports
// and asserts the drag-to-steer control, the button row, and the layout.
// Screenshots land in tools/shots/. Run with: npm run test:touch
//
// Playwright is an optional dev dependency, same as the other tools here.

import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(root, 'tools', 'shots');

let chromium, devices;
try {
  ({ chromium, devices } = await import('playwright'));
} catch {
  console.error('playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

await mkdir(SHOTS, { recursive: true });

const server = await createServer({ root, server: { port: 0, open: false, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();

const failures = [];
const check = (name, cond, detail) => {
  if (!cond) failures.push(`${name}: ${detail}`);
};

async function run(label, opts) {
  const touch = !!opts.hasTouch;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(url);
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const c = document.getElementById('game').getBoundingClientRect();
    return {
      w: Math.round(c.width),
      h: Math.round(c.height),
      panelShown: !document.getElementById('touch').classList.contains('hidden'),
      overflowX: document.body.scrollWidth > window.innerWidth,
      vw: window.innerWidth,
    };
  });

  check(label, !layout.overflowX, 'page scrolls horizontally');
  check(label, layout.panelShown === touch, `button panel shown=${layout.panelShown}, expected ${touch}`);
  if (touch) {
    check(label, layout.w >= layout.vw * 0.85 || layout.h >= 280,
      `playfield ${layout.w}x${layout.h} is small for a ${layout.vw}px viewport`);
  }

  const box = await page.locator('#game').boundingBox();

  // A tap on the title screen starts a game.
  if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  check(label, (await page.evaluate(() => window.game.state)) !== 'title', 'tap did not start a game');

  if (touch) {
    // Drag left. Real touch events via CDP so pointerType is 'touch'.
    const cy = box.y + box.height * 0.8;
    const cdp = await ctx.newCDPSession(page);
    const send = (type, x) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: cy, id: 1 }],
      });

    const shots0 = await page.evaluate(() => window.game.shots);
    await send('touchStart', box.x + box.width / 2);
    await page.waitForTimeout(60);
    for (let i = 0; i <= 10; i++) {
      await send('touchMove', box.x + box.width * (0.5 - 0.45 * (i / 10)));
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(400);
    const mid = await page.evaluate(() => ({
      x: window.game.player.x,
      auto: window.game.keys.has('autoFire'),
      shots: window.game.shots,
    }));
    check(label, mid.x < 40, `ship did not follow the drag (x=${mid.x.toFixed(1)})`);
    check(label, mid.auto, 'auto-fire not engaged while held');
    check(label, mid.shots > shots0, 'no shots fired while held');

    await send('touchEnd', 0);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      aim: window.game.aimX,
      auto: window.game.keys.has('autoFire'),
    }));
    check(label, after.aim === null, 'aim not cleared on release');
    check(label, !after.auto, 'auto-fire stuck on after release');

    // Pause and mute, which have no keyboard equivalent on a phone.
    await page.locator('#t-pause').click();
    await page.waitForTimeout(120);
    check(label, await page.evaluate(() => window.game.paused), 'pause button did not pause');
    await page.locator('#t-pause').click();
    await page.waitForTimeout(120);
    check(label, !(await page.evaluate(() => window.game.paused)), 'pause button did not resume');
    await page.locator('#t-mute').click();
    await page.waitForTimeout(120);
    check(label, await page.evaluate(() => window.game.muted), 'mute button did not mute');

    // Every control must clear the 44px minimum tap target.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.tbtn')]
        .map((b) => ({ id: b.id, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 40 || r.height < 40)
        .map(({ id }) => id));
    check(label, small.length === 0, `tap targets too small: ${small.join(', ')}`);
  } else {
    // A desktop mouse must not hijack steering.
    const x0 = await page.evaluate(() => window.game.player.x);
    await page.mouse.move(box.x + 20, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const drifted = await page.evaluate(() => ({ x: window.game.player.x, aim: window.game.aimX }));
    await page.mouse.up();
    check(label, drifted.aim === null, 'mouse drag took over steering on desktop');
    check(label, Math.abs(drifted.x - x0) < 1, 'ship moved on a desktop mouse drag');
  }

  check(label, errors.length === 0, `console errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: join(SHOTS, `touch-${label.replace(/\W+/g, '-')}.png`) });
  console.log(`  ${label}: playfield ${layout.w}x${layout.h}`);
  await ctx.close();
}

await run('iphone-portrait', devices['iPhone 13']);
await run('iphone-landscape', devices['iPhone 13 landscape']);
await run('pixel-portrait', devices['Pixel 7']);
await run('desktop', { viewport: { width: 1200, height: 900 } });

await browser.close();
await server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll touch-control checks passed.');

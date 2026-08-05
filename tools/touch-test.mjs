// Touch-control check: boots the game on phone-sized, touch-enabled viewports
// and asserts the slide strip, auto-fire, the pause/mute buttons and the layout.
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
      top: Math.round(c.top),
      bottom: Math.round(document.getElementById('cabinet').getBoundingClientRect().bottom),
      vh: window.innerHeight,
      panelShown: !document.getElementById('touch').classList.contains('hidden'),
      overflowX: document.body.scrollWidth > window.innerWidth,
      vw: window.innerWidth,
    };
  });

  check(label, !layout.overflowX, 'page scrolls horizontally');
  check(label, layout.top >= -1, `playfield clipped off the top (top=${layout.top})`);
  check(label, layout.bottom <= layout.vh + 1,
    `controls clipped off the bottom (bottom=${layout.bottom}, viewport=${layout.vh})`);
  check(label, layout.panelShown === touch, `button panel shown=${layout.panelShown}, expected ${touch}`);
  if (touch) {
    // Should claim most of whichever axis is the binding one.
    check(label, layout.w >= layout.vw * 0.85 || layout.h >= layout.vh * 0.6,
      `playfield ${layout.w}x${layout.h} is small for a ${layout.vw}x${layout.vh} viewport`);
  }

  const box = await page.locator('#game').boundingBox();

  // A tap on the title screen starts a game.
  if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  check(label, (await page.evaluate(() => window.game.state)) !== 'title', 'tap did not start a game');

  if (touch) {
    // The strip must sit clear of the playfield, or a thumb on it covers the game.
    const padBox = await page.locator('#pad').boundingBox();
    check(label, padBox.y >= box.y + box.height - 1,
      'slide strip overlaps the playfield');
    check(label, padBox.height >= 50, `slide strip only ${padBox.height}px tall`);
    check(label, padBox.width >= layout.vw * 0.6,
      `slide strip only ${Math.round(padBox.width)}px of a ${layout.vw}px viewport`);

    // No fire/arrow buttons should remain.
    const gone = await page.evaluate(() =>
      ['t-left', 't-right', 't-fire'].filter((id) => document.getElementById(id)));
    check(label, gone.length === 0, `old buttons still present: ${gone.join(', ')}`);

    // Auto-fire runs without anything held (once the stage is actually live).
    await page.waitForFunction(() => window.game.state === 'play', null, { timeout: 8000 });
    const shots0 = await page.evaluate(() => window.game.shots);
    await page.waitForTimeout(700);
    check(label, (await page.evaluate(() => window.game.shots)) > shots0,
      'ship does not auto-fire with nothing held');

    // Slide along the strip: right end, then left end.
    const py = padBox.y + padBox.height / 2;
    const cdp = await ctx.newCDPSession(page);
    const send = (type, x) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: py, id: 1 }],
      });

    await send('touchStart', padBox.x + padBox.width * 0.95);
    for (let i = 0; i < 8; i++) { await send('touchMove', padBox.x + padBox.width * 0.95); await page.waitForTimeout(40); }
    await page.waitForTimeout(300);
    const right = await page.evaluate(() => window.game.player.x);
    check(label, right > 180, `strip right end put the ship at x=${right.toFixed(1)}, expected near 210`);
    const knobRight = await page.locator('#pad-knob').boundingBox();
    check(label, knobRight.x + knobRight.width <= padBox.x + padBox.width + 1,
      'knob clips past the right end');

    for (let i = 0; i <= 12; i++) {
      await send('touchMove', padBox.x + padBox.width * (0.95 - 0.9 * (i / 12)));
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => window.game.player.x);
    check(label, left < 40, `strip left end put the ship at x=${left.toFixed(1)}, expected near 11`);

    // The knob tracks the thumb and never clips out of the strip.
    const knobBox = await page.locator('#pad-knob').boundingBox();
    check(label, knobBox.x >= padBox.x - 1,
      `knob clips past the left end (${knobBox.x.toFixed(1)} vs pad ${padBox.x.toFixed(1)})`);
    check(label, knobBox.x - padBox.x < padBox.width * 0.15,
      'knob did not travel to the left end');

    await send('touchEnd', 0);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      aim: window.game.aimX,
      x: window.game.player.x,
      auto: window.game.keys.has('autoFire'),
    }));
    check(label, after.aim === null, 'aim not cleared on release');
    check(label, Math.abs(after.x - left) < 12, 'ship did not hold station after release');
    check(label, after.auto, 'auto-fire should stay on after release');

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

    // Tapping the playfield must not steer — that was the occlusion problem.
    const before = await page.evaluate(() => window.game.player.x);
    await page.touchscreen.tap(box.x + box.width * 0.9, box.y + box.height * 0.5);
    await page.waitForTimeout(250);
    const afterTapX = await page.evaluate(() => ({ x: window.game.player.x, aim: window.game.aimX }));
    check(label, afterTapX.aim === null, 'playfield tap still steers');
    check(label, Math.abs(afterTapX.x - before) < 6, 'ship moved from a playfield tap');
  } else {
    // A desktop mouse must not hijack steering.
    const x0 = await page.evaluate(() => window.game.player.x);
    await page.mouse.move(box.x + 20, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const drifted = await page.evaluate(() => ({
      x: window.game.player.x,
      aim: window.game.aimX,
      auto: window.game.keys.has('autoFire'),
    }));
    await page.mouse.up();
    check(label, drifted.aim === null, 'mouse drag took over steering on desktop');
    check(label, Math.abs(drifted.x - x0) < 1, 'ship moved on a desktop mouse drag');
    check(label, !drifted.auto, 'desktop should not auto-fire');
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

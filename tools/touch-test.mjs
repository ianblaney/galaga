// Touch-control check: boots the game on phone-sized, touch-enabled viewports
// and asserts the full-screen layout, the stick ring over the cockpit's control
// column, auto-fire, the buttons on the score row, and that nothing else on the
// screen steers. Also runs the ?flat fallback on a phone, where there is no
// cockpit and the ring has to find room beside the playfield instead.
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
// The software GL stack, or headless Chromium has no WebGL and every run
// quietly tests the flat fallback instead of the cockpit.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const failures = [];
const check = (name, cond, detail) => {
  if (!cond) failures.push(`${name}: ${detail}`);
};

const rect = (r) => r && { x: r.x, y: r.y, w: r.width, h: r.height, r: r.x + r.width, b: r.y + r.height };

async function run(label, opts, { flat = false } = {}) {
  const touch = !!opts.hasTouch;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(flat ? `${url}?flat` : url);
  await page.waitForFunction(() => window.game && window.game.keys, null, { timeout: 60000 });
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el || el.offsetParent === null) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      overflowX: document.body.scrollWidth > window.innerWidth,
      cockpit: !!window.view3d,
      view: box('view3d'),
      game: box('game'),
      stick: box('stick'),
      buttons: box('hud-buttons'),
      overlay: [document.getElementById('game').width, document.getElementById('game').height],
      grip: window.view3d && window.view3d.stickOnScreen().grip,
    };
  });
  const { vw, vh } = layout;
  const game = rect(layout.game);
  const stick = rect(layout.stick);
  const buttons = rect(layout.buttons);

  check(label, layout.cockpit === !flat, `cockpit view ${layout.cockpit ? 'on' : 'off'}, expected ${!flat}`);
  check(label, !layout.overflowX, 'page scrolls horizontally');
  check(label, game.y >= -1 && game.b <= vh + 1, `arcade canvas off screen (${game.y}..${game.b} of ${vh})`);

  if (layout.cockpit) {
    // The cockpit is the whole screen, and the overlay is the screen's shape.
    const v = rect(layout.view);
    check(label, v.x <= 0 && v.y <= 0 && v.r >= vw && v.b >= vh,
      `cockpit is ${Math.round(v.w)}x${Math.round(v.h)}, not the whole ${vw}x${vh} screen`);
    const [cw, ch] = layout.overlay;
    check(label, Math.abs(cw / ch - game.w / game.h) < 0.02,
      `overlay buffer ${cw}x${ch} is stretched over ${Math.round(game.w)}x${Math.round(game.h)}`);
  } else if (touch) {
    // Flat: the cabinet should still claim most of whichever axis binds.
    check(label, game.w >= vw * 0.6 || game.h >= vh * 0.6,
      `playfield ${Math.round(game.w)}x${Math.round(game.h)} is small for a ${vw}x${vh} viewport`);
  }

  check(label, !!stick === touch, `stick shown=${!!stick}, expected ${touch}`);
  check(label, !!buttons === touch, `buttons shown=${!!buttons}, expected ${touch}`);

  if (touch) {
    const ringR = stick.w / 2 - 12; // the visible ring is drawn 12px inside the target
    const sx = stick.x + stick.w / 2;
    const sy = stick.y + stick.h / 2;
    // The touch target may hang off the edge; the ring you can see may not.
    check(label, sx - ringR >= 0 && sx + ringR <= vw && sy - ringR >= 0 && sy + ringR <= vh,
      'stick ring runs off the screen');
    check(label, ringR >= 38, `stick ring only ${Math.round(ringR)}px across the radius`);

    if (layout.cockpit) {
      // The ring has to be over the cockpit's own stick, which is the point.
      const gx = ((layout.grip.x + 1) / 2) * vw;
      const gy = ((1 - layout.grip.y) / 2) * vh;
      check(label, Math.hypot(gx - sx, gy - sy) <= ringR,
        `ring at ${Math.round(sx)},${Math.round(sy)} does not cover the grip at ${Math.round(gx)},${Math.round(gy)}`);
    } else {
      // No cockpit: it must sit clear of the playfield, or a thumb covers the game.
      const clear = stick.y >= game.b - 1 || stick.x >= game.r - 1;
      check(label, clear, 'flat: stick ring overlaps the playfield');
    }

    // Buttons up on the score row, after the score, clear of the stick.
    check(label, buttons.y < vh * 0.12, `buttons at y=${Math.round(buttons.y)}, not up on the score row`);
    check(label, buttons.r <= vw + 1 && buttons.x >= 0, 'buttons run off the screen');
    check(label, buttons.b < stick.y, 'buttons overlap the stick');
    const scale = game.w / layout.overlay[0];
    const col = game.x + Math.floor((layout.overlay[0] - 224) / 2) * scale;
    check(label, buttons.x >= col + 135 * scale - 1, 'buttons overlap HIGH SCORE');

    // No fire/arrow buttons, and no slide strip.
    const gone = await page.evaluate(() =>
      ['t-left', 't-right', 't-fire', 'pad', 'touch'].filter((id) => document.getElementById(id)));
    check(label, gone.length === 0, `old controls still present: ${gone.join(', ')}`);
  }

  // A tap on the title screen starts a game. Up on the glass, clear of the
  // buttons and the ring, which have taps of their own.
  const tapAt = [vw / 2, vh * 0.3];
  if (touch) await page.touchscreen.tap(...tapAt);
  else await page.mouse.click(...tapAt);
  await page.waitForTimeout(400);
  check(label, (await page.evaluate(() => window.game.state)) !== 'title', 'tap did not start a game');

  if (touch) {
    // Auto-fire runs without anything held (once the stage is actually live).
    await page.waitForFunction(() => window.game.state === 'play', null, { timeout: 8000 });
    // Waited on rather than timed: the software renderer can take most of a
    // second over a full-screen frame, and the simulation only steps between.
    const shots0 = await page.evaluate(() => window.game.shots);
    const fired = await page.waitForFunction((n) => window.game.shots > n, shots0, { timeout: 4000 })
      .then(() => true, () => false);
    check(label, fired, 'ship does not auto-fire with nothing held');

    const ringR = stick.w / 2 - 12;
    const sx = stick.x + stick.w / 2;
    const sy = stick.y + stick.h / 2;
    const cdp = await ctx.newCDPSession(page);
    const send = (type, x) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: sy, id: 1 }],
      });
    const shipX = () => page.evaluate(() => window.game.player.x);
    const held = () => page.evaluate(() => window.view3d && window.view3d.stickHeld);

    // Wherever the thumb lands is centre: landing off the middle of the ring
    // must not throw the ship sideways.
    const x0 = await shipX();
    await send('touchStart', sx + ringR * 0.6);
    await page.waitForTimeout(300);
    check(label, Math.abs((await shipX()) - x0) < 1, 'landing off-centre on the stick moved the ship');

    // Push right: the ship goes right, and the cockpit's stick goes with it.
    for (let i = 1; i <= 6; i++) { await send('touchMove', sx + ringR * 0.6 + ringR * (i / 6)); await page.waitForTimeout(30); }
    if (layout.cockpit) {
      // Input is delivered on animation frames, which the software renderer
      // makes slow, so wait for the push to land rather than for a fixed time.
      await page.waitForFunction(() => window.view3d.stickHeld > 0.9, null, { timeout: 3000 }).catch(() => {});
      const k = await held();
      check(label, k > 0.9, `stick not over to the right while pushed (held=${k})`);
    }
    await page.waitForTimeout(700);
    const right = await shipX();
    check(label, right > x0 + 60, `pushing right moved the ship ${(right - x0).toFixed(1)}px`);

    // Hard over the other way, past the ring: clamped, not off the end of the
    // world, and the ship reaches the left wall.
    for (let i = 1; i <= 8; i++) { await send('touchMove', sx + ringR * 0.6 - ringR * 2.5 * (i / 8)); await page.waitForTimeout(30); }
    await page.waitForTimeout(1600);
    const left = await shipX();
    check(label, left < 30, `pushing left left the ship at x=${left.toFixed(1)}, expected near 10`);

    // Let go: the stick centres and the ship holds station.
    await send('touchEnd', 0);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      steer: window.game.steer,
      held: window.view3d && window.view3d.stickHeld,
      x: window.game.player.x,
      auto: window.game.keys.has('autoFire'),
    }));
    await page.waitForTimeout(300);
    check(label, after.steer === 0, 'steering not cleared on release');
    if (layout.cockpit) check(label, after.held === null, 'stick still held after release');
    check(label, Math.abs((await shipX()) - after.x) < 1, 'ship did not hold station after release');
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
    if (layout.cockpit) {
      await page.locator('#t-view').click();
      await page.waitForTimeout(250);
      check(label, await page.evaluate(() => window.view3d.chase), 'view button did not swap views');
      // From outside, the ring must not sit on the ship you swapped to watch.
      const chase = await page.evaluate(() => {
        const v = window.view3d;
        const p = new v.ship.group.position.constructor();
        v.ship.group.getWorldPosition(p).project(v.camera);
        const r = document.getElementById('stick').getBoundingClientRect();
        return {
          ship: [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight],
          ring: [r.x + r.width / 2, r.y + r.height / 2, r.width / 2 - 12],
        };
      });
      const [rx, ry, rr] = chase.ring;
      check(label, Math.hypot(chase.ship[0] - rx, chase.ship[1] - ry) > rr * 2,
        `chase view: ring at ${Math.round(rx)},${Math.round(ry)} sits on the ship at ${chase.ship.map(Math.round)}`);
      await page.locator('#t-view').click();
      await page.waitForTimeout(250);
      const back = await page.locator('#stick').boundingBox();
      check(label, Math.abs(back.y - stick.y) < 1, 'ring did not go back over the stick in the cockpit');
    }

    // Tapping anywhere else must not steer — that was the occlusion problem.
    const before = await shipX();
    await page.touchscreen.tap(vw * 0.85, vh * 0.4);
    await page.waitForTimeout(250);
    const tapped = await page.evaluate(() => ({ x: window.game.player.x, steer: window.game.steer }));
    check(label, tapped.steer === 0, 'a tap on the screen steers');
    check(label, Math.abs(tapped.x - before) < 1, 'ship moved from a tap on the screen');
  } else {
    // A desktop mouse must not hijack steering.
    const x0 = await page.evaluate(() => window.game.player.x);
    await page.mouse.move(vw / 2, vh * 0.8);
    await page.mouse.down();
    await page.mouse.move(vw / 2 + 120, vh * 0.8, { steps: 6 });
    await page.waitForTimeout(300);
    const drifted = await page.evaluate(() => ({
      x: window.game.player.x,
      steer: window.game.steer,
      auto: window.game.keys.has('autoFire'),
    }));
    await page.mouse.up();
    check(label, drifted.steer === 0, 'mouse drag took over steering on desktop');
    check(label, Math.abs(drifted.x - x0) < 1, 'ship moved on a desktop mouse drag');
    check(label, !drifted.auto, 'desktop should not auto-fire');
  }

  check(label, errors.length === 0, `console errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: join(SHOTS, `touch-${label.replace(/\W+/g, '-')}.png`) });
  console.log(`  ${label}: ${layout.cockpit ? 'cockpit' : 'flat'} ${vw}x${vh}`
    + (stick ? `, ring r=${Math.round(stick.w / 2 - 12)} at ${Math.round(stick.x + stick.w / 2)},${Math.round(stick.y + stick.h / 2)}` : ''));
  await ctx.close();
}

await run('iphone-portrait', devices['iPhone 13']);
await run('iphone-landscape', devices['iPhone 13 landscape']);
await run('pixel-portrait', devices['Pixel 7']);
await run('iphone-portrait-flat', devices['iPhone 13'], { flat: true });
await run('iphone-landscape-flat', devices['iPhone 13 landscape'], { flat: true });
await run('desktop', { viewport: { width: 1200, height: 900 } });

await browser.close();
await server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll touch-control checks passed.');

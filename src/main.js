import { Game } from './game.js';
import { W, H } from './sprites.js';
import { sfx } from './audio.js';
import { View3D } from './render3d/view3d.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

// Exposed for headless playtesting in tools/playtest.mjs.
window.game = game;

// --- Renderer ---------------------------------------------------------------
// The cockpit view is the game. ?flat falls back to the original top-down
// canvas — useful on a machine with no working WebGL, and it is what the
// headless tools use when they want to read the playfield directly. ?chase
// opens outside the ship instead of in it; V swaps either way at any time.

const params = new URLSearchParams(location.search);
const wantFlat = params.has('flat');

let view = null;
if (!wantFlat) {
  try {
    view = new View3D(document.getElementById('view3d'), { bloom: !params.has('nobloom') });
    if (params.has('chase')) view.setChase(true);
    document.body.classList.add('fps');
  } catch (err) {
    // A context failure here must not take the game with it.
    console.warn('cockpit view unavailable, falling back to flat', err);
    view = null;
  }
}
window.view3d = view;

// --- Layout -----------------------------------------------------------------
// Everything on the stage is placed from here, because every piece of it hangs
// off the same few numbers: the size of the screen, where the safe area is, and
// the scale the arcade art is drawn at.

const coarse = window.matchMedia('(pointer: coarse)').matches;

const stage = document.getElementById('stage');
const safeArea = document.getElementById('safe');
const legend = document.getElementById('legend');
const stick = document.getElementById('stick');
const buttons = document.getElementById('hud-buttons');

// The arcade x the HIGH SCORE block ends at; the buttons start just past it.
const SCORE_END = 138;

function visible(el) {
  return el && el.offsetParent !== null;
}

function place(el, x, y, w, h) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (w != null) el.style.width = `${w}px`;
  if (h != null) el.style.height = `${h}px`;
}

/** CSS px per arcade px for the arcade art, fitted to w x h. */
function arcadeScale(w, h) {
  const fit = Math.min(w / W, h / H);
  // Less room than the native 224x288. Shrink, or the score row gets clipped
  // off the top of a landscape phone.
  if (fit < 1) return Math.max(fit, 0.4);
  // Whole-pixel scaling keeps the art crisp, but on a phone it can throw away
  // a third of the screen. Take the fractional fit when rounding is costly.
  const whole = Math.floor(fit);
  return coarse && whole / fit < 0.85 ? fit : whole;
}

let stickReach = 50; // CSS px of thumb travel that is full deflection

function layout() {
  const vw = stage.clientWidth;
  const vh = stage.clientHeight;
  const safe = safeArea.getBoundingClientRect();
  const ring = Math.max(40, Math.min(64, Math.min(vw, vh) * 0.14)); // ring radius
  stickReach = ring;

  let scale;
  let col; // the arcade frame's 224px column on screen, which the score sits in
  let right; // how far right the buttons may go
  let stickAt;

  if (view) {
    // The cockpit is the whole screen. The overlay covers the safe area, in
    // arcade pixels at the art's scale, so it is the shape of the screen and
    // the score sits on the sky rather than in a box of its own.
    view.setSize(vw, vh);
    scale = arcadeScale(safe.width, safe.height);
    const cw = Math.round(safe.width / scale);
    const ch = Math.round(safe.height / scale);
    game.setOverlaySize(cw, ch);
    place(canvas, safe.left, safe.top, safe.width, safe.height);
    col = safe.left + Math.floor((cw - W) / 2) * (safe.width / cw);
    right = safe.right;

    if (view.chase) {
      // From outside there is no stick to put it over, and where the stick
      // was is where the ship now sits. So it drops to the bottom of the
      // screen, below the ship — or into the corner, on a frame too short to
      // fit it underneath.
      stickAt = vw > vh
        ? [safe.right - ring - 24, safe.bottom - ring - 16]
        : [safe.left + safe.width / 2, safe.bottom - ring - Math.max(24, vh * 0.05)];
    } else {
      // The ring goes over the control column, centred a little way down it
      // from the grip so it takes in the whole stick. A wide frame can push
      // the column toward the bottom edge, so it is kept on screen regardless.
      const { grip, base } = view.stickOnScreen();
      const px = (p) => [((p.x + 1) / 2) * vw, ((1 - p.y) / 2) * vh];
      const [gx, gy] = px(grip);
      const [bx, by] = px(base);
      stickAt = [gx + (bx - gx) * 0.35, Math.min(gy + (by - gy) * 0.35, safe.bottom - ring - 6)];
    }
  } else {
    // The flat view is the cabinet: the 224x288 playfield, centred, with room
    // kept beside or below it for the stick so a thumb never covers the game.
    game.setOverlaySize(W, H);
    const legendH = visible(legend) ? legend.offsetHeight + 12 : 0;
    const sideways = vw > vh;
    const zone = coarse ? ring * 2 + 40 : 0;
    const availW = safe.width - 16 - (sideways ? zone : 0);
    const availH = safe.height - 16 - legendH - (sideways ? 0 : zone);
    scale = arcadeScale(availW, availH);
    const w = Math.round(W * scale);
    const h = Math.round(H * scale);
    const x = safe.left + (safe.width - (sideways ? zone : 0) - w) / 2;
    const y = safe.top + (safe.height - legendH - (sideways ? 0 : zone) - h) / 2;
    place(canvas, x, y, w, h);
    col = x;
    right = x + w;
    stickAt = sideways ? [x + w + zone / 2, y + h * 0.7] : [safe.left + safe.width / 2, y + h + zone / 2];
  }

  // The stick's element is the touch target; its ring is drawn 12px inside.
  const hit = ring + 12;
  place(stick, stickAt[0] - hit, stickAt[1] - hit, hit * 2, hit * 2);

  // The buttons sit on the score row, just past HIGH SCORE. On a portrait
  // phone that runs them out to the right edge; on anything wider they stay
  // beside the score rather than drifting off to the far corner.
  const n = [...buttons.children].filter((b) => !b.classList.contains('hidden')).length;
  const gap = 6;
  const from = col + SCORE_END * scale;
  const width = Math.max(n * 28 + (n - 1) * gap, Math.min(right - 6 - from, n * 44 + (n - 1) * gap));
  const bh = Math.max(28, Math.min(40, 18 * scale));
  // Centred on the two lines of the score, which run from arcade y 3 to 19.
  const top = (view ? safe.top : canvas.offsetTop) + Math.max(4, 11 * scale - bh / 2);
  place(buttons, Math.min(from, right - 6 - width), top, width, bh);
}

if (coarse) {
  stick.classList.remove('hidden');
  buttons.classList.remove('hidden');
  document.body.classList.add('touch-mode');
  // No fire button, so the ship fires for itself the whole time.
  game.setTouch('autoFire', true);
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 200));
window.visualViewport?.addEventListener('resize', layout);
// iOS resizes the fixed stage as its toolbars come and go, without always
// saying so through the window.
if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);

// --- Input ------------------------------------------------------------------

const HANDLED = new Set([
  'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space', 'Enter', 'KeyP', 'KeyM',
  'KeyV',
]);

window.addEventListener('keydown', (e) => {
  if (!HANDLED.has(e.code)) return;
  e.preventDefault();
  if (e.repeat) return;
  // The view swap is the renderer's business, not the game's, so it never
  // reaches game.js — which is what keeps the simulation ignorant of how it is
  // being drawn. In ?flat there is no 3D view and the key does nothing.
  if (e.code === 'KeyV') {
    toggleView();
    return;
  }
  game.onKeyDown(e.code);
});

window.addEventListener('keyup', (e) => {
  if (!HANDLED.has(e.code)) return;
  e.preventDefault();
  game.onKeyUp(e.code);
});

function toggleView() {
  if (!view) return;
  view.toggleView();
  syncButtons();
  layout(); // the stick ring moves out from under the ship
}

document.getElementById('t-pause').addEventListener('click', () => {
  game.togglePause();
  syncButtons();
});
document.getElementById('t-mute').addEventListener('click', () => {
  game.toggleMute();
  syncButtons();
});
// Hidden outright without a 3D view: a button that cannot do anything is worse
// than no button, and on ?flat there is nothing to swap between.
const viewBtn = document.getElementById('t-view');
if (view) viewBtn.addEventListener('click', toggleView);
else viewBtn.classList.add('hidden');

function syncButtons() {
  document.getElementById('t-pause').textContent = game.paused ? '▶' : '‖';
  document.getElementById('t-mute').textContent = game.muted ? '\u{1F507}' : '\u{1F509}';
  // The label is the view you would get by pressing it, not the one you are in.
  viewBtn.textContent = view && view.chase ? '\u{1F441}' : '\u{1F6F8}';
  viewBtn.setAttribute(
    'aria-label', view && view.chase ? 'Cockpit view' : 'Outside view');
}
syncButtons();
// After the buttons are settled: how many are showing decides how wide the
// row on the score line has to be.
layout();

// Tapping the screen starts a game (and unlocks audio), but never steers — a
// thumb out on the glass covers the dive you are trying to read.
canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  game.touchFire();
});

// --- Stick --------------------------------------------------------------------
// The touch control is the cockpit's own control column: a ring over it on the
// screen, and a thumb in the ring moves it. It is a rate control, like the real
// thing — how far you push is how fast you go, and letting go centres it and
// holds station. Wherever the thumb lands is centre, so landing a little off
// the stick never throws the ship sideways. Firing is automatic: with no fire
// button there is nothing to hold, and nothing to cover the screen with.

const DEAD = 0.08; // a resting thumb wobbles; this much of the throw is centre
let stickId = null;
let stickFrom = 0;

function steer(d) {
  if (d == null) {
    game.setSteer(0);
    view?.setStick(null);
    stick.setAttribute('aria-valuenow', '0');
    return;
  }
  const k = Math.max(-1, Math.min(1, d));
  // Past the dead zone, a curve: the first part of the throw is fine
  // adjustment rather than half speed.
  const m = Math.max(0, (Math.abs(k) - DEAD) / (1 - DEAD));
  game.setSteer(Math.sign(k) * m ** 1.5);
  view?.setStick(k);
  stick.setAttribute('aria-valuenow', String(Math.round(k * 100)));
}

stick.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  sfx.resume();
  // First touch of the run also drops the coin on the title screen.
  if (game.state === 'title' || game.state === 'gameover') game.touchFire();
  stickId = ev.pointerId;
  stickFrom = ev.clientX;
  stick.setPointerCapture?.(ev.pointerId);
  stick.classList.add('active');
  steer(0);
});

stick.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== stickId) return;
  ev.preventDefault();
  steer((ev.clientX - stickFrom) / stickReach);
});

function endStick(ev) {
  if (ev.pointerId !== stickId) return;
  stickId = null;
  stick.releasePointerCapture?.(ev.pointerId);
  stick.classList.remove('active');
  steer(null);
}

stick.addEventListener('pointerup', endStick);
stick.addEventListener('pointercancel', endStick);

// Losing the tab mid-push must not leave the ship flying on its own.
function releaseAll() {
  stickId = null;
  stick.classList.remove('active');
  steer(null);
  game.keys.clear();
  if (coarse) game.setTouch('autoFire', true);
}

window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  releaseAll();
  // Coming back to a tab should not mean coming back to a wreck: pause, and
  // let the player unpause when they are ready.
  if (!game.paused && (game.state === 'play' || game.state === 'stageIntro')) {
    game.togglePause();
    syncButtons();
  }
});

// --- Loop -------------------------------------------------------------------

const STEP = 1 / 60;
let acc = 0;
let last = performance.now();

function frame(now) {
  // Clamp so a backgrounded tab doesn't fast-forward the whole stage.
  const elapsed = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += elapsed;
  while (acc >= STEP) {
    game.update(STEP);
    acc -= STEP;
  }
  if (view) {
    view.draw(game, elapsed);
    game.drawOverlay();
  } else {
    game.draw();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

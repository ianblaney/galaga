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

// --- Presentation: scale the 224x288 canvas up to fit the viewport ----------

const coarse = window.matchMedia('(pointer: coarse)').matches;

const cabinet = document.getElementById('cabinet');

function visible(el) {
  return el && el.offsetParent !== null;
}

function resize() {
  const touch = document.getElementById('touch');
  // In landscape the controls sit beside the playfield, so they cost width
  // rather than height. Ask the layout which way it went.
  const sideways = getComputedStyle(cabinet).flexDirection === 'row';
  const chrome = [document.getElementById('legend')]
    .filter(visible)
    .reduce((h, el) => h + el.offsetHeight, 0);

  const panel = visible(touch) ? (sideways ? touch.offsetWidth : touch.offsetHeight) : 0;
  const chromeH = chrome + (sideways ? 0 : panel) + 40;
  const chromeW = 16 + (sideways ? panel + 14 : 0);

  // visualViewport tracks the space actually left over by mobile browser chrome.
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const availW = vw - chromeW;
  const availH = vh - chromeH;

  const fit = Math.min(availW / W, availH / H);
  let scale;
  if (fit < 1) {
    // Less room than the native 224x288. Shrink, or the playfield overflows
    // and the score row gets clipped off the top of a landscape phone.
    scale = Math.max(fit, 0.4);
  } else {
    // Whole-pixel scaling keeps the art crisp, but on a phone it can throw away
    // a third of the screen. Take the fractional fit when rounding is costly.
    const whole = Math.floor(fit);
    scale = coarse && whole / fit < 0.85 ? fit : whole;
  }

  const cssW = Math.round(W * scale);
  const cssH = Math.round(H * scale);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  // The 3D canvas is stretched over the same frame by CSS; it still needs its
  // drawing buffer and projection told about the new size.
  view?.setSize(cssW, cssH);
}

if (coarse) {
  document.getElementById('touch').classList.remove('hidden');
  document.body.classList.add('touch-mode');
  // No fire button any more, so the ship fires for itself the whole time.
  game.setTouch('autoFire', true);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
window.visualViewport?.addEventListener('resize', resize);
resize();

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

// Tapping the playfield starts a game (and unlocks audio), but never steers —
// a thumb on the canvas covers the dive you are trying to read.
canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  game.touchFire();
});

// --- Slide strip ------------------------------------------------------------
// The touch control: a full-width strip below the playfield. Where you put your
// thumb along it is where the ship goes, so the whole run of the strip maps to
// the whole run of the playfield. Firing is automatic — with no fire button
// there is nothing to hold, and nothing to cover the screen with.

const pad = document.getElementById('pad');
const knob = document.getElementById('pad-knob');
let padId = null;

// The knob has width, so the usable travel is inset by half of it at each end.
// Aim and knob must share this geometry or the knob clips at the ends.
function padGeometry() {
  const r = pad.getBoundingClientRect();
  const inset = Math.min(knob.offsetWidth / 2 || 28, r.width / 6);
  return { r, inset, travel: Math.max(1, r.width - inset * 2) };
}

function aimFromPad(ev) {
  const { r, inset, travel } = padGeometry();
  const t = (ev.clientX - r.left - inset) / travel;
  return Math.min(Math.max(t, 0), 1);
}

function applyAim(t) {
  const { inset, travel } = padGeometry();
  game.setAim(t * W);
  knob.style.left = `${inset + t * travel}px`;
  pad.setAttribute('aria-valuenow', String(Math.round(t * 100)));
}

pad.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  sfx.resume();
  // First touch of the run also drops the coin on the title screen.
  if (game.state === 'title' || game.state === 'gameover') game.touchFire();
  padId = ev.pointerId;
  pad.setPointerCapture?.(ev.pointerId);
  pad.classList.add('active');
  applyAim(aimFromPad(ev));
});

pad.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== padId) return;
  ev.preventDefault();
  applyAim(aimFromPad(ev));
});

function endPad(ev) {
  if (ev.pointerId !== padId) return;
  padId = null;
  pad.releasePointerCapture?.(ev.pointerId);
  pad.classList.remove('active');
  // Lift your thumb and the ship holds station rather than snapping anywhere.
  game.setAim(null);
}

pad.addEventListener('pointerup', endPad);
pad.addEventListener('pointercancel', endPad);

// Losing the tab mid-slide must not leave the ship flying on its own.
function releaseAll() {
  padId = null;
  game.setAim(null);
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

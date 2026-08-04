import { Game } from './game.js';
import { W, H } from './sprites.js';
import { sfx } from './audio.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

// Exposed for headless playtesting in tools/playtest.mjs.
window.game = game;

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
  const chrome = [document.getElementById('legend'), document.getElementById('touch-hint')]
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
  // Whole-pixel scaling keeps the art crisp, but on a phone it can throw away
  // a third of the screen. Take the fractional fit when the rounding is costly.
  const whole = Math.max(1, Math.floor(fit));
  const scale = coarse && whole / fit < 0.85 ? fit : whole;

  canvas.style.width = `${Math.round(W * scale)}px`;
  canvas.style.height = `${Math.round(H * scale)}px`;
}

if (coarse) {
  document.getElementById('touch').classList.remove('hidden');
  document.body.classList.add('touch-mode');
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
window.visualViewport?.addEventListener('resize', resize);
resize();

// --- Input ------------------------------------------------------------------

const HANDLED = new Set([
  'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space', 'Enter', 'KeyP', 'KeyM',
]);

window.addEventListener('keydown', (e) => {
  if (!HANDLED.has(e.code)) return;
  e.preventDefault();
  if (e.repeat) return;
  game.onKeyDown(e.code);
});

window.addEventListener('keyup', (e) => {
  if (!HANDLED.has(e.code)) return;
  e.preventDefault();
  game.onKeyUp(e.code);
});

function bindHold(id, key) {
  const el = document.getElementById(id);
  const down = (ev) => {
    ev.preventDefault();
    sfx.resume();
    // Capture so sliding a thumb off the button doesn't strand the input.
    el.setPointerCapture?.(ev.pointerId);
    game.setTouch(key, true);
  };
  const up = (ev) => {
    ev.preventDefault();
    el.releasePointerCapture?.(ev.pointerId);
    game.setTouch(key, false);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

bindHold('t-left', 'touchLeft');
bindHold('t-right', 'touchRight');
bindHold('t-fire', 'touchFire');
document.getElementById('t-fire').addEventListener('pointerdown', () => game.touchFire());

document.getElementById('t-pause').addEventListener('click', () => {
  game.togglePause();
  syncButtons();
});
document.getElementById('t-mute').addEventListener('click', () => {
  game.toggleMute();
  syncButtons();
});

function syncButtons() {
  document.getElementById('t-pause').textContent = game.paused ? '▶' : '‖';
  document.getElementById('t-mute').textContent = game.muted ? '\u{1F507}' : '\u{1F509}';
}
syncButtons();

// --- Drag to steer ----------------------------------------------------------
// The primary touch control: put a finger anywhere on the playfield and the
// ship tracks it, auto-firing while held. The finger sits below the ship so it
// never covers what you are aiming at.

let dragId = null;

function aimFromEvent(ev) {
  const r = canvas.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * W;
  return Math.min(Math.max(x, 0), W);
}

// A mouse on a desktop keeps the keyboard behaviour it always had; only a
// finger or stylus takes over steering.
const steers = (ev) => ev.pointerType !== 'mouse';

canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  sfx.resume();
  // A tap on the title/game-over screen starts a game; it also begins a drag.
  game.touchFire();
  if (!steers(ev)) return;
  dragId = ev.pointerId;
  canvas.setPointerCapture?.(ev.pointerId);
  game.setAim(aimFromEvent(ev));
  game.setTouch('autoFire', true);
});

canvas.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== dragId) return;
  ev.preventDefault();
  game.setAim(aimFromEvent(ev));
});

function endDrag(ev) {
  if (ev.pointerId !== dragId) return;
  dragId = null;
  canvas.releasePointerCapture?.(ev.pointerId);
  game.setAim(null);
  game.setTouch('autoFire', false);
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Losing the tab mid-drag must not leave the ship flying and firing.
window.addEventListener('blur', () => {
  dragId = null;
  game.setAim(null);
  game.keys.clear();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    dragId = null;
    game.setAim(null);
    game.keys.clear();
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
  game.draw();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

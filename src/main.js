import { Game } from './game.js';
import { W, H } from './sprites.js';
import { sfx } from './audio.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

// Exposed for headless playtesting in tools/playtest.mjs.
window.game = game;

// --- Presentation: scale the 224x288 canvas up by whole pixels only ---------

function resize() {
  const legend = document.getElementById('legend');
  const touch = document.getElementById('touch');
  const chromeH =
    (legend && !legend.offsetParent ? 0 : legend?.offsetHeight ?? 0) +
    (touch.classList.contains('hidden') ? 0 : touch.offsetHeight) +
    40;
  const scale = Math.max(
    1,
    Math.min(
      Math.floor((window.innerWidth - 24) / W),
      Math.floor((window.innerHeight - chromeH) / H),
    ),
  );
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
}

if (window.matchMedia('(pointer: coarse)').matches) {
  document.getElementById('touch').classList.remove('hidden');
}
window.addEventListener('resize', resize);
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

window.addEventListener('blur', () => game.keys.clear());

function bindHold(id, key) {
  const el = document.getElementById(id);
  const down = (ev) => {
    ev.preventDefault();
    sfx.resume();
    game.setTouch(key, true);
  };
  const up = (ev) => {
    ev.preventDefault();
    game.setTouch(key, false);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}

bindHold('t-left', 'touchLeft');
bindHold('t-right', 'touchRight');
bindHold('t-fire', 'touchFire');
document.getElementById('t-fire').addEventListener('pointerdown', () => game.touchFire());

// Tapping the canvas also starts a game (and unlocks audio).
canvas.addEventListener('pointerdown', () => game.touchFire());

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

// The Galaga starfield: layers scrolling at different speeds, each star
// blinking on and off on its own cycle.

import { W, H } from './sprites.js';

const COLOURS = ['#ffffff', '#8fd0ff', '#ff9a9a', '#fff2a0', '#a8ffb0'];
const LAYERS = [
  { count: 34, speed: 14, size: 1 },
  { count: 26, speed: 30, size: 1 },
  { count: 16, speed: 52, size: 1 },
];

export class Stars {
  constructor() {
    this.stars = [];
    for (const layer of LAYERS) {
      for (let i = 0; i < layer.count; i++) {
        this.stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          speed: layer.speed,
          size: layer.size,
          colour: COLOURS[(Math.random() * COLOURS.length) | 0],
          phase: Math.random() * 2,
          rate: 0.5 + Math.random() * 1.6,
        });
      }
    }
    this.t = 0;
    this.scroll = true;
  }

  update(dt) {
    this.t += dt;
    if (!this.scroll) return;
    for (const s of this.stars) {
      s.y += s.speed * dt;
      if (s.y > H) {
        s.y -= H;
        s.x = Math.random() * W;
      }
    }
  }

  draw(ctx) {
    for (const s of this.stars) {
      // Blink: visible for roughly two thirds of each cycle.
      if ((this.t * s.rate + s.phase) % 2 > 1.35) continue;
      ctx.fillStyle = s.colour;
      ctx.fillRect(s.x | 0, s.y | 0, s.size, s.size);
    }
  }
}

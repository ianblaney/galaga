// Flight paths are built by "driving" a pen: go straight, turn through an arc.
// The pen samples a point every STEP pixels, so followers can advance along a
// path at a constant speed and read their heading from consecutive samples.
//
// Headings are in degrees with screen coordinates (y grows downward):
//   0 = right, 90 = down, 180 = left, 270 = up.
// A positive turn is clockwise on screen.

import { W } from './sprites.js';

const STEP = 2;
const DEG = Math.PI / 180;

export class Path {
  constructor(x, y, headingDeg) {
    this.x = x;
    this.y = y;
    this.a = headingDeg * DEG;
    this.pts = [{ x, y }];
  }

  line(dist) {
    const n = Math.max(1, Math.round(dist / STEP));
    const dx = Math.cos(this.a) * STEP;
    const dy = Math.sin(this.a) * STEP;
    for (let i = 0; i < n; i++) {
      this.x += dx;
      this.y += dy;
      this.pts.push({ x: this.x, y: this.y });
    }
    return this;
  }

  turn(radius, deltaDeg) {
    const delta = deltaDeg * DEG;
    const sign = delta >= 0 ? 1 : -1;
    const cx = this.x + Math.cos(this.a + (sign * Math.PI) / 2) * radius;
    const cy = this.y + Math.sin(this.a + (sign * Math.PI) / 2) * radius;
    const start = Math.atan2(this.y - cy, this.x - cx);
    const n = Math.max(1, Math.round((Math.abs(delta) * radius) / STEP));
    for (let i = 1; i <= n; i++) {
      const a = start + delta * (i / n);
      this.x = cx + Math.cos(a) * radius;
      this.y = cy + Math.sin(a) * radius;
      this.pts.push({ x: this.x, y: this.y });
    }
    this.a += delta;
    return this;
  }

  /**
   * Steer at (tx, ty), turning no tighter than `radius`, until the pen has
   * dropped to ty. This is what makes an attack an attack: the path is bent
   * toward wherever the player was when it launched, rather than being a fixed
   * shape you can learn to stand beside.
   *
   * `wobble` (degrees) sways the aim either side of the target on a `wave`-px
   * cycle, for a weaving run.
   */
  seek(tx, ty, radius, { wobble = 0, wave = 80, limit = 700 } = {}) {
    const maxTurn = STEP / radius;
    for (let d = 0; d < limit && this.y < ty; d += STEP) {
      const sway = wobble * DEG * Math.sin((d / wave) * Math.PI * 2);
      const want = Math.atan2(ty - this.y, tx - this.x) + sway;
      const off = Math.atan2(Math.sin(want - this.a), Math.cos(want - this.a));
      this.a += Math.max(-maxTurn, Math.min(maxTurn, off));
      this.x += Math.cos(this.a) * STEP;
      this.y += Math.sin(this.a) * STEP;
      this.pts.push({ x: this.x, y: this.y });
    }
    return this;
  }

  get points() {
    return this.pts;
  }
}

/** Mirror a point list about the vertical centre line. */
export function mirror(pts) {
  return pts.map((p) => ({ x: W - p.x, y: p.y }));
}

// --- Stage entry paths -----------------------------------------------------
// Each returns a fresh point list. Enemies follow one of these on the way in,
// then peel off to their formation slot.

function entryTopLeft() {
  return new Path(80, -16, 90).line(96).turn(26, -320).line(30).points;
}

function entryBottomLeft() {
  return new Path(-16, 236, -60).line(120).turn(30, 120).line(30).turn(34, -250).line(24).points;
}

const ENTRIES = [
  entryTopLeft,
  () => mirror(entryTopLeft()),
  entryBottomLeft,
  () => mirror(entryBottomLeft()),
];

export function entryPath(index) {
  return ENTRIES[index % ENTRIES.length]();
}

// --- Attack paths ----------------------------------------------------------

/**
 * A dive that peels out of formation, loops, then sweeps down past the player.
 * `dir` is -1 to break left, 1 to break right.
 */
export function divePath(x, y, dir) {
  return new Path(x, y, 90)
    .turn(16, dir * 210)
    .line(36)
    .turn(52, -dir * 160)
    .line(420).points; // long enough to always clear the bottom of the screen
}

/**
 * A dive aimed at the player, shaped by who is flying it. Every type lifts out
 * of its rank and rolls outward through a half loop, then:
 *
 *   bee        a tight, direct run at you — and sometimes a loop right in
 *              front of the ship before it leaves, as the arcade bees do
 *   butterfly  a weaving run that is harder to lead with a shot
 *   boss       a wide, heavy sweep
 *
 * `dir` is the side to break toward (-1 left, 1 right); (tx, ty) is where the
 * player was at launch.
 */
export function attackPath(type, x, y, dir, tx, ty, { loop = false } = {}) {
  // Lift out of the rank and roll outward through a half loop, so the run
  // starts on the outer side already heading down.
  const p = new Path(x, y, 270).line(4).turn(13, dir * 180);
  if (type === 'bee') {
    p.seek(tx, ty - 34, 40);
    if (loop) p.turn(24, dir * 320);
    p.line(360);
  } else if (type === 'butterfly') {
    p.seek(tx, ty - 8, 46, { wobble: 42, wave: 96 }).line(360);
  } else {
    p.seek(tx, ty - 14, 64).line(360);
  }
  return p.points;
}

/**
 * The same path, picked up and moved so it starts at (x, y). Escorts and
 * wingmates fly their leader's line from their own slot, which is what keeps
 * a boss and its escorts in formation all the way down.
 */
export function offsetPath(pts, x, y) {
  const dx = x - pts[0].x;
  const dy = y - pts[0].y;
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** A boss run that stops mid-screen above `targetX` to open its tractor beam. */
export function beamApproachPath(x, y, targetX) {
  const dir = targetX < x ? -1 : 1;
  const p = new Path(x, y, 90).turn(18, dir * 180).line(24).turn(24, -dir * 180);
  // Close the remaining gap with a gentle straight run to the hover point.
  const hoverY = 132;
  const last = p.points[p.points.length - 1];
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    p.points.push({
      x: last.x + (targetX - last.x) * t,
      y: last.y + (hoverY - last.y) * t,
    });
  }
  return p.points;
}

// --- Challenging-stage paths ----------------------------------------------
// Bonus-round enemies never join a formation: they trace a shape and leave.

function challengeA() {
  return new Path(48, -16, 90).line(70).turn(28, -360).line(50).turn(46, 130).line(320).points;
}

function challengeB() {
  return new Path(-16, 70, 20).line(100).turn(36, 300).line(40).turn(30, -140).line(320).points;
}

// In from high on the side, a wide S across the middle of the screen, out.
function challengeC() {
  return new Path(-16, 40, 25).line(60).turn(40, 110).turn(36, -200).line(30).turn(44, 150).line(320).points;
}

// Straight down the middle, a tight loop above the player, out the side.
function challengeD() {
  return new Path(96, -16, 90).line(110).turn(22, -380).line(20).turn(30, 110).line(320).points;
}

const CHALLENGES = [
  challengeA,
  () => mirror(challengeA()),
  challengeB,
  () => mirror(challengeB()),
  challengeC,
  () => mirror(challengeC()),
  challengeD,
  () => mirror(challengeD()),
];

/**
 * Path for a challenging-stage group. `round` is which challenging stage this
 * is (0 for the first), and rotates the set so each round opens differently.
 */
export function challengePath(index, round = 0) {
  return CHALLENGES[(index + round * 2) % CHALLENGES.length]();
}

/** After a dive, enemies re-enter from the top and curve back toward formation. */
export function reentryPath(x) {
  const side = x < W / 2 ? 1 : -1;
  return new Path(x, -14, 90).line(40).turn(40, side * 60).line(30).points;
}

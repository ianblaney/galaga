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

const CHALLENGES = [
  challengeA,
  () => mirror(challengeA()),
  challengeB,
  () => mirror(challengeB()),
];

export function challengePath(index) {
  return CHALLENGES[index % CHALLENGES.length]();
}

/** After a dive, enemies re-enter from the top and curve back toward formation. */
export function reentryPath(x) {
  const side = x < W / 2 ? 1 : -1;
  return new Path(x, -14, 90).line(40).turn(40, side * 60).line(30).points;
}

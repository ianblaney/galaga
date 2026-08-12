// The fighter's cockpit: canopy frame, instrument panel, two live displays and
// a control column that moves with your thumb.
//
// Built in the camera's own frame — eye at the origin, nose down -Z, +X to the
// pilot's right — so it can be parented straight to the rig and never needs to
// know where the ship is.
//
// The tactical scope is not decoration. A cockpit view throws away the one
// thing the arcade cabinet gave you for free: sight of the whole playfield at
// once. The scope hands that back, which is the difference between a dive you
// can read and one that arrives out of nowhere.
import * as THREE from 'three';
import { W, H } from '../sprites.js';

const GREEN = '#5dffb0';
const GREEN_DIM = 'rgba(93,255,176,0.35)';
const AMBER = '#ffb347';
const RED = '#ff5a3c';

function makeScreen(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

function label(ctx, text, x, y, size, color, align = 'left') {
  ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export function buildCockpit() {
  const group = new THREE.Group();

  const panel = new THREE.MeshStandardMaterial({
    color: 0x14181d, roughness: 0.85, metalness: 0.2,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x2e343d, roughness: 0.5, metalness: 0.8,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x171b21, roughness: 0.95, metalness: 0.05,
  });
  // Deliberately the brightest thing in the cockpit. The stick is the one part
  // the player is meant to watch, and against a dark panel a dark column just
  // disappears.
  const bright = new THREE.MeshStandardMaterial({
    color: 0x7e8ba3, roughness: 0.3, metalness: 0.75,
  });

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const put = (g, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  // ---- Structure ------------------------------------------------------------
  // Everything here is placed by the angle it subtends from the eye, not by
  // where it would sit in a real airframe. The view has no head movement, so
  // the visible cone is fixed: roughly 39 degrees either side of the boresight
  // vertically. A panel put where a real one goes is simply not in it.
  //
  // Working numbers at one unit ahead: -39deg is y = -0.81, -14deg is y = -0.25,
  // +34deg is y = +0.67. The panel therefore lives between -0.81 and -0.25, and
  // the arch sits at +0.67.
  const RAKE = -0.40; // panel rake, so the face turns toward the pilot

  put(box(1.34, 0.62, 0.30), panel, 0, -0.62, -1.12, RAKE); // main panel body
  put(box(1.40, 0.05, 0.13), trim, 0, -0.29, -1.00, RAKE); // coaming lip

  // Side consoles, running back past the pilot's hips.
  for (const sx of [-1, 1]) {
    put(box(0.22, 0.30, 1.20), panel, sx * 0.68, -0.62, -0.40);
    put(box(0.19, 0.03, 1.00), trim, sx * 0.68, -0.46, -0.40);
    // Breaker rows, purely so the consoles aren't bare slabs.
    for (let i = 0; i < 5; i++) {
      put(box(0.02, 0.035, 0.02), trim, sx * 0.68, -0.42, -0.80 + i * 0.20);
    }
  }

  // Canopy: an arch overhead and two A-pillars, both kept right out at the
  // edges of the frame so nothing you need to shoot can hide behind them.
  put(box(1.50, 0.08, 0.12), trim, 0, 0.70, -1.00);
  for (const sx of [-1, 1]) {
    const pillar = put(box(0.08, 1.00, 0.10), trim, sx * 0.72, 0.20, -1.00);
    pillar.rotation.z = sx * 0.10;
    const rail = put(box(0.10, 0.12, 1.4), trim, sx * 0.72, -0.36, -0.35);
    rail.rotation.z = sx * 0.05;
  }
  // Canopy glass: a faint tint so the frame reads as enclosing something.
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.44),
    new THREE.MeshBasicMaterial({
      color: 0x4a7dc0, transparent: true, opacity: 0.03,
      side: THREE.BackSide, depthWrite: false,
    }),
  );
  glass.rotation.x = -Math.PI / 2.4;
  group.add(glass);

  // ---- Displays -------------------------------------------------------------
  const scope = makeScreen(256, 320);
  const sys = makeScreen(256, 192);

  const mkScreen = (s, w, h, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: s.tex }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0); // square the screen up to the eye, raking it for free
    group.add(m);
    const bezel = new THREE.Mesh(box(w + 0.035, h + 0.035, 0.02), trim);
    bezel.position.copy(m.position);
    bezel.quaternion.copy(m.quaternion);
    bezel.translateZ(-0.014);
    group.add(bezel);
    return m;
  };

  // Left and right of centre, because the control column takes the middle.
  mkScreen(scope, 0.30, 0.36, -0.36, -0.48, -0.98);
  mkScreen(sys, 0.30, 0.22, 0.36, -0.50, -0.98);

  // Master-caution lamps under the coaming, on the centreline where they are
  // hard to miss but nowhere near anything you need to look through.
  const lamps = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120806, emissive: new THREE.Color(0xff4020), emissiveIntensity: 0,
    });
    lamps.push(mat);
    put(box(0.075, 0.03, 0.015), mat, -0.09 + i * 0.09, -0.33, -0.96, RAKE);
  }

  // ---- Windscreen HUD -------------------------------------------------------
  // Additive and depth-tested off, so it reads as projected light on the glass
  // rather than a decal painted over the ships.
  const hud = makeScreen(512, 512);
  const hudPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.30, 1.30),
    new THREE.MeshBasicMaterial({
      map: hud.tex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, opacity: 0.9, fog: false,
    }),
  );
  hudPlane.position.set(0, 0.02, -0.92);
  hudPlane.renderOrder = 20;
  group.add(hudPlane);

  // ---- The stick ------------------------------------------------------------
  // The whole point of the cockpit: slide your thumb and this moves with it.
  //
  // A real column sits between the pilot's knees, which from a fixed eye with
  // no head movement is a good 50 degrees below the boresight — off the bottom
  // of the frame entirely. So it is mounted on the front of the panel instead,
  // pedestal-style, where it is in shot and silhouetted against the console.
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, -0.62, -0.94);
  group.add(stickPivot);

  put(box(0.13, 0.05, 0.13), rubber, 0, -0.63, -0.94); // gimbal boot
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.034, 0.22, 8), bright);
  column.position.y = 0.11;
  stickPivot.add(column);
  const grip = new THREE.Mesh(box(0.07, 0.11, 0.085), rubber);
  grip.position.y = 0.25;
  grip.rotation.x = -0.18;
  stickPivot.add(grip);
  // Trigger head — it lights when the guns are firing, which is the only
  // feedback in the cockpit that says a shot left the ship.
  const triggerMat = new THREE.MeshStandardMaterial({
    color: 0x180a0a, emissive: new THREE.Color(0xff3820), emissiveIntensity: 0,
  });
  const trigger = new THREE.Mesh(box(0.04, 0.032, 0.025), triggerMat);
  trigger.position.set(0, 0.26, 0.055);
  stickPivot.add(trigger);

  // Throttle on the left console, parked forward. It creeps with the stage.
  const throttle = new THREE.Group();
  throttle.position.set(-0.66, -0.42, -0.40);
  group.add(throttle);
  const lever = new THREE.Mesh(box(0.05, 0.05, 0.24), trim);
  lever.position.z = -0.12;
  throttle.add(lever);
  const knob = new THREE.Mesh(box(0.075, 0.075, 0.075), rubber);
  knob.position.z = -0.24;
  throttle.add(knob);

  // ---- Painting -------------------------------------------------------------

  /**
   * Top-down scope of the whole arcade playfield: exactly the view the cabinet
   * used to give you, shrunk onto an instrument.
   */
  function paintScope(ctx, s) {
    const CW = 256;
    const CH = 320;
    ctx.fillStyle = '#04120c';
    ctx.fillRect(0, 0, CW, CH);

    const pad = 14;
    const sx = (CW - pad * 2) / W;
    const sy = (CH - pad * 2 - 22) / H;
    const px = (x) => pad + x * sx;
    const py = (y) => pad + 22 + y * sy;

    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(px(0), py(0), W * sx, H * sy);
    // Range rings, drawn as lines because the scope is a rectangle.
    for (const f of [0.33, 0.66]) {
      const y = py(H * f);
      ctx.beginPath();
      ctx.moveTo(px(0), y);
      ctx.lineTo(px(W), y);
      ctx.stroke();
    }

    for (const c of s.contacts) {
      const diving = c.state !== 'form' && c.state !== 'idle';
      ctx.fillStyle = diving ? RED : c.type === 'boss' ? AMBER : GREEN;
      const r = c.type === 'boss' ? 3.6 : 2.6;
      ctx.beginPath();
      ctx.arc(px(c.x), py(c.y), diving ? r + 1 : r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (s.playerAlive) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      const x = px(s.playerX);
      const y = py(s.playerY);
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x - 5, y + 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.closePath();
      ctx.fill();
    }

    label(ctx, 'TAC', 10, 13, 16, GREEN);
    label(ctx, `${s.contacts.length}`, CW - 10, 13, 16, GREEN, 'right');
  }

  function paintSystems(ctx, s) {
    const CW = 256;
    const CH = 192;
    ctx.fillStyle = '#04120c';
    ctx.fillRect(0, 0, CW, CH);
    label(ctx, 'SYS', 10, 14, 16, GREEN);

    label(ctx, String(s.score).padStart(6, '0'), CW - 10, 16, 26, GREEN, 'right');
    label(ctx, `STAGE ${s.stage}`, 10, 52, 18, GREEN);

    // Lives as pips rather than a number: readable in peripheral vision.
    label(ctx, 'SHIPS', 10, 82, 15, GREEN_DIM);
    for (let i = 0; i < Math.min(s.lives, 6); i++) {
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      const x = 82 + i * 20;
      ctx.moveTo(x, 74);
      ctx.lineTo(x - 6, 90);
      ctx.lineTo(x + 6, 90);
      ctx.closePath();
      ctx.fill();
    }

    const bar = (y, name, frac, color) => {
      label(ctx, name, 10, y, 15, GREEN);
      ctx.strokeStyle = GREEN_DIM;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(72, y - 9, 172, 18);
      ctx.fillStyle = color;
      ctx.fillRect(74, y - 7, 168 * Math.max(0, Math.min(1, frac)), 14);
    };
    bar(118, 'FORM', s.formation, GREEN);
    bar(152, 'GUNS', s.guns, s.dual ? AMBER : GREEN);
    if (s.dual) label(ctx, 'DUAL', CW - 10, 52, 18, AMBER, 'right');
  }

  function paintHud(ctx, s) {
    const S = 512;
    ctx.clearRect(0, 0, S, S);
    // Nothing is projected on the glass on the attract screen — the title art
    // is drawn on the same rectangle, and a reticle through the middle of it
    // just reads as clutter.
    if (!s.flying) return;
    const cx = S / 2;
    const cy = S / 2;

    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 2;

    // Boresight: gun cross, with the gap left open so a target sits in it.
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy); ctx.lineTo(cx - 12, cy);
    ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 34, cy);
    ctx.moveTo(cx, cy - 34); ctx.lineTo(cx, cy - 12);
    ctx.moveTo(cx, cy + 12); ctx.lineTo(cx, cy + 34);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();

    // Drift ladder: where the ship is along the playfield, which the cockpit
    // view otherwise hides completely.
    const t = s.playerX / W;
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 1.5;
    // Sits just above the coaming: any lower and it is projected onto the
    // panel, where it reads as a green line lying across the instruments.
    const LADDER = 342;
    ctx.beginPath();
    ctx.moveTo(cx - 150, LADDER); ctx.lineTo(cx + 150, LADDER); ctx.stroke();
    for (let i = 0; i <= 8; i++) {
      const x = cx - 150 + (300 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x, LADDER); ctx.lineTo(x, LADDER + (i % 4 === 0 ? 10 : 5));
      ctx.stroke();
    }
    ctx.fillStyle = GREEN;
    const mx = cx - 150 + 300 * t;
    ctx.beginPath();
    ctx.moveTo(mx, LADDER - 8); ctx.lineTo(mx - 7, LADDER - 20); ctx.lineTo(mx + 7, LADDER - 20);
    ctx.closePath();
    ctx.fill();

    // Lock box on the nearest thing actually coming at you.
    if (s.threat) {
      const th = s.threat;
      const sz = Math.max(26, 180 / Math.max(0.6, th.dist));
      ctx.strokeStyle = RED;
      ctx.lineWidth = 2.5;
      // Corners only — a full box hides the ship you're trying to shoot.
      const x0 = cx + th.sx - sz / 2;
      const y0 = cy + th.sy - sz / 2;
      const c = sz * 0.3;
      ctx.beginPath();
      for (const [ox, oy, dx, dy] of [
        [x0, y0, 1, 1], [x0 + sz, y0, -1, 1],
        [x0, y0 + sz, 1, -1], [x0 + sz, y0 + sz, -1, -1],
      ]) {
        ctx.moveTo(ox + dx * c, oy); ctx.lineTo(ox, oy); ctx.lineTo(ox, oy + dy * c);
      }
      ctx.stroke();
    }

    if (s.captured) {
      label(ctx, 'TRACTOR LOCK', cx, 92, 26, RED, 'center');
    } else if (s.beaming) {
      label(ctx, 'BEAM WARNING', cx, 92, 24, AMBER, 'center');
    }
  }

  // Displays repaint on a timer, not every frame: a 512x512 canvas upload at
  // 60Hz is a lot of bandwidth for line art that reads identically at 30.
  let hudAcc = 0;
  let mfdAcc = 0;
  let stickX = 0;
  let fireLamp = 0;

  return {
    group,

    /**
     * @param s  cockpit state assembled by view3d.js:
     *           lateral   -1..1 thumb/steer input, drives the stick
     *           firing    true on the frames a shot leaves the ship
     */
    update(dt, s) {
      // Ease toward the input so the column has some mass: a raw slide
      // teleports the stick and it reads as a jump cut.
      stickX += (s.lateral - stickX) * Math.min(1, dt * 12);
      stickPivot.rotation.z = -stickX * 0.42;
      stickPivot.rotation.x = -0.10 * Math.abs(stickX) - (s.firing ? 0.06 : 0);

      // Kept dim on purpose. On a phone the guns fire by themselves, so this
      // lamp is lit almost permanently — at any real brightness its bloom
      // floods the whole panel red and you cannot read the instruments.
      fireLamp = s.firing ? 1 : Math.max(0, fireLamp - dt * 7);
      triggerMat.emissiveIntensity = fireLamp * 0.9;

      throttle.position.z = -0.40 - Math.min(0.14, s.stage * 0.01);

      const warn = s.captured || s.beaming;
      const blink = warn ? (Math.sin(s.time * 9) > 0 ? 2.6 : 0) : 0;
      for (let i = 0; i < lamps.length; i++) {
        lamps[i].emissiveIntensity = i === 1 ? blink : blink * 0.35;
      }

      hudAcc += dt;
      if (hudAcc >= 1 / 30) {
        hudAcc = 0;
        paintHud(hud.ctx, s);
        hud.tex.needsUpdate = true;
      }
      mfdAcc += dt;
      if (mfdAcc >= 1 / 12) {
        mfdAcc = 0;
        paintScope(scope.ctx, s);
        paintSystems(sys.ctx, s);
        scope.tex.needsUpdate = true;
        sys.tex.needsUpdate = true;
      }
    },
  };
}

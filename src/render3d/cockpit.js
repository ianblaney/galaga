// The fighter's cockpit: canopy frame, instrument panel, two live displays and
// a control column that moves with your thumb.
//
// Built in the camera's own frame — eye at the origin, nose down -Z, +X to the
// pilot's right — so it can be parented straight to the rig and never needs to
// know where the ship is.
//
// Everything structural is placed by the *angle it subtends from the eye*, not
// by where it would sit in a real airframe. The view has no head movement, so
// the visible cone is the whole world: a panel put where a real one goes is
// simply not in it. Every slab below is therefore given an angular window and
// a distance, and the geometry is a unit cube — which means the whole cockpit
// can be re-laid-out for a different frame by re-running the layout pass.
//
// The frame is wide on purpose. A canopy that only shows the boresight makes
// the one question the player is actually asking — are my wings clear? —
// unanswerable, because anything abeam of the ship is off the glass entirely.
// So the surround is as little of the picture as it can be and still read as a
// cockpit: one slim arch, its legs standing almost on the edges of the view,
// and a coaming dropped well below the ship's own row and dropped further
// still out on the beam. Nothing closes off the corners — the starfield runs
// out to all four of them — because everything a surround covers is a threat
// the player cannot see coming.
//
// The tactical scope is not decoration either. A cockpit view throws away the
// one thing the arcade cabinet gave you for free: sight of the whole playfield
// at once. The scope hands that back for the far end of the tunnel, which is
// the difference between a dive you can read and one that arrives out of
// nowhere.
import * as THREE from 'three';
import { W, H } from '../sprites.js';
import { buildPanelDetail } from './panelDetail.js';

const GREEN = '#5dffb0';
const GREEN_DIM = 'rgba(93,255,176,0.35)';
const AMBER = '#ffb347';
const RED = '#ff5a3c';

const DEG = Math.PI / 180;
const T = (deg) => Math.tan(deg * DEG);

// The HUD canvas is the arcade screen at 2x, and it is stretched over the whole
// visible frame — so a HUD pixel is a fixed fraction of the view however wide
// the view gets, and anything the renderer projects onto it lands in the right
// place right out to the corners.
const HUD_W = W * 2;
const HUD_H = H * 2;

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

/**
 * @param frame  half-angles of the visible cone, in radians: { hHalf, vHalf }.
 *               The canopy is laid out against these, so widening the camera
 *               widens the window rather than leaving the old one adrift in
 *               the middle of a bigger frame.
 */
export function buildCockpit(frame) {
  const group = new THREE.Group();

  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x1b2028, roughness: 0.8, metalness: 0.25,
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
  // The canopy rail. Light, unlike everything else in here: against a black sky
  // a dark frame is not a frame, it is an absence, and the arch is the one line
  // that has to read instantly as structure rather than as missing starfield.
  const canopy = new THREE.MeshStandardMaterial({
    color: 0x646b78, roughness: 0.52, metalness: 0.32,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xa9b2bf, roughness: 0.3, metalness: 0.45,
  });

  const UNIT = new THREE.BoxGeometry(1, 1, 1);

  // ---- Angular layout -------------------------------------------------------
  // Slabs are declared once as a function of the frame and re-placed whenever
  // the frame changes. `a` is azimuth and `e` elevation, both in degrees off
  // the boresight; `d` is the distance the slab hangs at, which only sets how
  // big it has to be to fill its window.
  const slabs = [];

  const slab = (mat, place) => {
    const m = new THREE.Mesh(UNIT, mat);
    group.add(m);
    slabs.push({ m, place });
    return m;
  };

  /** Fill the angular window [a0,a1] x [e0,e1] at distance d, `depth` deep. */
  const fill = (m, d, a0, a1, e0, e1, depth, rake = 0) => {
    const x0 = d * T(a0);
    const x1 = d * T(a1);
    const y0 = d * T(e0);
    const y1 = d * T(e1);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, -d);
    m.scale.set(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), depth);
    m.rotation.set(rake, 0, 0);
  };

  // ---- Canopy landmarks -----------------------------------------------------
  // The canopy is one continuous member: a bow over the top that sweeps down
  // either side and dies into the panel, the way a blown canopy is actually
  // framed. It is a rounded, tapered rail rather than a stack of slabs, and
  // there is nothing solid outboard of it — the starfield runs right out to
  // the corners of the frame. A surround only has to say "you are inside
  // something"; the moment it starts being most of the picture it has stopped
  // earning its place, because everything it covers is a threat you cannot see.
  //
  // The coaming is the horizon of the cockpit: panel below it, glass above. It
  // sits a long way under the boresight — the ship's own row is only about nine
  // degrees down — and it is *dropped further still* out on the beam, because
  // that corner of the glass is exactly where a shot coming down your flank
  // shows up, and a coaming carried flat across the frame at the height the
  // centreline needs would bury it.
  const COAMING = -25; // elevation of the coaming, on the centreline
  const COAM_DROP = 17; // how far it has fallen away by the time it is abeam
  const PILLAR = 53; // azimuth the canopy rail reaches at its widest
  const BOW = 50; // elevation of the top of the bow
  const ARCH_SQ = 0.72; // 1 is a plain ellipse; lower squares the arch off
  const RAIL_FOOT = COAMING - COAM_DROP - 7; // where the rail dies into the panel

  const RAIL_D = 0.98; // radius of the dome the rail is bent around
  const COAM_D = 0.93;
  const RAIL_R = 0.023;

  const at = slab;

  /** The coaming line, in degrees of elevation, at an azimuth. */
  const coamAt = (a) => COAMING - COAM_DROP * Math.min(1.5, Math.abs(a) / PILLAR) ** 2;

  /**
   * A point on the canopy dome, given the tangents of the angles it subtends —
   * the same angular discipline as fill(), but on a sphere rather than a plane,
   * so a rail keeps its thickness on screen all the way out to the corner
   * instead of fattening up where the projection stretches.
   */
  const dome = (d, x, y) => new THREE.Vector3(x, y, -1).normalize().multiplyScalar(d);

  /**
   * A tapered round rail through a run of dome points. three.js only extrudes a
   * constant radius, so the rings are pulled in toward the spine afterwards:
   * that is what makes the bow thin over the top and thicken into its feet,
   * which is most of what stops a frame member reading as a box.
   */
  const railGeo = (pts, radiusAt, radial = 10, flat = 0.5) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const segs = pts.length * 2;
    const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const pos = geo.attributes.position;
    const P = new THREE.Vector3();
    const N = new THREE.Vector3();
    const V = new THREE.Vector3();
    const D = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      curve.getPointAt(i / segs, P);
      N.copy(P).normalize(); // the dome's own normal: straight away from the eye
      const r = radiusAt(i / segs);
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        D.fromBufferAttribute(pos, k).sub(P);
        // Squash the section along the line of sight. A round pipe catches one
        // hot line down its spine; a blade lying on the glass turns its face to
        // the eye, which is what a canopy rail actually does.
        const depth = D.dot(N);
        D.addScaledVector(N, depth * (flat - 1)).multiplyScalar(r);
        V.copy(P).add(D);
        pos.setXYZ(k, V.x, V.y, V.z);
      }
    }
    geo.computeVertexNormals();
    return geo;
  };

  /** A part whose geometry is rebuilt for the frame rather than scaled to it. */
  const shaped = (mat, build) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    group.add(m);
    slabs.push({
      m,
      place: (h, v) => (mesh) => {
        mesh.geometry.dispose();
        mesh.geometry = build(h, v);
      },
    });
    return m;
  };

  // The arch itself. Straight up the sides, then a superellipse over the top:
  // a plain hoop leans inboard the whole way and takes the peripheral glass
  // exactly where a shot coming down your flank appears, and it reads as a
  // croquet hoop rather than a canopy. Squaring the corner off gives the
  // near-vertical side rails and the flat-crowned bow a blown canopy has.
  const SHOULDER = 8; // elevation the side rail starts to curve over at

  const archArc = (h, v, inset) => {
    const x1 = T(Math.min(PILLAR, h - 2.4) - inset);
    const y0 = T(SHOULDER - inset * 0.5);
    const y1 = T(Math.min(BOW, v - 5) - inset);
    return {
      x1,
      y0,
      /** @param phi -pi/2 at the left shoulder, 0 at the apex. */
      at: (phi) => [
        Math.sign(Math.sin(phi)) * Math.abs(Math.sin(phi)) ** ARCH_SQ * x1,
        y0 + Math.abs(Math.cos(phi)) ** ARCH_SQ * (y1 - y0),
      ],
    };
  };

  const archPts = (h, v, inset = 0) => {
    const { x1, y0, at } = archArc(h, v, inset);
    const yFoot = T(RAIL_FOOT);
    const pts = [];
    const LEG = 6;
    const N = 30;
    const leg = (sx, i) => dome(RAIL_D, sx * x1, yFoot + ((y0 - yFoot) * i) / LEG);
    for (let i = 0; i < LEG; i++) pts.push(leg(-1, i));
    for (let i = 0; i <= N; i++) {
      const [x, y] = at((-1 + (2 * i) / N) * (Math.PI / 2));
      pts.push(dome(RAIL_D, x, y));
    }
    for (let i = LEG - 1; i >= 0; i--) pts.push(leg(1, i));
    return pts;
  };

  // Thin over the crown, thicker into the feet, where a real one carries the
  // load into the sill.
  const railTaper = (t) => RAIL_R * (0.80 + 0.45 * Math.abs(2 * t - 1) ** 1.8);

  shaped(canopy, (h, v) => railGeo(archPts(h, v), railTaper, 14, 0.32));
  // A lit strip along the outboard edge. Against a black sky the one thing that
  // says "machined metal" rather than "moulding" is a highlight that runs the
  // length of the member and dies where it turns away from the light.
  shaped(crownMat, (h, v) => railGeo(
    archPts(h, v, -0.74).map((p) => p.multiplyScalar(0.978)),
    (t) => railTaper(t) * 0.30,
    6,
    0.9,
  ));
  // The seal: a dark line tucked just inboard, sitting a hair further out so it
  // only ever shows as an edge. Without it the rail is a clean grey noodle;
  // with it, it has an inside and an outside.
  shaped(rubber, (h, v) => railGeo(
    archPts(h, v, 1.5).map((p) => p.multiplyScalar(1.013)),
    (t) => railTaper(t) * 0.8,
    8,
    0.6,
  ));

  // Two straps across the bow, where the latches go. Small, symmetric and off
  // the boresight — the frame gets a scale reference and the centre of the
  // glass stays empty.
  for (const sx of [-1, 1]) {
    at(trim, (h, v) => (m) => {
      const [x, y] = archArc(h, v, 0).at(sx * 0.30);
      m.position.copy(dome(RAIL_D * 0.978, x, y));
      m.scale.set(0.019, 0.044, 0.010);
      m.lookAt(0, 0, 0);
    });
  }

  // A fairing where each rail dies into the sill. A member that simply stops
  // reads as a bar someone drew over the picture; one that lands on something
  // reads as structure.
  for (const sx of [-1, 1]) {
    at(trim, (h) => (m) => {
      const az = Math.min(PILLAR, h - 2.4);
      m.position.copy(dome(RAIL_D * 0.985, sx * T(az), T(coamAt(az) + 1.5)));
      m.scale.set(0.062, 0.075, 0.030);
      m.lookAt(0, 0, 0);
    });
  }

  // The coaming, rolled over rather than cut off square: a lit crown along the
  // top edge is what separates panel from glass at a glance.
  shaped(trim, (h) => railGeo(
    (() => {
      const pts = [];
      const N = 30;
      const amax = h + 10;
      for (let i = 0; i <= N; i++) {
        const a = -amax + (2 * amax * i) / N;
        pts.push(dome(COAM_D, T(a), T(coamAt(a))));
      }
      return pts;
    })(),
    () => 0.021,
    10,
    0.62,
  ));
  // A lit edge along the top of it. This is the line that says panel below,
  // glass above, and at a glance it is the only one the player needs.
  shaped(crownMat, (h) => railGeo(
    (() => {
      const pts = [];
      const N = 30;
      const amax = h + 10;
      for (let i = 0; i <= N; i++) {
        const a = -amax + (2 * amax * i) / N;
        pts.push(dome(COAM_D * 0.982, T(a), T(coamAt(a) + 0.55)));
      }
      return pts;
    })(),
    () => 0.0072,
    6,
    0.9,
  ));

  // The panel: a matte hood that follows the coaming down and a face that rakes
  // away under it. Built as a strip rather than a slab so the whole thing hangs
  // off the same curve the coaming does, and split in two so the anti-glare
  // hood is a darker, flatter surface than the face the instruments live on —
  // without that step the panel is one black sheet from the coaming to the
  // bottom of the frame, which is most of the lower third now the view is
  // this wide.
  const panelStrip = (rows) => (h, v) => {
    const N = 44;
    const amax = h + 14;
    const pos = [];
    const idx = [];
    for (const row of rows) {
      for (let i = 0; i <= N; i++) {
        const a = -amax + (2 * amax * i) / N;
        const e = row.de === null ? -(v + 8) : coamAt(a) + row.de;
        pos.push(row.d * T(a), row.d * T(e), -row.d);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      for (let i = 0; i < N; i++) {
        const a0 = r * (N + 1) + i;
        const a1 = a0 + N + 1;
        idx.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const HOOD = { d: 1.035, de: -5.5 };
  shaped(rubber, panelStrip([{ d: 1.0, de: 0 }, HOOD]));
  shaped(panelMat, panelStrip([HOOD, { d: 1.34, de: null }]));

  // Side consoles: a lit rail and a row of breakers along the outboard end of
  // the panel, following the coaming down so the corners have something to be
  // other than black. They sit under the coaming line rather than across it — a
  // slab of its own out here reads as a strut through the peripheral glass.
  for (const sx of [-1, 1]) {
    const band = (a0, a1) => (sx > 0 ? [a0, a1] : [-a1, -a0]);
    at(trim, (h) => (m) => {
      const a = PILLAR - 2;
      fill(m, 0.94, ...band(a, h + 10), coamAt(a) - 4.5, coamAt(a) - 3.0, 0.06);
    });
    for (let i = 0; i < 4; i++) {
      const a = PILLAR + 1 + i * 4.5;
      at(trim, () => (m) => fill(m, 0.93, ...band(a, a + 2.2), coamAt(a) - 9, coamAt(a) - 7, 0.03));
    }
  }

  // A wipe of light across the inside of the glass. There is no sky out there
  // to light a canopy, so without something catching on it the glass is not
  // glass, it is a hole — and the whole frame stops reading as a cockpit and
  // starts reading as a bar drawn over the playfield. Kept faint and kept high,
  // clear of the row the formation flies on.
  const smear = makeScreen(64, 64);
  {
    const g = smear.ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(176,200,255,0.55)');
    g.addColorStop(0.35, 'rgba(150,180,240,0.22)');
    g.addColorStop(0.7, 'rgba(120,150,215,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    smear.ctx.fillStyle = g;
    smear.ctx.fillRect(0, 0, 64, 64);
    smear.tex.needsUpdate = true;
  }
  for (const [a, e, w, hgt, roll, op] of [
    [-30, 32, 1.15, 0.40, 0.62, 0.055],
    [27, 39, 0.72, 0.26, -0.72, 0.042],
  ]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: smear.tex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: op, fog: false,
      }),
    );
    m.position.copy(dome(0.88, T(a), T(e)));
    m.scale.set(w, hgt, 1);
    m.lookAt(0, 0, 0);
    m.rotateZ(roll);
    group.add(m);
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

  // Screens are placed by angle too, and squared up to the eye, so they stay
  // readable however far outboard the panel puts them.
  const mkScreen = (s, aspect, a, e, wDeg) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: s.tex }),
    );
    const bezel = new THREE.Mesh(UNIT, trim);
    group.add(m);
    group.add(bezel);
    slabs.push({
      m,
      place: () => () => {
        const d = 0.98;
        const w = 2 * d * T(wDeg / 2);
        const h = w / aspect;
        m.scale.set(w, h, 1);
        m.position.set(d * T(a), d * T(e), -d);
        m.lookAt(0, 0, 0); // rakes the screen toward the pilot for free
        bezel.position.copy(m.position);
        bezel.quaternion.copy(m.quaternion);
        bezel.scale.set(w * 1.07, h * 1.1, 0.02);
        bezel.translateZ(-0.02);
      },
    });
    return m;
  };

  // Outboard and low: the middle of the panel is where a diver that got past
  // you ends up, and the centre is the stick's.
  mkScreen(scope, 256 / 320, -27, -42, 23);
  mkScreen(sys, 256 / 192, 27, -43, 23);

  // Master-caution lamps under the coaming, on the centreline where they are
  // hard to miss but nowhere near anything you need to look through.
  const lamps = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120806, emissive: new THREE.Color(0xff4020), emissiveIntensity: 0,
    });
    lamps.push(mat);
    const a = -4.4 + i * 4.4;
    slab(mat, () => (m) => fill(m, 0.95, a - 1.7, a + 1.7, COAMING - 3.8, COAMING - 2.6, 0.015, -0.30));
  }

  // ---- Panel detail ---------------------------------------------------------
  // Instruments, switchgear and markings, built in panelDetail.js against the
  // same angular layout machinery so they re-place with the frame.
  const detail = buildPanelDetail({
    group,
    slabs,
    fill,
    T,
    mats: { panelMat, trim, rubber, bright },
    UNIT,
    layout: { COAMING, PILLAR, BOW },
    makeScreen,
    label,
    W,
    H,
  });

  // ---- Windscreen HUD -------------------------------------------------------
  // Additive and depth-tested off, so it reads as projected light on the glass
  // rather than a decal painted over the ships. It is stretched over the whole
  // frame, which is what lets a lock box follow a threat right out to the
  // peripheral glass instead of falling off the edge of a small plane.
  const hud = makeScreen(HUD_W, HUD_H);
  const hudPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: hud.tex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, opacity: 0.9, fog: false,
    }),
  );
  hudPlane.renderOrder = 20;
  group.add(hudPlane);
  slabs.push({
    m: hudPlane,
    place: (h, v) => (m) => {
      const d = 0.55;
      m.position.set(0, 0, -d);
      m.scale.set(2 * d * T(h), 2 * d * T(v), 1);
    },
  });

  // ---- The stick ------------------------------------------------------------
  // The whole point of the cockpit: slide your thumb and this moves with it.
  //
  // A real column sits between the pilot's knees, which from a fixed eye with
  // no head movement is a long way below the boresight. So it is mounted on
  // the front of the panel instead, pedestal-style, where it is in shot and
  // silhouetted against the console.
  const STICK_D = 0.78;
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, STICK_D * T(-48), -STICK_D);
  group.add(stickPivot);

  const boot = new THREE.Mesh(UNIT, rubber);
  boot.position.copy(stickPivot.position);
  boot.scale.set(0.10, 0.04, 0.10);
  group.add(boot);
  const stickH = STICK_D * (T(-32) - T(-48));
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.028, stickH, 8), bright);
  column.position.y = stickH / 2;
  stickPivot.add(column);
  const grip = new THREE.Mesh(UNIT, rubber);
  grip.scale.set(0.058, 0.092, 0.070);
  grip.position.y = stickH + 0.045;
  grip.rotation.x = -0.18;
  stickPivot.add(grip);
  // Trigger head — it lights when the guns are firing, which is the only
  // feedback in the cockpit that says a shot left the ship.
  const triggerMat = new THREE.MeshStandardMaterial({
    color: 0x180a0a, emissive: new THREE.Color(0xff3820), emissiveIntensity: 0,
  });
  const trigger = new THREE.Mesh(UNIT, triggerMat);
  trigger.scale.set(0.033, 0.026, 0.021);
  trigger.position.set(0, stickH + 0.055, 0.046);
  stickPivot.add(trigger);

  // Throttle on the left console, parked forward. It creeps with the stage.
  const throttle = new THREE.Group();
  group.add(throttle);
  slabs.push({
    m: throttle,
    place: (h) => (g) => {
      const d = 0.80;
      const a = -(h - 9);
      g.position.set(d * T(a), d * T(coamAt(a) - 7), -d);
      g.userData.z = g.position.z;
    },
  });
  const lever = new THREE.Mesh(UNIT, trim);
  lever.scale.set(0.04, 0.04, 0.20);
  lever.position.z = -0.10;
  throttle.add(lever);
  const knob = new THREE.Mesh(UNIT, rubber);
  knob.scale.setScalar(0.062);
  knob.position.z = -0.20;
  throttle.add(knob);

  // ---- Frame ---------------------------------------------------------------

  let hHalf = 0;
  let vHalf = 0;
  /** Re-lay the cockpit out for a view cone. Cheap: nothing is rebuilt. */
  function setFrame(h, v) {
    hHalf = h;
    vHalf = v;
    const hd = h / DEG;
    const vd = v / DEG;
    for (const { m, place } of slabs) place(hd, vd)(m);
  }
  setFrame(frame.hHalf, frame.vHalf);

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
    ctx.clearRect(0, 0, HUD_W, HUD_H);
    // Nothing is projected on the glass on the attract screen — the title art
    // is drawn on the same rectangle, and a reticle through the middle of it
    // just reads as clutter.
    if (!s.flying) return;
    const cx = HUD_W / 2;
    const cy = HUD_H / 2;
    // HUD pixels for an angle off the boresight. The glass spans the whole
    // frame now, so a symbol drawn at a fixed pixel radius would grow and
    // shrink with the field of view; drawn at a fixed angle it does not.
    const A = (deg) => (T(deg) / Math.tan(vHalf)) * (HUD_H / 2);

    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 2;

    // Boresight: gun cross, with the gap left open so a target sits in it.
    const gap = A(3.0);
    const arm = A(9.0);
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();

    // Beam line: dashes out at the elevation the ship's own row sits at, which
    // the rig's look-up angle puts a little below the boresight. This is the
    // reference the wide canopy exists to give you — something crossing it out
    // on the flank is level with you, and something drifting above or below it
    // is going to pass. Broken through the middle so it stays a mark on the
    // glass rather than a bar across the view.
    const beam = cy + A(s.horizon);
    const tick = A(2.0);
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      ctx.moveTo(cx + sx * A(13), beam);
      ctx.lineTo(cx + sx * A(31), beam);
      ctx.moveTo(cx + sx * A(31), beam - tick);
      ctx.lineTo(cx + sx * A(31), beam + tick);
    }
    ctx.stroke();

    // Drift ladder: where the ship is along the playfield, which the cockpit
    // view otherwise hides completely. Parked just above the coaming, so it is
    // never projected onto the panel.
    const t = s.playerX / W;
    const LADDER = cy + A(14.5);
    const half = A(24);
    ctx.beginPath();
    ctx.moveTo(cx - half, LADDER); ctx.lineTo(cx + half, LADDER); ctx.stroke();
    for (let i = 0; i <= 8; i++) {
      const x = cx - half + (half * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x, LADDER); ctx.lineTo(x, LADDER + (i % 4 === 0 ? 10 : 5));
      ctx.stroke();
    }
    ctx.fillStyle = GREEN;
    const mx = cx - half + half * 2 * t;
    ctx.beginPath();
    ctx.moveTo(mx, LADDER - 8); ctx.lineTo(mx - 7, LADDER - 20); ctx.lineTo(mx + 7, LADDER - 20);
    ctx.closePath();
    ctx.fill();

    // Lock box on the nearest thing actually coming at you.
    if (s.threat) {
      const th = s.threat;
      const sz = Math.max(A(2.6), A(18) / Math.max(0.6, th.dist));
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
      label(ctx, 'TRACTOR LOCK', cx, cy - A(30), 26, RED, 'center');
    } else if (s.beaming) {
      label(ctx, 'BEAM WARNING', cx, cy - A(30), 24, AMBER, 'center');
    }
  }

  // Displays repaint on a timer, not every frame: a full-frame canvas upload at
  // 60Hz is a lot of bandwidth for line art that reads identically at 30.
  let hudAcc = 0;
  let mfdAcc = 0;
  let stickX = 0;
  let fireLamp = 0;

  return {
    group,
    setFrame,

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

      throttle.position.z = (throttle.userData.z ?? -0.80) - Math.min(0.12, s.stage * 0.01);

      const warn = s.captured || s.beaming;
      const blink = warn ? (Math.sin(s.time * 9) > 0 ? 2.6 : 0) : 0;
      for (let i = 0; i < lamps.length; i++) {
        lamps[i].emissiveIntensity = i === 1 ? blink : blink * 0.35;
      }

      detail.update(dt, s);

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

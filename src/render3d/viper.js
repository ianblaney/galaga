// Colonial Viper Mark II.
//
// Modelled from the studio-miniature reference in sample-images/. Measuring
// that photo along the ship's axis gives the proportions everything else hangs
// off, and getting these wrong is what made earlier passes read as a generic
// jet no matter how much detail went on:
//   - the canopy sits ~63% of the way back from the nose, so most of the ship
//     is nose. The engine block is confined to the rear third.
//   - each nacelle is only ~30% of overall length: a short fat drum, not a
//     torpedo slung along the whole body
//   - the intake mouths land just behind the canopy, overlapping its rear
//   - the fuselage is fattest just behind the nose and tapers *rearward*
//
// After that, the cues that carry the silhouette:
//   - two nacelles riding on top of the fuselage shoulders, each fronted by a
//     big open dark intake, canopy in the trough between them
//   - nacelle detail order, front to back: intake lip, chrome greeble ring,
//     painted drum with an orange band and cream decal, dark ribbed collar
//   - a chunky, near-upright tail fin outlined with a thin orange border
//   - delta wings with pronounced anhedral, trailing edge flush with the
//     exhausts, and downturned tip plates
//   - chrome gun packs on the fuselage flanks at the wing root
//   - warm matte off-white paint; orange as flank stripes and hollow outlines
//
// The paint matters as much as the geometry: the reference is a model-kit
// eggshell, so hull materials are low-metalness on purpose.
//
// Lifted from the galactica-fps project, exterior only: there the model carried
// a cockpit interior of its own, where here the interior is cockpit.js, built
// in the camera's frame at a scale of its own. So this is the hull you see in
// the chase view and nothing more.
import * as THREE from 'three';
import { viperSkin } from './viperSkin.js';

/** Shrink a polygon toward its centroid — the basis of the hollow decals. */
function insetPoints(points, k) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) { cx += x / points.length; cy += y / points.length; }
  return points.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/**
 * Ring-shaped outline of a polygon: the reference paints its orange as thin
 * borders inset from a panel's edge, never as a slab across it. Building it as
 * a shape-with-hole guarantees the trim stays inside the part it decorates —
 * hand-placed strips kept poking out past the tail fin.
 */
function outlineShape(points, outerK, innerK) {
  const toV = (p) => p.map(([x, y]) => new THREE.Vector2(x, y));
  const shape = new THREE.Shape(toV(insetPoints(points, outerK)));
  shape.holes.push(new THREE.Path(toV(insetPoints(points, innerK)).reverse()));
  return shape;
}

function solidShape(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

/**
 * Extrude a flat outline into a plate.
 *
 * `upright` plates live in the ship's centre plane with shape coords read as
 * [z, y] and thickness across X — the tail fin. Otherwise the plate lies flat
 * with shape coords read as [span, chord] and thickness in Y — the wings.
 */
function plateGeometry(shape, thickness, upright = false) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  if (upright) geo.rotateY(-Math.PI / 2);
  else geo.rotateX(Math.PI / 2);
  return geo;
}

/**
 * @param {object} opts
 * @param {boolean} opts.gearDown  landing skids extended (parked in the bay)
 * @param {boolean} opts.powered   engines lit. Parked hangar props pass false:
 *   even at zero throttle the nozzles keep a hot core and a idle plume, which
 *   on a ship sitting on its skids reads as engines running.
 * @returns {{ group: THREE.Group, setThrust: (t:number)=>void,
 *            setPowered: (on:boolean)=>void }}
 */
export function buildViper({ gearDown = true, powered = true } = {}) {
  const group = new THREE.Group();
  // Everything is modelled in a nose-forward frame whose origin sits at the
  // canopy. `body` then slides the whole ship back so the *group* origin is the
  // hull's midpoint — which is what the chase camera and the placement code in
  // view3d.js assume. Without it the model hangs entirely ahead of its own
  // origin and the chase view frames empty space.
  const body = new THREE.Group();
  group.add(body);

  // Panel seams, fasteners and weathering. The albedo is near white, so the
  // material colour below still supplies the paint hue.
  const skin = viperSkin();

  // Painted airframe: warm eggshell, barely metallic. envMapIntensity stays low
  // so reflections don't drag the value back toward gunmetal. The colour runs a
  // little hot to compensate for the grime in the skin's albedo.
  const hull = new THREE.MeshStandardMaterial({
    color: 0xdedbd1, roughness: 0.72, metalness: 0.06, envMapIntensity: 0.3,
    ...skin,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });
  // Shadowed / secondary panels — same paint, a couple of stops down.
  const hullShade = new THREE.MeshStandardMaterial({
    color: 0xb4b1a7, roughness: 0.76, metalness: 0.06, envMapIntensity: 0.28,
    map: skin.map,
  });
  // Cream decal panels on the fuselage flanks.
  const decal = new THREE.MeshStandardMaterial({
    color: 0xe4dfcd, roughness: 0.7, metalness: 0.04,
  });
  // Bare machined metal: gun packs, exhaust cans, nacelle greebles.
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9aa0a6, roughness: 0.38, metalness: 0.8, envMapIntensity: 0.9,
  });
  // The nose cap is a shallow matte casting — mid gunmetal. It has to be light
  // enough to read as grey primer against the hull, not as a hole.
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x6e7276, roughness: 0.74, metalness: 0.28, envMapIntensity: 0.45,
  });
  const stripe = new THREE.MeshStandardMaterial({
    color: 0xdf6733, roughness: 0.68, metalness: 0.04,
  });
  const stripeFlat = new THREE.MeshStandardMaterial({
    color: 0xdf6733, roughness: 0.68, metalness: 0.04, side: THREE.DoubleSide,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x1a1d21, roughness: 0.66, metalness: 0.45,
  });
  // The ribbed collar reads as individual rings catching light, not a void.
  const ribbed = new THREE.MeshStandardMaterial({
    color: 0x5a6068, roughness: 0.45, metalness: 0.7,
  });
  // Intake and exhaust interiors. Deliberately unlit: a shaded throat picks up
  // the key light and the mouth stops reading as a hole, which is most of what
  // makes the intakes recognisable at silhouette distance.
  const cavity = new THREE.MeshBasicMaterial({
    color: 0x090b0e, side: THREE.DoubleSide, fog: false,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2b3a4c, roughness: 0.08, metalness: 0.35, envMapIntensity: 2.4,
    transparent: true, opacity: 0.55,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xdedbd1, roughness: 0.72, metalness: 0.06,
    side: THREE.DoubleSide, envMapIntensity: 0.3,
    ...skin,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    body.add(m);
    return m;
  };
  // `open` matters wherever a cylinder end lands near an intake or nozzle: a
  // cap there plugs the recess. Note the helper only forwards these five
  // arguments — passing THREE's raw openEnded flag through silently does
  // nothing, which is how the centre engine ended up capped and unlit.
  const cyl = (rt, rb, h, seg = 22, open = false) =>
    new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  /** Open-ended tube — used for intake and exhaust throats. */
  const tube = (r, h, seg = 22) =>
    new THREE.CylinderGeometry(r, r, h, seg, 1, true);

  const AXIS_Y = Math.PI / 2; // lay a cylinder along +Z; radiusTop faces the nose

  // ---- Longitudinal layout -------------------------------------------------
  // The canopy station is the fixed point the measured proportions hang off:
  // nose 63% of the length ahead of it, engine block in the rear third.
  const EYE_Z = 1.86;
  const LEN = 9.0;
  const NOSE = EYE_Z + 0.63 * LEN;   // 7.53
  const TAIL = NOSE - LEN;           // -1.47
  const NAC_X = 0.95;
  const NAC_Y = 0.62;
  const NAC_R = 0.60;
  const NAC_FRONT = TAIL + 0.30 * LEN; // 1.23 — just behind the canopy
  const INTAKE_D = 0.85;               // how far the dark throat runs back

  // ---- Fuselage ------------------------------------------------------------
  // Fattest just behind the nose, tapering rearward into the engine block.
  add(cyl(0.71, 0.63, 3.0), hull, 0, 0, 0.0, AXIS_Y);
  add(cyl(0.805, 0.71, 4.0), hull, 0, 0, 3.5, AXIS_Y);
  add(cyl(0.66, 0.805, 1.7), hull, 0, 0, 6.35, AXIS_Y);
  // Shallow dome, canted a touch nose-down so the tip doesn't read as a
  // cylinder chopped off square.
  const noseCap = add(
    new THREE.SphereGeometry(0.66, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    capMat, 0, 0, 7.15, Math.PI / 2 - 0.08
  );
  noseCap.scale.set(1, 0.6, 1);

  // Belly fairing — flattens the underside so the tube doesn't read as a pipe.
  add(new THREE.BoxGeometry(0.98, 0.3, 6.6), hull, 0, -0.58, 2.9);
  add(new THREE.BoxGeometry(0.78, 0.22, 1.1), hullShade, 0, -0.62, 6.2);

  // Orange trim. The reference has no ring at the tip — the nose cap runs
  // straight into bare hull, and the orange is a long stripe set back along
  // the upper flank, plus a spine stripe running forward from the windscreen.
  // Built as an arc of a cone rather than a flat box: the fuselage tapers, so
  // a straight box either buries itself in the hull or floats off it, and it
  // did both along its length.
  const flankGeo = new THREE.CylinderGeometry(
    0.815, 0.748, 2.8, 20, 1, true, 2.24 - 0.08, 0.16
  );
  for (const sx of [1, -1]) {
    const flank = add(flankGeo, stripe, 0, 0, 4.0, AXIS_Y);
    flank.scale.x = sx;
  }
  add(new THREE.BoxGeometry(0.22, 0.05, 2.4), stripe, 0, 0.685, 3.9);

  // Cream decal panels and stencil placards on the flanks, straight off the
  // reference's port side.
  for (const sx of [1, -1]) {
    add(new THREE.BoxGeometry(0.02, 0.46, 0.85), decal, sx * 0.775, -0.08, 4.5);
    add(plateGeometry(solidShape([[0, 0], [0.85, 0], [0.85, -0.22], [0.58, -0.4],
      [0, -0.4]]), 0.02, true), decal, sx * 0.745, 0.1, 2.6);
    add(new THREE.BoxGeometry(0.02, 0.05, 0.22), black, sx * 0.752, -0.06, 2.95);
    add(new THREE.BoxGeometry(0.02, 0.05, 0.15), stripe, sx * 0.752, -0.16, 2.9);
  }

  // ---- Engine nacelles -----------------------------------------------------
  const cones = [];
  const glows = []; // the hot-core discs, hidden outright when unpowered
  // One material per nozzle. The centre engine sits closest to the chase camera
  // and points straight at it, so at the nacelles' brightness it saturates to
  // white and reads as a separate light source rather than a third engine.
  const glowMats = [];
  const glowMat = new THREE.MeshBasicMaterial({
    // Saturated rather than pale: additive blending pushes anything near white
    // straight to a blown-out flat disc filling the nozzle.
    color: 0x5aa2ff, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  });

  /**
   * Open intake: painted lip, dark throat, blanked-off compressor face. Every
   * ring here is open-ended and the throat runs the full lip radius — a capped
   * cylinder, or an annular step, puts a lit surface in the mouth and the
   * intake stops reading as a hole.
   */
  const intake = (x, y, z, r, depth) => {
    const rt = r * 0.8; // throat: the mouth is a dark ellipse inside a lip, not
    add(tube(rt, depth, 24), cavity, x, y, z - depth / 2, AXIS_Y).castShadow = false;
    add(new THREE.CircleGeometry(rt, 24), cavity, x, y, z - depth + 0.01);
    // ...an all-black nacelle face. The painted lip ring is what sells it.
    add(new THREE.RingGeometry(rt, r * 1.04, 24), hullShade, x, y, z);
    add(tube(r * 1.04, 0.14, 24), hullShade, x, y, z - 0.07, AXIS_Y).castShadow = false;
  };

  /**
   * Exhaust can + glow disc + throttle-driven flame, pointing aft.
   *
   * @param skinR outer radius of the surrounding pod, closed off by a ring so
   *   the pod skin itself can stay open-ended. Every solid disc anywhere near
   *   this mouth has to go: a capped cylinder — the pod drum, a collar ring,
   *   the centre fairing — puts a lit disc across the nozzle, which plugs the
   *   recess, hides the glow, and z-fights into a spoked fan pattern. That is
   *   what made the engines look dead from the chase camera.
   *
   * Faces here point aft (rotation.y = PI). The chase camera looks straight up
   * the tail, and a forward-facing single-sided disc is simply culled.
   */
  const exhaust = (x, y, z, r, skinR = 0, glowScale = 1) => {
    add(tube(r * 1.02, 0.4, 22), metal, x, y, z + 0.2, AXIS_Y).castShadow = false;
    add(new THREE.RingGeometry(r * 0.9, r * 1.02, 22), metal, x, y, z, 0, Math.PI, 0);
    if (skinR > r * 1.02) {
      add(new THREE.RingGeometry(r * 1.02, skinR, 22), hull, x, y, z, 0, Math.PI, 0);
    }
    add(tube(r * 0.9, 0.5, 22), cavity, x, y, z + 0.25, AXIS_Y).castShadow = false;
    add(new THREE.CircleGeometry(r * 0.9, 22), cavity, x, y, z + 0.5, 0, Math.PI, 0);

    // Small and deep in the recess: a disc filling the nozzle mouth reads as a
    // headlight, where the reference nozzles are dark holes with a hot core.
    const gm = glowMat.clone();
    gm.userData.glowScale = glowScale;
    glowMats.push(gm);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.44, 18), gm);
    disc.position.set(x, y, z + 0.22);
    disc.rotation.y = Math.PI; // face aft — the chase camera looks up the tail
    body.add(disc);
    glows.push(disc);

    // Plume: kept short so it doesn't overrun the wings at cruise throttle.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.7, 1.1, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x69a8ff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false,
      })
    );
    cone.rotation.x = -Math.PI / 2; // apex aft, trailing behind the nozzle
    cone.position.set(x, y, z - 0.75);
    body.add(cone);
    cones.push(cone);
  };

  for (const sx of [1, -1]) {
    const x = sx * NAC_X;
    // Drum stops short of the mouth: the intake throat carries the last
    // stretch, so nothing solid sits inside it.
    const drumFront = NAC_FRONT - INTAKE_D;
    add(tube(NAC_R, drumFront - TAIL, 24), hull,
      x, NAC_Y, (drumFront + TAIL) / 2, AXIS_Y);
    add(tube(NAC_R, INTAKE_D, 24), hull, x, NAC_Y, NAC_FRONT - INTAKE_D / 2, AXIS_Y);
    intake(x, NAC_Y, NAC_FRONT, NAC_R, INTAKE_D);

    // Chrome greeble ring behind the intake — the busy mechanical band that
    // reads so strongly in the reference photo.
    add(tube(NAC_R * 1.03, 0.22, 24), metal, x, NAC_Y, drumFront - 0.14, AXIS_Y);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.06, 0.06, 0.26), metal,
        x + Math.cos(a) * NAC_R * 1.06, NAC_Y + Math.sin(a) * NAC_R * 1.06,
        drumFront - 0.14);
    }
    add(tube(NAC_R * 1.02, 0.07, 24), hullShade, x, NAC_Y, drumFront - 0.32, AXIS_Y);

    // Orange band on the drum, with the cream rectangle decal beside it.
    add(tube(NAC_R * 1.008, 0.3, 24), stripe, x, NAC_Y, -0.35, AXIS_Y);
    add(new THREE.BoxGeometry(0.02, 0.3, 0.44), decal,
      sx * (NAC_X + NAC_R), NAC_Y + 0.08, -0.85);

    // Ribbed collar at the tail end of the pod — narrow, and dark grey rather
    // than a solid black band.
    for (let i = 0; i < 4; i++) {
      add(tube(NAC_R * 1.01, 0.055, 24), ribbed,
        x, NAC_Y, -1.05 - i * 0.1, AXIS_Y);
    }

    // Shoulder fairing blending the pod down onto the fuselage, plus a band of
    // greebles at the root — the densest detail on the reference.
    // Stops short of the intake: run it any further forward and it pokes
    // into the throat, where it catches the key light and reads as a plug
    // sitting inside the mouth.
    add(new THREE.BoxGeometry(0.4, 0.6, 2.4), hullShade, sx * 0.5, 0.4, -0.45);
    for (let i = 0; i < 5; i++) {
      add(new THREE.BoxGeometry(0.1, 0.1, 0.12), metal,
        sx * 0.5, 0.66, 0.5 - i * 0.2);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.5), metal,
        sx * 0.42, 0.5 - (i % 2) * 0.16, 0.2 - i * 0.22);
    }

    exhaust(x, NAC_Y, TAIL, NAC_R * 0.9, NAC_R);
  }

  // Third engine, in the fuselage itself: exhaust in the tail, below and
  // between the pods.
  add(cyl(0.56, 0.6, 0.6, 24, true), hullShade, 0, -0.1, TAIL + 0.4, AXIS_Y);
  exhaust(0, -0.1, TAIL, 0.42, 0.56, 0.6);

  // ---- Canopy --------------------------------------------------------------
  // Framed greenhouse in the trough between the nacelles, its crown level with
  // their crowns and its rear overlapping the intake mouths.
  const CAN_Z = EYE_Z;
  const CAN_Y = 0.72;
  // Raised spine deck between the nacelles. Without it the canopy sits in a
  // hollow and the pods hide it from every 3/4 angle — which is exactly what
  // it did before, and the canopy is too identifiable a feature to lose.
  add(new THREE.BoxGeometry(1.08, 0.5, 3.4), hull, 0, 0.46, CAN_Z - 0.3);
  add(new THREE.BoxGeometry(1.02, 0.24, 2.2), hullShade, 0, CAN_Y - 0.12, CAN_Z);
  const canopy = add(
    new THREE.SphereGeometry(0.48, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    glass, 0, CAN_Y, CAN_Z
  );
  // Shortened and set back to leave room for a raked windscreen ahead of it —
  // the reference canopy is a faired greenhouse with a sloped front pane, not
  // a dome that curves straight down onto the deck.
  canopy.scale.set(0.92, 1.35, 1.55);
  canopy.position.z = CAN_Z - 0.12;
  {
    // Sloped front pane, from the canopy crown down to the nose deck.
    const screen = add(new THREE.BoxGeometry(0.8, 0.03, 0.88), glass,
      0, CAN_Y + 0.2, CAN_Z + 0.98);
    screen.rotation.x = 0.58;
    screen;
    // Frame rails down both edges of the pane, plus the centre post.
    for (const fx of [0.39, 0, -0.39]) {
      const rail = add(new THREE.BoxGeometry(0.05, 0.05, 0.92), hullShade,
        fx, CAN_Y + 0.21, CAN_Z + 0.98);
      rail.rotation.x = 0.58;
      rail;
    }
    // Coaming across the bottom of the windscreen.
    add(new THREE.BoxGeometry(0.86, 0.1, 0.12), hullShade,
      0, CAN_Y - 0.02, CAN_Z + 1.4);
  }
  {
    // Ejection seat and headrest, visible through the glazing. Without them the
    // canopy reads as an open hatch from above rather than as glass.
    add(new THREE.BoxGeometry(0.34, 0.36, 0.1), black, 0, CAN_Y + 0.16, CAN_Z - 0.42);
    add(new THREE.BoxGeometry(0.34, 0.08, 0.36), black, 0, CAN_Y - 0.02, CAN_Z - 0.22);
    add(new THREE.BoxGeometry(0.26, 0.14, 0.12), hullShade, 0, CAN_Y + 0.3, CAN_Z - 0.46);
    // Coaming interior, so the eye finds a surface rather than a void.
    add(new THREE.BoxGeometry(0.66, 0.06, 0.9), hullShade, 0, CAN_Y - 0.05, CAN_Z + 0.3);
  }

  // Framing: thin ribs over the glass, the most identifiable feature at this
  // scale. They're light metal on the reference, not black.
  for (const [fz, fs] of [[-0.78, 0.62], [-0.12, 1.0], [0.5, 0.82]]) {
    const hoop = add(new THREE.TorusGeometry(0.45, 0.03, 6, 20, Math.PI), hullShade,
      0, CAN_Y, CAN_Z + fz);
    hoop.scale.set(0.9, 1.35 * fs, 1);
    hoop;
  }
  add(new THREE.BoxGeometry(0.045, 0.045, 1.3), hullShade, 0, CAN_Y + 0.63, CAN_Z - 0.12);
  for (const sx of [1, -1]) {
    add(new THREE.BoxGeometry(0.045, 0.045, 1.7), hullShade,
        sx * 0.34, CAN_Y + 0.42, CAN_Z - 0.12);
    // Sill rail along the canopy base.
    add(new THREE.BoxGeometry(0.06, 0.07, 1.9), hullShade, sx * 0.44, CAN_Y, CAN_Z);
  }
  // Windscreen frame ahead of the bubble, and a tapered spine fairing behind
  // it — a box there reads as a crate strapped to the deck.
  add(new THREE.BoxGeometry(0.62, 0.16, 0.26), hullShade, 0, CAN_Y + 0.06, CAN_Z + 1.02);
  add(cyl(0.34, 0.12, 1.1, 14), hull, 0, CAN_Y + 0.02, CAN_Z - 1.4, AXIS_Y);

  // ---- Tail fin ------------------------------------------------------------
  // Chunky trapezoid on a broad base, leading edge close to upright, sitting
  // between the nacelle exhausts. Orange is a thin border inset from the edges.
  const FIN = [[0.85, 0.72], [0.05, 2.6], [-0.85, 2.6], [-1.15, 0.72]];
  add(plateGeometry(solidShape(FIN), 0.34, true), hull, 0, 0, 0);
  add(plateGeometry(outlineShape(FIN, 0.84, 0.64), 0.36, true), stripe, 0, 0, 0);
  // Root fairing carrying the fin down onto the spine between the pods.
  add(new THREE.BoxGeometry(0.46, 0.5, 2.3), hull, 0, 0.6, -0.15);

  // ---- Wings ---------------------------------------------------------------
  // Delta with pronounced anhedral — the droop is what stops the wing reading
  // as a fighter glove. Trailing edge sits flush with the exhaust plane.
  const WING = { span: 2.78, rootLE: 2.4, rootTE: -1.35, tipLE: 0.05, tipTE: -1.45 };
  const wingOutline = [
    [0, WING.rootLE], [WING.span, WING.tipLE],
    [WING.span, WING.tipTE], [0, WING.rootTE],
  ];
  const wingGeo = plateGeometry(solidShape(wingOutline), 0.2);
  // Hollow chevron over the outer third, as on the reference.
  const CHEVRON = [[1.6, 0.7], [2.78, -0.05], [2.78, -0.9], [1.6, -0.25]];
  const chevronGeo = plateGeometry(outlineShape(CHEVRON, 1.0, 0.62), 0.22);

  for (const sx of [1, -1]) {
    const place = (mesh) => {
      mesh.position.set(sx * 0.55, -0.3, 0.0);
      mesh.scale.x = sx;
      mesh.rotation.z = sx * -0.2; // pronounced anhedral
      body.add(mesh);
    };
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.castShadow = true;
    place(wing);
    place(new THREE.Mesh(chevronGeo, stripeFlat));

    // Thin tip plate, canted down and blended into the trailing edge.
    const tip = add(new THREE.BoxGeometry(0.055, 0.36, 1.15), hull,
      sx * 3.27, -0.88, -0.72);
    tip.rotation.z = sx * 0.42;
    const tipTrim = add(new THREE.BoxGeometry(0.065, 0.36, 0.16), stripe,
      sx * 3.27, -0.88, -0.2);
    tipTrim.rotation.z = sx * 0.42;

    // Root fairing blending the leading edge into the fuselage flank.
    const root = add(new THREE.BoxGeometry(0.28, 0.28, 3.4), hull,
      sx * 0.6, -0.32, 0.6);
    root.rotation.z = sx * -0.2;

    // Control-surface split line. It has to be laid in by the same placement
    // as the wing — a box at constant Y crosses through a drooping wing and
    // reads as a spike at the tip.
    const split = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.02, 0.05), hullShade);
    split.geometry.translate(1.45, 0.07, -0.95);
    place(split);

    // Access hatches on the wing upper surface.
    for (const [hs, hz, hw] of [[0.9, -0.3, 0.3], [1.5, -0.6, 0.24], [2.05, -0.9, 0.18]]) {
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(hw, 0.02, hw * 0.8), hullShade);
      hatch.geometry.translate(hs, 0.102, hz);
      place(hatch);
    }
  }

  // ---- Guns ----------------------------------------------------------------
  // Short chrome gun packs lying along the wing root against the fuselage
  // flank — where the reference puts them. Nothing hangs off the belly.
  for (const sx of [1, -1]) {
    add(cyl(0.16, 0.16, 1.5, 14), metal, sx * 0.72, -0.24, 2.1, AXIS_Y);
    add(cyl(0.062, 0.062, 0.9, 10), metal, sx * 0.72, -0.24, 3.2, AXIS_Y);
    add(cyl(0.075, 0.075, 0.14, 10), black, sx * 0.72, -0.24, 3.6, AXIS_Y);
    for (let i = 0; i < 4; i++) {
      add(cyl(0.175, 0.175, 0.05, 14), hullShade, sx * 0.72, -0.24, 2.5 - i * 0.22, AXIS_Y);
    }
    add(new THREE.BoxGeometry(0.14, 0.2, 1.3), hullShade, sx * 0.62, -0.38, 2.0);
  }

  // ---- Airframe detailing --------------------------------------------------
  {
    // Dorsal access panels along the nose deck.
    for (const [pz, pw, pd] of [[5.7, 0.36, 0.8], [5.0, 0.44, 0.4]]) {
      add(new THREE.BoxGeometry(pw, 0.03, pd), hullShade, 0, 0.785, pz);
    }
    // Nose sensor window under the chin.
    add(new THREE.BoxGeometry(0.28, 0.09, 0.36), black, 0, -0.6, 5.9);

    // Reaction-control thruster clusters, fore and aft.
    for (const [tz, sx] of [[5.9, 1], [5.9, -1], [-0.6, 1], [-0.6, -1]]) {
      add(cyl(0.05, 0.065, 0.09, 8), black, sx * 0.7, 0.16, tz, 0, 0, Math.PI / 2);
    }

    // Blade antenna and probes on the spine.
    add(new THREE.BoxGeometry(0.045, 0.26, 0.15), hullShade, 0, 0.9, 5.35);
    add(cyl(0.02, 0.02, 0.3, 8), black, 0.34, 0.72, 4.9);

    // Nav lights, sunk into the tip plates rather than sitting proud of them.
    for (const sx of [1, -1]) {
      const navLight = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 8),
        new THREE.MeshBasicMaterial({ color: sx > 0 ? 0x35ff6a : 0xff3b30, fog: false })
      );
      navLight.position.set(sx * 3.34, -0.96, -0.16);
      body.add(navLight);
    }

    // Louvred cooling vents on the nacelle crowns.
    for (const sx of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        add(new THREE.BoxGeometry(0.24, 0.02, 0.06), black,
          sx * NAC_X, NAC_Y + NAC_R - 0.01, -0.6 - i * 0.15);
      }
    }

    // Airbrake panels on the fuselage sides, ahead of the tail.
    for (const sx of [1, -1]) {
      add(new THREE.BoxGeometry(0.04, 0.36, 0.8), hullShade, sx * 0.62, -0.16, 0.5);
    }
  }

  // ---- Landing skids -------------------------------------------------------
  if (gearDown) {
    for (const [gx, gz] of [[0, 5.2], [-1.45, -0.3], [1.45, -0.3]]) {
      add(cyl(0.07, 0.07, 1.05, 8), black, gx, -1.02, gz);
      add(new THREE.BoxGeometry(0.34, 0.1, 0.5), black, gx, -1.53, gz);
    }
  }

  // Slide the finished ship so the group origin lands at its midpoint.
  const CENTER = (NOSE + TAIL) / 2;
  body.position.z = -CENTER;

  let isPowered = powered;
  for (const g of glows) g.visible = isPowered;
  for (const cone of cones) cone.visible = isPowered;

  return {
    group,
    /**
     * Engines lit or cold. A cold ship shows bare dark nozzles: the glow disc
     * and the plume are both hidden, not merely dimmed, since additive
     * blending keeps even a low-opacity disc visible against the recess.
     */
    setPowered(on) {
      isPowered = !!on;
      for (const g of glows) g.visible = isPowered;
      for (const cone of cones) cone.visible = isPowered;
    },
    /** @param t throttle 0..1 — stretches and brightens the exhaust plume. */
    setThrust(t) {
      if (!isPowered) return;
      const k = Math.max(0, Math.min(1, t));
      for (const cone of cones) {
        cone.scale.set(0.8 + k * 0.5, 0.35 + k * 1.5, 0.8 + k * 0.5);
        cone.material.opacity = 0.14 + k * 0.4;
      }
      for (const m of glowMats) {
        m.opacity = (0.34 + k * 0.5) * m.userData.glowScale;
      }
    },
  };
}

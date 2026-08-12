// Ships, shots and effects as geometry. Every craft is built nose-along-+Z in
// its own frame, because the field it lives in has "toward the player" as +Z.
//
// Colours are lifted straight off the arcade sprites in sprites.js — a bee is
// still yellow with a blue core, a boss still turns from green to blue when you
// take its first hit — so the formation reads the same at a glance.
import * as THREE from 'three';
import { beamTexture } from './textures.js';

const PAL = {
  W: 0xffffff,
  R: 0xe02020,
  Y: 0xf4d03f,
  B: 0x3060d0,
  G: 0x38b24a,
  P: 0xc040c0,
  C: 0x40d0e0,
};

// Materials are shared across every instance of a type: 40 enemies with their
// own material would be 40 shader programs' worth of uniform uploads a frame.
const cache = new Map();

function hull(color, emissive = color, intensity = 0.32) {
  const key = `h${color}:${emissive}:${intensity}`;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: intensity,
      roughness: 0.42,
      metalness: 0.55,
      flatShading: true,
    }));
  }
  return cache.get(key);
}

function glow(color, intensity = 2.2) {
  const key = `g${color}:${intensity}`;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({
      color: 0x101018,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 1,
      metalness: 0,
    }));
  }
  return cache.get(key);
}

function geo(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

/**
 * The common airframe: a faceted fuselage, a swept wing pair, twin eyes and a
 * pair of trailing spines — the four features that make the arcade silhouettes
 * distinguishable from each other at a glance.
 */
function craft({ body, wing, core, eye, scale, wingSpan, wingSweep, spine }) {
  const g = new THREE.Group();

  const fuselage = new THREE.Mesh(
    geo('fuselage', () => new THREE.OctahedronGeometry(0.5, 0)),
    hull(body),
  );
  fuselage.scale.set(0.62, 0.42, 1.15);
  g.add(fuselage);

  // The lit core, sunk into the belly. This is the bit that catches the bloom.
  const coreMesh = new THREE.Mesh(
    geo('core', () => new THREE.IcosahedronGeometry(0.26, 0)),
    glow(core),
  );
  coreMesh.position.z = 0.06;
  g.add(coreMesh);

  for (const sx of [-1, 1]) {
    // Each wing hangs off its own pivot: mirroring and sweep are both rotations
    // about Y, and stacking them on the mesh itself fights the Euler order.
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.18, 0, 0);
    pivot.rotation.y = sx > 0 ? wingSweep : Math.PI - wingSweep;
    g.add(pivot);

    const w = new THREE.Mesh(
      geo('wing', () => {
        // A flat wedge: wide at the root, tapering to a point outboard.
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.38);
        shape.lineTo(1, 0.02);
        shape.lineTo(1, -0.10);
        shape.lineTo(0, -0.42);
        shape.closePath();
        return new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
      }),
      hull(wing),
    );
    // Drawn in XY and extruded through Z, so roll it flat: span runs +X, chord
    // runs Z, and the extrusion depth becomes the thickness.
    w.rotation.x = -Math.PI / 2;
    // The wedge is a unit long, which spans two and a half fuselages if it is
    // left alone — the first formation drawn with it read as five solid planks.
    w.scale.set(wingSpan * 0.34, 1, 0.8);
    pivot.add(w);

    const e = new THREE.Mesh(
      geo('eye', () => new THREE.SphereGeometry(0.06, 8, 6)),
      glow(eye, 1.4),
    );
    e.position.set(sx * 0.13, 0.09, 0.34);
    g.add(e);

    if (spine) {
      const s = new THREE.Mesh(
        geo('spine', () => new THREE.CylinderGeometry(0.015, 0.05, 0.7, 5)),
        hull(spine),
      );
      s.rotation.x = Math.PI / 2;
      s.position.set(sx * 0.20, -0.02, -0.5);
      g.add(s);
    }
  }

  g.scale.setScalar(scale);
  return g;
}

/** A bee, butterfly or boss, matching the arcade sprite's colours. */
export function makeEnemy(type) {
  if (type === 'bee') {
    return craft({
      body: PAL.Y, wing: PAL.Y, core: PAL.B, eye: PAL.W,
      scale: 1.05, wingSpan: 1.0, wingSweep: 0.5, spine: PAL.Y,
    });
  }
  if (type === 'butterfly') {
    return craft({
      body: PAL.R, wing: PAL.W, core: PAL.B, eye: PAL.W,
      scale: 1.12, wingSpan: 1.15, wingSweep: 0.42, spine: PAL.R,
    });
  }
  return craft({
    body: PAL.G, wing: PAL.P, core: PAL.B, eye: PAL.W,
    scale: 1.45, wingSpan: 1.25, wingSweep: 0.30, spine: PAL.P,
  });
}

/**
 * Recolour a boss's shell green -> blue, the way BOSS_HIT does in the sprite
 * sheet. The fuselage is the first child, by construction in craft().
 */
export function setBossDamaged(mesh, damaged) {
  const fuselage = mesh.children[0];
  const want = hull(damaged ? PAL.B : PAL.G);
  if (fuselage.material !== want) fuselage.material = want;
}

/** The player's fighter — seen as the wingman, the captive, and the life icons. */
export function makeFighter(colour = PAL.W) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    geo('fighterBody', () => new THREE.ConeGeometry(0.22, 1.0, 4)),
    hull(colour),
  );
  body.rotation.x = Math.PI / 2; // cone points +Z
  g.add(body);

  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(
      geo('fighterWing', () => new THREE.BoxGeometry(0.55, 0.05, 0.30)),
      hull(colour === PAL.W ? PAL.R : colour),
    );
    wing.position.set(sx * 0.36, -0.02, -0.22);
    wing.rotation.y = sx * 0.22;
    g.add(wing);
  }

  const thruster = new THREE.Mesh(
    geo('thruster', () => new THREE.CylinderGeometry(0.10, 0.14, 0.22, 8)),
    glow(PAL.C, 2.6),
  );
  thruster.rotation.x = Math.PI / 2;
  thruster.position.z = -0.55;
  g.add(thruster);

  return g;
}

/**
 * Tracer for a shot: long and thin, so it reads as motion even sitting still.
 *
 * Kept small. A shot is born a metre in front of the eye, and at the size these
 * first were, every round left a glowing bar across the middle of the canopy.
 */
export function makeTracer(colour, length, radius = 0.028) {
  // Rolled onto +Z in the geometry, not on the mesh: the view aims tracers with
  // lookAt, which overwrites the mesh rotation outright.
  return new THREE.Mesh(
    geo(`tracer${length}:${radius}`, () => {
      const cyl = new THREE.CylinderGeometry(radius, radius, length, 6);
      cyl.rotateX(Math.PI / 2);
      return cyl;
    }),
    glow(colour, 2.2),
  );
}

/** Expanding shell for a kill: a billboard, because it has no shape to lose. */
export function makeBlast(texture) {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: 0xffb040,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
}

/**
 * The tractor beam: an open cone with its apex at the boss. Rendered from the
 * inside as well as the outside, so flying into it doesn't make it vanish.
 */
export function makeBeam() {
  // Its own copy of the ramp, so each beam can scroll on its own clock.
  const map = beamTexture().clone();
  map.needsUpdate = true;
  const g = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 24, 12, true),
    new THREE.MeshBasicMaterial({
      map,
      color: 0x9ecdff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    }),
  );
  // Cone is built around +Y with the apex up; the beam wants its apex at the
  // origin and its mouth running out along +Z, which is where the player is.
  g.geometry.translate(0, -0.5, 0);
  g.geometry.rotateX(-Math.PI / 2);
  return g;
}

export { PAL };

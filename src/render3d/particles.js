// Loose light: debris from kills, exhaust behind anything on an attack run,
// and the glowing tail on an enemy shot.
//
// One Points object and a ring buffer, so however busy a stage gets it costs a
// single draw call and never allocates. A particle fades by having its colour
// scaled toward black, which under additive blending is the same as fading it
// out — PointsMaterial has no per-point opacity, but it does have colour.
import * as THREE from 'three';
import { starTexture } from './textures.js';

const MAX = 2400;

export function buildParticles(parent) {
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);
  const base = new Float32Array(MAX * 3); // colour at birth
  const age = new Float32Array(MAX);
  const life = new Float32Array(MAX); // 0 = slot is free
  const drag = new Float32Array(MAX);
  let next = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: starTexture(),
    size: 0.22,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  // The live particles are scattered along the whole playfield; the bounding
  // sphere of a buffer that changes every frame is not worth recomputing.
  points.frustumCulled = false;
  parent.add(points);

  const tmp = new THREE.Color();

  function spawn(at, colour, vx, vy, vz, lifetime, dragK, gain) {
    const i = next;
    next = (next + 1) % MAX;
    const j = i * 3;
    pos[j] = at.x;
    pos[j + 1] = at.y;
    pos[j + 2] = at.z;
    vel[j] = vx;
    vel[j + 1] = vy;
    vel[j + 2] = vz;
    base[j] = colour.r * gain;
    base[j + 1] = colour.g * gain;
    base[j + 2] = colour.b * gain;
    age[i] = 0;
    life[i] = lifetime;
    drag[i] = dragK;
  }

  return {
    /**
     * A kill: fragments in the ship's own colours, thrown out on a sphere and
     * braked hard, with a few white-hot sparks that fly further and die first.
     */
    burst(at, colours, { count = 40, speed = 4.2, lifetime = 0.9 } = {}) {
      for (let n = 0; n < count; n++) {
        // Uniform direction on a sphere.
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const hot = n % 6 === 0;
        const v = speed * (hot ? 1.6 : 0.4 + Math.random() * 0.8);
        tmp.set(hot ? 0xfff2d0 : colours[n % colours.length]);
        spawn(at, tmp, s * Math.cos(th) * v, u * v, s * Math.sin(th) * v,
          lifetime * (hot ? 0.5 : 0.6 + Math.random() * 0.6), 3.2, hot ? 2.2 : 1.4);
      }
    },

    /** One puff of exhaust or shot-tail, left where the emitter was. */
    trail(at, colour, { lifetime = 0.32, gain = 0.5, jitter = 0.05 } = {}) {
      tmp.set(colour);
      spawn(at, tmp,
        (Math.random() * 2 - 1) * jitter, (Math.random() * 2 - 1) * jitter, (Math.random() * 2 - 1) * jitter,
        lifetime, 0, gain);
    },

    update(dt) {
      for (let i = 0; i < MAX; i++) {
        const j = i * 3;
        if (life[i] <= 0) continue;
        age[i] += dt;
        if (age[i] >= life[i]) {
          life[i] = 0;
          col[j] = col[j + 1] = col[j + 2] = 0;
          continue;
        }
        const k = Math.max(0, 1 - drag[i] * dt);
        vel[j] *= k;
        vel[j + 1] *= k;
        vel[j + 2] *= k;
        pos[j] += vel[j] * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += vel[j + 2] * dt;
        // Quadratic fade: full brightness through most of the flight, then gone.
        const f = age[i] / life[i];
        const fade = 1 - f * f;
        col[j] = base[j] * fade;
        col[j + 1] = base[j + 1] * fade;
        col[j + 2] = base[j + 2] * fade;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

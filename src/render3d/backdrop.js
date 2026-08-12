// The space background: a nebula shell, a fixed starfield with a proper
// magnitude distribution, a few blooming hero stars, and a near field of dust
// that streams past the canopy.
//
// The near field is doing the same job the arcade game's scrolling starfield
// did — it is the only thing on screen that tells you the ship is moving. The
// distant layers can't, because at that radius nothing parallaxes.
import * as THREE from 'three';
import { nebulaSkyTexture, starTexture, starFlareTexture } from './textures.js';

const SKY_R = 900;

// Near field: a box of dust the camera sits inside, recycled front to back.
const DRIFT_COUNT = 900;
const DRIFT_HALF = 46; // half-extent of the box, in world units
const DRIFT_SPEED = 26; // world units per second, toward the camera

function skyPoint(yawDeg, pitchDeg, r = SKY_R) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(pitch) * Math.sin(yaw) * r,
    Math.sin(pitch) * r,
    Math.cos(pitch) * Math.cos(yaw) * r,
  );
}

function starLayer(rig, count, size, opacity, dimRange, brightChance) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Rejection-free uniform direction: cos(lat) drawn flat, so stars don't
    // bunch at the poles the way naive lat/lon sampling makes them.
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = SKY_R * 0.94;
    pos[i * 3] = s * Math.cos(th) * r;
    pos[i * 3 + 1] = u * r;
    pos[i * 3 + 2] = s * Math.sin(th) * r;

    // The bright tail is pushed above 1.0 on purpose, so a handful of stars
    // clear the bloom threshold and the field has punctuation in it.
    const bright = Math.random() < brightChance
      ? 1.15 + Math.random() * 1.5
      : dimRange[0] + Math.random() * (dimRange[1] - dimRange[0]);
    // Stellar colour runs blue-white through white to amber, never through
    // green — so hue comes from two clusters, not one band.
    const warm = Math.random() < 0.34;
    c.setHSL(
      warm ? 0.07 + Math.random() * 0.05 : 0.57 + Math.random() * 0.07,
      warm ? 0.38 + Math.random() * 0.30 : 0.28 + Math.random() * 0.32,
      0.62,
    );
    col[i * 3] = c.r * bright;
    col[i * 3 + 1] = c.g * bright;
    col[i * 3 + 2] = c.b * bright;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: starTexture(),
    size,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  pts.renderOrder = -999;
  pts.frustumCulled = false;
  rig.add(pts);
}

export function buildBackdrop(scene, renderer) {
  // The sky rig is re-centred on the camera every frame, so the shell can never
  // be flown out of and the distant stars never parallax.
  const rig = new THREE.Group();
  rig.renderOrder = -1000;
  scene.add(rig);

  // ---- Nebula shell ---------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_R, 64, 48),
    new THREE.MeshBasicMaterial({
      map: nebulaSkyTexture(renderer),
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  sky.renderOrder = -1000;
  rig.add(sky);

  // ---- Resolved stars -------------------------------------------------------
  // A magnitude distribution, not two discrete populations: counts fall off
  // steeply as size grows, the way a real field does.
  starLayer(rig, 4200, 1.2, 0.55, [0.18, 0.42], 0.02);
  starLayer(rig, 1800, 1.9, 0.70, [0.28, 0.55], 0.04);
  starLayer(rig, 800, 2.8, 0.85, [0.40, 0.70], 0.08);
  starLayer(rig, 260, 4.2, 1.00, [0.55, 0.85], 0.16);
  starLayer(rig, 70, 6.5, 1.00, [0.70, 1.00], 0.30);

  // ---- Hero stars -----------------------------------------------------------
  // A few spiked, blooming stars give the sky a focal point. The first sits on
  // the axis of the shader's blue emission lobe, so the brightest star falls
  // inside the glowing core rather than stranded on black.
  const flare = starFlareTexture();
  const heroes = [
    { at: [11, 16], size: 300, opacity: 0.95, color: 0xdff0ff },
    { at: [-172, 8], size: 190, opacity: 0.72, color: 0xcfe4ff },
    { at: [156, -18], size: 150, opacity: 0.58, color: 0xffe8cf },
    { at: [-42, -30], size: 125, opacity: 0.48, color: 0xd8e8ff },
  ];
  for (const h of heroes) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flare,
      color: h.color,
      opacity: h.opacity,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }));
    sprite.position.copy(skyPoint(h.at[0], h.at[1], SKY_R * 0.9));
    sprite.scale.setScalar(h.size);
    sprite.renderOrder = -998;
    rig.add(sprite);
  }

  // ---- Near dust ------------------------------------------------------------
  // Lives in world space, not on the rig: this layer is supposed to parallax.
  const driftGeo = new THREE.BufferGeometry();
  const drift = new Float32Array(DRIFT_COUNT * 3);
  const driftCol = new Float32Array(DRIFT_COUNT * 3);
  const dc = new THREE.Color();
  for (let i = 0; i < DRIFT_COUNT; i++) {
    drift[i * 3] = (Math.random() * 2 - 1) * DRIFT_HALF;
    drift[i * 3 + 1] = (Math.random() * 2 - 1) * DRIFT_HALF;
    drift[i * 3 + 2] = Math.random() * DRIFT_HALF * 2;
    dc.setHSL(0.55 + Math.random() * 0.12, 0.35, 0.55 + Math.random() * 0.3);
    driftCol[i * 3] = dc.r;
    driftCol[i * 3 + 1] = dc.g;
    driftCol[i * 3 + 2] = dc.b;
  }
  driftGeo.setAttribute('position', new THREE.BufferAttribute(drift, 3));
  driftGeo.setAttribute('color', new THREE.BufferAttribute(driftCol, 3));
  const driftPts = new THREE.Points(driftGeo, new THREE.PointsMaterial({
    map: starTexture(),
    size: 0.16,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  driftPts.frustumCulled = false;
  scene.add(driftPts);

  return {
    /**
     * @param eye  camera world position — the sky follows it, the dust box is
     *             recycled around it.
     * @param moving  false on the title screen, where the arcade starfield
     *                also stopped scrolling.
     */
    update(dt, eye, moving = true) {
      rig.position.copy(eye);

      const arr = driftGeo.attributes.position.array;
      const step = moving ? DRIFT_SPEED * dt : 0;
      for (let i = 0; i < DRIFT_COUNT; i++) {
        const zi = i * 3 + 2;
        arr[zi] -= step;
        // Recycle anything that has fallen behind the eye, or drifted out of
        // the box laterally because the ship slid sideways.
        if (arr[zi] < eye.z - DRIFT_HALF * 0.4) {
          arr[zi] = eye.z + DRIFT_HALF * 1.6;
          arr[i * 3] = eye.x + (Math.random() * 2 - 1) * DRIFT_HALF;
          arr[i * 3 + 1] = eye.y + (Math.random() * 2 - 1) * DRIFT_HALF;
        } else if (Math.abs(arr[i * 3] - eye.x) > DRIFT_HALF) {
          arr[i * 3] = eye.x + (Math.random() * 2 - 1) * DRIFT_HALF;
        }
      }
      driftGeo.attributes.position.needsUpdate = true;
    },
  };
}

// Airframe skin for the Viper.
//
// Without it the hull reads as spotless CG white, where the reference miniature
// is a painted model with panel seams, soot around the intakes and dirt
// collecting along every joint. That cleanliness was the last thing separating
// the render from the photo.
//
// Everything here is tileable — panel lines sit at fixed coordinates and blots
// are redrawn across each wrap edge — so the maps repeat over the fuselage
// without a visible seam.
import * as THREE from 'three';

const N = 512;

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  return c;
}

/** Draw fn at every wrapped offset so blots straddling an edge stay seamless. */
function wrapped(ctx, x, y, draw) {
  for (const dx of [-N, 0, N]) {
    for (const dy of [-N, 0, N]) draw(x + dx, y + dy);
  }
}

/** Deterministic PRNG — the skin must be identical every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function softBlot(ctx, x, y, r, colour, squash = 1) {
  wrapped(ctx, x, y, (px, py) => {
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1, squash);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// Panel joins. Mostly circumferential: on a body of revolution the axial seams
// follow the UV wrap and read as barrel staves, so there are only two of them
// and they sit off-centre. A dense grid in both axes reads as graph paper.
//
// (In this mapping X runs around the circumference and Y along the body, so
// SEAMS_X are the axial lines and SEAMS_Y the rings.)
const SEAMS_X = [0, 205];
const SEAMS_Y = [0, 118, 232, 349, 430];

function drawSeams(ctx, colour, width) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  for (const x of SEAMS_X) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, N); ctx.stroke();
  }
  for (const y of SEAMS_Y) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(N, y + 0.5); ctx.stroke();
  }
}

/** Sobel-derive a tangent-space normal map so seams catch light, not just ink. */
function normalFrom(height, strength) {
  const out = canvas();
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(N, N);
  const at = (x, y) => height[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

let _cached = null;

/**
 * @returns {{ map, normalMap, roughnessMap }} shared maps for the painted hull.
 *
 * The albedo is kept near white — the material's own colour supplies the paint
 * hue, so the same skin can dress the lighter and darker hull materials without
 * two sets of textures.
 */
export function viperSkin() {
  if (_cached) return _cached;

  const albedo = canvas();
  const a = albedo.getContext('2d');
  const rough = canvas();
  const r = rough.getContext('2d');
  const hgt = canvas();
  const h = hgt.getContext('2d');

  a.fillStyle = '#f4f2ec'; a.fillRect(0, 0, N, N);
  r.fillStyle = '#b4b4b4'; r.fillRect(0, 0, N, N);
  h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);

  // Faint plate-to-plate tonal variation: painted panels never match exactly.
  const rnd = rng(0x5eed);
  for (let i = 0; i < SEAMS_X.length - 1; i++) {
    for (let j = 0; j < SEAMS_Y.length - 1; j++) {
      const shade = 0.97 + rnd() * 0.05;
      a.fillStyle = `rgba(${shade > 1 ? 255 : 232},${shade > 1 ? 255 : 230},${shade > 1 ? 252 : 222},0.4)`;
      a.fillRect(SEAMS_X[i], SEAMS_Y[j],
        SEAMS_X[i + 1] - SEAMS_X[i], SEAMS_Y[j + 1] - SEAMS_Y[j]);
    }
  }

  // Grime gathering along the seams, then the seam ink itself on top.
  a.save();
  a.globalAlpha = 0.4;
  drawSeams(a, 'rgba(96,92,82,0.4)', 9);
  a.restore();
  drawSeams(a, 'rgba(78,75,68,0.5)', 1.8);
  drawSeams(h, '#6a6a6a', 2.4);
  drawSeams(r, 'rgba(255,255,255,0.25)', 5);

  // Dirt patches and weathering streaks. Streaks run one way so they read as
  // airflow-driven staining rather than random noise.
  // Half the blots are anchored to a seam: grime concentrates where panels
  // meet, and evenly scattered stains read as noise rather than as dirt.
  for (let i = 0; i < 34; i++) {
    const onSeam = i % 2 === 0;
    const x = onSeam ? SEAMS_X[i % SEAMS_X.length] + (rnd() - 0.5) * 40 : rnd() * N;
    const y = onSeam ? SEAMS_Y[i % SEAMS_Y.length] + (rnd() - 0.5) * 30 : rnd() * N;
    softBlot(a, x, y, 24 + rnd() * 58,
      `rgba(74,70,61,${0.3 + rnd() * 0.3})`, 0.5 + rnd() * 0.7);
  }
  for (let i = 0; i < 54; i++) {
    const x = rnd() * N;
    const y = SEAMS_Y[i % SEAMS_Y.length] + rnd() * 20;
    const len = 30 + rnd() * 120;
    a.strokeStyle = `rgba(78,74,65,${0.16 + rnd() * 0.22})`;
    a.lineWidth = 1 + rnd() * 4;
    wrapped(a, x, y, (px, py) => {
      a.beginPath();
      a.moveTo(px, py);
      a.lineTo(px + (rnd() - 0.5) * 6, py + len);
      a.stroke();
    });
  }
  // Matching roughness break-up: dirty paint scatters more than clean paint.
  for (let i = 0; i < 26; i++) {
    softBlot(r, rnd() * N, rnd() * N, 30 + rnd() * 60,
      `rgba(255,255,255,${0.16 + rnd() * 0.2})`, 0.6 + rnd() * 0.7);
  }

  // Countersunk fasteners along the seams.
  for (const x of SEAMS_X) {
    for (const y of SEAMS_Y) {
      for (let k = 1; k < 4; k++) {
        const fx = x + ((SEAMS_X[SEAMS_X.indexOf(x) + 1] ?? N) - x) * (k / 4);
        softBlot(a, fx, y, 2.6, 'rgba(88,85,77,0.5)');
        softBlot(h, fx, y, 2.6, 'rgba(70,70,70,0.9)');
      }
    }
  }

  const height = (() => {
    const src = h.getImageData(0, 0, N, N).data;
    const out = new Float32Array(N * N);
    for (let i = 0; i < out.length; i++) out[i] = src[i * 4] / 255;
    return out;
  })();

  const colour = new THREE.CanvasTexture(albedo);
  colour.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(normalFrom(height, 5.5));
  const roughness = new THREE.CanvasTexture(rough);
  for (const t of [colour, normal, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 16;
    t.repeat.set(1, 1);
  }

  _cached = { map: colour, normalMap: normal, roughnessMap: roughness };
  return _cached;
}

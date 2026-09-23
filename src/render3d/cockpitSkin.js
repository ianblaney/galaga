// Surfaces for the cockpit: what makes the frame read as machined alloy, the
// panel as textured paint, the grips as moulded rubber, and the instruments as
// displays sitting behind a sheet of glass.
//
// The old cockpit was flat colour on MeshStandardMaterial with metalness turned
// up and nothing in the scene to reflect. That combination cannot look like
// metal — metalness with no environment has no specular source, so a "metal"
// surface resolves to near-black and the only shading left is the broad diffuse
// falloff of a lambert, which is exactly what plastic looks like. Two things
// fix it and both are here: an environment for the metals to reflect, and
// micro-surface detail so the reflection breaks up instead of sitting flat.
//
// Everything is procedural and memoised, same rule as the rest of the renderer:
// no image assets, built once at load, shared by every material that wants it.
import * as THREE from 'three';

const N = 256;

function canvas(w = N, h = N) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Deterministic PRNG — the cockpit must be identical every run. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Draw at every wrapped offset, so marks straddling an edge stay seamless. */
function wrapped(ctx, x, y, draw) {
  for (const dx of [-N, 0, N]) {
    for (const dy of [-N, 0, N]) draw(x + dx, y + dy);
  }
}

/**
 * Sobel-derive a tangent-space normal map from a greyscale height canvas.
 *
 * Lifted in spirit from viperSkin.js, but kept separate: that one is welded to
 * its own 512px hull maps, and the cockpit's tiles are a quarter the size
 * because they are seen from thirty centimetres and never need the resolution.
 *
 * Any canvas size, and `wrap` off for a map that is clamped to one part rather
 * than tiled — a panel fascia sampled with wrap on picks its left edge up
 * along its right one and hangs a bright seam down the outboard end.
 */
export function normalMapFrom(heightCanvas, strength, wrap = true) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const clamp = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  const at = wrap
    ? (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255
    : (x, y) => src[(clamp(y, h - 1) * w + clamp(x, w - 1)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const normalFrom = (heightCanvas, strength) => normalMapFrom(heightCanvas, strength);

function tile(c, { srgb = false, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

// ---- Environment -----------------------------------------------------------

let _env = null;
let _envSrc = null;

/**
 * The environment the cockpit metals reflect.
 *
 * A cockpit in space sees almost nothing: a dark sky with a couple of hard
 * lights in it, and its own glowing instruments underneath. That is a hostile
 * environment to light metal in, and also the whole reason it works — metal
 * lit by a mostly-black surround stays dark (which this panel has to, or it
 * competes with the ships) while still throwing the sharp, high-contrast
 * highlights that nothing else throws. A dome of uniform grey would light the
 * frame evenly and put us straight back to plastic.
 *
 * Equirectangular, then run through PMREM so roughness actually blurs the
 * reflection instead of just picking a mip.
 *
 * @param renderer  optional. With one, the map is PMREM-baked here and comes
 *                  back ready to use. Without — which is the case for anything
 *                  built from inside the cockpit, where no renderer is handed
 *                  down — the raw equirectangular texture is returned instead;
 *                  three's cube-UV cache PMREMs it on first use and caches the
 *                  result, so it costs the same and only defers the bake.
 */
export function cockpitEnv(renderer) {
  if (_env) return _env;
  if (_envSrc && !renderer) return _envSrc;

  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');

  // Deep space floor. Not pure black: a surface reflecting literal zero has no
  // gradient across it at all and goes back to reading as flat paint.
  g.fillStyle = '#05070d';
  g.fillRect(0, 0, W, H);

  const blob = (x, y, r, colour, squash = 1) => {
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grd.addColorStop(0, colour);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.translate(x, y);
    g.scale(1, squash);
    g.fillStyle = grd;
    g.fillRect(-r, -r / squash, r * 2, (r * 2) / squash);
    g.restore();
  };

  g.globalCompositeOperation = 'lighter';

  // Nebula wash across the upper sky, keyed to the same colours the backdrop
  // paints, so a reflection in the coaming belongs to the sky behind it.
  blob(W * 0.30, H * 0.24, 190, 'rgba(26,44,96,0.85)', 0.7);
  blob(W * 0.74, H * 0.30, 170, 'rgba(78,20,64,0.75)', 0.8);
  blob(W * 0.05, H * 0.34, 150, 'rgba(14,60,80,0.6)', 0.9);

  // The key. Small and very bright — this is the one that puts a hard glint on
  // an edge, and a hard glint on an edge is most of what says "metal".
  blob(W * 0.36, H * 0.16, 96, 'rgba(120,160,235,0.55)');
  blob(W * 0.36, H * 0.16, 26, 'rgba(235,244,255,1)');
  // The warm rim, opposite and much weaker, so the two sides of a round part
  // resolve to different colours instead of the same grey.
  blob(W * 0.82, H * 0.42, 88, 'rgba(120,52,34,0.8)');
  blob(W * 0.82, H * 0.42, 20, 'rgba(255,150,110,0.9)');

  // Below the horizon is the cockpit itself: the instruments' green wash and
  // the panel lamp's cold blue, bounced up onto the underside of everything.
  blob(W * 0.42, H * 0.78, 220, 'rgba(10,52,36,0.9)', 0.5);
  blob(W * 0.62, H * 0.72, 150, 'rgba(16,26,56,0.9)', 0.5);

  g.globalCompositeOperation = 'source-over';

  // A horizon: the sky/interior split. Brushed metal reads as brushed because
  // its streaks smear this boundary along the grain, so there has to be a
  // boundary to smear.
  const hz = g.createLinearGradient(0, H * 0.44, 0, H * 0.60);
  hz.addColorStop(0, 'rgba(0,0,0,0)');
  hz.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = hz;
  g.fillRect(0, H * 0.44, W, H * 0.17);

  const src = new THREE.CanvasTexture(c);
  src.mapping = THREE.EquirectangularReflectionMapping;
  src.colorSpace = THREE.SRGBColorSpace;
  _envSrc = src;
  if (!renderer) return _envSrc;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  _env = pmrem.fromEquirectangular(src).texture;
  pmrem.dispose();
  src.dispose();
  _envSrc = null; // handed to nobody: it has just been disposed
  return _env;
}

// ---- Machined alloy --------------------------------------------------------

let _metal = null;

/**
 * Brushed structural alloy for the canopy frame, the coaming and the rails.
 *
 * The grain runs one way on purpose. Circular or isotropic noise gives a
 * surface that scintillates the same in every direction, which reads as glitter
 * rather than as metal; parallel strokes make the highlight stretch across the
 * grain the way a real brushed part does. On the frame's long members the UVs
 * stretch the grain along the run, which is the direction a machined extrusion
 * would be brushed in anyway.
 *
 * Albedo is left near-white — the material's own colour supplies the alloy tint,
 * so the same maps dress the bright column and the dark bezels.
 */
export function brushedMetal() {
  if (_metal) return _metal;

  const albedo = canvas();
  const a = albedo.getContext('2d');
  const rough = canvas();
  const r = rough.getContext('2d');
  const hgt = canvas();
  const h = hgt.getContext('2d');
  const rnd = rng(0x4d37);

  a.fillStyle = '#e8ebef'; a.fillRect(0, 0, N, N);
  // Mid-grey base roughness: satin, not mirror. A frame at mirror roughness
  // reflects the sky as a recognisable picture and reads as chrome tat.
  r.fillStyle = '#6e6e6e'; r.fillRect(0, 0, N, N);
  h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);

  // The brush. Long, thin, low-contrast strokes in both the height and the
  // roughness — a scratch that only changes colour is a decal, a scratch that
  // changes roughness catches the light differently and is a scratch.
  for (let i = 0; i < 900; i++) {
    const y = rnd() * N;
    const x = rnd() * N;
    const len = 40 + rnd() * 190;
    const w = 0.4 + rnd() * 1.4;
    const v = rnd();
    r.strokeStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${0.05 + rnd() * 0.14})`;
    h.strokeStyle = `rgba(${v > 0.5 ? 190 : 110},${v > 0.5 ? 190 : 110},${v > 0.5 ? 190 : 110},0.5)`;
    r.lineWidth = w;
    h.lineWidth = w;
    // Drift is fixed per stroke, not per wrapped copy: a stroke that lands at a
    // different angle on each side of the seam tears the tile open.
    const drift = (rnd() - 0.5) * 2;
    for (const ctx of [r, h]) {
      wrapped(ctx, x, y, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + len, py + drift); ctx.stroke();
      });
    }
  }

  // Plate joins across the grain, with the countersunk fasteners that go with
  // them. Structure, so the frame reads as fabricated rather than extruded in
  // one piece.
  for (const x of [58, 168]) {
    h.strokeStyle = '#4a4a4a';
    h.lineWidth = 2.5;
    h.beginPath(); h.moveTo(x + 0.5, 0); h.lineTo(x + 0.5, N); h.stroke();
    a.strokeStyle = 'rgba(96,102,110,0.45)';
    a.lineWidth = 1.6;
    a.beginPath(); a.moveTo(x + 0.5, 0); a.lineTo(x + 0.5, N); a.stroke();
    r.strokeStyle = 'rgba(255,255,255,0.28)';
    r.lineWidth = 4;
    r.beginPath(); r.moveTo(x + 0.5, 0); r.lineTo(x + 0.5, N); r.stroke();
    for (let k = 0; k < 7; k++) {
      const y = 18 + k * 36;
      const dot = (ctx, colour, rad) => wrapped(ctx, x, y, (px, py) => {
        const grd = ctx.createRadialGradient(px, py, 0, px, py, rad);
        grd.addColorStop(0, colour);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
      });
      dot(h, 'rgba(56,56,56,0.95)', 3.2);
      dot(a, 'rgba(104,110,118,0.55)', 3.0);
      dot(r, 'rgba(255,255,255,0.4)', 3.4);
    }
  }

  // Patchy oxidation: broad, soft roughness drift so the highlight is not the
  // same width the whole way along a member.
  for (let i = 0; i < 22; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const rad = 26 + rnd() * 62;
    const alpha = 0.1 + rnd() * 0.14;
    wrapped(r, x, y, (px, py) => {
      const grd = r.createRadialGradient(px, py, 0, px, py, rad);
      grd.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      r.fillStyle = grd;
      r.beginPath(); r.arc(px, py, rad, 0, Math.PI * 2); r.fill();
    });
  }

  _metal = {
    map: tile(albedo, { srgb: true }),
    normalMap: tile(normalFrom(hgt, 2.2)),
    roughnessMap: tile(rough),
  };
  return _metal;
}

// ---- Textured paint --------------------------------------------------------

let _paint = null;

/**
 * The instrument panel and side consoles: metal under a thick matte finish.
 *
 * Kept deliberately duller than the frame. The contrast between the two is what
 * carries the read — a panel that is also shiny gives the eye no way to tell
 * structure from surface, and everything collapses back into one moulded lump.
 */
export function panelPaint() {
  if (_paint) return _paint;

  const albedo = canvas();
  const a = albedo.getContext('2d');
  const rough = canvas();
  const r = rough.getContext('2d');
  const hgt = canvas();
  const h = hgt.getContext('2d');
  const rnd = rng(0x9a11);

  a.fillStyle = '#f2f4f6'; a.fillRect(0, 0, N, N);
  r.fillStyle = '#d2d2d2'; r.fillRect(0, 0, N, N);
  h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);

  // Orange-peel: the fine stipple a sprayed finish always has. Dense and low
  // amplitude — it never reads as a pattern, it just stops the surface being
  // mathematically flat, which is the tell that made it look moulded.
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const rad = 0.7 + rnd() * 2.4;
    const up = rnd() > 0.5;
    h.fillStyle = up ? 'rgba(160,160,160,0.55)' : 'rgba(96,96,96,0.55)';
    h.beginPath(); h.arc(x, y, rad, 0, Math.PI * 2); h.fill();
  }

  // Broad tonal drift and matching roughness drift: paint sprayed by hand is
  // never one thickness, and where it is thin it sits duller.
  for (let i = 0; i < 30; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const rad = 30 + rnd() * 80;
    const dark = rnd() > 0.45;
    const tint = dark
      ? `rgba(126,132,142,${(0.1 + rnd() * 0.16).toFixed(3)})`
      : `rgba(255,255,255,${(0.08 + rnd() * 0.12).toFixed(3)})`;
    wrapped(a, x, y, (px, py) => {
      const grd = a.createRadialGradient(px, py, 0, px, py, rad);
      grd.addColorStop(0, tint);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      a.fillStyle = grd;
      a.beginPath(); a.arc(px, py, rad, 0, Math.PI * 2); a.fill();
    });
    wrapped(r, x, y, (px, py) => {
      const grd = r.createRadialGradient(px, py, 0, px, py, rad);
      grd.addColorStop(0, `rgba(${dark ? 255 : 0},${dark ? 255 : 0},${dark ? 255 : 0},0.14)`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      r.fillStyle = grd;
      r.beginPath(); r.arc(px, py, rad, 0, Math.PI * 2); r.fill();
    });
  }

  // Wear on the raised edges: paint rubbed back to the metal beneath, which is
  // brighter and much smoother than the finish over it.
  for (let i = 0; i < 40; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const len = 6 + rnd() * 26;
    a.strokeStyle = `rgba(255,255,255,${0.2 + rnd() * 0.3})`;
    a.lineWidth = 0.7 + rnd() * 1.3;
    r.strokeStyle = `rgba(0,0,0,${0.25 + rnd() * 0.3})`;
    r.lineWidth = a.lineWidth;
    const ang = rnd() * Math.PI * 2;
    const draw = (ctx) => wrapped(ctx, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    });
    draw(a);
    draw(r);
  }

  _paint = {
    map: tile(albedo, { srgb: true }),
    normalMap: tile(normalFrom(hgt, 1.4)),
    roughnessMap: tile(rough),
  };
  return _paint;
}

// ---- Moulded rubber --------------------------------------------------------

let _rubber = null;

/**
 * Grips, boots and knobs: pebbled elastomer.
 *
 * Rubber and plastic have nearly the same PBR numbers, so the only thing that
 * separates them at a glance is the surface. A pebble grain scatters the one
 * highlight a smooth part would carry into hundreds of tiny ones, and the part
 * stops looking injection-moulded.
 */
export function mouldedRubber() {
  if (_rubber) return _rubber;

  const rough = canvas();
  const r = rough.getContext('2d');
  const hgt = canvas();
  const h = hgt.getContext('2d');
  const rnd = rng(0x21bb);

  r.fillStyle = '#e6e6e6'; r.fillRect(0, 0, N, N);
  h.fillStyle = '#707070'; h.fillRect(0, 0, N, N);

  // Pebbles, packed on a jittered grid so there are no bald patches and no
  // visible rows.
  const step = 9;
  for (let gy = 0; gy < N; gy += step) {
    for (let gx = 0; gx < N; gx += step) {
      const x = gx + rnd() * step;
      const y = gy + rnd() * step;
      const rad = 2.6 + rnd() * 2.2;
      wrapped(h, x, y, (px, py) => {
        const grd = h.createRadialGradient(px, py, 0, px, py, rad);
        grd.addColorStop(0, 'rgba(210,210,210,0.9)');
        grd.addColorStop(0.75, 'rgba(150,150,150,0.5)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        h.fillStyle = grd;
        h.beginPath(); h.arc(px, py, rad, 0, Math.PI * 2); h.fill();
      });
      // Crowns wear shiny, valleys stay dull: the sheen of a used grip.
      const crown = `rgba(0,0,0,${(0.16 + rnd() * 0.14).toFixed(3)})`;
      wrapped(r, x, y, (px, py) => {
        r.fillStyle = crown;
        r.beginPath(); r.arc(px, py, rad * 0.55, 0, Math.PI * 2); r.fill();
      });
    }
  }

  _rubber = {
    normalMap: tile(normalFrom(hgt, 3.4)),
    roughnessMap: tile(rough),
  };
  return _rubber;
}

// ---- Screen glass ----------------------------------------------------------

let _glassNormal = null;

/**
 * Very gentle dome for the display cover glass, plus a few wipe smears.
 *
 * The dome is the point. A dead-flat pane reflects one value across its whole
 * face and vanishes; curve it a fraction of a degree and the reflection sweeps
 * across the glass as the ship banks, which is the moment a viewer decides
 * there is a physical sheet in front of the display.
 */
export function glassNormal() {
  if (_glassNormal) return _glassNormal;

  const hgt = canvas();
  const h = hgt.getContext('2d');
  const rnd = rng(0x61a5);

  h.fillStyle = '#404040'; h.fillRect(0, 0, N, N);
  // The dome. Not wrapped: this map is clamped to one pane, not tiled.
  const dome = h.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.72);
  dome.addColorStop(0, 'rgba(255,255,255,1)');
  dome.addColorStop(0.6, 'rgba(190,190,190,1)');
  dome.addColorStop(1, 'rgba(64,64,64,1)');
  h.fillStyle = dome;
  h.fillRect(0, 0, N, N);

  // Wipe smears, arcs left by a glove. Faint enough to be a texture rather
  // than a picture of dirt.
  for (let i = 0; i < 5; i++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const rad = 40 + rnd() * 70;
    h.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.06})`;
    h.lineWidth = 5 + rnd() * 9;
    const from = rnd() * Math.PI * 2;
    h.beginPath();
    h.arc(cx, cy, rad, from, from + 0.8 + rnd() * 1.2);
    h.stroke();
  }

  const t = new THREE.CanvasTexture(normalFrom(hgt, 0.55));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  _glassNormal = t;
  return _glassNormal;
}

let _sheen = null;

/**
 * The baked reflection on the cover glass: the hard diagonal band you get off
 * the canopy, a soft bloom in one corner, and dust.
 *
 * Drawn rather than computed because the eye never moves relative to the panel,
 * so the largest reflection on these screens is a fixed shape — and a painted
 * one can be given the streaked, dusty character a two-light scene will never
 * produce on its own. It goes on additively, which is also what a reflection
 * physically does: the display's light passes through the glass and the
 * reflection is added on top of it.
 */
export function glassSheen() {
  if (_sheen) return _sheen;

  const W = 256;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = rng(0x5ee7);

  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';

  // The band, running corner to corner. Built on its own canvas so the taper
  // along its length can be masked in without eating what is already drawn.
  const bandC = canvas(W, H);
  const b = bandC.getContext('2d');
  b.translate(W / 2, H / 2);
  b.rotate(-0.62);
  b.globalCompositeOperation = 'lighter';
  // Three widths stacked: a hard core inside a soft falloff, rather than one
  // flat stripe, which is what a real specular streak looks like.
  for (const [w, alpha] of [[86, 0.10], [30, 0.14], [9, 0.26]]) {
    const grd = b.createLinearGradient(0, -w, 0, w);
    grd.addColorStop(0, 'rgba(150,190,255,0)');
    grd.addColorStop(0.5, `rgba(190,215,255,${alpha})`);
    grd.addColorStop(1, 'rgba(150,190,255,0)');
    b.fillStyle = grd;
    b.fillRect(-W, -w, W * 2, w * 2);
  }
  // Taper along the run, so it reads as the reflection of something rather
  // than a stripe painted bezel to bezel.
  b.globalCompositeOperation = 'destination-in';
  const fade = b.createLinearGradient(-W * 0.7, 0, W * 0.7, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.30, 'rgba(0,0,0,1)');
  fade.addColorStop(0.75, 'rgba(0,0,0,0.4)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  b.fillStyle = fade;
  b.fillRect(-W, -H, W * 2, H * 2);
  g.drawImage(bandC, 0, 0);

  // Corner bloom: the cockpit lamp, caught wide and soft.
  const bloom = g.createRadialGradient(W * 0.80, H * 0.18, 0, W * 0.80, H * 0.18, W * 0.55);
  bloom.addColorStop(0, 'rgba(120,150,210,0.20)');
  bloom.addColorStop(0.5, 'rgba(70,100,170,0.06)');
  bloom.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bloom;
  g.fillRect(0, 0, W, H);

  // Dust and a couple of hairline scratches, only visible where the sheen
  // lights them — which is exactly how dust on a screen behaves.
  for (let i = 0; i < 220; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    g.fillStyle = `rgba(200,220,255,${0.04 + rnd() * 0.10})`;
    g.beginPath(); g.arc(x, y, 0.4 + rnd() * 1.1, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 7; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const ang = -0.62 + (rnd() - 0.5) * 1.2;
    const len = 20 + rnd() * 90;
    g.strokeStyle = `rgba(190,215,255,${0.05 + rnd() * 0.07})`;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }

  // Edge rebate: the glass is set into the bezel, so its last couple of
  // millimetres are in shadow and carry no reflection.
  g.globalCompositeOperation = 'destination-in';
  const inset = g.createLinearGradient(0, 0, 0, H);
  inset.addColorStop(0, 'rgba(0,0,0,0)');
  inset.addColorStop(0.06, 'rgba(0,0,0,1)');
  inset.addColorStop(0.94, 'rgba(0,0,0,1)');
  inset.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = inset;
  g.fillRect(0, 0, W, H);
  const insetX = g.createLinearGradient(0, 0, W, 0);
  insetX.addColorStop(0, 'rgba(0,0,0,0)');
  insetX.addColorStop(0.06, 'rgba(0,0,0,1)');
  insetX.addColorStop(0.94, 'rgba(0,0,0,1)');
  insetX.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = insetX;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  _sheen = new THREE.CanvasTexture(c);
  _sheen.colorSpace = THREE.SRGBColorSpace;
  _sheen.wrapS = _sheen.wrapT = THREE.ClampToEdgeWrapping;
  _sheen.anisotropy = 8;
  return _sheen;
}

// ---- Small hardware --------------------------------------------------------

let _knurl = null;

/**
 * The rotary knobs: a fine axial knurl with polished crowns.
 *
 * Knobs are the smallest thing on the panel that still has to read as *turned*
 * rather than as a peg. What sells it is the knurl catching a row of tiny
 * highlights round the rim, which is a normal map job — at this size real
 * geometry for the ribs would cost more than the whole rest of the panel and
 * shimmer into aliasing the moment the ship banks.
 *
 * Laid out for CylinderGeometry's UVs: u runs around the barrel, v along it,
 * and the caps take the same map, where the ribs land as a milled star that
 * happens to look exactly like the grip pattern on a real knob top.
 */
export function knurledMetal() {
  if (_knurl) return _knurl;

  const S = 128;
  const hgt = canvas(S, S);
  const h = hgt.getContext('2d');
  const rough = canvas(S, S);
  const r = rough.getContext('2d');

  h.fillStyle = '#7a7a7a'; h.fillRect(0, 0, S, S);
  r.fillStyle = '#787878'; r.fillRect(0, 0, S, S);

  // The ribs. An even count so the tile still meets itself round the barrel.
  const ribs = 32;
  const step = S / ribs;
  for (let i = 0; i < ribs; i++) {
    const x = i * step;
    const g = h.createLinearGradient(x, 0, x + step, 0);
    g.addColorStop(0, '#4e4e4e');
    g.addColorStop(0.5, '#c8c8c8');
    g.addColorStop(1, '#4e4e4e');
    h.fillStyle = g;
    h.fillRect(x, 0, step, S);
    // Crowns polished by thumbs, valleys still matte.
    r.fillStyle = 'rgba(0,0,0,0.35)';
    r.fillRect(x + step / 3, 0, step / 3, S);
  }

  // A plain collar top and bottom, where the knurl runs out.
  for (const y0 of [0, S - 12]) {
    h.fillStyle = '#8c8c8c';
    h.fillRect(0, y0, S, 12);
    r.fillStyle = 'rgba(0,0,0,0.25)';
    r.fillRect(0, y0, S, 12);
  }

  _knurl = {
    normalMap: tile(normalMapFrom(hgt, 2.6)),
    roughnessMap: tile(rough),
  };
  return _knurl;
}

let _fastener = null;

/**
 * A countersunk screw head, for the instanced fasteners along the panel seams.
 *
 * Mapped for the cap of a short cylinder, where three lays the UVs out as a
 * disc centred in the tile: a dished cone with a cross slot in it, and a ring
 * of shadow where the head sits down into its countersink.
 */
export function screwHead() {
  if (_fastener) return _fastener;

  const S = 64;
  const hgt = canvas(S, S);
  const h = hgt.getContext('2d');
  const rough = canvas(S, S);
  const r = rough.getContext('2d');
  const c = S / 2;

  h.fillStyle = '#606060'; h.fillRect(0, 0, S, S);
  r.fillStyle = '#8a8a8a'; r.fillRect(0, 0, S, S);

  // The dish: high at the rim, falling to the middle, so the light runs round
  // the head rather than sitting on it as one flat disc.
  const dish = h.createRadialGradient(c, c, 0, c, c, c);
  dish.addColorStop(0, '#8e8e8e');
  dish.addColorStop(0.62, '#d0d0d0');
  dish.addColorStop(0.86, '#9a9a9a');
  dish.addColorStop(1, '#3a3a3a');
  h.fillStyle = dish;
  h.beginPath(); h.arc(c, c, c, 0, Math.PI * 2); h.fill();

  // Cross slot, cut a little off square so a row of them is not a stencil.
  h.save();
  h.translate(c, c);
  h.rotate(0.22);
  h.fillStyle = '#2c2c2c';
  h.fillRect(-c * 0.62, -2.2, c * 1.24, 4.4);
  h.fillRect(-2.2, -c * 0.62, 4.4, c * 1.24);
  h.restore();

  // Steel is smoother than the paint it is driven through.
  const sm = r.createRadialGradient(c, c, 0, c, c, c);
  sm.addColorStop(0, 'rgba(0,0,0,0.55)');
  sm.addColorStop(0.8, 'rgba(0,0,0,0.45)');
  sm.addColorStop(1, 'rgba(0,0,0,0)');
  r.fillStyle = sm;
  r.fillRect(0, 0, S, S);

  _fastener = {
    normalMap: tile(normalMapFrom(hgt, 2.0, false)),
    roughnessMap: tile(rough),
  };
  return _fastener;
}

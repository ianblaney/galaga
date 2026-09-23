// Everything on the instrument panel that is not structure: instrument faces,
// switch banks, breakers, placards, fasteners, bezels, knobs.
//
// Split out of cockpit.js so the panel's detail and the canopy's framing can be
// worked on independently. cockpit.js owns the *shape* of the cockpit — where
// the coaming sits, where the pillars are, how much glass there is. This owns
// what is bolted to the panel underneath that line.
//
// The toolkit handed in is cockpit.js's own layout machinery, so anything built
// here is placed by the angle it subtends from the eye and gets re-placed for
// free when the frame changes.
//
// ---------------------------------------------------------------------------
// How this is put together, and why it is not two hundred little boxes.
//
// A panel reads as expensive when it has three things at once: *density* (there
// is always something smaller to look at), *layering* (sub-panels stand off the
// fascia, bezels stand off the sub-panels, switchgear stands off the bezels)
// and *material zones* (paint, machined alloy, dark glass and rubber all catch
// the light differently). Modelling each of those as its own mesh would cost
// hundreds of draw calls for parts that are four pixels across.
//
// So the split here is: silhouette is geometry, everything else is texture.
//
//   - One fascia sheet, a single mesh whose top edge is read back off the
//     panel's own vertices so it hugs the coaming however cockpit.js bends it.
//   - One merged plate mesh: every raised sub-panel, rim and bezel member in
//     the cockpit, in one buffer, UV-mapped into a shared atlas. One draw call
//     for the whole layered structure.
//   - One instanced mesh per kind of hardware — screws, breakers, rockers,
//     knobs, lamps — so a hundred and fifty fasteners cost one call.
//   - One live canvas for everything that glows, so the gauges, the radio head
//     and the annunciator legends are a single texture upload on a timer.
//
// Surfaces come from cockpitSkin.js, which had all of this in it already and
// was wired to nothing. The maps here are packed the way a modern engine packs
// them — ambient occlusion in red, roughness in green, metalness in blue, one
// texture doing three jobs — which is what lets a single material carry both
// matte paint and machined alloy inside the same plate.
import * as THREE from 'three';
import {
  brushedMetal, cockpitEnv, glassSheen, knurledMetal, mouldedRubber,
  normalMapFrom, panelPaint, rng, screwHead,
} from './cockpitSkin.js';

const DEG = Math.PI / 180;

// The instruments' phosphor, matching the two displays cockpit.js paints.
const GREEN = '#5dffb0';
const AMBER = '#ffb347';
const RED = '#ff5a3c';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Pick a per-channel style: albedo, height, or the packed AO/rough/metal map. */
const P = (ch, a, h, r) => (ch === 'a' ? a : ch === 'h' ? h : r);

/** Packed surface value: ao 0..1, roughness 0..1, metalness 0..1. */
const ORM = (ao, rough, metal) => `rgb(${Math.round(ao * 255)},${Math.round(rough * 255)},${Math.round(metal * 255)})`;

// Surface presets, so a plate can say "this bit is alloy" and mean it.
const S_PAINT = ORM(1, 0.86, 0.06);
const S_ALLOY = ORM(1, 0.34, 0.95);
const S_DARKALLOY = ORM(1, 0.42, 0.85);
const S_GLOSS = ORM(1, 0.16, 0.35);
const S_RUBBER = ORM(1, 0.95, 0.02);

/** Round rect, since not every canvas implementation has roundRect. */
function rr(g, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.lineTo(x + w - k, y);
  g.quadraticCurveTo(x + w, y, x + w, y + k);
  g.lineTo(x + w, y + h - k);
  g.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  g.lineTo(x + k, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - k);
  g.lineTo(x, y + k);
  g.quadraticCurveTo(x, y, x + k, y);
  g.closePath();
}

/**
 * @param kit
 *   group     the cockpit group; add anything you build to it
 *   slabs     the layout registry. push { m, place } where `place` is
 *             (hDeg, vDeg) => (mesh) => void, and it re-runs on every setFrame.
 *   fill      (mesh, d, a0, a1, e0, e1, depth, rake) — fill an angular window
 *   T         (deg) => tan(deg), for hand-rolled placement
 *   mats      { panelMat, trim, rubber, bright } — cockpit.js's shared materials
 *   UNIT      a shared 1x1x1 BoxGeometry
 *   layout    { COAMING, PILLAR, BOW } — the canopy's angular landmarks
 *   makeScreen(w,h) -> { canvas, ctx, tex }
 *   label(ctx, text, x, y, size, color, align)
 *   W, H      arcade playfield dimensions
 * @returns { update(dt, s) }  s is the cockpit state from view3d.js
 */
export function buildPanelDetail(kit) {
  const { group, slabs, T, mats, layout, label } = kit;

  const C = layout.COAMING;
  const PILLAR = layout.PILLAR;

  // The fascia hangs a hair behind the coaming roll and well in front of the
  // raked panel underneath it, which is what leaves room for everything else
  // to stand off it. The displays cockpit.js places live at 0.98, so they come
  // out four centimetres proud of this — they sit *on* the panel rather than
  // floating in front of it, which is the whole reason for picking this number.
  const FD = 1.02;

  // Fall-off of the coaming line out on the beam. Only a starting guess: the
  // real curve is read back off the panel mesh below, because cockpit.js is
  // free to re-shape it and detail that pokes up through the coaming would be
  // detail printed on the sky.
  const DROP = 14;
  let coamAt = (a) => C - DROP * Math.min(1.18, Math.abs(a) / PILLAR) ** 1.7;

  const V = (a, e, d) => new THREE.Vector3(d * T(a), d * T(e), -d);

  // ---- Surfaces -------------------------------------------------------------

  const env = cockpitEnv();

  const paint = panelPaint();
  const metal = brushedMetal();
  const rubberSkin = mouldedRubber();
  const knurl = knurledMetal();
  const screwSkin = screwHead();

  /**
   * Wire cockpitSkin's maps onto the materials cockpit.js shares out.
   *
   * These generators existed and nothing imported them, so the entire cockpit
   * was flat colour with the metalness slider up — which cannot look like metal,
   * because metalness with no environment to reflect resolves to black. Doing it
   * from here costs nothing and lifts the frame, the coaming and the stick along
   * with the panel.
   *
   * Every map is a clone: `repeat` lives on the texture, not the material, so
   * sharing one instance between the pillar (metres long) and a bezel (four
   * centimetres) would force the same grain density on both.
   */
  const repeated = (tex, rx, ry) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return t;
  };
  const dress = (mat, skin, rx, ry, extra = {}) => {
    if (!mat) return;
    if (skin.map) mat.map = repeated(skin.map, rx, ry);
    if (skin.normalMap) mat.normalMap = repeated(skin.normalMap, rx, ry);
    if (skin.roughnessMap) mat.roughnessMap = repeated(skin.roughnessMap, rx, ry);
    mat.envMap = env;
    Object.assign(mat, extra);
    mat.needsUpdate = true;
  };
  dress(mats.panelMat, paint, 7, 7, { envMapIntensity: 0.35, normalScale: new THREE.Vector2(0.9, 0.9) });
  dress(mats.trim, metal, 5, 5, { envMapIntensity: 1.0 });
  dress(mats.rubber, rubberSkin, 4, 4, { envMapIntensity: 0.4 });
  dress(mats.bright, metal, 2, 6, { envMapIntensity: 1.15 });

  // ---- The plate atlas ------------------------------------------------------
  // Every raised sub-panel in the cockpit is a rectangle of this one 1024px
  // sheet, so they all share a material and merge into a single buffer. Cells
  // are sized roughly to the shape of the part that uses them; what stretch is
  // left lands on silkscreen and engraving, where nobody can see it.

  const AT = 1024;
  const CELLS = {};
  const cell = (name, x, y, w, h, draw) => {
    CELLS[name] = { x, y, w, h, draw };
    return CELLS[name];
  };

  /** uv rect for a cell, with v0 at the bottom the way three samples canvases. */
  const uvOf = (name, flip = false) => {
    const c = CELLS[name];
    const u0 = c.x / AT;
    const u1 = (c.x + c.w) / AT;
    const v0 = 1 - (c.y + c.h) / AT;
    const v1 = 1 - c.y / AT;
    return flip ? [u1, v0, u0, v1] : [u0, v0, u1, v1];
  };

  // -- cell painting primitives --

  /** The ground of a machined sub-panel: sprayed finish over a milled plate. */
  function plateGround(g, ch, w, h, tone = 0.0) {
    const r = rng(0x51a3 + Math.round(w * 7 + h));
    g.fillStyle = P(ch,
      tone > 0 ? '#414b59' : '#2c3340',
      '#909090',
      tone > 0 ? S_DARKALLOY : S_PAINT);
    g.fillRect(0, 0, w, h);
    // Orange peel. Never reads as a pattern, only stops the face being
    // mathematically flat — which is the tell that made it look moulded.
    for (let i = 0; i < w * h * 0.05; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 0.6 + r() * 1.8;
      if (ch === 'h') g.fillStyle = r() > 0.5 ? 'rgba(160,160,160,0.45)' : 'rgba(70,70,70,0.45)';
      else if (ch === 'a') g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      else continue;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    // Broad tonal drift: paint sprayed by hand is never one thickness.
    for (let i = 0; i < 8; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = (0.12 + r() * 0.3) * w;
      const up = r() > 0.5;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, P(ch,
        up ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.10)',
        'rgba(128,128,128,0)',
        up ? 'rgba(0,255,0,0.05)' : 'rgba(0,0,0,0.05)'));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }

  /** The milled edge of a plate: a bright chamfer and the shadow it drops. */
  function plateBevel(g, ch, w, h, k = 3) {
    g.lineWidth = k;
    g.strokeStyle = P(ch, 'rgba(150,164,186,0.5)', 'rgba(215,215,215,0.9)', S_ALLOY);
    g.strokeRect(k / 2, k / 2, w - k, h - k);
    g.lineWidth = 1.5;
    g.strokeStyle = P(ch, 'rgba(0,0,0,0.55)', 'rgba(40,40,40,0.9)', 'rgba(150,255,60,0.6)');
    g.strokeRect(k + 1, k + 1, w - 2 * k - 2, h - 2 * k - 2);
  }

  /** A countersunk screw, painted. Real ones are instanced; these fill rows. */
  function screw(g, ch, x, y, rad) {
    if (ch === 'a') {
      const grd = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(186,198,214,0.85)');
      grd.addColorStop(0.7, 'rgba(96,106,120,0.8)');
      grd.addColorStop(1, 'rgba(10,12,16,0.7)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = Math.max(0.6, rad * 0.22);
      g.beginPath();
      g.moveTo(x - rad * 0.6, y - rad * 0.2);
      g.lineTo(x + rad * 0.6, y + rad * 0.2);
      g.stroke();
    } else if (ch === 'h') {
      const grd = g.createRadialGradient(x, y, 0, x, y, rad * 1.25);
      grd.addColorStop(0, 'rgba(190,190,190,1)');
      grd.addColorStop(0.62, 'rgba(150,150,150,1)');
      grd.addColorStop(0.8, 'rgba(46,46,46,1)');
      grd.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad * 1.25, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = S_ALLOY;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** Screws round the border of a cell, the way a sub-panel is actually held on. */
  function screwFrame(g, ch, w, h, inset, rad, nx, ny) {
    for (let i = 0; i < nx; i++) {
      const x = inset + ((w - inset * 2) * i) / (nx - 1);
      screw(g, ch, x, inset, rad);
      screw(g, ch, x, h - inset, rad);
    }
    for (let j = 1; j < ny - 1; j++) {
      const y = inset + ((h - inset * 2) * j) / (ny - 1);
      screw(g, ch, inset, y, rad);
      screw(g, ch, w - inset, y, rad);
    }
  }

  /** Silkscreened legend. Engraved into the height map so it catches an edge. */
  function legend(g, ch, text, x, y, size, align = 'center', colour = 'rgba(196,206,222,0.85)') {
    g.font = `700 ${size}px ui-monospace, Menlo, monospace`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    if (ch === 'a') g.fillStyle = colour;
    else if (ch === 'h') g.fillStyle = 'rgba(60,60,60,0.85)';
    else g.fillStyle = 'rgba(255,150,90,0.5)';
    g.fillText(text, x, y);
  }

  /** A recessed rectangle: switch cutout, display window, breaker pocket. */
  function recess(g, ch, x, y, w, h, rad = 2) {
    if (ch === 'a') {
      g.fillStyle = '#0a0d12';
      rr(g, x, y, w, h, rad);
      g.fill();
      g.strokeStyle = 'rgba(150,164,186,0.35)';
      g.lineWidth = 1;
      rr(g, x - 0.5, y - 0.5, w + 1, h + 1, rad);
      g.stroke();
    } else if (ch === 'h') {
      g.fillStyle = '#3a3a3a';
      rr(g, x, y, w, h, rad);
      g.fill();
      g.strokeStyle = 'rgba(190,190,190,0.8)';
      g.lineWidth = 2;
      rr(g, x - 1, y - 1, w + 2, h + 2, rad);
      g.stroke();
    } else {
      g.fillStyle = ORM(0.45, 0.6, 0.3);
      rr(g, x, y, w, h, rad);
      g.fill();
    }
  }

  /** Louvred vent: real slots, so they shade rather than being printed lines. */
  function grille(g, ch, x, y, w, h, n) {
    const pitch = h / n;
    for (let i = 0; i < n; i++) {
      const yy = y + i * pitch;
      if (ch === 'a') {
        const grd = g.createLinearGradient(0, yy, 0, yy + pitch);
        grd.addColorStop(0, '#05070a');
        grd.addColorStop(0.62, '#0d1117');
        grd.addColorStop(1, '#39414d');
        g.fillStyle = grd;
      } else if (ch === 'h') {
        const grd = g.createLinearGradient(0, yy, 0, yy + pitch);
        grd.addColorStop(0, '#303030');
        grd.addColorStop(0.7, '#585858');
        grd.addColorStop(1, '#c8c8c8');
        g.fillStyle = grd;
      } else {
        g.fillStyle = ORM(0.4, 0.7, 0.5);
      }
      g.fillRect(x, yy, w, pitch * 0.82);
    }
  }

  /** Hazard chevrons: the one place on the panel allowed to be loud. */
  function chevrons(g, ch, x, y, w, h) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = P(ch, '#1a1409', '#8a8a8a', S_PAINT);
    g.fillRect(x, y, w, h);
    for (let i = -h; i < w; i += h * 1.6) {
      g.fillStyle = P(ch, 'rgba(196,132,26,0.85)', 'rgba(150,150,150,0.7)', ORM(1, 0.7, 0.2));
      g.beginPath();
      g.moveTo(x + i, y + h);
      g.lineTo(x + i + h * 0.8, y);
      g.lineTo(x + i + h * 1.4, y);
      g.lineTo(x + i + h * 0.6, y + h);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** A data plate: four lines of type too small to read, which is the point. */
  function dataPlate(g, ch, x, y, w, h, seed) {
    const r = rng(seed);
    g.fillStyle = P(ch, '#4b5361', '#a0a0a0', S_ALLOY);
    rr(g, x, y, w, h, 2);
    g.fill();
    if (ch === 'a') {
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 1;
      rr(g, x, y, w, h, 2);
      g.stroke();
    }
    const lines = 4;
    for (let i = 0; i < lines; i++) {
      const yy = y + h * ((i + 1) / (lines + 1));
      const ww = w * (0.35 + r() * 0.5);
      g.fillStyle = P(ch, 'rgba(18,22,28,0.75)', 'rgba(70,70,70,0.7)', 'rgba(255,200,60,0.3)');
      g.fillRect(x + w * 0.1, yy - h * 0.045, ww, Math.max(1, h * 0.075));
    }
    screw(g, ch, x + 3.5, y + 3.5, 2);
    screw(g, ch, x + w - 3.5, y + h - 3.5, 2);
  }

  // -- the cells --

  cell('rim', 0, 0, 96, 96, (g, ch, w, h) => {
    // Plate edges. Bright along the front lip, falling away to the seat, so a
    // raised sub-panel catches a line of light all the way round.
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, P(ch, '#8d99ac', '#d2d2d2', S_ALLOY));
    grd.addColorStop(0.45, P(ch, '#414b59', '#8a8a8a', S_ALLOY));
    grd.addColorStop(1, P(ch, '#171b22', '#5a5a5a', ORM(0.35, 0.5, 0.8)));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });

  cell('bar', 96, 0, 416, 96, (g, ch, w, h) => {
    // The machined members that make up a display bezel. Brushed along the run,
    // with a rebate down the inboard edge for the glass to sit in.
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, P(ch, '#20252e', '#7a7a7a', S_DARKALLOY));
    grd.addColorStop(0.30, P(ch, '#5c6675', '#d8d8d8', S_ALLOY));
    grd.addColorStop(0.62, P(ch, '#333b47', '#a0a0a0', S_DARKALLOY));
    grd.addColorStop(0.88, P(ch, '#161a21', '#4a4a4a', ORM(0.5, 0.35, 0.9)));
    grd.addColorStop(1, P(ch, '#05070a', '#303030', ORM(0.3, 0.4, 0.6)));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    const r = rng(0x2b71);
    for (let i = 0; i < 260; i++) {
      const y = r() * h;
      g.strokeStyle = P(ch,
        `rgba(255,255,255,${0.02 + r() * 0.05})`,
        `rgba(${r() > 0.5 ? 190 : 90},${r() > 0.5 ? 190 : 90},${r() > 0.5 ? 190 : 90},0.3)`,
        `rgba(0,${r() > 0.5 ? 255 : 0},0,0.05)`);
      g.lineWidth = 0.5 + r();
      g.beginPath();
      g.moveTo(r() * w - 60, y);
      g.lineTo(r() * w + 60, y + (r() - 0.5) * 2);
      g.stroke();
    }
  });

  cell('hazard', 512, 0, 512, 96, (g, ch, w, h) => {
    plateGround(g, ch, w, h);
    chevrons(g, ch, 0, h * 0.28, w, h * 0.44);
    for (let i = 0; i < 9; i++) screw(g, ch, 12 + i * ((w - 24) / 8), h * 0.12, 3);
  });

  cell('annun', 0, 96, 512, 192, (g, ch, w, h) => {
    plateGround(g, ch, w, h, 1);
    plateBevel(g, ch, w, h, 4);
    // Three windows for the master-caution lamps cockpit.js already hangs in
    // front of this plate, so they land in sockets rather than on a flat face.
    const lw = w * 0.19;
    for (let i = 0; i < 3; i++) {
      const x = w * 0.5 + (i - 1) * w * 0.245 - lw / 2;
      recess(g, ch, x, h * 0.20, lw, h * 0.30, 3);
      legend(g, ch, ['L WARN', 'MASTER', 'R WARN'][i], x + lw / 2, h * 0.60, 13);
    }
    legend(g, ch, 'CAUTION', w * 0.5, h * 0.10, 15, 'center', 'rgba(228,176,90,0.9)');
    // The lit legend strip's own socket. The glow quad sits in here.
    recess(g, ch, w * 0.08, h * 0.68, w * 0.84, h * 0.24, 3);
    screwFrame(g, ch, w, h, 9, 3.4, 5, 3);
  });

  cell('bank', 512, 96, 384, 288, (g, ch, w, h) => {
    // Rocker switch bank. The rockers themselves are instanced geometry; what
    // is painted is the pocket each one sits in and the legend under it.
    plateGround(g, ch, w, h, 1);
    plateBevel(g, ch, w, h, 4);
    legend(g, ch, 'WEAPON  SYS', w * 0.5, h * 0.085, 17);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 4; i++) {
        const x = w * (0.10 + i * 0.235);
        const y = h * (0.20 + row * 0.36);
        recess(g, ch, x, y, w * 0.175, h * 0.20, 2);
        legend(g, ch, ['ARM', 'SAFE', 'AUX', 'PWR', 'TRK', 'IFF', 'JAM', 'EMR'][row * 4 + i],
          x + w * 0.0875, y + h * 0.265, 12);
      }
    }
    grille(g, ch, w * 0.10, h * 0.88, w * 0.80, h * 0.10, 3);
    screwFrame(g, ch, w, h, 9, 3.4, 4, 3);
  });

  cell('gauge', 896, 96, 128, 128, (g, ch, w, h) => {
    // The bezel a standby gauge is potted into: a milled ring, its screws, and
    // the black behind the glass.
    plateGround(g, ch, w, h, 1);
    const c = w / 2;
    if (ch === 'a') {
      const grd = g.createRadialGradient(c * 0.8, c * 0.8, c * 0.2, c, c, c * 0.98);
      grd.addColorStop(0, '#9eaabd');
      grd.addColorStop(0.62, '#5a6472');
      grd.addColorStop(0.9, '#2b323c');
      grd.addColorStop(1, '#0d1015');
      g.fillStyle = grd;
    } else if (ch === 'h') {
      const grd = g.createRadialGradient(c, c, 0, c, c, c);
      grd.addColorStop(0, '#8a8a8a');
      grd.addColorStop(0.66, '#d6d6d6');
      grd.addColorStop(0.98, '#3c3c3c');
      g.fillStyle = grd;
    } else g.fillStyle = S_ALLOY;
    g.beginPath();
    g.arc(c, c, c * 0.98, 0, Math.PI * 2);
    g.fill();
    // The well. Left black: the live gauge face is a separate glowing quad.
    g.fillStyle = P(ch, '#04070a', '#404040', ORM(0.3, 0.5, 0.2));
    g.beginPath();
    g.arc(c, c, c * 0.66, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 4; i++) {
      const t = Math.PI / 4 + (i * Math.PI) / 2;
      screw(g, ch, c + Math.cos(t) * c * 0.83, c + Math.sin(t) * c * 0.83, 4);
    }
  });

  cell('radio', 0, 288, 512, 240, (g, ch, w, h) => {
    // The radio head. Two windows for the live readout, a column of soft keys
    // between them, and the tuning knobs' collars underneath.
    plateGround(g, ch, w, h, 1);
    plateBevel(g, ch, w, h, 4);
    for (const x of [w * 0.055, w * 0.585]) recess(g, ch, x, h * 0.13, w * 0.36, h * 0.40, 3);
    legend(g, ch, 'LINK', w * 0.235, h * 0.60, 13);
    legend(g, ch, 'TRACK', w * 0.765, h * 0.60, 13);
    // Soft keys down the middle, where the column crosses the panel.
    for (let i = 0; i < 3; i++) {
      recess(g, ch, w * 0.44, h * 0.13 + i * h * 0.145, w * 0.12, h * 0.115, 2);
    }
    for (let i = 0; i < 6; i++) {
      const x = w * (0.08 + i * 0.168);
      recess(g, ch, x, h * 0.70, w * 0.10, h * 0.20, 3);
      legend(g, ch, ['CH', 'VOL', 'SQL', 'GAIN', 'BRT', 'MOD'][i], x + w * 0.05, h * 0.955, 11);
    }
    screwFrame(g, ch, w, h, 9, 3.4, 5, 3);
  });

  cell('pedestal', 0, 528, 384, 288, (g, ch, w, h) => {
    plateGround(g, ch, w, h);
    plateBevel(g, ch, w, h, 4);
    chevrons(g, ch, w * 0.07, h * 0.055, w * 0.86, h * 0.075);
    // Two columns of pushbuttons either side of where the column crosses.
    for (const side of [0, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = w * (side ? 0.60 : 0.09);
        const y = h * (0.19 + i * 0.135);
        recess(g, ch, x, y, w * 0.31, h * 0.105, 2);
        legend(g, ch, ['SHLD', 'RCS', 'FUEL', 'DAMP', 'NAV', 'SCAN', 'BEAM', 'MSTR'][side * 4 + i],
          x + w * 0.155, y + h * 0.055, 12);
      }
    }
    grille(g, ch, w * 0.40, h * 0.74, w * 0.20, h * 0.18, 5);
    legend(g, ch, 'PEDESTAL  4B', w * 0.5, h * 0.965, 13);
    dataPlate(g, ch, w * 0.07, h * 0.755, w * 0.24, h * 0.17, 0x77aa);
    dataPlate(g, ch, w * 0.69, h * 0.755, w * 0.24, h * 0.17, 0x31bd);
    screwFrame(g, ch, w, h, 9, 3.4, 4, 4);
  });

  cell('console', 384, 528, 256, 288, (g, ch, w, h) => {
    // Side console: a pull-breaker grid. The breakers are instanced; these are
    // their pockets, the bus bars behind them and the row lettering.
    plateGround(g, ch, w, h);
    plateBevel(g, ch, w, h, 4);
    legend(g, ch, 'DC BUS', w * 0.5, h * 0.065, 15);
    for (let row = 0; row < 4; row++) {
      const y = h * (0.16 + row * 0.19);
      g.fillStyle = P(ch, 'rgba(0,0,0,0.35)', 'rgba(96,96,96,0.9)', ORM(0.6, 0.8, 0.1));
      g.fillRect(w * 0.08, y - h * 0.012, w * 0.84, h * 0.09);
      for (let i = 0; i < 5; i++) {
        const x = w * (0.14 + i * 0.18);
        recess(g, ch, x - w * 0.035, y, w * 0.07, h * 0.065, 3);
      }
      legend(g, ch, String.fromCharCode(65 + row), w * 0.055, y + h * 0.03, 12, 'center');
    }
    for (let i = 0; i < 5; i++) {
      legend(g, ch, ['GEN', 'INV', 'PMP', 'HTR', 'LGT'][i], w * (0.14 + i * 0.18), h * 0.945, 10);
    }
    dataPlate(g, ch, w * 0.10, h * 0.855, w * 0.80, h * 0.07, 0x9f2e);
    screwFrame(g, ch, w, h, 8, 3.2, 3, 4);
  });

  cell('lower', 640, 528, 384, 288, (g, ch, w, h) => {
    // The plates under the two displays. Guarded switches, a breaker pair and
    // a big engraved placard, because this is the part of the panel closest to
    // the eye and it has to hold up.
    plateGround(g, ch, w, h);
    plateBevel(g, ch, w, h, 4);
    for (let i = 0; i < 3; i++) {
      const x = w * (0.07 + i * 0.20);
      recess(g, ch, x, h * 0.12, w * 0.15, h * 0.30, 3);
      legend(g, ch, ['JETT', 'ARM', 'DUMP'][i], x + w * 0.075, h * 0.50, 12);
    }
    grille(g, ch, w * 0.70, h * 0.10, w * 0.24, h * 0.34, 6);
    for (let i = 0; i < 6; i++) {
      const x = w * (0.07 + i * 0.155);
      recess(g, ch, x, h * 0.60, w * 0.09, h * 0.13, 2);
    }
    legend(g, ch, 'ORDNANCE  STORES', w * 0.5, h * 0.83, 16);
    legend(g, ch, 'DO NOT PAINT OVER PLACARD', w * 0.5, h * 0.93, 11, 'center', 'rgba(150,160,176,0.6)');
    screwFrame(g, ch, w, h, 9, 3.4, 4, 3);
  });

  cell('strip', 640, 816, 384, 208, (g, ch, w, h) => {
    // The narrow shoulder plates: a placard, a couple of breakers, a station
    // number. Filler, but filler is most of what a real panel is.
    plateGround(g, ch, w, h);
    plateBevel(g, ch, w, h, 3);
    legend(g, ch, 'SECT 4 - B', w * 0.5, h * 0.22, 20);
    dataPlate(g, ch, w * 0.08, h * 0.38, w * 0.38, h * 0.40, 0x5ab1);
    grille(g, ch, w * 0.56, h * 0.38, w * 0.36, h * 0.40, 4);
    screwFrame(g, ch, w, h, 8, 3.2, 4, 2);
  });

  cell('quad', 384, 816, 256, 208, (g, ch, w, h) => {
    // The throttle quadrant's cheek plate, which the lever slides across.
    plateGround(g, ch, w, h, 1);
    plateBevel(g, ch, w, h, 4);
    recess(g, ch, w * 0.12, h * 0.40, w * 0.76, h * 0.16, 6);
    legend(g, ch, 'THROTTLE', w * 0.5, h * 0.22, 16);
    for (let i = 0; i <= 5; i++) {
      const x = w * (0.14 + i * 0.144);
      g.fillStyle = P(ch, 'rgba(200,212,230,0.6)', 'rgba(70,70,70,0.8)', S_ALLOY);
      g.fillRect(x, h * 0.60, 2, h * 0.09);
    }
    legend(g, ch, 'IDLE', w * 0.16, h * 0.79, 11);
    legend(g, ch, 'MIL', w * 0.86, h * 0.79, 11);
    screwFrame(g, ch, w, h, 8, 3.2, 3, 2);
  });

  // Bake the atlas. Albedo at full size, the packed surface maps at half —
  // roughness and metalness carry no edges the eye can resolve at this scale.
  function bakeAtlas() {
    const a = cv(AT, AT);
    const hgt = cv(AT / 2, AT / 2);
    const orm = cv(AT / 2, AT / 2);
    const ga = a.getContext('2d');
    const gh = hgt.getContext('2d');
    const gr = orm.getContext('2d');
    ga.fillStyle = '#12161c';
    ga.fillRect(0, 0, AT, AT);
    gh.fillStyle = '#808080';
    gh.fillRect(0, 0, AT / 2, AT / 2);
    gr.fillStyle = S_PAINT;
    gr.fillRect(0, 0, AT / 2, AT / 2);
    for (const [ch, g, s] of [['a', ga, 1], ['h', gh, 0.5], ['r', gr, 0.5]]) {
      for (const c of Object.values(CELLS)) {
        g.save();
        g.translate(c.x * s, c.y * s);
        g.beginPath();
        g.rect(0, 0, c.w * s, c.h * s);
        g.clip();
        g.scale(s, s);
        c.draw(g, ch, c.w, c.h);
        g.restore();
      }
    }
    const tex = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    };
    return {
      map: tex(a, true),
      normalMap: tex(normalMapFrom(hgt, 2.4, false)),
      orm: tex(orm),
    };
  }

  const atlas = bakeAtlas();
  const plateMat = new THREE.MeshStandardMaterial({
    map: atlas.map,
    normalMap: atlas.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    aoMap: atlas.orm,
    roughnessMap: atlas.orm,
    metalnessMap: atlas.orm,
    roughness: 1,
    metalness: 1,
    envMap: env,
    envMapIntensity: 0.85,
  });

  // ---- The fascia sheet -----------------------------------------------------
  // One texture over the whole panel face, in the plane's own coordinates so
  // nothing is stretched: seams, stencils, wear and the dark seats the raised
  // plates bolt into. Everything else in here stands off this.

  const FX = FD * T(57); // half-width the texture covers, in plane units
  const FY0 = FD * T(-24); // top edge, in plane units
  const FY1 = FD * T(-66);
  const FW = 1600;
  const FH = Math.round((FW * (FY0 - FY1)) / (FX * 2));

  const fx = (a) => ((FD * T(a) + FX) / (2 * FX)) * FW;
  const fy = (e) => ((FY0 - FD * T(e)) / (FY0 - FY1)) * FH;

  function paintFascia(g, ch, S) {
    const r = rng(0x3f19);
    g.save();
    g.scale(S, S);

    g.fillStyle = P(ch, '#232a34', '#808080', S_PAINT);
    g.fillRect(0, 0, FW, FH);

    // Orange peel over everything.
    for (let i = 0; i < 26000; i++) {
      const x = r() * FW;
      const y = r() * FH;
      if (ch === 'h') g.fillStyle = r() > 0.5 ? 'rgba(168,168,168,0.4)' : 'rgba(74,74,74,0.4)';
      else if (ch === 'a') g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      else g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(255,0,0,0.03)';
      g.beginPath();
      g.arc(x, y, 0.7 + r() * 2.0, 0, Math.PI * 2);
      g.fill();
    }

    // Broad blotching, so the finish is not one thickness across two metres.
    for (let i = 0; i < 34; i++) {
      const x = r() * FW;
      const y = r() * FH;
      const rad = 40 + r() * 190;
      const up = r() > 0.5;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, P(ch,
        up ? 'rgba(120,136,160,0.09)' : 'rgba(0,0,0,0.14)',
        'rgba(128,128,128,0)',
        up ? 'rgba(0,255,0,0.06)' : 'rgba(0,0,0,0.06)'));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }

    // Structural seams: the joins between the panel's own castings, with the
    // countersunk rows that hold them together. Drawn in plane coordinates so
    // they run true across the whole fascia.
    const seam = (x0, y0, x1, y1) => {
      g.strokeStyle = P(ch, 'rgba(0,0,0,0.6)', '#3e3e3e', ORM(0.5, 0.7, 0.3));
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.strokeStyle = P(ch, 'rgba(160,176,200,0.16)', '#b4b4b4', ORM(1, 0.55, 0.5));
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x0, y0 + 2.4);
      g.lineTo(x1, y1 + 2.4);
      g.stroke();
      const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 46);
      for (let i = 0; i <= n; i++) {
        screw(g, ch, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 4.2);
      }
    };
    seam(fx(-57), fy(-44.5), fx(-16), fy(-44.5));
    seam(fx(16), fy(-44.5), fx(57), fy(-44.5));
    seam(fx(-57), fy(-31.5), fx(-40), fy(-36));
    seam(fx(40), fy(-36), fx(57), fy(-31.5));
    seam(fx(-16), fy(-27), fx(-16), fy(-60));
    seam(fx(16), fy(-27), fx(16), fy(-60));

    // Stencilled markings. Small, dry, and never in the way of an instrument.
    const stencil = (text, a, e, size, align = 'center', colour) => {
      legend(g, ch, text, fx(a), fy(e), size, align, colour || 'rgba(172,184,204,0.78)');
    };
    stencil('NO STEP', -47, -47, 22);
    stencil('NO STEP', 47, -47, 22);
    stencil('AVIONICS BAY  ACCESS', 0, -57, 20);
    stencil('SER  KX-4471-A', -33, -57.5, 16, 'center', 'rgba(140,152,172,0.5)');
    stencil('CLASS III', 33, -57.5, 16, 'center', 'rgba(140,152,172,0.5)');
    stencil('DZUS', -21.5, -30.5, 13, 'center', 'rgba(140,152,172,0.5)');
    stencil('DZUS', 21.5, -30.5, 13, 'center', 'rgba(140,152,172,0.5)');
    for (let i = 0; i < 6; i++) {
      stencil(String(i + 1).padStart(2, '0'), -52 + i * 3.4, -42.5, 13, 'center', 'rgba(130,142,162,0.45)');
      stencil(String(i + 7).padStart(2, '0'), 52 - i * 3.4, -42.5, 13, 'center', 'rgba(130,142,162,0.45)');
    }

    // Warning triangle by the ejection seat's initiator, which is the sort of
    // thing that is always stuck to a panel and never mentioned.
    if (ch === 'a') {
      g.fillStyle = 'rgba(206,146,40,0.8)';
      g.beginPath();
      const tx = fx(-42);
      const ty = fy(-52);
      g.moveTo(tx, ty - 13);
      g.lineTo(tx + 14, ty + 11);
      g.lineTo(tx - 14, ty + 11);
      g.closePath();
      g.fill();
      g.fillStyle = '#12161c';
      g.font = '700 15px ui-monospace, Menlo, monospace';
      g.textAlign = 'center';
      g.fillText('!', tx, ty + 7);
    }

    // Wear: scuffs where a boot or a glove goes, rubbed back toward the metal.
    for (let i = 0; i < 90; i++) {
      const x = r() * FW;
      const y = FH * (0.35 + r() * 0.65);
      const len = 8 + r() * 50;
      const ang = (r() - 0.5) * 1.1;
      g.strokeStyle = P(ch,
        `rgba(176,190,212,${0.05 + r() * 0.12})`,
        `rgba(150,150,150,0.4)`,
        ORM(1, 0.42, 0.5));
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }

    // Grime pooling in the bottom corners, and a wash of it under the coaming.
    if (ch === 'a' || ch === 'r') {
      for (const [x, y, rad] of [[0, FH, FW * 0.5], [FW, FH, FW * 0.5], [FW / 2, 0, FW * 0.6]]) {
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, P(ch, 'rgba(0,0,0,0.5)', '', ORM(0.6, 0.95, 0.02)));
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }

    // The very bottom row is what gets stretched into the footwell when the
    // frame is taller than the texture, so it is left plain and dark.
    if (ch === 'a') {
      const grd = g.createLinearGradient(0, FH * 0.93, 0, FH);
      grd.addColorStop(0, 'rgba(6,8,11,0)');
      grd.addColorStop(1, 'rgba(6,8,11,1)');
      g.fillStyle = grd;
      g.fillRect(0, FH * 0.93, FW, FH * 0.07);
    }

    g.restore();
  }

  function bakeFascia() {
    const a = cv(FW, FH);
    const hgt = cv(FW / 2, FH / 2);
    const orm = cv(FW / 2, FH / 2);
    paintFascia(a.getContext('2d'), 'a', 1);
    paintFascia(hgt.getContext('2d'), 'h', 0.5);
    paintFascia(orm.getContext('2d'), 'r', 0.5);
    const tex = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    };
    return {
      map: tex(a, true),
      normalMap: tex(normalMapFrom(hgt, 2.0, false)),
      orm: tex(orm),
    };
  }

  const fasciaSkin = bakeFascia();
  const fasciaMat = new THREE.MeshStandardMaterial({
    map: fasciaSkin.map,
    normalMap: fasciaSkin.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    aoMap: fasciaSkin.orm,
    roughnessMap: fasciaSkin.orm,
    metalnessMap: fasciaSkin.orm,
    roughness: 1,
    metalness: 1,
    envMap: env,
    envMapIntensity: 0.5,
  });

  // ---- Geometry accumulation ------------------------------------------------

  const Acc = () => ({ p: [], n: [], t: [], i: [] });

  const E1 = new THREE.Vector3();
  const E2 = new THREE.Vector3();
  const NR = new THREE.Vector3();

  /** One quad, corners anticlockwise from the bottom left as seen by the eye. */
  function quad(acc, bl, br, tr, tl, uv) {
    const base = acc.p.length / 3;
    E1.subVectors(br, bl);
    E2.subVectors(tl, bl);
    NR.crossVectors(E1, E2).normalize();
    for (const p of [bl, br, tr, tl]) {
      acc.p.push(p.x, p.y, p.z);
      acc.n.push(NR.x, NR.y, NR.z);
    }
    acc.t.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    acc.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function meshOf(acc, mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(acc.t, 2));
    geo.setIndex(acc.i);
    return new THREE.Mesh(geo, mat);
  }

  const RIM = () => uvOf('rim');

  /**
   * A raised sub-panel: a face standing `lift` proud of the fascia, with milled
   * sides carrying it back down to the seat. The sides are what make it read as
   * a part bolted on rather than a decal, because they are the only bit of it
   * that has an edge to catch the light.
   */
  function plate(acc, a0, a1, e0, e1, cellName, { lift = 0.022, d = FD, flip = false } = {}) {
    const dF = d - lift;
    const bl = V(a0, e0, dF);
    const br = V(a1, e0, dF);
    const tr = V(a1, e1, dF);
    const tl = V(a0, e1, dF);
    quad(acc, bl, br, tr, tl, uvOf(cellName, flip));
    const Bbl = V(a0, e0, d);
    const Bbr = V(a1, e0, d);
    const Btr = V(a1, e1, d);
    const Btl = V(a0, e1, d);
    quad(acc, tl, tr, Btr, Btl, RIM());
    quad(acc, Bbl, Bbr, br, bl, RIM());
    quad(acc, Bbl, bl, tl, Btl, RIM());
    quad(acc, br, Bbr, Btr, tr, RIM());
    return { bl, br, tr, tl };
  }

  /**
   * A trapezoidal plate, for the zones whose top edge follows the coaming.
   * With `drop` the bottom edge follows it too, which is how the underlight
   * rail keeps a constant width all the way out to the pillar.
   */
  function plateTrap(acc, a0, a1, eT0, eT1, e1, cellName, { lift = 0.022, d = FD, flip = false, drop = 0 } = {}) {
    const dF = d - lift;
    const b0 = drop ? eT0 - drop : e1;
    const b1 = drop ? eT1 - drop : e1;
    const bl = V(a0, b0, dF);
    const br = V(a1, b1, dF);
    const tr = V(a1, eT1, dF);
    const tl = V(a0, eT0, dF);
    quad(acc, bl, br, tr, tl, uvOf(cellName, flip));
    const Bbl = V(a0, b0, d);
    const Bbr = V(a1, b1, d);
    const Btr = V(a1, eT1, d);
    const Btl = V(a0, eT0, d);
    quad(acc, tl, tr, Btr, Btl, RIM());
    quad(acc, Bbl, Bbr, br, bl, RIM());
    quad(acc, Bbl, bl, tl, Btl, RIM());
    quad(acc, br, Bbr, Btr, tr, RIM());
  }

  /** A machined rail: a thin proud bar, for seams, sills and bezel members. */
  function rail(acc, a0, a1, e0, e1, lift, d = FD) {
    plate(acc, a0, a1, e0, e1, 'bar', { lift, d });
  }

  // ---- Instanced hardware ---------------------------------------------------
  // One mesh per kind. Everything on the panel points at the eye, so an
  // instance is a position, a look-at and a scale.

  const DUMMY = new THREE.Object3D();
  const UP = new THREE.Vector3(0, 1, 0);

  function instanced(geo, mat, max) {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.count = 0;
    m.frustumCulled = false;
    group.add(m);
    return m;
  }

  /** Aim an instance out of the panel at the eye, and stamp it in. */
  function put(mesh, i, pos, scale, spin = 0) {
    DUMMY.position.copy(pos);
    DUMMY.up.copy(UP);
    DUMMY.lookAt(0, 0, 0);
    if (spin) DUMMY.rotateZ(spin);
    DUMMY.scale.copy(scale);
    DUMMY.updateMatrix();
    mesh.setMatrixAt(i, DUMMY.matrix);
  }

  const SC = new THREE.Vector3();

  // Hardware is kept deliberately dull. Everything on this panel faces the eye,
  // and the cockpit's lamp is right behind the eye — so a polished part throws
  // its highlight straight back down the barrel, blooms, and turns a row of
  // fasteners into a string of fairy lights. Dark bodies with a bright edge is
  // what a photograph of a real panel actually shows.
  const screwMat = new THREE.MeshStandardMaterial({
    color: 0x5a626e,
    normalMap: screwSkin.normalMap,
    roughnessMap: screwSkin.roughnessMap,
    roughness: 0.66,
    metalness: 0.7,
    envMap: env,
    envMapIntensity: 0.4,
  });
  const screwGeo = new THREE.CylinderGeometry(0.5, 0.44, 0.36, 10);
  screwGeo.rotateX(Math.PI / 2);
  const screws = instanced(screwGeo, screwMat, 300);

  // Truncated cones, not cylinders: a flat cap facing the eye takes the light
  // dead even and reads as a printed dot, where a cone puts a shaded ring round
  // a small face and reads as a button standing off the panel.
  const breakerMat = new THREE.MeshStandardMaterial({
    color: 0x1d232c,
    normalMap: knurl.normalMap,
    roughnessMap: knurl.roughnessMap,
    roughness: 0.72,
    metalness: 0.45,
    envMap: env,
    envMapIntensity: 0.45,
  });
  const breakerGeo = new THREE.CylinderGeometry(0.34, 0.5, 1, 10);
  breakerGeo.rotateX(Math.PI / 2);
  const breakers = instanced(breakerGeo, breakerMat, 120);

  const knobMat = new THREE.MeshStandardMaterial({
    color: 0x272d37,
    normalMap: knurl.normalMap,
    roughnessMap: knurl.roughnessMap,
    roughness: 0.62,
    metalness: 0.7,
    envMap: env,
    envMapIntensity: 0.5,
  });
  const knobGeo = new THREE.CylinderGeometry(0.40, 0.56, 1, 16);
  knobGeo.rotateX(Math.PI / 2);
  const knobs = instanced(knobGeo, knobMat, 40);

  // Rockers are the one bit of switchgear whose tilt has to read, so they are
  // a wedge rather than a cylinder: half the face catches the panel light and
  // half falls into shadow, which is what says "this one is switched up".
  const rockerMat = new THREE.MeshStandardMaterial({
    color: 0x2b313b,
    normalMap: rubberSkin.normalMap,
    roughnessMap: rubberSkin.roughnessMap,
    roughness: 0.75,
    metalness: 0.25,
    envMap: env,
    envMapIntensity: 0.6,
  });
  const rockerGeo = new THREE.BoxGeometry(1, 1, 1);
  const rockers = instanced(rockerGeo, rockerMat, 80);

  const guardMat = new THREE.MeshStandardMaterial({
    color: 0xb08038,
    roughness: 0.45,
    metalness: 0.9,
    envMap: env,
    envMapIntensity: 1.1,
  });
  const guardGeo = new THREE.BoxGeometry(1, 1, 1);
  const guards = instanced(guardGeo, guardMat, 24);

  // Lamp lenses and witness marks. Basic-shaded so they sit at a fixed
  // brightness rather than being modelled by the cockpit's own dim lighting,
  // and coloured per instance so one buffer covers every annunciator on the
  // panel *and* the little index line ground into the top of every knob —
  // which is the one mark that says a knob turns rather than pushes.
  const lampMat = new THREE.MeshBasicMaterial({ toneMapped: true });
  const lampGeo = new THREE.BoxGeometry(1, 1, 0.4);
  const lamps = instanced(lampGeo, lampMat, 64);
  const LAMP_OFF = new THREE.Color(0x0c1014);
  const MARK = new THREE.Color(0x7d8798);

  // ---- Live faces -----------------------------------------------------------
  // Everything that glows is one canvas and one quad buffer: two standby
  // gauges, the radio head's two windows and the annunciator legend strip.

  const GW = 512;
  const glow = kit.makeScreen(GW, GW);
  const glowMat = new THREE.MeshBasicMaterial({ map: glow.tex, toneMapped: true });
  const GCELL = {
    gaugeL: [0, 0, 256, 256],
    gaugeR: [256, 0, 256, 256],
    radioL: [0, 256, 256, 128],
    radioR: [256, 256, 256, 128],
    legends: [0, 384, 512, 128],
  };
  const guv = (name) => {
    const [x, y, w, h] = GCELL[name];
    return [x / GW, 1 - (y + h) / GW, (x + w) / GW, 1 - y / GW];
  };

  // Cover glass, painted rather than computed: the eye never moves relative to
  // this panel, so the biggest reflection on it is a fixed shape, and a painted
  // one can carry the dust and the wipe marks a two-light scene never will.
  const sheenMat = new THREE.MeshBasicMaterial({
    map: glassSheen(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.42,
    fog: false,
  });

  // ---- Layout ---------------------------------------------------------------

  const fascia = new THREE.Mesh(new THREE.BufferGeometry(), fasciaMat);
  fascia.renderOrder = -1;
  group.add(fascia);
  const plates = new THREE.Mesh(new THREE.BufferGeometry(), plateMat);
  group.add(plates);
  const glowMesh = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
  glowMesh.renderOrder = 2;
  group.add(glowMesh);
  const gaugeGlass = new THREE.Mesh(new THREE.BufferGeometry(), sheenMat);
  gaugeGlass.renderOrder = 6;
  group.add(gaugeGlass);

  /**
   * Read the coaming line back off the panel's own vertices.
   *
   * cockpit.js bends the coaming down as it goes outboard and is free to change
   * how far; detail laid out against a hard-coded copy of that curve would end
   * up printed on the sky the first time it moved. The topmost panel vertex at
   * each azimuth *is* the coaming, so the curve comes from the geometry itself
   * and this file never needs to know the formula.
   */
  function readCoaming() {
    const panel = group.children.find(
      (o) => o.isMesh && o.material === mats.panelMat && o.geometry.attributes.position,
    );
    if (!panel) return;
    const pos = panel.geometry.attributes.position;
    if (pos.count < 12) return;
    const BINS = 61;
    const SPAN = 75;
    const top = new Float32Array(BINS).fill(NaN);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (z >= -0.05) continue;
      const a = Math.atan2(x, -z) / DEG;
      const e = Math.atan2(y, Math.hypot(x, z)) / DEG;
      const b = Math.round(((a + SPAN) / (2 * SPAN)) * (BINS - 1));
      if (b < 0 || b >= BINS) continue;
      if (Number.isNaN(top[b]) || e > top[b]) top[b] = e;
    }
    // Fill any bin the mesh did not reach from its neighbours, so the lookup
    // never returns a hole.
    for (let i = 0; i < BINS; i++) {
      if (!Number.isNaN(top[i])) continue;
      let j = i;
      while (j >= 0 && Number.isNaN(top[j])) j--;
      let k = i;
      while (k < BINS && Number.isNaN(top[k])) k++;
      top[i] = !Number.isNaN(top[j] ?? NaN) ? top[j] : !Number.isNaN(top[k] ?? NaN) ? top[k] : C;
    }
    coamAt = (a) => {
      const t = ((Math.max(-SPAN, Math.min(SPAN, a)) + SPAN) / (2 * SPAN)) * (BINS - 1);
      const i = Math.floor(t);
      const f = t - i;
      return top[i] * (1 - f) + top[Math.min(BINS - 1, i + 1)] * f;
    };
  }

  // Where each thing lives, in degrees off the boresight. Elevations that have
  // to stay under the glass are quoted against the coaming curve; everything
  // else is absolute, because the panel's own geography does not move when the
  // lens does.
  // A round instrument has to be round: the panel's coordinates are tangents,
  // not angles, so a dial given equal angular half-widths comes out an ellipse.
  // Gauges are therefore sized in the plane's own units and converted back.
  const A = (t) => Math.atan(t) / DEG;
  const dial = (aDeg, eDeg, r) => {
    const tx = T(aDeg);
    const ty = T(eDeg);
    return {
      a0: A(tx - r), a1: A(tx + r), e0: A(ty - r), e1: A(ty + r), r,
      ac: aDeg, ec: eDeg, tx, ty,
    };
  };

  const Z = {
    annun: { a0: -8.6, a1: 8.6, e0: -31.4, e1: -26.2 },
    gaugeL: dial(-12.4, -29.8, 0.058),
    gaugeR: dial(12.4, -29.8, 0.058),
    radio: { a0: -14.2, a1: 14.2, e0: -41.4, e1: -32.9 },
    ped: { a0: -15.4, a1: 15.4, e0: -52.5, e1: -41.9 },
    bankR: { a0: 15.6, a1: 31.5, e1: -35.9 },
    consoleL: { a0: -56, a1: -44, e1: -53 },
    consoleR: { a0: 44, a1: 56, e1: -53 },
    colR: { a0: 39.6, a1: 43.4, e1: -49.5 },
    quadL: { a0: -43.4, a1: -34.5, e0: -43.5, e1: -32.5 },
    lowerL: { a0: -38.4, a1: -16.2, e0: -63, e1: -53.6 },
    lowerR: { a0: 16.2, a1: 38.4, e0: -63, e1: -50.2 },
  };

  /** Build everything that depends on the frame. Cheap enough to redo whole. */
  function layoutPanel(hDeg) {
    readCoaming();
    const co = (a) => coamAt(a);

    // -- the fascia sheet: a flat plane clipped to the coaming --
    const acc = Acc();
    const COLS = 56;
    const A0 = -Math.max(60, hDeg + 4);
    const A1 = -A0;
    const uvAt = (p) => [(p.x + FX) / (2 * FX), 1 - (FY0 - p.y) / (FY0 - FY1)];
    const ROWS = 5;
    const pt = (i, j) => {
      const a = A0 + ((A1 - A0) * i) / COLS;
      const e0 = co(a) + 0.4;
      const e = e0 + ((-80 - e0) * j) / ROWS;
      return V(a, e, FD);
    };
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const bl = pt(i, j + 1);
        const br = pt(i + 1, j + 1);
        const tr = pt(i + 1, j);
        const tl = pt(i, j);
        const base = acc.p.length / 3;
        for (const p of [bl, br, tr, tl]) {
          acc.p.push(p.x, p.y, p.z);
          acc.n.push(0, 0, 1);
          const uv = uvAt(p);
          acc.t.push(uv[0], uv[1]);
        }
        acc.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    fascia.geometry.dispose();
    fascia.geometry = meshOf(acc, fasciaMat).geometry;

    // -- the raised plates --
    const pa = Acc();

    plate(pa, Z.annun.a0, Z.annun.a1, Z.annun.e0, Z.annun.e1, 'annun', { lift: 0.026 });
    plate(pa, Z.radio.a0, Z.radio.a1, Z.radio.e0, Z.radio.e1, 'radio', { lift: 0.030 });
    plate(pa, Z.ped.a0, Z.ped.a1, Z.ped.e0, Z.ped.e1, 'pedestal', { lift: 0.034 });
    // Gauge bezels: square plates the round instrument is potted into.
    for (const gz of [Z.gaugeL, Z.gaugeR]) {
      plate(pa, gz.a0, gz.a1, gz.e0, gz.e1, 'gauge', { lift: 0.030 });
    }
    // Switch bank, hanging off the coaming on the side that has room for it.
    plateTrap(pa, Z.bankR.a0, Z.bankR.a1, co(Z.bankR.a0) - 1.1, co(Z.bankR.a1) - 1.1, Z.bankR.e1, 'bank');
    // The coaming underlight rail: a machined strip tucked under the lip
    // wherever nothing else is, which is what gives the top of the panel a
    // continuous line instead of a ragged edge of sub-panels.
    for (const [a0, a1] of [[-40, -16.4], [32, 40]]) {
      plateTrap(pa, a0, a1, co(a0) - 0.9, co(a1) - 0.9, null, 'bar', { lift: 0.020, drop: 1.5 });
    }
    plateTrap(pa, Z.consoleL.a0, Z.consoleL.a1, co(Z.consoleL.a0) - 1.4, co(Z.consoleL.a1) - 1.4, Z.consoleL.e1, 'console', { flip: true, lift: 0.028 });
    plateTrap(pa, Z.consoleR.a0, Z.consoleR.a1, co(Z.consoleR.a0) - 1.4, co(Z.consoleR.a1) - 1.4, Z.consoleR.e1, 'console', { lift: 0.028 });
    plateTrap(pa, Z.colR.a0, Z.colR.a1, co(Z.colR.a0) - 1.4, co(Z.colR.a1) - 1.4, Z.colR.e1, 'strip', { lift: 0.024 });
    plate(pa, Z.quadL.a0, Z.quadL.a1, Z.quadL.e0, Z.quadL.e1, 'quad', { lift: 0.026 });
    plate(pa, Z.lowerL.a0, Z.lowerL.a1, Z.lowerL.e0, Z.lowerL.e1, 'lower', { lift: 0.030, flip: true });
    plate(pa, Z.lowerR.a0, Z.lowerR.a1, Z.lowerR.e0, Z.lowerR.e1, 'lower', { lift: 0.030 });

    // Sills: machined rails along the seams, which is what stops two adjacent
    // dark plates reading as one bigger dark plate.
    rail(pa, -9.0, 9.0, -32.7, -31.9, 0.032);
    rail(pa, -15.9, 15.9, -41.9, -41.1, 0.038);
    rail(pa, -16.3, -15.5, -53.6, -31.0, 0.026);
    rail(pa, 15.5, 16.3, -50.4, -31.0, 0.026);

    plates.geometry.dispose();
    plates.geometry = meshOf(pa, plateMat).geometry;

    // -- glowing faces --
    const ga = Acc();
    const face = (a0, a1, e0, e1, cellName, d) => {
      quad(ga, V(a0, e0, d), V(a1, e0, d), V(a1, e1, d), V(a0, e1, d), guv(cellName));
    };
    const gd = FD - 0.031;
    for (const [gz, cellName] of [[Z.gaugeL, 'gaugeL'], [Z.gaugeR, 'gaugeR']]) {
      const k = gz.r * 0.72;
      face(A(gz.tx - k), A(gz.tx + k), A(gz.ty - k), A(gz.ty + k), cellName, gd);
    }
    face(-13.2, -4.4, -37.4, -33.9, 'radioL', FD - 0.031);
    face(4.4, 13.2, -37.4, -33.9, 'radioR', FD - 0.031);
    face(-7.4, 7.4, -30.7, -29.5, 'legends', FD - 0.027);
    glowMesh.geometry.dispose();
    glowMesh.geometry = meshOf(ga, glowMat).geometry;

    // -- the gauge glass --
    const sa = Acc();
    for (const gz of [Z.gaugeL, Z.gaugeR]) {
      const d = FD - 0.036;
      const k = gz.r * 0.78;
      const a0 = A(gz.tx - k);
      const a1 = A(gz.tx + k);
      const e0 = A(gz.ty - k);
      const e1 = A(gz.ty + k);
      quad(sa, V(a0, e0, d), V(a1, e0, d), V(a1, e1, d), V(a0, e1, d), [0, 0, 1, 1]);
    }
    gaugeGlass.geometry.dispose();
    gaugeGlass.geometry = meshOf(sa, sheenMat).geometry;

    // -- hardware --
    let ns = 0;
    let nb = 0;
    let nk = 0;
    let nr = 0;
    let ng = 0;
    let nl = 0;
    const SCREW = 0.0105;

    /** Screws round a rectangle, at the depth its face sits at. */
    const screwRect = (a0, a1, e0, e1, d, nx, ny, sz = SCREW) => {
      SC.set(sz, sz, sz);
      const at = (a, e) => put(screws, ns++, V(a, e, d), SC);
      for (let i = 0; i < nx; i++) {
        const a = a0 + ((a1 - a0) * i) / (nx - 1);
        at(a, e0);
        at(a, e1);
      }
      for (let j = 1; j < ny - 1; j++) {
        const e = e0 + ((e1 - e0) * j) / (ny - 1);
        at(a0, e);
        at(a1, e);
      }
    };

    // Fasteners along the raised plates that carry the most weight, plus the
    // display bezels, which is where the eye looks first.
    screwRect(Z.radio.a0 + 0.6, Z.radio.a1 - 0.6, Z.radio.e0 + 0.5, Z.radio.e1 - 0.5, FD - 0.030, 6, 3);
    screwRect(Z.ped.a0 + 0.6, Z.ped.a1 - 0.6, Z.ped.e0 + 0.5, Z.ped.e1 - 0.5, FD - 0.034, 5, 4);
    screwRect(Z.lowerL.a0 + 0.7, Z.lowerL.a1 - 0.7, Z.lowerL.e0 + 0.6, Z.lowerL.e1 - 0.6, FD - 0.030, 5, 3);
    screwRect(Z.lowerR.a0 + 0.7, Z.lowerR.a1 - 0.7, Z.lowerR.e0 + 0.6, Z.lowerR.e1 - 0.6, FD - 0.030, 5, 3);
    screwRect(Z.consoleL.a0 + 0.6, Z.consoleL.a1 - 0.6, Z.consoleL.e1 + 0.6, co(Z.consoleL.a1) - 2.6, FD - 0.028, 4, 4);
    screwRect(Z.consoleR.a0 + 0.6, Z.consoleR.a1 - 0.6, Z.consoleR.e1 + 0.6, co(Z.consoleR.a0) - 2.6, FD - 0.028, 4, 4);

    // Breakers: two grids of pull-out buttons on the side consoles, and a pair
    // of rows under each display. Cylinders standing off their pockets.
    const breakerGrid = (a0, a1, e0, e1, nx, ny, d) => {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = a0 + ((a1 - a0) * (i + 0.5)) / nx;
          const e = e0 + ((e1 - e0) * (j + 0.5)) / ny;
          SC.set(0.019, 0.019, 0.030);
          put(breakers, nb++, V(a, e, d - 0.012), SC);
        }
      }
    };
    breakerGrid(Z.consoleL.a0 + 1.4, Z.consoleL.a1 - 1.4, Z.consoleL.e1 + 2.2, co(Z.consoleL.a1) - 5.5, 5, 4, FD - 0.028);
    breakerGrid(Z.consoleR.a0 + 1.4, Z.consoleR.a1 - 1.4, Z.consoleR.e1 + 2.2, co(Z.consoleR.a0) - 5.5, 5, 4, FD - 0.028);
    breakerGrid(Z.lowerL.a0 + 2.0, Z.lowerL.a1 - 2.0, Z.lowerL.e0 + 3.4, Z.lowerL.e0 + 6.0, 6, 1, FD - 0.030);
    breakerGrid(Z.lowerR.a0 + 2.0, Z.lowerR.a1 - 2.0, Z.lowerR.e0 + 3.4, Z.lowerR.e0 + 6.0, 6, 1, FD - 0.030);
    breakerGrid(Z.colR.a0 + 0.9, Z.colR.a1 - 0.9, Z.colR.e1 + 1.6, co(Z.colR.a0) - 4.5, 2, 4, FD - 0.024);

    // Knurled rotaries: the radio's tuning knobs and the pedestal's trims,
    // each with its index mark set a little off centre so a row of them does
    // not look stamped out by the same machine.
    const marks = [];
    const knobRow = (a0, a1, e, n, d, rad) => {
      for (let i = 0; i < n; i++) {
        const a = a0 + ((a1 - a0) * (i + 0.5)) / n;
        SC.set(rad, rad, 0.030);
        put(knobs, nk++, V(a, e, d - 0.014), SC);
        marks.push([a, e, d - 0.030, rad, 0.5 + (i % 3) * 0.7]);
      }
    };
    knobRow(Z.radio.a0 + 1.0, Z.radio.a1 - 1.0, -39.6, 6, FD - 0.030, 0.026);
    knobRow(-6.0, 6.0, -51.0, 2, FD - 0.034, 0.030);

    // Rockers, tilted so half the face is lit and half is not.
    const rockerRow = (a0, a1, e, n, d, up) => {
      for (let i = 0; i < n; i++) {
        const a = a0 + ((a1 - a0) * (i + 0.5)) / n;
        SC.set(0.026, 0.020, 0.016);
        DUMMY.position.copy(V(a, e, d - 0.008));
        DUMMY.up.copy(UP);
        DUMMY.lookAt(0, 0, 0);
        DUMMY.rotateX(((i + (up ? 0 : 1)) % 2 ? 1 : -1) * 0.45);
        DUMMY.scale.copy(SC);
        DUMMY.updateMatrix();
        rockers.setMatrixAt(nr++, DUMMY.matrix);
      }
    };
    rockerRow(Z.bankR.a0 + 1.4, Z.bankR.a1 - 1.4, -31.9, 4, FD - 0.022, true);
    rockerRow(Z.bankR.a0 + 1.4, Z.bankR.a1 - 1.4, -34.6, 4, FD - 0.022, false);
    rockerRow(Z.lowerL.a0 + 2.4, Z.lowerL.a1 - 2.4, Z.lowerL.e1 - 2.6, 5, FD - 0.030, true);
    rockerRow(Z.lowerR.a0 + 2.4, Z.lowerR.a1 - 2.4, Z.lowerR.e1 - 2.6, 5, FD - 0.030, false);
    rockerRow(-12.0, 12.0, -44.0, 6, FD - 0.034, true);
    rockerRow(-12.0, 12.0, -46.6, 6, FD - 0.034, false);

    // Guarded switches: the amber flip-up covers over anything that must not
    // be knocked. Two on the pedestal, one under each display.
    const guard = (a, e, d) => {
      SC.set(0.030, 0.026, 0.012);
      put(guards, ng++, V(a, e, d - 0.020), SC);
      SC.set(0.030, 0.008, 0.026);
      put(guards, ng++, V(a, e + 0.9, d - 0.012), SC);
    };
    guard(-10.5, -49.6, FD - 0.034);
    guard(10.5, -49.6, FD - 0.034);
    guard(Z.lowerL.a1 - 3.2, Z.lowerL.e1 - 6.2, FD - 0.030);
    guard(Z.lowerR.a0 + 3.2, Z.lowerR.e1 - 6.2, FD - 0.030);

    // Annunciator lenses of my own, out on the shoulders where the coaming has
    // dropped far enough to leave a strip of panel and nothing else wants it.
    for (let i = 0; i < 6; i++) {
      const a = i < 3 ? -35.5 + i * 3.0 : 26.5 + (i - 3) * 3.0;
      const e = co(a) - 2.4;
      SC.set(0.019, 0.011, 0.010);
      put(lamps, nl, V(a, e, FD - 0.026), SC);
      lamps.setColorAt(nl, LAMP_OFF);
      nl++;
    }
    lampSlots = nl; // only these are driven by the ship's state
    // The knobs' index marks ride on the same buffer.
    for (const [a, e, d, rad, spin] of marks) {
      SC.set(rad * 0.16, rad * 0.9, 0.006);
      DUMMY.position.copy(V(a, e, d));
      DUMMY.up.copy(UP);
      DUMMY.lookAt(0, 0, 0);
      DUMMY.rotateZ(spin);
      DUMMY.translateY(rad * 0.42);
      DUMMY.scale.copy(SC);
      DUMMY.updateMatrix();
      lamps.setMatrixAt(nl, DUMMY.matrix);
      lamps.setColorAt(nl, MARK);
      nl++;
    }

    screws.count = ns;
    breakers.count = nb;
    knobs.count = nk;
    rockers.count = nr;
    guards.count = ng;
    lamps.count = nl;
    for (const m of [screws, breakers, knobs, rockers, guards, lamps]) {
      m.instanceMatrix.needsUpdate = true;
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    stampBezelScrews();
  }

  let lampSlots = 0;
  const bezelScrews = [];

  slabs.push({
    m: fascia,
    place: (h) => () => layoutPanel(h),
  });

  // ---- Painting the live faces ----------------------------------------------

  /** One standby gauge: chapter ring, ticks, needle, and a digital counter. */
  function paintGauge(g, cellName, title, frac, digits, warn) {
    const [x, y, w, h] = GCELL[cellName];
    g.save();
    g.translate(x, y);
    g.fillStyle = '#04080b';
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.47;
    const R = w * 0.37;

    // The arc the needle sweeps: 240 degrees, opening at the bottom.
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    g.strokeStyle = 'rgba(93,255,176,0.22)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();

    // Red sector at the top of the scale, so the dial has an opinion.
    g.strokeStyle = 'rgba(255,90,60,0.75)';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, R - 5, a0 + (a1 - a0) * 0.84, a1);
    g.stroke();

    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const ang = a0 + (a1 - a0) * t;
      const major = i % 5 === 0;
      const len = major ? R * 0.24 : R * 0.12;
      g.strokeStyle = major ? GREEN : 'rgba(93,255,176,0.5)';
      g.lineWidth = major ? 3 : 1.6;
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * (R - 3), cy + Math.sin(ang) * (R - 3));
      g.lineTo(cx + Math.cos(ang) * (R - 3 - len), cy + Math.sin(ang) * (R - 3 - len));
      g.stroke();
      if (major) {
        label(g, String(i / 5 * 2), cx + Math.cos(ang) * (R - 34), cy + Math.sin(ang) * (R - 34),
          17, 'rgba(93,255,176,0.75)', 'center');
      }
    }

    label(g, title, cx, h * 0.22, 20, warn ? AMBER : GREEN, 'center');

    // Counter window under the spindle.
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(cx - w * 0.16, h * 0.60, w * 0.32, h * 0.11);
    g.strokeStyle = 'rgba(93,255,176,0.4)';
    g.lineWidth = 1.5;
    g.strokeRect(cx - w * 0.16, h * 0.60, w * 0.32, h * 0.11);
    label(g, digits, cx, h * 0.655, 20, warn ? AMBER : GREEN, 'center');

    // The needle, with its own counterweight and a hub over the spindle.
    const ang = a0 + (a1 - a0) * Math.max(0, Math.min(1, frac));
    g.save();
    g.translate(cx, cy);
    g.rotate(ang);
    g.fillStyle = warn ? RED : '#e8f6ff';
    g.beginPath();
    g.moveTo(-R * 0.22, -3.4);
    g.lineTo(R * 0.9, -1.4);
    g.lineTo(R * 0.9, 1.4);
    g.lineTo(-R * 0.22, 3.4);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#c8d6e6';
    g.beginPath();
    g.arc(cx, cy, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b3340';
    g.beginPath();
    g.arc(cx, cy, 2.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** A radio window: a phosphor readout behind glass, with its own scanlines. */
  function paintReadout(g, cellName, lines) {
    const [x, y, w, h] = GCELL[cellName];
    g.save();
    g.translate(x, y);
    g.fillStyle = '#04120c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < lines.length; i++) {
      const [text, value, colour] = lines[i];
      const yy = h * (0.26 + i * 0.34);
      label(g, text, w * 0.07, yy, 20, 'rgba(93,255,176,0.55)');
      label(g, value, w * 0.93, yy, 24, colour || GREEN, 'right');
    }
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let yy = 0; yy < h; yy += 3) g.fillRect(0, yy, w, 1);
    g.restore();
  }

  // Four legends, not eight. A caption strip this size is read at a glance or
  // not at all, and eight words across a hundred pixels is a texture, not a
  // warning.
  const LEGENDS = [
    ['TRACTOR', AMBER], ['HULL', RED], ['DUAL', GREEN], ['GUNS', GREEN],
  ];

  /** The annunciator strip: eight legends, dark until the ship has an opinion. */
  function paintLegends(g, lit) {
    const [x, y, w, h] = GCELL.legends;
    g.save();
    g.translate(x, y);
    g.fillStyle = '#080a0d';
    g.fillRect(0, 0, w, h);
    const cw = w / LEGENDS.length;
    for (let i = 0; i < LEGENDS.length; i++) {
      const [text, colour] = LEGENDS[i];
      const on = lit[i];
      g.fillStyle = on ? colour : '#141920';
      g.globalAlpha = on ? 0.92 : 1;
      g.fillRect(i * cw + 3, h * 0.13, cw - 6, h * 0.74);
      g.globalAlpha = 1;
      label(g, text, i * cw + cw / 2, h * 0.5, cw > 110 ? 30 : 26,
        on ? '#05070a' : 'rgba(126,140,160,0.6)', 'center');
    }
    g.restore();
  }

  // ---- Dressing the two displays --------------------------------------------
  // Done on the first update rather than at build time: cockpit.js has not run
  // its layout pass yet when this file is called, so the screens are still
  // unit-sized and unplaced. Parented to them, so wherever they end up their
  // bezel and their cover glass go too.

  let dressed = false;
  function dressDisplays() {
    const found = group.children.filter(
      (o) => o.isMesh && o.geometry.type === 'PlaneGeometry'
        && o.material.map && !o.material.transparent,
    );
    if (found.length < 2) return;
    dressed = true;
    for (const scr of found) {
      // A frame of four machined members, built in the screen's own local
      // space: the parent's scale is the screen's size, so 1 is exactly the
      // width of the glass and the bezel proportions come out right whatever
      // shape the display is.
      const acc = Acc();
      const w = 0.5;
      const h = 0.5;
      const t = 0.085; // frame width, as a fraction of the glass
      // The screen's own scale is (width, height, 1), so local z is already in
      // world units: the frame stands 12mm proud of the glass and its seat
      // runs 6mm behind it, which is a bezel rather than a sticker.
      const z = -0.006;
      const lift = 0.018;
      const F = (x0, x1, y0, y1) => {
        const bl = new THREE.Vector3(x0, y0, z + lift);
        const br = new THREE.Vector3(x1, y0, z + lift);
        const tr = new THREE.Vector3(x1, y1, z + lift);
        const tl = new THREE.Vector3(x0, y1, z + lift);
        quad(acc, bl, br, tr, tl, uvOf('bar'));
        const Bbl = new THREE.Vector3(x0, y0, z);
        const Bbr = new THREE.Vector3(x1, y0, z);
        const Btr = new THREE.Vector3(x1, y1, z);
        const Btl = new THREE.Vector3(x0, y1, z);
        quad(acc, tl, tr, Btr, Btl, RIM());
        quad(acc, Bbl, Bbr, br, bl, RIM());
        quad(acc, Bbl, bl, tl, Btl, RIM());
        quad(acc, br, Bbr, Btr, tr, RIM());
      };
      const th = t * (scr.scale.x / Math.max(1e-3, scr.scale.y));
      F(-w - t, w + t, h, h + th); // top
      F(-w - t, w + t, -h - th, -h); // bottom
      F(-w - t, -w, -h, h); // left
      F(w, w + t, -h, h); // right
      scr.add(meshOf(acc, plateMat));

      // Cover glass: the display's light passes through it and the reflection
      // is added on top, which is what a reflection physically does.
      const sheen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sheenMat);
      sheen.scale.set(1.0, 1.0, 1);
      sheen.position.z = 0.004;
      sheen.renderOrder = 6;
      scr.add(sheen);

      // Corner fasteners, in the cockpit's own frame rather than the screen's,
      // so they keep their round heads however the display is scaled. Kept in
      // a list of their own: the panel's layout pass rewrites the instance
      // buffer from scratch and would otherwise drop them on the first resize.
      scr.updateWorldMatrix(true, false);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const corner = new THREE.Vector3(sx * (w + t * 0.5), sy * (h + th * 0.5), z + lift);
        bezelScrews.push(corner.applyMatrix4(scr.matrixWorld));
      }
    }
    stampBezelScrews();
  }

  /** The display bezels' corner screws, appended after the panel's own. */
  function stampBezelScrews() {
    for (const p of bezelScrews) {
      if (screws.count >= screws.instanceMatrix.count) break;
      SC.set(0.013, 0.013, 0.013);
      put(screws, screws.count, p, SC);
      screws.count += 1;
    }
    screws.instanceMatrix.needsUpdate = true;
  }

  // ---- Frame ----------------------------------------------------------------

  let acc = 0;
  let pwr = 0.3;
  let hull = 1;

  return {
    update(dt, s) {
      if (!dressed) dressDisplays();

      // Instruments have mass: a needle that snaps to its value reads as a bar
      // chart, and one that lags a little reads as an instrument.
      const wantPwr = 0.28 + (s.dual ? 0.52 : 0.30) + (s.firing ? 0.12 : 0);
      pwr += (wantPwr - pwr) * Math.min(1, dt * 3.2);
      const wantHull = Math.max(0, Math.min(1, (s.lives || 0) / 4));
      hull += (wantHull - hull) * Math.min(1, dt * 2.2);

      // Repainted on a timer, not every frame, matching the displays: this is
      // a 512px upload and none of it changes fast enough to notice at 60Hz.
      acc += dt;
      if (acc < 1 / 10) return;
      acc = 0;

      const g = glow.ctx;
      const warn = s.captured || s.beaming;
      paintGauge(g, 'gaugeL', 'PWR', pwr, String(Math.round(pwr * 100)).padStart(3, '0'), false);
      paintGauge(g, 'gaugeR', 'HULL', hull, String(Math.max(0, s.lives || 0)).padStart(3, '0'),
        hull < 0.3);
      paintReadout(g, 'radioL', [
        ['TRK', String(s.contacts.length).padStart(2, '0')],
        ['LCK', s.threat ? 'HOT' : '---', s.threat ? RED : GREEN],
      ]);
      paintReadout(g, 'radioR', [
        ['STG', String(s.stage || 0).padStart(2, '0')],
        ['SIG', `${(441.2 + (s.stage || 0) * 0.7).toFixed(1)}`],
      ]);
      const blink = Math.sin(s.time * 9) > 0;
      paintLegends(g, [
        (s.captured || s.beaming) && blink,
        (s.lives || 0) <= 1 && s.flying,
        !!s.dual,
        s.flying && (s.firing || (s.guns || 0) > 0.6),
      ]);
      glow.tex.needsUpdate = true;

      // My own annunciator lenses take their cue from the same state: the two
      // inboard pairs run with the caution, the outboard ones with the guns.
      if (lampSlots) {
        const c = new THREE.Color();
        for (let i = 0; i < lampSlots; i++) {
          const on = i < 3
            ? (warn && blink)
            : (s.firing && i === 3) || (s.dual && i === 4) || (s.flying && i === 5);
          c.set(on ? (i < 3 ? 0xff5a3c : 0x5dffb0) : 0x0c1014);
          lamps.setColorAt(i, c);
        }
        if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      }
    },
  };
}

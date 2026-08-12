// Procedural textures for the cockpit view. No image assets — the same rule the
// 2D game plays by, so the whole thing still builds from source alone.
//
// The nebula is baked once into an equirect render target on the GPU; the star
// sprites are small canvases. Everything is memoised, because the bake is not
// cheap and nothing here ever changes after load.
import * as THREE from 'three';

let _sky = null;
let _star = null;
let _flare = null;

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * The deep-space backdrop: emission clouds in five colour regions, ridged dust
 * lanes cutting through them, ionised cores written above 1.0 for the bloom
 * pass to catch, and a haze of unresolved stars.
 *
 * Ported from the galactica-fps sky.
 */
export function nebulaSkyTexture(renderer) {
  if (_sky) return _sky;

  const W = 2048;
  const H = 1024;
  // Half-float, because the ionised cores are deliberately written above 1.0 so
  // the bloom pass picks them up. An 8-bit target would clip them to flat white
  // and the nebula would have no hot centre at all.
  const rt = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `
      in vec3 position;
      in vec2 uv;
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;

      float hash3(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.7, 0.4));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float vnoise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
              mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
              mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
          f.z);
      }

      float fbm(vec3 p, int oct) {
        float s = 0.0, a = 0.5, n = 0.0;
        for (int i = 0; i < 9; i++) {
          if (i >= oct) break;
          s += vnoise(p) * a;
          n += a;
          a *= 0.5;
          p *= 2.07; // non-integral, so octaves never align into a grid
        }
        return s / n;
      }

      // Ridged noise: sharp creases instead of soft lumps. This is what gives
      // the dust its filament edges — plain fbm can only ever make clouds.
      float ridged(vec3 p, int oct) {
        float s = 0.0, a = 0.5, n = 0.0;
        for (int i = 0; i < 8; i++) {
          if (i >= oct) break;
          float v = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
          s += v * v * a;
          n += a;
          a *= 0.5;
          p *= 2.13;
        }
        return s / n;
      }

      // Smooth lobe around an axis, used to give each colour its own region of
      // the sky. Without this every layer is isotropic and the whole sphere
      // averages to the same blue, with no colour geography anywhere.
      float lobe(vec3 d, vec3 axis, float width) {
        return pow(clamp(dot(d, normalize(axis)) * 0.5 + 0.5, 0.0, 1.0), width);
      }

      void main() {
        float lon = vUv.x * 6.2831853;
        float lat = (vUv.y - 0.5) * 3.1415927;
        vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

        // Shared flow field: emission and dust follow the same warp, so the
        // clouds read as one structure rather than unrelated overlays.
        vec3 w = vec3(
          fbm(d * 1.3 + vec3(3.1, 0.0, 0.0), 4),
          fbm(d * 1.3 + vec3(0.0, 5.7, 0.0), 4),
          fbm(d * 1.3 + vec3(0.0, 0.0, 1.9), 4)) - 0.5;

        vec3 col = vec3(0.0);
        float peak = 0.0;

        // --- emission layers: colour, axis, lobe width, freq, warp, bias, gain
        #define LAYER(C, AX, LW, FR, WP, BI, GA, SEED, EX) { \
          float n = fbm(d * FR + w * WP + vec3(SEED), 6); \
          n = clamp((n - BI) / (1.0 - BI), 0.0, 1.0) * lobe(d, AX, LW); \
          col += (C) * pow(n, EX) * GA; \
          peak = max(peak, n); }

        LAYER(vec3(0.16, 0.42, 1.00), vec3( 0.2,  0.3,  1.0), 2.0, 1.25, 1.7, 0.46, 1.70, 11.0, 1.9)
        LAYER(vec3(0.10, 0.70, 0.95), vec3(-0.6,  0.5,  0.6), 2.4, 2.10, 1.2, 0.50, 1.15, 47.0, 2.1)
        LAYER(vec3(0.78, 0.13, 0.62), vec3(-0.9, -0.2, -0.4), 3.0, 1.50, 2.0, 0.47, 1.30, 83.0, 2.0)
        LAYER(vec3(0.92, 0.24, 0.18), vec3(-0.3, -0.7,  0.5), 3.0, 2.60, 1.0, 0.52, 0.85, 29.0, 2.2)
        LAYER(vec3(0.30, 0.85, 0.80), vec3( 0.8, -0.4,  0.1), 3.0, 3.20, 0.8, 0.55, 0.75, 61.0, 2.4)

        // Fine emission detail layered on the broad clouds, so there is
        // structure at every scale from the whole sky down to a few pixels.
        float fine = ridged(d * 9.0 + w * 2.0, 5);
        fine = clamp((fine - 0.55) / 0.45, 0.0, 1.0);
        col *= 0.72 + 0.85 * fine;

        // Ionised cores, pushed above 1.0 so the bloom pass catches them.
        float core = pow(smoothstep(0.50, 0.63, peak), 3.0) * (0.45 + 0.55 * fine);
        col += vec3(1.1, 1.25, 1.5) * core * 1.7;

        // Dark dust, full resolution and ridged.
        float dl = ridged(d * 2.6 + w * 1.5, 6);
        float dust = clamp((dl - 0.40) / 0.60, 0.0, 1.0);
        col *= 1.0 - dust * dust * 0.93;

        // Faint broad haze so the empty quarters of the sky still carry depth
        // instead of reading as dead black.
        float haze = fbm(d * 0.8, 3);
        col += vec3(0.012, 0.020, 0.045) * smoothstep(0.35, 0.85, haze);

        // Unresolved star haze, one candidate per cell with most rejected.
        for (int oct = 0; oct < 2; oct++) {
          float cells = 420.0 * pow(2.0, float(oct));
          vec3 gp = d * cells;
          vec3 id = floor(gp);
          float r1 = hash3(id + 11.0);
          if (r1 > 0.10 + 0.05 * float(oct)) continue;
          vec3 off = vec3(hash3(id + 3.0), hash3(id + 7.0), hash3(id + 13.0));
          float dist = length(fract(gp) - off);
          float mag = 0.35 + 0.65 * hash3(id + 23.0);
          float s = smoothstep(0.16, 0.0, dist) * mag / pow(2.0, float(oct));
          float t = hash3(id + 29.0);
          vec3 sc = t < 0.62 ? vec3(0.80, 0.86, 1.00)
                  : t < 0.86 ? vec3(1.00, 0.95, 0.86)
                             : vec3(1.00, 0.80, 0.70);
          col += sc * s * 1.6;
        }

        fragColor = vec4(max(col, vec3(0.004, 0.006, 0.014)), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeScene = new THREE.Scene();
  bakeScene.add(quad);

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(bakeScene, cam);
  renderer.setRenderTarget(prevTarget);

  quad.geometry.dispose();
  material.dispose();

  _sky = rt.texture;
  _sky.mapping = THREE.EquirectangularReflectionMapping;
  _sky.wrapS = THREE.RepeatWrapping;
  _sky.anisotropy = 8;
  return _sky;
}

let _beam = null;

/**
 * Alpha ramp for the tractor beam, running along the cone's height: solid at
 * the apex, banded down the length, gone by the mouth.
 *
 * The fade matters more than it sounds. The mouth of the cone lands on the
 * player's canopy, and a cone with a flat alpha turns into a full-screen blue
 * wash the moment the beam opens — you cannot see the boss that is taking you.
 */
export function beamTexture() {
  if (_beam) return _beam;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d');
  // v = 0 is the mouth, v = 1 the apex, and canvas y runs the other way.
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(210,235,255,0.9)');
  grd.addColorStop(0.5, 'rgba(120,190,255,0.32)');
  grd.addColorStop(0.8, 'rgba(70,150,255,0.05)');
  grd.addColorStop(1, 'rgba(60,130,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  // Bands, so the cone reads as light travelling down it once it is scrolled.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 8; i++) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, i * 16 + 11, 4, 5);
  }
  g.globalCompositeOperation = 'source-over';
  _beam = new THREE.CanvasTexture(c);
  _beam.wrapT = THREE.RepeatWrapping;
  return _beam;
}

/** Point sprite for the resolved starfield: tight core, soft halo, faint cross. */
export function starTexture() {
  if (_star) return _star;
  const c = canvas(64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 26);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(200,220,255,0.12)');
  grd.addColorStop(1, 'rgba(160,190,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.30)';
  g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(32, 8); g.lineTo(32, 56); g.stroke();
  g.beginPath(); g.moveTo(8, 32); g.lineTo(56, 32); g.stroke();
  _star = new THREE.CanvasTexture(c);
  return _star;
}

/**
 * Bright foreground star: tight core, wide halo and a four-point diffraction
 * cross. Drawn big and downscaled by the sprite so the spikes stay clean.
 */
export function starFlareTexture() {
  if (_flare) return _flare;
  const N = 256;
  const M = N / 2;
  const c = canvas(N);
  const g = c.getContext('2d');

  const halo = g.createRadialGradient(M, M, 0, M, M, M);
  halo.addColorStop(0, 'rgba(255,255,255,1)');
  halo.addColorStop(0.06, 'rgba(230,242,255,0.85)');
  halo.addColorStop(0.22, 'rgba(150,190,255,0.20)');
  halo.addColorStop(0.55, 'rgba(90,130,220,0.05)');
  halo.addColorStop(1, 'rgba(60,90,180,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, N, N);

  // Spikes: a long thin gradient bar drawn twice, rotated.
  g.globalCompositeOperation = 'lighter';
  for (const angle of [0, Math.PI / 2]) {
    g.save();
    g.translate(M, M);
    g.rotate(angle);
    const spike = g.createLinearGradient(-M, 0, M, 0);
    spike.addColorStop(0, 'rgba(180,210,255,0)');
    spike.addColorStop(0.42, 'rgba(210,230,255,0.35)');
    spike.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    spike.addColorStop(0.58, 'rgba(210,230,255,0.35)');
    spike.addColorStop(1, 'rgba(180,210,255,0)');
    g.fillStyle = spike;
    g.fillRect(-M, -3, N, 6);
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';

  _flare = new THREE.CanvasTexture(c);
  return _flare;
}

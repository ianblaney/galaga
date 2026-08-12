// The cockpit renderer.
//
// This draws the existing 2D game, unchanged, as a first-person view. The
// simulation in game.js still runs in 224x288 arcade pixels and knows nothing
// about any of this; every frame we read its entities and place geometry.
//
// The mapping is the whole idea:
//
//   arcade x   ->  lateral offset      (left/right stays left/right)
//   arcade y   ->  distance ahead      (the top of the playfield is the far
//                                       end of the tunnel, PLAYER_Y is your
//                                       own canopy)
//
// So the formation hangs off in the distance, a dive comes down the tunnel at
// you, and the tractor beam opens directly overhead.
//
// The subtlety is that the playfield must not be a flat plane, because a plane
// through the eye projects to a single line — the first cut of this drew all
// five formation rows on top of each other. Instead an arcade row is given an
// *elevation* as well as a distance: the top of the playfield sits high in the
// windscreen and the player's own row sits down on the coaming, with the rows
// in between spread across the glass the way they are spread down the cabinet
// screen. Distance falls off separately, so a dive both descends and closes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { W, H } from '../sprites.js';
import { buildBackdrop } from './backdrop.js';
import { buildCockpit } from './cockpit.js';
import { makeEnemy, makeFighter, makeTracer, makeBlast, makeBeam, setBossDamaged, PAL } from './models.js';
import { starTexture, starFlareTexture } from './textures.js';

const PLAYER_Y = 258; // must match game.js — the arcade row the ship flies on

// Lateral is linear in world units, so a shot fired straight ahead hits the
// enemy that is directly above you on the cabinet. Everything else is angular.
const XS = 0.085; // world units per arcade pixel, across

const ELEV = 0.72; // radians of elevation at the top of the playfield
const DNEAR = 0.6; // distance of the player's own row
const DFAR = 22; // distance of the top of the playfield
const PITCH = 0.26; // radians the whole rig looks up by, to clear the panel

/** How far up the playfield an arcade row is: 1 at the top, 0 at the player. */
const upOf = (y) => (PLAYER_Y - y) / PLAYER_Y;

const elevationOf = (y) => ELEV * upOf(y);
const distanceOf = (y) => DNEAR + (DFAR - DNEAR) * upOf(y);
const lateralOf = (x) => (x - W / 2) * XS;

const TMP = new THREE.Vector3();

/** World position of an arcade point. */
function worldOf(x, y, out = new THREE.Vector3()) {
  const th = elevationOf(y);
  const d = distanceOf(y);
  return out.set(lateralOf(x), d * Math.sin(th), -d * Math.cos(th));
}

/**
 * A pool keyed on the game's own entity objects. The simulation rebuilds its
 * arrays every frame (`filter` on dead entities), but the objects inside them
 * persist, so identity is a reliable key and a mark-and-sweep keeps the scene
 * graph in step without any bookkeeping in game.js.
 */
class Pool {
  constructor(parent, make) {
    this.parent = parent;
    this.make = make;
    this.live = new Map();
    this.seen = new Set();
  }

  begin() {
    this.seen.clear();
  }

  get(key, ...args) {
    let obj = this.live.get(key);
    if (!obj) {
      obj = this.make(...args);
      this.parent.add(obj);
      this.live.set(key, obj);
    }
    this.seen.add(key);
    obj.visible = true;
    return obj;
  }

  end() {
    for (const [key, obj] of this.live) {
      if (this.seen.has(key)) continue;
      this.parent.remove(obj);
      this.live.delete(key);
    }
  }
}

// Floating score pop-ups. The set of strings a run can produce is small, so
// each one is baked once and reused.
const scoreTextures = new Map();
function scoreTexture(text) {
  if (scoreTextures.has(text)) return scoreTextures.get(text);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 40px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#40d0e0';
  g.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scoreTextures.set(text, tex);
  return tex;
}

export class View3D {
  constructor(canvas, { bloom = true } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 2000);

    // The rig is the airframe: it carries the eye and the cockpit, slides with
    // the ship, and looks up by PITCH so the playfield sits above the panel.
    this.rig = new THREE.Group();
    this.rig.rotation.x = PITCH;
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.cockpit = buildCockpit();
    this.rig.add(this.cockpit.group);

    // Everything the simulation owns lives in the field. It has no transform of
    // its own — worldOf() already returns world coordinates — but keeping it as
    // one node makes the scene graph legible and the pools cheap to parent.
    this.field = new THREE.Group();
    this.scene.add(this.field);

    this.backdrop = buildBackdrop(this.scene, this.renderer);

    // Lighting. The ships are emissive enough to read on their own; these are
    // for shape, and for the cockpit interior which has no emission at all.
    this.scene.add(new THREE.AmbientLight(0x404a6a, 1.1));
    const key = new THREE.DirectionalLight(0xbfd4ff, 1.5);
    key.position.set(-0.6, 1, 0.4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff7a5a, 0.45);
    rim.position.set(0.8, -0.3, -1);
    this.scene.add(rim);
    // A lamp inside the cockpit, parented to the rig so it slides along. Kept
    // weak: the panel is meant to be a dark shape you read instruments off,
    // not a lit surface competing with the ships outside.
    const panelLight = new THREE.PointLight(0x88a0d8, 1.1, 3.5, 2);
    panelLight.position.set(0, -0.10, -0.55);
    this.rig.add(panelLight);

    // Pools, all parented to the field.
    this.enemyPool = new Pool(this.field, (type) => {
      const m = makeEnemy(type);
      m.userData.base = m.scale.x;
      return m;
    });
    this.playerShotPool = new Pool(this.field, () => makeTracer(PAL.C, 0.55));
    this.enemyShotPool = new Pool(this.field, () => makeTracer(PAL.Y, 0.36, 0.024));
    this.blastPool = new Pool(this.field, () => makeBlast(starFlareTexture()));
    this.sparkPool = new Pool(this.field, () => makeBlast(starTexture()));
    this.beamPool = new Pool(this.field, () => makeBeam());
    this.textPool = new Pool(this.field, () => new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })));

    // The captured fighter, the rescued one, and your wingman once you go dual.
    this.captiveMesh = makeFighter(PAL.P);
    this.captiveMesh.visible = false;
    this.field.add(this.captiveMesh);
    this.rescueMesh = makeFighter(PAL.P);
    this.rescueMesh.visible = false;
    this.field.add(this.rescueMesh);
    this.wingman = makeFighter();
    this.wingman.visible = false;
    this.field.add(this.wingman);

    if (bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Restrained: the ships are small and bright, and a heavy bloom smeared
      // the whole formation into one white bar.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.34, 0.35, 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.eye = new THREE.Vector3();
    this.time = 0;
    this.shake = 0;
    this.prevLives = null;
    this.prevShots = 0;
    this.lateral = 0;
    this.prevPlayerX = W / 2;
  }

  /** CSS pixel size of the view. Called by the same resize pass as the 2D canvas. */
  setSize(w, h) {
    // Phones get a lower cap: the bloom pass costs real time at 3x on a small
    // GPU, and at this canvas size the difference is not visible anyway.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Screen offset, in HUD canvas pixels, of a world point. The HUD plane is
   * 1.30 wide at 0.92 ahead of the eye, so its half-angle is fixed; scaling NDC
   * by the ratio of the camera's half-angle to the HUD's puts a projected point
   * on the right bit of glass.
   */
  hudOffset(world) {
    const ndc = world.clone().project(this.camera);
    if (ndc.z > 1) return null; // behind the eye — there is no glass for it
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * this.camera.aspect;
    const hudTan = 0.65 / 0.92;
    return {
      sx: ndc.x * (tanH / hudTan) * 256,
      sy: -ndc.y * (tanV / hudTan) * 256,
    };
  }

  /** Place a mesh at an arcade point. */
  place(mesh, x, y) {
    worldOf(x, y, mesh.position);
    return mesh;
  }

  /**
   * Place a mesh and aim its nose along the arcade heading it is travelling on.
   * Sampling a second arcade point rather than rotating by an angle keeps the
   * orientation honest: the corridor curves, so "up the screen" is a different
   * world direction at the near end than at the far end.
   */
  aim(mesh, x, y, ax, ay) {
    worldOf(x, y, mesh.position);
    worldOf(ax, ay, TMP);
    if (TMP.distanceToSquared(mesh.position) > 1e-8) mesh.lookAt(TMP);
    return mesh;
  }

  draw(game, dt) {
    this.time += dt;

    const p = game.player;
    const playerX = p ? p.x : W / 2;

    // Steering signal for the stick. Taken from how the ship actually moved, so
    // it works identically for the slide strip, the arrow keys, and the
    // headless bot — nothing has to tell the cockpit which input is in use.
    const moved = (playerX - this.prevPlayerX) / Math.max(dt, 1e-4);
    this.prevPlayerX = playerX;
    // 200px/s is roughly what a hard slide asks for, so a flick across the
    // strip pins the stick and a nudge on the arrow keys leans it.
    const target = Math.max(-1, Math.min(1, moved / 200));
    this.lateral += (target - this.lateral) * Math.min(1, dt * 14);

    // Camera shake when you lose a ship.
    if (this.prevLives != null && game.lives != null && game.lives < this.prevLives) {
      this.shake = 1;
    }
    this.prevLives = game.lives;
    this.shake = Math.max(0, this.shake - dt * 1.6);

    const bank = -this.lateral * 0.16;
    this.rig.position.set(lateralOf(playerX), 0, 0);
    this.rig.rotation.set(PITCH, 0, bank);
    if (this.shake > 0) {
      const k = this.shake * this.shake * 0.12;
      this.rig.position.x += (Math.random() * 2 - 1) * k;
      this.rig.position.y += (Math.random() * 2 - 1) * k;
      this.rig.rotation.z += (Math.random() * 2 - 1) * k * 0.6;
    }

    this.camera.updateMatrixWorld(true);
    this.eye.setFromMatrixPosition(this.camera.matrixWorld);
    this.backdrop.update(dt, this.eye, game.state !== 'title');

    this.syncEnemies(game);
    this.syncShots(game);
    this.syncEffects(game);
    this.syncFriendlies(game);

    this.cockpit.update(dt, this.cockpitState(game, dt));

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  syncEnemies(game) {
    const pool = this.enemyPool;
    const beams = this.beamPool;
    pool.begin();
    beams.begin();

    for (const e of game.enemies) {
      if (e.state === 'idle') continue;
      const mesh = pool.get(e, e.type);
      // Aim at where the enemy will be a moment from now, in arcade terms —
      // which is the same heading the sprite is rotated to in the flat view,
      // but bent along the corridor.
      this.aim(mesh, e.x, e.y, e.x + Math.cos(e.angle) * 6, e.y + Math.sin(e.angle) * 6);

      // Wings flap in formation, exactly as the sprite squashes.
      const base = mesh.userData.base;
      const flap = e.state === 'form' && Math.floor(this.time * 3) % 2 === 0 ? 0.82 : 1;
      mesh.scale.set(base * flap, base, base);

      if (e.type === 'boss') setBossDamaged(mesh, e.hp < 2);

      if (e.state === 'beam' && !e.path) {
        const { top, length, halfWidth, k } = game.beamShape(e);
        // The cone is stopped well short of the canopy. The arcade beam is a
        // fifth of the playfield wide, and a mouth that size a couple of units
        // from the eye subtends most of the windscreen — the first cut of this
        // was a blue wash with the boss lost somewhere inside it. Drawing the
        // upper two thirds says "beam" perfectly well; the caution lamps and
        // the HUD say the rest.
        const mouth = Math.min(top + length, PLAYER_Y - 55);
        if (k > 0 && mouth > top + 4) {
          const cone = beams.get(e);
          // Apex on the boss, mouth on the arcade row the cone reaches down to.
          this.aim(cone, e.x, top, e.x, mouth);
          const reach = worldOf(e.x, mouth, TMP).distanceTo(cone.position);
          const r = Math.max(0.01, halfWidth * XS * 0.55);
          cone.scale.set(r, r, reach);
          // Scroll the bands down the cone: this is the light travelling, and
          // it is what makes the beam read as a beam rather than a blue solid.
          cone.material.map.offset.y = (this.time * 0.9) % 1;
          cone.material.opacity = 0.22 + 0.20 * k;
        }
      }

      // A docked captive rides under the boss that took it.
      if (e.captive) {
        const held = this.captiveMesh;
        held.visible = true;
        this.aim(held, e.x, e.y + 13, e.x, e.y + 19);
        this.captiveHeld = true;
      }
    }

    pool.end();
    beams.end();
  }

  syncShots(game) {
    this.playerShotPool.begin();
    for (const b of game.playerBullets) {
      // Your shots run straight up the playfield, so straight down the tunnel.
      this.aim(this.playerShotPool.get(b), b.x, b.y, b.x, b.y - 8);
    }
    this.playerShotPool.end();

    this.enemyShotPool.begin();
    for (const b of game.enemyBullets) {
      // Enemy fire is aimed, so point it where it is actually going.
      const m = this.enemyShotPool.get(b);
      const k = 8 / (Math.hypot(b.vx, b.vy) || 1);
      this.aim(m, b.x, b.y, b.x + b.vx * k, b.y + b.vy * k);
    }
    this.enemyShotPool.end();
  }

  syncEffects(game) {
    this.blastPool.begin();
    this.sparkPool.begin();
    this.textPool.begin();

    for (const x of game.explosions) {
      const f = x.t / x.dur;
      if (x.text) {
        const s = this.textPool.get(x);
        s.material.map = scoreTexture(x.text);
        s.material.opacity = 1 - f * f;
        this.place(s, x.x, x.y - f * 8);
        s.scale.set(1.1, 0.55, 1);
        continue;
      }
      const pool = x.spark ? this.sparkPool : this.blastPool;
      const s = pool.get(x);
      this.place(s, x.x, x.y);
      const r = (x.big ? 3.4 : 1.9) * (0.35 + f * 1.3);
      s.scale.set(r, r, 1);
      s.material.opacity = Math.max(0, 1 - f);
      s.material.color.setRGB(1, 0.72 - f * 0.4, 0.28 - f * 0.2);
    }

    this.blastPool.end();
    this.sparkPool.end();
    this.textPool.end();
  }

  syncFriendlies(game) {
    // The captive under a boss is placed in syncEnemies; anything else is a
    // captive still being towed, or one flying home.
    if (game.captive) {
      // Still under tow: tumbling, so it is drawn spinning rather than aimed.
      this.captiveMesh.visible = true;
      this.place(this.captiveMesh, game.captive.x, game.captive.y);
      this.captiveMesh.rotation.set(0.4, game.captive.spin, 0);
    } else if (!this.captiveHeld) {
      this.captiveMesh.visible = false;
    }
    this.captiveHeld = false;

    if (game.rescue) {
      // Flying home to dock on your wing, so it points the way you point.
      this.rescueMesh.visible = true;
      this.aim(this.rescueMesh, game.rescue.x, game.rescue.y, game.rescue.x, game.rescue.y - 8);
    } else {
      this.rescueMesh.visible = false;
    }

    // Your second fighter. It really does sit 8px off your beam, but at that
    // offset it would be behind the canopy rail — so it is flown a little way
    // out ahead, where you can see it holding station off your wing.
    const p = game.player;
    const dual = p && p.alive && p.dual;
    this.wingman.visible = !!dual;
    if (dual) {
      this.aim(this.wingman, p.x + 8, PLAYER_Y - 26, p.x + 8, PLAYER_Y - 34);
      this.wingman.position.x += 0.55;
      this.wingman.position.y -= 0.30;
    }
  }

  /** Assemble the state the instruments read. */
  cockpitState(game, dt) {
    const p = game.player;
    const contacts = [];
    let threat = null;
    let threatDist = Infinity;
    let beaming = false;

    for (const e of game.enemies) {
      if (e.state === 'idle') continue;
      contacts.push({ x: e.x, y: e.y, type: e.type, state: e.state });
      if (e.state === 'beam') beaming = true;
      if (e.state !== 'dive' && e.state !== 'beam') continue;
      const d = distanceOf(e.y);
      if (d > threatDist) continue;
      threatDist = d;
      threat = e;
    }

    let threatHud = null;
    if (threat) {
      const at = this.hudOffset(worldOf(threat.x, threat.y, TMP));
      if (at) threatHud = { sx: at.sx, sy: at.sy, dist: threatDist };
    }

    // `shots` only exists once a game is running, and NaN comparisons would
    // quietly leave the trigger lamp in whatever state it was last in.
    const shots = Number.isFinite(game.shots) ? game.shots : 0;
    const firing = shots > this.prevShots;
    this.prevShots = shots;

    const alive = game.enemies.length;
    return {
      time: this.time,
      lateral: this.lateral,
      firing,
      flying: game.state !== 'title',
      contacts,
      threat: threatHud,
      playerX: p ? p.x : W / 2,
      playerY: PLAYER_Y,
      playerAlive: !!(p && p.alive),
      score: game.score || 0,
      stage: game.stage || 0,
      lives: game.lives || 0,
      dual: !!(p && p.dual),
      guns: p && p.dual ? 1 : 0.5,
      formation: game.stageTotal ? alive / game.stageTotal : 0,
      beaming,
      captured: !!game.captive,
    };
  }
}

import { W, H, SPR, drawText } from './sprites.js';
import { entryPath, attackPath, offsetPath, beamApproachPath, reentryPath, challengePath } from './paths.js';
import { Stars } from './stars.js';
import { sfx } from './audio.js';

// --- Layout ---------------------------------------------------------------

const COL_W = 16;
const ROW_H = 16;
const FORM_TOP = 40;
const PLAYER_Y = 258;
const PLAYER_MIN_X = 10;
const PLAYER_MAX_X = W - 10;

// row -> enemy type and which columns are occupied
const ROW_PLAN = [
  { type: 'boss', cols: [3, 4, 5, 6] },
  { type: 'butterfly', cols: [1, 2, 3, 4, 5, 6, 7, 8] },
  { type: 'butterfly', cols: [1, 2, 3, 4, 5, 6, 7, 8] },
  { type: 'bee', cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { type: 'bee', cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
];

// Five flights of eight, in the order the arcade sends them in.
const FLIGHTS = [
  [[0, 3], [0, 4], [0, 5], [0, 6], [1, 3], [1, 4], [1, 5], [1, 6]],
  [[1, 1], [1, 2], [1, 7], [1, 8], [2, 1], [2, 2], [2, 7], [2, 8]],
  [[2, 3], [2, 4], [2, 5], [2, 6], [3, 0], [3, 1], [3, 8], [3, 9]],
  [[3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [4, 0], [4, 1]],
  [[4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9]],
];

const SIZES = {
  bee: { w: 13, h: 11 },
  butterfly: { w: 13, h: 11 },
  boss: { w: 15, h: 11 },
};

const SCORE = {
  bee: { form: 50, dive: 100 },
  butterfly: { form: 80, dive: 160 },
  boss: { form: 150, dive: 400 },
};

// Fragment colours for each kind of ship when it blows, taken off its sprite.
const DEBRIS = {
  bee: ['#f4d03f', '#3060d0', '#ffffff'],
  butterfly: ['#e02020', '#ffffff', '#3060d0'],
  boss: ['#38b24a', '#c040c0', '#f4d03f', '#3060d0'],
  player: ['#ffffff', '#e02020', '#40d0e0', '#ffe070'],
};

const EXTRA_LIFE_FIRST = 20000;
const EXTRA_LIFE_EVERY = 70000;

const isChallenge = (stage) => stage % 4 === 3;

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return (
    Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh
  );
}

// --- Entities -------------------------------------------------------------

class Enemy {
  constructor(type, row, col) {
    this.type = type;
    this.row = row;
    this.col = col;
    this.x = W / 2;
    this.y = -20;
    this.angle = Math.PI / 2;
    this.state = 'idle';
    this.path = null;
    this.dist = 0;
    this.speed = 96;
    this.hp = type === 'boss' ? 2 : 1;
    this.captive = false;
    this.escorts = [];
    this.fireCd = 0.4 + Math.random() * 0.6;
    this.beamT = 0;
    this.dead = false;
  }

  get size() {
    return SIZES[this.type];
  }

  get sprite() {
    if (this.type !== 'boss') return SPR[this.type];
    return this.hp === 2 ? SPR.boss : SPR.bossHit;
  }

  follow(pts, state, speed) {
    this.path = pts;
    this.dist = 0;
    this.state = state;
    if (speed) this.speed = speed;
  }
}

// --- Game -----------------------------------------------------------------

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    // Transparent, because in cockpit mode this canvas is only the HUD and the
    // 3D view sits behind it. draw() still paints its own black background
    // first, so the flat renderer is unaffected.
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.ctx.imageSmoothingEnabled = false;
    this.stars = new Stars();

    this.keys = new Set();
    this.firePressed = false;
    this.aimX = null;
    this.paused = false;
    this.muted = false;

    this.highScore = Number(localStorage.getItem('galaga.high') || 0);
    this.state = 'title';
    this.t = 0;
    this.banner = null;
    this.toTitle();
  }

  // --- lifecycle ----------------------------------------------------------

  toTitle() {
    this.state = 'title';
    this.enemies = [];
    this.playerBullets = [];
    this.enemyBullets = [];
    this.explosions = [];
    this.captive = null;
    this.rescue = null;
    this.entryQueue = [];
    this.banner = null;
    this.stars.scroll = true;
  }

  newGame() {
    this.score = 0;
    this.lives = 3;
    this.stage = 0;
    this.shots = 0;
    this.hits = 0;
    this.nextExtra = EXTRA_LIFE_FIRST;
    this.player = {
      x: W / 2,
      alive: true,
      dual: false,
      invuln: 1.2,
      respawnT: 0,
      fireCd: 0,
    };
    this.enemies = [];
    this.playerBullets = [];
    this.enemyBullets = [];
    this.explosions = [];
    this.captive = null;
    this.rescue = null;
    this.nextStage();
  }

  nextStage() {
    this.stage += 1;
    this.enemyBullets.length = 0;
    this.challengeHits = 0;
    this.buildStage();
    this.state = 'stageIntro';
    this.introT = isChallenge(this.stage) ? 2.4 : 2.0;
    this.showBanner(
      isChallenge(this.stage) ? 'CHALLENGING STAGE' : `STAGE ${this.stage}`,
      isChallenge(this.stage) ? '#38d0ff' : '#40d0e0',
      this.introT,
    );
    sfx.stage();
  }

  buildStage() {
    this.enemies = [];
    this.entryQueue = [];
    this.entryTimer = 0;
    this.formT = 0;
    this.diveTimer = 3.0;
    this.pendingDives = [];
    this.breath = 0;

    if (isChallenge(this.stage)) {
      // 40 enemies stream through in eight groups of five and never stop.
      let delay = 0.6;
      for (let g = 0; g < 8; g++) {
        const type = g < 2 ? 'bee' : g < 6 ? 'butterfly' : 'boss';
        const pts = challengePath(g, Math.floor(this.stage / 4));
        for (let i = 0; i < 5; i++) {
          const e = new Enemy(type, 0, 0);
          e.hp = 1; // challenge bosses die in one hit
          e.challengePath = pts;
          this.entryQueue.push({ enemy: e, at: delay, kind: 'flyby' });
          this.enemies.push(e);
          delay += 0.16;
        }
        delay += 0.7;
      }
      this.stageTotal = this.enemies.length;
      return;
    }

    const grid = new Map();
    for (const [row, plan] of ROW_PLAN.entries()) {
      for (const col of plan.cols) {
        grid.set(`${row},${col}`, new Enemy(plan.type, row, col));
      }
    }

    let delay = 0.5;
    FLIGHTS.forEach((flight, i) => {
      const pts = entryPath(i);
      for (const [row, col] of flight) {
        const e = grid.get(`${row},${col}`);
        if (!e) continue;
        this.entryQueue.push({ enemy: e, at: delay, kind: 'entry', path: pts });
        this.enemies.push(e);
        delay += 0.17;
      }
      delay += 0.55;
    });
    this.stageTotal = this.enemies.length;
  }

  showBanner(text, colour, time, sub = null) {
    this.banner = { text, colour, t: time, sub };
  }

  // --- input --------------------------------------------------------------

  onKeyDown(code) {
    sfx.resume();
    if (code === 'KeyM') {
      this.muted = sfx.toggleMute();
      return;
    }
    if (code === 'KeyP' && (this.state === 'play' || this.state === 'stageIntro')) {
      this.paused = !this.paused;
      return;
    }
    this.keys.add(code);
    if (code === 'Space' || code === 'Enter') {
      if (this.state === 'title') {
        sfx.coin();
        this.newGame();
      } else if (this.state === 'gameover' && this.overT <= 0) {
        this.toTitle();
      } else {
        this.firePressed = true;
      }
    }
  }

  onKeyUp(code) {
    this.keys.delete(code);
  }

  setTouch(dir, down) {
    if (down) this.keys.add(dir);
    else this.keys.delete(dir);
  }

  touchFire() {
    sfx.resume();
    if (this.state === 'title') {
      sfx.coin();
      this.newGame();
    } else if (this.state === 'gameover' && this.overT <= 0) {
      this.toTitle();
    } else {
      this.firePressed = true;
    }
  }

  // Steer straight to an x in arcade pixels (drag control). null hands control
  // back to the left/right keys.
  setAim(x) {
    this.aimX = x;
  }

  togglePause() {
    if (this.state !== 'play' && this.state !== 'stageIntro') return;
    sfx.resume();
    this.paused = !this.paused;
  }

  toggleMute() {
    sfx.resume();
    this.muted = sfx.toggleMute();
  }

  // --- update -------------------------------------------------------------

  update(dt) {
    this.t += dt;
    if (this.paused) return;

    this.stars.update(dt);

    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }

    switch (this.state) {
      case 'title':
        break;
      case 'stageIntro':
        this.introT -= dt;
        this.updatePlayer(dt);
        if (this.introT <= 0) this.state = 'play';
        break;
      case 'play':
      case 'dying':
        this.updatePlay(dt);
        break;
      case 'stageClear':
        this.clearT -= dt;
        this.updateEffects(dt);
        if (this.clearT <= 0) this.nextStage();
        break;
      case 'gameover':
        this.overT -= dt;
        this.updateEffects(dt);
        // Let the survivors fly off rather than freezing them mid-swoop.
        for (const e of this.enemies) {
          if (e.state !== 'form' && e.state !== 'idle') this.updateEnemy(e, dt);
        }
        if (this.overT < -8) this.toTitle();
        break;
    }

    this.firePressed = false;
  }

  updatePlay(dt) {
    this.entryTimer += dt;
    while (this.entryQueue.length && this.entryQueue[0].at <= this.entryTimer) {
      const job = this.entryQueue.shift();
      if (job.kind === 'flyby') {
        job.enemy.follow(job.enemy.challengePath, 'flyby', 108);
      } else {
        job.enemy.follow(job.path, 'entry', 104 + this.stage * 1.5);
      }
    }

    this.formT += dt;
    // Once the whole stage has flown in, the formation starts to breathe —
    // eased in, because anything sitting in a slot snaps to wherever it is.
    const assembled = !this.entryQueue.length && !this.enemies.some((e) => e.state === 'entry');
    this.breath += ((assembled ? 1 : 0) - this.breath) * Math.min(1, dt * 1.2);
    this.updatePlayer(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.updateDirector(dt);
    this.updateEffects(dt);
    this.updateCaptive(dt);
    this.updateRescue(dt);
    this.checkCollisions();
    this.checkStageEnd();
  }

  updateEffects(dt) {
    for (const x of this.explosions) x.t += dt;
    this.explosions = this.explosions.filter((x) => x.t < x.dur);
    for (const b of this.playerBullets) b.y += b.vy * dt;
    this.playerBullets = this.playerBullets.filter((b) => b.y > -8);
    for (const b of this.enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    this.enemyBullets = this.enemyBullets.filter(
      (b) => b.y < H + 8 && b.x > -8 && b.x < W + 8,
    );
  }

  // --- player -------------------------------------------------------------

  updatePlayer(dt) {
    const p = this.player;
    if (!p) return;

    if (!p.alive) {
      p.respawnT -= dt;
      // The new ship waits for the dives already under way to play out, so it
      // is never born into one. The cap is there in case one never does.
      const clear = p.respawnT < -6 || !this.enemies.some((e) => e.state === 'dive' || e.state === 'beam');
      if (p.respawnT <= 0 && clear && this.lives > 0 && this.state !== 'gameover') {
        p.alive = true;
        p.x = W / 2;
        p.invuln = 1.4;
        if (this.state === 'dying') this.state = 'play';
      }
      return;
    }

    p.invuln = Math.max(0, p.invuln - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);

    const speed = 108;
    if (this.aimX != null) {
      // Drag control: close the gap fast, but cap the rate so a flick across
      // the screen can't teleport the ship past incoming fire.
      const d = this.aimX - p.x;
      const step = speed * 2.2 * dt;
      p.x += Math.abs(d) <= step ? d : Math.sign(d) * step;
    } else {
      const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
      const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
      if (left) p.x -= speed * dt;
      if (right) p.x += speed * dt;
    }

    const margin = p.dual ? 17 : 7;
    p.x = Math.min(Math.max(p.x, PLAYER_MIN_X + margin - 7), PLAYER_MAX_X - margin + 7);

    // Auto-fire only once the stage is live: bullets do not travel during
    // stageIntro, so firing then just parks two frozen shots on the cap.
    const holding =
      this.keys.has('Space') || (this.keys.has('autoFire') && this.state === 'play');
    const maxShots = p.dual ? 4 : 2;
    if ((this.firePressed || holding) && p.fireCd <= 0 && this.playerBullets.length < maxShots) {
      this.fire();
    }
  }

  fire() {
    const p = this.player;
    p.fireCd = 0.16;
    this.shots += p.dual ? 2 : 1;
    const xs = p.dual ? [p.x - 8, p.x + 8] : [p.x];
    for (const x of xs) {
      this.playerBullets.push({ x, y: PLAYER_Y - 8, vy: -330 });
    }
    sfx.shoot();
  }

  /** @param hitX where the hit landed, which decides which half of a dual fighter goes. */
  killPlayer(hitX = this.player.x) {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return;
    if (p.dual) {
      // The arcade rule: a hit on a dual fighter costs only the half that was
      // hit, not a life. The survivor carries on from where it was flying.
      const side = hitX < p.x ? -1 : 1;
      this.explosions.push(this.blast(p.x + side * 8, PLAYER_Y, 'player', 0.7));
      p.dual = false;
      p.x -= side * 8;
      p.invuln = 0.5; // so the same volley cannot take the second one too
      sfx.playerDie();
      return;
    }
    p.alive = false;
    p.respawnT = 2.0;
    this.lives -= 1;
    this.explosions.push(this.blast(p.x, PLAYER_Y, 'player', 0.7));
    sfx.playerDie();
    if (this.lives <= 0) {
      this.gameOver();
    } else {
      this.state = 'dying';
    }
  }

  gameOver() {
    this.state = 'gameover';
    this.overT = 2.0;
    this.banner = null;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('galaga.high', String(this.highScore));
    }
  }

  addScore(n) {
    this.score += n;
    if (this.score > this.highScore) this.highScore = this.score;
    if (this.score >= this.nextExtra) {
      this.lives += 1;
      this.nextExtra += EXTRA_LIFE_EVERY;
      sfx.extraLife();
    }
  }

  // --- enemies ------------------------------------------------------------

  /** How far the formation has opened out on its breath: 0 closed, 1 open. */
  breathOpen() {
    return this.breath * (1 - Math.cos(this.formT * 1.7)) * 0.5;
  }

  slotX(col) {
    const aliveRatio = this.enemies.length / Math.max(1, this.stageTotal);
    const amp = 5 + (1 - aliveRatio) * 9;
    const spread = 1 + this.breathOpen() * 0.16;
    return W / 2 + (col - 4.5) * COL_W * spread + Math.sin(this.formT * 1.15) * amp;
  }

  slotY(row) {
    return FORM_TOP + row * ROW_H * (1 + this.breathOpen() * 0.2);
  }

  advance(e, dt) {
    e.dist += e.speed * dt;
    const i = e.dist / 2; // paths sample every 2px
    const idx = Math.floor(i);
    if (idx >= e.path.length - 1) {
      const last = e.path[e.path.length - 1];
      const prev = e.path[e.path.length - 2] || last;
      e.x = last.x;
      e.y = last.y;
      e.angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      return true;
    }
    const a = e.path[idx];
    const b = e.path[idx + 1];
    const f = i - idx;
    e.x = a.x + (b.x - a.x) * f;
    e.y = a.y + (b.y - a.y) * f;
    e.angle = Math.atan2(b.y - a.y, b.x - a.x);
    return false;
  }

  updateEnemy(e, dt) {
    switch (e.state) {
      case 'idle':
        return;

      case 'flyby': {
        const done = this.advance(e, dt);
        if (done || e.y > H + 20 || e.x < -30 || e.x > W + 30) e.dead = true;
        break;
      }

      case 'entry':
      case 'return': {
        if (this.advance(e, dt)) e.state = 'toslot';
        // From stage 2 the incoming flights take the odd shot on their way in,
        // as the arcade ones do — but only from high up, never point-blank.
        if (e.state === 'entry' && this.stage >= 2 && e.y > 30 && e.y < 160) {
          this.maybeShoot(e, dt, 0.35);
        }
        break;
      }

      case 'dive': {
        // Re-enter from the top once the enemy leaves the screen — or as soon
        // as the path runs out, so a short dive can never strand it.
        const done = this.advance(e, dt);
        this.maybeShoot(e, dt);
        if (done || e.y > H + 16) {
          e.follow(reentryPath(20 + Math.random() * (W - 40)), 'return', 104);
        }
        break;
      }

      case 'beam': {
        if (e.path) {
          if (this.advance(e, dt)) {
            e.path = null;
            e.beamT = 0;
            e.angle = Math.PI / 2;
            sfx.beam();
          }
          break;
        }
        e.beamT += dt;
        this.updateBeam(e);
        if (e.beamT > 3.4) {
          e.beamT = 0;
          e.state = 'toslot';
        }
        break;
      }

      case 'toslot': {
        const tx = this.slotX(e.col);
        const ty = this.slotY(e.row);
        const dx = tx - e.x;
        const dy = ty - e.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) {
          e.x = tx;
          e.y = ty;
          e.state = 'form';
          e.angle = Math.PI / 2;
        } else {
          const step = Math.min(d, 130 * dt);
          e.x += (dx / d) * step;
          e.y += (dy / d) * step;
          // Ease the sprite back upright as it settles.
          const target = Math.atan2(dy, dx);
          e.angle += Math.atan2(Math.sin(target - e.angle), Math.cos(target - e.angle)) * Math.min(1, 8 * dt);
        }
        break;
      }

      case 'form': {
        e.x = this.slotX(e.col);
        e.y = this.slotY(e.row);
        e.angle = Math.PI / 2;
        break;
      }
    }
  }

  /** @param chance scales the odds of a shot, for flights that fire sparingly. */
  maybeShoot(e, dt, chance = 1) {
    if (isChallenge(this.stage)) return;
    if (!this.player.alive) return;
    e.fireCd -= dt;
    if (e.fireCd > 0) return;
    e.fireCd = 0.6 + Math.random() * 1.0;
    // Only shoot on the way down, and ease off in the opening stages.
    if (e.y > PLAYER_Y - 40) return;
    if (Math.random() > Math.min(0.5, 0.22 + this.stage * 0.04) * chance) return;
    const speed = 100 + this.stage * 3;
    const dx = this.player.x - e.x;
    const dy = PLAYER_Y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    this.enemyBullets.push({ x: e.x, y: e.y + 6, vx: (dx / d) * speed, vy: (dy / d) * speed });
    sfx.enemyShoot();
  }

  /** The tractor beam cone: half-width grows with the animation, capped. */
  beamShape(e) {
    const open = Math.min(1, e.beamT / 0.6);
    const close = e.beamT > 2.8 ? 1 - (e.beamT - 2.8) / 0.6 : 1;
    const k = Math.max(0, Math.min(open, close));
    return { top: e.y + 5, length: 150 * k, halfWidth: 22 * k, k };
  }

  updateBeam(e) {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || this.captive || e.captive) return;
    const { top, length, halfWidth, k } = this.beamShape(e);
    if (k < 0.9) return;
    const dy = PLAYER_Y - top;
    if (dy < 0 || dy > length) return;
    const halfAt = 4 + (halfWidth - 4) * (dy / length);
    if (Math.abs(p.x - e.x) > halfAt) return;

    // Captured.
    p.alive = false;
    p.dual = false;
    p.respawnT = 2.6;
    this.lives -= 1;
    this.captive = { x: p.x, y: PLAYER_Y, boss: e, spin: 0 };
    e.beamT = 2.8; // retract the beam now that it has its prize
    sfx.capture();
    this.showBanner('FIGHTER CAPTURED', '#c040c0', 2.0);
    if (this.lives <= 0) this.gameOver();
  }

  updateCaptive(dt) {
    const c = this.captive;
    if (!c) return;
    c.spin += dt * 7;
    const boss = c.boss;
    const tx = boss.x;
    const ty = boss.y + 13;
    const dx = tx - c.x;
    const dy = ty - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 3 || boss.dead) {
      if (!boss.dead) boss.captive = true;
      this.captive = null;
      return;
    }
    const step = Math.min(d, 70 * dt);
    c.x += (dx / d) * step;
    c.y += (dy / d) * step;
  }

  updateRescue(dt) {
    const r = this.rescue;
    if (!r) return;
    const p = this.player;
    if (!p.alive) return; // hover until there is a ship to dock with
    const dx = p.x - r.x;
    const dy = PLAYER_Y - r.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) {
      p.dual = true;
      this.rescue = null;
      this.addScore(1000);
      this.showBanner('DUAL FIGHTER', '#40d0e0', 1.6);
      sfx.rescue();
      return;
    }
    const step = Math.min(d, 90 * dt);
    r.x += (dx / d) * step;
    r.y += (dy / d) * step;
  }

  // --- attack director ----------------------------------------------------

  updateDirector(dt) {
    if (isChallenge(this.stage)) return;
    if (this.entryQueue.length) return;
    if (this.state !== 'play') return;
    // Nobody attacks an empty sky: with no ship to aim at, the director waits,
    // which is also what lets the dives in flight clear before a respawn.
    if (!this.player.alive) return;

    // Escorts launch a beat after their leader; they wait in this queue so a
    // pause or a stage change can't strand them.
    for (const job of this.pendingDives) job.at -= dt;
    for (const job of this.pendingDives) {
      if (job.at <= 0 && !job.enemy.dead && job.enemy.state === 'form') {
        this.startDive(job.enemy, job.dir, job.lead);
      }
    }
    this.pendingDives = this.pendingDives.filter((job) => job.at > 0 && !job.enemy.dead);

    this.diveTimer -= dt;
    if (this.diveTimer > 0) return;

    const inForm = this.enemies.filter((e) => e.state === 'form');
    if (!inForm.length) return;

    // Fewer enemies left -> more aggressive, and later stages press harder.
    const pressure = 1 - this.enemies.length / this.stageTotal;
    this.diveTimer = Math.max(0.5, 2.3 - this.stage * 0.06 - pressure * 1.1) * (0.7 + Math.random() * 0.6);

    const bosses = inForm.filter((e) => e.type === 'boss' && !e.captive);
    const wantBeam =
      bosses.length &&
      this.player.alive &&
      !this.player.dual &&
      !this.captive &&
      !this.enemies.some((e) => e.state === 'beam') &&
      Math.random() < 0.3;

    if (wantBeam) {
      const boss = bosses[(Math.random() * bosses.length) | 0];
      boss.follow(beamApproachPath(boss.x, boss.y, this.player.x), 'beam', 88);
      sfx.dive();
      return;
    }

    const leader = inForm[(Math.random() * inForm.length) | 0];
    const dir = leader.x < W / 2 ? -1 : 1;
    // Aimed at where you are now, give or take — so standing still is not safe,
    // and moving is what makes it miss.
    const aimX = this.player.x + (Math.random() * 2 - 1) * 18;
    // Bees loop in front of you more often as the stages go on.
    const loop = leader.type === 'bee' && Math.random() < Math.min(0.55, 0.15 + this.stage * 0.05);
    const lead = attackPath(leader.type, leader.x, leader.y, dir, aimX, PLAYER_Y, { loop });
    this.startDive(leader, dir, lead);

    // Followers fly the leader's own line from their own slot, a beat behind,
    // so a boss and its escorts come down as one V rather than three dives.
    if (leader.type === 'boss') {
      // Bosses bring butterfly escorts from the columns beside them.
      const escorts = inForm
        .filter((e) => e.type === 'butterfly' && Math.abs(e.col - leader.col) <= 1)
        .slice(0, 2);
      leader.escorts = escorts;
      escorts.forEach((e, i) => this.launchDive(e, dir, 0.18 * (i + 1), lead));
    } else if (Math.random() < 0.45) {
      const mate = inForm.find((e) => e !== leader && e.type === leader.type && e.row === leader.row);
      if (mate) this.launchDive(mate, dir, 0.2, lead);
    }
    sfx.dive();
  }

  launchDive(e, dir, delay, lead) {
    if (delay > 0) this.pendingDives.push({ enemy: e, dir, at: delay, lead });
    else this.startDive(e, dir, lead);
  }

  /** @param lead the leader's path, flown from this enemy's own slot. */
  startDive(e, dir, lead) {
    if (e.dead || e.state !== 'form') return;
    const pts = lead
      ? offsetPath(lead, e.x, e.y)
      : attackPath(e.type, e.x, e.y, dir, this.player.x, PLAYER_Y);
    e.follow(pts, 'dive', 118 + this.stage * 2);
    e.fireCd = 0.3 + Math.random() * 0.5;
  }

  // --- collisions ---------------------------------------------------------

  checkCollisions() {
    // Player shots vs enemies.
    for (const b of this.playerBullets) {
      if (b.gone) continue;
      for (const e of this.enemies) {
        if (e.dead || e.state === 'idle') continue;
        const s = e.size;
        if (!overlap(b.x, b.y, 2, 6, e.x, e.y, s.w, s.h)) continue;
        b.gone = true;
        this.hitEnemy(e);
        break;
      }
    }
    this.playerBullets = this.playerBullets.filter((b) => !b.gone);
    this.enemies = this.enemies.filter((e) => !e.dead);

    const p = this.player;
    if (!p.alive || p.invuln > 0) return;

    const halfW = p.dual ? 26 : 13;
    // Enemy shots vs player.
    for (const b of this.enemyBullets) {
      if (overlap(b.x, b.y, 2, 5, p.x, PLAYER_Y, halfW, 12)) {
        b.gone = true;
        this.killPlayer(b.x);
        break;
      }
    }
    this.enemyBullets = this.enemyBullets.filter((b) => !b.gone);
    if (!p.alive) return;

    // Ramming.
    for (const e of this.enemies) {
      if (e.state === 'form' || e.state === 'idle') continue;
      const s = e.size;
      if (overlap(e.x, e.y, s.w - 3, s.h - 2, p.x, PLAYER_Y, halfW - 3, 10)) {
        this.hitEnemy(e);
        this.killPlayer(e.x);
        break;
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  hitEnemy(e) {
    this.hits += 1;

    if (e.type === 'boss' && e.hp > 1 && !isChallenge(this.stage)) {
      e.hp -= 1;
      this.explosions.push({ ...this.blast(e.x, e.y, e.type, 0.18), big: false, spark: true });
      sfx.bossHit();
      return;
    }

    e.dead = true;
    this.explosions.push(this.blast(e.x, e.y, e.type, e.type === 'boss' ? 0.45 : 0.3));

    if (isChallenge(this.stage)) {
      this.challengeHits += 1;
      this.addScore(160);
      sfx.killSmall();
      this.floatScore(e.x, e.y, 160);
      return;
    }

    const diving = e.state !== 'form' && e.state !== 'idle';
    let value;
    if (e.type === 'boss') {
      if (!diving) {
        value = SCORE.boss.form;
      } else {
        const escorts = e.escorts.filter((x) => !x.dead && x.state !== 'form').length;
        value = SCORE.boss.dive * (escorts === 2 ? 4 : escorts === 1 ? 2 : 1);
      }
      sfx.killBoss();
    } else {
      value = diving ? SCORE[e.type].dive : SCORE[e.type].form;
      sfx.killSmall();
    }

    this.addScore(value);
    this.floatScore(e.x, e.y, value);

    if (e.captive) {
      if (diving) {
        // Shot down mid-dive: the captured fighter is freed.
        this.rescue = { x: e.x, y: e.y + 13 };
      }
      e.captive = false;
      if (this.captive && this.captive.boss === e) this.captive = null;
    }
  }

  /**
   * An explosion record. `type` is who blew up, so both renderers can throw
   * debris in that ship's colours; `seed` makes the flat view's debris the same
   * shape every frame without storing the fragments.
   */
  blast(x, y, type, dur) {
    return { x, y, t: 0, dur, big: type === 'boss' || type === 'player', type, seed: Math.random() };
  }

  floatScore(x, y, value) {
    this.explosions.push({ x, y, t: 0, dur: 0.9, text: String(value) });
  }

  checkStageEnd() {
    if (this.state !== 'play') return;
    if (this.entryQueue.length || this.enemies.length) return;
    if (this.captive) return;

    this.state = 'stageClear';
    this.clearT = 2.6;

    if (isChallenge(this.stage)) {
      const perfect = this.challengeHits >= this.stageTotal;
      const bonus = perfect ? 10000 : this.challengeHits * 100;
      this.addScore(bonus);
      this.showBanner(
        perfect ? 'PERFECT!' : `${this.challengeHits} HITS`,
        perfect ? '#f4d03f' : '#40d0e0',
        2.6,
        `BONUS ${bonus}`,
      );
    }
  }

  // --- render -------------------------------------------------------------

  draw() {
    const c = this.ctx;
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    this.stars.draw(c);

    if (this.state === 'title') {
      this.drawTitle(c);
      this.drawHud(c);
      return;
    }

    this.drawBeams(c);

    for (const e of this.enemies) {
      if (e.state === 'idle') continue;
      this.drawEnemy(c, e);
    }

    if (this.captive) {
      this.drawSprite(c, SPR.captive, this.captive.x, this.captive.y, this.captive.spin);
    }
    if (this.rescue) {
      this.drawSprite(c, SPR.captive, this.rescue.x, this.rescue.y, 0);
    }

    this.drawPlayer(c);

    c.fillStyle = '#ffffff';
    for (const b of this.playerBullets) c.fillRect(Math.round(b.x), Math.round(b.y) - 3, 1, 6);

    for (const b of this.enemyBullets) {
      c.fillStyle = '#ffe070';
      c.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 2, 2, 4);
    }

    this.drawExplosions(c);
    this.drawHud(c);
    if (this.state === 'gameover') this.drawGameOver(c);
    this.drawBanner(c);

    if (this.paused) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(0, 0, W, H);
      drawText(c, 'PAUSED', W / 2, H / 2 - 4, '#ffffff', 'center');
    }
  }

  /**
   * Everything draw() puts on top of the playfield, and nothing else: score,
   * lives, stage flags, banners, the title screen and the pause veil.
   *
   * The cockpit renderer draws the world itself in 3D and then calls this, so
   * the arcade UI is the same code in both views rather than a second
   * implementation that can drift.
   */
  drawOverlay() {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);

    if (this.state === 'title') {
      this.drawTitle(c);
      this.drawHud(c);
      return;
    }

    this.drawHud(c);
    if (this.state === 'gameover') this.drawGameOver(c);
    this.drawBanner(c);

    if (this.paused) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(0, 0, W, H);
      drawText(c, 'PAUSED', W / 2, H / 2 - 4, '#ffffff', 'center');
    }
  }

  drawSprite(c, img, x, y, rot) {
    c.save();
    c.translate(Math.round(x), Math.round(y));
    if (rot) c.rotate(rot);
    c.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2));
    c.restore();
  }

  drawEnemy(c, e) {
    // Wings flap while sitting in formation.
    const flap = e.state === 'form' && Math.floor(this.t * 3) % 2 === 0 ? 0.72 : 1;
    const rot = e.state === 'form' || e.state === 'beam' ? 0 : e.angle - Math.PI / 2;
    const img = e.sprite;

    c.save();
    c.translate(Math.round(e.x), Math.round(e.y));
    c.rotate(rot);
    if (flap !== 1) c.scale(flap, 1);
    c.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2));
    c.restore();

    if (e.captive) {
      this.drawSprite(c, SPR.captive, e.x, e.y + 13, rot);
    }
  }

  drawPlayer(c) {
    const p = this.player;
    if (!p || !p.alive) return;
    if (p.invuln > 0 && Math.floor(this.t * 12) % 2 === 0) return;
    if (p.dual) {
      this.drawSprite(c, SPR.fighter, p.x - 8, PLAYER_Y, 0);
      this.drawSprite(c, SPR.fighter, p.x + 8, PLAYER_Y, 0);
    } else {
      this.drawSprite(c, SPR.fighter, p.x, PLAYER_Y, 0);
    }
  }

  drawBeams(c) {
    for (const e of this.enemies) {
      if (e.state !== 'beam' || e.path) continue;
      const { top, length, halfWidth, k } = this.beamShape(e);
      if (k <= 0) continue;
      // Bands of light travelling down the cone, brightest at the leading edge.
      const bands = 9;
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < bands; i++) {
        const t0 = i / bands;
        const t1 = (i + 1) / bands;
        const phase = (t0 - this.t * 1.6) % 1;
        const glow = 0.25 + 0.75 * (phase < 0 ? phase + 1 : phase);
        const y0 = top + length * t0;
        const y1 = top + length * t1;
        const h0 = 3 + (halfWidth - 3) * t0;
        const h1 = 3 + (halfWidth - 3) * t1;
        const band = (inset, colour) => {
          c.fillStyle = colour;
          c.beginPath();
          c.moveTo(e.x - h0 * inset, y0);
          c.lineTo(e.x + h0 * inset, y0);
          c.lineTo(e.x + h1 * inset, y1);
          c.lineTo(e.x - h1 * inset, y1);
          c.closePath();
          c.fill();
        };
        band(1, `rgba(70,130,255,${0.30 * glow})`);
        band(0.45, `rgba(180,225,255,${0.35 * glow})`);
      }
      c.globalCompositeOperation = 'source-over';
    }
  }

  drawExplosions(c) {
    for (const x of this.explosions) {
      if (x.text) {
        const f = x.t / x.dur;
        drawText(c, x.text, x.x, x.y - 4 - f * 8, f > 0.7 ? '#8090b0' : '#40d0e0', 'center');
        continue;
      }
      const f = x.t / x.dur;
      if (!x.spark && x.type) this.drawDebris(c, x, f);
      const r = (x.big ? 16 : 10) * (0.3 + f);
      const rings = x.spark ? 1 : 4;
      for (let i = 0; i < rings; i++) {
        const a = (1 - f) * (1 - i / (rings + 1));
        c.strokeStyle = `rgba(${255},${180 - i * 30},${60},${a})`;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(x.x, x.y, Math.max(1, r - i * 3.5), 0, Math.PI * 2);
        c.stroke();
      }
    }
  }

  /** Pixel fragments in the dead ship's own colours, flung out and fading. */
  drawDebris(c, x, f) {
    const colours = DEBRIS[x.type] || DEBRIS.bee;
    const n = x.big ? 14 : 9;
    const reach = (x.big ? 22 : 15) * (1 - (1 - f) * (1 - f)); // eases out
    c.globalAlpha = 1 - f * f;
    for (let i = 0; i < n; i++) {
      // Cheap hash of the seed, so each fragment keeps its own line of flight.
      const h = Math.sin((x.seed * 1000 + i) * 12.9898) * 43758.5453;
      const r = h - Math.floor(h);
      const a = (i / n) * Math.PI * 2 + r * 0.9;
      const d = reach * (0.45 + r * 0.55);
      c.fillStyle = colours[i % colours.length];
      c.fillRect(Math.round(x.x + Math.cos(a) * d), Math.round(x.y + Math.sin(a) * d), r > 0.7 ? 2 : 1, 1 + (i & 1));
    }
    c.globalAlpha = 1;
  }

  drawHud(c) {
    if (this.state === 'title' || Math.floor(this.t * 3) % 2 === 0) {
      drawText(c, '1UP', 12, 3, '#ff4040');
    }
    drawText(c, 'HIGH SCORE', 76, 3, '#ff4040');

    const score = this.state === 'title' ? 0 : this.score;
    drawText(c, String(score).padStart(2, '0'), 46, 12, '#ffffff', 'center');
    drawText(c, String(this.highScore).padStart(2, '0'), 118, 12, '#ffffff', 'center');

    if (this.state === 'title') return;

    // Lives, bottom-left.
    for (let i = 0; i < Math.min(this.lives - (this.player.alive ? 1 : 0), 6); i++) {
      c.drawImage(SPR.fighter, 2 + i * 14, H - 14);
    }

    // Stage flags, bottom-right.
    let x = W - 2;
    let n = this.stage;
    const flags = [
      [50, '#40d0e0'],
      [30, '#e02020'],
      [20, '#f4d03f'],
      [10, '#3060d0'],
      [5, '#38b24a'],
      [1, '#e02020'],
    ];
    let drawn = 0;
    for (const [value, colour] of flags) {
      while (n >= value && drawn < 9) {
        n -= value;
        x -= 9;
        drawn += 1;
        c.fillStyle = colour;
        c.fillRect(x, H - 13, 7, 6);
        c.fillStyle = '#ffffff';
        c.fillRect(x, H - 13, 1, 11);
      }
    }
  }

  drawBanner(c) {
    // A new ship is due but is waiting for the sky to clear.
    const p = this.player;
    if (!this.banner && p && !p.alive && p.respawnT < 1.2 && this.lives > 0 && this.state !== 'gameover') {
      drawText(c, 'READY', W / 2, 140, '#ff4040', 'center');
    }
    if (!this.banner) return;
    const b = this.banner;
    // Blink out over the last half second.
    if (b.t < 0.5 && Math.floor(b.t * 12) % 2 === 0) return;
    drawText(c, b.text, W / 2, 140, b.colour, 'center');
    if (b.sub) drawText(c, b.sub, W / 2, 154, '#ffffff', 'center');
  }

  drawGameOver(c) {
    drawText(c, 'GAME OVER', W / 2, 140, '#ff4040', 'center');
    if (this.overT <= 0 && Math.floor(this.t * 2) % 2 === 0) {
      drawText(c, 'PRESS FIRE', W / 2, 162, '#ffffff', 'center');
    }
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    drawText(c, `SHOTS FIRED ${this.shots}`, W / 2, 190, '#8090b0', 'center');
    drawText(c, `HIT MISS RATIO ${acc}.0 %`, W / 2, 202, '#8090b0', 'center');
  }

  drawTitle(c) {
    const y = 74;
    // Oversized logo: draw the font at 3x with a manual scale.
    c.save();
    c.translate(W / 2, y);
    c.scale(4, 4);
    drawText(c, 'GALAGA', 0, 0, '#ff4040', 'center');
    c.restore();

    drawText(c, 'A FORMATION SHOOTER', W / 2, 122, '#40d0e0', 'center');

    if (Math.floor(this.t * 2) % 2 === 0) {
      drawText(c, 'PRESS SPACE TO START', W / 2, 160, '#ffffff', 'center');
    }

    drawText(c, '- SCORE -', W / 2, 186, '#f4d03f', 'center');
    drawText(c, 'FORM', 122, 200, '#8090b0');
    drawText(c, 'DIVE', 164, 200, '#8090b0');
    const rows = [
      ['BEE', '50', '100'],
      ['BUTTERFLY', '80', '160'],
      ['BOSS', '150', '400'],
    ];
    rows.forEach((r, i) => {
      const yy = 212 + i * 12;
      drawText(c, r[0], 22, yy, '#ffffff');
      drawText(c, r[1], 128, yy, '#8fd0ff');
      drawText(c, r[2], 164, yy, '#ffe070');
    });

    drawText(c, this.muted ? 'SOUND OFF' : 'M TO MUTE', W / 2, 262, '#505070', 'center');
  }
}

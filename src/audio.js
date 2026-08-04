// Tiny WebAudio blip engine — no samples, everything is synthesised on demand.
// The context stays suspended until the first user gesture (browser policy).

class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.25;
    return this.muted;
  }

  /** A pitch sweep on a single oscillator. */
  tone(type, from, to, dur, gain = 0.5) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered white noise, for explosions. */
  noise(dur, from = 1400, to = 120, gain = 0.6) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const frames = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(from, t);
    filt.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }

  shoot() { this.tone('square', 900, 180, 0.09, 0.28); }
  enemyShoot() { this.tone('sawtooth', 320, 90, 0.14, 0.18); }
  killSmall() { this.noise(0.18, 1800, 200, 0.5); }
  killBoss() { this.noise(0.34, 1200, 90, 0.65); this.tone('square', 200, 60, 0.3, 0.2); }
  playerDie() { this.noise(0.7, 900, 60, 0.7); this.tone('sawtooth', 380, 40, 0.7, 0.3); }
  dive() { this.tone('square', 180, 640, 0.22, 0.12); }
  beam() { this.tone('sine', 120, 700, 0.5, 0.18); }
  capture() { this.tone('sine', 220, 1200, 0.6, 0.25); }
  rescue() { this.tone('square', 400, 1400, 0.5, 0.25); }
  stage() { this.tone('square', 520, 780, 0.12, 0.22); }
  extraLife() { this.tone('square', 700, 1500, 0.25, 0.25); }
  coin() { this.tone('square', 1200, 1600, 0.08, 0.2); }
}

export const sfx = new Sfx();

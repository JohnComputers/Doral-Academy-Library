// ============================================================
// Audio — every sound is synthesized with WebAudio at runtime:
// filtered noise bursts for steps/digging, tuned blips for UI
// and pickups, a low boom for explosions, soft wind ambience.
// ============================================================
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.8;
    this.ambGain = null;
  }
  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.startAmbience();
      return true;
    } catch { return false; }
  }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  noiseBuffer(seconds = 1) {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  burst({ freq = 800, q = 1, dur = 0.08, gain = 0.4, type = 'bandpass', sweep = 0 }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  blip({ freq = 600, dur = 0.1, gain = 0.25, type = 'square', slide = 0 }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(name, opts = {}) {
    if (!this.ensure()) return;
    switch (name) {
      case 'step': this.burst({ freq: 350 + Math.random() * 250, dur: 0.06, gain: 0.16, q: 0.8 }); break;
      case 'stepGrass': this.burst({ freq: 900 + Math.random() * 400, dur: 0.05, gain: 0.1, q: 0.6 }); break;
      case 'dig': this.burst({ freq: 240 + Math.random() * 120, dur: 0.07, gain: 0.22, q: 1.4 }); break;
      case 'break': this.burst({ freq: 520, dur: 0.16, gain: 0.4, q: 0.7, sweep: -380 }); break;
      case 'place': this.burst({ freq: 300, dur: 0.1, gain: 0.3, q: 1 }); break;
      case 'pickup': this.blip({ freq: 620, dur: 0.09, gain: 0.18, slide: 540, type: 'triangle' }); break;
      case 'click': this.blip({ freq: 720, dur: 0.045, gain: 0.16, type: 'square' }); break;
      case 'hurt': this.blip({ freq: 220, dur: 0.18, gain: 0.3, slide: -120, type: 'sawtooth' }); break;
      case 'mobhurt': this.blip({ freq: 300 + Math.random() * 120, dur: 0.14, gain: 0.2, slide: -160, type: 'square' }); break;
      case 'eat': this.burst({ freq: 700 + Math.random() * 500, dur: 0.09, gain: 0.2, q: 2 }); break;
      case 'splash': this.burst({ freq: 1400, dur: 0.25, gain: 0.25, q: 0.5, sweep: -900 }); break;
      case 'bow': this.blip({ freq: 380, dur: 0.12, gain: 0.18, slide: 320, type: 'triangle' }); break;
      case 'explode': {
        this.burst({ freq: 120, dur: 0.7, gain: 0.9, q: 0.4, type: 'lowpass', sweep: -80 });
        this.blip({ freq: 70, dur: 0.5, gain: 0.5, slide: -40, type: 'sine' });
        break;
      }
      case 'fuse': this.burst({ freq: 2600, dur: 0.3, gain: 0.16, q: 3 }); break;
      case 'craft': this.burst({ freq: 500, dur: 0.08, gain: 0.2, q: 1 }); break;
      case 'level': this.blip({ freq: 520, dur: 0.3, gain: 0.2, slide: 520, type: 'sine' }); break;
      case 'rain': this.burst({ freq: 3000, dur: 0.4, gain: 0.05, q: 0.3 }); break;
    }
  }

  startAmbience() {
    // gentle filtered-noise wind bed
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 0.4;
    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 0.025;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(this.ambGain.gain);
    src.connect(f).connect(this.ambGain).connect(this.master);
    src.start(); lfo.start();
  }
  setAmbience(level) { if (this.ambGain) this.ambGain.gain.value = 0.01 + level * 0.05; }
}

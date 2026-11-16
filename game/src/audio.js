// audio.js — every sound in Kiln Yard is synthesised with WebAudio. No audio files,
// nothing to load, nothing borrowed: a shot is filtered noise with a fast decay, a
// reload is two clicks, a footstep is a soft thud of low-passed noise, and the charge
// beeps its countdown faster as it runs out.
//
// Sounds that belong to the world (other people's shots, bounces, explosions) take a
// pan and a volume, so a firefight has a geography: you hear the lane it is in and
// roughly how far away it is. Sounds that belong to the player (hits, buys, stings)
// stay centred and full. All nodes are short-lived; only the noise buffer is shared.

export class SoundBank {
  constructor() {
    this.ctx = null;        // created on the first user gesture, as browsers require
    this.master = null;     // every voice runs through this one gain
    this.noiseBuffer = null;
  }

  /** Create (or resume) the context. Called from the Play click. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // Half a second of white noise, reused by every burst and step.
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Route a voice to the speakers, panned if the sound lives in the world. */
  out(gainNode, pan) {
    if (pan && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
      gainNode.connect(panner);
      panner.connect(this.master);
    } else {
      gainNode.connect(this.master);
    }
  }

  /**
   * A burst of filtered noise whose centre frequency sweeps down — the workhorse for
   * shots, hits and explosions. `pan`/`vol` place it in the world; omit them for the
   * player's own sounds.
   */
  burst({ freq = 1800, endFreq = 300, dur = 0.12, gain = 0.5, type = 'bandpass', q = 0.8, pan = 0, vol = 1 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    this.out(g, pan);
    src.start(t, Math.random() * 0.2, dur + 0.05);
  }

  /** A short oscillator blip: beeps, clicks, confirms, denials. */
  blip({ freq = 880, dur = 0.07, gain = 0.25, type = 'square', pan = 0, vol = 1 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    this.out(g, pan);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Two blips in sequence — the shape of every little melody the UI makes. */
  pair(first, second, gapMs) {
    this.blip(first);
    setTimeout(() => this.blip(second), gapMs);
  }

  /**
   * A gunshot, voiced per gun: the Longshot cracks longest and lowest, the Viper is a
   * quick tear, the KR-7 sits between. A second, quieter low thump under the automatics
   * gives the shot a body that a bare noise burst lacks.
   */
  shot(kind, { pan = 0, vol = 1 } = {}) {
    const voice = {
      sniper: { freq: 2600, endFreq: 120, dur: 0.32, gain: 0.9, q: 0.5 },
      smg: { freq: 2100, endFreq: 400, dur: 0.09, gain: 0.42 },
      rifle: { freq: 1900, endFreq: 260, dur: 0.14, gain: 0.6 },
      pistol: { freq: 1700, endFreq: 350, dur: 0.1, gain: 0.45 },
    }[kind] || { freq: 1700, endFreq: 350, dur: 0.1, gain: 0.45 };
    this.burst({ ...voice, pan, vol });
    if (kind === 'rifle' || kind === 'sniper') {
      this.burst({ freq: 300, endFreq: 90, dur: 0.1, gain: 0.3 * vol, type: 'lowpass', pan });
    }
  }

  /** A footstep: soft, short, and quiet — information, not music. */
  footstep({ pan = 0, vol = 1, run = true } = {}) {
    this.burst({
      freq: run ? 420 : 300, endFreq: 120,
      dur: run ? 0.07 : 0.09, gain: 0.1 * vol, type: 'lowpass', q: 0.6, pan,
    });
  }

  dryFire() { this.blip({ freq: 1400, dur: 0.03, gain: 0.12 }); }
  reloadStart() { this.blip({ freq: 500, dur: 0.05, gain: 0.2, type: 'triangle' }); }
  reloadEnd() { this.blip({ freq: 760, dur: 0.05, gain: 0.22, type: 'triangle' }); }
  hit() { this.blip({ freq: 1900, dur: 0.04, gain: 0.16 }); }
  headshot() { this.blip({ freq: 2500, dur: 0.06, gain: 0.22 }); }
  hurt() { this.burst({ freq: 500, endFreq: 150, dur: 0.16, gain: 0.4, type: 'lowpass' }); }

  explosion({ pan = 0, vol = 1 } = {}) {
    this.burst({ freq: 300, endFreq: 40, dur: 0.8, gain: 1.0, type: 'lowpass', q: 0.4, pan, vol });
    this.burst({ freq: 1200, endFreq: 100, dur: 0.3, gain: 0.5, pan, vol });
  }

  grenadeBounce({ pan = 0, vol = 1 } = {}) {
    this.blip({ freq: 300, dur: 0.04, gain: 0.15, type: 'triangle', pan, vol });
  }

  /** The charge's countdown beep; `fast` is the last ten seconds. */
  beep(fast = false) { this.blip({ freq: fast ? 1560 : 1180, dur: 0.05, gain: 0.18 }); }

  /** The defuse kit's working tick — same pitch family as the beep, clearly its own. */
  defuseTick() { this.blip({ freq: 940, dur: 0.03, gain: 0.1, type: 'triangle' }); }

  plantDone() {
    this.pair(
      { freq: 980, dur: 0.09, gain: 0.25 },
      { freq: 1470, dur: 0.12, gain: 0.25 },
      90,
    );
  }

  roundWin() {
    this.pair(
      { freq: 660, dur: 0.12, gain: 0.2, type: 'triangle' },
      { freq: 990, dur: 0.18, gain: 0.2, type: 'triangle' },
      110,
    );
  }

  roundLose() {
    this.pair(
      { freq: 440, dur: 0.14, gain: 0.2, type: 'triangle' },
      { freq: 294, dur: 0.2, gain: 0.2, type: 'triangle' },
      120,
    );
  }

  buy() { this.blip({ freq: 1250, dur: 0.05, gain: 0.18 }); }
  denied() { this.blip({ freq: 220, dur: 0.08, gain: 0.18 }); }
}

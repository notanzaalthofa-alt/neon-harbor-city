// Neon Harbor — every sound is synthesized with WebAudio, so the game ships no audio
// files at all. The context only starts after a real user gesture (browsers block
// autoplay), and M mutes everything. In screenshot mode nothing ever starts.
export class AudioBank {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  // Call from a user gesture (a key press or a click). Safe to call repeatedly.
  ensure() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.context = new AC();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.context.destination);
      this.startEngine();
      this.startMusic();
    } catch {
      this.context = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  startEngine() {
    const ctx = this.context;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  // speedRatio 0..1 sets the engine's pitch and loudness; 0 silences it.
  setEngine(speedRatio, inCar) {
    if (!this.engineGain || !this.engineOsc) return;
    const target = inCar ? 0.05 + 0.06 * speedRatio : 0;
    this.engineGain.gain.setTargetAtTime(target, this.context.currentTime, 0.1);
    this.engineOsc.frequency.setTargetAtTime(40 + 90 * speedRatio, this.context.currentTime, 0.1);
  }

  startSiren() {
    if (!this.context || this.sirenOsc) return;
    const ctx = this.context;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    const flip = () => {
      if (!this.sirenOsc) return;
      const now = ctx.currentTime;
      const next = this.sirenOsc.frequency.value < 900 ? 1100 : 700;
      this.sirenOsc.frequency.setTargetAtTime(next, now, 0.05);
    };
    this.sirenTimer = setInterval(flip, 450);
  }

  setSiren(on) {
    if (!this.context) return;
    if (on) {
      this.startSiren();
      this.sirenGain.gain.setTargetAtTime(0.035, this.context.currentTime, 0.2);
    } else if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(0, this.context.currentTime, 0.2);
    }
  }

  // A slow two-chord pad that loops quietly under the game: C major to A minor,
  // one soft triangle note at a time, so it never fights the sound effects.
  startMusic() {
    const notes = [130.81, 164.81, 196.0, 246.94, 220.0, 164.81, 196.0, 261.63];
    this.musicTimer = setInterval(() => {
      if (!this.context || this.muted) return;
      const freq = notes[this.musicStep % notes.length];
      this.musicStep += 1;
      const osc = this.context.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, this.context.currentTime + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 2.2);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      osc.stop(this.context.currentTime + 2.3);
    }, 900);
  }

  blip(freq, seconds, type = 'sine', volume = 0.15) {
    if (!this.context) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + seconds + 0.05);
  }

  // A burst of filtered noise: gunshots, punches and crashes share it.
  noise(seconds, filterFreq, volume = 0.25) {
    if (!this.context) return;
    const ctx = this.context;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  gunshot() {
    this.noise(0.18, 1800, 0.3);
    this.blip(90, 0.12, 'square', 0.12);
  }

  punch() {
    this.noise(0.09, 500, 0.2);
  }

  crash() {
    this.noise(0.35, 300, 0.3);
  }

  pickup() {
    this.blip(660, 0.12, 'sine', 0.15);
    setTimeout(() => this.blip(880, 0.18, 'sine', 0.15), 90);
  }

  missionDone() {
    [523, 659, 784, 1047].forEach((freq, i) => {
      setTimeout(() => this.blip(freq, 0.25, 'triangle', 0.16), i * 110);
    });
  }

  busted() {
    [392, 330, 262].forEach((freq, i) => {
      setTimeout(() => this.blip(freq, 0.3, 'sawtooth', 0.12), i * 160);
    });
  }
}

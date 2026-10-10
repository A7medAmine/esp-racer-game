// Synthesized sound (no audio files): engine with gear shifts, tire screech,
// wind, nitro, impacts, countdown beeps and menu blips.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.gear = 1;
  }

  // Browsers only allow audio after a user gesture; call from click/key handlers.
  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Engine: two detuned oscillators through a lowpass filter.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 4;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    this.osc1.connect(this.engineFilter);
    this.osc2.connect(g2).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    const noise = this.noiseBuffer();
    this.screech = this.loopNoise(noise, 'bandpass', 1400, 6);
    this.wind = this.loopNoise(noise, 'lowpass', 500, 0.7);
    this.nitroSnd = this.loopNoise(noise, 'highpass', 2500, 0.5);
    this.noise = noise;
  }

  noiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  loopNoise(buffer, type, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Called every frame with the player's car (or null to silence).
  updateCar(car, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!car || !active) {
      for (const g of [this.engineGain, this.screech, this.wind, this.nitroSnd]) g.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    // Fake gearbox: rpm climbs within each gear band.
    const speed = Math.abs(car.forwardSpeed);
    const bands = [0, 12, 24, 36, 48, 60, 999];
    let gear = 1;
    while (gear < 6 && speed > bands[gear]) gear++;
    const lo = bands[gear - 1], hi = Math.min(bands[gear], 75);
    let rpm = 0.25 + 0.75 * Math.min(1, (speed - lo) / (hi - lo));
    if (car.reversing) rpm = 0.25 + Math.min(1, speed / 14) * 0.5;
    if (speed < 1 && car.throttle > 0.1) rpm = 0.45 + car.throttle * 0.3; // revving on the spot
    const freq = 42 + rpm * 150 + (car.nitroActive ? 15 : 0);
    this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
    this.osc2.frequency.setTargetAtTime(freq * 0.501, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(500 + rpm * 1800 + car.throttle * 800, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.11 + car.throttle * 0.1, t, 0.05);

    const screech = car.onGrass ? 0 : Math.min(1, Math.max(0, car.slip - 3) / 8) + (car.braking && speed > 15 ? 0.25 : 0);
    this.screech.gain.setTargetAtTime(screech * 0.22, t, 0.05);
    this.wind.gain.setTargetAtTime(Math.min(1, speed / 80) * 0.18, t, 0.1);
    this.nitroSnd.gain.setTargetAtTime(car.nitroActive ? 0.12 : 0, t, 0.05);
  }

  impact(strength) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = this.ctx.createGain();
    const v = Math.min(0.8, strength * 0.05);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }

  beep(freq = 660, dur = 0.18, vol = 0.25) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  blip() {
    this.beep(880, 0.05, 0.08);
  }
}

// Game sound from real recordings in assets/audio/ (sources in CREDITS.md there, made by
// tools/audio/build.py): engine, tire squeal, road roar, nitro, crashes, menu clicks and a
// human announcer. Only the wind and the fallback beeps are synthesized.

const DIR = 'assets/audio/';
const LOOPS = ['engine-idle', 'engine-high', 'skid', 'road', 'nitro'];
const HIT_KINDS = ['heavy', 'medium', 'light']; // three takes of each
const SHOTS = ['nitro-start', 'ui-move', 'ui-confirm', ...HIT_KINDS.flatMap((k) => [1, 2, 3].map((i) => `hit-${k}-${i}`))];
const VOICES = ['male', 'female'];
const VOICE_LINES = ['3', '2', '1', 'go', 'final-round', 'new-record', 'you-win', 'you-lose', 'congratulations', 'wrong'];

// Engine pitch. Each loop's firing frequency as recorded: the idle is a V8 at ~850 rpm, the
// high loop a 4-cylinder near the redline. The game's engine runs from IDLE..REDLINE Hz and
// crossfades from the idle loop to the high loop between XFADE_LO and XFADE_HI.
const IDLE_LOOP_HZ = 57;
const HIGH_LOOP_HZ = 87;
const IDLE_HZ = 50, REDLINE_HZ = 130;
const XFADE_LO = 60, XFADE_HI = 85;

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.voice = 'male'; // 'male' | 'female' | 'off'
    this.buffers = {};
    this.loops = null; // set once the loop recordings are decoded
    this.gear = 1;
    this.shiftUntil = 0;
    this.nitroWas = false;
    this.voiceEnd = 0;
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
    // Car sounds go through their own bus so the announcer can duck them.
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    this.noise = this.noiseBuffer();
    this.wind = this.loopNoise(this.noise, 'lowpass', 500, 0.7);
    this.load();
  }

  async load() {
    const names = [...LOOPS, ...SHOTS, ...VOICES.flatMap((v) => VOICE_LINES.map((l) => `voice/${v}/${l}`))];
    await Promise.all(
      names.map(async (name) => {
        try {
          const res = await fetch(`${DIR}${name}.ogg`);
          this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          // Missing or undecodable file: that sound stays silent (beeps stand in for the voice).
        }
      }),
    );
    if (LOOPS.every((n) => this.buffers[n])) this.startLoops();
  }

  startLoops() {
    const ctx = this.ctx;
    // Engine: both loops share a lowpass that opens with throttle (on load) and closes when
    // coasting, so lifting off sounds like engine braking instead of a quieter full throttle.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 0.7;
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    this.engineFilter.connect(this.engineBus).connect(this.sfx);
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 5000;
    this.loops = {
      idle: this.loopSample('engine-idle', this.engineFilter),
      high: this.loopSample('engine-high', this.engineFilter),
      skid: this.loopSample('skid', this.sfx),
      road: this.loopSample('road', this.roadFilter),
      nitro: this.loopSample('nitro', this.sfx),
    };
    this.roadFilter.connect(this.sfx);
  }

  loopSample(name, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(dest);
    src.start(0, Math.random() * src.buffer.duration);
    return { src, gain: gain.gain, rate: src.playbackRate };
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
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    return g;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Plays a decoded one-shot; returns its duration, or 0 if it isn't loaded.
  play(name, { gain = 1, rate = 1, dest = this.sfx, when = 0 } = {}) {
    const buf = this.ctx && this.buffers[name];
    if (!buf) return 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(when);
    return buf.duration / rate;
  }

  // Called every frame with the player's car (or null to silence).
  updateCar(car, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const L = this.loops;
    if (!car || !active) {
      this.wind.gain.setTargetAtTime(0, t, 0.1);
      if (L) {
        this.engineBus.gain.setTargetAtTime(0, t, 0.1);
        for (const l of Object.values(L)) l.gain.setTargetAtTime(0, t, 0.1);
      }
      this.nitroWas = false;
      return;
    }
    const speed = Math.abs(car.forwardSpeed);
    this.wind.gain.setTargetAtTime(Math.min(1, speed / 80) ** 2 * 0.12, t, 0.1);
    if (!L) return;

    // Fake gearbox: rpm climbs within each gear band and drops on the upshift.
    const bands = [0, 12, 24, 36, 48, 60, 999];
    let gear = 1;
    while (gear < 6 && speed > bands[gear]) gear++;
    const lo = bands[gear - 1], hi = Math.min(bands[gear], 75);
    const frac = Math.min(1, (speed - lo) / (hi - lo));
    let rpm = gear === 1 ? 0.1 + 0.9 * frac : 0.5 + 0.5 * frac;
    if (car.reversing) rpm = 0.1 + Math.min(1, speed / 14) * 0.5;
    if (speed < 1) rpm = 0.1 + car.throttle * 0.55; // idling or revving on the spot
    if (car.nitroActive) rpm = Math.min(1.08, rpm + 0.06);
    if (gear > this.gear && car.throttle > 0.5) this.shiftUntil = t + 0.14; // lift during the shift
    this.gear = gear;
    const load = t < this.shiftUntil ? 0 : car.throttle;

    const hz = IDLE_HZ + rpm * (REDLINE_HZ - IDLE_HZ);
    const mix = Math.min(1, Math.max(0, (hz - XFADE_LO) / (XFADE_HI - XFADE_LO)));
    L.idle.rate.setTargetAtTime(hz / IDLE_LOOP_HZ, t, 0.04);
    L.high.rate.setTargetAtTime(hz / HIGH_LOOP_HZ, t, 0.04);
    L.idle.gain.setTargetAtTime(Math.cos((mix * Math.PI) / 2), t, 0.05);
    L.high.gain.setTargetAtTime(Math.sin((mix * Math.PI) / 2), t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(900 + load * 5000 + rpm * 2000, t, 0.06);
    this.engineBus.gain.setTargetAtTime(0.4 + load * 0.25 + rpm * 0.1, t, 0.06);

    const screech = car.onGrass ? 0 : Math.min(1, Math.max(0, car.slip - 3) / 8) + (car.braking && speed > 15 ? 0.25 : 0);
    L.skid.gain.setTargetAtTime(Math.min(1, screech) * 0.5, t, 0.05);
    L.skid.rate.setTargetAtTime(0.9 + Math.min(0.25, speed / 250), t, 0.1);

    // Road roar; on grass it turns into a duller, louder rumble.
    L.road.gain.setTargetAtTime(Math.min(1, speed / 55) * (car.onGrass ? 0.7 : 0.4), t, 0.1);
    L.road.rate.setTargetAtTime(0.75 + Math.min(0.5, speed / 120), t, 0.1);
    this.roadFilter.frequency.setTargetAtTime(car.onGrass ? 700 : 5000, t, 0.1);

    L.nitro.gain.setTargetAtTime(car.nitroActive ? 0.45 : 0, t, car.nitroActive ? 0.06 : 0.25);
    if (car.nitroActive && !this.nitroWas) this.play('nitro-start', { gain: 0.7 });
    this.nitroWas = car.nitroActive;
  }

  impact(strength) {
    if (!this.ctx) return;
    const kind = strength > 12 ? 'heavy' : strength > 7 ? 'medium' : 'light';
    const n = 1 + Math.floor(Math.random() * 3);
    this.play(`hit-${kind}-${n}`, { gain: Math.min(1, 0.35 + strength / 25), rate: 0.9 + Math.random() * 0.2 });
  }

  // Announcer line (see VOICE_LINES). Lines queue up instead of talking over each other, and the
  // car sounds dip while it speaks. Returns false when the announcer is off or not loaded, so
  // callers can fall back to a beep.
  say(line) {
    if (!this.ctx || this.voice === 'off') return false;
    const name = `voice/${this.voice}/${line}`;
    if (!this.buffers[name]) return false;
    const t = this.ctx.currentTime;
    const start = Math.max(t, this.voiceEnd);
    this.voiceEnd = start + this.play(name, { gain: 1.2, dest: this.master, when: start });
    const g = this.sfx.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    g.setTargetAtTime(0.5, start, 0.03);
    g.setTargetAtTime(1, this.voiceEnd, 0.2);
    return true;
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
    if (!this.play('ui-move', { gain: 0.6, dest: this.master })) this.beep(880, 0.05, 0.08);
  }

  confirm() {
    if (!this.play('ui-confirm', { gain: 0.6, dest: this.master })) this.beep(1320, 0.08, 0.1);
  }
}

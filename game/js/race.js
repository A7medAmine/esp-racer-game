// A race session: builds the world for a track, runs physics, AI, timing,
// positions and car-to-car collisions.
import * as THREE from 'three';
import { AIDriver } from './ai.js';
import { Environment, THEMES, TIMES } from './world/environment.js';
import { createCarModel } from './world/car-model.js';
import { Track } from './world/track.js';
import { TRACKS } from './world/tracks.js';
import { Pickups, PICKUP_COLORS } from './pickups.js';
import { CAR_COLORS } from './settings.js';
import { Vehicle } from './vehicle.js';

const STEP = 1 / 120;
const AI_NAMES = ['Blaze', 'Nova', 'Viper', 'Ghost', 'Rocket'];
const COUNTDOWN = 3.0;

export class Race {
  constructor({ scene, renderer, effects, audio, hud, camera }) {
    this.scene = scene;
    this.renderer = renderer;
    this.effects = effects;
    this.audio = audio;
    this.hud = hud;
    this.camera = camera;
    this.state = 'idle';
    this.events = []; // messages for main: {type, ...}
  }

  // Build (or rebuild) the world. Cheap enough to call when menu options change.
  build({ trackIndex, time, laps, opponents, difficulty, mode, colorIndex, quality }) {
    this.dispose();
    this.opts = { trackIndex, time, laps, opponents, difficulty, mode, colorIndex, quality };
    const def = TRACKS[trackIndex];
    const theme = THEMES[def.theme];
    this.timeCfg = TIMES[time];
    this.track = new Track(def, theme);
    this.scene.add(this.track.group);
    this.pickups = new Pickups(this.track);
    this.track.group.add(this.pickups.group); // disposed with the track
    this.env = new Environment({
      scene: this.scene,
      renderer: this.renderer,
      track: this.track,
      themeKey: def.theme,
      timeKey: time,
      quality,
    });
    this.groundColor = new THREE.Color(theme.ground[2]).lerp(new THREE.Color(0xffffff), 0.3);

    // In a race the player starts at the back of the grid and has to fight forward.
    const aiCount = mode === 'race' ? opponents : 0;
    const playerSlot = aiCount;
    this.cars = [];
    this.models = [];
    this.drivers = [];
    const usedColors = new Set([colorIndex]);
    const player = this.addCar({ name: 'You', colorHex: CAR_COLORS[colorIndex].hex, slot: playerSlot, isPlayer: true });
    this.player = player;
    for (let k = 0; k < aiCount; k++) {
      let ci = (colorIndex + 1 + k * 3) % CAR_COLORS.length;
      while (usedColors.has(ci)) ci = (ci + 1) % CAR_COLORS.length;
      usedColors.add(ci);
      const car = this.addCar({ name: AI_NAMES[k], colorHex: CAR_COLORS[ci].hex, slot: k });
      const skill = 0.84 + ((k * 37) % 17) / 100;
      this.drivers.push(new AIDriver(car, this.track, skill, k, difficulty));
    }

    // Player headlights (visible at sunset / night).
    this.headlight = new THREE.SpotLight(0xfff2dd, 0, 110, 0.55, 0.55, 1.1);
    this.headlight.position.set(0, 0.8, 2.2);
    this.headlight.target.position.set(0, 0, 25);
    this.models[0].root.add(this.headlight, this.headlight.target);
    for (const m of this.models) {
      m.head.emissiveIntensity = 0.6 + this.timeCfg.headlights * 2.5;
    }

    this.hud.setTrack(this.track);
    this.effects.clear();
    this.state = 'showroom';
    this.clock = 0;
    this.raceTime = 0;
    this.accum = 0;
    this.track.setStartLights(0);
    this.syncModels(0);
    this.camera.snapTo(player);
  }

  addCar({ name, colorHex, slot, isPlayer = false }) {
    const car = new Vehicle(this.track, { name, color: colorHex, isPlayer });
    car.cssColor = `#${new THREE.Color(colorHex).getHexString()}`;
    car.placeOnGrid(slot);
    car.slot = slot;
    car.onLap = (lapMs) => this.onLap(car, lapMs);
    const model = createCarModel(colorHex);
    this.scene.add(model.root);
    this.cars.push(car);
    this.models.push(model);
    return car;
  }

  setPlayerColor(hex) {
    if (!this.player) return;
    this.models[0].setColor(hex);
    this.player.cssColor = `#${new THREE.Color(hex).getHexString()}`;
  }

  restart() {
    this.build(this.opts);
    this.startCountdown();
  }

  startCountdown() {
    this.state = 'countdown';
    this.countdownTime = 0;
    this.lastCount = -1;
    this.raceTime = 0;
  }

  get playerLapLabel() {
    const p = this.player;
    const lap = Math.min(this.opts.laps, Math.max(1, p.lapsDone + 1));
    return this.opts.mode === 'trial' && this.opts.laps >= 99 ? `${lap}` : `${lap}/${this.opts.laps}`;
  }

  onLap(car, lapMs) {
    if (car.finished) return;
    const laps = this.opts.laps;
    if (car.lapsDone + 1 >= laps) {
      car.finished = true;
      car.finishTime = this.raceTime;
      if (car === this.player) {
        this.state = 'finished';
        this.finishDelay = 3;
        this.events.push({ type: 'finish', position: this.positionOf(car) });
      }
    }
    if (car === this.player) {
      this.events.push({ type: 'lap', lapMs, lapsDone: car.lapsDone + 1, best: car.bestLap === lapMs });
    }
  }

  standings() {
    return [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
  }

  positionOf(car) {
    return this.standings().indexOf(car) + 1;
  }

  update(dt, input) {
    if (!this.track) return;
    const running = this.state === 'racing' || this.state === 'finished';

    if (this.state === 'countdown') {
      this.countdownTime += dt;
      const t = this.countdownTime;
      const count = Math.floor(t);
      if (count !== this.lastCount && t < COUNTDOWN) {
        this.lastCount = count;
        this.hud.countdown(String(3 - count));
        this.events.push({ type: 'count' });
        if (!this.audio.say(String(3 - count))) this.audio.beep(520, 0.22, 0.22);
      }
      this.track.setStartLights(Math.min(5, Math.floor((t / COUNTDOWN) * 5) + 1));
      // Rev the engine on the line.
      this.player.throttle = input.throttle;
      if (t >= COUNTDOWN) {
        this.state = 'racing';
        this.track.setStartLights(5, true);
        this.hud.countdown('GO!');
        this.events.push({ type: 'go' });
        if (!this.audio.say('go')) this.audio.beep(1040, 0.5, 0.3);
        setTimeout(() => this.hud.countdown(''), 900);
        for (const car of this.cars) car.lapStart = 0;
      }
    }

    if (running) {
      this.raceTime += dt * 1000;
      this.accum += Math.min(dt, 0.1);
      while (this.accum >= STEP) {
        this.accum -= STEP;
        this.physicsStep(STEP, input);
      }
      if (this.state === 'finished') {
        this.finishDelay -= dt;
        if (this.finishDelay <= 0 && !this.resultsShown) {
          this.resultsShown = true;
          this.events.push({ type: 'results' });
        }
      }
    }

    // Player helpers: wrong way warning and auto-reset.
    const p = this.player;
    if (this.state === 'racing') {
      if (p.wrongWayTime > 1.2) {
        this.hud.message('WRONG WAY', 0.3);
        if (!this.wrongWayCalled) this.audio.say('wrong');
      }
      this.wrongWayCalled = p.wrongWayTime > 1.2;
      if (p.wrongWayTime > 4) {
        p.respawn();
        p.wrongWayTime = 0;
      }
    }

    // Visuals
    this.syncModels(dt);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (running) this.effects.updateCar(car, this.models[i], dt, this.groundColor);
      if (car.impact > 0) {
        if (car === p && car.impact > 4) {
          this.audio.impact(car.impact);
          this.camera.addShake(Math.min(1, car.impact / 20));
          this.events.push({ type: 'impact', strength: car.impact });
        }
        car.impact = 0;
      }
    }
    this.effects.update(dt);
    this.pickups.update(dt);
    this.headlight.intensity = this.timeCfg.headlights * 90;
  }

  physicsStep(dt, input) {
    const now = this.raceTime;
    for (const d of this.drivers) d.think(dt, this.cars, this.player, true);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      let carInput;
      if (car === this.player) {
        carInput = car.finished ? { steer: 0, throttle: 0, brake: 0.4, nitro: false } : input;
      } else {
        carInput = this.drivers[i - 1].input;
      }
      car.step(carInput, dt, now);
      const token = this.pickups.check(car);
      if (token) {
        car.collect(token.kind);
        this.effects.burst(token.x, 1.6, token.z, PICKUP_COLORS[token.kind]);
        if (car === this.player) {
          this.hud.message(token.kind === 'refill' ? 'NITRO REFILL' : 'OVERDRIVE!', 1.2);
          this.audio.pickup(token.kind);
          this.events.push({ type: 'pickup', kind: token.kind });
        }
      }
    }
    this.collideCars();
  }

  // Each car is two circles (front and rear) so side-by-side contact feels right.
  collideCars() {
    const R = 1.05;
    const cars = this.cars;
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (Math.abs(A.x - B.x) > 6 || Math.abs(A.z - B.z) > 6) continue;
        for (const sa of [-1.1, 1.1]) {
          for (const sb of [-1.1, 1.1]) {
            const ax = A.x + Math.sin(A.yaw) * sa, az = A.z + Math.cos(A.yaw) * sa;
            const bx = B.x + Math.sin(B.yaw) * sb, bz = B.z + Math.cos(B.yaw) * sb;
            let dx = bx - ax, dz = bz - az;
            const d = Math.hypot(dx, dz);
            if (d >= R * 2 || d < 1e-4) continue;
            dx /= d;
            dz /= d;
            const push = (R * 2 - d) / 2;
            A.x -= dx * push;
            A.z -= dz * push;
            B.x += dx * push;
            B.z += dz * push;
            const rel = (B.vx - A.vx) * dx + (B.vz - A.vz) * dz;
            if (rel < 0) {
              const j = -rel * 0.65;
              A.vx -= dx * j;
              A.vz -= dz * j;
              B.vx += dx * j;
              B.vz += dz * j;
              A.impact = Math.max(A.impact, -rel);
              B.impact = Math.max(B.impact, -rel);
            }
          }
        }
      }
    }
  }

  syncModels(dt) {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const model = this.models[i];
      car.applyToModel(model, dt);
      model.root.updateMatrixWorld();
      const night = this.timeCfg.headlights;
      model.tail.emissiveIntensity = car.braking ? 4 : 0.5 + night * 1.2;
    }
  }

  dispose() {
    if (!this.track) return;
    this.scene.remove(this.track.group);
    this.track.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) for (const m of [].concat(o.material)) {
        m.map?.dispose();
        m.dispose();
      }
    });
    this.env.dispose();
    for (const m of this.models) {
      this.scene.remove(m.root);
      // Geometry and model materials are shared between cars; only the per-car materials are freed.
      m.root.traverse((o) => o.isMesh && !o.material.map && !o.material.userData.shared && o.material.dispose());
    }
    this.track = null;
    this.cars = [];
    this.models = [];
    this.drivers = [];
    this.resultsShown = false;
    this.state = 'idle';
  }
}

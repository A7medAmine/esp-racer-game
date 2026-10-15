// Arcade car physics on a flat track: engine, brakes, reverse, grip-limited
// cornering (the car slides when you carry too much speed), nitro, grass and walls.
import { CURB_WIDTH, ROAD_HALF_WIDTH, WALL_OFFSET } from './world/track.js';

export const TUNING = {
  maxSpeed: 68, // m/s (~245 km/h)
  nitroMaxSpeed: 86,
  accel: 15,
  nitroAccel: 9,
  brake: 32,
  reverseMax: 14,
  reverseAccel: 9,
  grip: 24, // lateral acceleration limit on asphalt (m/s^2)
  grassGrip: 12,
  grassMaxSpeed: 30,
  wheelbase: 2.7,
  maxSteer: 0.6, // radians at standstill, reduced with speed
  nitroDrain: 0.3, // per second
  nitroRegen: 0.025,
  nitroDriftRegen: 0.14,
};

const HALF_WIDTH = 1.0;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Vehicle {
  constructor(track, { name, color, isPlayer = false }) {
    this.track = track;
    this.name = name;
    this.color = color;
    this.isPlayer = isPlayer;
    this.speedScale = 1; // AI rubber-banding
    this.gripScale = 1;
    this.proj = { index: 0, i: 0, offset: 0, dist: 0 };
    this.reset();
  }

  reset() {
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.longAccel = 0;
    this.slip = 0;
    this.onGrass = false;
    this.nitro = 0.6;
    this.nitroActive = false;
    this.braking = false;
    this.reversing = false;
    this.throttle = 0;
    this.impact = 0;
    this.wheelTravel = 0; // meters rolled; each model turns it into wheel rotation
    this.trackIndex = 0;
    this.progress = 0; // samples travelled since the line (negative before the start)
    this.lapsDone = -1;
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.finished = false;
    this.finishTime = null;
    this.wrongWayTime = 0;
  }

  placeOnGrid(slot) {
    const t = this.track;
    const { back, offset } = t.gridSlot(slot);
    const s = t.N - back / t.ds;
    const p = t.pointAt(s, offset);
    this.x = p.x;
    this.z = p.z;
    this.yaw = t.headingAt(s);
    this.trackIndex = s;
    this.progress = -back / t.ds;
    t.project(this.x, this.z, s, this.proj);
    this.trackIndex = this.proj.index;
  }

  // Put the car back on the centerline facing forward (after crashes / wrong way).
  respawn() {
    const t = this.track;
    const s = this.proj.index;
    const p = t.pointAt(s, 0);
    this.x = p.x;
    this.z = p.z;
    this.yaw = t.headingAt(s);
    this.vx = this.vz = this.yawRate = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  step(input, dt, now) {
    const T = TUNING;
    const t = this.track;

    // Surface
    t.project(this.x, this.z, this.trackIndex, this.proj);
    const off = Math.abs(this.proj.offset);
    this.onGrass = off > ROAD_HALF_WIDTH + CURB_WIDTH + 0.3;
    const grip = (this.onGrass ? T.grassGrip : T.grip) * this.gripScale;

    // Nitro
    this.nitroActive = input.nitro && this.nitro > 0.01 && this.forwardSpeed > -1;
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - T.nitroDrain * dt);
    else this.nitro = Math.min(1, this.nitro + (T.nitroRegen + (this.slip > 4 ? T.nitroDriftRegen : 0)) * dt);
    const throttle = this.nitroActive ? 1 : input.throttle;
    this.throttle = throttle;
    let maxV = (this.nitroActive ? T.nitroMaxSpeed : T.maxSpeed) * this.speedScale;
    if (this.onGrass) maxV = Math.min(maxV, T.grassMaxSpeed);

    // Steering: heading turns, limited a bit above what the tires can hold,
    // so too much speed makes the car slide instead of turning sharply.
    let fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let vF = this.vx * fx + this.vz * fz;
    const speed = Math.abs(vF);
    const steerTarget = (input.steer * T.maxSteer) / (1 + speed / 17);
    this.steerAngle += (steerTarget - this.steerAngle) * Math.min(1, dt * 12);
    const yawWanted = -(vF * Math.tan(this.steerAngle)) / T.wheelbase;
    const yawLimit = (grip * 1.4) / Math.max(speed, 4);
    const yawTarget = clamp(yawWanted, -yawLimit, yawLimit);
    this.yawRate += (yawTarget - this.yawRate) * Math.min(1, dt * 10);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    fx = Math.sin(this.yaw);
    fz = Math.cos(this.yaw);
    const lx = fz, lz = -fx; // car's left
    vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * lx + this.vz * lz;

    // Longitudinal
    let a = 0;
    this.braking = false;
    this.reversing = false;
    if (throttle > 0.01) {
      if (vF < -0.5) {
        a += T.brake * throttle;
        this.braking = true;
      } else {
        const engine = T.accel + (this.nitroActive ? T.nitroAccel : 0);
        a += throttle * engine * Math.pow(Math.max(0, 1 - vF / maxV), 0.7);
      }
    }
    if (input.brake > 0.01) {
      if (vF > 0.5) {
        a -= T.brake * input.brake;
        this.braking = true;
      } else if (throttle <= 0.01) {
        this.reversing = true;
        if (vF > -T.reverseMax) a -= T.reverseAccel * input.brake;
      }
    }
    a -= 0.00045 * vF * Math.abs(vF) + Math.sign(vF) * (this.onGrass ? 1.6 : 0.35);
    if (vF > maxV) a -= (vF - maxV) * 1.5;
    if (this.onGrass && Math.abs(vF) > T.grassMaxSpeed) a -= Math.sign(vF) * 6;
    const vBefore = vF;
    vF += a * dt;
    // Brakes and drag stop the car, they never push it backwards.
    if (!this.reversing && throttle <= 0.01 && Math.sign(vF) !== Math.sign(vBefore) && vBefore !== 0) vF = 0;
    if (Math.abs(vF) < 0.05 && throttle <= 0.01 && input.brake <= 0.01) vF = 0;
    this.longAccel = (vF - vBefore) / dt;

    // Lateral grip pulls the velocity back in line with the heading.
    const maxDv = grip * dt;
    vL -= clamp(vL, -maxDv, maxDv);
    this.slip = Math.abs(vL);
    vF -= Math.sign(vF) * Math.min(Math.abs(vF), this.slip * 0.35 * dt);

    this.vx = fx * vF + lx * vL;
    this.vz = fz * vF + lz * vL;
    this.forwardSpeed = vF;
    this.lateralSpeed = vL;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.collideWalls();
    this.updateProgress(now, dt);
    this.wheelTravel += vF * dt;
  }

  collideWalls() {
    const t = this.track;
    t.project(this.x, this.z, this.trackIndex, this.proj);
    const limit = WALL_OFFSET - HALF_WIDTH;
    const off = this.proj.offset;
    if (Math.abs(off) <= limit) return;
    const side = Math.sign(off);
    const i = this.proj.i;
    const nx = t.nx[i] * side, nz = t.nz[i] * side; // pointing out of the track
    const pen = Math.abs(off) - limit;
    this.x -= nx * pen;
    this.z -= nz * pen;
    const vn = this.vx * nx + this.vz * nz;
    if (vn > 0) {
      this.vx -= nx * vn * 1.3;
      this.vz -= nz * vn * 1.3;
      const keep = 1 - Math.min(0.45, vn * 0.025);
      this.vx *= keep;
      this.vz *= keep;
      this.impact = Math.max(this.impact, vn);
      // Turn the nose along the wall so the car doesn't stick to it.
      const along = this.vx * t.tx[i] + this.vz * t.tz[i] >= 0 ? 1 : -1;
      const wallYaw = Math.atan2(t.tx[i] * along, t.tz[i] * along);
      this.yaw = wrapAngle(this.yaw + wrapAngle(wallYaw - this.yaw) * Math.min(0.5, vn * 0.04));
    }
  }

  updateProgress(now, dt) {
    const t = this.track;
    const idx = this.proj.index;
    this.progress += t.delta(this.trackIndex, idx);
    this.trackIndex = idx;

    const laps = Math.floor(this.progress / t.N);
    if (laps > this.lapsDone) {
      if (this.lapsDone >= 0) {
        const lap = now - this.lapStart;
        this.lapTimes.push(lap);
        if (this.bestLap === null || lap < this.bestLap) this.bestLap = lap;
        this.lapStart = now;
        this.onLap?.(lap, laps);
      }
      this.lapsDone = laps;
    }

    // Wrong-way detection
    const i = this.proj.i;
    const along = this.vx * t.tx[i] + this.vz * t.tz[i];
    this.wrongWayTime = along < -4 ? this.wrongWayTime + dt : 0;
  }

  // Sync a car model to the physics state.
  applyToModel(model, dt) {
    model.root.position.set(this.x, 0, this.z);
    model.root.rotation.y = this.yaw;
    const roll = clamp(-this.yawRate * this.forwardSpeed * 0.0035, -0.08, 0.08);
    const pitch = clamp(-this.longAccel * 0.0028, -0.05, 0.05);
    const k = Math.min(1, dt * 8);
    model.body.rotation.z += (roll - model.body.rotation.z) * k;
    model.body.rotation.x += (pitch - model.body.rotation.x) * k;
    model.body.position.y = this.onGrass ? Math.sin(performance.now() * 0.05) * 0.015 * Math.min(1, this.speed / 10) : 0;
    for (const w of model.wheels) {
      w.spin.rotation.x = this.wheelTravel / model.wheelRadius;
      if (w.front) w.pivot.rotation.y = -this.steerAngle;
    }
  }
}

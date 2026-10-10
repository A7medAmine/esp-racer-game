// AI drivers: follow a racing lane, brake for corners using the track
// curvature ahead, overtake slower cars and use nitro on straights.
import { TUNING } from './vehicle.js';

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class AIDriver {
  constructor(vehicle, track, skill, seed) {
    this.car = vehicle;
    this.track = track;
    this.skill = skill; // 0.8 .. 1.0
    this.lane = ((seed % 3) - 1) * 2.5;
    this.laneTarget = this.lane;
    this.stuckTime = 0;
    this.input = { steer: 0, throttle: 0, brake: 0, nitro: false };
    this.target = { x: 0, z: 0 };
  }

  think(dt, cars, player, raceRunning) {
    const car = this.car;
    const t = this.track;
    const input = this.input;
    if (!raceRunning || car.finished) {
      input.steer = 0;
      input.throttle = 0;
      input.brake = car.finished ? 0.3 : 1;
      input.nitro = false;
      return input;
    }

    const speed = Math.max(0, car.forwardSpeed);
    const idx = car.trackIndex;

    // Rubber band: keep the pack close to the player so races stay exciting.
    const gap = (player.progress - car.progress) * t.ds; // + = player ahead
    const band = clamp(gap / 400, -1, 1);
    car.speedScale = clamp(0.95 + this.skill * 0.05 + band * 0.06, 0.88, 1.08);
    car.gripScale = 0.97 + band * 0.04;

    // Traffic: move to another lane when a car is close ahead.
    this.laneTarget = this.lane;
    for (const other of cars) {
      if (other === car) continue;
      const ahead = t.delta(idx, other.trackIndex) * t.ds;
      if (ahead > 0 && ahead < 18) {
        const lat = other.proj.offset - car.proj.offset;
        if (Math.abs(lat) < 3) this.laneTarget = other.proj.offset > 0 ? -3.2 : 3.2;
      }
    }
    // Ease lane toward the inside on corners for a racing line feel.
    const look = Math.round(25 / t.ds);
    const curvAhead = t.curv[t.wrap(Math.floor(idx) + look)];
    // Positive curvature bends toward -offset, so the inside is the negative side.
    const inside = clamp(-curvAhead * 900, -3, 3);
    const laneGoal = clamp(this.laneTarget + inside, -5, 5);
    this.laneCurrent = (this.laneCurrent ?? this.lane) + (laneGoal - (this.laneCurrent ?? this.lane)) * Math.min(1, dt * 1.2);

    // Steering toward a point ahead on the lane.
    const lookAhead = (9 + speed * 0.45) / t.ds;
    const p = t.pointAt(idx + lookAhead, this.laneCurrent);
    const desired = Math.atan2(p.x - car.x, p.z - car.z);
    const diff = wrapAngle(desired - car.yaw);
    input.steer = clamp(-diff * 2.6, -1, 1);

    // Speed planning: the slowest corner ahead (accounting for braking distance).
    const grip = TUNING.grip * car.gripScale * (0.82 + this.skill * 0.12);
    const brakeDecel = TUNING.brake * 0.6;
    const scan = (speed * 2.4 + 40) / t.ds;
    let target = TUNING.maxSpeed * car.speedScale;
    for (let k = 4; k < scan; k += 3) {
      const c = Math.abs(t.curv[t.wrap(Math.floor(idx) + k)]);
      if (c < 1e-4) continue;
      const vCorner = Math.sqrt(grip / c);
      const dist = k * t.ds;
      const allowed = Math.sqrt(vCorner * vCorner + 2 * brakeDecel * dist);
      if (allowed < target) target = allowed;
    }

    if (speed < target - 1) {
      input.throttle = 1;
      input.brake = 0;
    } else if (speed > target + 1.5) {
      input.throttle = 0;
      input.brake = clamp((speed - target) / 8, 0.2, 1);
    } else {
      input.throttle = 0.4;
      input.brake = 0;
    }
    input.nitro = car.nitro > 0.4 && target > speed + 18 && Math.abs(input.steer) < 0.3 && this.skill > 0.85;

    // Recover when stuck against a wall or spun around.
    if (speed < 2 || car.wrongWayTime > 1.5) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 2.5) {
      car.respawn();
      this.stuckTime = 0;
    }
    return input;
  }
}

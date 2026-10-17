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

// Difficulty presets. speed: base top-speed scale (plus skill * 0.05);
// catchUp / easeOff: rubber-band strength when behind / ahead of the player;
// grip: base cornering grip (plus skill * 0.12); nitroSkill: minimum skill to use nitro.
export const DIFFICULTY = {
  easy: { speed: 0.8, min: 0.72, max: 0.9, catchUp: 0.03, easeOff: 0.1, grip: 0.7, gripBase: 0.93, nitroSkill: 2 },
  normal: { speed: 0.87, min: 0.8, max: 0.96, catchUp: 0.04, easeOff: 0.08, grip: 0.76, gripBase: 0.95, nitroSkill: 0.92 },
  hard: { speed: 0.95, min: 0.88, max: 1.08, catchUp: 0.06, easeOff: 0.06, grip: 0.82, gripBase: 0.97, nitroSkill: 0.85 },
};

export class AIDriver {
  constructor(vehicle, track, skill, seed, difficulty = 'normal') {
    this.car = vehicle;
    this.track = track;
    this.skill = skill; // 0.8 .. 1.0
    this.diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
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
    // Asymmetric: AI ahead of the player eases off harder than AI behind catches up.
    const band = clamp(gap / 400, -1, 1);
    const d = this.diff;
    const pull = band > 0 ? band * d.catchUp : band * d.easeOff;
    car.speedScale = clamp(d.speed + this.skill * 0.05 + pull, d.min, d.max);
    car.gripScale = d.gripBase + band * 0.03;

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
    const grip = TUNING.grip * car.gripScale * (d.grip + this.skill * 0.12);
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
    const straight = Math.abs(input.steer) < 0.3;
    input.nitro = this.skill > d.nitroSkill && straight &&
      (car.overdrive > 0 ? target > speed + 4 : car.nitro > 0.4 && target > speed + 18);

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

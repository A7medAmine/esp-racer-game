// Chase camera with speed-based FOV, drift lag, impact shake and a showroom orbit.
import * as THREE from 'three';

const MODES = [
  { name: 'chase', dist: 7.2, height: 2.6, look: 1.1 },
  { name: 'far', dist: 11, height: 4.2, look: 1.0 },
  { name: 'hood', dist: -0.6, height: 1.45, look: 1.25 },
];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.orbitAngle = 0.8;
    this.blend = 1; // 0 = orbit, 1 = chase
    this.tmp = new THREE.Vector3();
  }

  nextMode() {
    this.mode = (this.mode + 1) % MODES.length;
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  // Jump straight behind the car (used when a race is built); menus then swoop into the orbit.
  snapTo(car) {
    this.yaw = car.yaw;
    this.blend = 1;
    this.chaseTarget(car, this.pos, this.look);
  }

  chaseTarget(car, outPos, outLook) {
    const m = MODES[this.mode];
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    outPos.set(car.x - fx * m.dist, m.height, car.z - fz * m.dist);
    const ahead = this.mode === 2 ? 20 : 4;
    outLook.set(car.x + Math.sin(car.yaw) * ahead, m.look, car.z + Math.cos(car.yaw) * ahead);
  }

  orbitTarget(car, outPos, outLook) {
    const r = 8.5;
    outPos.set(car.x + Math.sin(this.orbitAngle) * r, 2.2, car.z + Math.cos(this.orbitAngle) * r);
    outLook.set(car.x, 0.8, car.z);
  }

  // `orbit` = showroom spin (menus). Blend smoothly into the chase view.
  update(dt, car, { orbit = false, nitro = false } = {}) {
    const cam = this.camera;
    this.orbitAngle += dt * 0.25;
    this.blend += ((orbit ? 0 : 1) - this.blend) * Math.min(1, dt * 1.6);

    // The camera trails the car's heading; while drifting it lags behind for drama.
    let diff = car.yaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const rate = this.mode === 2 ? 20 : 4.5;
    this.yaw += diff * Math.min(1, dt * rate);
    const chasePos = this.tmp.set(0, 0, 0);
    const chaseLook = new THREE.Vector3();
    this.chaseTarget(car, chasePos, chaseLook);
    const orbitPos = new THREE.Vector3();
    const orbitLook = new THREE.Vector3();
    this.orbitTarget(car, orbitPos, orbitLook);

    const b = this.blend;
    const wantPos = orbitPos.lerp(chasePos, b);
    const wantLook = orbitLook.lerp(chaseLook, b);
    const follow = this.mode === 2 ? 1 : Math.min(1, dt * 9);
    if (this.mode === 2 && b > 0.98) this.pos.copy(wantPos);
    else this.pos.lerp(wantPos, b > 0.98 ? follow : Math.min(1, dt * 5));
    this.look.lerp(wantLook, Math.min(1, dt * 12));

    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 6);
    }
    // Subtle high-speed vibration.
    const speed = car.speed;
    if (speed > 40 && b > 0.9) cam.position.y += (Math.random() - 0.5) * 0.012 * (speed - 40) / 20;
    cam.lookAt(this.look);

    const fov = 60 + Math.min(speed, 90) * 0.17 * b + (nitro ? 8 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }
}

// GPU particles (tire smoke, dust, nitro flames, sparks) and skid marks.
import * as THREE from 'three';
import { softDotTexture } from './world/textures.js';

const particleVertex = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float scale;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFragment = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vTint, t.a * vAlpha);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

class ParticleSystem {
  constructor(max, additive) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.rise = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.tintAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('size', this.sizeAttr);
    geo.setAttribute('alpha', this.alphaAttr);
    geo.setAttribute('tint', this.tintAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: { map: { value: softDotTexture() }, scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(x, y, z, vx, vy, vz, { life = 1, size0 = 1, size1 = 3, alpha = 0.6, color = 0xffffff, drag = 1, rise = 0 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.drag[i] = drag;
    this.rise[i] = rise;
    const c = typeof color === 'number' ? new THREE.Color(color) : color;
    this.tintAttr.setXYZ(i, c.r, c.g, c.b);
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alphaAttr.array[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d + this.rise[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.sizeAttr.array[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alphaAttr.array[i] = this.alpha0[i] * (1 - t) * Math.min(1, t * 8);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}

class SkidMarks {
  constructor(max = 900) {
    this.max = max;
    this.next = 0;
    const geo = new THREE.PlaneGeometry(0.3, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3(1, 1, 1);
    this.p = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.last = new Map(); // wheel key -> last point
  }

  // Adds a segment from the last mark of this wheel to (x, z).
  add(key, x, z) {
    const last = this.last.get(key);
    this.last.set(key, { x, z });
    if (!last) return;
    const dx = x - last.x, dz = z - last.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 3) return;
    this.p.set((x + last.x) / 2, 0.035, (z + last.z) / 2);
    this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
    this.s.set(1, 1, len);
    this.mesh.setMatrixAt(this.next, this.m.compose(this.p, this.q, this.s));
    this.next = (this.next + 1) % this.max;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  lift(key) {
    this.last.delete(key);
  }

  clear() {
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.last.clear();
  }
}

export class Effects {
  constructor(scene) {
    this.smoke = new ParticleSystem(1400, false);
    this.glow = new ParticleSystem(700, true);
    this.skids = new SkidMarks();
    scene.add(this.smoke.points, this.glow.points, this.skids.mesh);
    this.tmp = new THREE.Vector3();
    this.flameA = new THREE.Color(0x66aaff);
    this.flameB = new THREE.Color(0xff7a1a);
  }

  setViewportHeight(h) {
    this.smoke.material.uniforms.scale.value = h * 0.9;
    this.glow.material.uniforms.scale.value = h * 0.9;
  }

  // Per-car effects driven by its physics state.
  updateCar(car, model, dt, groundColor) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const lx = fz, lz = -fx;
    const speed = car.speed;
    const sliding = car.slip > 3.5 && speed > 6;
    const burnout = car.throttle > 0.9 && car.forwardSpeed < 6 && car.forwardSpeed > -1 && !car.onGrass;
    const hardBrake = car.braking && speed > 12 && !car.onGrass;

    const { z: axleZ, x: axleX } = model.rearAxle;
    for (const side of [-1, 1]) {
      const wx = car.x + fx * axleZ + lx * side * axleX;
      const wz = car.z + fz * axleZ + lz * side * axleX;
      const key = `${car.name}${side}`;
      if (car.onGrass && speed > 5) {
        if (Math.random() < Math.min(1, speed / 25)) {
          this.smoke.emit(wx, 0.3, wz, -car.vx * 0.1 + (Math.random() - 0.5) * 2, 1 + Math.random(), -car.vz * 0.1 + (Math.random() - 0.5) * 2,
            { life: 1.2, size0: 0.8, size1: 3.2, alpha: 0.5, color: groundColor, drag: 2, rise: -1 });
        }
        this.skids.lift(key);
      } else if (sliding || burnout || hardBrake) {
        const intensity = Math.min(1, (car.slip - 2) / 8 + (burnout ? 0.7 : 0) + (hardBrake ? 0.3 : 0));
        if (Math.random() < intensity) {
          this.smoke.emit(wx, 0.35, wz, (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5,
            { life: 2.2, size0: 0.8, size1: 5.5, alpha: 0.32 * intensity + 0.1, color: 0xdcdcdc, drag: 1.2, rise: 0.4 });
        }
        this.skids.add(key, wx, wz);
      } else {
        this.skids.lift(key);
      }
    }

    if (car.nitroActive) {
      for (const ex of model.exhausts) {
        this.tmp.copy(ex).applyMatrix4(model.root.matrixWorld);
        for (let k = 0; k < 2; k++) {
          const back = 6 + Math.random() * 6;
          this.glow.emit(this.tmp.x, this.tmp.y, this.tmp.z,
            car.vx - fx * back + (Math.random() - 0.5), (Math.random() - 0.3) * 0.6, car.vz - fz * back + (Math.random() - 0.5),
            { life: 0.18 + Math.random() * 0.1, size0: 0.55, size1: 0.1, alpha: 0.9, color: k ? this.flameA : this.flameB, drag: 4 });
        }
      }
    }

    if (car.impact > 3) {
      for (let k = 0; k < Math.min(30, car.impact * 2); k++) {
        this.glow.emit(car.x + fx * 1.5, 0.6, car.z + fz * 1.5,
          car.vx * 0.3 + (Math.random() - 0.5) * 10, Math.random() * 5, car.vz * 0.3 + (Math.random() - 0.5) * 10,
          { life: 0.35 + Math.random() * 0.3, size0: 0.25, size1: 0.05, alpha: 1, color: 0xffc040, drag: 1.5, rise: -9.8 });
      }
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.glow.update(dt);
  }

  clear() {
    this.smoke.clear();
    this.glow.clear();
    this.skids.clear();
  }
}

// Nitro tokens floating over the road. Driving through one collects it:
//   refill:    fills the nitro tank.
//   overdrive: unlimited nitro for a few seconds, then nitro is locked for a while (see TUNING).
// A collected token comes back after RESPAWN seconds. Every car can take them.
import * as THREE from 'three';

const RESPAWN = 10; // seconds
const RADIUS = 2.8; // pickup distance (m)
const SPACING = 230; // meters of track per token
const OFFSETS = [-3.5, 3.5, 0]; // lateral positions, cycled
const HOVER = 1.6;

export const PICKUP_COLORS = { refill: '#38e1ff', overdrive: '#ffb020' };

// Face texture: lightning bolt for refill, infinity sign for overdrive.
function faceTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const color = PICKUP_COLORS[kind];
  ctx.fillStyle = '#0b1020';
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (kind === 'refill') {
    ctx.beginPath();
    for (const [x, y] of [[72, 18], [36, 70], [60, 70], [52, 110], [92, 54], [68, 54], [80, 18]]) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.lineWidth = 12;
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) {
      // Lemniscate of Bernoulli
      const t = (k / 64) * Math.PI * 2;
      const d = 1 + Math.sin(t) ** 2;
      const x = 64 + (38 * Math.cos(t)) / d;
      const y = 64 + (38 * Math.sin(t) * Math.cos(t)) / d;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Pickups {
  constructor(track) {
    this.track = track;
    this.group = new THREE.Group();
    this.items = [];
    this.time = 0;

    const disc = new THREE.CylinderGeometry(1.05, 1.05, 0.22, 40);
    disc.rotateX(Math.PI / 2); // caps face forward / back
    const ring = new THREE.TorusGeometry(1.35, 0.08, 8, 48);
    const mats = {};
    for (const kind of ['refill', 'overdrive']) {
      const color = new THREE.Color(PICKUP_COLORS[kind]);
      const face = faceTexture(kind);
      const rim = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.3 });
      const cap = new THREE.MeshStandardMaterial({ map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 1.4 });
      const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
      mats[kind] = { disc: [rim, cap, cap], ring: glow };
    }

    // Spread tokens around the lap, each nudged onto the straightest spot nearby,
    // skipping the start straight so the grid doesn't grab them all at once.
    const t = track;
    const count = Math.max(4, Math.round(t.length / SPACING));
    const reach = Math.round(40 / t.ds);
    const startSkip = 0.07;
    for (let k = 0; k < count; k++) {
      let s = Math.round((startSkip + ((1 - startSkip * 1.5) * (k + 0.5)) / count) * t.N);
      let best = s, bestC = Infinity;
      for (let d = -reach; d <= reach; d++) {
        const c = Math.abs(t.curv[t.wrap(s + d)]);
        if (c < bestC) {
          bestC = c;
          best = s + d;
        }
      }
      s = t.wrap(best);
      const kind = k % 3 === 1 ? 'overdrive' : 'refill';
      const p = t.pointAt(s, OFFSETS[k % OFFSETS.length]);
      const root = new THREE.Group();
      root.position.set(p.x, HOVER, p.z);
      root.rotation.y = t.headingAt(s);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(disc, mats[kind].disc), new THREE.Mesh(ring, mats[kind].ring));
      root.add(spin);
      this.group.add(root);
      this.items.push({ kind, x: p.x, z: p.z, root, spin, phase: k * 1.7, cooldown: 0 });
    }
  }

  // Returns the car's collected kind, or null.
  check(car) {
    for (const it of this.items) {
      if (it.cooldown > 0) continue;
      const dx = car.x - it.x, dz = car.z - it.z;
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      it.cooldown = RESPAWN;
      it.root.visible = false;
      return it;
    }
    return null;
  }

  update(dt) {
    this.time += dt;
    for (const it of this.items) {
      if (it.cooldown > 0) {
        it.cooldown -= dt;
        if (it.cooldown > 0) continue;
        it.cooldown = 0;
        it.root.visible = true;
        it.grow = 0;
      }
      if (it.grow !== undefined && it.grow < 1) it.grow = Math.min(1, it.grow + dt * 3);
      it.root.scale.setScalar(it.grow ?? 1);
      it.spin.rotation.y = this.time * 2.4 + it.phase;
      it.root.position.y = HOVER + Math.sin(this.time * 2.2 + it.phase) * 0.25;
    }
  }

  reset() {
    for (const it of this.items) {
      it.cooldown = 0;
      it.grow = 1;
      it.root.visible = true;
    }
  }
}

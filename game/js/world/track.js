// Track: spline sampling, geometry (road, curbs, verge, walls, start gantry)
// and fast spatial queries used by physics and AI.
import * as THREE from 'three';
import {
  bannerTexture,
  barrierTexture,
  checkerTexture,
  crowdTexture,
  curbTexture,
  roadTexture,
  vergeTexture,
} from './textures.js';

export const ROAD_HALF_WIDTH = 7;
export const CURB_WIDTH = 1.3;
export const WALL_OFFSET = 17; // distance from centerline to the barrier face
const WALL_HEIGHT = 1.1;
const SAMPLE_SPACING = 2; // meters between samples

export class Track {
  constructor(def, theme) {
    this.def = def;
    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    const N = Math.round(this.length / SAMPLE_SPACING);
    this.N = N;
    this.ds = this.length / N;
    const pts = curve.getSpacedPoints(N);

    this.px = new Float32Array(N);
    this.pz = new Float32Array(N);
    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    this.nx = new Float32Array(N); // unit normal, "left" side = +offset
    this.nz = new Float32Array(N);
    this.curv = new Float32Array(N); // signed curvature (1/m)
    for (let i = 0; i < N; i++) {
      this.px[i] = pts[i].x;
      this.pz[i] = pts[i].z;
    }
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 1);
      const b = this.wrap(i + 1);
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.nx[i] = dz;
      this.nz[i] = -dx;
    }
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 2);
      const b = this.wrap(i + 2);
      const h1 = Math.atan2(this.tz[a], this.tx[a]);
      const h2 = Math.atan2(this.tz[b], this.tx[b]);
      let dh = h2 - h1;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.curv[i] = dh / (4 * this.ds);
    }

    this.group = new THREE.Group();
    this.startLights = [];
    this.buildMeshes(theme);
    this.projection = { index: 0, i: 0, offset: 0, dist: 0 };
  }

  wrap(i) {
    return ((i % this.N) + this.N) % this.N;
  }

  // Signed number of samples from a to b, taking the shortest way around.
  delta(a, b) {
    let d = b - a;
    if (d > this.N / 2) d -= this.N;
    if (d < -this.N / 2) d += this.N;
    return d;
  }

  // World position of a point `offset` meters left of the centerline at fractional index s.
  pointAt(s, offset = 0, out = new THREE.Vector3()) {
    const i = this.wrap(Math.floor(s));
    const j = this.wrap(i + 1);
    const f = s - Math.floor(s);
    const x = this.px[i] + (this.px[j] - this.px[i]) * f + this.nx[i] * offset;
    const z = this.pz[i] + (this.pz[j] - this.pz[i]) * f + this.nz[i] * offset;
    return out.set(x, 0, z);
  }

  headingAt(s) {
    const i = this.wrap(Math.round(s));
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  // Nearest point on the centerline. `hint` (previous index) makes it O(1).
  project(x, z, hint = -1, out = this.projection) {
    let best = -1;
    let bestD = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = this.wrap(k);
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    };
    if (hint >= 0) scan(Math.floor(hint) - 25, Math.floor(hint) + 25);
    if (best < 0 || bestD > 40 * 40) scan(0, this.N - 1);

    let i = best;
    let along = (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i];
    if (along < 0) {
      i = this.wrap(i - 1);
      along = (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i];
    }
    const f = Math.max(0, Math.min(1, along / this.ds));
    out.i = i;
    out.index = i + f;
    out.offset = (x - this.px[i]) * this.nx[i] + (z - this.pz[i]) * this.nz[i];
    out.dist = Math.sqrt(bestD);
    return out;
  }

  // Coarse distance to the centerline, for placing scenery.
  distanceTo(x, z) {
    let bestD = Infinity;
    for (let i = 0; i < this.N; i += 3) {
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) bestD = d;
    }
    return Math.sqrt(bestD);
  }

  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]);
      maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]);
      maxZ = Math.max(maxZ, this.pz[i]);
    }
    return { minX, maxX, minZ, maxZ };
  }

  // ------------------------------------------------------------------ geometry
  // A strip following the track between two lateral offsets. Builds the run
  // [from, to] of samples (inclusive, may wrap). `y` can differ per edge so the
  // same helper makes floors and walls.
  ribbon({ offA, offB, yA = 0, yB = 0, from = 0, to = this.N, vScale = 10, alongU = false, uSign = 1 }) {
    const count = to - from + 1;
    const pos = new Float32Array(count * 2 * 3);
    const uv = new Float32Array(count * 2 * 2);
    for (let k = 0; k < count; k++) {
      const i = this.wrap(from + k);
      const along = ((from + k) * this.ds) / vScale;
      for (let e = 0; e < 2; e++) {
        const off = e === 0 ? offA : offB;
        const o = (k * 2 + e) * 3;
        pos[o] = this.px[i] + this.nx[i] * off;
        pos[o + 1] = e === 0 ? yA : yB;
        pos[o + 2] = this.pz[i] + this.nz[i] * off;
        const across = e;
        const u = (k * 2 + e) * 2;
        if (alongU) {
          uv[u] = along * uSign;
          uv[u + 1] = across;
        } else {
          uv[u] = across;
          uv[u + 1] = along;
        }
      }
    }
    const idx = [];
    for (let k = 0; k < count - 1; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Ensures a ribbon faces the wanted direction (flips winding if needed).
  orient(g, want) {
    const n = g.attributes.normal;
    const mid = Math.floor(n.count / 2);
    const dot = n.getX(mid) * want.x + n.getY(mid) * want.y + n.getZ(mid) * want.z;
    if (dot < 0) {
      const index = g.index.array;
      for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
      g.index.needsUpdate = true;
      g.computeVertexNormals();
    }
    return g;
  }

  // Runs of samples where a condition holds (used to put curbs only on corners).
  runs(test, minLen = 8, pad = 6) {
    const on = new Uint8Array(this.N);
    for (let i = 0; i < this.N; i++) if (test(i)) for (let p = -pad; p <= pad; p++) on[this.wrap(i + p)] = 1;
    const out = [];
    if (on.every((v) => v)) return [[0, this.N]];
    let start = on.findIndex((v) => !v); // begin scanning just after a gap
    let k = 0;
    while (k < this.N) {
      const i = this.wrap(start + k);
      if (on[i]) {
        const s = start + k;
        while (k < this.N && on[this.wrap(start + k)]) k++;
        if (start + k - s >= minLen) out.push([s, start + k]);
      } else k++;
    }
    return out;
  }

  buildMeshes(theme) {
    const g = this.group;
    const HW = ROAD_HALF_WIDTH;
    const up = new THREE.Vector3(0, 1, 0);
    const mid = Math.floor(this.N / 2);

    // Road
    const roadTex = roadTexture();
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.82,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const reps = Math.round(this.length / 14);
    const road = new THREE.Mesh(
      this.orient(this.ribbon({ offA: -HW, offB: HW, yA: 0.02, yB: 0.02, vScale: this.length / reps }), up),
      roadMat,
    );
    road.receiveShadow = true;
    g.add(road);

    // Verge (mowed grass between road and wall)
    const vergeMat = new THREE.MeshStandardMaterial({
      map: vergeTexture(theme.vergeLight, theme.vergeDark),
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (const [a, b] of [[HW, WALL_OFFSET + 0.5], [-WALL_OFFSET - 0.5, -HW]]) {
      const m = new THREE.Mesh(this.orient(this.ribbon({ offA: a, offB: b, yA: 0.01, yB: 0.01, vScale: 8 }), up), vergeMat);
      m.receiveShadow = true;
      g.add(m);
    }

    // Curbs on corners only
    const curbMat = new THREE.MeshStandardMaterial({
      map: curbTexture(),
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    for (const [from, to] of this.runs((i) => Math.abs(this.curv[i]) > 1 / 220)) {
      for (const side of [1, -1]) {
        const a = side * HW;
        const b = side * (HW + CURB_WIDTH);
        const geo = this.ribbon({ offA: Math.min(a, b), offB: Math.max(a, b), yA: 0.05, yB: 0.03, from, to, vScale: 4 });
        const m = new THREE.Mesh(this.orient(geo, up), curbMat);
        m.receiveShadow = true;
        g.add(m);
      }
    }

    // Barrier walls with sponsor boards, plus a top cap.
    const wallTex = barrierTexture();
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.1 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xbfc3c8, roughness: 0.4, metalness: 0.6 });
    const wallLen = this.length / Math.round(this.length / 24);
    for (const side of [1, -1]) {
      const off = side * WALL_OFFSET;
      const inward = new THREE.Vector3(-side * this.nx[mid], 0, -side * this.nz[mid]);
      const face = this.ribbon({ offA: off, offB: off, yA: 0, yB: WALL_HEIGHT, vScale: wallLen, alongU: true, uSign: side });
      const wall = new THREE.Mesh(this.orient(face, inward), wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);
      const back = this.ribbon({ offA: off + side * 0.35, offB: off + side * 0.35, yA: 0, yB: WALL_HEIGHT, vScale: 50 });
      g.add(new THREE.Mesh(this.orient(back, inward.clone().negate()), capMat));
      const top = this.ribbon({ offA: off, offB: off + side * 0.35, yA: WALL_HEIGHT, yB: WALL_HEIGHT, vScale: 50 });
      g.add(new THREE.Mesh(this.orient(top, up), capMat));
    }

    this.buildStart();
    this.buildPoles();
  }

  buildStart() {
    const HW = ROAD_HALF_WIDTH;
    const heading = this.headingAt(0);
    const origin = this.pointAt(0);
    const frame = new THREE.Group();
    frame.position.copy(origin);
    frame.rotation.y = heading;
    this.group.add(frame);

    // Checkered line (local x = across road, z = along)
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(HW * 2, 2.4),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.03;
    line.receiveShadow = true;
    frame.add(line);

    // Grid boxes
    const gridMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (let k = 0; k < 6; k++) {
      const slot = this.gridSlot(k);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25), gridMat);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(slot.offset, 0.03, -slot.back + 2.6);
      frame.add(bar);
    }

    // Gantry
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.8 });
    const span = HW + 3;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), steel);
      pillar.position.set(side * span, 4, 0);
      pillar.castShadow = true;
      frame.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.7, 1.8, 0.8), steel);
    beam.position.set(0, 7.6, 0);
    beam.castShadow = true;
    frame.add(beam);
    // Side facing the cars as they arrive carries the AFAQ Open Week banner.
    const banners = [
      { dir: -1, tex: bannerTexture('AFAQ OPEN WEEK', { afaq: true }) },
      { dir: 1, tex: bannerTexture('ESP RACER') },
    ];
    for (const { dir, tex } of banners) {
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.6 });
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 2, 1.5), mat);
      banner.position.set(0, 7.6, dir * 0.41);
      if (dir < 0) banner.rotation.y = Math.PI;
      frame.add(banner);
    }
    // Start lights face the grid (cars come from -z).
    for (let k = 0; k < 5; k++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.3 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), mat);
      lamp.position.set((k - 2) * 1.1, 6.1, -0.45);
      frame.add(lamp);
      this.startLights.push(mat);
    }
    const housing = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1, 0.5), steel);
    housing.position.set(0, 6.1, -0.1);
    frame.add(housing);

    // Grandstand on the left of the main straight, facing the track.
    const stand = new THREE.Group();
    const standMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.8 });
    const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 1 });
    crowdMat.map.repeat.set(4, 1);
    const length = 90;
    for (let r = 0; r < 6; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(length, 0.8, 1.6), standMat);
      step.position.set(0, 0.4 + r * 0.8, r * 1.6);
      step.castShadow = step.receiveShadow = true;
      stand.add(step);
      const crowd = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.9), crowdMat);
      crowd.position.set(0, 1.2 + r * 0.8, r * 1.6 - 0.35);
      crowd.rotation.y = Math.PI;
      stand.add(crowd);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 4, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.4, metalness: 0.5 }));
    roof.position.set(0, 9.5, 4);
    roof.castShadow = true;
    stand.add(roof);
    for (const x of [-length / 2, 0, length / 2]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9.5, 0.5), steel);
      col.position.set(x, 4.75, 9.5);
      stand.add(col);
    }
    // Stand sits behind the left wall, rotated so the crowd looks at the road.
    stand.position.set(WALL_OFFSET + 4, 0, -10);
    stand.rotation.y = Math.PI / 2;
    frame.add(stand);
  }

  // Starting grid slot k: meters behind the line and lateral offset.
  gridSlot(k) {
    return { back: 9 + k * 7, offset: k % 2 === 0 ? 3.4 : -3.4 };
  }

  setStartLights(count, green = false) {
    this.startLights.forEach((m, i) => {
      if (green) {
        m.color.setHex(0x003300);
        m.emissive.setHex(0x22ff44);
        m.emissiveIntensity = 4;
      } else if (i < count) {
        m.color.setHex(0x330000);
        m.emissive.setHex(0xff1010);
        m.emissiveIntensity = 5;
      } else {
        m.color.setHex(0x220000);
        m.emissive.setHex(0x000000);
      }
    });
  }

  // Light poles along the outside of the walls (lamps glow at night).
  buildPoles() {
    const every = Math.round(70 / this.ds);
    const spots = [];
    for (let i = 0; i < this.N; i += every) spots.push(i);
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 10, 8);
    poleGeo.translate(0, 5, 0);
    const armGeo = new THREE.BoxGeometry(0.15, 0.15, 3);
    const lampGeo = new THREE.BoxGeometry(0.5, 0.18, 1.4);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.4, metalness: 0.7 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1cc, emissiveIntensity: 0.3 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, spots.length);
    const lamps = new THREE.InstancedMesh(lampGeo, this.lampMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    spots.forEach((i, k) => {
      const side = k % 2 ? 1 : -1;
      const off = side * (WALL_OFFSET + 1.5);
      const x = this.px[i] + this.nx[i] * off;
      const z = this.pz[i] + this.nz[i] * off;
      // Arm points toward the road.
      const ang = Math.atan2(-side * this.nx[i], -side * this.nz[i]);
      q.setFromAxisAngle(yAxis, ang);
      poles.setMatrixAt(k, m.compose(p.set(x, 0, z), q, s));
      const ax = x - side * this.nx[i] * 1.5;
      const az = z - side * this.nz[i] * 1.5;
      arms.setMatrixAt(k, m.compose(p.set(ax, 9.9, az), q, s));
      const lx = x - side * this.nx[i] * 2.8;
      const lz = z - side * this.nz[i] * 2.8;
      lamps.setMatrixAt(k, m.compose(p.set(lx, 9.75, lz), q, s));
    });
    poles.castShadow = true;
    this.group.add(poles, arms, lamps);
  }
}

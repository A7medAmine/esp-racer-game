// Sky, lighting, ground, mountains and vegetation for a track + time of day.
import * as THREE from 'three';
import { grassTexture, rng } from './textures.js';
import { WALL_OFFSET } from './track.js';

export const THEMES = {
  meadow: {
    ground: ['#3b6b29', '#4c8534', '#2d561f'],
    verge: ['#4f8c37', '#447c30'],
    mountain: 0x5f6e5c,
    rock: 0x7b7f86,
    snow: true,
    vegetation: 'forest',
    leaf: [0x2f6b2a, 0x3c7d2f, 0x24521f, 0x4a8a35],
  },
  autumn: {
    ground: ['#5a6a2b', '#76803a', '#46511f'],
    verge: ['#6a7a33', '#5b6a2b'],
    mountain: 0x6c6862,
    rock: 0x8a847c,
    snow: true,
    vegetation: 'autumn',
    leaf: [0xc8541b, 0xe09b1d, 0xa8321a, 0x8a9a2a, 0xd8701e],
  },
  desert: {
    ground: ['#c4955a', '#d6ab70', '#ad8049'],
    verge: ['#cfa266', '#c29358'],
    mountain: 0xb0603a,
    rock: 0xa65a35,
    snow: false,
    vegetation: 'desert',
    leaf: [0x4f7a3a, 0x5d8a42],
  },
};

export const TIMES = {
  day: {
    top: 0x2a68d0, horizon: 0xb4d8f5, bottom: 0x8aa0b0,
    sunElev: 52, sunAzim: 35, sunColor: 0xfff2dc, sunIntensity: 3.0, sunDisc: 0xfff8e8,
    hemiSky: 0xcfe4ff, hemiGround: 0x5a5040, hemiIntensity: 1.1,
    fogNear: 300, fogFar: 2600, exposure: 0.95, bloom: 0.22, clouds: 0.75, stars: 0, lamps: 0.2, headlights: 0,
  },
  sunset: {
    top: 0x1f2a5c, horizon: 0xff9a55, bottom: 0x4a3040,
    sunElev: 7, sunAzim: -60, sunColor: 0xffb070, sunIntensity: 2.6, sunDisc: 0xffd2a0,
    hemiSky: 0xffb08a, hemiGround: 0x3a2a40, hemiIntensity: 0.75,
    fogNear: 250, fogFar: 2200, exposure: 1.0, bloom: 0.45, clouds: 0.6, stars: 0.05, lamps: 1.2, headlights: 0.6,
  },
  night: {
    top: 0x01030b, horizon: 0x10203a, bottom: 0x05070c,
    sunElev: 38, sunAzim: 120, sunColor: 0x9fb6ff, sunIntensity: 0.55, sunDisc: 0xdfe8ff,
    hemiSky: 0x3a4a7a, hemiGround: 0x101018, hemiIntensity: 0.45,
    fogNear: 150, fogFar: 1500, exposure: 1.15, bloom: 0.85, clouds: 0.25, stars: 1, lamps: 4, headlights: 1,
  },
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
  uniform vec3 sunDir; uniform vec3 sunDisc; uniform float clouds; uniform float stars;
  varying vec3 vDir;

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec2 x) {
    vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    float a = hash(vec3(i, 0.0)), b = hash(vec3(i + vec2(1, 0), 0.0));
    float c = hash(vec3(i + vec2(0, 1), 0.0)), d = hash(vec3(i + vec2(1, 1), 0.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4));

    float sd = max(dot(d, normalize(sunDir)), 0.0);
    col += sunDisc * (pow(sd, 900.0) * 30.0 + pow(sd, 60.0) * 0.6 + pow(sd, 6.0) * 0.18);

    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 1.6;
      float c = smoothstep(0.48, 0.85, fbm(uv + vec2(3.1, 7.7)));
      float fade = smoothstep(0.0, 0.18, h);
      vec3 cloudCol = mix(horizon * 1.15, vec3(1.0), 0.5) + sunDisc * pow(sd, 4.0) * 0.6;
      col = mix(col, cloudCol, c * clouds * fade);

      vec3 sp = floor(d * 380.0);
      float s = step(0.9975, hash(sp)) * stars * smoothstep(0.05, 0.3, h) * (1.0 - c * clouds);
      col += vec3(s) * (0.6 + 0.4 * hash(sp + 3.0)) * 2.0;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeSkyMaterial(t, sunDir) {
  return new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(t.top) },
      horizon: { value: new THREE.Color(t.horizon) },
      bottom: { value: new THREE.Color(t.bottom) },
      sunDir: { value: sunDir.clone() },
      sunDisc: { value: new THREE.Color(t.sunDisc) },
      clouds: { value: t.clouds },
      stars: { value: t.stars },
    },
  });
}

export class Environment {
  constructor({ scene, renderer, track, themeKey, timeKey, quality }) {
    this.scene = scene;
    this.theme = THEMES[themeKey];
    this.time = TIMES[timeKey];
    this.group = new THREE.Group();
    scene.add(this.group);
    const t = this.time;

    const el = THREE.MathUtils.degToRad(t.sunElev);
    const az = THREE.MathUtils.degToRad(t.sunAzim);
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();

    // Sky dome follows the camera.
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial(t, this.sunDir));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.group.add(this.sky);

    scene.fog = new THREE.Fog(t.horizon, t.fogNear, t.fogFar);
    scene.background = new THREE.Color(t.horizon);

    // Lights
    this.hemi = new THREE.HemisphereLight(t.hemiSky, t.hemiGround, t.hemiIntensity);
    this.group.add(this.hemi);
    this.sun = new THREE.DirectionalLight(t.sunColor, t.sunIntensity);
    const shadowSize = { high: 2048, medium: 1024, low: 0 }[quality];
    if (shadowSize) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const s = this.sun.shadow.camera;
      s.left = -70;
      s.right = 70;
      s.top = 70;
      s.bottom = -70;
      s.near = 1;
      s.far = 500;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
    this.group.add(this.sun, this.sun.target);

    this.buildGround(track);
    this.buildMountains(track);
    this.buildVegetation(track, quality);
    track.lampMat.emissiveIntensity = t.lamps;

    this.envMap = this.buildEnvMap(renderer);
    scene.environment = this.envMap;
  }

  buildEnvMap(renderer) {
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), makeSkyMaterial(this.time, this.sunDir));
    envScene.add(sky);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(this.theme.ground[0]).multiplyScalar(0.6 * this.time.hemiIntensity) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -4;
    envScene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.02);
    pmrem.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
    this.envTarget = rt;
    return rt.texture;
  }

  buildGround(track) {
    const [base, light, dark] = this.theme.ground;
    const tex = grassTexture(base, light, dark);
    tex.repeat.set(500, 500);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    const b = track.bounds();
    ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  buildMountains(track) {
    const rand = rng(99);
    const b = track.bounds();
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 700;
    const base = new THREE.Color(this.theme.mountain);
    const snow = new THREE.Color(0xf4f6fa);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const desert = this.theme.vegetation === 'desert';

    const count = 46;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rand() * 0.1;
      const r = radius + rand() * 600;
      const height = desert ? 90 + rand() * 160 : 180 + rand() * 360;
      const width = desert ? 180 + rand() * 260 : 220 + rand() * 300;
      const geo = desert
        ? new THREE.CylinderGeometry(width * (0.55 + rand() * 0.2), width, height, 9, 4)
        : new THREE.ConeGeometry(width, height, 8, 5);
      geo.translate(0, height / 2, 0);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > 1 && y < height - 1) {
          pos.setX(i, pos.getX(i) + (rand() - 0.5) * width * 0.25);
          pos.setZ(i, pos.getZ(i) + (rand() - 0.5) * width * 0.25);
          pos.setY(i, y + (rand() - 0.5) * height * 0.08);
        }
        const hRel = pos.getY(i) / height;
        c.copy(base).multiplyScalar(0.75 + rand() * 0.35);
        if (desert) c.lerp(new THREE.Color(0xe0a070), Math.floor(hRel * 4) % 2 ? 0.25 : 0);
        else if (this.theme.snow && hRel > 0.68) c.lerp(snow, 0.85);
        c.toArray(colors, i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cx + Math.cos(a) * r, -5, cz + Math.sin(a) * r);
      m.rotation.y = rand() * Math.PI;
      this.group.add(m);
    }
  }

  buildVegetation(track, quality) {
    const rand = rng(5);
    const b = track.bounds();
    const margin = 450;
    const density = { high: 1, medium: 0.6, low: 0.3 }[quality];
    const spots = [];
    const start = track.pointAt(0);
    const target = Math.round((this.theme.vegetation === 'desert' ? 900 : 2600) * density);
    let tries = 0;
    while (spots.length < target && tries < target * 6) {
      tries++;
      const x = b.minX - margin + rand() * (b.maxX - b.minX + margin * 2);
      const z = b.minZ - margin + rand() * (b.maxZ - b.minZ + margin * 2);
      const d = track.distanceTo(x, z);
      if (d < WALL_OFFSET + 7) continue;
      if (Math.hypot(x - start.x, z - start.z) < 80) continue;
      // Denser close to the track so the speed feels higher.
      if (d > 140 && rand() < 0.45) continue;
      spots.push([x, z, 0.75 + rand() * 0.9, rand() * 6.28]);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const leafMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 });

    const add = (geo, mat, list, place, colorFn) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((spot, i) => {
        place(spot, i);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        if (colorFn) mesh.setColorAt(i, colorFn(i));
      });
      mesh.castShadow = quality === 'high';
      mesh.receiveShadow = false;
      this.group.add(mesh);
    };

    if (this.theme.vegetation === 'desert') {
      const cacti = spots.filter((_, i) => i % 3 === 0);
      const rocks = spots.filter((_, i) => i % 3 !== 0);
      const cactusGeo = new THREE.CylinderGeometry(0.45, 0.55, 5, 7);
      cactusGeo.translate(0, 2.5, 0);
      const armGeo = new THREE.CylinderGeometry(0.3, 0.3, 2.2, 6);
      armGeo.translate(0, 1.1, 0);
      const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.8, flatShading: true });
      const scales = cacti.map(() => 0.7 + rand() * 0.8);
      add(cactusGeo, cactusMat, cacti, ([x, z], i) => {
        p.set(x, 0, z);
        q.setFromAxisAngle(up, rand() * 6.28);
        s.setScalar(scales[i]);
      });
      add(armGeo, cactusMat, cacti, ([x, z], i) => {
        const k = scales[i];
        p.set(x + 0.9 * k, 2.2 * k, z);
        q.identity();
        s.setScalar(k);
      });
      const rockGeo = new THREE.DodecahedronGeometry(1, 0);
      const rockMat = new THREE.MeshStandardMaterial({ color: this.theme.rock, roughness: 0.95, flatShading: true });
      add(rockGeo, rockMat, rocks, ([x, z]) => {
        const k = 1 + rand() * 5;
        p.set(x, k * 0.2, z);
        q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand()));
        s.set(k * (1 + rand()), k * (0.5 + rand() * 0.6), k * (1 + rand()));
      }, () => color.setHex(this.theme.rock).multiplyScalar(0.8 + rand() * 0.4));
      return;
    }

    // Forest: mix of pines and round broadleaf trees.
    const pines = spots.filter((_, i) => i % 5 < (this.theme.vegetation === 'autumn' ? 2 : 3));
    const round = spots.filter((_, i) => i % 5 >= (this.theme.vegetation === 'autumn' ? 2 : 3));
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const pineGeo = new THREE.ConeGeometry(2.6, 9, 7, 3);
    pineGeo.translate(0, 7, 0);
    const roundGeo = new THREE.IcosahedronGeometry(3.2, 1);
    roundGeo.translate(0, 5.6, 0);
    const place = ([x, z, k, yw]) => {
      p.set(x, 0, z);
      q.setFromAxisAngle(up, yw);
      s.setScalar(k);
    };
    const dark = [0x23471f, 0x2b5a26, 0x1e3d1b];
    add(trunkGeo, trunkMat, spots, place);
    add(pineGeo, leafMat, pines, place, () => color.setHex(dark[(rand() * dark.length) | 0]));
    add(roundGeo, leafMat, round, place, () =>
      color.setHex(this.theme.leaf[(rand() * this.theme.leaf.length) | 0]).multiplyScalar(0.85 + rand() * 0.3),
    );
  }

  // Keep the sky centered on the camera and the shadow box around the player.
  update(camera, focus) {
    this.sky.position.copy(camera.position);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);
    this.sun.target.position.copy(focus);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) for (const mat of [].concat(o.material)) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.envTarget?.dispose();
    this.scene.environment = null;
  }
}

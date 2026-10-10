// Procedural sports car built from extruded profiles. Faces +z, sits on y = 0.
import * as THREE from 'three';

const BODY_WIDTH = 1.76;
const CABIN_WIDTH = 1.42;
export const WHEEL_RADIUS = 0.36;
const WHEEL_X = 0.87;
const WHEEL_Z = 1.36;

// Side profile (z = length axis, y = height), front at +z.
const BODY_PROFILE = [
  [-2.2, 0.4], [-2.26, 0.66], [-2.18, 0.92], [-1.0, 0.99], [0.95, 0.97], [2.0, 0.8],
  [2.3, 0.6], [2.3, 0.44], [2.12, 0.34], [-2.05, 0.34],
];
const CABIN_PROFILE = [[-1.3, 0.95], [-0.55, 1.36], [0.3, 1.38], [1.15, 0.95]];

function profileShape(points) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  return s;
}

// Extrude a side profile across the car's width, centered on x.
function extrudeProfile(points, width, bevel) {
  const geo = new THREE.ExtrudeGeometry(profileShape(points), {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 4,
  });
  // Shape x -> car z, shape y -> y, extrusion z -> car x.
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

// Shared geometries (built once).
let shared = null;
function sharedGeometry() {
  if (shared) return shared;
  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.32, 24, 1);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.66, WHEEL_RADIUS * 0.66, 0.31, 20, 1);
  rim.rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.32, 0.06, WHEEL_RADIUS * 1.2);
  shared = {
    body: extrudeProfile(BODY_PROFILE, BODY_WIDTH, 0.12),
    cabin: extrudeProfile(CABIN_PROFILE, CABIN_WIDTH, 0.08),
    tire,
    rim,
    spoke,
    headlight: new THREE.BoxGeometry(0.42, 0.12, 0.08),
    taillight: new THREE.BoxGeometry(0.55, 0.1, 0.06),
    wing: new THREE.BoxGeometry(1.75, 0.06, 0.38),
    strut: new THREE.BoxGeometry(0.06, 0.26, 0.14),
    exhaust: new THREE.CylinderGeometry(0.06, 0.07, 0.2, 10),
    shadow: new THREE.PlaneGeometry(2.3, 4.8),
  };
  shared.exhaust.rotateX(Math.PI / 2);
  return shared;
}

let shadowTex = null;
function blobShadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.65)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export function createCarModel(colorHex) {
  const g = sharedGeometry();
  const root = new THREE.Group(); // positioned by physics
  const body = new THREE.Group(); // rolls / pitches with suspension
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0f16, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.18, metalness: 1 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 0.6 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a0a, emissiveIntensity: 0.6 });

  const add = (geo, mat, parent = body, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };

  add(g.body, paint);
  add(g.cabin, glass);
  for (const x of [-0.62, 0.62]) {
    const hl = add(g.headlight, head, body, false);
    hl.position.set(x, 0.66, 2.29);
    hl.rotation.y = x > 0 ? 0.25 : -0.25;
    const tl = add(g.taillight, tail, body, false);
    tl.position.set(x, 0.74, -2.27);
    const ex = add(g.exhaust, chrome, body, false);
    ex.position.set(x * 0.6, 0.32, -2.27);
  }

  // Rear wing
  const wing = add(g.wing, black);
  wing.position.set(0, 1.27, -1.9);
  for (const x of [-0.55, 0.55]) {
    const s = add(g.strut, black);
    s.position.set(x, 1.1, -1.9);
  }

  // Wheels: pivot (steering) -> spin (rolling)
  const wheels = [];
  for (const [x, z] of [[WHEEL_X, WHEEL_Z], [-WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, -WHEEL_Z]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS, z);
    root.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(g.tire, tireMat, spin);
    add(g.rim, chrome, spin, false);
    for (let k = 0; k < 5; k++) {
      const sp = add(g.spoke, chrome, spin, false);
      sp.rotation.x = (k / 5) * Math.PI;
      sp.position.x = Math.sign(x) * 0.02;
    }
    wheels.push({ pivot, spin, front: z > 0 });
  }

  // Soft blob shadow helps cars sit on the road when real shadows are off or far.
  const blob = new THREE.Mesh(
    g.shadow,
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.06;
  blob.renderOrder = 1;
  root.add(blob);

  return {
    root,
    body,
    wheels,
    paint,
    tail,
    head,
    exhausts: [new THREE.Vector3(-0.37, 0.32, -2.4), new THREE.Vector3(0.37, 0.32, -2.4)],
    setColor(hex) {
      paint.color.setHex(hex);
    },
  };
}

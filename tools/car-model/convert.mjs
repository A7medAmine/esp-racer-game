// Turns the downloaded "Porsche GT3 RS" model (Black Snow, Sketchfab, CC-BY-4.0) into the light,
// game-ready car in game/assets/cars/. The source is a 19 MB, 369k-triangle showroom model with a
// full interior, engine and suspension; six of those on track would choke the exhibit laptops.
//
// What this does:
//   - drops the engine, suspension, small cabin parts and duplicate variants (seats, dashboard and
//     steering wheel stay, heavily simplified, so the cabin isn't empty through the glass)
//   - maps the 88 source materials onto a small set of named game materials (paint, glass, ...)
//   - merges everything per material, then decimates it
//   - builds one wheel mesh (rim + tire) and one brake mesh shared by all four corners
//   - puts the car in meters, facing +z, wheels on y = 0, wheelbase centered on the origin
//   - stores wheel, exhaust and size data in the scene extras for the game to read
//
// Usage (from this folder):  npm install   then   node convert.mjs [source.glb] [output.glb]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, joinPrimitives, prune, transformPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.argv[2] ?? '../../porsche_gt3_rs.glb';
const OUT = process.argv[3] ?? '../../game/assets/cars/porsche-gt3-rs.glb';

// Parts (direct children of the source's RootNode, "TwiXeR_992_" prefix removed) that are never
// visible from the game cameras, plus the unused variants (chrome window trim, second exhaust,
// second dashboard). Seats, dashboard and steering wheel stay so the cabin isn't hollow.
const DROP_PART = new RegExp([
  'needle', 'dash_9000', 'dash_noclock', 'dash_accessories', 'doorpanel', 'gauges', 'shifter', 'pedal',
  'signalstalk', 'upperarm', 'transaxle', 'trailingarm', 'tierod', 'swaybar', 'subframe', 'steeringbox',
  'pushrod', 'muffler', 'lowerarm', 'intake', 'hub_', 'heatshield', 'halfshaft', 'fueltank', 'fuellines',
  'driveshaft', 'diff_', 'coolantlines', 'coilover', 'bumperbar', 'brakelines', '^exhaust(_TT)?$',
  '^engine$', '^exhausttip_3_chrome$', '^door_[LR]_chrome_end$',
].join('|'));

// Game materials. `paint`, `headlight` and `taillight` are replaced at runtime (per-car color,
// light intensity); the rest are shared by every car.
const MATERIALS = {
  paint: { color: [0.6, 0.03, 0.02], metal: 0.6, rough: 0.3 },
  carbon: { color: [0.55, 0.55, 0.55], metal: 0.2, rough: 0.32, texture: 'carbon' },
  black: { color: [0.025, 0.025, 0.026], metal: 0, rough: 0.6 },
  blackGloss: { color: [0.012, 0.012, 0.013], metal: 0, rough: 0.14 },
  grille: { color: [0.03, 0.03, 0.03], metal: 0.2, rough: 0.5, texture: 'grille', alpha: 'MASK', doubleSided: true },
  badge: { color: [1, 1, 1], metal: 0.6, rough: 0.3, texture: 'badge' },
  interior: { color: [0.04, 0.04, 0.042], metal: 0, rough: 0.8 },
  glass: { color: [0.015, 0.018, 0.022, 0.9], metal: 0, rough: 0.03, alpha: 'BLEND' },
  lens: { color: [0.85, 0.88, 0.92, 0.18], metal: 0, rough: 0.02, alpha: 'BLEND' },
  headlight: { color: [0.8, 0.8, 0.82], metal: 1, rough: 0.15, emissive: [0.3, 0.29, 0.26] },
  taillight: { color: [0.45, 0.01, 0.01], metal: 0, rough: 0.25, emissive: [1, 0.05, 0.02] },
  reflector: { color: [0.35, 0.01, 0.01], metal: 0, rough: 0.3 },
  metal: { color: [0.55, 0.53, 0.5], metal: 1, rough: 0.28 },
  tire: { color: [0.035, 0.035, 0.036], metal: 0, rough: 0.92 },
  rim: { color: [0.2, 0.2, 0.21], metal: 1, rough: 0.32 },
  caliper: { color: [0.8, 0.03, 0.02], metal: 0, rough: 0.35 },
  disc: { color: [0.32, 0.32, 0.33], metal: 1, rough: 0.5 },
};

// First match wins. Tested against "<part> <mesh node name> <source material name>"; the mesh node
// name keeps the original material name (Sketchfab renamed the glTF materials).
const RULES = [
  [/^(seat|steer_3|dash)|carpet|speakers|fabric|seatbelt|stitch|leather|roof_alc|plastic_textured|plastic_1\.001|plastic\.002|int_chrome/, 'interior'],
  [/^Object_4/, 'tire'],
  [/^gt3rs_style_1_chrome_wheels.*wheels_chrome/, 'rim'],
  [/^gt3rs_style_1_chrome_wheels/, 'blackGloss'],
  [/^amdb11_brakedisc.*caliper/, 'caliper'],
  [/^amdb11_brakedisc.*amdb11_brake\./, 'disc'],
  [/^amdb11_brakedisc/, 'black'],
  [/^exhausttip/, 'metal'],
  [/^headlight_[LR]_led.*(led_lights|headlight_high)/, 'headlight'],
  [/^headlightglass|^fascia_glass/, 'lens'],
  [/brakelight|taillight_running/, 'taillight'],
  [/ red\.001/, 'reflector'],
  [/ carPaint\.003$/, 'paint'],
  [/ carPaint\.008$/, 'black'],
  [/ (carbon_roof\.001|headlight_1\.001_1)$/, 'carbon'],
  [/ metal_radiator/, 'grille'],
  [/ headlight_1\.001_0$/, 'badge'],
  [/ (glass\.004|glass_int\.001)$/, 'glass'],
  [/ glass\.002$/, 'lens'],
  [/blackGlass|chrome\.003|plastic_smooth|antichrome|plastic_mgl\.00[12]|mirror/, 'blackGloss'],
  [/.*/, 'black'],
];

// Decimation per game material:
//   ratio      target share of triangles to keep
//   error      max error, as a fraction of the mesh size
//   normals    how much normal changes count (0.5 keeps curved paint smooth; wheels spin and are
//              small on screen, so they mostly care about shape)
//   permissive allow collapsing across hard edges (fine for dark or hidden parts)
// Badges and reflectors are tiny, so they stay as they are.
const SIMPLIFY = {
  paint: { ratio: 0.35, error: 0.003 },
  carbon: { ratio: 0.2, error: 0.006 },
  black: { ratio: 0.15, error: 0.008, permissive: true },
  blackGloss: { ratio: 0.25, error: 0.006 },
  interior: { ratio: 0.1, error: 0.03, normals: 0.1, permissive: true },
  grille: { ratio: 0.5, error: 0.004 },
  glass: { ratio: 0.4, error: 0.003 },
  lens: { ratio: 0.3, error: 0.004 },
  taillight: { ratio: 0.4, error: 0.004 },
  headlight: { ratio: 0.15, error: 0.008, permissive: true },
  metal: { ratio: 0.3, error: 0.006 },
  tire: { ratio: 0.1, error: 0.02, normals: 0.05 },
  rim: { ratio: 0.3, error: 0.02, normals: 0.1, permissive: true },
  caliper: { ratio: 0.25, error: 0.03, normals: 0.1, permissive: true },
  disc: { ratio: 0.4, error: 0.03, normals: 0.1 },
};

const TEXTURED = new Set(Object.keys(MATERIALS).filter((k) => MATERIALS[k].texture));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const doc = await io.read(SRC);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const rootNode = root.listNodes().find((n) => n.getName() === 'RootNode');
if (!rootNode) throw new Error('No RootNode: this script only knows the Black Snow GT3 RS layout.');

const triCount = (prim) => (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
const srcMaterials = root.listMaterials().length;
const srcTris = root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + triCount(p), 0), 0);

// Source textures we keep, found through the source materials that use them.
const srcMat = (name) => root.listMaterials().find((m) => m.getName() === name);
const textures = {
  carbon: srcMat('TwiXeR_992_carbon_roof.001')?.getBaseColorTexture(),
  grille: srcMat('TwiXeR_992_metal_radiator.002')?.getBaseColorTexture(),
  badge: srcMat('TwiXeR_992_headlight_1.001_0')?.getBaseColorTexture(),
};

const mats = {};
for (const [name, d] of Object.entries(MATERIALS)) {
  const m = doc.createMaterial(name)
    .setBaseColorFactor([...d.color.slice(0, 3), d.color[3] ?? 1])
    .setMetallicFactor(d.metal)
    .setRoughnessFactor(d.rough)
    .setAlphaMode(d.alpha ?? 'OPAQUE')
    .setDoubleSided(!!d.doubleSided);
  if (d.emissive) m.setEmissiveFactor(d.emissive);
  if (d.texture) m.setBaseColorTexture(textures[d.texture] ?? null);
  mats[name] = m;
}

// World-space copy of a primitive, with only the attributes the game material needs.
function bakePrimitive(prim, matrix, matKey) {
  const out = prim.clone().setMaterial(mats[matKey]);
  for (const sem of out.listSemantics()) {
    const keep = sem === 'POSITION' || sem === 'NORMAL' || (sem === 'TEXCOORD_0' && TEXTURED.has(matKey));
    out.setAttribute(sem, keep ? out.getAttribute(sem).clone() : null);
  }
  for (const t of out.listTargets()) out.removeTarget(t);
  if (out.getIndices()) {
    out.setIndices(out.getIndices().clone());
  } else {
    const n = out.getAttribute('POSITION').getCount();
    out.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from({ length: n }, (_, i) => i)));
  }
  transformPrimitive(out, matrix);
  return out;
}

// Gather every kept primitive in world space, tagged with its part and corner.
const pieces = [];
for (const partNode of rootNode.listChildren()) {
  const part = partNode.getName().replace(/^TwiXeR_992_/, '');
  if (DROP_PART.test(part)) continue;
  partNode.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const nodeName = node.getName().replace(/TwiXeR_992_/g, '');
    const matrix = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const key = `${part} ${nodeName} ${prim.getMaterial()?.getName().replace(/^TwiXeR_992_/, '')}`;
      const matKey = RULES.find(([re]) => re.test(key))[1];
      const kind = /^Object_4/.test(part) ? 'wheel'
        : /^gt3rs_style_1_chrome_wheels/.test(part) ? 'wheel'
          : /^amdb11_brakedisc/.test(part) ? 'brake' : 'body';
      pieces.push({ part, kind, matKey, prim: bakePrimitive(prim, matrix, matKey), partNode });
    }
  });
}

function bounds(prims) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const a = p.getAttribute('POSITION').getArray();
    for (let i = 0; i < a.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (a[i + k] < min[k]) min[k] = a[i + k];
        if (a[i + k] > max[k]) max[k] = a[i + k];
      }
    }
  }
  return { min, max, center: min.map((v, k) => (v + max[k]) / 2), size: min.map((v, k) => max[k] - v) };
}

// Corner of a wheel/brake part, from where its geometry sits.
const corners = { FL: [], FR: [], RL: [], RR: [] };
for (const p of pieces.filter((q) => q.kind !== 'body')) {
  const c = bounds([p.prim]).center;
  p.corner = (c[2] > 0 ? 'F' : 'R') + (c[0] > 0 ? 'L' : 'R'); // car left is +x when facing +z
  corners[p.corner].push(p);
}
const tireOf = (corner) => bounds(corners[corner].filter((p) => p.matKey === 'tire').map((p) => p.prim));
const tires = Object.fromEntries(Object.keys(corners).map((c) => [c, tireOf(c)]));
const wheelRadius = tires.FL.size[1] / 2;

// Ground = bottom of the tires; origin = middle of the wheelbase and track.
const offset = [
  -(tires.FL.center[0] + tires.FR.center[0]) / 2,
  -Math.min(...Object.values(tires).map((t) => t.min[1])),
  -(tires.FL.center[2] + tires.RL.center[2]) / 2,
];
const translate = (v) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
for (const p of pieces) transformPrimitive(p.prim, translate(offset));
const wheelCenter = (corner) => tires[corner].center.map((v, k) => v + offset[k]);

// Decimate in place, weighing normal changes so smooth surfaces keep smooth shading.
function simplify(prim, { ratio, error, normals: normalWeight = 0.5, permissive = false }) {
  weldPrimitive(prim);
  const indices = prim.getIndices();
  const src = new Uint32Array(indices.getArray());
  const positions = prim.getAttribute('POSITION').getArray();
  const normals = prim.getAttribute('NORMAL')?.getArray();
  const target = Math.floor((src.length / 3) * ratio) * 3;
  const flags = permissive ? ['Prune', 'Permissive'] : ['Prune'];
  const [dst] = normals
    ? MeshoptSimplifier.simplifyWithAttributes(src, positions, 3, normals, 3, [normalWeight, normalWeight, normalWeight], null, target, error, flags)
    : MeshoptSimplifier.simplify(src, positions, 3, target, error, flags);
  indices.setArray(dst);
  compactPrimitive(prim);
}

function joinByMaterial(list, name) {
  const mesh = doc.createMesh(name);
  const byMat = new Map();
  for (const p of list) {
    if (!byMat.has(p.matKey)) byMat.set(p.matKey, []);
    byMat.get(p.matKey).push(p.prim);
  }
  for (const [matKey, prims] of byMat) {
    const prim = prims.length > 1 ? joinPrimitives(prims) : prims[0];
    if (SIMPLIFY[matKey]) simplify(prim, SIMPLIFY[matKey]);
    mesh.addPrimitive(prim);
  }
  return mesh;
}

// The front-left wheel and brake become the shared meshes, centered on the wheel axis.
const fl = wheelCenter('FL');
for (const p of corners.FL) transformPrimitive(p.prim, translate(fl.map((v) => -v)));
const wheelMesh = joinByMaterial(corners.FL.filter((p) => p.kind === 'wheel'), 'wheel');
const brakeMesh = joinByMaterial(corners.FL.filter((p) => p.kind === 'brake'), 'brake');
const bodyMesh = joinByMaterial(pieces.filter((p) => p.kind === 'body'), 'body');

// Exhaust tips: one per side of the center line, at the back of the tip.
const tipPrims = pieces.filter((p) => p.part.startsWith('exhausttip')).map((p) => p.prim);
const tipBox = bounds(tipPrims);
const exhausts = [-1, 1].map((side) => [side * tipBox.size[0] / 4 + tipBox.center[0], tipBox.center[1], tipBox.min[2]]);

// New scene: car root with the body and four wheel nodes (the right side mirrors the left).
for (const child of scene.listChildren()) scene.removeChild(child);
const car = doc.createNode('GT3RS');
scene.addChild(car);
car.addChild(doc.createNode('body').setMesh(bodyMesh));
const round = (v) => Math.round(v * 1000) / 1000;
const wheels = {};
for (const corner of Object.keys(corners)) {
  const c = wheelCenter(corner).map(round);
  wheels[corner] = c;
  const mirror = corner.endsWith('R') ? [-1, 1, 1] : [1, 1, 1];
  const wheelNode = doc.createNode(`wheel_${corner}`).setTranslation(c);
  wheelNode.addChild(doc.createNode('brake').setMesh(brakeMesh).setScale(mirror));
  wheelNode.addChild(doc.createNode('spin').setMesh(wheelMesh).setScale(mirror));
  car.addChild(wheelNode);
}
const body = bounds(pieces.filter((p) => p.kind === 'body').map((p) => p.prim));
scene.setExtras({
  wheelRadius: round(wheelRadius),
  wheels,
  exhausts: exhausts.map((e) => e.map(round)),
  size: body.size.map(round),
  zRange: [round(body.min[2]), round(body.max[2])],
  credit: 'Porsche GT3 RS by Black Snow (https://sketchfab.com/BlackSnow02), CC-BY-4.0',
});

await doc.transform(prune({ keepExtras: true }));

const outTris = (mesh) => mesh.listPrimitives().reduce((s, p) => s + triCount(p), 0);
console.log(`source: ${srcTris} triangles, ${srcMaterials} materials`);
for (const mesh of [bodyMesh, wheelMesh, brakeMesh]) {
  console.log(`${mesh.getName()}: ${outTris(mesh)} triangles in ${mesh.listPrimitives().length} draw calls`);
  for (const p of mesh.listPrimitives()) console.log(`  ${p.getMaterial().getName().padEnd(11)} ${triCount(p)}`);
}
console.log(`per car on screen: ${outTris(bodyMesh) + 4 * (outTris(wheelMesh) + outTris(brakeMesh))} triangles`);
console.log('extras', JSON.stringify(scene.getExtras()));
await io.write(OUT, doc);
console.log(`wrote ${OUT}`);

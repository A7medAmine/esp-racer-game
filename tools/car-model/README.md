# Car model converter

Makes `game/assets/cars/porsche-gt3-rs.glb` from the downloaded Sketchfab model
["Porsche GT3 RS"](https://sketchfab.com/3d-models/porsche-gt3-rs-e738eae819c34d19a31dd066c45e0f3d)
by Black Snow (CC BY 4.0).

The original is a showroom model: 369k triangles, 88 materials, 19 MB, with a full engine, suspension
and interior. With up to six cars on track that is too heavy for older laptops. The converter
brings it down to about 72k triangles per car and 2 MB:

- drops the engine, suspension, pedals, gauges and duplicate variants (seats, dashboard and steering
  wheel stay, heavily simplified, so the cabin isn't empty through the glass)
- maps the 88 source materials onto 17 named game materials (`paint`, `glass`, `carbon`, `tire`, ...)
- merges each material into one draw call, then simplifies it with meshoptimizer
- uses one wheel mesh and one brake mesh for all four corners (the right side is mirrored)
- scales to meters, faces +z, puts the tires on y = 0 and centers the wheelbase on the origin
- writes wheel positions, wheel radius, exhaust tips and size into the scene extras, which
  `game/js/world/car-model.js` reads

The game itself needs no installs; this is only needed to rebuild the model.

## Running it

Needs Node.js 18 or newer.

```
cd tools/car-model
npm install
node convert.mjs                                  # reads ../../porsche_gt3_rs.glb
node convert.mjs path/to/source.glb path/to/out.glb
```

It prints the triangle count per material. Tune `SIMPLIFY` (how much each material is reduced) and
`MATERIALS` (colors and finishes) at the top of `convert.mjs`. The part names and rules are specific to
this source model; a different car needs its own `DROP_PART` and `RULES`.

The source file is not in git (19 MB). Download it from the Sketchfab link above (glTF Binary).

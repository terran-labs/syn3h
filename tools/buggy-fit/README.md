# buggy-fit

Measures how close a code-generated buggy gets to the loaded one. Developer tooling: nothing
here ships in the game.

## Reference parts

`reference.ts` reads `public/models/buggy-boxarm.glb` and `public/models/buggy.glb` with no
dependencies and returns each part the game uses, in the frame `LoadedBuggySkin` uses it:

| part | source node | frame |
| --- | --- | --- |
| body, sockets, interior, canopy | buggy-boxarm.glb Body, Sockets, Interior, Canopy | game frame: +X right, +Y up, -Z forward, metres |
| strut, shock | buggy-boxarm.glb Strut, Shock | the part's own frame (hub at origin, span along +Y) |
| stator | buggy.glb RimSimple | recentred on its bounding box centre, wheel axle along X |
| wings | buggy.glb Wings | rotY(pi) * rotX(pi/2), plus its mirror in X (rewound) |

`statorNear` (buggy.glb Rim, recentred) is also returned for reference; the game no longer draws it.

```sh
npx tsx tools/buggy-fit/reference.ts   # part names, triangle counts, materials, bounds
```

```ts
import { loadReference, toBufferGeometry } from './reference'
const ref = loadReference()          // { body: { positions, indices, materials, ... }, ... }
ref.body.materials[t]                 // material name of triangle t
const geometry = await toBufferGeometry(ref.body)   // three.js, groups by material
```

## Candidates

A candidate is a TypeScript module that default-exports

```ts
{ id: string, build(detail: 0 | 1 | 2): { part, role: string, geometry: THREE.BufferGeometry }[], numbers?: number }
```

with `part` one of the names above. Several entries may share a part (one per role); they are
merged for measurement. Import three as `three` (not `three/webgpu`) so the module runs in Node.

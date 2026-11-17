/**
 * Which cockpit glow spots a body hides: from viewpoints around the car, high and to the
 * front, side and back, is each spot's centre in clear view or behind the body.
 *
 *     npx tsx tools/buggy-fit/parts/spot-view.ts [reference|cage]
 */
import { loadReference, toBufferGeometry } from '../reference'
import { Surface, type V3 } from '../../../src/vehicles/buggygen/parts/surface'
import { buggyBody } from '../../../src/vehicles/buggygen/body'
import { buildInterior } from '../../../src/vehicles/buggygen/parts/interior'

const which = process.argv[2] ?? 'cage'
const s = Surface.from(which === 'reference' ? [await toBufferGeometry(loadReference().body)] : buggyBody.build(0).filter(p => p.part === 'body').map(p => p.geometry))
const glow = buildInterior(0).find(p => p.role === 'glow')!.geometry
const a = glow.attributes.position, idx = glow.index!.array
// Spot centres: each spot's highest point is its crown; group by distance.
const spots: V3[] = []
for (let k = 0; k < idx.length; k++) { const i = idx[k]; const p: V3 = [a.getX(i), a.getY(i), a.getZ(i)]; if (!spots.some(q => Math.hypot(q[0] - p[0], q[2] - p[2]) < .12)) spots.push(p) }
const views: [string, V3][] = [['front', [2.5, 2.2, -4]], ['side', [4.5, 2, 0]], ['rear', [2.5, 2.2, 4]], ['above', [0, 5, 0]]]
for (const [name, eye] of views) {
  const seen = spots.filter(p => { const d: V3 = [eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]], l = Math.hypot(...d); return !s.ray([p[0] + d[0] / l * .01, p[1] + d[1] / l * .01, p[2] + d[2] / l * .01], [d[0] / l, d[1] / l, d[2] / l], l) })
  console.log(which, name, `${seen.length}/${spots.length} spots in view`)
}

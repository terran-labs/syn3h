/**
 * How the tub lip and the canopy's foot sit on a body: the body's deck height (ray from above,
 * topmost hit) under each lip point and each canopy foot point, against the part's own height.
 *
 *     npx tsx tools/buggy-fit/parts/seat-check.ts [reference|cage]
 */
import { loadReference, toBufferGeometry } from '../reference'
import { Surface } from '../../../src/vehicles/buggygen/parts/surface'
import { buggyBody } from '../../../src/vehicles/buggygen/body'
import { buildInterior } from '../../../src/vehicles/buggygen/parts/interior'
import { buildCanopy } from '../../../src/vehicles/buggygen/parts/canopy'

const which = process.argv[2] ?? 'cage'
const s = Surface.from(which === 'reference' ? [await toBufferGeometry(loadReference().body)] : buggyBody.build(0).filter(p => p.part === 'body').map(p => p.geometry))
const deck = (x: number, z: number) => s.ray([x, 3, z], [0, -1, 0], 4)?.point[1]
const lip = buildInterior(0).find(p => p.role === 'chrome')!.geometry.attributes.position
const d1: number[] = []
for (let i = 0; i < lip.count; i++) { const y = lip.getY(i); if (y < .64) continue; const h = deck(lip.getX(i) * 1.02, lip.getZ(i) * 1.02); if (h !== undefined) d1.push(h - y) }
const can = buildCanopy(0)[0].geometry.attributes.position
const d2: number[] = []
let footMin = Infinity
for (let i = 0; i < can.count; i++) footMin = Math.min(footMin, can.getY(i))
for (let i = 0; i < can.count; i++) { const x = can.getX(i), y = can.getY(i), z = can.getZ(i); if (Math.abs(x) < .3 && Math.abs(z) < .7) continue; const h = deck(x * .995, z * .995); if (h !== undefined && y - h < .05) d2.push(h - y) }
const f = (d: number[]) => `body above part by mean ${(d.reduce((a, b) => a + b, 0) / d.length * 1000).toFixed(0)} mm, min ${(Math.min(...d) * 1000).toFixed(0)}, max ${(Math.max(...d) * 1000).toFixed(0)} (${d.length} points)`
console.log(which, 'tub lip:', f(d1))
console.log(which, 'canopy foot:', f(d2))

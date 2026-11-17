/**
 * Conform the sockets to a body and print what the fallback stores (swelling centres and
 * normals), the shock tops against the shipped model's, and the time the conforming adds.
 *
 *     npx tsx tools/buggy-fit/parts/swell-fallback.ts [reference|cage250]
 */
import { loadReference, toBufferGeometry } from '../reference'
import { buildSockets } from '../../../src/vehicles/buggygen/parts/sockets'
import { Surface } from '../../../src/vehicles/buggygen/parts/surface'
import cage from '../../../src/vehicles/buggygen/cage/cage250'

const which = process.argv[2] ?? 'reference'
const ref = loadReference()
const body = which === 'cage250' ? cage.build(0).map(p => p.geometry) : [await toBufferGeometry(ref.body)]
buildSockets(0, body)
let t = performance.now(); for (let i = 0; i < 5; i++) buildSockets(0); const bare = (performance.now() - t) / 5
t = performance.now(); let out; for (let i = 0; i < 5; i++) out = buildSockets(0, body); const fitted = (performance.now() - t) / 5
console.log(`build(0) without body ${bare.toFixed(1)} ms, conformed to ${which} ${fitted.toFixed(1)} ms`)
const tops = (ref.shock.extras as { tops: number[] }).tops
out!.shockTops.forEach((p, i) => console.log('shock top', i, p.map(v => v.toFixed(4)).join(' '), 'shipped', tops.slice(i * 3, i * 3 + 3).map(v => v.toFixed(4)).join(' '), 'off mm', (Math.hypot(p[0] - tops[i * 3], p[1] - tops[i * 3 + 1], p[2] - tops[i * 3 + 2]) * 1000).toFixed(1)))
// Fallback values for the right side, front then rear.
const s = Surface.from(body)
for (const [k, mount, hub] of [[0, [.55, .15, -1.2], [1.1, -.19, -1.3]], [1, [.55, .15, 1.2], [1.1, -.19, 1.3]]] as const) {
  const d = [hub[0] - mount[0], hub[1] - mount[1], hub[2] - mount[2]], l = Math.hypot(...d)
  const arm = s.ray(hub as unknown as [number, number, number], [-d[0] / l, -d[1] / l, -d[2] / l], 2)
  console.log(k ? 'rear' : 'front', 'arm centre', arm?.point.map(v => v.toFixed(3)).join(', '))
}
for (const z of [-1.2, 1.2]) {
  const mount = [.55, .15, z], hub = [1.1, -.19, z * 1.3 / 1.2]
  const span = [0, 1, 2].map(i => mount[i] - hub[i]), l = Math.hypot(...span); for (let i = 0; i < 3; i++) span[i] /= l
  let y = [-span[0] * span[1], 1 - span[1] * span[1], -span[2] * span[1]]; const ly = Math.hypot(...y); y = y.map(v => v / ly)
  const T = [0, 1, 2].map(i => hub[i] + y[i] * .35 + span[i] * .58) as [number, number, number]
  const h = s.nearest(T)!; let n = h.normal
  if ((T[0] - h.point[0]) * n[0] + (T[1] - h.point[1]) * n[1] + (T[2] - h.point[2]) * n[2] < 0) n = n.map(v => -v) as typeof n
  console.log(z < 0 ? 'front' : 'rear', 'shock centre', h.point.map(v => v.toFixed(3)).join(', '), 'normal', n.map(v => v.toFixed(3)).join(', '))
}

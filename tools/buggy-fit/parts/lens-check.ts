/**
 * How each headlight sits in a body: for points on the lens edge, bezel lip and halo, how far
 * the body's surface lies in front of them along the lens axis (positive means the body covers
 * that point as seen from in front of the lamp).
 *
 *     npx tsx tools/buggy-fit/parts/lens-check.ts [reference|cage]
 */
import { loadReference, toBufferGeometry } from '../reference'
import { Surface, type V3 } from '../../../src/vehicles/buggygen/parts/surface'
import { LAMP } from '../../../src/vehicles/buggygen/parts/sockets'
import { buggyBody } from '../../../src/vehicles/buggygen/body'

const which = process.argv[2] ?? 'cage'
const body = which === 'reference' ? [await toBufferGeometry(loadReference().body)] : buggyBody.build(0).filter(p => p.part === 'body').map(p => p.geometry)
const s = Surface.from(body)
const unit = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l] }
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
for (const side of [1, -1]) {
  const n = unit([LAMP.axis[0] * side, LAMP.axis[1], LAMP.axis[2]]), c: V3 = [LAMP.centre[0] * side, LAMP.centre[1], LAMP.centre[2]]
  const right = unit(cross(n, [0, 1, 0])), up = cross(right, n)
  const row: string[] = []
  for (const [r, h] of [[1.2, .012], [1, .018], [.72, .045]]) {
    let near = Infinity, covered = 0
    for (let k = 0; k < 24; k++) {
      const t = 2 * Math.PI * k / 24
      const p: V3 = [0, 1, 2].map(i => c[i] + right[i] * LAMP.rx * r * Math.cos(t) + up[i] * LAMP.rz * r * Math.sin(t) + n[i] * h) as V3
      const hit = s.ray(p, n, .3)
      if (hit) { covered++; near = Math.min(near, Math.hypot(hit.point[0] - p[0], hit.point[1] - p[1], hit.point[2] - p[2])) }
    }
    row.push(`ring ${r}: ${covered}/24 covered${covered ? ', body ' + (near * 1000).toFixed(0) + ' mm in front' : ''}`)
  }
  console.log(which, side > 0 ? 'right' : 'left', row.join('; '))
}
const { seatLamp } = await import('../../../src/vehicles/buggygen/parts/sockets')
for (const side of [1, -1]) { const f = seatLamp(s, side); console.log(which, 'seat', side, f ? f.centre.map(v => v.toFixed(4)).join(' ') + ' axis ' + f.axis.map(v => v.toFixed(4)).join(' ') : 'none') }

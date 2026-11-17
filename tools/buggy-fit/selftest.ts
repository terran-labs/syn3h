/**
 * Tool check for the harness, not a blocking test:
 *
 *   npx tsx tools/buggy-fit/selftest.ts
 *
 * 1. Every reference part against itself: zero distance, zero normal deviation, IoU 1.
 * 2. Every reference part moved 10 mm along +Y: the bounds centre moves exactly 10 mm, no
 *    distance exceeds 10 mm and the mean is above zero (faces parallel to Y barely move).
 * 3. A unit cube against the same cube grown 10 mm on every face: mean distance just over
 *    10 mm, more only near edges and corners (a grown corner is 10 * sqrt(3) = 17.3 mm from the
 *    small cube), normals parallel except where a sample near an edge meets the next face,
 *    volume up 6.12%.
 */
import { comparePart } from './compare'
import { PART_NAMES, loadReference, type Mesh } from './reference'

const ref = loadReference()
const moved = (m: Mesh, dx: number, dy: number, dz: number): Mesh => {
  const positions = m.positions.slice()
  for (let i = 0; i < positions.length; i += 3) { positions[i] += dx; positions[i + 1] += dy; positions[i + 2] += dz }
  return { ...m, positions }
}
let failures = 0
const check = (label: string, ok: boolean, detail: string) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail}`) }

console.log('1. Reference against itself')
for (const part of PART_NAMES) {
  const r = comparePart(part, ref[part], ref[part], 4000)
  check(part, r.distance.max === 0 && r.normalDeviation === 0 && r.iou.min === 1,
    `max ${r.distance.max} mm, normal ${r.normalDeviation} deg, IoU min ${r.iou.min}`)
}

console.log('2. Reference against a copy moved 10 mm along +Y')
for (const part of PART_NAMES) {
  const r = comparePart(part, ref[part], moved(ref[part], 0, .01, 0), 4000)
  check(part, r.bounds.centre[1] === 10 && r.distance.max <= 10.01 && r.distance.mean > 0,
    `centre delta y ${r.bounds.centre[1]} mm, mean ${r.distance.mean} mm, p95 ${r.distance.p95} mm, max ${r.distance.max} mm, IoU mean ${r.iou.mean}`)
}

console.log('3. Unit cube against the cube grown 10 mm on every face')
const cube = (h: number): Mesh => {
  const p = [-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h, -h, -h, h, h, -h, h, h, h, h, -h, h, h]
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
  return { positions: new Float32Array(p), indices: new Uint32Array(f), materials: new Array(12).fill('cube') }
}
const r = comparePart('body', cube(.5), cube(.51), 20000)
check('cube', r.distance.mean >= 10 && r.distance.mean < 10.3 && r.distance.max <= 17.33 && r.normalDeviation < 2 && Math.abs(r.volume.deltaPct - 6.12) < .01 && r.candidateTopology.closed && r.candidateTopology.consistent && r.volume.reference > 0,
  `mean ${r.distance.mean} mm, p95 ${r.distance.p95} mm, max ${r.distance.max} mm, normal ${r.normalDeviation} deg, volume ${r.volume.reference} to ${r.volume.candidate} m3 (${r.volume.deltaPct}%), IoU mean ${r.iou.mean}, closed ${r.candidateTopology.closed}, wound ${r.candidateTopology.consistent}`)

console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
process.exit(failures ? 1 : 0)

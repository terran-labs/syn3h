/**
 * The cockpit rim behind the canopy: the body's chrome near the centre line at the rear, by
 * distance back, against the canopy's foot width there. Shows whether the canopy covers it.
 *
 *     npx tsx tools/buggy-fit/parts/rim-rear.mts
 */
import { buggyBody } from '../../../src/vehicles/buggygen/body'
import { loadReference } from '../reference'
const cage = buggyBody.build(0).filter(p => p.part === 'body' && p.role === 'chrome')
const pts: number[][] = []
for (const p of cage) { const a = p.geometry.attributes.position; for (let i = 0; i < a.count; i++) if (a.getZ(i) > .6 && a.getY(i) > .7) pts.push([a.getX(i), a.getY(i), a.getZ(i)]) }
const ref = loadReference().body, P = ref.positions, rp: number[][] = []
for (let t = 0; t < ref.indices.length / 3; t++) if (/chrome/i.test(ref.materials[t])) for (let k = 0; k < 3; k++) { const i = ref.indices[t * 3 + k] * 3; if (P[i + 2] > .6 && P[i + 1] > .7) rp.push([P[i], P[i + 1], P[i + 2]]) }
for (const [name, ps] of [['cage', pts], ['reference', rp]] as const) {
  const rows: string[] = []
  for (let z = .7; z <= 1.05; z += .05) { const band = ps.filter(p => Math.abs(p[2] - z) < .025); if (band.length) rows.push(`z ${z.toFixed(2)}: |x| ${Math.min(...band.map(p => Math.abs(p[0]))).toFixed(3)}..${Math.max(...band.map(p => Math.abs(p[0]))).toFixed(3)} y ${Math.min(...band.map(p => p[1])).toFixed(3)}..${Math.max(...band.map(p => p[1])).toFixed(3)}`) }
  console.log(name, 'rear chrome:', rows.join('; '))
}

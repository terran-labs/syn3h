import { Surface } from '../../../src/vehicles/buggygen/parts/surface'
import { buggyBody } from '../../../src/vehicles/buggygen/body'
import { CANOPY_STATIONS } from '../../../src/vehicles/buggygen/parts/canopy'
import { loadReference, toBufferGeometry } from '../reference'
for (const which of ['reference', 'cage']) {
  const s = Surface.from(which === 'cage' ? buggyBody.build(0).filter(p => p.part === 'body').map(p => p.geometry) : [await toBufferGeometry(loadReference().body)])
  const out: string[] = []
  for (const [z, w, base] of CANOPY_STATIONS) {
    const hits = [0, .5, .9, .99].map(f => { const h = s.ray([w * f, 3, z], [0, -1, 0], 4); return h ? ((base - h.point[1]) * 1000).toFixed(0) : '-' })
    out.push(`z ${z}: ${hits.join('/')}`)
  }
  console.log(which, 'foot minus deck (mm) at x = 0, .5w, .9w, .99w:', out.join('; '))
}
// After seating: the generated canopy's lowest points per station against the cage deck.
const { buildCanopy } = await import('../../../src/vehicles/buggygen/parts/canopy')
const cage = Surface.from(buggyBody.build(0).filter(p => p.part === 'body').map(p => p.geometry))
const g = buildCanopy(0, cage)[0].geometry.attributes.position
// The foot of each ring: its lowest points (both ends of the dome), and the two tips.
const byZ = new Map<string, number[]>()
for (let i = 0; i < g.count; i++) { const k = g.getZ(i).toFixed(4); if (!byZ.has(k)) byZ.set(k, []); byZ.get(k)!.push(i) }
let worst = -Infinity, at = ''
for (const [k, ids] of byZ) {
  const low = Math.min(...ids.map(i => g.getY(i)))
  for (const i of ids) if (g.getY(i) < low + 1e-4) {
    const h = cage.ray([g.getX(i) * .97, g.getY(i) + .4, g.getZ(i)], [0, -1, 0], .6)
    if (h && g.getY(i) - h.point[1] > worst) { worst = g.getY(i) - h.point[1]; at = k }
  }
}
console.log('seated on cage: highest foot point above the deck', (worst * 1000).toFixed(1), 'mm at z', at)

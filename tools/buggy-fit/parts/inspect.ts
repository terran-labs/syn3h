/** Print a reference part's vertices grouped by material, for reading its construction. */
import { loadReference } from '../reference'
const [part, digits = '3'] = process.argv.slice(2)
const r = loadReference()[part as 'stator']
const by: Record<string, Set<number>> = {}
for (let t = 0; t < r.indices.length / 3; t++) for (let k = 0; k < 3; k++) (by[r.materials[t]] ??= new Set()).add(r.indices[t * 3 + k])
for (const [m, vs] of Object.entries(by)) {
  console.log(`== ${m}: ${vs.size} verts`)
  const rows = [...vs].map(i => [r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]])
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  const uniq = new Set(rows.map(v => v.map(x => (+x).toFixed(+digits)).join(' ')))
  console.log([...uniq].join('\n'))
}

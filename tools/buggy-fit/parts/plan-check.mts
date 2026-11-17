import { loadReference } from '../reference'
import { buildCanopy } from '../../../src/vehicles/buggygen/parts/canopy'
const slice = (P: ArrayLike<number>, I: ArrayLike<number>, z: number) => { let w = 0, top = -9; for (let t = 0; t < I.length / 3; t++) for (let a = 0; a < 3; a++) { const i = I[t*3+a]*3, j = I[t*3+(a+1)%3]*3; if ((P[i+2]-z)*(P[j+2]-z) <= 0 && P[i+2] !== P[j+2]) { const f = (z-P[i+2])/(P[j+2]-P[i+2]); w = Math.max(w, Math.abs(P[i]+(P[j]-P[i])*f)); top = Math.max(top, P[i+1]+(P[j+1]-P[i+1])*f) } } return [w, top] }
const r = loadReference().canopy, g = buildCanopy(0)[0].geometry
const rows: string[] = []
for (const z of [-.83, -.82, -.81, -.8, -.78, -.76, -.74, -.7, -.66, -.6, .6, .66, .7, .74, .78, .8, .82, .84, .86, .88, .89, .895]) { const a = slice(r.positions, r.indices, z), b = slice(g.attributes.position.array, g.index!.array, z); rows.push(`${z}: ref ${a[0].toFixed(3)}/${a[1].toFixed(3)} gen ${b[0].toFixed(3)}/${b[1].toFixed(3)}`) }
console.log(rows.join('\n'))

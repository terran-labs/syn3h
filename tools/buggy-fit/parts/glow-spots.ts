/**
 * List the glowing lenses of a cockpit tub: connected islands of Glow faces, with each one's
 * centre, size and face count.
 *
 *     npx tsx tools/buggy-fit/parts/glow-spots.ts
 */
import { loadReference } from '../reference'
const r = loadReference().interior, P = r.positions
const key = (i: number) => `${P[i * 3].toFixed(4)},${P[i * 3 + 1].toFixed(4)},${P[i * 3 + 2].toFixed(4)}`
const tris = [...Array(r.indices.length / 3).keys()].filter(t => /glow/i.test(r.materials[t]))
const parent = new Map<string, string>()
const find = (a: string): string => { while (parent.get(a) !== a) a = parent.get(a)!; return a }
for (const t of tris) { const ks = [0, 1, 2].map(k => key(r.indices[t * 3 + k])); for (const k of ks) if (!parent.has(k)) parent.set(k, k); for (const k of ks.slice(1)) parent.set(find(k), find(ks[0])) }
const groups = new Map<string, number[]>()
for (const t of tris) { const g = find(key(r.indices[t * 3])); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(t) }
for (const ts of groups.values()) {
  const vs = ts.flatMap(t => [0, 1, 2].map(k => r.indices[t * 3 + k]))
  const c = [0, 1, 2].map(a => vs.reduce((s, i) => s + P[i * 3 + a], 0) / vs.length)
  const size = Math.max(...vs.map(i => Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2])))
  const ang = Math.atan2(c[2] - .02, c[0]) * 180 / Math.PI
  console.log(`spot ${ts.length} faces at ${c.map(v => v.toFixed(3)).join(' ')} radius ${size.toFixed(3)} angle ${ang.toFixed(0)}`)
}
console.log('islands', groups.size)

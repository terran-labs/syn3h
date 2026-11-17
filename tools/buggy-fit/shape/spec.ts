/**
 * Writes lab-sheet.mjs specs for the shape rig's review sheets.
 *
 *   npx tsx tools/buggy-fit/shape/spec.ts <baseline|final> <out.json>
 *
 * baseline: the body alone at defaults, each handle's ends and six seeds. final: the whole
 * buggy at the fitted shape and each preset, plus close shots of a headlight, an intake and
 * the tail lamps.
 */
import { writeFileSync } from 'node:fs'
import { HANDLES, rig, type Shape } from '../../../src/vehicles/buggygen/shape'
import { PRESETS } from './presets'

const [kind, out] = process.argv.slice(2)
const nonDefault = (s: Record<string, number>) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== 0))
const views = [{ name: 'front34', orbit: [-35, 16, 5.6] }, { name: 'side', orbit: [-90, 3, 5.8] }, { name: 'rear34', orbit: [145, 18, 5.6] }]
/** Close shots, aimed at each feature's place on the fitted body (right side). */
const close = [
  { name: 'close-headlight', feature: 'headlight', look: [[1.5, .75, -3.0], [.55, .35, -1.6]] },
  { name: 'close-scoop', feature: 'scoop', look: [[2.3, .6, -.9], [.8, .3, -.15]] },
  { name: 'close-tail', feature: 'tailLamps', look: [[1.3, 1.1, 3.4], [.45, .5, 1.85]] },
] as const
/** The exhibit stands the buggy on the floor: it lifts it by -groundY (0.72 m). */
const LIFT = .72
/** Close shots moved with their feature, so the feature stays in frame however far it moved. */
const follow = (s: Shape) => Object.fromEntries(close.map(v => {
  const m = rig(s).motion[v.feature], d = m.to.map((t, k) => t - m.from[k] + (k === 1 ? LIFT : 0))
  return [v.name, v.look.map(p => p.map((x, k) => x + d[k]))]
}))
const spec = kind === 'baseline'
  ? { query: 'vehicle=buggy-shape&body=1', views: [...views, ...close.map(v => ({ ...v, look: v.look.map(p => [p[0], p[1] + LIFT, p[2]]) }))], columns: 6, size: [420, 260], states: [{ name: 'default', shape: {} }, ...HANDLES.flatMap(h => [{ name: `${h.id} ${h.min}`, shape: { [h.id]: h.min } }, { name: `${h.id} ${h.max}`, shape: { [h.id]: h.max } }]), ...[1, 7, 42, 99, 123, 500].map(seed => ({ name: `seed ${seed}`, seed }))] }
  : { query: 'vehicle=buggy-shape', views: [...views, ...close], columns: 3, size: [640, 400], states: Object.entries(PRESETS).map(([name, s]) => ({ name, shape: nonDefault(s), look: follow(s) })) }
writeFileSync(out, JSON.stringify(spec, null, 1))

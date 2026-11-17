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
import { HANDLES, defaultShape } from '../../../src/vehicles/buggygen/shape'
import { PRESETS } from './presets'

const [kind, out] = process.argv.slice(2)
const nonDefault = (s: Record<string, number>) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== 0))
const views = [{ name: 'front34', orbit: [-35, 16, 5.6] }, { name: 'side', orbit: [-90, 3, 5.8] }, { name: 'rear34', orbit: [145, 18, 5.6] }]
/** Close shots, aimed at each feature's place on the fitted body (right side). */
const close = [
  { name: 'close-headlight', look: [[1.5, .75, -3.0], [.55, .35, -1.6]] },
  { name: 'close-scoop', look: [[2.3, .6, -.9], [.8, .3, -.15]] },
  { name: 'close-tail', look: [[1.3, 1.1, 3.4], [.45, .5, 1.85]] },
]
const spec = kind === 'baseline'
  ? { query: 'vehicle=buggy-shape&body=1', views: [...views, ...close], columns: 6, size: [420, 260], states: [{ name: 'default', shape: {} }, ...HANDLES.flatMap(h => [{ name: `${h.id} ${h.min}`, shape: { [h.id]: h.min } }, { name: `${h.id} ${h.max}`, shape: { [h.id]: h.max } }]), ...[1, 7, 42, 99, 123, 500].map(seed => ({ name: `seed ${seed}`, seed }))] }
  : { query: 'vehicle=buggy-shape', views, columns: 3, size: [640, 400], states: Object.entries(PRESETS).map(([name, s]) => ({ name, shape: nonDefault(s) })) }
void defaultShape
writeFileSync(out, JSON.stringify(spec, null, 1))

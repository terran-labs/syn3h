/** Software-rendered sheets of the preset bodies (no browser needed): /tmp/buggy-fit/shape/sw-<name>.png */
import { sheet, MAT_RGB, VIEWS } from '../sections/render'
import { soupOf } from '../sections/measure'
import { shapedBody } from '../../../src/vehicles/buggygen/shape'
import { PRESETS } from './presets'
const all = Object.entries(PRESETS).map(([, s]) => { const x = soupOf(shapedBody(s, 0)); return { tri: x.tri, rgb: (t: number) => MAT_RGB[x.role[t]] ?? [255, 0, 255] } })
sheet('/tmp/buggy-fit/shape/sw-all.png', all, [VIEWS[0], VIEWS[1], VIEWS[4]], 260)
console.log(Object.keys(PRESETS).join(', '))

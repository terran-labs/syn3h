/** Software views of the fitted design and the editor presets: /tmp/buggy-fit/sections/presets.png. Offline only. */
import { sheet, MAT_RGB, VIEWS } from './render'
import { soupOf } from './measure'
import { buildLoft } from '../../../src/vehicles/buggygen/sections/design'
import { PRESETS, applyHandles, clampHandles, defaultHandles } from '../../../src/vehicles/buggygen/sections/editor'
const designs = [defaultHandles(), ...Object.values(PRESETS).map(p => clampHandles(p.handles))]
sheet('/tmp/buggy-fit/sections/presets.png', designs.map(h => { const s = soupOf(buildLoft(applyHandles(h), 0)); return { tri: s.tri, rgb: (t: number) => MAT_RGB[s.role[t]] ?? [255, 0, 255] } }), [VIEWS[0], VIEWS[4], VIEWS[5]], 300)
console.log('rows: fitted,', Object.keys(PRESETS).join(', '))

/** Close software views of the loft body: top and both quarters at 700 px. Offline only. */
import { sheet, MAT_RGB, VIEWS } from './render'
import { soupOf } from './measure'
import levelC from '../../../src/vehicles/buggygen/sections/levelC'
const s = soupOf(levelC.build(0))
sheet('/tmp/buggy-fit/sections/zoom.png', [{ tri: s.tri, rgb: t => MAT_RGB[s.role[t]] }], [VIEWS[1], VIEWS[4], VIEWS[5]], 700)

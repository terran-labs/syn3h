/** All handles at 0 must build exactly the fitted Level C body. Offline check. */
import levelC from '../../../src/vehicles/buggygen/sections/levelC'
import { buildLoft } from '../../../src/vehicles/buggygen/sections/design'
import { applyHandles, defaultHandles } from '../../../src/vehicles/buggygen/sections/editor'
const a = levelC.build(0), b = buildLoft(applyHandles(defaultHandles()), 0)
let diff = 0, n = 0
for (const p of a) {
  const other = b.find(q => q.role === p.role)!, x = p.geometry.getAttribute('position').array, y = other.geometry.getAttribute('position').array
  if (x.length !== y.length) console.log(`${p.role}: ${x.length / 3} against ${y.length / 3} vertices`)
  n += x.length; for (let k = 0; k < Math.min(x.length, y.length); k++) diff = Math.max(diff, Math.abs(x[k] - y[k]))
}
console.log(`editor at zero vs Level C: ${a.length} pieces, ${n / 3} vertices, max difference ${(diff * 1000).toFixed(4)} mm`)

/**
 * Zorb bounce and hop, measured: the numbers for the handling report, not a test.
 *   npx tsx tools/zorb-bounce-report.ts
 * Heights are of the ball's base above the ground. Rebounds are fractions of the drop height.
 */
import * as THREE from 'three/webgpu'
import { params } from '../shared/params'
import { initPhysics } from '../src/core/physics'
import { bounces, hop, place, ride } from '../tests/vehicles2/zorbBounceProbe'

await initPhysics()
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a')
const rows: string[][] = [['case', 'result']]
const row = (name: string, value: string) => rows.push([name, value])
const show = (p: number[], h: number) => p.slice(0, 4).map((x) => f(x / h)).join(', ')
// BOUNCE=1.75 npx tsx tools/zorb-bounce-report.ts: the same table at another bounciness.
if (process.env.BOUNCE) params.set('zorb.bounce', Number(process.env.BOUNCE))

console.log(`zorb.bounce ${params.get('zorb.bounce')!.value}, zorb.hopHeight ${params.get('zorb.hopHeight')!.value}`)
for (const h of [5, 20]) {
  const r = ride('flat'); place(r, h)
  const b = bounces(r, 30)
  row(`drop ${h} m, flat: rebounds (fraction of drop)`, `${show(b.peaks, h)}; bounces over 0.1 m: ${b.peaks.length}; settled after ${f(b.settled)} s`)
  r.done()
}
{
  const r = ride('ledge', 'buggy', new THREE.Vector3(-20, 0, 0))
  place(r, 0, { x: 12, y: 0, z: 0 }, -20, 0, 10)
  const b = bounces(r, 20)
  row('off a 10 m ledge at 12 m/s: rebounds (fraction of 10 m)', `${show(b.peaks, 10)}; bounces: ${b.peaks.length}`)
  r.done()
}
{
  const r = ride('slope'); const b = bounces(r, 20)
  row('20 degree slope from rest: highest bounce (m)', `${f(Math.max(0, ...b.peaks))}; finite ${b.finite}`)
  r.done()
}
for (const speed of [0, 15, 30]) {
  const r = ride('flat')
  if (speed) { r.v.body.setLinvel({ x: speed, y: 0, z: 0 }, true); r.step(5) }
  const h = hop(r)
  row(`hop at ${speed} m/s: vehicle rise; ball apex; then bounces (m)`, `${f(h.vehicle)}; ${f(h.apex)}; ${h.peaks.slice(1, 3).map(f).join(', ')}`)
  r.done()
}
{
  const r = ride('slope'); r.step(10)
  const h = hop(r)
  row('hop on the 20 degree slope: apex (m)', f(h.apex))
  r.done()
}
{
  const r = ride('flat', 'buggy', new THREE.Vector3(0, 2, 0), 1.62)
  const h = hop(r, 12)
  row('hop on the Moon (1.62 m/s²): vehicle rise; ball apex (m)', `${f(h.vehicle)}; ${f(h.apex)}`)
  r.done()
}
{
  // Hop at every cooldown for 10 s.
  const r = ride('flat'); let top = 0, first = 0
  for (let i = 0; i < 20; i++) { const h = hop(r, .5); if (i === 0) first = h.apex; top = Math.max(top, h.apex) }
  row('hop at every cooldown for 10 s: highest apex / first', `${f(top)} / ${f(first)}`)
  r.done()
}
for (const liquid of ['water', 'lava'] as const) {
  // Skimming in at 30 m/s from just above the surface: how high it goes and how far it skips.
  const r = ride(liquid, 'buggy', new THREE.Vector3(0, 0, 0))
  place(r, 1, { x: 30, y: -3, z: 0 }, 0, 0, 0)
  let top = 0, finite = true
  const x0 = r.v.body.translation().x
  for (let i = 0; i < 500; i++) { r.step(); const c = r.v.zorb.centre(new THREE.Vector3()); top = Math.max(top, c.y - r.v.zorb.radius); if (!Number.isFinite(c.y)) { finite = false; break } }
  row(`30 m/s entry on ${liquid}: highest base above the surface (m); distance in 10 s (m)`, `${f(top)}; ${f(r.v.body.translation().x - x0)}; finite ${finite}`)
  r.done()
}
{
  // Two zorbs head on at 15 m/s each, and one into a parked buggy at 15 m/s.
  const a = ride('flat', 'buggy', new THREE.Vector3(-20, 2, 0))
  // A second vehicle in the same world: build it from the first ride's world.
  const w = (a.v as unknown as { game: import('../src/core/Game').Game; terrain: import('../src/world/Terrain').Terrain })
  const { createVehicle } = await import('../src/vehicles')
  const { FIXED_DT } = await import('../src/core/physics')
  for (const parked of [false, true]) {
    const b = createVehicle(w.game, w.terrain, 'buggy', new THREE.Vector3(20, 2, 0)); b.isLocal = false
    if (!parked) b.input.zorb = true
    for (let i = 0; i < 400; i++) { for (const v of [a.v, b]) v.fixedUpdate(FIXED_DT); w.game.world.step(); for (const v of [a.v, b]) v.postPhysics(FIXED_DT) }
    place(a, 0, { x: 15, y: 0, z: 0 }, parked ? 5 : -20)
    if (!parked) { const t = b.body.translation(); b.body.setTranslation({ x: 20, y: t.y, z: 0 }, true); b.body.setLinvel({ x: -15, y: 0, z: 0 }, true) }
    let top = 0, speed = 0
    for (let i = 0; i < 300; i++) {
      for (const v of [a.v, b]) v.fixedUpdate(FIXED_DT); w.game.world.step(); for (const v of [a.v, b]) v.postPhysics(FIXED_DT)
      top = Math.max(top, a.height()); const l = a.v.body.linvel(); speed = Math.max(speed, Math.hypot(l.x, l.y, l.z))
    }
    row(parked ? 'zorb at 15 m/s into a parked buggy: highest (m); top speed after (m/s)' : 'two zorbs head on at 15 m/s: highest (m); top speed after (m/s)', `${f(top)}; ${f(speed)}`)
    b.dispose()
    a.v.input.zorb = true
  }
  a.done()
}
for (const h of [10]) {
  // Brake held through the landing, then released for the next one.
  const r = ride('flat'); r.v.input.brakes = true; r.step(20); place(r, h)
  const held = bounces(r, 6).peaks[0] ?? 0
  r.v.input.brakes = false; r.step(30); place(r, h)
  const free = bounces(r, 6).peaks[0] ?? 0
  row(`drop ${h} m with brake held / released: first rebound (fraction)`, `${f(held / h)} / ${f(free / h)}`)
  r.done()
}
const width = Math.max(...rows.map((r) => r[0].length))
for (const [a, b] of rows) console.log(`${a.padEnd(width)}  ${b}`)

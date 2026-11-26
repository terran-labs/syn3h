/**
 * Jet flight invariants (phys/jet-flight). Numbers the owner tunes by feel (top speed, rates)
 * are in the handling report, not here; these only say what must never happen. Each test
 * names the bug it catches.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { FIXED_DT, initPhysics } from '../../src/core/physics'
import { Jet, jetControlResponse, jetDescentRate } from '../../src/vehicles/Jet'
import { harness } from './harness'

beforeAll(initPhysics)

/** A local jet flown by held keys, as Input.poll and the jet's own key reading see them. */
function pilot(start: { y: number; vz?: number; flight: boolean }) {
  const h = harness(9.81, false)
  const keys = new Set<string>()
  const st = (h.game.input as unknown as { state: { special: boolean; x: number; y: number; z: number; w: number; brakes: boolean } }).state
  ;(h.game.input as unknown as { held: (c: string) => boolean }).held = (c: string) => keys.has(c)
  const v = new Jet(h.game, h.terrain, new THREE.Vector3(0, start.y, 0))
  v.isLocal = true
  st.special = start.flight
  if (start.vz) v.body.setLinvel({ x: 0, y: 0, z: -start.vz }, true)
  const axes = () => {
    const k = (c: string) => (keys.has(c) ? 1 : 0)
    st.x = k('KeyD') - k('KeyA'); st.y = k('KeyW') - k('KeyS'); st.z = k('KeyR') - k('KeyF'); st.w = k('KeyE') - k('KeyQ')
    st.brakes = keys.has('ShiftLeft')
  }
  return {
    v, keys, st,
    step(n: number, each?: () => void) { for (let i = 0; i < n; i++) { axes(); h.step(v); each?.() } },
    done() { v.dispose(); h.world.free() },
  }
}
/** Angle between the nose and the velocity, degrees (0 when nearly still). */
function tail(v: Jet): number {
  const vel = new THREE.Vector3().copy(v.body.linvel())
  if (vel.length() < 5) return 0
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().copy(v.body.rotation()))
  return vel.angleTo(nose) * 180 / Math.PI
}
const finite = (v: Jet) => [...v.getState().p, ...v.getState().q, ...v.getState().v, ...Object.values(v.body.angvel())].every(Number.isFinite)
const seconds = (s: number) => Math.round(s / FIXED_DT)

const KEYS = ['KeyE', 'KeyQ', 'KeyR', 'KeyF', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft']
const COMBOS = [...KEYS.map((k) => [k]), ...KEYS.flatMap((a, i) => KEYS.slice(i + 1).map((b) => [a, b]))]

// At the default control response and at the original's full authority (1), which the owner
// may set from the registry.
describe.each([['default', undefined], ['the original authority 1', 1]] as const)('jet flight invariants, control response %s', (_name, response) => {
  let saved = 0
  beforeAll(() => { saved = jetControlResponse.value; if (response !== undefined) jetControlResponse.value = response })
  afterAll(() => { jetControlResponse.value = saved })

  // Bug: a held key or pair (the owner's "hold E, it flips around and flies backwards") leaves
  // the jet flying tail-first, or a value goes non-finite. Flight mode is checked for
  // tail-first; in hover, moving backwards on S is the craft doing as it is told.
  it('no single key or pair held for 20 s leaves a flying jet tail-first, and nothing goes non-finite', () => {
    const bad: string[] = []
    for (const flight of [true, false]) for (const combo of COMBOS) {
      const p = pilot({ y: 600, vz: flight ? 60 : 0, flight })
      for (const k of combo) p.keys.add(k)
      let tailSteps = 0, worst = 0
      p.step(seconds(20), () => {
        if (flight && !p.v.hoverMode) { const a = tail(p.v); tailSteps = a > 120 ? tailSteps + 1 : 0; worst = Math.max(worst, tailSteps) }
      })
      if (!finite(p.v)) bad.push(`${flight ? 'flight' : 'hover'} ${combo.join('+')}: non-finite`)
      if (flight && (tail(p.v) > 120 || worst * FIXED_DT > 2)) bad.push(`flight ${combo.join('+')}: tail-first (${Math.round(tail(p.v))} deg, ${(worst * FIXED_DT).toFixed(1)} s)`)
      p.done()
    }
    expect(bad).toEqual([])
  })

  // Bug: Q in flight was full reverse thrust; the jet stopped, slewed round and flew backwards.
  it('Q in flight is idle, never reverse thrust', () => {
    const p = pilot({ y: 600, vz: 60, flight: true })
    p.keys.add('KeyQ')
    let leastForward = Infinity
    p.step(seconds(15), () => {
      const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().copy(p.v.body.rotation()))
      leastForward = Math.min(leastForward, new THREE.Vector3().copy(p.v.body.linvel()).dot(nose))
    })
    expect(leastForward).toBeGreaterThan(-2)
    // The HUD's thrust readout says what the jet does: idle, not -100%.
    expect(p.v.thrustReadout).toBe(0)
    p.done()
  })

  // Bug: Q in hover pushed down at twice the jet's weight, a driven dive.
  it('Q in hover is a controlled descent, no faster than the descent rate', () => {
    const p = pilot({ y: 600, flight: false })
    p.step(seconds(1))
    p.keys.add('KeyQ')
    let fastest = 0
    p.step(seconds(8), () => { fastest = Math.min(fastest, p.v.body.linvel().y) })
    expect(fastest).toBeGreaterThan(-(jetDescentRate.value + 1.5))
    expect(fastest).toBeLessThan(-1) // it does come down
    p.done()
  })

  // Bug: climbing in hover, switching to flight and pitching left the jet stalled and tumbling.
  it('the hover-to-flight handover while climbing is safe: no tumble, no tail-first flight', () => {
    for (const arrow of ['KeyW', 'KeyS']) {
      const p = pilot({ y: 300, flight: false })
      p.keys.add('KeyE')
      p.step(seconds(4))
      p.st.special = true
      p.keys.add(arrow)
      let fastestTurn = 0, tailSteps = 0, worst = 0
      p.step(seconds(10), () => {
        const w = p.v.body.angvel(); fastestTurn = Math.max(fastestTurn, Math.hypot(w.x, w.y, w.z))
        tailSteps = tail(p.v) > 120 ? tailSteps + 1 : 0; worst = Math.max(worst, tailSteps)
      })
      expect(worst * FIXED_DT, arrow).toBeLessThan(1)
      expect(finite(p.v)).toBe(true)
      expect(fastestTurn, arrow).toBeLessThan(3)
      p.done()
    }
  })
})

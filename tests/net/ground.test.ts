/**
 * Remote vehicles stay out of the hills. A remote is placed from its snapshots; between two
 * of them, or past the newest, the placed point can be under the ground the real vehicle
 * drove over. RemotePlayer lifts it to the ground plus the vehicle's own learned ride height.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import type { WireState } from '../../shared/protocol'
import { RemotePlayer } from '../../src/net/RemotePlayer'
import { emptyInputLike } from './helpers'

beforeAll(async () => {
  await RAPIER.init()
})

const info = { id: 2, name: 'Remote', slot: 1, score: 0, kind: 'buggy' as const, colors: ['#ffffff', '#000000'] as [string, string] }
/** A ridge along z: 20 m high at x = 0, falling 1 m per metre either side, flat beyond. */
const ridge = (x: number) => Math.max(0, 20 - Math.abs(x))
/** A slope that starts at x = 0 and rises 1 m per metre. */
const slope = (x: number) => Math.max(0, x)

function remote(ground: ((x: number, z: number) => number) | null, dynamic = false) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  const body = world.createRigidBody(dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased())
  const vehicle = { body, input: emptyInputLike(), isLocal: true, id: '', name: '', shiftBy() {} }
  const r = new RemotePlayer(info, vehicle as never)
  r.groundAt = ground
  return { r, body, world }
}
const at = (t: number, x: number, y: number, v: [number, number, number] = [0, 0, 0]): WireState => ({ id: 2, t, p: [x, y, 0], q: [0, 0, 0, 1], v, w: [0, 0, 0], input: emptyInputLike() })
const far = { x: 1000, y: 0, z: 0 }
const step = (o: ReturnType<typeof remote>, t: number, local = far) => {
  o.r.steer(t, 1, local, 40, 0.1)
  o.world.step()
  return o.body.translation()
}

describe('RemotePlayer and the ground', () => {
  it('learns the ride height from the sender, lowest seen, within bounds', () => {
    const o = remote(ridge)
    expect(o.r.clearance).toBe(1.5)
    o.r.push(at(1.0, -30, 0.69), 1.0, 20)
    expect(o.r.clearance).toBeCloseTo(0.69)
    // Airborne teaches nothing lower; a hard landing does.
    o.r.push(at(1.1, -29, 6), 1.1, 20)
    expect(o.r.clearance).toBeCloseTo(0.69)
    o.r.push(at(1.2, -28, 0.4), 1.2, 20)
    expect(o.r.clearance).toBeCloseTo(0.4)
    // A state under the ground is not believed, and the floor is 0.1 m.
    o.r.push(at(1.3, -27, -3), 1.3, 20)
    o.r.push(at(1.4, -26, 0.01), 1.4, 20)
    expect(o.r.clearance).toBeCloseTo(0.1)
  })

  it('lifts a copy that the straight line between two states would put inside a ridge', () => {
    const o = remote(ridge)
    // A fast buggy: one state on the near foot of the ridge, the next over the crest and
    // down the far side. Half way between them is the crest: 20 m up, not 0.7.
    o.r.push(at(1.0, -20, 0.7), 1.0, 20)
    o.r.push(at(1.1, 20, 0.7), 1.1, 20)
    const mid = step(o, 1.05)
    expect(mid.x).toBeCloseTo(0)
    expect(mid.y).toBeCloseTo(20.7)
    // A quarter of the way: on the slope, at the ride height above it.
    expect(step(o, 1.025).y).toBeCloseTo(ridge(-10) + 0.7)
    // At the states themselves it is exactly where the sender said.
    expect(step(o, 1.1).y).toBeCloseTo(0.7)
  })

  it('follows the ground when carrying on past the newest state runs into a slope', () => {
    const o = remote(slope)
    o.r.push(at(1.0, -4, 0.7, [40, 0, 0]), 1.0, 20)
    o.r.push(at(1.1, 0, 0.7, [40, 0, 0]), 1.1, 20)
    // 0.25 s past the newest state at 40 m/s: 10 m up the slope, where the line says y = 0.7.
    const p = step(o, 1.35)
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(10.7)
  })

  it('leaves anything above the ground alone: a jet, a jump', () => {
    const o = remote(ridge)
    o.r.push(at(1.0, -20, 60), 1.0, 20)
    o.r.push(at(1.1, 20, 64), 1.1, 20)
    expect(step(o, 1.05).y).toBeCloseTo(62)
    // It has never been near the ground, so its clearance is still the cap, not a guess.
    expect(o.r.clearance).toBe(1.5)
  })

  it('aims a physical copy at the lifted point, so it is not blended into the hill', () => {
    const o = remote(ridge, true)
    o.body.setTranslation({ x: 0, y: 20.7, z: 0 }, true)
    o.r.push(at(1.0, -20, 0.7), 1.0, 20)
    o.r.push(at(1.1, 20, 0.7), 1.1, 20)
    // We are beside it on the crest: it is physical. Its target is the crest, where it is.
    const local = { x: 3, y: 20.7, z: 0 }
    o.r.steer(1.05, 1, local, 40, 0.1)
    expect(o.r.physical).toBe(true)
    expect(o.body.translation().y).toBeCloseTo(20.7)
  })

  it('changes nothing when it has no terrain to ask', () => {
    const o = remote(null)
    o.r.push(at(1.0, -20, -5), 1.0, 20)
    o.r.push(at(1.1, 20, -5), 1.1, 20)
    expect(step(o, 1.05).y).toBeCloseTo(-5)
  })
})

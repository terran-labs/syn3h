import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { BOT_ID_BASE, MAX_BOTS } from '../../shared/protocol'
import { audibleVehicles, bodyAlive, hillHold, liveBots } from '../../src/net/bots'

beforeAll(async () => {
  await RAPIER.init()
})

const vehicle = (world: RAPIER.World) => ({ body: world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()) })

describe('bot replication safety', () => {
  it('notices a bot body the manager removed, without touching it', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    const bots = [vehicle(world), vehicle(world), vehicle(world)]
    world.removeRigidBody(bots[1].body)
    expect(bodyAlive(world, bots[0])).toBe(true)
    expect(bodyAlive(world, bots[1])).toBe(false)
    expect(liveBots(bots, world).map(([id]) => id)).toEqual([BOT_ID_BASE, BOT_ID_BASE + 2])
  })

  it('does not mistake a new body that reused a removed handle for the old one', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    const old = vehicle(world)
    world.removeRigidBody(old.body)
    const fresh = vehicle(world)
    world.step()
    expect(bodyAlive(world, fresh)).toBe(true)
    expect(bodyAlive(world, old)).toBe(false)
  })

  it('never sends more than the wire allows', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    const many = Array.from({ length: MAX_BOTS + 5 }, () => vehicle(world))
    expect(liveBots(many, world).length).toBe(MAX_BOTS)
  })

  it('lists remote players and live own bots for audio, stuck in the lava or not', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    const [p2, p3] = [vehicle(world), vehicle(world)]
    const bots = [vehicle(world), vehicle(world), vehicle(world)]
    world.removeRigidBody(bots[2].body)
    const into: { body: RAPIER.RigidBody }[] = []
    const list = audibleVehicles([[2, p2], [3, p3]], bots, world, into)
    expect(list).toBe(into)
    expect(list).toEqual([p2, p3, bots[0], bots[1]])
    // A client that does not simulate bots passes none of its own (it hears the replicas).
    expect(audibleVehicles([[2, p2]], [], world)).toEqual([p2])
  })
})

describe('hillHold', () => {
  const ring = { x: 100, z: -50, inner: 80, outer: 108 }
  it('sends bots to the ring, on the side nearest the host, never to the lake in the middle', () => {
    const hold = hillHold(ring, { x: 400, z: -50 })
    expect(hold.x).toBeCloseTo(100 + 94)
    expect(hold.z).toBeCloseTo(-50)
    expect(hold.radius).toBeCloseTo(14)
    // Every point bots may hold lies inside the ring.
    const d = Math.hypot(hold.x - ring.x, hold.z - ring.z)
    expect(d - hold.radius).toBeGreaterThanOrEqual(ring.inner)
    expect(d + hold.radius).toBeLessThanOrEqual(ring.outer)
    // From the other side it is the other side of the ring.
    expect(hillHold(ring, { x: 100, z: -500 }).z).toBeCloseTo(-50 - 94)
    // A host standing on the centre still gets a point on the ring.
    const centre = hillHold(ring, { x: 100, z: -50 })
    expect(Math.hypot(centre.x - ring.x, centre.z - ring.z)).toBeCloseTo(94)
  })
  it('holds a disc zone at its centre', () => {
    expect(hillHold({ x: 5, z: 6, inner: 0, outer: 30 }, { x: 100, z: 100 })).toEqual({ x: 5, z: 6, radius: 30 })
  })
})

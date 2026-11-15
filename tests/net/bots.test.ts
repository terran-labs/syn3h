import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { BOT_ID_BASE, MAX_BOTS } from '../../shared/protocol'
import { audibleVehicles, bodyAlive, liveBots } from '../../src/net/bots'

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

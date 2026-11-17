/**
 * Multiplayer on a wrapping world: a square tile whose edges meet. Positions travel canonical
 * (inside the tile), so two vehicles a few metres apart across the seam are a whole tile
 * apart in plain numbers. These tests hold the rules in src/net/RemotePlayer.ts and the room
 * server's range checks.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, type ServerMessage, WRAP_SIZES, type WireState, encodeState, inZone } from '../../shared/protocol'
import { wrapCoord } from '../../shared/wrap'
import { RemotePlayer } from '../../src/net/RemotePlayer'
import { PLANET_SIZES } from '../../src/world/terrain/generate'
import { emptyInputLike } from './helpers'

const SIZE = 1024
const HALF = SIZE / 2

beforeAll(async () => {
  await RAPIER.init()
})

describe('wrap sizes', () => {
  it('the room server and the terrain generator agree on the tile for each planet size', () => {
    expect([...WRAP_SIZES]).toEqual([...PLANET_SIZES])
  })
})

describe('RemotePlayer on a wrapping world', () => {
  const info = { id: 2, name: 'Remote', slot: 1, score: 0, kind: 'buggy' as const, colors: ['#ffffff', '#000000'] as [string, string] }
  function remote(wrapSize: number, dynamic = false) {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const body = world.createRigidBody(dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased())
    const vehicle = {
      body, input: emptyInputLike(), isLocal: true, id: '', name: '', shifts: 0,
      // The real Vehicle.shiftBy also moves the drawn position; the body is what matters here.
      shiftBy(dx: number, dz: number) { const t = body.translation(); body.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true); this.shifts++ },
    }
    const r = new RemotePlayer(info, vehicle as never)
    r.wrapSize = wrapSize
    return { r, body, world }
  }
  const at = (t: number, x: number, z = 0, v: [number, number, number] = [0, 0, 0]): WireState => ({ id: 2, t, p: [x, 5, z], q: [0, 0, 0, 1], v, w: [0, 0, 0], input: emptyInputLike() })
  /** One step: steer toward render time `t`, then let the physics move the body there. */
  const step = (o: ReturnType<typeof remote>, t: number, local: { x: number; y: number; z: number }, radius = 40, blend = 0.1) => {
    o.r.steer(t, 1, local, radius, blend)
    o.world.step()
    return o.body.translation()
  }

  it('keeps one continuous track when the sender crosses the seam: no blend across the tile', () => {
    const o = remote(SIZE)
    // Driving +X at 20 m/s through the seam at x = +512: canonical x wraps to the far side.
    o.r.push(at(1.0, 508, 0, [20, 0, 0]), 1.0, 20)
    o.r.push(at(1.1, 510, 0, [20, 0, 0]), 1.1, 20)
    o.r.push(at(1.2, wrapCoord(512, SIZE), 0, [20, 0, 0]), 1.2, 20)
    o.r.push(at(1.3, wrapCoord(514, SIZE), 0, [20, 0, 0]), 1.3, 20)
    expect(o.r.buffer.states.map((s) => s.p[0])).toEqual([514, 512, 510, 508])
    // Half way between the states either side of the seam is 511, not the middle of the world.
    expect(o.r.buffer.sample(1.15, 1).p[0]).toBeCloseTo(511)
    // Past the newest state it carries on along the velocity, on the same track.
    expect(o.r.buffer.sample(1.4, 1).p[0]).toBeCloseTo(516)
  })

  it('absorbs a sender\'s whole-tile shift: a jump of exactly one tile is no movement at all', () => {
    const o = remote(SIZE)
    o.r.push(at(1.0, 100), 1.0, 20)
    o.r.push(at(1.1, 100 + SIZE), 1.1, 20)
    o.r.push(at(1.2, 100 - SIZE), 1.2, 20)
    expect(o.r.buffer.states.map((s) => s.p[0])).toEqual([100, 100, 100])
  })

  it('draws the vehicle at the image nearest the local player', () => {
    const o = remote(SIZE)
    o.r.push(at(1.0, 505), 1.0, 20)
    o.r.push(at(1.1, 505), 1.1, 20)
    // We are just the other side of the seam, at x = -500: it is 19 m away, not 1005.
    const p = step(o, 1.05, { x: -500, y: 5, z: 0 }, 0)
    expect(p.x).toBeCloseTo(505 - SIZE)
    // From the middle of the world it is drawn where it canonically is.
    const far = remote(SIZE)
    far.r.push(at(1.0, 505), 1.0, 20)
    far.r.push(at(1.1, 505), 1.1, 20)
    expect(step(far, 1.05, { x: 0, y: 5, z: 0 }, 0).x).toBeCloseTo(505)
  })

  it('moves the body by one whole tile, in one step, when the local player crosses the seam', () => {
    const o = remote(SIZE, true)
    o.r.push(at(1.0, 500), 1.0, 20)
    o.r.push(at(1.1, 500), 1.1, 20)
    // We are at 505 beside it: physical, and settled on its target.
    for (let i = 0; i < 80; i++) step(o, 1.05, { x: 505, y: 5, z: 0 })
    expect(o.r.physical).toBe(true)
    expect(o.body.translation().x).toBeCloseTo(500, 1)
    expect(o.r.jumped).toBe(false)
    // Our own body is shifted a tile: we are now at 505 - 1024, and so must it be, at once.
    const local = { x: 505 - SIZE, y: 5, z: 0 }
    o.r.steer(1.05, 1, local, 40, 0.1)
    expect(o.r.jumped).toBe(true)
    expect(o.body.translation().x).toBeCloseTo(500 - SIZE, 1)
    // Still 5 m from us, still physical, and not snapped: the next step is an ordinary one.
    expect(o.r.physical).toBe(true)
    o.world.step()
    o.r.steer(1.05, 1, local, 40, 0.1)
    expect(o.r.jumped).toBe(false)
    expect(o.body.translation().x).toBeCloseTo(500 - SIZE, 1)
  })

  it('follows the local player\'s shift before the next step, for the frame in between', () => {
    const o = remote(SIZE, true)
    o.body.setTranslation({ x: 500, y: 5, z: -100 }, true)
    o.r.reimage({ x: 505, z: -100 })
    expect(o.body.translation().x).toBe(500)
    o.r.reimage({ x: 505 - SIZE, z: -100 + SIZE })
    expect(o.body.translation().x).toBe(500 - SIZE)
    expect(o.body.translation().z).toBe(-100 + SIZE)
    // And never on a world that does not wrap.
    const flat = remote(0, true)
    flat.body.setTranslation({ x: 500, y: 5, z: 0 }, true)
    flat.r.reimage({ x: -500, z: 0 })
    expect(flat.body.translation().x).toBe(500)
  })

  it('blends a physical copy toward its target across the seam without snapping', () => {
    const o = remote(SIZE, true)
    // The copy sits at 510; its sender has just crossed to canonical -511 (1 m further on).
    o.body.setTranslation({ x: 510, y: 5, z: 0 }, true)
    o.r.push(at(1.0, 510), 1.0, 20)
    o.r.push(at(1.1, wrapCoord(513, SIZE)), 1.1, 20)
    const local = { x: 505, y: 5, z: 0 }
    o.r.steer(1.1, 1, local, 40, 0.1)
    // A tenth of the 3 m gap, not a jump of a tile and not a snap to the target.
    expect(o.r.jumped).toBe(false)
    expect(o.body.translation().x).toBeCloseTo(510.3, 2)
  })

  it('changes nothing on a world that does not wrap', () => {
    const o = remote(0)
    o.r.push(at(1.0, 505), 1.0, 20)
    o.r.push(at(1.1, -505), 1.1, 20)
    expect(o.r.buffer.states.map((s) => s.p[0])).toEqual([-505, 505])
    expect(step(o, 1.1, { x: -500, y: 5, z: 0 }, 0).x).toBeCloseTo(-505)
    expect(o.r.jumped).toBe(false)
  })
})

describe('inZone on a wrapping world', () => {
  it('measures to the zone the short way round', () => {
    const zone = { x: 500, z: 0, inner: 10, outer: 30, yMin: 0, yMax: 50 }
    // 20 m from the centre, across the seam.
    expect(inZone(zone, [-504, 5, 0], SIZE)).toBe(true)
    expect(inZone(zone, [-504, 5, 0])).toBe(false)
    expect(inZone(zone, [-504, 5, 0], 0)).toBe(false)
    expect(inZone(zone, [480, 5, 0], SIZE)).toBe(true)
    expect(inZone(zone, [0, 5, 0], SIZE)).toBe(false)
  })
})

describe('Room on a wrapping world', () => {
  class FakePeer implements Peer {
    json: ServerMessage[] = []
    send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
    close(): void {}
    last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
      for (let i = this.json.length - 1; i >= 0; i--) if (this.json[i].type === type) return this.json[i] as never
      return undefined
    }
    all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] { return this.json.filter((m) => m.type === type) as never }
  }
  let clock = 0
  let room: Room
  const join = (name: string, params: Record<string, number | boolean> = {}) => {
    const peer = new FakePeer()
    room.connect(peer)
    room.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params }))
    return { peer, id: peer.last('welcome')!.id }
  }
  const state = (p: [number, number, number], v: [number, number, number] = [0, 0, 0], extra: Partial<WireState> = {}) =>
    encodeState({ id: 0, t: clock / 1000, p, q: [0, 0, 0, 1], v, w: [0, 0, 0], input: emptyInputLike(), ...extra })
  const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
  /** A small planet (tile 1024 m). Every world wraps. */
  const world = (_wrap = true) => ({ 'terrain.planetSize': 0 })

  beforeEach(() => {
    clock = 100_000
    room = new Room('wrap', { now: () => clock })
  })

  it('passes "it" by a ram across the seam, and relays the shove', () => {
    const a = join('A', { ...world(true), 'game.mode': 0 })
    const b = join('B')
    clock += 3100
    // 6 m apart across the seam at x = 512: 1018 m apart in plain coordinates.
    room.receive(a.peer, state([HALF - 3, 0, 0], [20, 0, 0]))
    room.receive(b.peer, state([-HALF + 3, 0, 0]))
    send(a.peer, { type: 'ram', other: b.id, push: [13, 0, 0] })
    expect(b.peer.last('game')).toMatchObject({ event: 'ram', game: { it: b.id } })
    expect(b.peer.last('shove')).toEqual({ type: 'shove', from: a.id, push: [13, 0, 0] })
  })

  it('still refuses a ram from far away on a wrapping world', () => {
    const a = join('A', world(true))
    const b = join('B')
    clock += 3100
    room.receive(a.peer, state([0, 0, 0], [20, 0, 0]))
    room.receive(b.peer, state([300, 0, 0]))
    send(a.peer, { type: 'ram', other: b.id, push: [13, 0, 0] })
    expect(b.peer.all('shove')).toEqual([])
  })

  it('accepts a tag beam whose origin is across the seam from the sender\'s last state', () => {
    const a = join('A', world(true))
    const b = join('B')
    clock += 3100
    room.receive(a.peer, state([HALF - 1, 0, 0]))
    room.receive(b.peer, state([-HALF + 20, 0, 0]))
    // The muzzle is 2 m ahead of the vehicle, which puts it across the seam: canonical -511.
    send(a.peer, { type: 'fire', shot: { id: 1, o: [-HALF + 1, 1, 0], d: [1, 0, 0], boost: 0, t: clock / 1000 } })
    expect(b.peer.last('fire')).toMatchObject({ from: a.id })
  })

  it('counts a player on the hill across the seam from its centre', () => {
    const host = join('Host', world(true))
    const b = join('B')
    send(host.peer, { type: 'param', id: 'game.mode', value: 1 })
    send(host.peer, { type: 'zone', zone: { x: HALF - 12, z: 0, inner: 10, outer: 30, yMin: 0, yMax: 50 } })
    // B is 20 m from the centre, on the far side of the seam; the host is nowhere near.
    for (let t = 0; t < 12; t++) {
      clock += 250
      room.receive(host.peer, state([0, 5, 0]))
      room.receive(b.peer, state([-HALF + 8, 5, 0]))
    }
    const game = host.peer.last('game')!.game
    expect(game.koth.holder).toBe(b.id)
    expect(game.scores[b.id]).toBeGreaterThanOrEqual(2)
  })

  it('reads the tile from the room\'s planet size', () => {
    const a = join('A', { 'terrain.planetSize': 2, 'game.mode': 0 })
    const b = join('B')
    clock += 3100
    // On the large planet the seam is at 2048, so the small planet's seam is open ground:
    // these two are a kilometre apart.
    room.receive(a.peer, state([HALF - 3, 0, 0], [20, 0, 0]))
    room.receive(b.peer, state([-HALF + 3, 0, 0]))
    send(a.peer, { type: 'ram', other: b.id, push: [13, 0, 0] })
    expect(b.peer.all('shove')).toEqual([])
    // Across the large planet's own seam they touch.
    const half = WRAP_SIZES[2] / 2
    clock += 600
    room.receive(a.peer, state([half - 3, 0, 0], [20, 0, 0]))
    room.receive(b.peer, state([-half + 3, 0, 0]))
    send(a.peer, { type: 'ram', other: b.id, push: [13, 0, 0] })
    expect(b.peer.last('game')).toMatchObject({ event: 'ram', game: { it: b.id } })
    expect(b.peer.all('shove').length).toBe(1)
  })
  // Bug caught: a size between the old three, or junk in the room's stored value, giving the
  // server a tile of 0 or NaN, so no ram or hill could ever be measured.
  it('measures across the seam of an in-between planet, and of a junk planet size', () => {
    for (const [stored, size] of [[Math.log2(3072 / 1024), 3072], ['junk', 2048], [1e9, 4096], [-7, 1024], [null, 2048]] as const) {
      room = new Room('wrap', { now: () => clock })
      const a = join('A', { 'terrain.planetSize': stored as never, 'game.mode': 0 })
      const b = join('B')
      clock += 3100
      room.receive(a.peer, state([size / 2 - 3, 0, 0], [20, 0, 0]))
      room.receive(b.peer, state([-size / 2 + 3, 0, 0]))
      send(a.peer, { type: 'ram', other: b.id, push: [13, 0, 0] })
      expect(b.peer.all('shove').length, `stored ${stored}`).toBe(1)
    }
  })
})

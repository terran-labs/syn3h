/**
 * Gear and effect looks are world settings since 22 November 2026 (fx.impact.*, fx.fireworks.*,
 * fx.grapple.*, materialize.*, the vehicles' beams and lamps): everyone in a room sees the same.
 * Bugs these catch: a change by one player not reaching another, a locked guest changing the
 * room's look, an id the client does not know throwing, a saved or copied world leaving them
 * out, and an older world (without them) not putting them back to their defaults.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Peer, Room } from '../../server/room'
import { PROTOCOL_VERSION, type ServerMessage } from '../../shared/protocol'
import { params } from '../../shared/params'
import { applyRoomWorld } from '../../src/net/params'
import { exportWorld, parseWorld, type PropertyDef } from '../../src/ui/inspector/model'
import { impactSparks, fireworkHighDetail } from '../../src/weapons/impact/params'
import { grappleReleaseTime } from '../../src/weapons/bungee/params'
import { materializeCloudSize } from '../../src/vehicles/effects/materializeParams'
import { buggyHeadlights } from '../../src/vehicles/effects/headlights'

class FakePeer implements Peer {
  json: ServerMessage[] = []
  send(data: string | Uint8Array): void { if (typeof data === 'string') this.json.push(JSON.parse(data)) }
  close(): void {}
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) if (this.json[i].type === type) return this.json[i] as never
    return undefined
  }
}
let room: Room
const send = (peer: Peer, msg: object) => room.receive(peer, JSON.stringify(msg))
function join(name: string): { peer: FakePeer; id: number } {
  const peer = new FakePeer()
  room.connect(peer)
  send(peer, { type: 'hello', v: PROTOCOL_VERSION, modes: 2, name, params: {} })
  return { peer, id: peer.last('welcome')!.id }
}
beforeEach(() => { room = new Room('gear', { now: () => 100_000 }) })

describe('shared gear looks', () => {
  it('are world settings; the detail switch stays personal', () => {
    for (const p of [impactSparks, grappleReleaseTime, materializeCloudSize, buggyHeadlights]) expect(p.def.scope).toBe('world')
    expect(fireworkHighDetail.def.scope).toBe('client')
  })

  it('reach everyone in the room, clamped by the server where it knows the range', () => {
    const a = join('A'), b = join('B')
    send(a.peer, { type: 'param', id: impactSparks.def.id, value: 40 })
    expect(b.peer.last('param')).toEqual({ type: 'param', id: impactSparks.def.id, value: 40, from: a.id })
    // The grapple's ids are in the server's registry (it imports bungee/params): range enforced.
    send(a.peer, { type: 'param', id: grappleReleaseTime.def.id, value: 99 })
    expect(b.peer.last('param')).toEqual({ type: 'param', id: grappleReleaseTime.def.id, value: grappleReleaseTime.def.max, from: a.id })
    const late = join('Late').peer.last('welcome')!.params
    expect(late[impactSparks.def.id]).toBe(40)
    expect(late[grappleReleaseTime.def.id]).toBe(grappleReleaseTime.def.max)
  })

  it('cannot be changed by a guest while the host has locked the sliders', () => {
    const host = join('Host'), guest = join('Guest')
    send(host.peer, { type: 'lock', locked: true })
    send(guest.peer, { type: 'param', id: grappleReleaseTime.def.id, value: 2 })
    expect(guest.peer.last('param')?.from).not.toBe(guest.id)
    expect(host.peer.last('param')).toBeUndefined()
    expect(join('Late').peer.last('welcome')!.params[grappleReleaseTime.def.id] ?? grappleReleaseTime.def.default).toBe(grappleReleaseTime.def.default)
  })

  it('on a client: an id it does not know is ignored, a world it joins replaces its own value', () => {
    expect(() => applyRoomWorld({ 'fx.notYetInvented': 3, [impactSparks.def.id]: 12 })).not.toThrow()
    expect(params.get('fx.notYetInvented')).toBeUndefined()
    expect(impactSparks.value).toBe(12)
    // A room (or an older world) without the id puts it back to its default.
    applyRoomWorld({})
    expect(impactSparks.value).toBe(impactSparks.def.default)
  })

  it('travel in copied worlds, and an older world without them pastes cleanly', () => {
    const defs = params.all().map(p => p.def as PropertyDef)
    params.set(impactSparks.def.id, 9)
    const json = exportWorld(defs, id => params.get(id)?.value)
    expect(json.values[impactSparks.def.id]).toBe(9)
    expect(json.values[grappleReleaseTime.def.id]).toBe(grappleReleaseTime.def.default)
    expect(json.values[fireworkHighDetail.def.id]).toBeUndefined()
    const old = parseWorld(JSON.stringify({ mira: 'world', version: 1, values: { 'world.gravity': 9.81 } }), defs)
    expect(old.ok && old.entries.some(e => e.id === impactSparks.def.id)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { STATE_BYTES, type WireState, decodeState, encodeState, parseJson, stampStateId } from '../../shared/protocol'

const sample: WireState = {
  id: 0,
  t: 1731600000.123456,
  p: [12.5, -3.25, 4000.75],
  q: [0, 0.7071068, 0, 0.7071068],
  v: [1.5, -9.81, 30],
  w: [0.1, -2, 0.5],
  input: { x: -1, y: 0.5, z: 0, w: 0.25, brakes: true, special: false, fire: true },
}

describe('protocol', () => {
  it('round trips a vehicle state in a fixed size record', () => {
    const bytes = encodeState(sample)
    expect(bytes.byteLength).toBe(STATE_BYTES)
    const out = decodeState(bytes)!
    expect(out.t).toBe(sample.t)
    for (let i = 0; i < 3; i++) {
      expect(out.p[i]).toBeCloseTo(sample.p[i], 2)
      expect(out.v[i]).toBeCloseTo(sample.v[i], 4)
      expect(out.w[i]).toBeCloseTo(sample.w[i], 4)
    }
    for (let i = 0; i < 4; i++) expect(out.q[i]).toBeCloseTo(sample.q[i], 6)
    expect(out.input.x).toBe(-1)
    expect(out.input.y).toBeCloseTo(0.5, 1)
    expect(out.input.w).toBeCloseTo(0.25, 1)
    expect(out.input.brakes).toBe(true)
    expect(out.input.special).toBe(false)
    expect(out.input.fire).toBe(true)
  })

  it('lets the server stamp the sender id', () => {
    const bytes = encodeState({ ...sample, id: 999 })
    stampStateId(bytes, 7)
    expect(decodeState(bytes)!.id).toBe(7)
  })

  it('decodes from a sub view of a larger buffer', () => {
    const big = new Uint8Array(STATE_BYTES + 10)
    encodeState(sample, big.subarray(5, 5 + STATE_BYTES))
    expect(decodeState(big.subarray(5, 5 + STATE_BYTES))!.p[0]).toBeCloseTo(12.5)
  })

  it('rejects malformed records', () => {
    expect(decodeState(new Uint8Array(10))).toBeNull()
    const bad = encodeState({ ...sample, p: [NaN, 0, 0] })
    expect(decodeState(bad)).toBeNull()
    const wrongKind = encodeState(sample)
    wrongKind[0] = 9
    expect(decodeState(wrongKind)).toBeNull()
  })

  it('parses control messages defensively', () => {
    expect(parseJson('{"type":"ping","t":1}')).toEqual({ type: 'ping', t: 1 })
    expect(parseJson('not json')).toBeNull()
    expect(parseJson('[1,2]')).toBeNull()
    expect(parseJson('x'.repeat(10000))).toBeNull()
  })
})

import { params } from '../../shared/params'
import { applyRoomWorld, netSendRate } from '../../src/net/params'
import { kothTargetScore, tagCooldown } from '../../src/modes/params'
import { laserSpeed } from '../../src/weapons/params'

describe('applyRoomWorld', () => {
  /** A room stored before `tag.cooldown` existed: it has every other world value. */
  const oldRoom = () => {
    const values: Record<string, unknown> = { ...params.snapshot('world'), 'laser.speed': 250, 'koth.targetScore': 30 }
    delete values['tag.cooldown']
    return values
  }
  const defaults = () => { for (const p of params.all()) params.set(p.def.id, p.def.default, 'remote') }

  it('puts a world parameter the room lacks back to its default, and keeps personal ones', () => {
    defaults()
    // What a joiner brings from its URL or from sliders moved before joining.
    params.set('tag.cooldown', 7)
    params.set('laser.speed', 40)
    params.set('net.sendRate', 30)
    const changes: string[] = []
    const off = params.onChange((id, _value, source) => changes.push(`${id}:${source}`))
    applyRoomWorld(oldRoom())
    off()
    expect(tagCooldown.value).toBe(tagCooldown.def.default)
    expect(laserSpeed.value).toBe(250)
    expect(kothTargetScore.value).toBe(30)
    expect(netSendRate.value).toBe(30)
    // Told to listeners as the room's doing, so nothing is echoed back to the server.
    expect(changes).toContain('tag.cooldown:remote')
    expect(changes.every((c) => c.endsWith(':remote'))).toBe(true)
    defaults()
  })

  it('leaves two clients that held different values with the same world', () => {
    defaults()
    params.set('tag.cooldown', 7)
    params.set('koth.targetScore', 100)
    applyRoomWorld(oldRoom())
    const first = params.snapshot('world')
    defaults()
    params.set('tag.cooldown', 1.5)
    params.set('laser.speed', 300)
    applyRoomWorld(oldRoom())
    expect(params.snapshot('world')).toEqual(first)
    defaults()
  })
})

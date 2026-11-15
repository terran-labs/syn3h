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

import { FELT_WINDOW, MAX_SHOVE, SHOVE_MARGIN, SHOVE_SHARE, ShoveQueue, cleanShove, shoveFor } from '../../src/net/shove'

describe('shoveFor', () => {
  it('pushes the rammed vehicle along the line between them, by a share of the closing speed', () => {
    // A at the origin doing 20 m/s toward B, 3 m ahead on -Z and standing still.
    const push = shoveFor([0, 1, 0], [0, 1, -3], [0, 0, -20], [0, 0, 0])!
    expect(push[0]).toBeCloseTo(0)
    expect(push[1]).toBe(0)
    expect(push[2]).toBeCloseTo(-20 * SHOVE_SHARE)
    // A chase: B is already moving away at 10 m/s, so only the difference counts.
    expect(shoveFor([0, 1, 0], [0, 1, -3], [0, 0, -22], [0, 0, -10])![2]).toBeCloseTo(-12 * SHOVE_SHARE)
    // A glancing approach: only the part of the speed toward B counts.
    expect(Math.hypot(...shoveFor([0, 1, 0], [3, 1, -3], [0, 0, -20], [0, 0, 0])!)).toBeCloseTo(20 * Math.SQRT1_2 * SHOVE_SHARE)
  })
  it('gives nothing when not closing, barely closing, or on top of each other', () => {
    expect(shoveFor([0, 1, 0], [0, 1, -3], [0, 0, 20], [0, 0, 0])).toBe(null)
    expect(shoveFor([0, 1, 0], [0, 1, -3], [0, 0, -1], [0, 0, 0])).toBe(null)
    expect(shoveFor([0, 1, 0], [0, 1, -3], [0, 0, -10], [0, 0, -10])).toBe(null)
    expect(shoveFor([0, 1, 0], [0, 5, 0], [0, 0, -20], [0, 0, 0])).toBe(null)
  })
  it('never exceeds the limit', () => {
    expect(Math.hypot(...shoveFor([0, 1, 0], [0, 1, -3], [0, 0, -500], [0, 0, 0])!)).toBeCloseTo(MAX_SHOVE)
  })
})

describe('cleanShove', () => {
  it('accepts three finite numbers and clamps the length', () => {
    expect(cleanShove([1, 0, -2])).toEqual([1, 0, -2])
    expect(Math.hypot(...cleanShove([300, 0, 400])!)).toBeCloseTo(MAX_SHOVE)
    for (const junk of [undefined, null, 'x', [1, 2], [1, 2, 3, 4], [1, NaN, 2], [1, Infinity, 2], ['1', 2, 3], [0, 0, 0], { 0: 1, 1: 2, 2: 3 }]) expect(cleanShove(junk)).toBe(null)
  })
})

describe('ShoveQueue', () => {
  const never = () => -Infinity
  const still: [number, number, number] = [0, 0, 0]
  it('holds a push until playback has reached the ram, then hands it over once, in full', () => {
    const q = new ShoveQueue()
    q.add(7, [0, 0, -13], 10, 0.15, still)
    expect(q.take(10.1, never, still)).toEqual([])
    expect(q.take(10.15 + SHOVE_MARGIN - 0.01, never, still)).toEqual([])
    expect(q.take(10.15 + SHOVE_MARGIN, never, still)).toEqual([{ from: 7, push: [0, 0, -13] }])
    expect(q.take(11, never, still)).toEqual([])
    expect(q.size).toBe(0)
  })
  it('drops a push our own physics delivered while it waited', () => {
    const q = new ShoveQueue()
    q.add(7, [0, 0, -13], 10, 0.15, still)
    // The rammer's copy arrived and shoved us to 12.5 m/s in the meantime.
    expect(q.take(10.3, () => 10.2, [0, 0, -12.5])).toEqual([])
    expect(q.size).toBe(0)
  })
  it('drops a push our own physics delivered just before it arrived', () => {
    const q = new ShoveQueue()
    // We were standing; our physics felt the ram and we are already doing 13 m/s when the
    // report arrives. Judged against our velocity from before the contact, nothing is owed.
    q.add(7, [0, 0, -13], 10, 0.15, [0, 0, -13], still)
    expect(q.take(10.3, () => 9.8, [0, 0, -12.5])).toEqual([])
    // Without that earlier contact the same velocities would mean a fresh ram, owed in full.
    q.add(7, [0, 0, -13], 20, 0.15, [0, 0, -13], still)
    expect(q.take(20.3, never, [0, 0, -13])[0].push[2]).toBeCloseTo(-13)
    // A contact long before does not count either.
    q.add(7, [0, 0, -13], 30, 0.15, [0, 0, -13], still)
    expect(q.take(30.3, () => 30 - FELT_WINDOW - 0.5, [0, 0, -13])[0].push[2]).toBeCloseTo(-13)
  })
  it('tops up a ram our physics felt only in part: a graze', () => {
    const q = new ShoveQueue()
    q.add(7, [0, 0, -13], 10, 0.15, still)
    const out = q.take(10.3, () => 10.25, [0, 0, -4])
    expect(out.length).toBe(1)
    expect(out[0].push[2]).toBeCloseTo(-9)
    // Slowing down meanwhile never earns more than the push itself.
    q.add(7, [0, 0, -13], 20, 0.15, [0, 0, -10])
    expect(q.take(20.3, never, [0, 0, -8])[0].push[2]).toBeCloseTo(-13)
    // A shortfall under 1 m/s is not worth a jolt.
    q.add(7, [0, 0, -13], 30, 0.15, still)
    expect(q.take(30.3, never, [0, 0, -12.5])).toEqual([])
  })
  it('keeps one push per rammer and judges each on its own', () => {
    const q = new ShoveQueue()
    q.add(7, [1, 0, 0], 10, 0.1, still)
    q.add(7, [5, 0, 0], 10.05, 0.1, still)
    q.add(8, [0, 0, 6], 10.05, 0.1, still)
    expect(q.size).toBe(2)
    // We gained 6 m/s along +Z (rammer 8's doing) and nothing along +X.
    const out = q.take(10.3, never, [0, 0, 6])
    expect(out).toEqual([{ from: 7, push: [5, 0, 0] }])
  })
})

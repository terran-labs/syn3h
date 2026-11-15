import { describe, expect, it } from 'vitest'
import { BLOOM_BACKENDS, bloomActive, bloomOverride, type BloomGate } from '../../src/core/renderOptions'

const on: BloomGate = { strength: 0.5, level: 2, deviceLevel: 2, backend: 'webgpu' }

describe('bloom gate', () => {
  it('is on only for a desktop class device at graphics level 2 with strength above 0', () => {
    expect(bloomActive(on)).toBe(true)
    expect(bloomActive({ ...on, backend: 'webgl' })).toBe(BLOOM_BACKENDS.webgl)
  })
  it('is off at strength 0, the default, and for nonsense strengths', () => {
    for (const strength of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(bloomActive({ ...on, strength })).toBe(false)
  })
  it('is off below graphics level 2, so a governor drop switches it off', () => {
    expect(bloomActive({ ...on, level: 1 })).toBe(false)
    expect(bloomActive({ ...on, level: 0 })).toBe(false)
  })
  it('is off on anything not classified desktop, even if the level is forced to 2', () => {
    expect(bloomActive({ ...on, deviceLevel: 1 })).toBe(false)
    expect(bloomActive({ ...on, deviceLevel: 0 })).toBe(false)
  })
  it('is off on a backend that is not allowed', () => {
    expect(bloomActive({ ...on, allowed: { webgpu: false, webgl: true } })).toBe(false)
    expect(bloomActive({ ...on, backend: 'webgl', allowed: { webgpu: true, webgl: false } })).toBe(false)
  })
})

describe('?bloom= override', () => {
  it('reads a strength and clamps it to 0..1', () => {
    expect(bloomOverride('?bloom=0.6')).toBe(0.6)
    expect(bloomOverride('?bloom=0')).toBe(0)
    expect(bloomOverride('?bloom=3')).toBe(1)
    expect(bloomOverride('?bloom=-2')).toBe(0)
  })
  it('ignores a missing or unreadable value', () => {
    for (const search of ['', '?bloom=', '?bloom=lots', '?gfx=2']) expect(bloomOverride(search)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { type PostGateInput, drawsEffects, postTier, shaftTaps, sunHeightFactor, sunScreenFade } from '../../src/fx/post/gate'
import { LOOKS, gradeFor, lookForKind } from '../../src/fx/post/looks'
import { postOverride } from '../../src/fx/post/params'

const full: PostGateInput = { on: true, tier: 'full', shed: 0 }

describe('post tier', () => {
  it('is off when switched off or when the quality level has no post effects', () => {
    expect(postTier({ ...full, on: false })).toBe('off')
    expect(postTier({ ...full, tier: 'off' })).toBe('off')
    expect(postTier({ ...full, tier: 'off', shed: 1 })).toBe('off')
  })
  it('follows the tier the quality level allows, with no device class of its own', () => {
    expect(postTier(full)).toBe('full')
    expect(postTier({ ...full, tier: 'lite' })).toBe('lite')
    expect(postTier({ ...full, tier: 'base' })).toBe('base')
  })
  it('keeps its tier while the budget only fades, and falls to base when it is spent', () => {
    for (const tier of ['lite', 'full'] as const) {
      for (const shed of [0, 0.25, 0.5, 0.99]) expect(postTier({ on: true, tier, shed })).toBe(tier)
      expect(postTier({ on: true, tier, shed: 1 })).toBe('base')
    }
    expect(postTier({ on: true, tier: 'base', shed: 0.5 })).toBe('base')
  })
  it('draws effects on lite and full only', () => {
    expect(drawsEffects('off')).toBe(false)
    expect(drawsEffects('base')).toBe(false)
    expect(drawsEffects('lite')).toBe(true)
    expect(drawsEffects('full')).toBe(true)
  })
  it('marches fewer shaft taps on cheaper tiers and none on base', () => {
    expect(shaftTaps('full')).toBeGreaterThan(shaftTaps('lite'))
    expect(shaftTaps('base')).toBe(0)
  })
})

describe('sun visibility', () => {
  it('is zero behind the camera and fades out past the screen edge', () => {
    expect(sunScreenFade(0.5, 0.5, false)).toBe(0)
    expect(sunScreenFade(0.5, 0.5, true)).toBe(1)
    expect(sunScreenFade(1.05, 0.5, true)).toBeGreaterThan(0)
    expect(sunScreenFade(1.7, 0.5, true)).toBe(0)
  })
  it('is zero below the horizon and strongest at low sun', () => {
    expect(sunHeightFactor(-0.1, 1)).toBe(0)
    expect(sunHeightFactor(0.1, 1)).toBeGreaterThan(sunHeightFactor(0.8, 1))
    expect(sunHeightFactor(0.8, 1)).toBeCloseTo(1)
    expect(sunHeightFactor(0.1, 0)).toBeCloseTo(1)
  })
})

describe('planet looks', () => {
  it('picks the look by terrain kind, volcanic by default', () => {
    expect(lookForKind(1)).toBe(LOOKS.desert)
    expect(lookForKind(2)).toBe(LOOKS.alpine)
    expect(lookForKind(undefined)).toBe(LOOKS.volcanic)
  })
  it('is neutral at amount 0 with neutral sliders', () => {
    const g = gradeFor(LOOKS.volcanic, 0, { contrast: 0, saturation: 1, warmth: 0 })
    expect(g.gain).toEqual([1, 1, 1])
    expect(g.lift).toEqual([0, 0, 0])
    expect(g.contrast).toBe(0)
    expect(g.saturation).toBe(1)
  })
  it('warms with warmth', () => {
    const g = gradeFor(LOOKS.alpine, 0, { contrast: 0, saturation: 1, warmth: 1 })
    expect(g.gain[0]).toBeGreaterThan(g.gain[2])
  })
})

describe('?post= override', () => {
  it('reads on and off', () => {
    expect(postOverride('?post=1')).toBe(true)
    expect(postOverride('?post')).toBe(true)
    expect(postOverride('?post=0')).toBe(false)
    expect(postOverride('?seed=3')).toBeUndefined()
  })
})

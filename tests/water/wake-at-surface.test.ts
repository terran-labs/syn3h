import { describe, expect, it } from 'vitest'
import { easeWake, wakePresence } from '../../src/world/water/waterEffectsMath'

/**
 * The bug a player hit (v26.11.2204): driving along the bed, the buggy still left a wake on the
 * surface above it. A wake belongs to a vehicle breaking the surface.
 */
describe('a wake only at the surface', () => {
  const height = .7
  it('is whole while the vehicle breaks the surface, and gone once it is well under', () => {
    expect(wakePresence(.3, height, 0)).toBe(1)          // top above the water
    expect(wakePresence(0, height, 0)).toBe(1)           // top at the surface
    expect(wakePresence(-.5, height, 0)).toBe(0)         // half a metre under
    expect(wakePresence(-4, height, 0)).toBe(0)
  })
  it('fades rather than cuts as the top goes under', () => {
    const mid = wakePresence(-.15, height, 0)
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1)
  })
  it('does not flicker as the top bobs about the surface', () => {
    let shown = 1
    for (let i = 0; i < 120; i++) shown = easeWake(shown, wakePresence(Math.sin(i * .9) * .2, height, 0), 1 / 60)
    expect(shown).toBeGreaterThan(.5)
  })
  it('comes back when the vehicle climbs out', () => {
    let shown = 0
    for (let i = 0; i < 60; i++) shown = easeWake(shown, wakePresence(.2, height, 0), 1 / 60)
    expect(shown).toBeGreaterThan(.95)
  })
})

describe('the eased wake settles', () => {
  it('reaches exactly none under water and exactly whole at the surface', () => {
    let shown = 1
    for (let i = 0; i < 120; i++) shown = easeWake(shown, 0, 1 / 60)
    expect(shown).toBe(0)
    for (let i = 0; i < 120; i++) shown = easeWake(shown, 1, 1 / 60)
    expect(shown).toBe(1)
  })
})

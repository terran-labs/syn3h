import { describe, expect, it } from 'vitest'
import { TintTransition, hexToOklab, mixTint, randomTintPair, tintPairOk, TINT_RULES } from '../../src/vehicles/tints'

const chroma = (hex: string) => { const [, a, b] = hexToOklab(hex); return Math.hypot(a, b) }
const distance = (x: string, y: string) => { const a = hexToOklab(x), b = hexToOklab(y); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }

describe('vehicle tints', () => {
  // Randomize must give a pair a player can tell apart on the terrain, every time.
  it('randomize gives a pair within the contrast and range rules, the same for the same seed', () => {
    for (let seed = 0; seed < 3000; seed++) {
      const pair = randomTintPair(seed)
      expect(tintPairOk(pair), `${seed} ${pair.body} ${pair.accent}`).toBe(true)
      expect(pair.body).toMatch(/^#[0-9a-f]{6}$/); expect(pair.accent).toMatch(/^#[0-9a-f]{6}$/)
      expect(randomTintPair(seed)).toEqual(pair)
    }
    expect(tintPairOk({ body: '#101010', accent: '#121212' })).toBe(false)
    expect(TINT_RULES.minLightnessGap).toBeGreaterThan(0)
  })
  // A straight RGB blend of blue and orange is grey-brown at its middle (chroma near 0.02).
  it('a blend between two colours does not pass through grey', () => {
    for (const [a, b] of [['#1060ff', '#ff8000'], ['#d02060', '#20c080'], ['#3050e0', '#e0c020']]) {
      expect(chroma(mixTint(a, b, 0.5))).toBeGreaterThan(Math.min(chroma(a), chroma(b)) * 0.6)
    }
  })
  it('the change eases to its target and a new target turns without jumping', () => {
    const t = new TintTransition({ body: '#1768b4', accent: '#49e6ff' })
    t.set({ body: '#e17b79', accent: '#0f686e' })
    for (let i = 0; i < 30; i++) t.update(1 / 60)
    const before = { ...t.current }
    t.set({ body: '#46baa6', accent: '#097e8e' })
    t.update(1 / 60)
    // One frame after retargeting the colours are still where they were, not at either end.
    expect(distance(before.body, t.current.body)).toBeLessThan(0.02)
    expect(distance(before.accent, t.current.accent)).toBeLessThan(0.02)
    for (let i = 0; i < 120; i++) t.update(1 / 60)
    expect(t.active).toBe(false)
    expect(t.current).toEqual({ body: '#46baa6', accent: '#097e8e' })
  })
  it('no frame of a change jumps', () => {
    const t = new TintTransition({ body: '#1768b4', accent: '#49e6ff' })
    t.set({ body: '#e17b79', accent: '#0f686e' })
    let last = t.current.body, worst = 0
    while (t.update(1 / 60)) { worst = Math.max(worst, distance(last, t.current.body)); last = t.current.body }
    expect(worst).toBeLessThan(0.05)
  })
})

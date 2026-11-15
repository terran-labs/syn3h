import { describe, expect, it } from 'vitest'
import { QualityGovernor, buildLadder } from '../../src/core/quality'

describe('post effects as the first rung inside a level', () => {
  it('has no post rung while no post chain is active', () => {
    for (const level of [0, 1, 2, 3, 4, 5] as const) for (const dpr of [1, 2]) {
      const ladder = buildLadder(level, dpr)
      expect(ladder.some(rung => rung.kind === 'post')).toBe(false)
      expect(ladder.every(rung => rung.post === 0)).toBe(true)
    }
  })
  it('adds a first rung that fades only post effects, at every level', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const ladder = buildLadder(level, 2, true), plain = buildLadder(level, 2)
      expect(ladder.length).toBe(plain.length + 1)
      expect(ladder[0].post).toBe(1)
      expect(ladder[1]).toEqual({ ...ladder[0], kind: 'post', post: 0 })
    }
  })
  it('fades post effects before resolution under sustained slow frames, and keeps values when the chain stops', () => {
    const g = new QualityGovernor({ level: 4, devicePixelRatio: 2 })
    expect(g.setPostActive(true)).not.toBeNull()
    const full = g.settings
    let first = null
    for (let i = 0; i < 2000 && !first; i++) first = g.sample(50, true)
    expect(first).not.toBeNull()
    expect(g.settings.kind).toBe('post'); expect(g.settings.post).toBe(0)
    expect(g.settings.pixelRatio).toBe(full.pixelRatio); expect(g.settings.shadows).toBe(full.shadows)
    // The chain turns itself off: the ladder loses the rung and nothing else moves.
    g.setPostActive(false)
    expect(g.settings.pixelRatio).toBe(full.pixelRatio); expect(g.settings.post).toBe(0); expect(g.rung).toBe(0)
    expect(g.setPostActive(false)).toBeNull()
  })
})

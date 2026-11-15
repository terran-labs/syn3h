import { describe, expect, it } from 'vitest'
import { QualityGovernor, buildLadder } from '../../src/core/quality'

describe('post effects as the first desktop rung', () => {
  it('leaves every ladder exactly as it was while no post chain is active', () => {
    for (const level of [0, 1, 2] as const) for (const dpr of [1, 2]) {
      const ladder = buildLadder(level, dpr)
      expect(ladder.some(rung => rung.kind === 'post')).toBe(false)
      expect(ladder.every(rung => rung.post === 0)).toBe(true)
    }
  })
  it('adds a first rung that sheds only post effects, on desktop only', () => {
    const ladder = buildLadder(2, 2, null, true), plain = buildLadder(2, 2)
    expect(ladder.length).toBe(plain.length + 1)
    expect(ladder[0].post).toBe(1)
    expect(ladder[1]).toEqual({ ...ladder[0], kind: 'post', post: 0 })
    // Phones and tablets have no post effects to shed, chain or no chain.
    expect(buildLadder(1, 2, null, true).some(rung => rung.kind === 'post')).toBe(false)
  })
  it('sheds post effects before resolution under sustained slow frames, and keeps values when the chain stops', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
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

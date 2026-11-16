import { describe, expect, it } from 'vitest'
import { BOT_TIMING, buildLadder, QualityGovernor, type BotRelief } from '../../src/core/quality'
import { PerformanceHistory } from '../../src/core/performanceHistory'

const metrics = (frameMs: number) => ({ frameMs, fps: 1000 / frameMs, physicsMs: 1, drawCalls: 10, triangles: 100, firstFrameMs: 1 })
const exhausted = { ...buildLadder(4, 2, true).at(-1)!, level: 4 as const, rung: 3, rungs: 4, auto: true, targetFps: 60 }

/** Bots as the governor sees them, with a count that `shed` and `climb` move. */
function fleet(carried: number, requested: number, costly = true) {
  const bots = { carried, sheds: 0, climbs: 0 }
  const relief: BotRelief = {
    carried: () => bots.carried, requested: () => requested, costly: () => costly,
    shed: () => { if (bots.carried <= 0) return false; bots.carried--; bots.sheds++; return true },
    climb: () => { if (bots.carried >= requested) return false; bots.carried++; bots.climbs++; return true },
  }
  return { bots, relief }
}

describe('bots in the quality system', () => {
  it('offers bots after the post effects and before the resolution, one at a time', () => {
    const g = new QualityGovernor({ level: 4, auto: true, devicePixelRatio: 2 })
    g.setPostActive(true)
    const { bots, relief } = fleet(6, 6)
    g.bots = relief
    const kinds: string[] = []
    for (let t = 0; t < 60000; t += 50) if (g.sample(50)) kinds.push(g.settings.kind)
    // The post fade comes first; every bot goes before the first resolution step.
    expect(kinds[0]).toBe('post')
    expect(bots.sheds).toBe(6)
    expect(bots.carried).toBe(0)
    expect(kinds).toContain('resolution')
  })

  it('leaves bots alone when they do not measurably cost frames, and goes to the resolution', () => {
    const g = new QualityGovernor({ level: 4, auto: true, devicePixelRatio: 2 })
    g.setPostActive(true)
    const { bots, relief } = fleet(6, 6, false)
    g.bots = relief
    for (let t = 0; t < 20000; t += 50) g.sample(50)
    expect(bots.sheds).toBe(0)
    expect(g.settings.kind).toBe('resolution')
  })

  it('never overrides a level the player chose: bots go, the level stays', () => {
    const g = new QualityGovernor({ level: 4, levelPinned: true, auto: true, devicePixelRatio: 2 })
    g.setPostActive(true)
    const { bots, relief } = fleet(4, 4)
    g.bots = relief
    for (let t = 0; t < 120000; t += 50) g.sample(50)
    expect(g.level).toBe(4)
    expect(bots.carried).toBe(0)
  })

  it('brings bots back one at a time with headroom, never above what the host asked for', () => {
    const g = new QualityGovernor({ level: 4, auto: true, devicePixelRatio: 2 })
    const { bots, relief } = fleet(0, 3)
    g.bots = relief
    for (let t = 0; t < 200000; t += 8) g.sample(8)
    expect(bots.carried).toBe(3)
    expect(bots.climbs).toBe(3)
    expect(BOT_TIMING.climbMs).toBeGreaterThan(0)
  })

  it('recommends fewer bots, or a lower level with the current bots, when frames stay slow', () => {
    const h = new PerformanceHistory()
    for (let t = 0; t < 20000; t += 50) h.sample(metrics(50), true, exhausted, { carried: 5, requested: 6, costly: true })
    expect(h.recommendation).toMatchObject({ level: 4, targetLevel: 3, bots: 5, fewerBots: true })
    // At the lowest level fewer bots is still on offer.
    const low = new PerformanceHistory()
    for (let t = 0; t < 20000; t += 50) low.sample(metrics(50), true, { ...exhausted, level: 0 }, { carried: 2, requested: 2, costly: true })
    expect(low.recommendation).toMatchObject({ level: 0, fewerBots: true })
    // Bots that cost nothing measurable are not offered.
    const cheap = new PerformanceHistory()
    for (let t = 0; t < 20000; t += 50) cheap.sample(metrics(50), true, exhausted, { carried: 5, requested: 6, costly: false })
    expect(cheap.recommendation).toMatchObject({ fewerBots: false })
  })
})

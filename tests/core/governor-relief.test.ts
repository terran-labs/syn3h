import { describe, expect, it } from 'vitest'
import { buildLadder, GOVERNOR, QualityGovernor, qualityLevel, RUNG_TIMING } from '../../src/core/quality'
import { PerformanceHistory } from '../../src/core/performanceHistory'

const metrics = (frameMs: number) => ({ frameMs, fps: 1000 / frameMs, physicsMs: 1, drawCalls: 10, triangles: 100, firstFrameMs: 1 })
const exhausted = { ...buildLadder(4, 2, true).at(-1)!, level: 4 as const, rung: 3, rungs: 4, auto: true, targetFps: 60 }
function history(h: PerformanceHistory, ms: number, quality = exhausted, frameMs = 50) {
  for (let t = 0; t < ms; t += frameMs) h.sample(metrics(frameMs), true, quality)
}

describe('quality relief without overriding a pinned choice', () => {
  it('defaults to High while retaining slow recovery and settle times', () => {
    expect(qualityLevel.def.default).toBe(3)
    expect(RUNG_TIMING.level).toEqual({ shedMs: 4000, climbMs: 60000 })
    expect(GOVERNOR.settleMs).toBe(2000)
    expect(GOVERNOR.manualSettleMs).toBe(5000)
  })
  it('preserves a pinned Ultra under sustained pressure and exhausts its cheap sheds', () => {
    const g = new QualityGovernor({ level: 4, levelPinned: true, auto: true, devicePixelRatio: 2 })
    g.setPostActive(true)
    for (let t = 0; t < 120000; t += 50) g.sample(50)
    expect(g.level).toBe(4)
    expect(g.rung).toBe(g.ladder.length - 1)
  })
  it('waits for exhausted sheds, then offers High after ten seconds, and respects session dismissal', () => {
    const h = new PerformanceHistory()
    history(h, 60000, { ...exhausted, rung: 1 })
    expect(h.recommendation).toBeNull()
    history(h, 9000); expect(h.recommendation).toBeNull()
    history(h, 1000); expect(h.recommendation).toMatchObject({ level: 4, targetLevel: 3 })
    h.ignore(); history(h, 60000); expect(h.recommendation).toBeNull()
  })
  it('breaks slow evidence on recovery or a hidden/menu frame', () => {
    for (const recovery of [false, true]) {
      const h = new PerformanceHistory(); history(h, 9000)
      if (recovery) history(h, 1100, exhausted, 16)
      else h.sample(metrics(50), false, exhausted)
      history(h, 1000); expect(h.recommendation).toBeNull()
    }
  })
  it('uses p90 rather than average FPS so frequent missed frames produce an offer', () => {
    const h = new PerformanceHistory()
    for (let i = 0; i < 1600; i++) h.sample(metrics(i % 8 === 0 ? 30 : 16), true, exhausted)
    expect(h.history.at(-1)!.frameMs).toBeLessThan(1000 / 48)
    expect(h.recommendation).toMatchObject({ level: 4, targetLevel: 3 })
  })
  it('leaves Auto-off levels and resolution untouched', () => {
    const g = new QualityGovernor({ level: 4, auto: false, devicePixelRatio: 2 })
    for (let t = 0; t < 120000; t += 50) expect(g.sample(50)).toBeNull()
    expect(g.level).toBe(4); expect(g.rung).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { GlassFrameBudget, glassBlurBudgetMs } from '../../src/fx/post/glassFrameBudget'
import { allowsDriveFrost, qualityFrame, qualityLevel, setQualityChoice } from '../../src/ui/quality/ladder'

function drive() {
  const budget = new GlassFrameBudget()
  let now = 0
  budget.enter()
  budget.sample(now)
  function frames(count: number, interval: number) {
    for (let i = 0; i < count; i++) {
      now += interval
      budget.sample(now)
    }
  }
  function uneven(count: number, cost?: number) {
    for (let i = 0; i < count; i++) {
      now += i % 2 ? 50 : 20
      budget.sample(now, cost ?? null, Math.floor(now / 600) * 600)
    }
  }
  return { budget, frames, uneven }
}

describe('drive glass', () => {
  it('starts enabled after a slow automatic lobby while respecting an explicit reduced setting', () => {
    // Improving each slow window also exercises the lobby ladder's rollback check.
    let lobbyTime = 0
    qualityFrame(lobbyTime)
    for (let i = 0; i < 47; i++) qualityFrame(lobbyTime += 90)
    for (let i = 0; i < 20; i++) qualityFrame(lobbyTime += 75)
    expect(qualityLevel()).toBeGreaterThanOrEqual(2)
    expect(allowsDriveFrost()).toBe(true)
    const { budget, frames } = drive()
    frames(60, 50)
    expect(budget.enabled).toBe(true)
    try {
      setQualityChoice('reduced')
      expect(allowsDriveFrost()).toBe(false)
    } finally { setQualityChoice('auto') }
  })

  it('discards evidence across a cover or a long frame gap', () => {
    const { budget, frames, uneven } = drive()
    uneven(100)
    budget.interrupt()
    uneven(100)
    frames(1, 251)
    uneven(100)
    expect(budget.enabled).toBe(true)
  })

  it('leaves steady 30 and 40 fps alone without timestamps', () => {
    const { budget, frames } = drive()
    frames(1000, 1000 / 30)
    frames(1000, 25)
    expect(budget.enabled).toBe(true)
    expect(budget.reason).toBe('drive started')
  })

  it('restores an ineffective trial after the minimum dwell and retires that cause for the drive', () => {
    const { budget, uneven } = drive()
    for (let i = 0; i < 100 && budget.enabled; i++) uneven(2)
    expect(budget.reason).toContain('uneven frames')
    uneven(142) // 4.97 seconds after the switch
    expect(budget.enabled).toBe(false)
    uneven(2)
    expect(budget.enabled).toBe(true)
    expect(budget.reason).toContain('under 8% gain')
    uneven(500)
    expect(budget.enabled).toBe(true)
    budget.enter()
    uneven(200)
    expect(budget.enabled).toBe(false)
  })

  it('uses distinct GPU measurements and keeps a useful shed until frame time recovers', () => {
    const { budget, frames, uneven } = drive()
    uneven(200, .4)
    expect(budget.enabled).toBe(true)
    for (let i = 0; i < 140 && budget.enabled; i++) uneven(2, glassBlurBudgetMs + 1)
    expect(budget.reason).toContain('glass GPU')
    expect(budget.enabled).toBe(false)
    frames(400, 26)
    expect(budget.reason).toContain('remains shed')
    frames(450, 16)
    expect(budget.enabled).toBe(true)
  })

  it('discards before and after comparisons interrupted by a veil', () => {
    const { budget, uneven } = drive()
    uneven(126)
    expect(budget.enabled).toBe(false)
    budget.interrupt()
    uneven(220)
    expect(budget.enabled).toBe(true)
    expect(budget.reason).toContain('interrupted')
  })
})

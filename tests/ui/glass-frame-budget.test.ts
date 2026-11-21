import { describe, expect, it } from 'vitest'
import { GlassFrameBudget } from '../../src/fx/post/glassFrameBudget'
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
  return { budget, frames }
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
    const { budget, frames } = drive()
    frames(75, 50)
    budget.interrupt()
    frames(76, 50)
    frames(1, 251)
    frames(75, 50)
    expect(budget.enabled).toBe(true)
  })

  it('sheds on sustained slow frames and recovers with hysteresis', () => {
    const { budget, frames } = drive()
    frames(80, 50)
    expect(budget.enabled).toBe(false)
    expect(budget.reason).toContain('100%')
    frames(249, 20)
    expect(budget.enabled).toBe(false)
    frames(1, 20)
    expect(budget.enabled).toBe(true)
    frames(99, 50)
    expect(budget.enabled).toBe(true)
    frames(1, 50)
    expect(budget.enabled).toBe(false)
    budget.enter()
    expect(budget.enabled).toBe(true)
  })
})

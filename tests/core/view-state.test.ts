import { describe, expect, it } from 'vitest'
import { viewState } from '../../src/core/renderOptions'
import { QualityGovernor } from '../../src/core/quality'

const shell = (...names: string[]) => ({ contains: (name: string) => names.includes(name) })

describe('view state from the shell', () => {
  it('judges and draws only what the player can see', () => {
    expect(viewState(null)).toBe('playing')
    expect(viewState(shell('is-playing', 'is-galaxy'))).toBe('playing')
    // The plain lobby shows the world behind it.
    expect(viewState(shell())).toBe('lobby')
    // The galaxy hides it, except while descending into it.
    expect(viewState(shell('is-galaxy'))).toBe('covered')
    expect(viewState(shell('is-galaxy', 'is-descending'))).toBe('lobby')
  })
})

describe('governor in the lobby', () => {
  it('never steps down on frames it is told not to judge, however slow', () => {
    const judged = new QualityGovernor({ level: 2 }), spared = new QualityGovernor({ level: 2 })
    let judgedChanges = 0, sparedChanges = 0
    // A minute of 12 fps: the galaxy over the world on a middling device.
    for (let i = 0; i < 720; i++) {
      if (judged.sample(83, true)) judgedChanges++
      if (spared.sample(83, false)) sparedChanges++
    }
    expect(judgedChanges).toBeGreaterThan(0)
    expect(sparedChanges).toBe(0); expect(spared.level).toBe(2); expect(spared.rung).toBe(0)
  })
})

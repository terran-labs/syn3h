import { describe, expect, it } from 'vitest'
import { BotPacer, PACING, type PacingState } from '../../src/bots/pacing'

/**
 * Drive a pacer frame by frame. `frame(have)` gives each frame's duration for the bots alive;
 * bots appear on 'add' and go on 'remove', as BotManager does. Returns every action's time.
 */
function run(pacer: BotPacer, seconds: number, state: Omit<PacingState, 'have'>, frame: (have: number) => number, start = 0) {
  let now = start, have = 0
  const actions: { at: number; action: 'add' | 'remove'; have: number }[] = []
  while (now < start + seconds * 1000) {
    const ms = frame(have)
    now += ms
    const action = pacer.step(now, ms, { ...state, have })
    if (action === 'add') have++
    if (action === 'remove') have--
    if (action) actions.push({ at: now, action, have })
  }
  return { actions, have }
}

const desktop = { wanted: 8, targetMs: 1000 / 60, level: 4, open: true }

describe('bot pacing', () => {
  it('never adds bots faster than the interval, and never two in one frame', () => {
    const interval = 1.5
    const pacer = new BotPacer(() => interval)
    const { actions, have } = run(pacer, 60, desktop, () => 1000 / 120)
    expect(have).toBe(8)
    const adds = actions.filter(a => a.action === 'add')
    expect(adds).toHaveLength(8)
    // The first comes an interval after the player can drive, not in the landing frame.
    expect(adds[0].at).toBeGreaterThanOrEqual(interval * 1000)
    for (let i = 1; i < adds.length; i++) expect(adds[i].at - adds[i - 1].at).toBeGreaterThanOrEqual(interval * 1000)
  })

  it('adds nothing while closed (entering a world, in the menus)', () => {
    const pacer = new BotPacer(() => 1)
    const { actions } = run(pacer, 20, { ...desktop, open: false }, () => 1000 / 60)
    expect(actions).toHaveLength(0)
  })

  it('stops adding when the measured frame rate drops under the target, and sends the last one away', () => {
    const pacer = new BotPacer(() => 1)
    // Each bot costs 3 ms: the sixth pushes a 60 fps target (16.7 ms) past its 25 percent slack.
    const { actions, have } = run(pacer, 60, desktop, n => 6 + n * 3)
    const over = Math.min(...[1, 2, 3, 4, 5, 6, 7, 8].filter(n => 6 + n * 3 > desktop.targetMs * PACING.slowFactor))
    expect(have).toBe(over - 1)
    expect(actions.at(-1)?.action).toBe('remove')
    expect(pacer.comfort.get(desktop.level)).toBe(over - 1)
    // And it does not try again at this level: no adds after that removal.
    const removal = actions.findIndex(a => a.action === 'remove')
    expect(actions.slice(removal + 1).filter(a => a.action === 'add')).toHaveLength(0)
  })

  it('never carries more than the host asked for', () => {
    const pacer = new BotPacer(() => 1)
    const { have } = run(pacer, 30, { ...desktop, wanted: 3 }, () => 1000 / 120)
    expect(have).toBe(3)
    expect(pacer.climb(3, 3)).toBe(false)
  })

  it('gives the governor one bot at a time, and takes headroom back one at a time', () => {
    const pacer = new BotPacer(() => 1)
    run(pacer, 30, desktop, () => 1000 / 120)
    expect(pacer.shed(8)).toBe(true)
    expect(pacer.goal({ wanted: 8 })).toBe(7)
    expect(pacer.shed(0)).toBe(false)
    expect(pacer.climb(7, 8)).toBe(true)
    expect(pacer.goal({ wanted: 8 })).toBe(8)
  })
})

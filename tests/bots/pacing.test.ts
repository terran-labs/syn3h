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

  it('keeps a bot that did not make already slow frames worse', () => {
    const pacer = new BotPacer(() => 1)
    // 30 fps with or without bots, against a 60 fps target: the level is too rich, not the bots.
    const { have, actions } = run(pacer, 30, { ...desktop, wanted: 3 }, () => 33)
    expect(have).toBe(3)
    expect(actions.filter(a => a.action === 'remove')).toHaveLength(0)
  })

  it('keeps bots on a slow, jittery device whose frames they do not change', () => {
    // A loaded machine at about 16 fps against a 30 fps target: frames wander by up to +-30 ms
    // whatever the bots do. Noise is not a bot's cost (the two-player smoke at load 35).
    for (const seed of [1, 2, 3, 4, 5]) {
      let x = seed * 7919
      const jitter = () => { x = (x * 16807) % 2147483647; return (x / 2147483647 - 0.5) * 20 }
      const pacer = new BotPacer(() => 1.5)
      const { have, actions } = run(pacer, 120, { wanted: 4, targetMs: 1000 / 30, level: 1, open: true }, () => 62 + jitter() * (1 + (Math.floor(x / 1e8) % 3)))
      expect(actions.filter(a => a.action === 'remove')).toHaveLength(0)
      expect(have).toBe(4)
    }
  })

  it('does not call bots costly for the governor until they were measured to cost frames', () => {
    // The governor sheds bots only when they cost frame time. Unmeasured, or on frames that
    // were already slow (where a difference is load noise), they cost nothing it can shed.
    const pacer = new BotPacer(() => 1)
    expect(pacer.costly(1, 1000 / 60)).toBe(false)
    run(pacer, 30, { ...desktop, wanted: 3 }, () => 40 + Math.random() * 40)
    expect(pacer.costly(3, 1000 / 60)).toBe(false)
    const measured = new BotPacer(() => 1)
    run(measured, 60, desktop, n => 6 + n * 3)
    expect(measured.costly(3, 1000 / 60)).toBe(true)
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

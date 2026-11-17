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
/**
 * What one bot must add to the frame to count as a real cost under the pacer's own settings,
 * with room to spare: derived from PACING, so retuning moves this with it. On frames under the
 * slow threshold, where judging happens.
 */
const clearCost = (targetMs: number) => 2 * Math.max(PACING.minCostMs, targetMs * PACING.costShare, targetMs * PACING.slowFactor * PACING.baselineShare)
/** Frames that start well inside the target and grow by a clear cost per bot. */
const costlyBots = (targetMs: number) => (n: number) => targetMs * 0.35 + n * clearCost(targetMs)

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

  it('adds nothing while closed (a descent into a world or an ascent out of one)', () => {
    const pacer = new BotPacer(() => 1)
    const { actions } = run(pacer, 20, { ...desktop, open: false }, () => 1000 / 60)
    expect(actions).toHaveLength(0)
  })

  it('stops adding when a bot pushes frames over the target, and sends that one away', () => {
    const pacer = new BotPacer(() => 1)
    const frame = costlyBots(desktop.targetMs)
    const { actions, have } = run(pacer, 60, desktop, frame)
    const over = Math.min(...[1, 2, 3, 4, 5, 6, 7, 8].filter(n => frame(n) > desktop.targetMs * PACING.slowFactor))
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

  it('does not call bots costly for the governor until they were measured to cost frames', () => {
    // The governor sheds bots only when they cost frame time. Unmeasured, or on frames that
    // were already slow (where a difference is load noise), they cost nothing it can shed.
    const pacer = new BotPacer(() => 1)
    expect(pacer.costly(1, 1000 / 60)).toBe(false)
    run(pacer, 30, { ...desktop, wanted: 3 }, () => 40 + Math.random() * 40)
    expect(pacer.costly(3, 1000 / 60)).toBe(false)
    const measured = new BotPacer(() => 1)
    run(measured, 60, desktop, costlyBots(desktop.targetMs))
    expect(measured.costly(3, 1000 / 60)).toBe(true)
  })

  it('lets bots in while the host is in the lobby or a menu, unjudged, up to the count', () => {
    // A room's bots must not depend on its host looking at the game. There are no frames
    // played to judge by, so terrible frames send nobody away and leave nothing measured.
    const pacer = new BotPacer(() => 1)
    const { actions, have } = run(pacer, 30, { ...desktop, wanted: 5, judge: false }, () => 400)
    expect(have).toBe(5)
    expect(actions.filter(a => a.action === 'remove')).toHaveLength(0)
    const adds = actions.filter(a => a.action === 'add')
    for (let i = 1; i < adds.length; i++) expect(adds[i].at - adds[i - 1].at).toBeGreaterThanOrEqual(1000)
    expect(pacer.marginal.size).toBe(0)
  })

  it('judges again once the host plays', () => {
    const pacer = new BotPacer(() => 1)
    const frame = costlyBots(desktop.targetMs)
    const idle = run(pacer, 2.5, { ...desktop, judge: false }, frame)
    expect(idle.have).toBeGreaterThan(0)
    // Playing from here: arrivals are measured, and the one that crosses the target leaves.
    let now = 2500, have = idle.have
    const actions: string[] = []
    while (now < 62500) {
      const ms = frame(have); now += ms
      const action = pacer.step(now, ms, { ...desktop, have })
      if (action === 'add') have++
      if (action === 'remove') have--
      if (action) actions.push(action)
    }
    expect(actions).toContain('remove')
    expect(frame(have) <= desktop.targetMs * PACING.slowFactor).toBe(true)
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

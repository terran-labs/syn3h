import { describe, expect, it } from 'vitest'
import { autoQuality, buildLadder, GOVERNOR, LEVELS, QualityGovernor, RUNG_TIMING, type GovernorChange, type QualityLevel, type RungSettings } from '../../src/core/quality'

const VSYNC = 1000 / 60
/** Frame interval for a scene: the display floor, or the render cost when it is slower. */
type Trace = (settings: RungSettings, level: QualityLevel, t: number) => number
interface Logged extends GovernorChange { t: number }
/** Run the governor for `ms` of simulated time. */
function run(g: QualityGovernor, ms: number, trace: Trace, visible: (t: number) => boolean = () => true, start = 0) {
  const log: Logged[] = []
  let t = start
  while (t < start + ms) {
    const frame = trace(g.settings, g.level, t)
    t += frame
    const change = g.sample(frame, visible(t))
    if (change) log.push({ ...change, t })
  }
  return { log, t }
}
/** Deterministic noise for the hover trace. */
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 } }
const kinds = (log: Logged[]) => log.map(c => c.reason === 'shed' ? c.settings.kind : c.reason)

const ALL = [0, 1, 2, 3, 4, 5] as QualityLevel[]
describe('quality ladder', () => {
  it('sheds only what creates no pipeline: the post budget, then resolution twice', () => {
    expect(buildLadder(4, 2).map(r => r.kind)).toEqual(['base', 'resolution', 'resolution'])
    expect(buildLadder(4, 2).map(r => r.pixelRatio)).toEqual([1.5, 1.27, 1.05])
    expect(buildLadder(4, 2, true).map(r => r.kind)).toEqual(['base', 'post', 'resolution', 'resolution'])
    expect(buildLadder(4, 2, true).map(r => r.post)).toEqual([1, 0, 0, 0])
    // The display bounds the ratio: on a display of ratio 1 every level starts at 1.
    expect(buildLadder(5, 1).map(r => r.pixelRatio)).toEqual([1, 0.85, 0.7])
  })
  it('starts every level at its full budget', () => {
    for (const level of ALL) {
      const top = buildLadder(level, 3)[0]
      expect(top).toMatchObject({ kind: 'base', pixelRatio: LEVELS[level].pixelRatio, particles: LEVELS[level].particles, shadows: LEVELS[level].shadows, vehicleShading: LEVELS[level].shading })
    }
  })
  it('never makes a rung richer than the one above it, and no level poorer than the one below', () => {
    for (const level of ALL) {
      const ladder = buildLadder(level, 3, true)
      for (let i = 1; i < ladder.length; i++) { expect(ladder[i].pixelRatio).toBeLessThanOrEqual(ladder[i - 1].pixelRatio); expect(ladder[i].post).toBeLessThanOrEqual(ladder[i - 1].post) }
    }
    for (const level of ALL.slice(1)) for (const key of ['pixelRatio', 'shadows', 'shading', 'particles', 'bots', 'drawDistance', 'detail', 'targetFps', 'effectsRate'] as const)
      expect(LEVELS[level][key], `${key} at ${level}`).toBeGreaterThanOrEqual(LEVELS[level - 1][key])
  })
})

describe('quality governor', () => {
  it('sheds rungs in ladder order, then gives up levels until the frame rate holds', () => {
    const g = new QualityGovernor({ level: 4, devicePixelRatio: 2 })
    // 40 ms frames miss every 60 fps level but meet the 30 fps target of Low.
    const { log } = run(g, 120000, () => 40)
    expect(kinds(log)).toEqual(['resolution', 'resolution', 'level-drop', 'level-drop', 'resolution', 'level-drop'])
    // Warmup, then two slow one-second windows: the first rung moves within about seven seconds.
    expect(log[0].t).toBeGreaterThan(GOVERNOR.warmupMs); expect(log[0].t).toBeLessThan(8000)
    // Giving up a level needs longer evidence than a resolution rung.
    expect(log[2].t - log[1].t).toBeGreaterThanOrEqual(RUNG_TIMING.level.shedMs + GOVERNOR.settleMs - 100)
    expect(log[1].t - log[0].t).toBeLessThan(log[2].t - log[1].t)
    expect(g.level).toBe(1)
    // A drop never restores resolution that was already shed.
    for (let i = 1; i < log.length; i++) expect(log[i].settings.pixelRatio).toBeLessThanOrEqual(log[i - 1].settings.pixelRatio)
  })
  it('sheds nothing for single hitches, a hidden tab or absurd frame times', () => {
    const g = new QualityGovernor({ level: 4, ceiling: 4, devicePixelRatio: 2 })
    // One 400 ms hitch every three seconds, at 60 fps otherwise.
    let next = 3000
    const hitches = run(g, 60000, (_s, _l, t) => { if (t > next) { next += 3000; return 400 } return VSYNC })
    expect(hitches.log).toEqual([])
    // A hidden tab at 10 fps, then a tab that comes back fine.
    const hidden = run(g, 60000, () => 100, () => false, hitches.t)
    expect(hidden.log).toEqual([])
    for (let i = 0; i < 100; i++) expect(g.sample(i % 2 ? 5000 : NaN)).toBeNull()
    expect(g.sample(-1)).toBeNull()
    expect(run(g, 30000, () => VSYNC, () => true, hidden.t).log).toEqual([])
    expect(g.rung).toBe(0); expect(g.level).toBe(4)
  })
  it('climbs back rung by rung and level by level after sustained headroom', () => {
    const g = new QualityGovernor({ level: 4, ceiling: 4, devicePixelRatio: 2 })
    const heavy = run(g, 120000, () => 40)
    expect(g.level).toBe(1)
    const light = run(g, 900000, () => VSYNC, () => true, heavy.t)
    expect(light.log.length).toBeGreaterThan(0)
    expect(light.log.every(c => c.reason === 'climb' || c.reason === 'level-climb')).toBe(true)
    expect(g.level).toBe(4); expect(g.rung).toBe(0)
    // After a shed the waits are the full ones: a level climb needs its minute, then the grace period.
    const rise = light.log.findIndex(c => c.reason === 'level-climb')
    expect(light.log[rise].t - light.log[rise - 1].t).toBeGreaterThanOrEqual(RUNG_TIMING.level.climbMs + GOVERNOR.climbGraceMs - 1000)
  })
  it('does not oscillate when the scene hovers at the threshold', () => {
    // The full budget is just too slow; one resolution rung is just fast enough.
    const g = new QualityGovernor({ level: 4, devicePixelRatio: 2 })
    const { log } = run(g, 300000, s => s.pixelRatio > 1.3 ? 22 : 17)
    expect(log[0].reason).toBe('shed')
    // Climb waits double after each failed climb: 10, 20, 40, 80 and 160 seconds.
    expect(log.length).toBeLessThanOrEqual(11)
    const gaps = log.filter(c => c.reason === 'climb').map((c, i, a) => i ? c.t - a[i - 1].t : 0).slice(1)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1])
  })
  it('stays calm under noisy frames near the slow threshold', () => {
    const g = new QualityGovernor({ level: 4, devicePixelRatio: 2 })
    const random = rng(7)
    // About one frame in ten misses vsync, so the 90th percentile sits on the threshold.
    const { log } = run(g, 300000, () => random() < 0.1 ? 2 * VSYNC : VSYNC)
    expect(log.length).toBeLessThanOrEqual(12)
  })
  it('backs off exponentially after a climb that had to be undone, and relaxes after one that held', () => {
    const g = new QualityGovernor({ level: 4, ceiling: 4, devicePixelRatio: 2 })
    let pressure = true
    const trace: Trace = s => pressure && s.pixelRatio > 1.3 ? 22 : 17
    let r = run(g, 10000, trace)
    expect(g.rung).toBe(1); expect(g.climbWaitMs()).toBe(RUNG_TIMING.resolution.climbMs)
    r = run(g, 15000, trace, () => true, r.t)
    expect(r.log.map(c => c.reason)).toEqual(['climb', 'shed'])
    expect(g.climbWaitMs()).toBe(2 * RUNG_TIMING.resolution.climbMs)
    pressure = false
    r = run(g, 30000, trace, () => true, r.t)
    expect(r.log.map(c => c.reason)).toEqual(['climb'])
    run(g, GOVERNOR.probationMs + 1000, trace, () => true, r.t)
    expect(g.rung).toBe(0)
    // The climb held through probation, so the wait for that rung halves again.
    pressure = true; run(g, 10000, trace)
    expect(g.rung).toBe(1); expect(g.climbWaitMs()).toBe(RUNG_TIMING.resolution.climbMs)
  })
  it('never climbs above the capability or crash ceiling', () => {
    const g = new QualityGovernor({ level: 2, ceiling: 2, devicePixelRatio: 2 })
    expect(run(g, 600000, () => VSYNC / 2).log).toEqual([])
    expect(g.level).toBe(2); expect(g.pendingLevel).toBeNull()
  })
  it('keeps a hand-set level: eases inside it but never drops or raises it', () => {
    const g = new QualityGovernor({ level: 4, devicePixelRatio: 2 })
    expect(g.setManualLevel(3)).toMatchObject({ level: 3, rung: 0, reason: 'manual' })
    expect(run(g, 600000, () => VSYNC / 2).log).toEqual([])
    const slow = run(g, 120000, () => 200)
    expect(slow.log.every(c => c.level === 3 && c.reason === 'shed')).toBe(true)
    expect(g.rung).toBe(g.ladder.length - 1)
  })
  it('changes nothing with automation off and returns to the full budget when switched off', () => {
    expect(autoQuality.value).toBe(true)
    const off = new QualityGovernor({ level: 4, devicePixelRatio: 2, auto: false })
    expect(run(off, 300000, () => 200).log).toEqual([])
    expect(off.settings).toEqual(buildLadder(4, 2)[0]); expect(off.level).toBe(4)
    const on = new QualityGovernor({ level: 4, devicePixelRatio: 2 })
    run(on, 10000, () => 40)
    expect(on.rung).toBeGreaterThan(0)
    expect(on.setAuto(false)).toMatchObject({ level: 4, rung: 0, reason: 'auto-off' })
    expect(on.settings.pixelRatio).toBe(LEVELS[4].pixelRatio)
  })
  it('follows the display: a 30 fps capped display is not held to 60, a 120 Hz one is not held to 120', () => {
    const capped = new QualityGovernor({ level: 4, ceiling: 4, devicePixelRatio: 2 })
    // Idle loading frames arrive every 33 ms: the browser caps at 30 fps.
    for (let i = 0; i < 90; i++) capped.noteInterval(1000 / 30)
    expect(Math.round(1000 / capped.targetMs)).toBe(30)
    expect(run(capped, 120000, () => 1000 / 30).log).toEqual([])
    const fast = new QualityGovernor({ level: 4, ceiling: 4, devicePixelRatio: 2 })
    for (let i = 0; i < 240; i++) fast.noteInterval(1000 / 120)
    expect(fast.targetMs).toBeCloseTo(VSYNC)
    // 75 fps on a 120 Hz display beats the 60 fps target: no shedding.
    expect(run(fast, 120000, () => 1000 / 75).log).toEqual([])
    // On a faster display, headroom must be real before climbing: 45 fps sheds, and 58 fps is not headroom.
    const held = run(fast, 120000, s => s.pixelRatio > 1.3 ? 1000 / 45 : 1000 / 58)
    expect(held.log.map(c => c.reason)).toEqual(['shed'])
  })
  it('resets evidence when the display pixel ratio changes, keeping the post budget', () => {
    const g = new QualityGovernor({ level: 4, devicePixelRatio: 2 })
    g.setPostActive(true)
    run(g, 20000, () => 40)
    expect(g.settings.post).toBe(0)
    expect(g.setDevicePixelRatio(1)).toMatchObject({ reason: 'display' })
    expect(g.settings).toMatchObject({ pixelRatio: 1, post: 0 })
    expect(g.setDevicePixelRatio(1)).toBeNull()
  })
})

describe('finding a device its level', () => {
  it('takes a strong device from High to Cinematic by itself, quickly while nothing has been shed', () => {
    const g = new QualityGovernor({ level: 3, devicePixelRatio: 2 })
    const { log, t } = run(g, 180000, () => VSYNC)
    expect(g.level).toBe(5); expect(g.rung).toBe(0)
    expect(log.every(c => c.reason === 'climb' || c.reason === 'level-climb')).toBe(true)
    expect(g.calibrating).toBe(true)
    // Nothing above Cinematic: it stays put.
    expect(run(g, 120000, () => VSYNC, () => true, t).log).toEqual([])
    // The first level climb waited a quarter of the usual minute, then the grace period for a covered moment.
    expect(log[0].reason).toBe('level-climb')
    expect(log[0].t).toBeLessThan(GOVERNOR.warmupMs + RUNG_TIMING.level.climbMs * GOVERNOR.calibrationFactor + GOVERNOR.climbGraceMs + 3000)
  })
  it('holds a level climb as pending and takes it at a covered moment', () => {
    const g = new QualityGovernor({ level: 3, devicePixelRatio: 2 })
    g.canClimbVisible = () => false
    expect(g.applyPendingClimb()).toBeNull()
    const waited = run(g, GOVERNOR.warmupMs + RUNG_TIMING.level.climbMs * GOVERNOR.calibrationFactor + GOVERNOR.climbGraceMs + 2000, () => VSYNC)
    expect(waited.log).toEqual([]); expect(g.pendingLevel).toBe(4); expect(g.level).toBe(3)
    expect(g.applyPendingClimb()).toMatchObject({ level: 4, reason: 'level-climb' })
    expect(g.pendingLevel).toBeNull()
    // It enters the new level at its most eased rung and earns the rest.
    expect(g.rung).toBe(g.ladder.length - 1)
  })
  it('drops a pending climb when headroom breaks, and never holds one for a hand-set level', () => {
    const g = new QualityGovernor({ level: 3, devicePixelRatio: 2 })
    const r = run(g, GOVERNOR.warmupMs + RUNG_TIMING.level.climbMs * GOVERNOR.calibrationFactor + 2000, () => VSYNC)
    expect(g.pendingLevel).toBe(4)
    run(g, 2500, () => 20, () => true, r.t)
    expect(g.pendingLevel).toBeNull(); expect(g.level).toBe(3)
    const pinned = new QualityGovernor({ level: 3, devicePixelRatio: 2, levelPinned: true })
    run(pinned, 120000, () => VSYNC)
    expect(pinned.pendingLevel).toBeNull(); expect(pinned.level).toBe(3)
  })
  it('holds a weak device at the level it can carry, trying the next one ever more rarely', () => {
    // Medium holds 60 fps; anything above runs at 33.
    const g = new QualityGovernor({ level: 3, devicePixelRatio: 2 })
    const { log } = run(g, 1800000, (_s, level) => level >= 3 ? 30 : VSYNC)
    const climbs = log.filter(c => c.reason === 'level-climb')
    expect(log.find(c => c.reason === 'level-drop')!.level).toBe(2)
    expect(climbs.length).toBeGreaterThan(0); expect(climbs.length).toBeLessThanOrEqual(5)
    expect(Math.max(...log.map(c => c.level))).toBe(3)
    const gaps = climbs.map((c, i, a) => i ? c.t - a[i - 1].t : 0).slice(1)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1])
  })
})

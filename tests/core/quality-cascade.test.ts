import { describe, expect, it } from 'vitest'
import { autoQuality, buildLadder, GOVERNOR, QUALITY, QualityGovernor, RUNG_TIMING, SHADING_CAP, type GovernorChange, type GraphicsLevel, type RungSettings } from '../../src/core/quality'

const VSYNC = 1000 / 60
/** Frame interval for a scene: the display floor, or the render cost when it is slower. */
type Trace = (settings: RungSettings, level: GraphicsLevel, t: number) => number
/**
 * Synthetic render cost: fill scales with pixel count, then shading, particles, shadows and
 * the level's bots and draw distance. `load` scales the whole scene.
 */
const cost = (load: number): Trace => (s, level) => Math.max(VSYNC, load * (4 + 6 * s.pixelRatio ** 2 + 0.8 * s.vehicleShading + s.particles / 800 + 3 * s.shadows + 2 * level))
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

describe('quality ladder', () => {
  it('declares the desktop rungs in shedding order and skips rungs a display cannot show', () => {
    expect(buildLadder(2, 2).map(r => r.kind)).toEqual(['base', 'resolution', 'resolution', 'shading', 'particles', 'shadows'])
    expect(buildLadder(2, 2).map(r => r.pixelRatio)).toEqual([1.5, 1.25, 1, 1, 1, 1])
    // On a display of ratio 1, 1.5 and 1.25 both mean 1, so those rungs would buy nothing.
    expect(buildLadder(2, 1).map(r => r.kind)).toEqual(['base', 'shading', 'particles', 'shadows'])
    // Mobile is capped at plain shading until it is timed on a device, so its shading rung has nothing to shed.
    expect(buildLadder(1, 3).map(r => r.kind)).toEqual(['base', 'resolution', 'particles'])
    // A hand-set tier brings the rung back: it is the pin that the rung would otherwise lower.
    expect(SHADING_CAP[1]).toBe(0)
  })
  it('starts every level at its fixed budget with the level shading cap', () => {
    for (const level of [0, 1, 2] as GraphicsLevel[]) {
      const top = buildLadder(level, 3)[0]
      expect(top).toMatchObject({ pixelRatio: QUALITY[level].pixelRatio, particles: QUALITY[level].particles, shadows: QUALITY[level].shadows, vehicleShading: SHADING_CAP[level] })
    }
  })
  it('never makes a rung richer than the one above it, inside or across levels', () => {
    const notRicher = (b: RungSettings, a: RungSettings, checkResolution = true) => {
      expect(b.vehicleShading).toBeLessThanOrEqual(a.vehicleShading); expect(b.particles).toBeLessThanOrEqual(a.particles); expect(b.shadows).toBeLessThanOrEqual(a.shadows)
      if (checkResolution) expect(b.pixelRatio).toBeLessThanOrEqual(a.pixelRatio)
    }
    for (const level of [0, 1, 2] as GraphicsLevel[]) {
      const ladder = buildLadder(level, 3)
      for (let i = 1; i < ladder.length; i++) notRicher(ladder[i], ladder[i - 1])
    }
    notRicher(buildLadder(1, 3)[0], buildLadder(2, 3).at(-1)!)
    // Safe's fixed budget keeps pixel ratio 1, above mobile's 0.85 floor; the level drop maps around it.
    notRicher(buildLadder(0, 3)[0], buildLadder(1, 3).at(-1)!, false)
  })
  it('lets a hand-set shading value stand, even above the level cap', () => {
    const ladder = buildLadder(1, 3, 3)
    expect(ladder.every(r => r.vehicleShading === 3)).toBe(true)
    expect(ladder.map(r => r.kind)).toEqual(['base', 'resolution', 'particles'])
  })
})

describe('quality governor', () => {
  it('sheds rungs in ladder order, then drops the level and starts its ladder again', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    // 40 ms frames miss the desktop target but meet mobile's 30 fps target.
    const { log } = run(g, 120000, () => 40)
    expect(kinds(log)).toEqual(['resolution', 'resolution', 'shading', 'particles', 'shadows', 'level-drop'])
    // Warmup, then two slow one-second windows: the first rung moves within about seven seconds.
    expect(log[0].t).toBeGreaterThan(GOVERNOR.warmupMs); expect(log[0].t).toBeLessThan(8000)
    // Material and shadow rungs need longer evidence than resolution.
    expect(log[2].settings.kind).toBe('shading')
    expect(log[2].t - log[1].t).toBeGreaterThanOrEqual(RUNG_TIMING.shading.shedMs + GOVERNOR.settleMs - 100)
    expect(log[1].t - log[0].t).toBeLessThan(log[2].t - log[1].t)
    expect(log.at(-1)).toMatchObject({ level: 1, rung: 0 })
    expect(g.settings).toEqual(buildLadder(1, 2)[0])
  })
  it('maps a drop into safe onto the rung that keeps the reduced resolution', () => {
    const g = new QualityGovernor({ level: 1, devicePixelRatio: 3 })
    const { log } = run(g, 120000, () => 80)
    const drop = log.find(c => c.reason === 'level-drop')!
    expect(drop.level).toBe(0)
    expect(drop.settings.pixelRatio).toBe(0.85)
    expect(drop.settings.pixelRatio).toBeLessThanOrEqual(buildLadder(1, 3).at(-1)!.pixelRatio)
  })
  it('sheds nothing for single hitches, a hidden tab or absurd frame times', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
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
    expect(g.rung).toBe(0); expect(g.level).toBe(2)
  })
  it('climbs back rung by rung after sustained headroom, up to the full level', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    const heavy = run(g, 60000, cost(2.2))
    expect(g.level).toBe(1)
    const light = run(g, 600000, cost(0.5), () => true, heavy.t)
    expect(light.log.length).toBeGreaterThan(0)
    expect(light.log.every(c => c.reason === 'climb' || c.reason === 'level-climb')).toBe(true)
    expect(g.level).toBe(2); expect(g.rung).toBe(0)
    // Each climb waited at least its rung's base time of headroom.
    const first = light.log[0]
    expect(first.t - heavy.t).toBeGreaterThanOrEqual(RUNG_TIMING.level.climbMs)
  })
  it('does not oscillate when the scene hovers at the threshold', () => {
    // Full desktop budget is just too slow; one resolution rung is just fast enough.
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    const { log } = run(g, 300000, s => s.pixelRatio > 1.3 ? 22 : 17)
    expect(log[0].reason).toBe('shed')
    // Climb waits double after each failed climb: 10, 20, 40, 80 and 160 seconds.
    expect(log.length).toBeLessThanOrEqual(11)
    const gaps = log.filter(c => c.reason === 'climb').map((c, i, a) => i ? c.t - a[i - 1].t : 0).slice(1)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1])
  })
  it('stays calm under noisy frames near the slow threshold', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    const random = rng(7)
    // About one frame in ten misses vsync, so the 90th percentile sits on the threshold.
    const { log } = run(g, 300000, () => random() < 0.1 ? 2 * VSYNC : VSYNC)
    expect(log.length).toBeLessThanOrEqual(12)
  })
  it('backs off exponentially after a climb that had to be undone, and relaxes after one that held', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
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
  it('never climbs above the detected or crash ceiling', () => {
    const g = new QualityGovernor({ level: 1, ceiling: 1, devicePixelRatio: 2 })
    expect(run(g, 600000, () => VSYNC / 2).log).toEqual([])
    expect(g.level).toBe(1)
  })
  it('keeps a hand-set level: sheds inside it but never drops or raises it', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    expect(g.setManualLevel(1)).toMatchObject({ level: 1, rung: 0, reason: 'manual' })
    expect(run(g, 600000, () => VSYNC / 2).log).toEqual([])
    const slow = run(g, 120000, () => 200)
    expect(slow.log.every(c => c.level === 1 && c.reason === 'shed')).toBe(true)
    expect(g.rung).toBe(g.ladder.length - 1)
  })
  it('respects a hand-set shading value without moving the other rungs', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    run(g, 11000, () => 40)
    expect(g.settings.pixelRatio).toBe(1)
    g.setShadingPin(3)
    expect(g.settings).toMatchObject({ pixelRatio: 1, vehicleShading: 3 })
    run(g, 120000, () => 40)
    expect(g.settings.vehicleShading).toBe(3)
  })
  it('changes nothing with automation off and returns to the fixed budget when switched off', () => {
    expect(autoQuality.value).toBe(true)
    const off = new QualityGovernor({ level: 2, devicePixelRatio: 2, auto: false })
    expect(run(off, 300000, () => 200).log).toEqual([])
    expect(off.settings).toEqual(buildLadder(2, 2)[0]); expect(off.level).toBe(2)
    const on = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    run(on, 20000, () => 40)
    expect(on.rung).toBeGreaterThan(0)
    expect(on.setAuto(false)).toMatchObject({ level: 2, rung: 0, reason: 'auto-off' })
    expect(on.settings.pixelRatio).toBe(QUALITY[2].pixelRatio)
  })
  it('follows the display: a 30 fps capped display is not held to 60, a 120 Hz one is not held to 120', () => {
    const capped = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    // Idle loading frames arrive every 33 ms: the browser caps at 30 fps.
    for (let i = 0; i < 90; i++) capped.noteInterval(1000 / 30)
    expect(Math.round(1000 / capped.targetMs)).toBe(30)
    expect(run(capped, 120000, () => 1000 / 30).log).toEqual([])
    const fast = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    for (let i = 0; i < 240; i++) fast.noteInterval(1000 / 120)
    expect(fast.targetMs).toBeCloseTo(VSYNC)
    // 75 fps on a 120 Hz display beats the 60 fps target: no shedding.
    expect(run(fast, 120000, () => 1000 / 75).log).toEqual([])
    // On a faster display, headroom must be real before climbing: 45 fps sheds, and 58 fps is not headroom.
    const held = run(fast, 120000, s => s.pixelRatio > 1.3 ? 1000 / 45 : 1000 / 58)
    expect(held.log.map(c => c.reason)).toEqual(['shed'])
  })
  it('resets evidence when the display pixel ratio changes, keeping the other rung values', () => {
    const g = new QualityGovernor({ level: 2, devicePixelRatio: 2 })
    run(g, 20000, () => 40)
    const before = g.settings
    expect(g.setDevicePixelRatio(1)).toMatchObject({ reason: 'display' })
    expect(g.settings).toMatchObject({ pixelRatio: 1, vehicleShading: before.vehicleShading, particles: before.particles, shadows: before.shadows })
    expect(g.setDevicePixelRatio(1)).toBeNull()
  })
})

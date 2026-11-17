/**
 * The player's render resolution. Bugs these catch: drawing more pixels than the player chose
 * or than the display has, Auto changing what every existing player gets, and the choice
 * being forgotten on the next visit.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { params } from '../../shared/params'
import { LEVELS, QualityController, QualityGovernor, RENDER_RESOLUTION, RESOLUTION_KEY, RESOLUTION_STEPS, buildLadder, renderResolution, type QualityLevel } from '../../src/core/quality'

const LEVEL_LIST = [0, 1, 2, 3, 4, 5] as QualityLevel[]
const DPRS = [0.75, 1, 1.25, 1.5, 2, 3]
const CHOICES: number[] = []
for (let r = RENDER_RESOLUTION.min; r <= RENDER_RESOLUTION.max + 1e-9; r += RENDER_RESOLUTION.step) CHOICES.push(Math.round(r * 100) / 100)

it('never draws above the player\'s choice or the display\'s own pixel ratio, on any rung', () => {
  for (const level of LEVEL_LIST) for (const dpr of DPRS) for (const post of [false, true]) for (const choice of CHOICES) {
    for (const rung of buildLadder(level, dpr, post, choice)) {
      expect(rung.pixelRatio, `${level} ${dpr} ${choice}`).toBeLessThanOrEqual(dpr * choice + 0.005)
      expect(rung.pixelRatio).toBeLessThanOrEqual(dpr + 0.005)
      expect(rung.pixelRatio).toBeGreaterThan(0)
    }
  }
})

it('keeps today\'s ladder exactly at Auto', () => {
  for (const level of LEVEL_LIST) for (const dpr of DPRS) for (const post of [false, true]) {
    const auto = buildLadder(level, dpr, post, null)
    expect(auto).toEqual(buildLadder(level, dpr, post))
    // Today's rule, written out: the level's budget capped by the display, then the resolution steps.
    const top = Math.min(dpr, LEVELS[level].pixelRatio)
    expect(auto[0].pixelRatio).toBe(top)
    const resolution = auto.filter(rung => rung.kind === 'resolution').map(rung => rung.pixelRatio)
    expect(resolution).toEqual(RESOLUTION_STEPS.map(step => Math.round(top * step * 100) / 100))
  }
})

it('lets the governor go below the choice when frames are slow, never above it', () => {
  const g = new QualityGovernor({ level: 3, devicePixelRatio: 2, auto: true, levelPinned: true, resolution: 0.75 })
  const seen: number[] = [g.settings.pixelRatio]
  for (let t = 0; t < 60_000; t += 40) { g.sample(40); seen.push(g.settings.pixelRatio) }
  expect(Math.max(...seen)).toBeLessThanOrEqual(1.5)
  expect(Math.min(...seen)).toBeLessThan(1.5)
  // Back to Auto: today's top rung for High on this display.
  g.setResolution(null)
  expect(g.settings.pixelRatio).toBeLessThanOrEqual(Math.min(2, LEVELS[3].pixelRatio))
})

it('accepts only 50% to 100% in steps, and treats anything else as Auto', () => {
  expect(renderResolution(0.75)).toBe(0.75); expect(renderResolution('0.6')).toBe(0.6)
  expect(renderResolution(0.2)).toBe(0.5); expect(renderResolution(4)).toBe(1); expect(renderResolution(0.73)).toBe(0.75)
  for (const junk of [null, undefined, '', 'auto', NaN, 0, -1, {}]) expect(renderResolution(junk)).toBeNull()
})

afterEach(() => { vi.unstubAllGlobals(); params.set('gfx.auto', true) })
it('remembers the choice on the device, and Auto forgets it', () => {
  const entries = new Map<string, string>()
  const local = { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => { entries.set(k, v) }, removeItem: (k: string) => { entries.delete(k) } }
  const boot = () => {
    vi.stubGlobal('window', { localStorage: local, sessionStorage: null, devicePixelRatio: 2, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal('navigator', { userAgent: 'anything', maxTouchPoints: 0 })
    vi.stubGlobal('location', { search: '' })
    return new QualityController()
  }
  const first = boot()
  first.setResolution(0.7)
  expect(entries.get(RESOLUTION_KEY)).toBe('0.7'); first.dispose()
  const second = boot()
  expect(second.getQualityState().resolution).toBe(0.7)
  expect(second.getQualityState().pixelRatio).toBeLessThanOrEqual(1.4)
  second.setResolution(null)
  expect(entries.has(RESOLUTION_KEY)).toBe(false); second.dispose()
  expect(boot().getQualityState().resolution).toBeNull()
})

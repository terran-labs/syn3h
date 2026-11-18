import { afterEach, describe, expect, it, vi } from 'vitest'
import { params } from '../../shared/params'
import '../../src/fx/params'
import '../../src/fx/post/params'
import { GOVERNOR, LEVELS, LEVEL_KEY, LOAD_KEY, MANUAL_KEY, PRESET_IDS, QualityController, RUNG_TIMING, STATE_KEY, graphicsLevel, loadSavedQuality, presetFor, qualityLevel, type QualityLevel, type QualityState } from '../../src/core/quality'

const VSYNC = 1000 / 60
type Store = { entries: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const store = (seed: Record<string, string> = {}): Store => {
  const entries = new Map(Object.entries(seed))
  return { entries, getItem: k => entries.get(k) ?? null, setItem: (k, v) => { entries.set(k, v) }, removeItem: k => { entries.delete(k) } }
}
const metrics = (frameMs: number, fresh = 0) => ({ frameMs, fps: 1000 / frameMs, physicsMs: 1, drawCalls: 100, triangles: 1000, firstFrameMs: 1, pipelinesLive: 10, pipelinesFresh: fresh })
interface Device { local?: Store; session?: Store; search?: string; memoryGB?: number; adapter?: 'available' | 'fallback' | 'none' }
/** A controller on a stubbed browser. `adapter` shapes what the WebGPU probe finds. */
async function boot(device: Device = {}) {
  const local = device.local ?? store(), session = device.session ?? store(), events: unknown[] = []
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session, devicePixelRatio: 2, addEventListener() {}, removeEventListener() {}, dispatchEvent: (e: { detail: unknown }) => { events.push(e.detail); return true } })
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  const gpu = device.adapter === 'none' ? undefined : { requestAdapter: async () => ({ isFallbackAdapter: device.adapter === 'fallback', limits: { maxTextureDimension2D: 16384 } }) }
  vi.stubGlobal('navigator', { userAgent: 'anything', maxTouchPoints: 5, deviceMemory: device.memoryGB, gpu })
  vi.stubGlobal('location', { search: device.search ?? '' })
  const c = new QualityController()
  await c.initialize()
  return { c, local, session, events }
}
/** Feed play frames for `ms` of simulated time. */
function play(c: QualityController, ms: number, frameMs = VSYNC, judge = true) { for (let t = 0; t < ms; t += frameMs) c.frame(metrics(frameMs), judge) }
afterEach(() => { vi.unstubAllGlobals(); params.set('gfx.auto', true); params.set('gfx.quality', 4); for (const id of PRESET_IDS) { const def = params.get(id)?.def; if (def) params.set(id, def.default) } })

describe('level presets', () => {
  it('names six levels and gives each a complete preset of the registered parameters', () => {
    expect(LEVELS.map(l => l.name)).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Cinematic'])
    const registered = PRESET_IDS.filter(id => params.get(id))
    expect(registered.length).toBeGreaterThan(10)
    for (const level of [0, 1, 2, 3, 4, 5] as QualityLevel[]) expect(Object.keys(presetFor(level)).sort()).toEqual([...registered].sort())
  })
  it('owns only local parameters, and uses nothing in its wording that names a device class', () => {
    for (const id of PRESET_IDS) { const def = params.get(id)?.def; if (def) expect(def.scope, id).toBe('client') }
    const wording = [...LEVELS.map(l => l.name), qualityLevel.def.label, graphicsLevel.def.label].join(' ')
    expect(wording).not.toMatch(/safe|mobile|desktop|tablet|phone|unmeasured/i)
  })
  it('turns finished features on by the level that can afford them, and never off again above it', () => {
    const at = (level: QualityLevel, id: string) => presetFor(level)[id]
    expect(at(0, 'post.on')).toBe(false); expect(at(1, 'post.on')).toBe(true)
    for (const level of [0, 1, 2, 3, 4, 5] as const) expect(at(level, 'post.shafts')).toBeGreaterThan(0)
    expect(at(3, 'post.bloom')).toBeGreaterThan(0); expect(at(2, 'post.bloom')).toBe(0)
    for (const id of ['post.ao', 'post.clouds', 'post.contact', 'post.flare', 'post.motionBlur']) { expect(at(3, id), id).toBe(0); expect(at(4, id), id).toBeGreaterThan(0) }
    expect(at(4, 'post.temporal')).toBe(true); expect(at(3, 'post.temporal')).toBe(false)
    // Indirect light is the heaviest by structure: Cinematic only.
    expect(at(4, 'post.gi')).toBe(0); expect(at(5, 'post.gi')).toBeGreaterThan(0)
    for (const id of PRESET_IDS.filter(id => params.get(id))) for (let level = 1; level <= 5; level++)
      expect(Number(at(level as QualityLevel, id)), `${id} at ${level}`).toBeGreaterThanOrEqual(Number(at((level - 1) as QualityLevel, id)))
  })
})

describe('choosing the starting level', () => {
  it('caps the actual WebGL renderer after an available GPU probe without raising crash caps', async () => {
    for (const gpu of [true, false]) {
      const { c } = await boot({ adapter: 'available' })
      c.attachRenderer({ backend: { isWebGPUBackend: gpu }, setPixelRatio() {} } as unknown as Parameters<QualityController['attachRenderer']>[0])
      expect(c.getQualityState()).toMatchObject({ level: gpu ? 3 : 2, ceiling: gpu ? 5 : 2 })
      c.dispose()
    }
    const { c } = await boot({ adapter: 'available', session: store({ [LOAD_KEY]: '2' }) })
    c.attachRenderer({ backend: { isWebGPUBackend: false }, setPixelRatio() {} } as unknown as Parameters<QualityController['attachRenderer']>[0])
    expect(c.getQualityState()).toMatchObject({ level: 1, ceiling: 1 })
    c.dispose()
  })

  it('starts every capable device at High on a first visit, whatever it says it is', async () => {
    const { c } = await boot({ adapter: 'available' })
    expect(c.getQualityState()).toMatchObject({ level: 3, name: 'High', ceiling: 5, pinned: false, auto: true })
    expect(qualityLevel.value).toBe(3); expect(graphicsLevel.value).toBe(2)
    c.dispose()
  })
  it('holds a software adapter and the WebGL path to Medium, starting lower', async () => {
    const soft = await boot({ adapter: 'fallback' })
    expect(soft.c.getQualityState()).toMatchObject({ level: 0, ceiling: 2 }); soft.c.dispose()
    const webgl = await boot({ adapter: 'none' })
    expect(webgl.c.getQualityState()).toMatchObject({ level: 2, ceiling: 2 }); webgl.c.dispose()
    const small = await boot({ adapter: 'available', memoryGB: 2 })
    expect(small.c.getQualityState()).toMatchObject({ level: 2, ceiling: 5 }); small.c.dispose()
  })
  it('starts the next visit where this one settled, with the fine-tuning', async () => {
    const first = await boot({ adapter: 'available' })
    first.c.setLevel(5); params.set('post.motionBlur', 0)
    first.c.dispose()
    const again = await boot({ adapter: 'available', local: first.local })
    expect(again.c.getQualityState()).toMatchObject({ level: 5, pinned: true, overrides: { 'post.motionBlur': 0 } })
    expect(params.get('post.motionBlur')!.value).toBe(0); expect(params.get('post.gi')!.value).toBeGreaterThan(0)
    again.c.dispose()
  })
  it('lets a strong device reach Cinematic by itself and saves it for the second visit', async () => {
    const first = await boot({ adapter: 'available' })
    // Four minutes of play at the display rate, opening a menu every half minute.
    for (let i = 0; i < 8; i++) { play(first.c, 30000); first.c.frame(metrics(VSYNC), false) }
    expect(first.c.getQualityState()).toMatchObject({ level: 5, rung: 0, easing: null, pinned: false })
    for (const id of ['post.clouds', 'post.ao', 'post.gi']) expect(params.get(id)!.value, id).toBeGreaterThan(0)
    expect(first.c.levelChanges.map(r => [r.from, r.to, r.by])).toEqual([[3, 4, 'governor'], [4, 5, 'governor']])
    first.c.dispose()
    const again = await boot({ adapter: 'available', local: first.local })
    expect(again.c.getQualityState().level).toBe(5); again.c.dispose()
  })
  it('carries over the settings of the three earlier tiers, then removes them', async () => {
    for (const [old, level] of [['0', 0], ['1', 2], ['2', 4]] as const) {
      const session = store({ [LEVEL_KEY]: old, [MANUAL_KEY]: '1' })
      const { c, local } = await boot({ adapter: 'available', session })
      expect(c.getQualityState()).toMatchObject({ level, pinned: true })
      play(c, 100)
      expect(session.entries.has(LEVEL_KEY)).toBe(false); expect(session.entries.has(MANUAL_KEY)).toBe(false)
      expect(JSON.parse(local.entries.get(STATE_KEY)!)).toMatchObject({ level, pinned: true })
      c.dispose()
    }
    expect(loadSavedQuality([store({ [LEVEL_KEY]: '2' })])).toEqual({ level: 4, auto: true, pinned: false, overrides: {} })
  })
  it('treats corrupt or foreign saved state as a first visit', async () => {
    for (const text of ['{', 'null', '{"level":"high"}', '[]']) expect(loadSavedQuality([store({ [STATE_KEY]: text })]), text).toBeNull()
    expect(loadSavedQuality([store({ [STATE_KEY]: '{"level":9,"overrides":{"post.gi":"x","world.seed":3,"post.bloom":0.2}}' })])).toEqual({ level: 5, auto: true, pinned: false, overrides: { 'post.bloom': 0.2 } })
    const { c } = await boot({ adapter: 'available', local: store({ [STATE_KEY]: '{' }) })
    expect(c.getQualityState().level).toBe(3); c.dispose()
  })
  it('starts a level lower after an unfinished load and will not climb back past it', async () => {
    const local = store({ [STATE_KEY]: JSON.stringify({ level: 5, auto: true, pinned: false, overrides: {} }) })
    const { c, session } = await boot({ adapter: 'available', local, session: store({ [LOAD_KEY]: '5' }) })
    expect(c.getQualityState()).toMatchObject({ level: 4, ceiling: 4 })
    expect(session.entries.get(LOAD_KEY)).toBe('4')
    play(c, 100); expect(session.entries.has(LOAD_KEY)).toBe(false)
    c.dispose()
  })
  it('takes a level from the address for one page load without saving it', async () => {
    const { c, local } = await boot({ adapter: 'available', search: '?gfx=1' })
    expect(c.getQualityState()).toMatchObject({ level: 1, pinned: true })
    expect(local.entries.has(STATE_KEY)).toBe(false)
    c.dispose()
  })
})

describe('levels, fine-tuning and the governor', () => {
  it('applies the whole preset when the player changes level, and steps stop at the ends', async () => {
    const { c } = await boot({ adapter: 'available' })
    c.setLevel(5)
    for (const [id, value] of Object.entries(presetFor(5))) expect(params.get(id)!.value, id).toBe(value)
    expect(c.getQualityState()).toMatchObject({ level: 5, pinned: true, postTier: 'full' })
    expect(c.stepUp()).toBe(false)
    for (let level = 4; level >= 0; level--) { expect(c.stepDown()).toBe(true); expect(params.get('lava.particleBudget')!.value).toBe(LEVELS[level].particles) }
    expect(c.stepDown()).toBe(false); expect(c.getQualityState()).toMatchObject({ level: 0, postTier: 'off' })
    // Every change the player made is on record, and choosing the same level again is not a change.
    expect(c.levelChanges.map(r => [r.from, r.to, r.by, r.covered])).toEqual([[3, 5, 'player', true], [5, 4, 'player', true], [4, 3, 'player', true], [3, 2, 'player', true], [2, 1, 'player', true], [1, 0, 'player', true]])
    params.set('post.on', true); c.setLevel(0)
    expect(c.levelChanges).toHaveLength(6); expect(params.get('post.on')!.value).toBe(false); expect(c.getQualityState().overrides).toEqual({})
    expect(params.get('post.on')!.value).toBe(false)
    c.dispose()
  })
  it('never writes a shared world parameter, at any level', async () => {
    const { c } = await boot({ adapter: 'available' })
    const before = JSON.stringify(params.snapshot('world'))
    for (const level of [0, 5, 2, 4, 1, 3]) c.setLevel(level)
    expect(JSON.stringify(params.snapshot('world'))).toBe(before)
    c.dispose()
  })
  it('keeps a hand-set value when the governor changes level, and clears it when the player does', async () => {
    const { c } = await boot({ adapter: 'available' })
    c.setLevel(4); c.setAuto(true)
    params.set('post.motionBlur', 0); params.set('lava.particleBudget', 480)
    expect(c.getQualityState().overrides).toEqual({ 'post.motionBlur': 0, 'lava.particleBudget': 480 })
    // The governor gives up a level under sustained slow frames.
    play(c, 60000, 40)
    expect(c.getQualityState().level).toBeLessThan(4)
    expect(c.levelChanges.at(-1)).toMatchObject({ by: 'governor' })
    expect(params.get('post.motionBlur')!.value).toBe(0); expect(params.get('lava.particleBudget')!.value).toBe(480)
    expect(params.get('post.ao')!.value).toBe(presetFor(c.getQualityState().level)['post.ao'])
    expect(Object.keys(c.getQualityState().overrides)).toHaveLength(2)
    // One value handed back to the level.
    c.clearOverride('lava.particleBudget')
    expect(params.get('lava.particleBudget')!.value).toBe(LEVELS[c.getQualityState().level].particles)
    // The player's own level change clears the rest.
    c.setLevel(4)
    expect(c.getQualityState().overrides).toEqual({})
    expect(params.get('post.motionBlur')!.value).toBe(presetFor(4)['post.motionBlur'])
    c.dispose()
  })
  it('returns the same state object until something changes, and announces each change once', async () => {
    const { c } = await boot({ adapter: 'available' })
    const seen: QualityState[] = []
    const stop = c.subscribeQuality(state => seen.push(state))
    expect(seen).toHaveLength(1); expect(c.getQualityState()).toBe(seen[0]); expect(Object.isFrozen(seen[0])).toBe(true)
    play(c, 3000)
    expect(c.getQualityState()).toBe(seen[0]); expect(seen).toHaveLength(1)
    c.setLevel(2); expect(seen).toHaveLength(2); expect(seen[1]).not.toBe(seen[0]); expect(seen[1].level).toBe(2)
    params.set('post.shafts', 0.2); expect(seen).toHaveLength(3); expect(seen[2].overrides).toEqual({ 'post.shafts': 0.2 })
    c.clearOverrides(); expect(seen.at(-1)!.overrides).toEqual({}); expect(params.get('post.shafts')!.value).toBe(presetFor(2)['post.shafts'])
    expect(seen.at(-1)!.presetIds).toBe(PRESET_IDS); expect(c.qualityLevels.map(l => l.name)).toEqual(LEVELS.map(l => l.name))
    stop(); c.setLevel(3); const n = seen.length; c.setLevel(1); expect(seen).toHaveLength(n)
    c.dispose()
  })
  it('says what it is easing inside a level', async () => {
    const { c } = await boot({ adapter: 'available' })
    c.setLevel(4); c.setPostActive(true)
    expect(c.getQualityState().easing).toBeNull()
    play(c, 13000, 40); expect(c.getQualityState()).toMatchObject({ level: 4, easing: 'post' })
    play(c, 6000, 40); expect(c.getQualityState()).toMatchObject({ level: 4, easing: 'resolution' })
    // A hand-set level is never left, however slow it gets.
    play(c, 60000, 40); expect(c.getQualityState().level).toBe(4)
    c.dispose()
  })
  it('takes a level climb at a covered moment and records what it built', async () => {
    const { c } = await boot({ adapter: 'available' })
    play(c, GOVERNOR.warmupMs + RUNG_TIMING.level.climbMs * GOVERNOR.calibrationFactor + 2500)
    expect(c.getQualityState().level).toBe(3); expect(c.governor.pendingLevel).toBe(4)
    c.frame(metrics(VSYNC), false)
    expect(c.getQualityState().level).toBe(4)
    c.frame(metrics(VSYNC, 7)); c.frame(metrics(VSYNC, 2))
    expect(c.levelChanges.at(-1)).toEqual({ from: 3, to: 4, by: 'governor', covered: true, pipelinesCreated: 9 })
    // Without a covered moment the climb is taken after the grace period, and says so.
    play(c, 120000)
    expect(c.getQualityState().level).toBe(5)
    expect(c.levelChanges.at(-1)).toMatchObject({ from: 4, to: 5, covered: false })
    c.dispose()
  })
  it('still answers code that sets the older three-step value', async () => {
    const { c } = await boot({ adapter: 'available' })
    params.set('gfx.level', 0)
    expect(c.getQualityState()).toMatchObject({ level: 0, pinned: true })
    params.set('gfx.level', 1); expect(c.getQualityState().level).toBe(2)
    c.dispose()
  })
})

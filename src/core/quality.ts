/** Local rendering quality. World parameters and physics resolution are never changed here. */
import { type AdapterProbe, gpuDeadlineMs, graphicsOverride, probeAdapter } from './renderOptions'
import { defineParam, params, type ParamValue } from '../../shared/params'
import { PerformanceHistory, RECOMMENDATION_IGNORE_KEY } from './performanceHistory'
import type { PerformanceBots, PerformanceEnvironment, PerformanceSnapshot } from './performance'
import type { WebGPURenderer } from 'three/webgpu'
/**
 * Six quality levels, one list for every device. A level is a complete preset: it sets every
 * local quality parameter, post effects and indirect light included. The player may fine-tune
 * any of them under a level; those overrides last until the player next changes level. The
 * automatic governor moves along the same six.
 */
export type QualityLevel = 0 | 1 | 2 | 3 | 4 | 5
/** Older name, kept for the modules that still import it. */
export type GraphicsLevel = QualityLevel
/** Which parts of the post chain a level may build. Strengths decide the individual effects. */
export type PostTier = 'off' | 'base' | 'lite' | 'full'
export const qualityLevel = defineParam({ id: 'gfx.quality', label: 'Quality level: 0 Minimal to 5 Cinematic', group: 'Graphics', scope: 'client', default: 3, min: 0, max: 5, step: 1 })
/**
 * The three-step value older consumers read (0, 1 or 2). It follows gfx.quality and is kept
 * only until those consumers read the level budget instead. Do not bind new code to it.
 */
export const graphicsLevel = defineParam({ id: 'gfx.level', label: 'Older three-step level, follows the quality level', group: 'Graphics', scope: 'client', default: 2, min: 0, max: 2, step: 1 })
export interface LevelBudget {
  name: string
  /** Upper bound on the renderer pixel ratio; the display's own ratio also bounds it. */
  pixelRatio: number
  targetFps: number
  shadows: number
  /** Vehicle surface shading tier, 0 plain to 3 showroom. */
  shading: number
  particles: number
  bots: number
  drawDistance: number
  detail: number
  groundCover: boolean
  /** Scale on dust, exhaust and spark emission. */
  effectsRate: number
  /** Use the cheap zorb shield for every vehicle. */
  cheapShield: boolean
  /** Backdrop blur behind interface panels. */
  uiFrost: boolean
  postTier: PostTier
}
/**
 * Placement is by the kind of work each step adds (passes, render targets, shader variants).
 * It is data: when device timings arrive, moving a feature between levels is a one-line edit.
 * Levels 0, 2 and 4 carry the budgets of the three earlier tiers unchanged.
 */
export const LEVELS: readonly LevelBudget[] = [
  { name: 'Minimal', pixelRatio: 1, targetFps: 30, shadows: 0, shading: 0, particles: 240, bots: 2, drawDistance: 700, detail: 0.5, groundCover: false, effectsRate: 0.25, cheapShield: true, uiFrost: false, postTier: 'off' },
  { name: 'Low', pixelRatio: 1, targetFps: 30, shadows: 0, shading: 0, particles: 960, bots: 4, drawDistance: 1400, detail: 0.75, groundCover: true, effectsRate: 0.5, cheapShield: false, uiFrost: true, postTier: 'base' },
  { name: 'Medium', pixelRatio: 1, targetFps: 60, shadows: 1, shading: 1, particles: 960, bots: 4, drawDistance: 1400, detail: 0.75, groundCover: true, effectsRate: 0.5, cheapShield: false, uiFrost: true, postTier: 'lite' },
  { name: 'High', pixelRatio: 1.25, targetFps: 60, shadows: 1, shading: 2, particles: 1600, bots: 6, drawDistance: 2200, detail: 0.9, groundCover: true, effectsRate: 1, cheapShield: false, uiFrost: true, postTier: 'lite' },
  { name: 'Ultra', pixelRatio: 1.5, targetFps: 60, shadows: 2, shading: 3, particles: 2400, bots: 8, drawDistance: 3000, detail: 1, groundCover: true, effectsRate: 1, cheapShield: false, uiFrost: true, postTier: 'full' },
  { name: 'Cinematic', pixelRatio: 2, targetFps: 60, shadows: 3, shading: 3, particles: 4800, bots: 16, drawDistance: 3000, detail: 1, groundCover: true, effectsRate: 1, cheapShield: false, uiFrost: true, postTier: 'full' },
]
/** Older name for the level table. */
export const QUALITY = LEVELS
export const levelNumber = (value: number): QualityLevel => Math.max(0, Math.min(5, Math.round(Number.isFinite(value) ? value : 0))) as QualityLevel
/** The three-step value for a level: 0 stays 0, 1 and 2 read as 1, 3 to 5 read as 2. */
export const legacyTier = (level: QualityLevel): 0 | 1 | 2 => ([0, 1, 1, 2, 2, 2] as const)[level]
export function qualityBudget(): LevelBudget { return LEVELS[levelNumber(qualityLevel.value)] }
// Keep the two parameters in step with or without a controller: tests and tools that still
// set gfx.level move the real level to the matching budget (0, 2 or 4), and any change of
// the real level refreshes the older value.
let syncing = false
params.onChange((id, value) => {
  if (syncing || (id !== qualityLevel.def.id && id !== graphicsLevel.def.id)) return
  syncing = true
  try {
    if (id === qualityLevel.def.id) params.set(graphicsLevel.def.id, legacyTier(levelNumber(Number(value))))
    else if (legacyTier(levelNumber(qualityLevel.value)) !== value) params.set(qualityLevel.def.id, ([0, 2, 4] as const)[Math.max(0, Math.min(2, Number(value)))])
  } finally { syncing = false }
})
/**
 * Vehicle surface shading, read by the vehicle skins: 0 plain standard materials, 1 lit
 * procedural detail, 2 adds the clear coat and glass, 3 adds flakes and iridescence. Each
 * quality level sets it; a value set by hand stands until the player next changes level.
 */
export const vehicleShading = defineParam({ id: 'gfx.vehicleShading', label: 'Vehicle shading: 0 plain to 3 showroom', group: 'Graphics', scope: 'client', default: 0, min: 0, max: 3, step: 1 })
/** Shading per three-step value, for the vehicle lab page only. */
export const SHADING_CAP = [0, 1, 3] as const

/** The parameter's own default: the finished look its owner chose. */
const D = Symbol('default')
type PresetCell = ParamValue | typeof D
type PresetRow = readonly [PresetCell, PresetCell, PresetCell, PresetCell, PresetCell, PresetCell]
const off4: PresetRow = [0, 0, 0, 0, D, D]
/**
 * Every parameter a level owns, by level. Client scope only: weather, sky, waves, ground
 * cover amount and bot count belong to the shared world and are never written here. Look-only
 * parameters (tone map, grade, grain, radii, thresholds) stay with the player.
 */
const PRESET_TABLE: Readonly<Record<string, PresetRow>> = {
  'gfx.shadowQuality': [0, 0, 1, 1, 2, 3],
  'gfx.vehicleShading': [0, 0, 1, 2, 3, 3],
  'lava.particleBudget': [240, 960, 960, 1600, 2400, 4800],
  'water.ripples': [false, true, true, true, true, true],
  'water.rippleSize': [64, 64, 96, 128, 128, 256],
  'water.spray': [false, true, true, true, true, true],
  'water.caustics': [0, D, D, D, D, D],
  'terrain.detailNormal': [0, D, D, D, D, D],
  'terrain.surfaceResponse': [0, D, D, D, D, D],
  'terrain.macroColour': [0, D, D, D, D, D],
  'terrain.accent': [0, D, D, D, D, D],
  'light.bounce': [0, D, D, D, D, D],
  'light.skyReflection': [0, D, D, D, D, D],
  'post.on': [false, true, true, true, true, true],
  // Every level has sun rays: Minimal and Low draw the sky's cheap form (src/fx/post/sunburst.ts).
  'post.shafts': [D, D, D, D, D, D],
  // Fog banks (src/world/weather/fogMap.ts): off at Minimal, one sample at Low, three above.
  'gfx.fogBanks': [0, 1, 2, 2, 2, 2],
  // Headlight cones in mist (src/vehicles/effects/cones.ts): off at Minimal.
  'light.headlightCones': [0, D, D, D, D, D],
  'post.bloom': [0, 0, 0, D, D, D],
  'post.heat': [0, 0, 0, D, D, D],
  'post.temporal': [false, false, false, false, true, true],
  'post.ao': off4,
  'post.contact': off4,
  'post.clouds': off4,
  'post.flare': off4,
  'post.motionBlur': off4,
  'post.gi': [0, 0, 0, 0, 0, D],
  // Ground cover. The numbers are Vegetation's COVER_LEVELS rows (src/world/terrain/groundcover.ts);
  // the shared amount, terrain.groundCover, is a world parameter and is not touched.
  'cover.density': [0, 0.3, 0.5, 0.8, 1, 1],
  'cover.reach': [0, 0.45, 0.6, 0.8, 1, 1],
  'cover.detail': [0, 12, 18, 24, 24, 40],
  'cover.flowers': [0, 0.5, 1, 1, 1, 1],
  'cover.bend': [false, false, true, true, true, true],
  'cover.nightLife': [0, 0, 0.5, 0.75, 1, 1],
  // Tyre marks: none at Minimal, shorter lived at Low (src/vehicles/effects/markParams.ts).
  'gfx.tyreMarks.strength': [0, D, D, D, D, D],
  'gfx.tyreMarks.life': [0.4, 0.6, D, D, D, D],
}
export const PRESET_IDS: readonly string[] = Object.freeze(Object.keys(PRESET_TABLE))
/**
 * The values a level sets, for the parameters registered so far. A module that loads later
 * registers its parameters later; the controller applies those when they appear.
 */
export function presetFor(level: QualityLevel): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const id of PRESET_IDS) {
    const def = params.get(id)?.def
    if (!def || def.scope !== 'client') continue
    const cell = PRESET_TABLE[id][level]
    out[id] = cell === D ? def.default : cell
  }
  return out
}

export interface CapabilityHints { memoryGB?: number; adapter?: 'available' | 'missing' | 'fallback'; maxTextureDimension2D?: number }
export interface Capability { /** First-visit level. */ start: QualityLevel; /** Highest level automatic climbs may reach. */ ceiling: QualityLevel }
/**
 * What the graphics stack can do, never what kind of device it is: no user agent or touch
 * test. A software adapter or the WebGL 2 path starts at Medium or below and automatic
 * climbs stop at Medium; players may choose higher levels manually. Startup revalidation
 * may lower a saved choice again. Everything else may reach Cinematic; the first visit
 * starts at High, or Medium on a small texture limit or two gigabytes of memory, and the
 * governor moves from there on measured frames.
 */
export function assessCapability(hints: CapabilityHints): Capability {
  if (hints.adapter === 'fallback') return { start: 0, ceiling: 2 }
  if (hints.adapter === 'missing') return { start: 2, ceiling: 2 }
  if ((hints.memoryGB !== undefined && hints.memoryGB <= 2) || (hints.maxTextureDimension2D !== undefined && hints.maxTextureDimension2D < 8192)) return { start: 2, ceiling: 5 }
  return { start: 3, ceiling: 5 }
}
/** Three-step capability for the vehicle lab page. The game uses assessCapability. */
export function classifyDevice(hints: CapabilityHints & { userAgent?: string; touchPoints?: number }): 0 | 1 | 2 { return legacyTier(assessCapability(hints).start) }
export const LOAD_KEY = 'syn3h.loading.level'
/** Keys of the three-tier settings, read once for migration and then removed. */
export const LEVEL_KEY = 'syn3h.graphics.level'
export const MANUAL_KEY = 'syn3h.graphics.manual'
export const STATE_KEY = 'syn3h.quality.v2'
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function storageRead(storage: StorageLike | null, key: string): string | null { try { return storage?.getItem(key) ?? null } catch { return null } }
function storageWrite(storage: StorageLike | null, key: string, value: string | null) { try { if (value === null) storage?.removeItem(key); else storage?.setItem(key, value) } catch { /* Private mode may reject storage writes. */ } }
/** An unfinished previous load starts this one a level lower, and again for repeated failures. */
export function beginLoad(storage: StorageLike | null, wanted: QualityLevel): QualityLevel {
  const pending = storageRead(storage, LOAD_KEY)
  const level = pending === null ? wanted : Math.min(wanted, Math.max(0, levelNumber(Number(pending)) - 1)) as QualityLevel
  storageWrite(storage, LOAD_KEY, String(level))
  return level
}
export function finishLoad(storage: StorageLike | null) { storageWrite(storage, LOAD_KEY, null) }
export interface SavedQuality { level: QualityLevel; auto: boolean; pinned: boolean; overrides: Record<string, ParamValue> }
/**
 * The level this device settled on, with the player's fine-tuning. Falls back to the settings
 * of the three earlier tiers (0, 1, 2 become Minimal, Medium, Ultra), and to nothing when
 * storage is empty, unreadable or corrupt.
 */
export function loadSavedQuality(stores: ReadonlyArray<StorageLike | null>): SavedQuality | null {
  for (const store of stores) {
    const text = storageRead(store, STATE_KEY)
    if (text === null) continue
    try {
      const raw = JSON.parse(text) as Partial<SavedQuality> | null
      if (!raw || typeof raw.level !== 'number' || !Number.isFinite(raw.level)) continue
      const overrides: Record<string, ParamValue> = {}
      if (raw.overrides && typeof raw.overrides === 'object') for (const id of PRESET_IDS) {
        const value = (raw.overrides as Record<string, unknown>)[id]
        if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') overrides[id] = value
      }
      return { level: levelNumber(raw.level), auto: raw.auto !== false, pinned: raw.pinned === true, overrides }
    } catch { /* Corrupt state is treated as absent. */ }
  }
  for (const store of stores) {
    const old = storageRead(store, LEVEL_KEY)
    if (old === null || !Number.isFinite(Number(old))) continue
    return { level: ([0, 2, 4] as const)[Math.max(0, Math.min(2, Math.round(Number(old))))], auto: true, pinned: storageRead(store, MANUAL_KEY) !== null, overrides: {} }
  }
  return null
}
export function saveQuality(storage: StorageLike | null, state: SavedQuality) { storageWrite(storage, STATE_KEY, JSON.stringify(state)) }

/**
 * The original whole-level monitor: ignore hidden tabs and startup, then require four
 * consecutive two-second slow windows. QualityController now uses QualityGovernor; this
 * stays exported for callers that want the plain level drop.
 */
export class FrameBudgetMonitor {
  private warmup = 0
  private elapsed = 0
  private frames = 0
  private slow = 0
  private cooldown = 0
  sample(frameMs: number, visible = true, minimumFps = 28): boolean {
    if (!visible || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) { this.elapsed = this.frames = this.slow = 0; return false }
    this.warmup += frameMs
    if (this.warmup < 5000) return false
    if (this.cooldown > 0) { this.cooldown -= frameMs; return false }
    this.elapsed += frameMs; this.frames++
    if (this.elapsed < 2000) return false
    const fps = this.frames * 1000 / this.elapsed
    this.slow = fps < minimumFps ? this.slow + this.elapsed : 0
    this.elapsed = this.frames = 0
    if (this.slow < 8000) return false
    this.slow = 0; this.cooldown = 15000
    return true
  }
}
export interface LoadProgress { phase: 'device' | 'physics' | 'renderer' | 'world' | 'ready'; progress: number; elapsedMs: number }
export let loadingProgress: LoadProgress = { phase: 'device', progress: 0, elapsedMs: 0 }
export function reportLoading(phase: LoadProgress['phase'], progress: number) {
  loadingProgress = { phase, progress: Math.max(loadingProgress.progress, progress), elapsedMs: performance.now() }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('syn3h:loading', { detail: loadingProgress }))
}
// ---------------------------------------------------------------------------------------
// Governor. Inside a level it sheds cost in steps that create no pipelines: the post
// budget fades, then resolution drops twice. Under continued pressure it gives up the
// level. The decision logic has no DOM or renderer dependency, so synthetic frame traces
// drive it in tests. QualityController feeds it real frames and applies its choices.
// ---------------------------------------------------------------------------------------

/** Automatic quality. Off keeps each level's fixed budget; only the load crash fallback remains. */
export const autoQuality = defineParam({ id: 'gfx.auto', label: 'Automatic quality', group: 'Graphics', scope: 'client', default: true })

export type RungKind = 'post' | 'resolution'
/**
 * Effective render settings at one rung. pixelRatio already includes the display cap. `post`
 * is the post-effects budget: 1 full, 0 faded out, always 0 when no post chain is active.
 * Shading, particles and shadows are the level's values, repeated here for diagnostics.
 */
export interface RungSettings { kind: RungKind | 'base'; pixelRatio: number; vehicleShading: number; particles: number; shadows: number; post: number }
/** Resolution rungs, as a fraction of the level's pixel ratio: 28 and then 51 percent fewer pixels. */
export const RESOLUTION_STEPS = [0.85, 0.7] as const
/**
 * The player's render resolution, as a fraction of the display's native resolution: 1 is one
 * rendered pixel per physical pixel. null is Auto, the level's budget. A chosen value replaces
 * the level's pixel ratio budget as the ladder's top rung; the governor's resolution rungs may
 * still go below it, never above.
 */
export const RENDER_RESOLUTION = { min: 0.5, max: 1, step: 0.05 } as const
export const RESOLUTION_KEY = 'syn3h.graphics.resolution'
/** A stored or chosen fraction, snapped to the steps and kept between 50% and 100%; anything else is Auto. */
export function renderResolution(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  const { min, max, step } = RENDER_RESOLUTION
  return Math.round(Math.round(Math.min(max, Math.max(min, n)) / step) * step * 100) / 100
}

/**
 * Evidence needed to shed a rung (consecutive slow time) and to climb back (consecutive
 * time with headroom, before backoff). Rungs react within two seconds because a fade or a
 * resize is hard to see and free to undo. A level change builds shaders, so it waits longer
 * each way.
 */
export const RUNG_TIMING: Record<RungKind | 'level', { shedMs: number; climbMs: number }> = {
  post: { shedMs: 2000, climbMs: 10000 },
  resolution: { shedMs: 2000, climbMs: 10000 },
  level: { shedMs: 4000, climbMs: 60000 },
}

/**
 * The bots this device simulates, as the governor sees them (src/bots/pacing.ts behind it).
 * One of its steps: after the post effects fade and before the picture gets coarser, it may
 * send one bot away, and with headroom it lets one come back. The host's count is an upper
 * bound the bots never exceed; the player's chosen level is never changed by this.
 */
export interface BotRelief {
  /** Bots simulated here now. */
  carried(): number
  /** What the host asked for, within the level's budget. */
  requested(): number
  /** True when the bots carried measurably cost frame time at this target. */
  costly(targetMs: number): boolean
  /** Carry one fewer. True when that changed anything. `byPlayer`: the player asked, so it is not undone on its own. */
  shed(byPlayer?: boolean): boolean
  /** Allow one more, up to what was requested. True when that changed anything. */
  climb(): boolean
}
/** Bots react like a rung: two seconds of slow frames to send one away, ten clean to let one back. */
export const BOT_TIMING = { shedMs: 2000, climbMs: 10000 }

export const GOVERNOR = {
  /** Valid visible frame time before any decision, like the previous monitor. */
  warmupMs: 5000,
  /** Statistics window. One second gives resolution a two-window reaction. */
  windowMs: 1000,
  /** Frames ignored after any change, so a resize or compile hitch is not counted as evidence. */
  settleMs: 2000,
  /** Settle after a manual change or switching automation back on. */
  manualSettleMs: 5000,
  /** Slow window: the 90th percentile frame is 25 percent over target, so more than one frame in ten missed. */
  slowFactor: 1.25,
  /** Headroom when the display is no faster than the target: 95 percent of frames on time. */
  cleanFactor: 1.1,
  /** Headroom when the display is faster than the target: frames must actually beat it. */
  cleanFactorFastDisplay: 0.85,
  /** A rung undone within this time of climbing counts as a failed climb. */
  probationMs: 30000,
  /** Failed climbs double the wait for that rung up to this multiple of its base. */
  maxBackoff: 32,
  /** No climb waits longer than this, however often it failed. */
  maxClimbWaitMs: 600000,
  /** Until the first shed of a session, climb waits are multiplied by this. */
  calibrationFactor: 0.25,
  /** A level climb waits this long for a covered moment before it is taken during play. */
  climbGraceMs: 20000,
}

/** Common display rates, used to snap the measured refresh interval. */
const DISPLAY_RATES = [240, 165, 144, 120, 100, 90, 75, 72, 60, 50, 48, 30]
function snapInterval(ms: number): number {
  for (const hz of DISPLAY_RATES) if (Math.abs(ms * hz / 1000 - 1) < 0.08) return 1000 / hz
  return ms
}

function sameSettings(a: RungSettings, b: RungSettings) { return a.pixelRatio === b.pixelRatio && a.post === b.post }
function notAbove(a: RungSettings, b: RungSettings) { return a.pixelRatio <= b.pixelRatio && a.post <= b.post }

/**
 * Effective rungs for one level on this display. Rung 0 is the level's full budget. The
 * post rung exists only while a chain is drawing effects, and steps that change nothing are
 * dropped, so every rung costs a real change.
 */
export function buildLadder(level: QualityLevel, devicePixelRatio = 1, postActive = false, resolution: number | null = null): RungSettings[] {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  // The display caps the level's budget; a resolution the player chose replaces that budget.
  const chosen = renderResolution(resolution)
  const budget = LEVELS[level], ratio = chosen === null ? Math.min(dpr, budget.pixelRatio) : Math.round(dpr * chosen * 100) / 100
  let current: RungSettings = { kind: 'base', pixelRatio: ratio, vehicleShading: budget.shading, particles: budget.particles, shadows: budget.shadows, post: postActive ? 1 : 0 }
  const ladder = [current]
  const push = (next: RungSettings) => { if (!sameSettings(next, current)) { ladder.push(next); current = next } }
  push({ ...current, kind: 'post', post: 0 })
  for (const step of RESOLUTION_STEPS) push({ ...current, kind: 'resolution', pixelRatio: Math.round(ratio * step * 100) / 100 })
  return ladder
}

export interface FrameWindow { frames: number; durationMs: number; p10: number; p90: number; p95: number }
export type GovernorReason = 'shed' | 'climb' | 'level-drop' | 'level-climb' | 'manual' | 'auto-off' | 'auto-on' | 'display'
export interface GovernorChange { level: QualityLevel; rung: number; reason: GovernorReason; settings: RungSettings }
export interface GovernorOptions {
  level: QualityLevel
  /** Highest level automatic climbs may reach: what the graphics stack can do, and the crash fallback. */
  ceiling?: QualityLevel
  devicePixelRatio?: number
  auto?: boolean
  /** The player chose the level by hand: shed rungs inside it but never change the level. */
  levelPinned?: boolean
  /** The player's render resolution (see RENDER_RESOLUTION); null or absent is Auto. */
  resolution?: number | null
}

/**
 * Stepped quality governor. Feed it every rendered frame interval; it returns a change when
 * the rung or level should move, and null otherwise.
 *
 * Statistic: frames are grouped into one-second windows. A window is slow when its 90th
 * percentile frame exceeds the target by 25 percent, so one hitch in a window never counts,
 * and has headroom when its 95th percentile is on target. Evidence is consecutive: any
 * window that is not slow clears the slow evidence, and any window without headroom clears
 * the headroom evidence. Hidden tabs and absurd frame times clear both, and nothing is
 * decided during the first five seconds or while a change settles.
 *
 * Target: the level's target rate, never faster than the display. The display interval is
 * the fastest one-second window seen this session (10th percentile, snapped to a common
 * rate), including the light frames the controller probes while the game loads. A display
 * or browser that caps at 30 fps from the start (Low Power Mode) therefore sets a 30 fps
 * target and is not punished for missing 60. A cap that begins mid-session cannot be told
 * apart from a slow GPU by frame intervals alone, so it is treated as one.
 *
 * Recovery: climbing needs the climb time of continuous headroom, multiplied by a backoff
 * that doubles each time a climb to that state had to be undone within the probation
 * period, and halves each time a climb survives it. Until the first shed of a session the
 * waits are a quarter as long, so a strong device finds its level in about a minute of
 * play instead of several.
 *
 * Level climbs build shaders, so they are not taken mid-drive: the governor holds one as
 * pending until the controller reports a covered moment (a menu, the lobby, a respawn), or
 * until the grace period passes with headroom still unbroken.
 */
export class QualityGovernor {
  level: QualityLevel
  rung = 0
  ladder: RungSettings[] = []
  ceiling: QualityLevel
  auto: boolean
  levelPinned: boolean
  devicePixelRatio: number
  /** The player's render resolution, or null for Auto. */
  resolution: number | null
  /** Changes made by the governor itself, for diagnostics and oscillation tests. */
  changes = 0
  displayMs: number | null = null
  last: FrameWindow | null = null
  /** A level climb that has earned its headroom and waits for a covered moment. */
  pendingLevel: QualityLevel | null = null
  /** True until the first shed: climbs wait a quarter as long. */
  calibrating = true
  private pendingAt = 0
  private clock = 0
  private warmup = 0
  private settle = 0
  private window: number[] = []
  private windowMs = 0
  private slowMs = 0
  private cleanMs = 0
  private readonly backoff = new Map<string, number>()
  private probe: { key: string; until: number } | null = null
  private displaySamples: number[] = []
  private displaySampleMs = 0
  private postActive = false
  constructor(options: GovernorOptions) {
    this.level = options.level
    this.ceiling = options.ceiling ?? 5
    this.auto = options.auto ?? true
    this.levelPinned = options.levelPinned ?? false
    this.devicePixelRatio = options.devicePixelRatio ?? 1
    this.resolution = renderResolution(options.resolution)
    this.ladder = this.ladderFor(this.level)
  }
  get settings(): RungSettings { return this.ladder[this.rung] }
  get key() { return `${this.level}:${this.rung}` }
  /** Frame interval the current level aims for. */
  /** The bots, when the game has any to offer (see BotRelief). */
  bots: BotRelief | null = null
  /** Bots sent away or let back by the governor, for diagnostics. */
  botChanges = 0
  get targetMs() { return Math.max(1000 / LEVELS[this.level].targetFps, this.displayMs ?? 0) }
  /** Frame intervals that only inform the display rate, such as idle frames during loading. */
  noteInterval(frameMs: number) {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) return
    this.displaySamples.push(frameMs); this.displaySampleMs += frameMs
    if (this.displaySampleMs < GOVERNOR.windowMs) return
    const sorted = this.displaySamples.sort((a, b) => a - b)
    this.noteDisplay(sorted[Math.floor(sorted.length * 0.1)], true); this.displaySamples = []; this.displaySampleMs = 0
  }
  /**
   * Game frames can be heavy from the first one, so a game window only proves a display of
   * 60 Hz or faster. Slower rates (a 30 fps cap, a 50 Hz television) are believed only from
   * idle probe frames; otherwise a GPU bound at 45 fps from the start would snap to "a 48 Hz
   * display" and never shed.
   */
  private noteDisplay(p10: number, idle: boolean) {
    const display = snapInterval(p10)
    if (!idle && display > 1000 / 60 + 0.5) return
    if (this.displayMs === null || display < this.displayMs * 0.92) this.displayMs = display
  }
  /** Current climb wait for the step above, in milliseconds, including backoff and calibration. */
  climbWaitMs(): number | null {
    const up = this.climbTarget()
    if (!up) return null
    const wait = up.timing.climbMs * (this.backoff.get(`${up.level}:${up.rung}`) ?? 1) * (this.calibrating ? GOVERNOR.calibrationFactor : 1)
    return Math.min(GOVERNOR.maxClimbWaitMs, wait)
  }
  private ladderFor(level: QualityLevel) { return buildLadder(level, this.devicePixelRatio, this.postActive, this.resolution) }
  /**
   * A post chain started or stopped drawing effects. While one is active every ladder gains
   * a first rung that fades them out; otherwise the ladder is resolution only.
   */
  setPostActive(on: boolean): GovernorChange | null {
    if (on === this.postActive) return null
    const from = this.settings
    this.postActive = on; this.ladder = this.ladderFor(this.level)
    // Starting effects starts them at full budget; the governor fades them if it must.
    this.rung = this.mapRung({ ...from, post: on ? 1 : 0 })
    return this.change('manual', GOVERNOR.manualSettleMs)
  }
  private change(reason: GovernorReason, settleMs = GOVERNOR.settleMs): GovernorChange {
    this.settle = settleMs; this.clearEvidence(); this.pendingLevel = null
    return { level: this.level, rung: this.rung, reason, settings: this.settings }
  }
  private clearEvidence() { this.window = []; this.windowMs = this.slowMs = this.cleanMs = 0 }
  /** First rung of the ladder that is nowhere richer than the given settings, so a remap never upgrades anything. */
  private mapRung(from: RungSettings) {
    const index = this.ladder.findIndex(rung => notAbove(rung, from))
    return index < 0 ? this.ladder.length - 1 : index
  }
  /** Automatic or startup reset to the top of a level. */
  reset(level: QualityLevel, reason: GovernorReason = 'manual') {
    this.level = level; this.ladder = this.ladderFor(level); this.rung = 0; this.probe = null
    return this.change(reason, GOVERNOR.manualSettleMs)
  }
  /** The player set the level by hand. It becomes the pinned level and the ladder restarts at its top. */
  setManualLevel(level: QualityLevel) { this.levelPinned = true; return this.reset(level, 'manual') }
  /** Explicit recommendation action: a lower level must not restore cost already shed. */
  lowerManualLevel(): GovernorChange | null {
    if (this.level === 0) return null
    const from = this.settings
    this.levelPinned = true; this.level = (this.level - 1) as QualityLevel
    this.ladder = this.ladderFor(this.level); this.rung = this.mapRung(from); this.probe = null
    return this.change('manual', GOVERNOR.manualSettleMs)
  }
  setCeiling(level: QualityLevel) { this.ceiling = level }
  /** The window moved to a display with another pixel ratio. Keeps the post budget. */
  setDevicePixelRatio(dpr: number): GovernorChange | null {
    if (!(dpr > 0) || dpr === this.devicePixelRatio) return null
    const from = this.settings
    this.devicePixelRatio = dpr; this.ladder = this.ladderFor(this.level)
    // Start the new display at its richest resolution; slow frames shed it again within seconds.
    this.rung = this.mapRung({ ...from, pixelRatio: Infinity })
    return this.change('display')
  }
  /**
   * The player chose a render resolution, or Auto (null). The ladder restarts at its new top,
   * keeping the post budget; slow frames may shed resolution again below the choice.
   */
  setResolution(resolution: number | null): GovernorChange | null {
    const next = renderResolution(resolution)
    if (next === this.resolution) return null
    const from = this.settings
    this.resolution = next; this.ladder = this.ladderFor(this.level)
    this.rung = this.mapRung({ ...from, pixelRatio: Infinity })
    return this.change('manual', GOVERNOR.manualSettleMs)
  }
  /** Turning automation off returns to the level's full budget. Turning it on releases a hand-set level. */
  setAuto(on: boolean) {
    this.auto = on
    if (on) { this.levelPinned = false; this.rung = 0; return this.change('auto-on', GOVERNOR.manualSettleMs) }
    this.rung = 0; this.probe = null
    return this.change('auto-off')
  }
  private climbTarget() {
    if (this.rung > 0) return { level: this.level, rung: this.rung - 1, timing: RUNG_TIMING[this.ladder[this.rung].kind as RungKind] }
    if (this.levelPinned || this.level >= this.ceiling) return null
    const level = (this.level + 1) as QualityLevel
    return { level, rung: this.ladderFor(level).length - 1, timing: RUNG_TIMING.level }
  }
  private shedTiming() {
    if (this.rung + 1 < this.ladder.length) return RUNG_TIMING[this.ladder[this.rung + 1].kind as RungKind]
    return this.levelPinned || this.level === 0 ? null : RUNG_TIMING.level
  }
  sample(frameMs: number, visible = true): GovernorChange | null {
    if (!visible || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) { this.clearEvidence(); return null }
    this.clock += frameMs
    if (this.probe && this.clock >= this.probe.until) {
      this.backoff.set(this.probe.key, Math.max(1, (this.backoff.get(this.probe.key) ?? 1) / 2)); this.probe = null
    }
    if (this.settle > 0) { this.settle -= frameMs; return null }
    this.window.push(frameMs); this.windowMs += frameMs
    if (this.windowMs < GOVERNOR.windowMs) return null
    const sorted = this.window.sort((a, b) => a - b), at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    const w: FrameWindow = { frames: sorted.length, durationMs: this.windowMs, p10: at(0.1), p90: at(0.9), p95: at(0.95) }
    this.last = w; this.window = []; this.windowMs = 0
    this.noteDisplay(w.p10, false)
    this.warmup += w.durationMs
    if (this.warmup < GOVERNOR.warmupMs || !this.auto) return null
    const target = this.targetMs
    const fastDisplay = this.displayMs !== null && this.displayMs < target * 0.9
    const slow = w.p90 > target * GOVERNOR.slowFactor
    const clean = w.p95 <= target * (fastDisplay ? GOVERNOR.cleanFactorFastDisplay : GOVERNOR.cleanFactor)
    this.slowMs = slow ? this.slowMs + w.durationMs : 0
    this.cleanMs = clean ? this.cleanMs + w.durationMs : 0
    if (!clean) this.pendingLevel = null
    // Bots come after the post effects and before the resolution: only when they measurably
    // cost frame time, so a device bound by its graphics loses resolution, not company.
    const botStep = this.bots !== null && this.ladder[this.rung + 1]?.kind !== 'post'
    if (slow && botStep && this.slowMs >= BOT_TIMING.shedMs && this.bots!.carried() > 0 && this.bots!.costly(target) && this.bots!.shed()) {
      this.slowMs = 0; this.settle = GOVERNOR.settleMs; this.botChanges++; return null
    }
    // Climbing reverses it: the resolution comes back first, then the bots, then the effects.
    if (clean && this.bots !== null && this.ladder[this.rung]?.kind !== 'resolution' && this.cleanMs >= BOT_TIMING.climbMs && this.bots.carried() < this.bots.requested() && this.bots.climb()) {
      this.cleanMs = 0; this.settle = GOVERNOR.settleMs; this.botChanges++; return null
    }
    if (slow) {
      const timing = this.shedTiming()
      if (!timing || this.slowMs < timing.shedMs) return null
      return this.shed()
    }
    const wait = this.climbWaitMs()
    if (!clean || wait === null || this.cleanMs < wait) return null
    if (this.rung > 0) return this.climb()
    // A level climb waits for a covered moment, or for the grace period with headroom unbroken.
    if (this.pendingLevel === null) { this.pendingLevel = (this.level + 1) as QualityLevel; this.pendingAt = this.clock; return null }
    return this.clock - this.pendingAt >= GOVERNOR.climbGraceMs ? this.climb() : null
  }
  /** The controller reports a moment when a shader build will not be seen. Takes a pending level climb. */
  applyPendingClimb(): GovernorChange | null {
    if (this.pendingLevel === null || !this.auto || this.rung > 0 || !this.climbTarget()) { this.pendingLevel = null; return null }
    return this.climb()
  }
  private shed(): GovernorChange {
    if (this.probe && this.clock < this.probe.until) {
      this.backoff.set(this.probe.key, Math.min(GOVERNOR.maxBackoff, (this.backoff.get(this.probe.key) ?? 1) * 2))
    }
    this.probe = null; this.changes++; this.calibrating = false
    if (this.rung + 1 < this.ladder.length) { this.rung++; return this.change('shed') }
    const from = this.settings
    this.level = (this.level - 1) as QualityLevel; this.ladder = this.ladderFor(this.level); this.rung = this.mapRung(from)
    return this.change('level-drop')
  }
  private climb(): GovernorChange {
    const up = this.climbTarget()!
    const reason = up.level !== this.level ? 'level-climb' : 'climb'
    if (up.level !== this.level) { this.level = up.level; this.ladder = this.ladderFor(up.level) }
    this.rung = up.rung; this.changes++
    this.probe = { key: this.key, until: this.clock + GOVERNOR.probationMs }
    return this.change(reason)
  }
}

export interface QualityTerrain { setRenderQuality?(options: { level: 0 | 1 | 2; quality: QualityLevel; drawDistance: number; detail: number; groundCover: boolean }): void }
export interface FrameMetrics { fps: number; frameMs: number; physicsMs: number; drawCalls: number; triangles: number; firstFrameMs: number | null
  /** Renderer pipeline cache this frame: live size and objects not seen before. Absent or null where unreadable. */
  pipelinesLive?: number | null; pipelinesFresh?: number | null }
/** Values the governor has actually applied, for consumers that need more than the level budget. */
export interface EffectiveQuality extends RungSettings { level: QualityLevel; rung: number; rungs: number; auto: boolean; targetFps: number }
let effective: EffectiveQuality = { ...buildLadder(4)[0], level: 4, rung: 0, rungs: buildLadder(4).length, auto: true, targetFps: 60 }
/** Latest applied rung values. qualityBudget() stays the level's full budget. */
export function effectiveQuality(): EffectiveQuality { return effective }

/** What the interface shows and edits. The same object is returned until something changes. */
export interface QualityState {
  readonly level: QualityLevel
  readonly name: string
  readonly auto: boolean
  /** The player chose this level: the governor eases inside it but does not leave it. */
  readonly pinned: boolean
  readonly rung: number
  readonly rungs: number
  /** What the governor is easing inside the level right now, or null at the level's full budget. */
  readonly easing: RungKind | null
  readonly ceiling: QualityLevel
  readonly postTier: PostTier
  /** The player's render resolution as a fraction of native, or null for Auto. */
  readonly resolution: number | null
  /** The pixel ratio drawn now, and the display's own. */
  readonly pixelRatio: number
  readonly devicePixelRatio: number
  /** Every parameter the level owns, in display order. */
  readonly presetIds: readonly string[]
  /** The level's own value for each owned parameter registered so far. */
  readonly preset: Readonly<Record<string, ParamValue>>
  /** Values the player set by hand under this level. They last until the player changes level. */
  readonly overrides: Readonly<Record<string, ParamValue>>
}
/** One level change, for diagnostics: who made it, whether it was covered, and the pipelines it built. */
export interface LevelChangeRecord { from: QualityLevel; to: QualityLevel; by: 'player' | 'governor' | 'start'; covered: boolean; pipelinesCreated: number | null }
/** Bind methods to their controller before passing this interface to presentation code. */
export interface QualitySource {
  readonly qualityLevels: ReadonlyArray<{ readonly index: QualityLevel; readonly name: string }>
  getQualityState(): QualityState
  setLevel(level: number): void
  stepUp(): boolean
  stepDown(): boolean
  setAuto(on: boolean): void
  /** Set the render resolution (a fraction of native) or Auto (null). */
  setResolution?(resolution: number | null): void
  clearOverride(id: string): void
  clearOverrides(): void
  subscribeQuality(listener: (state: QualityState) => void): () => void
}

/**
 * Player and governor:
 * - The player choosing a level applies its whole preset, clears every override and pins the
 *   level. The governor still eases resolution and the post budget inside it under sustained
 *   pressure, but never leaves it.
 * - Any owned parameter the player then sets by hand is an override. It stays until the
 *   player next changes level; a level change made by the governor leaves it alone.
 * - Turning gfx.auto on releases the pin and lets the governor move across levels. Turning it
 *   off holds the level at its full budget; only the load crash fallback still lowers it.
 * - Automatic climbs never exceed what the graphics stack can do or the crash fallback level.
 * - The level, the pin, automation and the overrides are saved, so the next visit starts
 *   where this one settled.
 */
export class QualityController implements QualitySource {
  /** Crash marker: tab scoped, so another tab does not look like a failed load. */
  private session: StorageLike | null = null
  /** Settled level and fine-tuning: kept between visits. */
  private store: StorageLike | null = null
  private ignoreStorage: StorageLike | null = null
  private renderer: WebGPURenderer | null = null
  private terrain: QualityTerrain | null = null
  private hud: HTMLPreElement | null = null
  private hudElapsed = 0
  private loading = true
  private unsubscribe: (() => void) | null = null
  private capability: Capability = { start: 3, ceiling: 5 }
  private crashCap: QualityLevel = 5
  private firstVisit = true
  /** A level from the address is for this page load only and is not saved as the device's level. */
  private transient = false
  private writing = 0
  private appliedLevel = -1
  /** The player chose a level, perhaps the current one again: write its whole preset anyway. */
  private reapply = false
  private appliedIds = new Set<string>()
  private terrainWritten = false
  private overrides: Record<string, ParamValue> = {}
  private state: QualityState | null = null
  private readonly qualityListeners = new Set<(state: QualityState) => void>()
  private counting: { record: LevelChangeRecord; leftMs: number } | null = null
  /** Recent level changes, newest last, for diagnostics and browser checks. */
  readonly levelChanges: LevelChangeRecord[] = []
  readonly qualityLevels = Object.freeze(LEVELS.map((level, index) => Object.freeze({ index: index as QualityLevel, name: level.name })))
  private lastReason: GovernorReason | 'start' = 'start'
  readonly governor: QualityGovernor
  private readonly history = new PerformanceHistory()
  private readonly performanceListeners = new Set<(snapshot: PerformanceSnapshot) => void>()
  private diagnosticsVisible = false
  private disposed = false
  private displayFrame: number | null = null
  private environment: (() => PerformanceEnvironment) | null = null
  private readonly onVisibility = () => { this.history.resetEvidence(); this.publishPerformance() }
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.code !== 'F3' || event.repeat) return
    event.preventDefault(); this.toggleDiagnostics()
  }
  setPerformanceEnvironment(read: () => PerformanceEnvironment) { if(this.disposed)return;this.environment = read; this.publishPerformance() }
  getPerformanceSnapshot(): PerformanceSnapshot {
    const g = this.governor
    return Object.freeze({ visible: this.diagnosticsVisible,
      quality: Object.freeze({...g.settings,level:g.level,rung:g.rung,rungs:g.ladder.length,auto:g.auto,targetFps:Math.round(1000/g.targetMs)}),
      levelPinned:g.levelPinned,history:this.history.history,recommendation:this.history.recommendation,
      pipelines:this.history.pipelines,longFrames:this.history.longFrames,bots:this.botsNow(),
      environment:Object.freeze(this.environment?.() ?? {backend:'initializing',adapter:null,memoryGB:null,maxTextureSize:null,fallbackReason:null,deviceLost:null}) })
  }
  subscribePerformance(listener: (snapshot: PerformanceSnapshot) => void): () => void {
    if (this.disposed) return () => {}
    this.performanceListeners.add(listener); this.syncLegacyHud(); listener(this.getPerformanceSnapshot())
    return () => { this.performanceListeners.delete(listener); this.syncLegacyHud() }
  }
  private publishPerformance() {
    if (this.disposed) return
    const snapshot = this.getPerformanceSnapshot()
    for (const listener of this.performanceListeners) listener(snapshot)
  }
  private syncLegacyHud() {
    if (typeof document === 'undefined' || this.disposed) return
    if (this.performanceListeners.size || !this.diagnosticsVisible) { if(this.hud)this.hud.hidden=true; return }
    if (!this.hud) {
      this.hud=document.createElement('pre');this.hud.id='frame-time-hud'
      this.hud.style.cssText='position:fixed;right:12px;bottom:12px;z-index:10000;padding:10px;background:#100e16e8;color:#d9f4dc;font:12px monospace;pointer-events:none;margin:0'
      document.body.append(this.hud)
    }
    this.hud.hidden=false
  }
  setDiagnosticsVisible(visible: boolean) { this.diagnosticsVisible=visible;this.syncLegacyHud();this.publishPerformance() }
  toggleDiagnostics() { this.setDiagnosticsVisible(!this.diagnosticsVisible) }
  ignoreRecommendation() { this.history.ignore();storageWrite(this.ignoreStorage,RECOMMENDATION_IGNORE_KEY,'1');this.publishPerformance() }
  lowerRecommendedTier(): boolean {
    const offer=this.history.recommendation,g=this.governor
    if(!offer || offer.level!==g.level || g.level===0 || this.disposed)return false
    // The player accepted a lower level: same authority as choosing it, without restoring cost already shed.
    g.lowerManualLevel();this.lastReason='manual';this.apply('player');return true
  }

  // ---- Levels, overrides and the one change event -------------------------------------
  getQualityState(): QualityState {
    if (!this.state) {
      const g = this.governor
      this.state = Object.freeze({ level: g.level, name: LEVELS[g.level].name, auto: g.auto, pinned: g.levelPinned, rung: g.rung, rungs: g.ladder.length,
        easing: g.rung > 0 ? g.settings.kind as RungKind : null, ceiling: Math.min(this.capability.ceiling, this.crashCap) as QualityLevel, postTier: LEVELS[g.level].postTier,
        resolution: g.resolution, pixelRatio: g.settings.pixelRatio, devicePixelRatio: g.devicePixelRatio,
        presetIds: PRESET_IDS, preset: Object.freeze(presetFor(g.level)), overrides: Object.freeze({ ...this.overrides }) })
    }
    return this.state
  }
  /** Calls the listener now and after every change of level, rung, automation, pin or overrides. */
  subscribeQuality(listener: (state: QualityState) => void): () => void {
    if (this.disposed) return () => {}
    this.qualityListeners.add(listener); listener(this.getQualityState())
    return () => { this.qualityListeners.delete(listener) }
  }
  private publishQuality() {
    this.state = null
    if (this.disposed) return
    const g = this.governor
    if (!this.transient) saveQuality(this.store, { level: g.level, auto: g.auto, pinned: g.levelPinned, overrides: this.overrides })
    const state = this.getQualityState()
    for (const listener of this.qualityListeners) listener(state)
  }
  /** The player chooses a level: its whole preset applies and every override is cleared. */
  setLevel(level: number) {
    if (this.disposed) return
    this.transient = false
    this.governor.setManualLevel(levelNumber(level)); this.lastReason = 'manual'; this.reapply = true; this.apply('player')
  }
  stepUp(): boolean { if (this.governor.level >= 5) return false; this.setLevel(this.governor.level + 1); return true }
  stepDown(): boolean { if (this.governor.level <= 0) return false; this.setLevel(this.governor.level - 1); return true }
  setAuto(on: boolean) {
    if (this.disposed) return
    this.write(autoQuality.def.id, on)
    this.lastReason = this.governor.setAuto(on).reason; this.apply()
  }
  /** The player's render resolution, remembered on this device. Auto (null) is the level's budget. */
  setResolution(resolution: number | null) {
    if (this.disposed) return
    const change = this.governor.setResolution(resolution)
    storageWrite(this.store, RESOLUTION_KEY, this.governor.resolution === null ? null : String(this.governor.resolution))
    if (change) { this.lastReason = change.reason; this.apply() }
  }
  /** Hand one parameter back to the level. */
  clearOverride(id: string) {
    if (!(id in this.overrides)) return
    delete this.overrides[id]
    const value = presetFor(this.governor.level)[id]
    if (value !== undefined) this.write(id, value)
    this.publishQuality()
  }
  clearOverrides() { for (const id of Object.keys(this.overrides)) { delete this.overrides[id]; const value = presetFor(this.governor.level)[id]; if (value !== undefined) this.write(id, value) } this.publishQuality() }
  /** A covered moment outside the lobby and menus, such as a respawn: a pending level climb may build its shaders now. */
  noteCovered() { const change = this.governor.applyPendingClimb(); if (change) { this.lastReason = change.reason; this.apply('governor', true) } }
  /** Which parts of the post chain the current level may build. */
  get postTier(): PostTier { return LEVELS[this.governor.level].postTier }

  constructor() {
    if (typeof window === 'undefined') { this.governor = new QualityGovernor({ level: levelNumber(qualityLevel.value) }); return }
    try { this.session = window.sessionStorage } catch { /* No tab storage: the crash marker stays in memory only. */ }
    try { this.store = window.localStorage ?? this.session } catch { this.store = this.session }
    this.ignoreStorage = this.session
    this.history.ignored = storageRead(this.ignoreStorage, RECOMMENDATION_IGNORE_KEY) === '1'
    const nav = navigator as Navigator & { deviceMemory?: number }
    this.capability = assessCapability({ memoryGB: nav.deviceMemory })
    const saved = loadSavedQuality([this.store, this.session])
    this.firstVisit = saved === null
    const pending = storageRead(this.session, LOAD_KEY)
    if (pending !== null) this.crashCap = Math.max(0, levelNumber(Number(pending)) - 1) as QualityLevel
    const initial = beginLoad(this.session, saved?.level ?? this.capability.start)
    // A level in the address (?gfx=) is a choice made by hand for this page load. It pins the
    // level like setLevel, and nothing is saved until the player changes a setting.
    const override = graphicsOverride(location.search)
    this.transient = override !== undefined
    const level = override ?? initial
    storageWrite(this.session, LOAD_KEY, String(level))
    if (saved) { this.overrides = { ...saved.overrides }; this.write(autoQuality.def.id, saved.auto) }
    this.governor = new QualityGovernor({
      level, ceiling: Math.min(this.capability.ceiling, this.crashCap) as QualityLevel, devicePixelRatio: window.devicePixelRatio || 1,
      auto: autoQuality.value, levelPinned: override !== undefined || saved?.pinned === true,
      resolution: renderResolution(storageRead(this.store, RESOLUTION_KEY)),
    })
    reportLoading('device', 0.05)
    this.probeDisplay()
    window.addEventListener('keydown', this.onKey)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.unsubscribe = params.onChange((id, value, source) => {
      if(params.get(id)?.def.scope==='world'){this.history.resetEvidence();this.publishPerformance()}
      if (this.writing) return
      if (id === qualityLevel.def.id) this.setLevel(Number(value))
      else if (id === autoQuality.def.id) { this.lastReason = this.governor.setAuto(Boolean(value)).reason; this.apply() }
      else if (source === 'local' && PRESET_TABLE[id]) { this.transient = false; this.overrides[id] = value; this.publishQuality() }
    })
    this.apply('start')
  }
  /**
   * While the game loads, many animation frames are idle, so their fastest intervals show
   * the display or browser frame cap before any heavy frame can disguise it.
   */
  private probeDisplay() {
    if (typeof requestAnimationFrame === 'undefined') return
    let last = -1
    const tick = (now: number) => {
      if (!this.loading || this.disposed) return
      if (last >= 0 && !document.hidden) this.governor.noteInterval(now - last)
      last = now; this.displayFrame = requestAnimationFrame(tick)
    }
    this.displayFrame = requestAnimationFrame(tick)
  }
  /** Parameter writes made by the controller, so the change listener does not treat them as the player's. */
  private write(id: string, value: ParamValue) { this.writing++; try { params.set(id, value) } finally { this.writing-- } }
  /** What the WebGPU adapter probe found; a stalled probe sends the renderer straight to WebGL 2. */
  adapterProbe: AdapterProbe = 'unsupported'
  async initialize() {
    const nav = navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(options?: { powerPreference: string }): Promise<{ isFallbackAdapter?: boolean; limits: { maxTextureDimension2D: number } } | null> } }
    // Bounded: a stalled requestAdapter used to hang the whole startup here.
    const { probe, adapter } = await probeAdapter(nav.gpu, { powerPreference: 'high-performance' }, gpuDeadlineMs(location.search))
    this.adapterProbe = probe
    this.capability = assessCapability({ memoryGB: nav.deviceMemory, adapter: probe === 'available' || probe === 'fallback' ? probe : 'missing', maxTextureDimension2D: adapter?.limits.maxTextureDimension2D })
    const ceiling = Math.min(this.capability.ceiling, this.crashCap) as QualityLevel
    this.governor.setCeiling(ceiling)
    // A first visit starts where the probe says; a returning one keeps its level unless the stack can no longer carry it.
    const level = Math.min(this.governor.level, this.firstVisit && !this.governor.levelPinned ? this.capability.start : ceiling) as QualityLevel
    if (level !== this.governor.level) { this.governor.reset(level, 'level-drop'); this.lastReason = 'level-drop' }
    this.apply('start')
  }
  attachRenderer(renderer: WebGPURenderer) {
    this.renderer = renderer
    // The renderer may fall back after a successful adapter probe, or be forced to WebGL.
    if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
      this.capability = { start: Math.min(this.capability.start, 2) as QualityLevel, ceiling: Math.min(this.capability.ceiling, 2) as QualityLevel }
      const ceiling = Math.min(this.capability.ceiling, this.crashCap) as QualityLevel
      this.governor.setCeiling(ceiling)
      if (this.governor.level > ceiling) { this.governor.reset(ceiling, 'level-drop'); this.lastReason = 'level-drop' }
    }
    this.apply('start')
  }
  /** Optional hook for terrain builders; no regeneration or physics changes are implied. */
  /** The game's bots, as a governor step and in the Performance card. See BotRelief. */
  attachBots(bots: BotRelief | null) { this.governor.bots = bots; this.publishPerformance() }
  private botChangesSeen = 0
  private botsNow(): PerformanceBots | null {
    const b = this.governor.bots
    return b ? { carried: b.carried(), requested: b.requested(), costly: b.costly(this.governor.targetMs) } : null
  }
  /** The player accepted fewer bots: one leaves now. Their level is untouched. */
  fewerRecommendedBots(): boolean {
    const b = this.governor.bots
    if (!b || this.disposed || !b.shed(true)) return false
    this.history.resetEvidence(); this.publishPerformance(); return true
  }
  attachTerrain(terrain: QualityTerrain) { this.terrain = terrain; this.terrainWritten = false; this.onTerrain?.(); this.apply('start') }
  /** Startup timing hook: main calls attachTerrain right after building the terrain. */
  onTerrain: (() => void) | null = null
  /**
   * Make the world match the governor. On a level change the whole preset is written in one
   * tick, so a post chain rebuilds once. Overrides are skipped unless the player made the
   * change, in which case they were cleared first.
   */
  private apply(by: 'player' | 'governor' | 'start' = 'governor', covered = by !== 'governor') {
    this.history.resetEvidence()
    const g = this.governor, level = g.level, budget = LEVELS[level], s = g.settings
    const levelChanged = this.appliedLevel !== level || this.reapply
    this.reapply = false
    if (levelChanged) {
      if (by === 'player') this.overrides = {}
      if (this.appliedLevel >= 0 && this.appliedLevel !== level) {
        const record: LevelChangeRecord = { from: this.appliedLevel as QualityLevel, to: level, by, covered, pipelinesCreated: null }
        this.levelChanges.push(record); if (this.levelChanges.length > 16) this.levelChanges.shift()
        this.counting = { record, leftMs: 2000 }
      }
      this.appliedIds.clear()
    }
    this.appliedLevel = level
    if (qualityLevel.value !== level) this.write(qualityLevel.def.id, level)
    if (this.loading) storageWrite(this.session, LOAD_KEY, String(level))
    this.writePreset()
    this.renderer?.setPixelRatio(s.pixelRatio)
    if (this.terrain && (levelChanged || !this.terrainWritten)) { this.terrain.setRenderQuality?.({ level: legacyTier(level), quality: level, drawDistance: budget.drawDistance, detail: budget.detail, groundCover: budget.groundCover }); this.terrainWritten = true }
    effective = { ...s, level, rung: g.rung, rungs: g.ladder.length, auto: g.auto, targetFps: Math.round(1000 / g.targetMs) }
    if(typeof window !== 'undefined')window.dispatchEvent(new CustomEvent('syn3h:quality', { detail: { ...budget, ...effective, budget, reason: this.lastReason } }))
    this.publishQuality()
    this.publishPerformance()
  }
  /** Write the level's value, or the player's override, for every owned parameter not yet written at this level. */
  private writePreset() {
    const preset = presetFor(this.governor.level)
    let wrote = false
    for (const id in preset) {
      if (this.appliedIds.has(id)) continue
      this.appliedIds.add(id); wrote = true
      this.write(id, id in this.overrides ? this.overrides[id] : preset[id])
    }
    return wrote
  }
  private budget = 1
  private postOn() { return this.governor.ladder[0].post > 0 }
  /**
   * How much of their strength post effects may use now, 0 to 1. It is the governor's first
   * rung inside a level: 1 at full budget, easing to 0 over about half a second when the
   * governor fades post effects (before it touches resolution), and back when it climbs.
   * Which effects exist at all is the level's decision, through their strengths and postTier.
   */
  get postBudget() { return this.budget }
  /** Tell the governor a post chain is drawing effects (or has stopped), so it can fade them first. */
  setPostActive(on: boolean) { const change = this.governor.setPostActive(on); if (change) { this.lastReason = change.reason; this.apply() } }
  /** Older three-step reading of what the graphics stack can do. Use postTier and the level budget instead. */
  get deviceLevel() { return legacyTier(Math.min(this.capability.ceiling, this.crashCap) as QualityLevel) }
  /** True until the first frame with draw calls. */
  get isLoading() { return this.loading }
  /**
   * Once per rendered frame. `judge` is false while a lobby or menu is on screen: those
   * frames are spent on the lobby's own drawing, so they must not step the game's quality
   * down before the player has started. Evidence gathered so far is dropped too. Such a
   * frame is also a covered moment, so a pending level climb is taken then.
   */
  frame(metrics: FrameMetrics, judge = true) {
    if(this.disposed)return
    const wasLoading=this.loading
    const counted=this.history.observe(metrics,!document.hidden)
    if (this.counting) {
      const c = this.counting
      if (typeof metrics.pipelinesFresh === 'number') c.record.pipelinesCreated = (c.record.pipelinesCreated ?? 0) + metrics.pipelinesFresh
      c.leftMs -= Math.max(0, metrics.frameMs); if (c.leftMs <= 0) this.counting = null
    }
    if (this.loading && metrics.drawCalls > 0) {
      this.loading = false; finishLoad(this.session); reportLoading('ready', 1)
      // The load finished at this level: the three-tier settings have been carried over and can go.
      for (const store of [this.store, this.session]) { storageWrite(store, LEVEL_KEY, null); storageWrite(store, MANUAL_KEY, null) }
    }
    // Parameters of modules that loaded after the last level change get their level value now.
    if (this.appliedIds.size < PRESET_IDS.length && this.writePreset()) this.publishQuality()
    if (!this.loading) {
      const moved = this.governor.setDevicePixelRatio(window.devicePixelRatio || 1)
      let change = this.governor.sample(metrics.frameMs, judge && !document.hidden) ?? moved
      const covered = !change && !judge
      if (covered) change = this.governor.applyPendingClimb()
      if (change) { this.lastReason = change.reason; this.apply('governor', covered) }
    }
    const g=this.governor
    const eligible=!wasLoading&&!this.loading&&judge&&!document.hidden
    const botChanges=g.botChanges
    if(this.history.sample(metrics,eligible,{...g.settings,level:g.level,rung:g.rung,rungs:g.ladder.length,auto:g.auto,targetFps:Math.round(1000/g.targetMs)},this.botsNow())||counted||botChanges!==this.botChangesSeen)this.publishPerformance()
    this.botChangesSeen=botChanges
    // Ease toward the rung's budget: full while effects are not faded (or none are active).
    const wanted = this.governor.settings.kind === 'base' || this.governor.settings.post > 0 || !this.postOn() ? 1 : 0
    const step = Math.min(1, Math.max(0, metrics.frameMs) / 500)
    this.budget += Math.max(-step, Math.min(step, wanted - this.budget))
    this.hudElapsed += metrics.frameMs
    if (this.hud && !this.hud.hidden && this.hudElapsed >= 250) {
      this.hudElapsed = 0
      const g = this.governor, s = g.settings, kind = s.kind === 'base' ? 'full' : s.kind
      this.hud.textContent = `${qualityBudget().name} / ${metrics.fps.toFixed(0)} fps (target ${Math.round(1000 / g.targetMs)})\n`
        + `Rung ${g.rung}/${g.ladder.length - 1} ${kind}${g.auto ? '' : ' (auto off)'}\nPixel ratio ${s.pixelRatio.toFixed(2)} / shading ${s.vehicleShading}\n`
        + `Frame ${metrics.frameMs.toFixed(1)} ms${g.last ? ` / p90 ${g.last.p90.toFixed(1)}` : ''}\nPhysics ${metrics.physicsMs.toFixed(2)} ms\nDraws ${metrics.drawCalls} / triangles ${metrics.triangles.toLocaleString()}`
    }
  }
  dispose() {
    this.disposed=true;this.unsubscribe?.();this.performanceListeners.clear();this.qualityListeners.clear();this.environment=null
    if(typeof window!=='undefined')window.removeEventListener('keydown',this.onKey)
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',this.onVisibility)
    if(this.displayFrame!==null&&typeof cancelAnimationFrame!=='undefined')cancelAnimationFrame(this.displayFrame)
    this.hud?.remove()
  }
}

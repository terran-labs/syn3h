/** Local rendering budgets. World parameters and physics resolution are never changed here. */
import { type AdapterProbe, gpuDeadlineMs, graphicsOverride, probeAdapter } from './renderOptions'
import { defineParam, params } from '../../shared/params'
import type { WebGPURenderer } from 'three/webgpu'
export type GraphicsLevel = 0 | 1 | 2
export const graphicsLevel = defineParam({ id: 'gfx.level', label: 'Graphics: 0 safe, 1 mobile, 2 desktop', group: 'Graphics', scope: 'client', default: 2, min: 0, max: 2, step: 1 })
// Headed Metal profiling found resolution and bot draw submission dominate these budgets.
// Keep phone pixel density bounded; physical phone timing still needs validation.
export const QUALITY = [
  { name: 'safe', pixelRatio: 1, shadows: 0, particles: 240, bots: 2, drawDistance: 700, detail: 0.5 },
  { name: 'mobile', pixelRatio: 1, shadows: 0, particles: 960, bots: 4, drawDistance: 1400, detail: 0.75 },
  { name: 'desktop', pixelRatio: 1.5, shadows: 1, particles: 2400, bots: 8, drawDistance: 3000, detail: 1 },
] as const
/**
 * Vehicle surface shading, read by the vehicle skins: 0 plain standard materials, 1 lit
 * procedural detail, 2 adds the clear coat and glass, 3 adds flakes and iridescence. The
 * frame governor lowers this before it gives up a whole graphics level. The default is plain:
 * the governor raises it to what the device's graphics level allows, so a build without the
 * governor never puts the costly tiers on a phone.
 */
export const vehicleShading = defineParam({ id: 'gfx.vehicleShading', label: 'Vehicle shading: 0 plain to 3 showroom', group: 'Graphics', scope: 'client', default: 0, min: 0, max: 3, step: 1 })
export const levelNumber = (value: number): GraphicsLevel => Math.max(0, Math.min(2, Math.round(Number.isFinite(value) ? value : 0))) as GraphicsLevel
export function qualityBudget() { return QUALITY[levelNumber(graphicsLevel.value)] }
export interface DeviceHints { userAgent: string; touchPoints: number; memoryGB?: number; adapter?: 'available' | 'missing' | 'fallback'; maxTextureDimension2D?: number }
export function classifyDevice(hints: DeviceHints): GraphicsLevel {
  const mobile = /Android|iPhone|iPad|iPod/i.test(hints.userAgent) || /Macintosh/i.test(hints.userAgent) && hints.touchPoints > 1
  if ((hints.memoryGB !== undefined && hints.memoryGB <= 2) || hints.adapter === 'fallback' || (hints.maxTextureDimension2D !== undefined && hints.maxTextureDimension2D < 8192)) return 0
  if (mobile) return hints.adapter === 'missing' ? 0 : 1
  if (hints.adapter === 'missing' || (hints.memoryGB !== undefined && hints.memoryGB <= 4)) return 1
  return 2
}
export const LOAD_KEY = 'syn3h.loading.level'
export const LEVEL_KEY = 'syn3h.graphics.level'
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function storageRead(storage: StorageLike | null, key: string): string | null { try { return storage?.getItem(key) ?? null } catch { return null } }
function storageWrite(storage: StorageLike | null, key: string, value: string | null) { try { if (value === null) storage?.removeItem(key); else storage?.setItem(key, value) } catch { /* Private mode may reject storage writes. */ } }
/** An unfinished previous load lowers its previous level, including repeated failed loads. */
export function beginLoad(storage: StorageLike | null, detected: GraphicsLevel): GraphicsLevel {
  const pending = storageRead(storage, LOAD_KEY), saved = storageRead(storage, LEVEL_KEY)
  let level = Math.min(detected, saved === null ? 2 : levelNumber(Number(saved)))
  if (pending !== null) level = Math.min(level, Math.max(0, levelNumber(Number(pending)) - 1))
  storageWrite(storage, LOAD_KEY, String(level))
  return level as GraphicsLevel
}
export function finishLoad(storage: StorageLike | null) { storageWrite(storage, LOAD_KEY, null) }

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
// Performance cascade. Each graphics level has a short ladder of rungs that shed cost in
// small steps before the whole level is given up. The decision logic lives in
// QualityGovernor, which has no DOM or renderer dependency so synthetic frame traces can
// drive it in tests. QualityController feeds it real frames and applies its choices.
// ---------------------------------------------------------------------------------------

/** Automatic quality. Off keeps the fixed level budgets; only the load crash fallback remains. */
export const autoQuality = defineParam({ id: 'gfx.auto', label: 'Automatic quality', group: 'Graphics', scope: 'client', default: true })

/**
 * Highest vehicle shading each level allows. Safe is the crash recovery and low-memory
 * level, so it keeps the plain standard materials and compiles no extra shader variants.
 * Desktop allows everything. Mobile also stays plain for now: the showroom tiers have never
 * been timed on a phone or tablet, and their larger shaders would add to the first frame
 * wait already seen on iPad. Raise mobile to 1 or 2 once that is measured on a device; the
 * mobile ladder already has its shading rung and picks it up without other changes. A player
 * can still choose a higher tier by hand with gfx.vehicleShading.
 */
export const SHADING_CAP = [0, 0, 3] as const

export type RungKind = 'resolution' | 'shading' | 'particles' | 'shadows'
/** Effective render settings at one rung. pixelRatio already includes the display cap. */
export interface RungSettings { kind: RungKind | 'base'; pixelRatio: number; vehicleShading: number; particles: number; shadows: number }

/**
 * Rungs below each level's full budget, in shedding order. Each step changes one value and
 * keeps the others from the step above. Ordered by how little the player notices against
 * what it buys:
 * - Resolution first. Fill cost scales with pixel count (1.5 to 1.25 is 31 percent fewer
 *   pixels, 1.25 to 1 another 36 percent) and the antialiased upscale is hard to see while
 *   driving. It is also the cheapest change to make: a canvas resize, no shader compile.
 * - Vehicle shading next. It costs only where vehicles cover the screen, but losing flakes
 *   is subtle at speed. A change swaps materials, so it needs longer evidence.
 * - Particles. Halving the lava budget is barely visible and frees vertex and blend work.
 * - Shadows last. Losing them is the most visible rung and rebuilding the light
 *   recompiles every lit material.
 * The cascade is monotone across levels: the bottom of each level is at least as rich as
 * the top of the level below in every value, so a level drop never visibly upgrades
 * anything (safe's pixel ratio is the one exception, handled by the drop mapping). That is
 * why desktop sheds shading only to 2 and the step to 1 lives in the mobile ladder.
 */
export const LADDER_STEPS: ReadonlyArray<ReadonlyArray<readonly [RungKind, number]>> = [
  /* safe */ [['resolution', 0.85], ['particles', 120], ['resolution', 0.7]],
  /* mobile */ [['resolution', 0.85], ['shading', 1], ['particles', 480]],
  /* desktop */ [['resolution', 1.25], ['resolution', 1], ['shading', 2], ['particles', 1200], ['shadows', 0]],
]

/**
 * Evidence needed to shed a rung of each kind (consecutive slow time) and to climb back
 * (consecutive time with headroom, before backoff). Resolution reacts within two seconds
 * because a resize is invisible and cheap to undo. Material and shadow rungs cost a shader
 * compile hitch each way, so they wait longer and climb back much more reluctantly. The
 * whole-level drop keeps the previous monitor's eight seconds.
 */
export const RUNG_TIMING: Record<RungKind | 'level', { shedMs: number; climbMs: number }> = {
  resolution: { shedMs: 2000, climbMs: 10000 },
  particles: { shedMs: 4000, climbMs: 20000 },
  shading: { shedMs: 5000, climbMs: 30000 },
  shadows: { shedMs: 6000, climbMs: 45000 },
  level: { shedMs: 8000, climbMs: 60000 },
}

/** Frame rate each level aims for, never faster than the display. The previous monitor dropped below 54 and 28 fps, about ten percent under these. */
export const LEVEL_TARGET_FPS = [30, 30, 60] as const

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
}

/** Common display rates, used to snap the measured refresh interval. */
const DISPLAY_RATES = [240, 165, 144, 120, 100, 90, 75, 72, 60, 50, 48, 30]
function snapInterval(ms: number): number {
  for (const hz of DISPLAY_RATES) if (Math.abs(ms * hz / 1000 - 1) < 0.08) return 1000 / hz
  return ms
}

function sameSettings(a: RungSettings, b: RungSettings) {
  return a.pixelRatio === b.pixelRatio && a.vehicleShading === b.vehicleShading && a.particles === b.particles && a.shadows === b.shadows
}
function notAbove(a: RungSettings, b: RungSettings) {
  return a.pixelRatio <= b.pixelRatio && a.vehicleShading <= b.vehicleShading && a.particles <= b.particles && a.shadows <= b.shadows
}

/**
 * Effective rungs for one level on this display. Rung 0 is the level's fixed budget. Steps
 * that change nothing here (a 1.25 pixel ratio on a display of ratio 1, or a shading step
 * while the player has pinned shading) are dropped, so every rung costs a real change.
 */
export function buildLadder(level: GraphicsLevel, devicePixelRatio = 1, shadingPin: number | null = null): RungSettings[] {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const budget = QUALITY[level]
  let current: RungSettings = { kind: 'base', pixelRatio: Math.min(dpr, budget.pixelRatio), vehicleShading: shadingPin ?? SHADING_CAP[level], particles: budget.particles, shadows: budget.shadows }
  const ladder = [current]
  for (const [kind, value] of LADDER_STEPS[level]) {
    const next = { ...current, kind }
    if (kind === 'resolution') next.pixelRatio = Math.min(dpr, value)
    else if (kind === 'shading') next.vehicleShading = shadingPin ?? Math.min(current.vehicleShading, value)
    else if (kind === 'particles') next.particles = value
    else next.shadows = value
    if (sameSettings(next, current)) continue
    ladder.push(next); current = next
  }
  return ladder
}

export interface FrameWindow { frames: number; durationMs: number; p10: number; p90: number; p95: number }
export type GovernorReason = 'shed' | 'climb' | 'level-drop' | 'level-climb' | 'manual' | 'auto-off' | 'auto-on' | 'display'
export interface GovernorChange { level: GraphicsLevel; rung: number; reason: GovernorReason; settings: RungSettings }
export interface GovernorOptions {
  level: GraphicsLevel
  /** Highest level automatic climbs may reach: the detected device level and the crash fallback. */
  ceiling?: GraphicsLevel
  devicePixelRatio?: number
  auto?: boolean
  /** The player chose the level by hand: shed rungs inside it but never change the level. */
  levelPinned?: boolean
  /** The player chose vehicle shading by hand: never change it. */
  shadingPin?: number | null
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
 * Recovery: climbing back one rung needs that rung's climb time of continuous headroom,
 * multiplied by a backoff that doubles each time a climb to that state had to be undone
 * within the probation period, and halves each time a climb survives it.
 */
export class QualityGovernor {
  level: GraphicsLevel
  rung = 0
  ladder: RungSettings[] = []
  ceiling: GraphicsLevel
  auto: boolean
  levelPinned: boolean
  shadingPin: number | null
  devicePixelRatio: number
  /** Changes made by the governor itself, for diagnostics and oscillation tests. */
  changes = 0
  displayMs: number | null = null
  last: FrameWindow | null = null
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
  constructor(options: GovernorOptions) {
    this.level = options.level
    this.ceiling = options.ceiling ?? 2
    this.auto = options.auto ?? true
    this.levelPinned = options.levelPinned ?? false
    this.shadingPin = options.shadingPin ?? null
    this.devicePixelRatio = options.devicePixelRatio ?? 1
    this.ladder = this.ladderFor(this.level)
  }
  get settings(): RungSettings { return this.ladder[this.rung] }
  get key() { return `${this.level}:${this.rung}` }
  /** Frame interval the current level aims for. */
  get targetMs() { return Math.max(1000 / LEVEL_TARGET_FPS[this.level], this.displayMs ?? 0) }
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
   * idle probe frames; otherwise a desktop GPU bound at 45 fps from the start would snap to
   * "a 48 Hz display" and never shed.
   */
  private noteDisplay(p10: number, idle: boolean) {
    const display = snapInterval(p10)
    if (!idle && display > 1000 / 60 + 0.5) return
    if (this.displayMs === null || display < this.displayMs * 0.92) this.displayMs = display
  }
  /** Current climb wait for the rung above, in milliseconds, including backoff. */
  climbWaitMs(): number | null {
    const up = this.climbTarget()
    if (!up) return null
    return Math.min(GOVERNOR.maxClimbWaitMs, up.timing.climbMs * (this.backoff.get(`${up.level}:${up.rung}`) ?? 1))
  }
  private ladderFor(level: GraphicsLevel) { return buildLadder(level, this.devicePixelRatio, this.shadingPin) }
  private change(reason: GovernorReason, settleMs = GOVERNOR.settleMs): GovernorChange {
    this.settle = settleMs; this.clearEvidence()
    return { level: this.level, rung: this.rung, reason, settings: this.settings }
  }
  private clearEvidence() { this.window = []; this.windowMs = this.slowMs = this.cleanMs = 0 }
  /** First rung of the ladder that is nowhere richer than the given settings, so a remap never upgrades anything. */
  private mapRung(from: RungSettings) {
    const index = this.ladder.findIndex(rung => notAbove(rung, from))
    return index < 0 ? this.ladder.length - 1 : index
  }
  /** Automatic or startup reset to the top of a level, keeping pins. */
  reset(level: GraphicsLevel, reason: GovernorReason = 'manual') {
    this.level = level; this.ladder = this.ladderFor(level); this.rung = 0; this.probe = null
    return this.change(reason, GOVERNOR.manualSettleMs)
  }
  /** The player set the level by hand. It becomes the pinned level and the ladder restarts at its top. */
  setManualLevel(level: GraphicsLevel) { this.levelPinned = true; return this.reset(level, 'manual') }
  /** The player set vehicle shading by hand, or null to hand it back to the governor. Other rung values are kept. */
  setShadingPin(value: number | null) {
    const from = this.settings
    this.shadingPin = value; this.ladder = this.ladderFor(this.level)
    this.rung = this.mapRung({ ...from, vehicleShading: Infinity })
    return this.change('manual', GOVERNOR.manualSettleMs)
  }
  setCeiling(level: GraphicsLevel) { this.ceiling = level }
  /** The window moved to a display with another pixel ratio. Keeps every other rung value. */
  setDevicePixelRatio(dpr: number): GovernorChange | null {
    if (!(dpr > 0) || dpr === this.devicePixelRatio) return null
    const from = this.settings
    this.devicePixelRatio = dpr; this.ladder = this.ladderFor(this.level)
    // Keep the other values and start the new display at its richest resolution; slow frames shed it again within seconds.
    this.rung = this.mapRung({ ...from, pixelRatio: Infinity })
    return this.change('display')
  }
  /** Turning automation off returns to the level's fixed budget. Turning it on clears the player's pins. */
  setAuto(on: boolean) {
    this.auto = on
    if (on) { this.levelPinned = false; this.shadingPin = null; this.ladder = this.ladderFor(this.level); this.rung = 0; return this.change('auto-on', GOVERNOR.manualSettleMs) }
    this.rung = 0; this.probe = null
    return this.change('auto-off')
  }
  private climbTarget() {
    if (this.rung > 0) return { level: this.level, rung: this.rung - 1, timing: RUNG_TIMING[this.ladder[this.rung].kind as RungKind] }
    if (this.levelPinned || this.level >= this.ceiling) return null
    const level = (this.level + 1) as GraphicsLevel
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
    if (slow) {
      const timing = this.shedTiming()
      if (!timing || this.slowMs < timing.shedMs) return null
      return this.shed()
    }
    const wait = this.climbWaitMs()
    if (clean && wait !== null && this.cleanMs >= wait) return this.climb()
    return null
  }
  private shed(): GovernorChange {
    if (this.probe && this.clock < this.probe.until) {
      this.backoff.set(this.probe.key, Math.min(GOVERNOR.maxBackoff, (this.backoff.get(this.probe.key) ?? 1) * 2))
    }
    this.probe = null; this.changes++
    if (this.rung + 1 < this.ladder.length) { this.rung++; return this.change('shed') }
    const from = this.settings
    this.level = (this.level - 1) as GraphicsLevel; this.ladder = this.ladderFor(this.level); this.rung = this.mapRung(from)
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

export interface QualityTerrain { setRenderQuality?(options: { level: GraphicsLevel; drawDistance: number; detail: number }): void }
export interface FrameMetrics { fps: number; frameMs: number; physicsMs: number; drawCalls: number; triangles: number; firstFrameMs: number | null }
/** Values the cascade has actually applied, for consumers that need more than the level budget. */
export interface EffectiveQuality extends RungSettings { level: GraphicsLevel; rung: number; rungs: number; auto: boolean; targetFps: number }
let effective: EffectiveQuality = { ...buildLadder(2)[0], level: 2, rung: 0, rungs: buildLadder(2).length, auto: true, targetFps: 60 }
/** Latest applied rung values. qualityBudget() stays the fixed level budget. */
export function effectiveQuality(): EffectiveQuality { return effective }
/** Session flag: the level was chosen by hand, so automatic changes keep it. */
export const MANUAL_KEY = 'syn3h.graphics.manual'

/**
 * Manual and automatic interaction:
 * - A manual gfx.level change pins that level. The ladder restarts at the top of it and the
 *   governor may still shed rungs inside it under sustained pressure, but never drops or
 *   raises the level. The pin is kept in session storage across reloads.
 * - A manual gfx.vehicleShading change pins shading at that value, even above the level's
 *   cap. Shading rungs are skipped and the other rungs keep working.
 * - Turning gfx.auto off returns to the current level's fixed budget (rung 0) and makes no
 *   automatic changes; only the load crash fallback still lowers the level. Turning it on
 *   clears both pins and hands everything back to the governor.
 * - Automatic climbs never exceed the detected device level or the crash fallback level.
 * - Writes by the controller itself are not mistaken for manual changes. Shadow and
 *   particle parameters are only written when their effective value or the level changes,
 *   so a hand-set shadow quality survives until the cascade has to move shadows.
 */
export class QualityController {
  private storage: StorageLike | null = null
  private renderer: WebGPURenderer | null = null
  private terrain: QualityTerrain | null = null
  private hud: HTMLPreElement | null = null
  private hudElapsed = 0
  private loading = true
  private unsubscribe: (() => void) | null = null
  private detected: GraphicsLevel = 2
  private crashCap: GraphicsLevel = 2
  private writing = 0
  private written: { level: number; shadows: number; particles: number; shading: number; terrain: boolean } = { level: -1, shadows: -1, particles: -1, shading: -1, terrain: false }
  private lastReason: GovernorReason | 'start' = 'start'
  readonly governor: QualityGovernor
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.code !== 'F3' || event.repeat) return
    event.preventDefault()
    if (!this.hud) {
      this.hud = document.createElement('pre'); this.hud.id = 'frame-time-hud'
      this.hud.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:10000;padding:10px;background:#100e16e8;color:#d9f4dc;font:12px monospace;pointer-events:none;margin:0'
      document.body.append(this.hud)
    } else this.hud.hidden = !this.hud.hidden
  }
  constructor() {
    if (typeof window === 'undefined') { this.governor = new QualityGovernor({ level: levelNumber(graphicsLevel.value) }); return }
    // Session storage survives a tab reload without making another tab look crashed.
    try { this.storage = window.sessionStorage } catch { try { this.storage = window.localStorage } catch { /* No storage available. */ } }
    const nav = navigator as Navigator & { deviceMemory?: number }
    this.detected = classifyDevice({ userAgent: nav.userAgent, touchPoints: nav.maxTouchPoints, memoryGB: nav.deviceMemory })
    const pending = storageRead(this.storage, LOAD_KEY)
    if (pending !== null) this.crashCap = Math.max(0, levelNumber(Number(pending)) - 1) as GraphicsLevel
    const initial = beginLoad(this.storage, this.detected)
    // A level in the address (?gfx=) is a choice made by hand for this page load. It pins the
    // level like a hand-set gfx.level: rungs inside it may still be shed, the level itself is
    // never dropped or raised. It is not remembered in storage, so the next plain load is automatic.
    const override = graphicsOverride(location.search)
    this.write(graphicsLevel.def.id, override ?? initial)
    storageWrite(this.storage, LOAD_KEY, String(graphicsLevel.value))
    this.governor = new QualityGovernor({
      level: levelNumber(graphicsLevel.value), ceiling: Math.min(this.detected, this.crashCap) as GraphicsLevel, devicePixelRatio: window.devicePixelRatio || 1,
      auto: autoQuality.value, levelPinned: override !== undefined || storageRead(this.storage, MANUAL_KEY) !== null,
    })
    reportLoading('device', 0.05)
    this.probeDisplay()
    window.addEventListener('keydown', this.onKey)
    this.unsubscribe = params.onChange((id, value) => {
      if (id === graphicsLevel.def.id) {
        storageWrite(this.storage, LEVEL_KEY, String(levelNumber(graphicsLevel.value)))
        if (this.loading) storageWrite(this.storage, LOAD_KEY, String(levelNumber(graphicsLevel.value)))
        if (this.writing) return
        storageWrite(this.storage, MANUAL_KEY, '1')
        this.governor.setManualLevel(levelNumber(graphicsLevel.value)); this.lastReason = 'manual'; this.apply()
      } else if (this.writing) return
      else if (id === vehicleShading.def.id) { this.governor.setShadingPin(Number(value)); this.lastReason = 'manual'; this.apply() }
      else if (id === autoQuality.def.id) {
        if (value) storageWrite(this.storage, MANUAL_KEY, null)
        this.lastReason = this.governor.setAuto(Boolean(value)).reason; this.apply()
      }
    })
  }
  /**
   * While the game loads, many animation frames are idle, so their fastest intervals show
   * the display or browser frame cap before any heavy frame can disguise it.
   */
  private probeDisplay() {
    if (typeof requestAnimationFrame === 'undefined') return
    let last = -1
    const tick = (now: number) => {
      if (!this.loading) return
      if (last >= 0 && !document.hidden) this.governor.noteInterval(now - last)
      last = now; requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  /** Parameter writes made by the cascade, so the change listener does not treat them as the player's. */
  private write(id: string, value: number) { this.writing++; try { params.set(id, value) } finally { this.writing-- } }
  /** What the WebGPU adapter probe found; a stalled probe sends the renderer straight to WebGL 2. */
  adapterProbe: AdapterProbe = 'unsupported'
  async initialize() {
    const nav = navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(options?: { powerPreference: string }): Promise<{ isFallbackAdapter?: boolean; limits: { maxTextureDimension2D: number } } | null> } }
    // Bounded: a stalled requestAdapter used to hang the whole startup here.
    const { probe, adapter } = await probeAdapter(nav.gpu, { powerPreference: this.detected < 2 ? 'low-power' : 'high-performance' }, gpuDeadlineMs(location.search))
    this.adapterProbe = probe
    const detected = classifyDevice({ userAgent: nav.userAgent, touchPoints: nav.maxTouchPoints, memoryGB: nav.deviceMemory, adapter: probe === 'available' || probe === 'fallback' ? probe : 'missing', maxTextureDimension2D: adapter?.limits.maxTextureDimension2D })
    this.detected = detected
    this.governor.setCeiling(Math.min(detected, this.crashCap) as GraphicsLevel)
    const level = Math.min(graphicsLevel.value, detected) as GraphicsLevel
    if (level !== this.governor.level) { this.write(graphicsLevel.def.id, level); this.governor.reset(level, 'level-drop') }
    this.apply()
  }
  attachRenderer(renderer: WebGPURenderer) { this.renderer = renderer; this.apply() }
  /** Optional hook for terrain builders; no regeneration or physics changes are implied. */
  attachTerrain(terrain: QualityTerrain) { this.terrain = terrain; this.written.terrain = false; this.onTerrain?.(); this.apply() }
  /** Startup timing hook: main calls attachTerrain right after building the terrain. */
  onTerrain: (() => void) | null = null
  private apply() {
    const g = this.governor, level = g.level, budget = QUALITY[level], s = g.settings
    if (graphicsLevel.value !== level) this.write(graphicsLevel.def.id, level)
    const levelChanged = this.written.level !== level
    this.renderer?.setPixelRatio(s.pixelRatio)
    if (levelChanged || this.written.shadows !== s.shadows) this.write('gfx.shadowQuality', s.shadows)
    if (levelChanged || this.written.particles !== s.particles) this.write('lava.particleBudget', s.particles)
    if (levelChanged || this.written.shading !== s.vehicleShading) this.write(vehicleShading.def.id, s.vehicleShading)
    if (this.terrain && (levelChanged || !this.written.terrain)) { this.terrain.setRenderQuality?.({ level, drawDistance: budget.drawDistance, detail: budget.detail }); this.written.terrain = true }
    this.written = { ...this.written, level, shadows: s.shadows, particles: s.particles, shading: s.vehicleShading }
    effective = { ...s, level, rung: g.rung, rungs: g.ladder.length, auto: g.auto, targetFps: Math.round(1000 / g.targetMs) }
    window.dispatchEvent(new CustomEvent('syn3h:quality', { detail: { ...budget, ...effective, budget, reason: this.lastReason } }))
  }
  frame(metrics: FrameMetrics) {
    if (this.loading && metrics.drawCalls > 0) {
      this.loading = false; finishLoad(this.storage); reportLoading('ready', 1)
    }
    if (!this.loading) {
      const moved = this.governor.setDevicePixelRatio(window.devicePixelRatio || 1)
      const change = this.governor.sample(metrics.frameMs, !document.hidden) ?? moved
      if (change) { this.lastReason = change.reason; this.apply() }
    }
    this.hudElapsed += metrics.frameMs
    if (this.hud && !this.hud.hidden && this.hudElapsed >= 250) {
      this.hudElapsed = 0
      const g = this.governor, s = g.settings, kind = s.kind === 'base' ? 'full' : s.kind
      this.hud.textContent = `${qualityBudget().name} / ${metrics.fps.toFixed(0)} fps (target ${Math.round(1000 / g.targetMs)})\n`
        + `Rung ${g.rung}/${g.ladder.length - 1} ${kind}${g.auto ? '' : ' (auto off)'}\nPixel ratio ${s.pixelRatio.toFixed(2)} / shading ${s.vehicleShading}\n`
        + `Frame ${metrics.frameMs.toFixed(1)} ms${g.last ? ` / p90 ${g.last.p90.toFixed(1)}` : ''}\nPhysics ${metrics.physicsMs.toFixed(2)} ms\nDraws ${metrics.drawCalls} / triangles ${metrics.triangles.toLocaleString()}`
    }
  }
  dispose() { this.unsubscribe?.(); window.removeEventListener('keydown', this.onKey); this.hud?.remove() }
}

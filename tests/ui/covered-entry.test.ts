import { afterEach, expect, it, vi } from 'vitest'
import { Scene, error as rendererError } from 'three/webgpu'
import { guardDevice } from '../../src/core/deviceLoss'
import { Game, MANUAL_PREPARE_HARD_MS, MANUAL_PREPARE_SOFT_MS, type CoveredWarm, type System } from '../../src/core/Game'
import { startupReportLines } from '../../src/core/diagnostics'
import { Shell } from '../../src/ui/Shell'

function entry(systems: System[], gpuDone: () => Promise<void>) {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (frame: () => void) => setTimeout(frame, 1))
  const progress = { setAttribute: vi.fn(), remove: vi.fn(), textContent: '' }
  vi.stubGlobal('document', { createElement: () => progress })
  const render = vi.fn()
  const game = Object.assign(Object.create(Game.prototype), {
    systems, scene: new Scene(), renderer: { render, backend: { device: { queue: { onSubmittedWorkDone: gpuDone } } } },
  })
  const shell = Object.assign(Object.create(Shell.prototype), {
    game, element: { append: vi.fn() }, overlay: {}, waitForEntryWorld: async () => {},
    closeMenu: vi.fn(), showHelp: vi.fn(),
  })
  const entering = shell.enterWithoutFlight()
  return { shell, render, entering, progress }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('holds input and stages a changed world until its destination draws are ready', async () => {
  let ready!: () => void, warmed!: () => void
  const ground = { staged: false }
  const closeMenu = vi.fn()
  const shell = Object.assign(Object.create(Shell.prototype), {
    ground, game: { holdDraws: false }, overlay: { inert: false }, closeMenu, showHelp: vi.fn(),
    waitForEntryWorld: () => new Promise<void>(resolve => { ready = resolve }),
    warmEntryGraphics: vi.fn(() => new Promise<void>(resolve => { warmed = resolve })),
  })
  const apply = vi.fn(() => {
    expect(ground.staged).toBe(true)
    expect(shell.game.holdDraws && shell.overlay.inert).toBe(true)
  })
  const entering = shell.enterWithoutFlight(apply)
  await shell.enterWithoutFlight(apply)
  expect(apply).toHaveBeenCalledOnce()
  expect(shell.warmEntryGraphics).not.toHaveBeenCalled()
  ready()
  await Promise.resolve()
  expect(shell.warmEntryGraphics).toHaveBeenCalledOnce()
  expect(closeMenu).not.toHaveBeenCalled()
  warmed()
  await entering
  expect(ground.staged).toBe(false)
  expect(shell.game.holdDraws).toBe(false)
  expect(closeMenu).toHaveBeenCalledOnce()
})

it('opens play when GPU completion never arrives, even after a system fails', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const laterSystem = vi.fn(async () => {})
  const gpuDone = vi.fn(() => new Promise<void>(() => {}))
  const { shell, entering, progress } = entry([
    { warmCovered: async () => { throw new Error('broken effect') } },
    { warmCovered: laterSystem },
  ], gpuDone)
  await vi.advanceTimersByTimeAsync(2100)
  await entering
  expect(gpuDone).toHaveBeenCalledOnce()
  expect(laterSystem).toHaveBeenCalledOnce()
  expect(shell.game.holdDraws).toBe(false)
  expect(shell.closeMenu).toHaveBeenCalledOnce()
  expect(progress.remove).toHaveBeenCalledOnce()
  expect(startupReportLines().join('\n')).toMatch(/GPU completion timed out/)
  expect(startupReportLines().join('\n')).toMatch(/System warm-up failed/)
})

it('opens play at the overall deadline and prevents a late system from drawing', async () => {
  let resume!: () => void
  const waiting = new Promise<void>(resolve => { resume = resolve })
  const { shell, render, entering } = entry([{
    async warmCovered(warm: CoveredWarm) { await waiting; warm.draw() },
  }], async () => {})
  await vi.advanceTimersByTimeAsync(15_001)
  await entering
  expect(shell.game.holdDraws).toBe(false)
  expect(shell.closeMenu).toHaveBeenCalledOnce()
  const calls = render.mock.calls.length
  resume()
  await vi.advanceTimersByTimeAsync(5)
  expect(render).toHaveBeenCalledTimes(calls)
  expect(startupReportLines().join('\n')).toMatch(/Entry warm-up timed out/)
})

it('ends covered entry and reports one loss when its pending pipelines reject', async () => {
  const reload = vi.fn(), errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const device = {
    lost: new Promise(() => {}), popErrorScope: async () => null,
    createRenderPipelineAsync: async () => { throw new Error('A valid external Instance reference no longer exists') },
  }
  const { shell, entering } = entry([{
    async warmCovered() {
      await Promise.all([1, 2, 3].map(async id => {
        try { await device.createRenderPipelineAsync() }
        catch (err) { rendererError(`WebGPURenderer: Async render pipeline creation failed (${id}): ${(err as Error).message}`) }
      }))
    },
  }], () => new Promise<void>(() => {}))
  const renderer = shell.game.renderer
  Object.assign(renderer.backend.device, device)
  renderer.onDeviceLost = reload
  guardDevice(renderer)
  // Submit through the same guarded device used by the renderer.
  device.createRenderPipelineAsync = renderer.backend.device.createRenderPipelineAsync
  await vi.advanceTimersByTimeAsync(15_001)
  await entering
  expect(reload).toHaveBeenCalledOnce()
  expect(shell.game.holdDraws).toBe(false)
  expect(shell.closeMenu).toHaveBeenCalledOnce()
  expect(errors).not.toHaveBeenCalled()
  expect(warnings.mock.calls.filter(([line]) => String(line).includes('outstanding render pipelines'))).toHaveLength(1)
})

it.each(['dispose', 'deadline'])('releases a cold manual change on %s and prevents a late draw', async reason => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (frame: () => void) => setTimeout(frame, 1))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  let resume!: () => void
  const stalled = new Promise<void>(resolve => { resume = resolve })
  const draw = vi.fn()
  const game = Object.assign(Object.create(Game.prototype), {
    quality: { governor: { level: 3 }, settleCoveredPostBudget: vi.fn() },
    warmVisibleQuality: async (signal: AbortSignal) => { await stalled; signal.throwIfAborted(); draw() },
  })
  const apply = vi.fn()
  const stop = new AbortController()
  const change = game.prepareManualQuality(apply, stop.signal)
  expect(apply).not.toHaveBeenCalled()
  expect(game.applyingQuality).toBe(true)
  await vi.advanceTimersByTimeAsync(10)
  if (reason === 'dispose') stop.abort()
  else await vi.advanceTimersByTimeAsync(15000)
  await change
  expect(apply).toHaveBeenCalledOnce()
  expect(game.applyingQuality).toBe(false)
  resume()
  await vi.advanceTimersByTimeAsync(1)
  expect(draw).not.toHaveBeenCalled()
})

/** A Game with only what prepareManualQuality touches, its warm held until released. */
function slowManualChange() {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (frame: () => void) => setTimeout(frame, 1))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  // A draw stands for building the level's pipelines: none may happen once the change has returned.
  const draws: number[] = []
  let returned = false
  const late = () => draws.filter(at => at === 1).length
  const setLevel = vi.fn()
  const game = Object.assign(Object.create(Game.prototype), {
    quality: { governor: { level: 3 }, settleCoveredPostBudget: vi.fn(), takePixelRatio: vi.fn(), setLevel },
    manualQualityFallbacks: 0,
    warmVisibleQuality: async (signal: AbortSignal) => { await held; signal.throwIfAborted(); draws.push(returned ? 1 : 0) },
  })
  const apply = vi.fn()
  const change = (game.prepareManualQuality(apply, new AbortController().signal) as Promise<void>).then(() => { returned = true })
  return { game, apply, setLevel, change, release, draws, late }
}

it('keeps the veil past the soft deadline until a slow preparation finishes, building nothing after', async () => {
  const { game, apply, setLevel, change, release, draws, late } = slowManualChange()
  await vi.advanceTimersByTimeAsync(MANUAL_PREPARE_SOFT_MS + 5000)
  expect(game.applyingQuality).toBe(true)
  release()
  await vi.advanceTimersByTimeAsync(10)
  await change
  expect(apply).toHaveBeenCalledOnce()
  expect(draws).toEqual([0])
  expect(setLevel).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(late()).toBe(0)
})

it('returns to the previous level at the hard bound, building nothing after', async () => {
  const { game, setLevel, change, release, late } = slowManualChange()
  await vi.advanceTimersByTimeAsync(MANUAL_PREPARE_HARD_MS + 10)
  await change
  expect(game.applyingQuality).toBe(false)
  expect(setLevel).toHaveBeenCalledWith(3)
  expect(game.manualQualityFallbacks).toBe(1)
  release()
  await vi.advanceTimersByTimeAsync(1000)
  expect(late()).toBe(0)
})

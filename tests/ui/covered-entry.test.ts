import { afterEach, expect, it, vi } from 'vitest'
import { Scene, error as rendererError } from 'three/webgpu'
import { guardDevice } from '../../src/core/deviceLoss'
import { Game, type CoveredWarm, type System } from '../../src/core/Game'
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

it.each(['cancel', 'deadline'])('releases a cold manual change on %s and prevents a late draw', async reason => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (frame: () => void) => setTimeout(frame, 1))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  let resume!: () => void
  const stalled = new Promise<void>(resolve => { resume = resolve })
  const draw = vi.fn()
  const game = Object.assign(Object.create(Game.prototype), {
    quality: { settleCoveredPostBudget: vi.fn() },
    warmVisibleQuality: async (signal: AbortSignal) => { await stalled; signal.throwIfAborted(); draw() },
  })
  const apply = vi.fn()
  const stop = new AbortController()
  const change = game.prepareManualQuality(apply, stop.signal)
  expect(apply).not.toHaveBeenCalled()
  expect(game.applyingQuality).toBe(true)
  await vi.advanceTimersByTimeAsync(10)
  if (reason === 'cancel') stop.abort()
  else await vi.advanceTimersByTimeAsync(15000)
  await change
  expect(apply).toHaveBeenCalledOnce()
  expect(game.applyingQuality).toBe(false)
  resume()
  await vi.advanceTimersByTimeAsync(1)
  expect(draw).not.toHaveBeenCalled()
})

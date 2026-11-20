import { describe, expect, it, vi } from 'vitest'
import { LOSS_CONFIRM_MS, guardDevice, runGuarded, type DeviceLossInfo, type GuardedRenderer } from '../../src/core/deviceLoss'

/** A WebGPU-shaped device whose loss and error scopes the test controls. */
function fake() {
  let loseWith: (info: { reason?: string; message?: string }) => void = () => {}
  const device = {
    lost: new Promise<{ reason?: string; message?: string }>(resolve => { loseWith = resolve }),
    dropped: false,
    popErrorScope(): Promise<unknown> { return this.dropped ? Promise.reject(new Error('Instance dropped in popErrorScope')) : Promise.resolve(null) },
  }
  const losses: DeviceLossInfo[] = []
  let disposed = 0
  const renderer: GuardedRenderer = { backend: { device }, onDeviceLost: info => { losses.push(info) }, dispose: () => { disposed++ } }
  return { device, renderer, losses, lose: (info: { reason?: string; message?: string }) => loseWith(info), get disposed() { return disposed } }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('a lost WebGPU device', () => {
  it('turns a dropped instance into one reported loss, with no rejection reaching the page', async () => {
    const f = fake()
    expect(guardDevice(f.renderer)).toBe(true)
    f.device.dropped = true
    // three calls popErrorScope().then(...) with no catch, once per pipeline: none may reject.
    const results = await Promise.all(Array.from({ length: 50 }, () => f.device.popErrorScope()))
    expect(results.every(r => r === null)).toBe(true)
    expect(f.losses).toHaveLength(1)
    expect(f.losses[0]).toMatchObject({ api: 'WebGPU', reason: 'unknown' })
    expect(f.losses[0].message).toMatch(/Instance dropped/)
    expect(f.renderer._isDeviceLost).toBe(true)
  })

  it('finishes pending shader diagnostics on loss and preserves a healthy rejection', async () => {
    const f = fake()
    let reject!: (error: Error) => void
    const utils = { _reportShaderDiagnostics: () => new Promise<void>((_, fail) => { reject = fail }) }
    Object.assign(f.renderer.backend as object, { pipelineUtils: utils })
    guardDevice(f.renderer)
    const error = new Error('Instance dropped error in getCompilationInfo')
    const healthy = utils._reportShaderDiagnostics()
    reject(error)
    await expect(healthy).rejects.toBe(error)
    const pending = utils._reportShaderDiagnostics()
    f.lose({ reason: 'destroyed' })
    await settle()
    reject(error)
    await expect(pending).resolves.toBeUndefined()
  })

  it('counts a device destroyed by someone else as lost, but not the renderer disposing itself', async () => {
    const other = fake()
    guardDevice(other.renderer)
    other.lose({ reason: 'destroyed', message: '' })
    await settle()
    expect(other.losses).toHaveLength(1)
    expect(other.losses[0].reason).toBe('destroyed')

    const own = fake()
    guardDevice(own.renderer)
    own.renderer.dispose!()
    own.lose({ reason: 'destroyed', message: '' })
    await settle()
    expect(own.disposed).toBe(1)
    expect(own.losses).toHaveLength(0)
  })

  it('leaves the WebGL backend and a second call alone', () => {
    expect(guardDevice({ backend: { gl: {} }, onDeviceLost: () => {} })).toBe(false)
    const f = fake()
    expect(guardDevice(f.renderer)).toBe(true)
    expect(guardDevice(f.renderer)).toBe(false)
  })
})

/**
 * A game frame against a device whose instance has dropped. Like three, `render` returns early
 * once the renderer is marked lost; before that, it creates a vertex buffer for a mesh drawn for
 * the first time, and Chrome throws as it did on v26.11.1901's hosted check.
 */
function frameRig() {
  const f = fake()
  let gpuCalls = 0
  const createBuffer = () => {
    gpuCalls++
    if (f.device.dropped) throw new RangeError("Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed, size (48) is too large for the implementation when mappedAtCreation == true")
  }
  const render = () => { if (f.renderer._isDeviceLost) return; createBuffer() }
  const frame = () => runGuarded(f.renderer, () => { render() })
  return { ...f, frame, get gpuCalls() { return gpuCalls } }
}

describe('a game frame after the device is lost', () => {
  it('throws nothing in the window before the loss is reported, and nothing touches the GPU after it', async () => {
    vi.useFakeTimers()
    try {
      const r = frameRig()
      guardDevice(r.renderer)
      r.device.dropped = true
      // The instance is gone but device.lost has not resolved yet: frames still try to draw.
      for (let i = 0; i < 5; i++) expect(() => r.frame()).not.toThrow()
      r.lose({ reason: 'unknown', message: 'A valid external Instance reference no longer exists.' })
      // three's own handler marks the renderer lost when device.lost resolves.
      r.renderer._isDeviceLost = true
      const before = r.gpuCalls
      for (let i = 0; i < 60; i++) expect(() => r.frame()).not.toThrow()
      expect(r.gpuCalls).toBe(before)
      // The held error is dropped once the loss confirms it: nothing reaches the page later.
      expect(() => vi.advanceTimersByTime(LOSS_CONFIRM_MS + 10)).not.toThrow()
    } finally { vi.useRealTimers() }
  })

  it('still throws an ordinary bug at once, and a WebGPU error on a healthy device soon after', () => {
    vi.useFakeTimers()
    try {
      const r = frameRig()
      expect(() => runGuarded(r.renderer, () => { throw new TypeError('x is undefined') })).toThrow('x is undefined')
      // A failing WebGPU call with no loss behind it is a real error: held, then thrown.
      r.device.dropped = true
      expect(() => r.frame()).not.toThrow()
      expect(() => vi.advanceTimersByTime(LOSS_CONFIRM_MS + 10)).toThrow(/createBuffer/)
    } finally { vi.useRealTimers() }
  })
})

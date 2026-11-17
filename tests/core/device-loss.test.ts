import { describe, expect, it } from 'vitest'
import { guardDevice, type DeviceLossInfo, type GuardedRenderer } from '../../src/core/deviceLoss'

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

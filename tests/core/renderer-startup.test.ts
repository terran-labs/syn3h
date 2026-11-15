import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GPU_DEADLINE_MS, deviceLostMessage, gpuDeadlineMs, probeAdapter, startRenderer, withDeadline, type StartableRenderer } from '../../src/core/renderOptions'
import { type NoticeDocument, showRendererLost, startupTiming } from '../../src/core/diagnostics'

const never = <T>() => new Promise<T>(() => {})

/** A fake three.js renderer: `init` behaves as told, `backend` says which API it ended on. */
function fakeRenderer(init: () => Promise<unknown>, webgpu: boolean) {
  const r = { init: vi.fn(init), backend: { isWebGPUBackend: webgpu }, dispose: vi.fn() }
  return r as typeof r & StartableRenderer
}

describe('withDeadline', () => {
  it('reports a value, a rejection and a timeout', async () => {
    expect(await withDeadline(Promise.resolve(1), 50)).toEqual({ ok: true, value: 1 })
    const failed = await withDeadline(Promise.reject(new Error('no')), 50)
    expect(failed.ok).toBe(false)
    expect(!failed.ok && failed.reason).toBe('rejected')
    expect(await withDeadline(never(), 10)).toEqual({ ok: false, reason: 'timeout' })
  })
  it('waits forever when the deadline is off', async () => {
    const result = await Promise.race([withDeadline(never(), 0), new Promise(r => setTimeout(() => r('still waiting'), 30))])
    expect(result).toBe('still waiting')
  })
})

describe('gpuDeadlineMs', () => {
  it('defaults to 8 seconds and accepts an explicit value or 0', () => {
    expect(gpuDeadlineMs('')).toBe(DEFAULT_GPU_DEADLINE_MS)
    expect(gpuDeadlineMs('?gpudeadline=2500')).toBe(2500)
    expect(gpuDeadlineMs('?gpudeadline=0')).toBe(0)
    for (const bad of ['?gpudeadline=', '?gpudeadline=-1', '?gpudeadline=soon']) expect(gpuDeadlineMs(bad)).toBe(DEFAULT_GPU_DEADLINE_MS)
  })
})

describe('probeAdapter', () => {
  it('classifies stalled, rejected, missing, fallback and available adapters', async () => {
    expect((await probeAdapter(undefined, {}, 50)).probe).toBe('unsupported')
    expect((await probeAdapter({ requestAdapter: () => never() }, {}, 10)).probe).toBe('timeout')
    expect((await probeAdapter({ requestAdapter: () => Promise.reject(new Error('blocked')) }, {}, 50)).probe).toBe('rejected')
    expect((await probeAdapter({ requestAdapter: () => { throw new Error('sync') } }, {}, 50)).probe).toBe('rejected')
    expect((await probeAdapter({ requestAdapter: async () => null }, {}, 50)).probe).toBe('missing')
    expect((await probeAdapter({ requestAdapter: async () => ({ isFallbackAdapter: true }) }, {}, 50)).probe).toBe('fallback')
    const healthy = await probeAdapter({ requestAdapter: async () => ({ isFallbackAdapter: false }) }, {}, 50)
    expect(healthy.probe).toBe('available')
    expect(healthy.adapter).toEqual({ isFallbackAdapter: false })
  })
})

describe('startRenderer', () => {
  it('leaves a healthy WebGPU start alone', async () => {
    const make = vi.fn(() => fakeRenderer(async () => {}, true))
    const started = await startRenderer(make, { forceWebGL: false, deadlineMs: 50, probe: 'available' })
    expect(make).toHaveBeenCalledTimes(1)
    expect(make).toHaveBeenCalledWith(false, false)
    expect(started.fallbackReason).toBeUndefined()
  })
  it('honours ?webgl=1 without recording a fallback', async () => {
    const make = vi.fn(() => fakeRenderer(async () => {}, false))
    const started = await startRenderer(make, { forceWebGL: true, deadlineMs: 50 })
    expect(make).toHaveBeenCalledWith(true, false)
    expect(started.fallbackReason).toBeUndefined()
  })
  it('falls back to WebGL 2 on a fresh canvas when WebGPU init stalls', async () => {
    const stalled = fakeRenderer(() => never(), true)
    const webgl = fakeRenderer(async () => {}, false)
    const make = vi.fn((force: boolean) => force ? webgl : stalled)
    const started = await startRenderer(make, { forceWebGL: false, deadlineMs: 10, probe: 'available' })
    expect(started.renderer).toBe(webgl)
    expect(make).toHaveBeenLastCalledWith(true, true)
    expect(started.fallbackReason).toMatch(/longer than 10 ms.*WebGL 2/)
  })
  it('disposes a stalled renderer that finishes late', async () => {
    let finish!: () => void
    const late = new Promise<void>(r => { finish = r })
    const stalled = fakeRenderer(() => late, true)
    await startRenderer(force => force ? fakeRenderer(async () => {}, false) : stalled, { forceWebGL: false, deadlineMs: 10 })
    expect(stalled.dispose).not.toHaveBeenCalled()
    finish(); await late; await new Promise(r => setTimeout(r, 0))
    expect(stalled.dispose).toHaveBeenCalledTimes(1)
  })
  it('falls back to WebGL 2 when WebGPU init rejects', async () => {
    const rejected = fakeRenderer(() => Promise.reject(new Error('device request refused')), true)
    const webgl = fakeRenderer(async () => {}, false)
    const started = await startRenderer(force => force ? webgl : rejected, { forceWebGL: false, deadlineMs: 50 })
    expect(started.renderer).toBe(webgl)
    expect(rejected.dispose).toHaveBeenCalled()
    expect(started.fallbackReason).toMatch(/device request refused/)
  })
  it('records why when three.js fell back by itself for a missing adapter', async () => {
    const make = vi.fn(() => fakeRenderer(async () => {}, false))
    const started = await startRenderer(make, { forceWebGL: false, deadlineMs: 50, probe: 'missing' })
    expect(make).toHaveBeenCalledTimes(1)
    expect(started.fallbackReason).toMatch(/no WebGPU adapter/)
  })
  it('skips WebGPU when the adapter probe already stalled', async () => {
    const make = vi.fn(() => fakeRenderer(async () => {}, false))
    const started = await startRenderer(make, { forceWebGL: false, deadlineMs: 50, skipWebGPU: 'probe stalled', probe: 'timeout' })
    expect(make).toHaveBeenCalledTimes(1)
    expect(make).toHaveBeenCalledWith(true, false)
    expect(started.fallbackReason).toBe('probe stalled')
  })
  it('surfaces a failure when WebGL 2 cannot start either', async () => {
    await expect(startRenderer(force => fakeRenderer(() => Promise.reject(new Error(force ? 'no webgl2' : 'no webgpu')), !force), { forceWebGL: false, deadlineMs: 50 })).rejects.toThrow('no webgl2')
  })
})

describe('device loss', () => {
  function fakeDocument() {
    const nodes: Record<string, unknown>[] = []
    const make = () => {
      const node = { id: '', textContent: null as string | null, style: { cssText: '' }, attrs: {} as Record<string, string>, children: [] as unknown[], listeners: [] as (() => void)[],
        setAttribute(name: string, value: string) { node.attrs[name] = value }, append(...n: unknown[]) { node.children.push(...n) }, addEventListener(_t: string, l: () => void) { node.listeners.push(l) } }
      return node
    }
    const doc = { body: { append: (n: Record<string, unknown>) => nodes.push(n) }, getElementById: (id: string) => nodes.find(n => n.id === id) ?? null, createElement: make }
    return { doc: doc as unknown as NoticeDocument, nodes }
  }
  it('shows one notice with a reload action and records the loss', () => {
    const { doc, nodes } = fakeDocument()
    const reload = vi.fn()
    expect(showRendererLost({ api: 'WebGPU', reason: 'unknown', message: 'GPU reset' }, doc, reload)).toBe(true)
    expect(showRendererLost({ api: 'WebGL', message: 'again' }, doc, reload)).toBe(false)
    expect(nodes).toHaveLength(1)
    const box = nodes[0] as { attrs: Record<string, string>; children: { textContent: string; listeners: (() => void)[] }[] }
    expect(box.attrs.role).toBe('alert')
    expect(box.children[0].textContent).toBe('The graphics device was lost (GPU reset). Reload to keep playing.')
    box.children[1].listeners[0]()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(startupTiming.deviceLost).toBe('WebGL: again')
  })
  it('names a lost WebGL context', () => {
    expect(deviceLostMessage({ api: 'WebGL', message: 'Unknown reason' })).toBe('The WebGL context was lost. Reload to keep playing.')
    expect(deviceLostMessage(undefined)).toBe('The graphics device was lost. Reload to keep playing.')
  })
})

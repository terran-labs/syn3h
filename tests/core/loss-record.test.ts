import { describe, expect, it } from 'vitest'
import { LOSS_KEY, LossRecorder } from '../../src/core/lossRecord'
import { deviceLostMessage } from '../../src/core/renderOptions'

/**
 * The owner lost the GPU device on an iPhone several times a day; the notice asked him to reload
 * and the evidence went with the page. The record must keep what the browser said, verbatim, and
 * reach the next page's Diagnostics report.
 */
function memoryStorage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
const renderer = { getPixelRatio: () => 1, domElement: { width: 390, height: 664 }, info: { memory: { textures: 35, texturesSize: 26_000_000, geometries: 189, attributesSize: 14_000_000, renderTargets: 9, programs: 218, total: 45_000_000 } } }
const ctx = { level: () => 2, rung: () => 1, view: () => 'playing', frames: () => 1234 }

describe('device loss record', () => {
  it("keeps Safari's empty message and 'destroyed' reason as given, and says we did not dispose", () => {
    const storage = memoryStorage()
    const recorder = new LossRecorder(renderer, ctx, storage)
    recorder.note('quality level 2 rung 1')
    const r = recorder.record({ api: 'WebGPU', reason: 'destroyed', message: '', originalEvent: { reason: 'destroyed', message: '' } }, false)
    expect(r).toMatchObject({ reason: 'destroyed', message: '', weDisposed: false, level: 2, rung: 1, canvas: [390, 664], view: 'playing', frames: 1234 })
    expect(r.recent.some(e => /quality level 2/.test(e))).toBe(true)
    expect(JSON.parse(storage.getItem(LOSS_KEY)!)).toMatchObject({ reason: 'destroyed', message: '' })
  })
  it("reaches the next page's report after the reload", () => {
    const storage = memoryStorage()
    new LossRecorder(renderer, ctx, storage).record({ api: 'WebGPU', reason: 'unknown', message: 'GPU reset', originalEvent: { reason: 'unknown', message: 'GPU reset' } }, false)
    const next = new LossRecorder(renderer, ctx, storage)
    const lines = next.reportLines().join('\n')
    expect(lines).toMatch(/Device loss on the previous page in this tab/)
    expect(lines).toMatch(/reason 'unknown', message 'GPU reset', we did not dispose/)
    expect(next.current).toBeNull()
  })
  it("tells the player the browser's graphics process stopped, not that the device was destroyed", () => {
    expect(deviceLostMessage({ api: 'WebGPU', reason: 'destroyed', message: '' })).toBe("The browser's graphics process stopped. Reload to keep playing.")
    expect(deviceLostMessage({ api: 'WebGPU', reason: 'unknown', message: 'GPU reset' })).toBe('The graphics device was lost (GPU reset). Reload to keep playing.')
  })
})

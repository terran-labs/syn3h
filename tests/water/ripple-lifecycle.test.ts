/**
 * The ripple field ping-pongs between two targets. A step must never sample the texture it
 * is rendering into: WebGPU rejects that bind group and WebGL reads undefined data. The
 * buffers are reallocated on configure, on a window resize and on disable then re-enable,
 * and each of those must restart the ping-pong whatever parity the previous steps left.
 */
import { describe, it, expect } from 'vitest'
import * as T from 'three/webgpu'
import { Ripples, waterRipples, waterRippleSize } from '../../src/world/water/ripples'

/** Records, for every simulation draw, whether the bound target is also the sampled source. */
function harness() {
  const field = new Ripples()
  let target: T.RenderTarget | null = null
  const draws: boolean[] = []
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (t: T.RenderTarget | null) => { target = t },
    getClearColor: (c: T.Color) => c, getClearAlpha: () => 1, setClearColor: () => {}, clear: () => {},
    render: () => { draws.push(!!target && (field as any).source.value === target.texture) },
  }
  field.attach(renderer as unknown as T.WebGPURenderer)
  const step = (count: number) => { for (let i = 0; i < count; i++) field.update(0, 0, 0) }
  return { field, draws, step }
}

const reallocations: Record<string, (h: ReturnType<typeof harness>) => void> = {
  configure: h => h.field.configure(1024),
  'window resize': () => { waterRippleSize.value = ((waterRippleSize.value as number) === 128 ? 96 : 128) as typeof waterRippleSize.value },
  'disable then re-enable': h => { waterRipples.value = false; h.step(1); waterRipples.value = true },
}

describe('ripple buffer lifecycle', () => {
  for (const [name, reallocate] of Object.entries(reallocations)) for (const prior of [0, 1, 2, 3]) {
    it(`never samples its own render target after ${name}, ${prior} prior steps`, () => {
      const enabled = waterRipples.value, size = waterRippleSize.value
      waterRipples.value = true
      const h = harness()
      try {
        h.step(prior)
        reallocate(h)
        h.step(4)
        expect(h.draws.length).toBeGreaterThanOrEqual(prior + 4)
        expect(h.draws).not.toContain(true)
      } finally { h.field.dispose(); waterRipples.value = enabled; waterRippleSize.value = size }
    })
  }
})

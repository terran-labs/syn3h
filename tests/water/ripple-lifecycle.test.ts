/**
 * The ripple field ping-pongs between two targets. A step must never sample the texture it
 * is rendering into: WebGPU rejects that bind group and WebGL reads undefined data. Resuming a field must preserve the ping-pong order at either parity.
 */
import { describe, it, expect } from 'vitest'
import * as T from 'three/webgpu'
import { Ripples, waterRipples, waterRippleSize } from '../../src/world/water/ripples'

/** Records, for every simulation draw, whether the bound target is also the sampled source. */
function harness() {
  const field = new Ripples()
  let target: T.RenderTarget | null = null
  const draws: boolean[] = []
  const cleared: T.RenderTarget[] = []
  const materials: T.Material[] = []
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (t: T.RenderTarget | null) => { target = t },
    getClearColor: (c: T.Color) => c, getClearAlpha: () => 1, setClearColor: () => {}, clear: () => { if(target) cleared.push(target) },
    render: (quad: T.QuadMesh) => { materials.push(quad.material as T.Material); draws.push(!!target && (field as any).source.value === target.texture) },
  }
  field.attach(renderer as unknown as T.WebGPURenderer)
  // The field sleeps until something disturbs the water, and a sleeping field draws nothing.
  // This test is about the awake field, so every step makes a splash first.
  const step = (count: number) => { for (let i = 0; i < count; i++) { field.disturb(0, 0, 2, 1); field.update(1 / 60, 0, 0) } }
  return { field, draws, step, cleared, materials }
}

const transitions: Record<string, (h: ReturnType<typeof harness>) => void> = {
  configure: h => h.field.configure(1024),
  'window resize': () => { waterRippleSize.value = ((waterRippleSize.value as number) === 128 ? 96 : 128) as typeof waterRippleSize.value },
  'disable then re-enable': h => { waterRipples.value = false; h.step(1); waterRipples.value = true },
}

describe('ripple buffer lifecycle', () => {
  for (const [name, change] of Object.entries(transitions)) for (const prior of [0, 1, 2, 3]) {
    it(`never samples its own render target after ${name}, ${prior} prior steps`, () => {
      const enabled = waterRipples.value, size = waterRippleSize.value
      waterRipples.value = true
      const h = harness()
      try {
        h.step(prior)
        const originalTargets = h.cleared.slice()
        h.cleared.length = 0
        change(h)
        h.step(4)
        expect(h.draws.length).toBeGreaterThanOrEqual(prior + 4)
        expect(h.draws).not.toContain(true)
        if (prior) {
          expect(new Set(h.materials).size).toBe(1)
          expect(h.cleared).toHaveLength(2)
          expect(h.cleared[0]).toBe(originalTargets[0])
          expect(h.cleared[1]).toBe(originalTargets[1])
        }
      } finally { h.field.dispose(); waterRipples.value = enabled; waterRippleSize.value = size }
    })
  }
})

import { afterEach, describe, expect, it } from 'vitest'
import { qualityLevel } from '../../src/core/quality'
import { refractionOn, refractionState, waterRefraction } from '../../src/world/water/refraction'

/**
 * Refraction copies the frame in the middle of the scene pass. On WebGL 2 that measured 1.5 ms a
 * frame on a phone-sized view, and Low must stay as cheap as before: neither may ever copy.
 */
const webgpu = (target: unknown = {}) => ({ backend: { isWebGPUBackend: true }, getRenderTarget: () => target })
const webgl = (target: unknown = {}) => ({ backend: { isWebGLBackend: true }, getRenderTarget: () => target })

describe('refraction gate', () => {
  const level = qualityLevel.value, strength = waterRefraction.value
  afterEach(() => { qualityLevel.value = level; waterRefraction.value = strength })

  it('never copies on WebGL 2 or below Medium', () => {
    waterRefraction.value = 1
    for (const l of [0, 1, 2, 3, 4, 5]) {
      qualityLevel.value = l
      expect(refractionOn(webgl())).toBe(false)
      expect(refractionOn(webgpu())).toBe(l >= 2)
    }
    expect(refractionState(webgl())).toBe('off: WebGL 2')
  })

  it('never copies outside a render target or when turned off', () => {
    qualityLevel.value = 3
    waterRefraction.value = 1
    expect(refractionOn(webgpu(null))).toBe(false)
    waterRefraction.value = 0
    expect(refractionOn(webgpu())).toBe(false)
  })
})

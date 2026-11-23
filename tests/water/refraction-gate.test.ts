import { afterEach, describe, expect, it } from 'vitest'
import { qualityLevel } from '../../src/core/quality'
import { refractionOn, refractionState, waterRefraction, waterRefractionUnproven } from '../../src/world/water/refraction'

/**
 * Refraction copies the frame in the middle of the scene pass. On WebGL 2 that measured 1.5 ms a
 * frame on a phone-sized view, and Low must stay as cheap as before: neither may ever copy.
 */
const webgpu = (target: unknown = {}) => ({ backend: { isWebGPUBackend: true }, getRenderTarget: () => target })
const webgl = (target: unknown = {}) => ({ backend: { isWebGLBackend: true }, getRenderTarget: () => target })

describe('refraction gate', () => {
  const level = qualityLevel.value, strength = waterRefraction.value, unproven = waterRefractionUnproven.value
  afterEach(() => { qualityLevel.value = level; waterRefraction.value = strength; waterRefractionUnproven.value = unproven })

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

  // The owner on v26.11.2301, an iPhone: dozens of black frames a minute in Mire. Until it is
  // proven there, a phone, a tablet or Safari never breaks the scene pass to copy it.
  it('never copies on a touch device or in WebKit unless the player turns it on', () => {
    qualityLevel.value = 3
    waterRefraction.value = 1
    waterRefractionUnproven.value = false
    for (const device of [{ webkit: true, touch: true }, { webkit: true, touch: false }, { webkit: false, touch: true }]) {
      expect(refractionOn(webgpu(), device)).toBe(false)
      expect(refractionState(webgpu(), device)).toBe('off: not yet proven on this device')
    }
    expect(refractionOn(webgpu(), { webkit: false, touch: false })).toBe(true)
    // By hand it comes on (so a later fix can be tried on a phone), and the strength still turns it off.
    waterRefractionUnproven.value = true
    expect(refractionOn(webgpu(), { webkit: true, touch: true })).toBe(true)
    waterRefraction.value = 0
    expect(refractionOn(webgpu(), { webkit: true, touch: true })).toBe(false)
  })
})

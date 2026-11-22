import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { params } from '../../shared/params'
import { qualityLevel } from '../../src/core/quality'
import { glassStyle } from '../../src/ui/inspector/params'
import { liquidSelected, restoreGlassMaterial } from '../../src/ui/glassMaterial'

describe('the saved interface material', () => {
  let stop: () => void
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    params.set(glassStyle.def.id, glassStyle.def.default)
    params.set(qualityLevel.def.id, 2)
  })
  afterEach(() => {
    stop()
    params.set(glassStyle.def.id, glassStyle.def.default)
    params.set(qualityLevel.def.id, qualityLevel.def.default)
    vi.unstubAllGlobals()
  })
  it('preserves Liquid across a drop, reload and return to Medium', () => {
    stop = restoreGlassMaterial(false)
    expect(document.documentElement.dataset.glassMaterial).toBe('glass')
    params.set(glassStyle.def.id, 0)
    for (const level of [1, 0]) {
      params.set(qualityLevel.def.id, level)
      expect(liquidSelected()).toBe(false)
      expect(document.documentElement.dataset.glassMaterial).toBe('glass')
      expect(glassStyle.value).toBe(0)
    }
    stop()
    params.set(glassStyle.def.id, 1)
    stop = restoreGlassMaterial(false)
    expect(glassStyle.value).toBe(0)
    params.set(qualityLevel.def.id, 2)
    expect(liquidSelected()).toBe(true)
    expect(document.documentElement.dataset.glassMaterial).toBe('liquid')
  })
  it('opens a Liquid shortcut without overwriting the saved material', () => {
    stop = restoreGlassMaterial(false)
    params.set(glassStyle.def.id, 3)
    stop()
    stop = restoreGlassMaterial(true)
    expect(liquidSelected()).toBe(true)
    stop()
    stop = restoreGlassMaterial(false)
    expect(document.documentElement.dataset.glassMaterial).toBe('flat')
  })
})

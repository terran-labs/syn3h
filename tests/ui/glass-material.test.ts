import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { params, surfaceCoverage } from '../../shared/params'
import { qualityLevel } from '../../src/core/quality'
import { glassStyle } from '../../src/ui/inspector/params'
import { glassLabels, liquidSelected, restoreGlassMaterial } from '../../src/ui/glassMaterial'

describe('the saved interface material', () => {
  let stop: () => void
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    params.set(surfaceCoverage.def.id, surfaceCoverage.def.default)
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    vi.stubGlobal('document', { documentElement: { dataset: {}, style: { setProperty: vi.fn() } } })
    params.set(glassStyle.def.id, glassStyle.def.default)
    params.set(qualityLevel.def.id, 2)
  })
  afterEach(() => {
    stop()
    params.set(glassStyle.def.id, glassStyle.def.default)
    params.set(qualityLevel.def.id, qualityLevel.def.default)
    vi.unstubAllGlobals()
  })
  it.each([[0, 'liquid'], [1, 'frost'], [2, 'frost'], [3, 'flat']] as const)('migrates old stop %i to %s', (old, expected) => {
    storage.set('syn3h.glassMaterial.v1', String(old))
    stop = restoreGlassMaterial(false)
    expect(document.documentElement.dataset.glassMaterial).toBe(expected)
    expect(storage.get('syn3h.glassMaterial.v2')?.toLowerCase()).toBe(expected)
  })
  it('preserves Liquid across a drop, reload and return to Medium', () => {
    stop = restoreGlassMaterial(false)
    expect(document.documentElement.dataset.glassMaterial).toBe(glassLabels[glassStyle.def.default].toLowerCase())
    params.set(glassStyle.def.id, 0)
    for (const level of [1, 0]) {
      params.set(qualityLevel.def.id, level)
      expect(liquidSelected()).toBe(false)
      expect(document.documentElement.dataset.glassMaterial).toBe(glassLabels[glassStyle.def.default].toLowerCase())
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
  it('restores the same tint when the player changes materials or reloads', () => {
    stop = restoreGlassMaterial(false)
    params.set(surfaceCoverage.def.id, 72)
    params.set(glassStyle.def.id, 2)
    stop()
    params.set(surfaceCoverage.def.id, surfaceCoverage.def.default)
    stop = restoreGlassMaterial(false)
    expect(surfaceCoverage.value).toBe(72)
    expect(document.documentElement.dataset.glassMaterial).toBe('flat')
  })
  it('opens a Liquid shortcut without overwriting the saved material', () => {
    stop = restoreGlassMaterial(false)
    params.set(glassStyle.def.id, 2)
    stop()
    stop = restoreGlassMaterial(true)
    expect(liquidSelected()).toBe(true)
    stop()
    stop = restoreGlassMaterial(false)
    expect(document.documentElement.dataset.glassMaterial).toBe('flat')
  })
})

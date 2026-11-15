/**
 * The ground shader follows the performance level: each level's detail share picks a tier,
 * and the tier caps the player's own sliders without overwriting them.
 */
import { describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { QUALITY } from '../../src/core/quality'
import { createTerrainMaterial, groundTier, terrainDetailNormal } from '../../src/world/terrain/material'

describe('ground shading by performance level', () => {
  it('maps the current levels: safe plain, mobile colour only, desktop everything', () => {
    expect(QUALITY.map((q) => groundTier(q.detail))).toEqual([0, 1, 2])
  })

  it('is monotone in the detail share, so any number of levels maps onto it', () => {
    let last = 0
    for (let share = 0; share <= 1.0001; share += 0.05) {
      const tier = groundTier(share)
      expect(tier).toBeGreaterThanOrEqual(last)
      last = tier
    }
    expect(groundTier(0)).toBe(0)
    expect(groundTier(1)).toBe(2)
  })

  it('rebuilds the shader only when the rich surface goes on or off, and leaves the sliders alone', () => {
    const look = createTerrainMaterial()
    const version = () => look.material.version
    const start = version()
    look.setDetail(1)
    expect(version()).toBe(start) // already full
    look.setDetail(0.75)
    expect(version()).toBe(start) // colour only: uniforms, no compile
    look.setDetail(0.5)
    expect(version()).toBeGreaterThan(start) // plain: the small shader
    const plain = version()
    look.setDetail(1)
    expect(version()).toBeGreaterThan(plain)
    // The player's own slider was never written.
    expect(terrainDetailNormal.value).toBe(params.get('terrain.detailNormal')?.def.default)
  })
})

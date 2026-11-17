/**
 * Particles never exceed the quality level's budget: vents and the ambient lava field share
 * it, and their shares together stay inside it at every level and slider setting.
 */
import { describe, expect, it } from 'vitest'
import { LEVELS } from '../../src/core/quality'
import { PARTICLE_SHARES } from '../../src/fx/params'
import { AMBIENT_CAPACITY, ambientCount } from '../../src/fx/LavaAmbient'
import { MOTE_CAPACITY, motesFor } from '../../src/world/water/motes'

describe('lava particle budget', () => {
  it('vents plus the ambient field stay within the budget at every level and amount', () => {
    for (const level of LEVELS) for (const slider of [0, 240, 2400, 4800]) for (const fire of [0, 1, 2]) for (const embers of [0, 1, 2]) {
      const budget = Math.min(slider, level.particles)
      const vents = Math.floor(budget * PARTICLE_SHARES.vents)
      const ambient = ambientCount(budget, fire, embers)
      expect(ambient).toBeGreaterThanOrEqual(0)
      expect(ambient).toBeLessThanOrEqual(AMBIENT_CAPACITY)
      expect(vents + ambient).toBeLessThanOrEqual(budget)
    }
  })
  it('turns the ambient field off with both amounts at zero', () => {
    expect(ambientCount(4800, 0, 0)).toBe(0)
  })
  it('keeps underwater motes to a tenth of the level budget and the batch', () => {
    for (const level of LEVELS) {
      expect(motesFor(level.particles)).toBeLessThanOrEqual(Math.floor(level.particles * 0.1))
      expect(motesFor(level.particles)).toBeLessThanOrEqual(MOTE_CAPACITY)
    }
  })
})

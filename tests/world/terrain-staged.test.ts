import { describe, expect, it, vi } from 'vitest'
import { ProceduralTerrain } from '../../src/world/terrain/ProceduralTerrain'

/**
 * A world rebuilt in slices behind the dive (regenerateStaged) must always finish, even when
 * a step throws: the dive waits on whenReady(), and a ground that never reports ready would
 * hold every later descent and reject into the page.
 */
describe('a staged terrain rebuild', () => {
  function terrain(steps: () => Generator<undefined>) {
    const t = Object.create(ProceduralTerrain.prototype) as { rebuildSteps: () => Generator<undefined>; regenerateStaged(): Promise<void>; readonly ready: boolean; whenReady(): Promise<void> }
    Object.assign(t, { serial: 0, building: 0, built: Promise.resolve() })
    t.rebuildSteps = steps
    return t
  }

  it('reports ready and resolves when a step throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const t = terrain(function* () { yield; throw new Error('mesh build failed') })
      const done = t.regenerateStaged()
      expect(t.ready).toBe(false)
      await expect(done).resolves.toBeUndefined()
      expect(t.ready).toBe(true)
      await expect(t.whenReady()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledOnce()
    } finally { warn.mockRestore() }
  })

})

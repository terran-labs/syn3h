import { expect, it } from 'vitest'
import { DirectionalLight, Scene } from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game } from '../../src/core/Game'
import { createEnvironment } from '../../src/world/Environment'
import type { Terrain } from '../../src/world/Terrain'
import { shadowQuality } from '../../src/world/sky/skyParams'

it('suspends Low shadow draws and restores Medium on the same sun and cascades', () => {
  const scene = new Scene()
  const previous = shadowQuality.value
  params.set(shadowQuality.def.id, 1)
  const environment = createEnvironment({ scene } as Game, { size: 0 } as Terrain)
  try {
    const sun = scene.children.find(o => o instanceof DirectionalLight)!
    const readRig = () => (sun.shadow as typeof sun.shadow & { shadowNode?: object }).shadowNode
    const rig = readRig()
    expect(rig).toBeDefined()
    for (const quality of [0, 1]) {
      params.set(shadowQuality.def.id, quality)
      expect(scene.children.find(o => o instanceof DirectionalLight)).toBe(sun)
      expect(readRig()).toBe(rig)
      expect(sun.castShadow).toBe(true)
      expect(sun.shadow.autoUpdate).toBe(quality > 0)
    }
  } finally {
    environment.dispose?.()
    params.set(shadowQuality.def.id, previous)
  }
})

import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { SkyEnvironmentMap } from '../../src/world/sky/SkyEnvironmentMap'
import type { AlienSkyMesh } from '../../src/world/sky/AlienSkyMesh'

const capture = vi.hoisted(() => vi.fn())
vi.mock('three/webgpu', async importOriginal => {
  const original = await importOriginal<typeof import('three/webgpu')>()
  return { ...original, PMREMGenerator: class {
    fromScene(...args: unknown[]) { return capture(...args) }
    dispose() {}
  } }
})

function fixture() {
  const scene = new THREE.Scene()
  const sky = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()) as unknown as AlienSkyMesh
  sky.cloudLayerVisible = false
  const target = { texture: new THREE.Texture(), dispose: vi.fn() }
  capture.mockReset().mockImplementation(() => {
    expect(sky.cloudLayerVisible).toBe(true)
    return target
  })
  const reflections = new SkyEnvironmentMap(scene, {} as THREE.WebGPURenderer, sky)
  return { sky, reflections, target, scene }
}

describe('cloud reflection fallback', () => {
  it('captures sky clouds without changing camera visibility or the capture schedule', () => {
    const { sky, reflections, scene, target } = fixture()
    reflections.update(1, 12)
    expect(sky.cloudLayerVisible).toBe(false)
    expect(scene.environment).toBe(target.texture)
    sky.cloudLayerVisible = true
    reflections.update(1, 12)
    sky.cloudLayerVisible = false
    reflections.update(1, 12)
    expect(capture).toHaveBeenCalledTimes(1)
    reflections.dispose()
  })
  it('restores camera fallback after a failed capture and allows a later retry', () => {
    const { sky, reflections } = fixture()
    capture.mockImplementationOnce(() => {
      expect(sky.cloudLayerVisible).toBe(true)
      throw new Error('Injected capture failure')
    })
    expect(() => reflections.update(1, 12)).toThrow('Injected capture failure')
    expect(sky.cloudLayerVisible).toBe(false)
    expect(reflections.stats.captures).toBe(0)
    reflections.update(1, 12)
    expect(sky.cloudLayerVisible).toBe(false)
    expect(reflections.stats.captures).toBe(1)
    reflections.dispose()
  })
})

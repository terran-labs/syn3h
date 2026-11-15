import { expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game, System } from '../../src/core/Game'
import { postOn } from '../../src/fx/post/params'
import { warmGear, warmStats } from '../../src/weapons/warm'

it('rewarms after a post effect change and detaches when its last user leaves', () => {
  const scene = new THREE.Scene(), systems: System[] = []
  const original = postOn.value
  const game = {
    scene, camera: new THREE.PerspectiveCamera(),
    add(system: System) { systems.push(system); return system },
    remove(system: System) { systems.splice(systems.indexOf(system), 1); system.dispose?.() },
  } as unknown as Game
  const geometry = new THREE.PlaneGeometry(), material = new THREE.MeshBasicMaterial()
  const release = warmGear(game, [[geometry, material]])
  try {
    for (let i = 0; i < 15; i++) {
      scene.traverse(o => { if (o instanceof THREE.Mesh) (o.onBeforeRender as () => void)() })
      for (const system of systems) system.update?.(1 / 60, 0)
    }
    expect(warmStats(game)?.left).toBe(0)
    params.set('post.on', !original)
    expect(warmStats(game)?.left).toBeGreaterThan(0)
    expect(scene.children).toHaveLength(1)
    release()
    expect(warmStats(game)).toBeNull()
    expect(scene.children).toHaveLength(0)
    expect(systems).toHaveLength(0)
    params.set('post.on', original)
    expect(scene.children).toHaveLength(0)
  } finally {
    release(); params.set('post.on', original); geometry.dispose(); material.dispose()
  }
})

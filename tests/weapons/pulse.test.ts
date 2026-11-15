import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { ImpactPulses } from '../../src/weapons/pulse'

describe('impact light rings', () => {
  it('bounds repeated impacts, expires them, and releases its scene resources', () => {
    const scene = new THREE.Scene()
    const pulses = new ImpactPulses({ scene } as Game)
    const at = new THREE.Vector3(2, 3, 4), normal = new THREE.Vector3(0, 1, 0)
    const options = { radius: 4, seconds: 0.5, color: new THREE.Color(0, 2, 1) }
    for (let i = 0; i < 100; i++) pulses.emit(at, normal, options)
    expect(pulses.active).toBe(16)
    expect(scene.children).toHaveLength(1)
    pulses.update(0.2)
    expect(scene.children[0].visible).toBe(true)
    pulses.update(0.4)
    expect(pulses.active).toBe(0)
    expect(scene.children[0].visible).toBe(false)
    pulses.emit(at, normal, options)
    pulses.reset()
    expect(pulses.active).toBe(0)
    pulses.dispose()
    expect(scene.children).toHaveLength(0)
  })
})

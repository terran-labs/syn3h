import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { TetherLook, TETHER_CORDS } from '../../src/weapons/bungee/tether'

describe('shared Grapple drawing slots', () => {
  it('reuses released slots and clears every draw after the final cord is removed', () => {
    const scene = new THREE.Scene()
    const look = new TetherLook({ scene } as Game)
    const slots = Array.from({ length: TETHER_CORDS }, () => look.takeCord())
    expect(new Set(slots).size).toBe(TETHER_CORDS)
    expect(look.takeCord()).toBe(-1)
    look.freeCord(slots[3])
    expect(look.takeCord()).toBe(slots[3])
    const points = Array.from({ length: look.segments + 1 }, (_, i) => new THREE.Vector3(i, 1, 0))
    look.writeCord(slots.at(-1)!, points, .5, 0, [0, 1, 2])
    look.flush()
    expect(look.cord.visible).toBe(true)
    expect(look.cord.geometry.drawRange.count).toBe(TETHER_CORDS * look.segments * 6)
    for (const slot of slots) look.freeCord(slot)
    expect(look.cord.visible).toBe(false)
    expect(look.cord.geometry.drawRange.count).toBe(0)
    expect(look.sparks.visible).toBe(false)
    look.dispose()
    expect(scene.children).toHaveLength(0)
  })
})

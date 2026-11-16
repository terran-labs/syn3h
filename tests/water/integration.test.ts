import { afterEach, beforeAll, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { createVehicle } from '../../src/vehicles'
import { waterSinking } from '../../src/vehicles/buoyancy'
import { ZORB_FLOAT_DEPTH } from '../../src/vehicles/zorb'
import { harness } from '../vehicles2/harness'

beforeAll(initPhysics)
afterEach(() => { waterSinking.value = waterSinking.def.default })

for (const sinking of [true, false]) {
  for (const [name, Kind] of [['syn3h', Syn3hBuggy]] as const) {
    it(`${name} preserves wing skim speed and support with sinking=${sinking}`, () => {
      waterSinking.value = sinking
      const h = harness()
      h.terrain.liquidHeightAt = () => 10
      h.terrain.liquidKindAt = () => 'water'
      const v = new Kind(h.game, h.terrain, new THREE.Vector3(0, 15, 0))
      v.isLocal = false; v.input.special = true
      try {
        h.step(v, 40)
        v.body.setTranslation({ x: 0, y: 9.95, z: 0 }, true)
        v.body.setRotation(new THREE.Quaternion(), true)
        v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        v.body.setLinvel({ x: 0, y: -2, z: -32 }, true)
        for (let i = 0; i < 25; i++) {
          h.step(v)
          expect(Math.hypot(v.body.linvel().x, v.body.linvel().z)).toBeGreaterThan(24)
          expect(v.body.translation().y).toBeGreaterThan(9.8)
          expect(v.liquidState.wingLiftSurface).toBe(-Infinity)
        }
      } finally { v.dispose(); h.world.free() }
    })
  }

  for (const kind of ['buggy', 'tank', 'jet', 'hovercraft'] as const) {
    it(`${kind} zorb preserves its base ride height with sinking=${sinking}`, () => {
      waterSinking.value = sinking
      const h = harness()
      h.terrain.liquidHeightAt = () => 8
      h.terrain.liquidKindAt = () => 'water'
      const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, 2, 0))
      v.isLocal = false; v.input.zorb = true
      try {
        h.step(v, 300)
        expect(v.zorb.centre(new THREE.Vector3()).y).toBeCloseTo(8 + v.zorb.radius - ZORB_FLOAT_DEPTH, 0)
        expect(v.liquidState.heat).toBe(0)
        expect(v.stuck).toBe(false)
      } finally { v.dispose(); h.world.free() }
    })
  }
}

it('hydrodynamic contact couples the motor while submerged and clears above water', () => {
  waterSinking.value = true
  const h = harness(9.81, false)
  h.terrain.liquidHeightAt = () => 10
  h.terrain.liquidKindAt = () => 'water'
  const v = new Syn3hBuggy(h.game, h.terrain, new THREE.Vector3(0, 5, 0))
  v.isLocal = false
  try {
    h.step(v, 150)
    expect(v.inLiquid).toBe(true)
    v.input.y = 1
    let motorMax = 0
    for (let i = 0; i < 500; i++) {
      h.step(v)
      motorMax = Math.max(motorMax, Math.abs(v.motorSpeed))
      expect(v.inLiquid).toBe(true)
    }
    expect(motorMax).toBeLessThan(40)
    v.body.setTranslation({ x: 0, y: 20, z: 0 }, true)
    h.step(v)
    expect(v.inLiquid).toBe(false)
  } finally { v.dispose(); h.world.free() }
})


for (const liquid of ['water', 'lava'] as const) {
  it(`a slow Zorb settles on ${liquid} without passive skips`, () => {
    const h = harness()
    h.terrain.liquidHeightAt = () => 8
    h.terrain.liquidKindAt = () => liquid
    const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 2, 0))
    v.isLocal = false; v.input.zorb = true
    try {
      h.step(v, 400)
      expect(v.zorb.skips).toBe(0)
      expect(v.zorb.centre(new THREE.Vector3()).y).toBeCloseTo(8 + v.zorb.radius - ZORB_FLOAT_DEPTH, 0)
      expect(v.liquidState.heat).toBe(0); expect(v.stuck).toBe(false)
    } finally { v.dispose(); h.world.free() }
  })
}

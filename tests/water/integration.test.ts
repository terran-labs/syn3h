import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { createVehicle } from '../../src/vehicles'
import { waterSinking } from '../../src/vehicles/buoyancy'
import { ZORB_FLOAT_DEPTH } from '../../src/vehicles/zorb'
import { ProceduralTerrain } from '../../src/world/terrain/ProceduralTerrain'
import { seaWaves } from '../../src/world/water/seaWaves'
import { worldSeaKind } from '../../src/world/terrain/settings'
import { params, worldLavaAltitude } from '../../shared/params'
import { wrapCoord } from '../../shared/wrap'
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


it('vertical phase speed follows the exact wrapped liquid-height selection', () => {
  const oldSea = worldLavaAltitude.value, oldKind = worldSeaKind.value
  const lava = { lake: null, pools: [{ x: 0, z: 0, radius: 2, surface: 20, floor: 0 }], rivers: [] }
  // Exercise the production methods without constructing rendering or a generated world.
  const terrain = Object.assign(Object.create(ProceduralTerrain.prototype), {
    data: { size: 100, lava }, sampler: { heightAt: () => -10 },
  }) as ProceduralTerrain
  const enabled = vi.spyOn(seaWaves, 'enabled', 'get').mockReturnValue(true)
  const offset = vi.spyOn(seaWaves, 'offsetAt').mockReturnValue(.25)
  const speed = vi.spyOn(seaWaves, 'verticalSpeedAt').mockReturnValue(1.5)
  try {
    params.set(worldLavaAltitude.def.id, 10); params.set(worldSeaKind.def.id, 1)
    expect(terrain.liquidHeightAt(130, 0)).toBe(10.25)
    expect(terrain.liquidVerticalSpeedAt(130, 0)).toBe(1.5)
    expect(offset).toHaveBeenLastCalledWith(wrapCoord(130, 100), 0, -10, 10)
    expect(speed).toHaveBeenLastCalledWith(wrapCoord(130, 100), 0, -10, 10)
    expect(terrain.liquidHeightAt(0, 0)).toBe(20)
    expect(terrain.liquidVerticalSpeedAt(0, 0)).toBe(0) // Raised inland pool.
    params.set(worldSeaKind.def.id, 0)
    expect(terrain.liquidHeightAt(30, 0)).toBe(10)
    expect(terrain.liquidVerticalSpeedAt(30, 0)).toBe(0) // Lava sea.
    params.set(worldSeaKind.def.id, 1); enabled.mockReturnValue(false)
    expect(terrain.liquidHeightAt(30, 0)).toBe(10)
    expect(terrain.liquidVerticalSpeedAt(30, 0)).toBe(0)
    enabled.mockReturnValue(true); speed.mockReturnValue(NaN)
    expect(terrain.liquidVerticalSpeedAt(30, 0)).toBeNaN()
    expect(terrain.liquidVerticalSpeedAt(Infinity, 0)).toBeNaN()
  } finally {
    vi.restoreAllMocks(); params.set(worldLavaAltitude.def.id, oldSea); params.set(worldSeaKind.def.id, oldKind)
  }
})

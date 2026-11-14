import { beforeEach, describe, expect, it } from 'vitest'
import { Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { params } from '../../shared/params'
import { ChaseCamera, constrainCamera, type CameraVehicle } from '../../src/core/ChaseCamera'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'
beforeEach(() => { for (const p of params.all().filter(p => p.def.group === 'Camera')) params.set(p.def.id, p.def.default) })
function harness(heightAt = (_x: number, _z: number) => 0) {
  const camera = new PerspectiveCamera(60), target = new Object3D()
  target.position.set(0, 1, 0)
  const game = { camera } as Game
  const terrain = { heightAt } as Terrain
  const chase = new ChaseCamera(game, terrain); chase.target = target
  return { camera, target, chase }
}
describe('Syn3h camera', () => {
  it('starts behind negative-Z forward with shipped distance, bump and FOV', () => {
    const { camera, chase } = harness(); chase.update(1 / 60)
    expect(camera.position.z).toBeCloseTo(9.25)
    expect(camera.position.y).toBeCloseTo(1 + 9.25 * 0.15)
    expect(camera.fov).toBe(80)
  })
  it('follows travel while keeping chassis roll out of the horizon', () => {
    const { camera, target, chase } = harness(); chase.update(0.02)
    target.rotation.set(0, Math.PI, 1)
    for (let i = 0; i < 250; i++) { target.position.z -= 0.1; chase.update(0.02) }
    const forward = camera.getWorldDirection(new Vector3())
    expect(forward.z).toBeLessThan(-0.99); expect(camera.rotation.z).toBeCloseTo(0)
  })
  it('shortens the arm at an intervening ridge even when the endpoint is clear', () => {
    const terrain = { heightAt: (_x: number, z: number) => z > 3 && z < 5 ? 10 : 0 }
    const point = constrainCamera(terrain, new Vector3(0, 2, 0), new Vector3(0, 2, 9), 0.5)
    expect(point.z).toBeLessThanOrEqual(3); expect(point.y).toBeGreaterThanOrEqual(0.5)
  })
  it('clamps after teleports and in every mode, including an underground target', () => {
    const { camera, target, chase } = harness(() => 30)
    for (let mode = 0; mode <= 4; mode++) {
      params.set('camera.mode', mode); target.position.x += 100; target.position.y = -10; chase.update(0.02)
      expect(camera.position.y).toBeGreaterThanOrEqual(30.5)
    }
    chase.dispose(); expect(target.visible).toBe(true)
  })
  it('uses the ride point, restores visibility, and supports explicit flight binding', () => {
    const { camera, target, chase } = harness(), ride = new Object3D()
    ride.position.set(0, 2, 0); target.add(ride); target.updateMatrixWorld(true)
    const vehicle = { object: target, ridePosition: ride, wingsOpen: true, body: { linvel: () => ({ x: 0, y: 4, z: -10 }) } } as unknown as CameraVehicle
    chase.setVehicle(vehicle); params.set('camera.mode', 1); chase.update(0.02)
    expect(camera.position.y).toBe(3); expect(target.visible).toBe(false)
    params.set('camera.mode', 0); chase.update(0.02); expect(target.visible).toBe(true)
    target.rotation.x = 0.4
    for (let i = 0; i < 300; i++) chase.update(0.02)
    expect(camera.getWorldDirection(new Vector3()).y).toBeGreaterThan(0.3)
  })
})

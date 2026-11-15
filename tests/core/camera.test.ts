import { beforeEach, describe, expect, it } from 'vitest'
import { Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { params } from '../../shared/params'
import { ChaseCamera, constrainCamera, type CameraVehicle } from '../../src/core/ChaseCamera'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'
beforeEach(() => { for (const p of params.all().filter(p => p.def.group === 'Camera')) params.set(p.def.id, p.def.default) })
function harness(heightAt = (_x: number, _z: number) => 0, liquidHeightAt?: (x: number, z: number) => number) {
  const camera = new PerspectiveCamera(60), target = new Object3D()
  target.position.set(0, 1, 0)
  const game = { camera } as Game
  const terrain = { heightAt, liquidHeightAt } as Terrain
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
  it('lifts the arm above liquid without collapsing its follow distance', () => {
    const terrain = { heightAt: () => -10, liquidHeightAt: () => 0 }
    const pivot = new Vector3(0, -1, 0), desired = new Vector3(0, -2, 9)
    const point = constrainCamera(terrain, pivot, desired, 0.5)
    expect(point.toArray()).toEqual([0, 0.5, 9])
    expect(pivot.y).toBe(-1); expect(desired.y).toBe(-2)
    expect(constrainCamera({ ...terrain, heightAt: () => 2 }, pivot, desired, 0.5).y).toBeGreaterThanOrEqual(2.5)
    expect(constrainCamera({ ...terrain, liquidHeightAt: () => -Infinity }, pivot, desired, 0.5).y).toBe(-2)
  })
  it('preserves cinematic easing and restores chase above the liquid surface', () => {
    const { camera, target, chase } = harness(() => -20, () => 0)
    camera.position.set(0, 3, 0)
    chase.setCinematicPose(new Vector3(10, -4, 10), new Vector3(0, 0, 0))
    chase.update(0.02)
    expect(camera.position.x).toBeGreaterThan(0); expect(camera.position.x).toBeLessThan(10)
    for (let i = 0; i < 300; i++) { chase.update(0.02); expect(camera.position.y).toBeGreaterThanOrEqual(0.5) }
    // One metre above the liquid plus the terrain clearance (1.2 m by default).
    expect(camera.position.y).toBeCloseTo(2.2, 3)
    chase.clearCinematicPose(); target.position.y = -4; chase.update(0.02)
    expect(camera.position.y).toBeGreaterThanOrEqual(0.5)
    expect(target.visible).toBe(true)
  })
  it('cuts straight back to the chase pose when a cinematic pose is cleared without a blend', () => {
    const { camera, chase } = harness()
    chase.setCinematicPose(new Vector3(40, 60, 40), new Vector3(0, 0, 0))
    for (let i = 0; i < 30; i++) chase.update(0.02)
    chase.clearCinematicPose(); chase.update(1 / 60)
    expect(camera.position.z).toBeCloseTo(9.25); expect(camera.position.y).toBeCloseTo(1 + 9.25 * 0.15); expect(camera.fov).toBe(80)
  })
  it('blends from a cinematic pose into the live chase pose over the time asked', () => {
    const { camera, chase } = harness()
    chase.setCinematicPose(new Vector3(40, 60, 40), new Vector3(0, 0, 0))
    for (let i = 0; i < 200; i++) chase.update(0.02)
    const from = camera.position.clone(), fov = camera.fov
    expect(fov).toBeCloseTo(55, 0)
    chase.clearCinematicPose(1); chase.update(0.02)
    // Barely moved after one frame, with no jump in field of view.
    expect(camera.position.distanceTo(from)).toBeLessThan(1); expect(Math.abs(camera.fov - fov)).toBeLessThan(1)
    let last = camera.position.distanceTo(from)
    for (let i = 0; i < 24; i++) { chase.update(0.02); const moved = camera.position.distanceTo(from); expect(moved).toBeGreaterThanOrEqual(last - 1e-6); last = moved }
    expect(camera.fov).toBeGreaterThan(fov); expect(camera.fov).toBeLessThan(80)
    for (let i = 0; i < 40; i++) chase.update(0.02)
    // Landed exactly where the chase camera itself would be.
    expect(camera.position.z).toBeCloseTo(9.25); expect(camera.position.y).toBeCloseTo(1 + 9.25 * 0.15); expect(camera.fov).toBeCloseTo(80)
    expect(camera.getWorldDirection(new Vector3()).z).toBeCloseTo(-1)
  })
  it('keeps a blend clear of the ground, carries it across a seam, and lets a new shot cancel it', () => {
    const { camera, target, chase } = harness((_x, z) => z > 15 && z < 25 ? 30 : 0)
    chase.setCinematicPose(new Vector3(0, 40, 40), new Vector3(0, 0, 0))
    for (let i = 0; i < 300; i++) chase.update(0.02)
    chase.clearCinematicPose(2)
    for (let i = 0; i < 50; i++) { chase.update(0.02); expect(camera.position.y).toBeGreaterThanOrEqual(camera.position.z > 15 && camera.position.z < 25 ? 31.2 : 1.2) }
    const before = camera.position.x
    // A seam crossing moves the vehicle and the camera by a whole tile together.
    target.position.x += 100; chase.shift(100, 0); chase.update(0.02)
    expect(camera.position.x - before).toBeGreaterThan(99)
    chase.setCinematicPose(new Vector3(100, 50, 50), new Vector3(100, 0, 0), 70)
    for (let i = 0; i < 300; i++) chase.update(0.02)
    expect(camera.fov).toBeCloseTo(70, 0)
  })
  it('eases from a director shot into the chase view when the player takes the controls back', () => {
    const { camera, target, chase } = harness()
    chase.setVehicle({ object: target, body: { isValid: () => true, linvel: () => ({ x: 0, y: 0, z: 0 }) } } as unknown as CameraVehicle)
    for (const shot of ['orbit', 'crane', 'low', 'flyby'] as const) {
      chase.director.start()
      // Jump to the shot under test, as the sequence would reach it.
      Object.assign(chase.director as unknown as { index: number; shot: string; shotTime: number; placed: boolean }, { index: ({ orbit: 1, flyby: 3, crane: 4, low: 5 })[shot], shot, shotTime: 0, placed: shot === 'flyby' })
      for (let i = 0; i < 150; i++) chase.update(0.02)
      expect(chase.director.shot, shot).toBe(shot)
      const from = camera.position.clone()
      expect(from.distanceTo(new Vector3(0, 1 + 9.25 * 0.15, 9.25)), `${shot} is away from the chase pose`).toBeGreaterThan(3)
      // The player touches a control: Daydream stops the director.
      chase.director.stop(); chase.update(0.02)
      expect(camera.position.distanceTo(from), `${shot}: no jump on the first frame`).toBeLessThan(0.5)
      let last = camera.position.clone(), worst = 0
      let turn = camera.quaternion.clone()
      for (let i = 0; i < 60; i++) {
        chase.update(0.02); worst = Math.max(worst, camera.position.distanceTo(last)); last = camera.position.clone()
        expect(camera.quaternion.angleTo(turn) * 180 / Math.PI / 0.02, `${shot}: turn speed`).toBeLessThan(250)
        turn.copy(camera.quaternion)
      }
      expect(worst, `${shot}: largest step on the way back`).toBeLessThan(1.5)
      expect(camera.position.z, shot).toBeCloseTo(9.25); expect(camera.position.y, shot).toBeCloseTo(1 + 9.25 * 0.15)
    }
  })
  it('gives the camera to a pose set from outside at once, whatever shot the director is on', () => {
    const { camera, target, chase } = harness()
    chase.setVehicle({ object: target, body: { isValid: () => true, linvel: () => ({ x: 0, y: 0, z: 0 }) } } as unknown as CameraVehicle)
    chase.director.start()
    Object.assign(chase.director as unknown as { index: number; shot: string; shotTime: number }, { index: 1, shot: 'orbit', shotTime: 0 })
    for (let i = 0; i < 100; i++) chase.update(0.02)
    const orbiting = camera.position.clone()
    // The descent into a world begins while the director still thinks it has the camera.
    const top = new Vector3(0, 520, 40), down = new Vector3(0, 0, 0)
    chase.setCinematicPose(top, down, 64); chase.update(0.02)
    expect(camera.position.distanceTo(orbiting)).toBeLessThan(25)
    let height = camera.position.y
    for (let i = 0; i < 400; i++) { chase.setCinematicPose(top, down, 64); chase.update(0.02); expect(camera.position.y).toBeGreaterThanOrEqual(height - 1e-6); height = camera.position.y }
    // It went to the outside pose and stayed: the director took none of those frames and started no shot.
    expect(camera.position.distanceTo(top)).toBeLessThan(0.5)
    expect(chase.director.shot).toBe('orbit')
    expect(camera.position.distanceTo(new Vector3(0, 5.5, 0))).toBeGreaterThan(400)
    chase.director.stop()
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
  it('ride view hides nothing on a vehicle that declares a cockpit, tagged parts included', () => {
    const { target, chase } = harness(), canopy = new Object3D(), ride = new Object3D()
    canopy.userData.hideInRide = true; target.add(canopy, ride); target.userData.cockpit = true
    chase.setVehicle({ object: target, ridePosition: ride, body: { linvel: () => ({ x: 0, y: 0, z: 0 }) } } as unknown as CameraVehicle)
    params.set('camera.mode', 1)
    for (let i = 0; i < 40; i++) chase.update(0.02)
    expect(target.visible).toBe(true); expect(canopy.visible).toBe(true)
    // Without the flag the same vehicle loses its tagged canopy, as before.
    target.userData.cockpit = false; params.set('camera.mode', 0); chase.update(0.02); params.set('camera.mode', 1); chase.update(0.02)
    expect(target.visible).toBe(true); expect(canopy.visible).toBe(false)
  })
  it('ride view hides only tagged parts, the whole vehicle when nothing is tagged, and restores both', () => {
    const { target, chase } = harness()
    const body = new Object3D(), canopy = new Object3D(); canopy.userData.hideInRide = true
    target.add(body, canopy)
    params.set('camera.mode', 1); chase.update(0.02)
    expect(target.visible).toBe(true); expect(body.visible).toBe(true); expect(canopy.visible).toBe(false)
    params.set('camera.mode', 0); chase.update(0.02)
    expect(canopy.visible).toBe(true)
    // Untagged vehicle: hidden whole, as before.
    const plain = new Object3D(); plain.position.set(5, 1, 0); chase.target = plain
    params.set('camera.mode', 1); chase.update(0.02)
    expect(plain.visible).toBe(false)
    // Switching vehicles while in ride view gives the old one back.
    chase.setVehicle({ object: target, body: { linvel: () => ({ x: 0, y: 0, z: 0 }) } } as unknown as CameraVehicle); chase.update(0.02)
    expect(plain.visible).toBe(true); expect(target.visible).toBe(true); expect(canopy.visible).toBe(false)
    chase.dispose(); expect(canopy.visible).toBe(true)
  })
  it('ride view picks up tags that arrive after the model loads', () => {
    const { target, chase } = harness()
    params.set('camera.mode', 1); chase.update(0.02)
    expect(target.visible).toBe(false)
    const canopy = new Object3D(); canopy.userData.hideInRide = true; target.add(canopy)
    for (let i = 0; i < 31; i++) chase.update(0.02)
    expect(target.visible).toBe(true); expect(canopy.visible).toBe(false)
  })
})

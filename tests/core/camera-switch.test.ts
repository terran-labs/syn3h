// A vehicle switch hands the camera a new vehicle where the old one was. Bug these catch: the
// view snapping round behind the new vehicle (the owner, 25 November 2026: "The camera should
// instead just continue to smoothly orbit. There should be no hitch.").
import { beforeEach, describe, expect, it } from 'vitest'
import { Euler, Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { params } from '../../shared/params'
import { ChaseCamera, HANDOVER_METRES, type CameraVehicle } from '../../src/core/ChaseCamera'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'

beforeEach(() => { for (const p of params.all().filter(p => p.def.group === 'Camera')) params.set(p.def.id, p.def.default) })

const DT = 1 / 60
/** A vehicle the camera can follow: a kind, its own clearance, a heading and a velocity. */
function vehicle(kind: string, camOffset: number, heading: number, at: Vector3, velocity = new Vector3()) {
  const object = new Object3D(); object.position.copy(at); object.rotation.set(0, heading, 0); object.updateMatrixWorld(true)
  return { kind, camOffset, object, body: { isValid: () => true, linvel: () => ({ x: velocity.x, y: velocity.y, z: velocity.z }) } } as unknown as CameraVehicle
}
function harness() {
  const camera = new PerspectiveCamera(60)
  const chase = new ChaseCamera({ camera, input: { suspended: false } } as unknown as Game, { heightAt: () => 0 } as unknown as Terrain)
  return { camera, chase }
}
const angles = (camera: PerspectiveCamera) => { const e = new Euler().setFromQuaternion(camera.quaternion, 'YXZ'); return { yaw: e.y, pitch: e.x } }
const degrees = (radians: number) => Math.abs(Math.atan2(Math.sin(radians), Math.cos(radians))) * 180 / Math.PI

describe('switching vehicles keeps the camera where it was looking', () => {
  for (const [mode, name] of [[0, 'chase'], [2, 'orbit']] as const) {
    it(`keeps yaw and pitch on the next frame (${name} camera)`, () => {
      params.set('camera.mode', mode)
      const { camera, chase } = harness()
      const buggy = vehicle('buggy', 3, 0, new Vector3(0, 1, 0))
      chase.setVehicle(buggy)
      for (let i = 0; i < 60; i++) chase.update(DT)
      // The player orbits round to one side and looks down a little, then settles.
      chase.look(300, 40)
      for (let i = 0; i < 240; i++) chase.update(DT)
      const before = angles(camera)
      // The jet arrives where the buggy was, facing another way (its own heading would be
      // "behind" for a reset), with its own clearance.
      chase.setVehicle(vehicle('jet', 5, Math.PI / 2, buggy.object.position.clone().add(new Vector3(0, 0.6, 0))))
      chase.update(DT)
      const after = angles(camera)
      expect(degrees(after.yaw - before.yaw)).toBeLessThan(0.5)
      expect(degrees(after.pitch - before.pitch)).toBeLessThan(0.5)
    })
  }

  it('moves the camera no further on the switch frame than the vehicle and the framing ease allow', () => {
    const { camera, chase } = harness()
    const velocity = new Vector3(10, 0, 0)
    const buggy = vehicle('buggy', 3, -Math.PI / 2, new Vector3(0, 1, 0), velocity)
    chase.setVehicle(buggy)
    const drive = (v: CameraVehicle) => { v.object.position.addScaledVector(velocity, DT); v.object.updateMatrixWorld(true); chase.update(DT) }
    for (let i = 0; i < 300; i++) drive(buggy)
    chase.look(200, 0)
    for (let i = 0; i < 30; i++) drive(buggy)
    // The ordinary step while driving, for comparison.
    const last = camera.position.clone(); drive(buggy)
    const ordinary = camera.position.distanceTo(last), arm = camera.position.distanceTo(buggy.object.position)
    // The hovercraft takes over in place with a different clearance (2 m more).
    const hover = vehicle('hovercraft', 5, -Math.PI / 2, buggy.object.position.clone(), velocity)
    chase.setVehicle(hover)
    const before = camera.position.clone(); drive(hover)
    const step = camera.position.distanceTo(before)
    // Its own motion, plus a fraction of the 2 m clearance change eased in at this frame rate.
    expect(step).toBeLessThan(ordinary + 0.5)
    // And it keeps easing toward the new framing rather than stopping short.
    for (let i = 0; i < 240; i++) drive(hover)
    expect(camera.position.distanceTo(hover.object.position)).toBeGreaterThan(arm + 1)
  })

  it('still starts again behind after a teleport', () => {
    const { camera, chase } = harness()
    const buggy = vehicle('buggy', 3, 0, new Vector3(0, 1, 0))
    chase.setVehicle(buggy)
    for (let i = 0; i < 60; i++) chase.update(DT)
    chase.look(300, 0)
    for (let i = 0; i < 120; i++) chase.update(DT)
    // The same vehicle respawned far away, facing +X: behind it is toward -X.
    buggy.object.position.set(200, 1, 0); buggy.object.rotation.set(0, -Math.PI / 2, 0); buggy.object.updateMatrixWorld(true)
    chase.update(DT)
    expect(camera.position.x).toBeLessThan(200 - 5)
    // A new vehicle further away than a switch places one is a teleport too.
    const far = vehicle('jet', 5, 0, new Vector3(200, 1, HANDOVER_METRES + 20))
    chase.setVehicle(far)
    chase.update(DT)
    expect(camera.position.z).toBeGreaterThan(far.object.position.z + 5)
  })
})

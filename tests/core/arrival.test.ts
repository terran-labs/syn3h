import { beforeEach, describe, expect, it } from 'vitest'
import { Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { params } from '../../shared/params'
import { arrivalPath, ARRIVAL_START_FOV, ARRIVAL_START_HEIGHT } from '../../src/core/arrival'
import { camDistance, camFov, camHeight, camOffset, ChaseCamera } from '../../src/core/ChaseCamera'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'

beforeEach(() => { for (const p of params.all().filter(p => p.def.group === 'Camera')) params.set(p.def.id, p.def.default) })
const chaseArm = () => ({ arm: camOffset.value + camDistance.value, heightRatio: camHeight.value, fov: camFov.value })
/** The chase camera's own rest pose for a parked vehicle at this place and heading. */
function restPose(x: number, y: number, z: number, heading: number, floor: number) {
  const camera = new PerspectiveCamera(60), target = new Object3D()
  target.position.set(x, y, z); target.rotation.set(0, heading, 0)
  const chase = new ChaseCamera({ camera } as Game, { heightAt: () => floor } as unknown as Terrain); chase.target = target
  chase.update(1 / 60)
  return { position: camera.position.clone(), forward: camera.getWorldDirection(new Vector3()), fov: camera.fov }
}

describe('the camera path into a world', () => {
  it('ends where the chase camera rests behind the vehicle, for any place and heading', () => {
    for (const [x, z, heading, floor] of [[0, 0, 0, 0], [13, -565, 0.7, 14], [-475, 409, -2.3, 13.5], [820, 15, Math.PI, 96]]) {
      const altitude = 1.1, rest = restPose(x, floor + altitude, z, heading, floor)
      const path = arrivalPath({ x, z, heading, floor, altitude, ...chaseArm() })
      const position = new Vector3(), look = new Vector3(), fov = path.pose(1, position, look)
      expect(position.distanceTo(rest.position), `position at heading ${heading}`).toBeLessThan(0.05)
      expect(position.distanceTo(path.end)).toBeLessThan(1e-9)
      // It looks level along the vehicle's heading, as the chase camera does at rest.
      const aim = look.clone().sub(position).normalize()
      expect(aim.dot(rest.forward), `direction at heading ${heading}`).toBeGreaterThan(0.999)
      expect(fov).toBeCloseTo(rest.fov)
    }
  })
  it('starts high over the vehicle looking down at it, and never leaves it on the way', () => {
    const path = arrivalPath({ x: 100, z: -40, heading: 0.4, floor: 20, altitude: 1, ...chaseArm() })
    const position = new Vector3(), look = new Vector3()
    expect(path.pose(0, position, look)).toBe(ARRIVAL_START_FOV)
    expect(position.distanceTo(path.top)).toBeLessThan(1e-9); expect(position.y).toBe(20 + ARRIVAL_START_HEIGHT)
    expect(look.x).toBe(100); expect(look.z).toBe(-40)
    for (let i = 0; i <= 100; i++) { path.pose(i / 100, position, look); expect(Math.hypot(position.x - 100, position.z + 40)).toBeLessThanOrEqual(40.001) }
  })
  it('is one continuous fall: always downward, slowing all the way, with no step in direction', () => {
    const path = arrivalPath({ x: 0, z: 0, heading: 1.2, floor: 0, altitude: 1, ...chaseArm() })
    const position = new Vector3(), look = new Vector3(), last = new Vector3(), lastAim = new Vector3()
    path.pose(0, last, look); lastAim.copy(look).sub(last).normalize()
    let lastStep = Infinity
    for (let i = 1; i <= 240; i++) {
      path.pose(i / 240, position, look)
      const aim = look.clone().sub(position).normalize(), step = position.distanceTo(last)
      expect(position.y, `height at ${i}`).toBeLessThanOrEqual(last.y + 1e-9)
      // It starts at the dive's speed (about 27 m in the first of 240 steps) and only slows:
      // a step longer than the one before it would be a lurch.
      expect(step, `step at ${i}`).toBeLessThanOrEqual(lastStep + 1e-6); expect(step).toBeLessThan(30)
      expect(Math.acos(Math.min(1, aim.dot(lastAim))) * 180 / Math.PI, `turn at ${i}`).toBeLessThan(2)
      last.copy(position); lastAim.copy(aim); lastStep = step
    }
    // It arrives at rest: the last step is a few centimetres.
    expect(lastStep).toBeLessThan(0.05)
  })
  it('follows the vehicle when the world is rebuilt under the lobby', () => {
    // The spawn point moved a kilometre: a path built now stands over the new one, not the old.
    const before = arrivalPath({ x: 13, z: -565, heading: 0, floor: 14, altitude: 1, ...chaseArm() })
    const after = arrivalPath({ x: -475, z: 409, heading: 2.2, floor: 13, altitude: 1, ...chaseArm() })
    expect(Math.hypot(after.top.x + 475, after.top.z - 409)).toBeLessThanOrEqual(40.001)
    expect(Math.hypot(after.top.x - before.top.x, after.top.z - before.top.z)).toBeGreaterThan(900)
    expect(Math.hypot(after.end.x + 475, after.end.z - 409)).toBeLessThan(10)
  })
})

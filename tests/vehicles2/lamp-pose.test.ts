/**
 * Headlights: the visible cone, the ground pool and the player's spot lights read one lamp pose
 * (effects/lamps.ts). Bug: they were three separately authored poses and drifted apart, so a
 * beam in mist pointed one way while its light lay on the ground somewhere else.
 */
import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { writeVehicleCones } from '../../src/vehicles/effects/cones'
import { GroundPools } from '../../src/vehicles/effects/pools'
import { LAMP_POSES, groundHit, lampAxis, lampPoseFor, poseSpot } from '../../src/vehicles/effects/lamps'

const flat = () => 0
const kinds = ['buggy', 'hovercraft', 'jet', 'tank'] as const

describe('one lamp pose for every view of a headlight', () => {
  it.each(kinds)('%s: the cone runs along the spot\'s axis and ends where it lands on flat ground', (kind) => {
    const pose = lampPoseFor(kind), axis = lampAxis(pose, new T.Vector3())
    // The real spot light.
    const spot = new T.SpotLight(); poseSpot(spot, pose, 0)
    const spotAxis = spot.target.position.clone().sub(spot.position).normalize()
    expect(spotAxis.distanceTo(axis)).toBeLessThan(1e-6)
    expect(spot.angle).toBeCloseTo(pose.spread, 9); expect(spot.distance).toBe(pose.reach)
    // The cone: from a lamp at rest height, along the same axis, as long as the axis to the ground.
    const lamp = new T.Object3D(); lamp.position.set(0, pose.restHeight, 0); lamp.updateMatrixWorld(true)
    const origin = new T.Vector3(0, pose.restHeight, 0), length = groundHit(origin, axis, pose.reach, flat)!
    expect(length * Math.abs(axis.z)).toBeCloseTo(pose.landing, 1)
    const mesh = new T.InstancedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial(), 4), m = new T.Matrix4()
    writeVehicleCones(mesh, 0, lamp, [lamp, lamp], new T.Color(1, 1, 1), 1, m, undefined, pose, [length])
    mesh.getMatrixAt(0, m)
    const tip = new T.Vector3(0, 0, -1).applyMatrix4(m), rim = new T.Vector3(1, 0, -1).applyMatrix4(m)
    // The cone's end lies on the spot's axis, on the ground; its width is the full spot including its penumbra.
    expect(tip.clone().sub(origin).normalize().distanceTo(axis)).toBeLessThan(1e-6)
    expect(tip.y).toBeCloseTo(0, 2)
    expect(rim.distanceTo(tip) / tip.distanceTo(origin)).toBeCloseTo(Math.tan(spot.angle), 6)
  })

  it.each(kinds)('%s: the ground pool is lit by the same lamp, along the same axis', (kind) => {
    const pose = LAMP_POSES[kind], pools = new GroundPools(2), object = new T.Object3D()
    object.position.set(10, pose.restHeight - pose.y, -4); object.rotation.y = .7; object.updateMatrixWorld(true)
    pools.update([{ object, pose, size: 1, strength: 1 }], new T.Vector3(10, 5, 10), flat, (_x, _z, out) => { out.r = out.g = out.b = .5 })
    expect(pools.drawn).toBe(1)
    const g = pools.mesh.geometry, lampA = g.attributes.poolLamp, axisA = g.attributes.poolAxis
    const lamp = new T.Vector3(0, pose.y, pose.z).applyQuaternion(object.quaternion).add(object.position)
    const axis = lampAxis(pose, new T.Vector3()).applyQuaternion(object.quaternion)
    expect(new T.Vector3(lampA.getX(0), lampA.getY(0), lampA.getZ(0)).distanceTo(lamp)).toBeLessThan(1e-5)
    expect(new T.Vector3(axisA.getX(0), axisA.getY(0), axisA.getZ(0)).distanceTo(axis)).toBeLessThan(1e-5)
    expect(lampA.getW(0)).toBeCloseTo(Math.cos(pose.spread), 6); expect(axisA.getW(0)).toBe(pose.reach)
    pools.dispose()
  })

  // Bug: a jet high in the air drew a pool (or a cone ending at a pool) on ground its lamps cannot reach.
  it('a lamp too high for its light to reach the ground throws no pool', () => {
    const pose = LAMP_POSES.jet, pools = new GroundPools(2), object = new T.Object3D()
    object.position.set(0, 150, 0); object.updateMatrixWorld(true)
    pools.update([{ object, pose, size: 1, strength: 1 }], new T.Vector3(0, 150, 10), flat, (_x, _z, out) => { out.r = out.g = out.b = .5 })
    expect(pools.drawn).toBe(0)
    expect(groundHit(new T.Vector3(0, 150, 0), lampAxis(pose, new T.Vector3()), pose.reach, flat)).toBeNull()
    pools.dispose()
  })
})

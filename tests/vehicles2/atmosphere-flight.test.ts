/**
 * Flight follows the planet's air (world.atmosphere). Bugs caught: a jet or a winged buggy
 * gliding and braking on the airless Moon; a Moon jet that can no longer climb or steer.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { FIXED_DT, initPhysics } from '../../src/core/physics'
import { worldAtmosphere } from '../../src/world/terrain/settings'
import { jetSpeed, withJet } from './jetScenarios'
import { deploy, resetParams } from '../vehicles/syn3hScenarios'

beforeAll(initPhysics)
afterEach(resetParams)
const air = (value: number) => params.set(worldAtmosphere.def.id, value)

/** Flight mode at 60 m/s, no thrust (brakes), for one second: horizontal speed lost and pitch rate under full stick. */
const coast = (pitch: number) => withJet(1500, (v, h) => {
  v.input.special = true
  h.step(v)
  v.body.setLinvel({ x: 0, y: 0, z: -60 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  v.input.brakes = true; v.input.y = pitch
  const vy0 = v.body.linvel().y
  h.step(v, Math.round(1 / FIXED_DT))
  const l = v.body.linvel(), w = v.body.angvel()
  return { horizontalLoss: 60 - Math.hypot(l.x, l.z), vertical: l.y - vy0, turn: Math.hypot(w.x, w.y, w.z), speed: jetSpeed(v) }
})

describe('jet', () => {
  it('feels no lift or drag without air: one second of coasting changes only the fall', () => {
    air(0)
    const c = coast(0)
    expect(Math.abs(c.horizontalLoss)).toBeLessThan(0.05)
    expect(c.vertical).toBeCloseTo(-9.81, 0)
  })
  it('loses speed to drag with air', () => {
    air(1)
    expect(coast(0).horizontalLoss).toBeGreaterThan(1)
  })
  it('can still climb in hover and pitch in flight without air', () => {
    air(0)
    const climb = withJet(100, (v, h) => { v.input.z = 1; h.step(v, Math.round(1 / FIXED_DT)); return v.body.linvel().y })
    expect(climb).toBeGreaterThan(0)
    expect(coast(-1).turn).toBeGreaterThan(0.1)
  })
})

describe('winged buggy', () => {
  it('keeps its sideways motion without air, and is turned toward its nose with air', async () => {
    air(0)
    expect((await deploy(1, 1)).off).toBeGreaterThan(80)
    air(1)
    expect((await deploy(1, 1)).off).toBeLessThan(45)
  })
})

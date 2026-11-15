/** The Syn3h hub motor effort that drives the wheel glow and sparks (visual only). */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { type MotorDriveInput, motorDrive, smoothEffort } from '../../src/vehicles/skins/motorDrive'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import type { BuggySkin } from '../../src/vehicles/skins/BuggySkin'
import { makeBed } from './harness'

const base: MotorDriveInput = {
  throttle: 0, forwardSpeed: 0, motorSpeed: 0, topSpeed: 30, brakes: false, wingsOpen: false, grounded: true, sliding: false,
}

describe('motorDrive', () => {
  test('is zero at rest and while coasting', () => {
    expect(motorDrive(base).effort).toBe(0)
    const coast = motorDrive({...base, forwardSpeed: 12, motorSpeed: 12})
    expect(coast.effort).toBe(0)
    expect(coast.regen).toBe(false)
  })

  test('is near full under full throttle from rest, and falls toward top speed', () => {
    expect(motorDrive({...base, throttle: 1}).effort).toBeGreaterThan(.95)
    const fast = motorDrive({...base, throttle: 1, forwardSpeed: 27, motorSpeed: 27}).effort
    expect(fast).toBeLessThan(.2)
    // Reverse from rest works the motor just as hard.
    expect(motorDrive({...base, throttle: -1}).effort).toBeGreaterThan(.95)
  })

  test('reports regeneration when the throttle opposes motion', () => {
    const r = motorDrive({...base, throttle: -1, forwardSpeed: 10, motorSpeed: 10})
    expect(r.regen).toBe(true)
    expect(r.effort).toBeGreaterThan(.5)
  })

  test('is off with wings open or brakes on, and low for a wheel in the air', () => {
    expect(motorDrive({...base, throttle: 1, wingsOpen: true}).effort).toBe(0)
    expect(motorDrive({...base, throttle: 1, brakes: true}).effort).toBe(0)
    expect(motorDrive({...base, throttle: 1, grounded: false}).effort).toBeLessThan(.4)
  })

  test('smoothing lights faster than it fades', () => {
    const up = smoothEffort(0, 1, .05), down = smoothEffort(1, 0, .05)
    expect(up).toBeGreaterThan(1 - down)
  })
})

describe('Syn3hBuggy drive and lamp signals to the skin', () => {
  test('sends a high effort under full throttle from rest and none at rest; brake lamps on brakes', async () => {
    const bed = await makeBed()
    const calls = {effort: [0, 0, 0, 0], braking: false}
    const skin: BuggySkin = {
      object: new THREE.Group(), ready: Promise.resolve(), ownLamps: true,
      setWheel() {}, setWings() {}, setColors() {}, dispose() {},
      setDrive(i, e) { calls.effort[i] = e },
      setLights(b) { calls.braking = b },
    }
    const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 1.5, 0), 0, 'buggy-syn3h', () => skin))
    b.isLocal = false
    await skin.ready
    // The bed runs physics only; the skin is driven from the per-frame update.
    const frame = () => b.update(1 / 50, 1)
    bed.run(2, frame)
    expect(Math.max(...calls.effort)).toBeLessThan(.05)
    expect(b.object.userData.ownLamps).toBe(true)
    b.input.y = 1
    bed.run(.4, frame)
    expect(Math.max(...calls.effort)).toBeGreaterThan(.6)
    b.input.y = 0
    b.input.brakes = true
    bed.run(.5, frame)
    expect(calls.braking).toBe(true)
  })
})

/** The Syn3h hub motor effort that drives the wheel glow and sparks (visual only). */
import { describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { type MotorDriveInput, type MotorLoadInput, motorDrive, motorLoad, motorSparkLoad, smoothEffort, sparkLevel } from '../../src/vehicles/skins/motorDrive'
import { buggySpeed } from '../../src/vehicles/buggyParams'
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

// The owner (17 November 2026): sparks only when the motor is under its highest load, as in a
// hard launch or a struggling climb. Never cruising, coasting, braking, in the air or afloat.
describe('motor sparks follow load', () => {
  const load: MotorLoadInput = { throttle: 1, forwardSpeed: 0, topSpeed: 30, brakes: false, wingsOpen: false, grounded: true, afloat: false }
  const threshold = motorSparkLoad.def.default as number
  const sparks = (s: Partial<MotorLoadInput>) => sparkLevel(motorLoad({...load, ...s}), threshold)
  test('fly at a launch from rest and on a climb that drags the buggy to a crawl or backwards', () => {
    expect(sparks({})).toBe(1)
    expect(sparks({forwardSpeed: -1})).toBe(1)
  })
  test('never fly cruising near top speed, coasting, braking, regenerating, in the air, afloat or with wings open', () => {
    expect(sparks({forwardSpeed: load.topSpeed * .7})).toBe(0)
    expect(sparks({throttle: 0})).toBe(0)
    expect(sparks({brakes: true})).toBe(0)
    expect(sparks({throttle: -1, forwardSpeed: 8})).toBe(0)
    expect(sparks({grounded: false})).toBe(0)
    expect(sparks({afloat: true})).toBe(0)
    expect(sparks({wingsOpen: true})).toBe(0)
  })
  test('a part throttle can load the motor no more than itself', () => {
    for (const throttle of [.2, .5, -.5]) expect(motorLoad({...load, throttle})).toBeLessThanOrEqual(Math.abs(throttle))
  })
  test('the threshold moves with the buggy\'s speed setting, and sparks rise smoothly through it', () => {
    // The same 5 m/s is a crawl for a faster buggy.
    expect(motorLoad({...load, forwardSpeed: 5, topSpeed: 60})).toBeGreaterThan(motorLoad({...load, forwardSpeed: 5, topSpeed: 30}))
    expect(sparkLevel(threshold, threshold)).toBe(0)
    let last = 0
    for (let l = threshold; l <= 1; l += .01) { const v = sparkLevel(l, threshold); expect(v).toBeGreaterThanOrEqual(last); expect(v - last).toBeLessThan(.2); last = v }
  })
})

describe('Syn3hBuggy drive and lamp signals to the skin', () => {
  test('throws sparks at a launch and none once cruising or braking', async () => {
    const bed = await makeBed()
    const sparks = [0, 0, 0, 0]
    const skin: BuggySkin = {
      object: new THREE.Group(), ready: Promise.resolve(), ownLamps: true,
      setWheel() {}, setWings() {}, setColors() {}, dispose() {},
      setDrive(i, _e, _r, s) { sparks[i] = s ?? 0 },
    }
    const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 1.5, 0), 0, 'buggy-syn3h', () => skin))
    b.isLocal = false
    await skin.ready
    const frame = () => b.update(1 / 50, 1)
    bed.run(2, frame)
    expect(Math.max(...sparks)).toBe(0)
    b.input.y = 1
    bed.run(.4, frame)
    expect(Math.max(...sparks)).toBeGreaterThan(.5)
    // Run on until well past the speed where the load falls below the threshold.
    let t = 0
    while (t < 20 && Math.hypot(b.body.linvel().x, b.body.linvel().z) < buggySpeed.value * (1 - threshold) * 2) { bed.run(.5, frame); t += .5 }
    bed.run(2, frame)
    expect(Math.max(...sparks)).toBeLessThan(.02)
    b.input.y = 0; b.input.brakes = true
    bed.run(.5, frame)
    expect(Math.max(...sparks)).toBeLessThan(.02)
  })
  const threshold = motorSparkLoad.def.default as number

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

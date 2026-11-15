import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { CameraDirector } from '../../src/core/CameraDirector'

describe('camera director', () => {
  const flat = { heightAt: () => 0 }
  it('cycles through every shot, keeps the car in view and repeats exactly', () => {
    const run = () => {
      const d = new CameraDirector(), pos = new Vector3(), look = new Vector3(), car = new Vector3(0, 0.6, 0), v = { x: 0, y: 0, z: -12 }
      const seen = new Set<string>(), log: number[] = []
      d.start()
      for (let i = 0; i < 60 * 60; i++) {
        car.z += v.z / 60
        const cinematic = d.update(1 / 60, car, v, flat, pos, look)
        seen.add(d.shot)
        if (cinematic) {
          expect(pos.y).toBeGreaterThan(0.5)
          expect(pos.distanceTo(car)).toBeLessThan(80)
          expect(look.distanceTo(car)).toBeLessThan(8)
          if (i % 97 === 0) log.push(pos.x, pos.y, pos.z)
        }
      }
      return { seen, log }
    }
    const a = run(), b = run()
    expect([...a.seen].sort()).toEqual(['chase', 'crane', 'flyby', 'low', 'orbit'])
    expect(a.log).toEqual(b.log)
  })
  it('does nothing until started, skips a fly-by of a parked car, and cuts when a hill hides the car', () => {
    const d = new CameraDirector(), pos = new Vector3(), look = new Vector3(), car = new Vector3(0, 0.6, 0), still = { x: 0, y: 0, z: 0 }
    expect(d.update(1, car, still, flat, pos, look)).toBe(false)
    d.start()
    const shots = new Set<string>()
    for (let i = 0; i < 60 * 60; i++) { d.update(1 / 60, car, still, flat, pos, look); shots.add(d.shot) }
    expect(shots.has('flyby')).toBe(false); expect(shots.has('orbit')).toBe(true)
    // A wall of ground everywhere but under the car: every cinematic shot is blocked.
    const walled = { heightAt: (x: number, z: number) => Math.hypot(x, z) < 2 ? 0 : 50 }
    d.start()
    let cinematicSeconds = 0
    for (let i = 0; i < 60 * 60; i++) if (d.update(1 / 60, car, still, walled, pos, look)) cinematicSeconds += 1 / 60
    expect(cinematicSeconds).toBeLessThan(15)
    d.stop(); expect(d.update(1, car, still, flat, pos, look)).toBe(false)
  })
})

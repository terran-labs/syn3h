/**
 * The speed crescent's full scale follows the vehicle being driven. Bugs these catch: a crescent
 * pinned at full below a vehicle's top speed (the old fixed 140 mph, which the buggy and the jet
 * both passed), and a scale that does not move when a vehicle is retuned. No tuning is pinned:
 * expectations come from the registry and the relations themselves.
 */
import { afterEach, expect, it } from 'vitest'
import { params } from '../../shared/params'
import '../../src/vehicles/buggyParams'
import { SPEED_HEADROOM, SPEED_CAP, hoverTopSpeed, jetTopSpeed, speedFullScale, topSpeed } from '../../src/ui/inspector/instrumentScales'

const restore: [string, unknown][] = []
const set = (id: string, v: number) => { restore.push([id, params.get(id)?.value]); params.set(id, v) }
afterEach(() => { for (const [id, v] of restore.splice(0).reverse()) if (v !== undefined) params.set(id, v as number) })

it('reads full only above each vehicle\'s top speed', () => {
  for (const kind of ['buggy', 'buggy-syn3h', 'jet', 'hovercraft', 'tank']) {
    expect(speedFullScale(kind)).toBeGreaterThan(topSpeed(kind))
    expect(speedFullScale(kind) / topSpeed(kind)).toBeCloseTo(SPEED_HEADROOM, 6)
  }
})

it('follows the buggy when it is retuned', () => {
  const before = topSpeed('buggy'), speed = Number(params.get('buggy.speed')!.value)
  set('buggy.speed', speed * 1.5)
  expect(topSpeed('buggy')).toBeCloseTo(before * 1.5, 6)
})

it('reads the jet from its drag and thrust: more drag, slower; more thrust, faster; never past what was measured', () => {
  const base = jetTopSpeed(0.003, 2)
  expect(jetTopSpeed(0.006, 2)).toBeCloseTo(base / 2, 6)
  expect(jetTopSpeed(0.003, 3)).toBeCloseTo(base * 1.5, 6)
  expect(jetTopSpeed(0.0001, 2)).toBe(SPEED_CAP)
})

it('reads the hovercraft from its thrust and glide drag, and the cap without glide assistance', () => {
  const base = hoverTopSpeed(300, 0.2, 1)
  expect(hoverTopSpeed(300, 0.4, 1)).toBeCloseTo(base / 2, 6)
  expect(hoverTopSpeed(450, 0.2, 1)).toBeCloseTo(base * 1.5, 6)
  expect(hoverTopSpeed(300, 0.2, 0)).toBe(SPEED_CAP)
})

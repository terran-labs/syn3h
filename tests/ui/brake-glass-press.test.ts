import { afterEach, expect, it, vi } from 'vitest'
import { Vector4 } from 'three/webgpu'
import { BrakeGlassPress } from '../../src/fx/post/BrakeGlassPress'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('matches the native release minimum and recovers without a second dip', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  let held = false
  const button = { dataset: {}, querySelector: () => null, classList: { contains: () => held } }
  const press = new BrakeGlassPress()
  const box = new Vector4(0, 0, 28, 28)
  const rest = box.w
  press.bind(button as unknown as HTMLElement, 0, box, new Vector4().setScalar(rest))
  held = true
  press.sync()
  now = 2000
  press.advance(now)
  expect(box.w).toBeGreaterThan(rest)
  held = false
  press.sync()
  let minimum = box.w
  const releasedAt = now
  let minimumAt = 0
  let recovering = false
  let secondDip = false
  let last = box.w
  for (const end = now + 2000; now <= end; now++) {
    press.advance(now)
    if (box.w < minimum) { minimum = box.w; minimumAt = now - releasedAt }
    if (box.w > last) recovering = true
    if (recovering && box.w < last) secondDip = true
    last = box.w
  }
  // Original 3x native recording, measured across 180 radial directions.
  // The normalized tolerance is one backing pixel on its 35-point control.
  expect(Math.abs(minimum / rest - 32 / 34.4)).toBeLessThan(1 / 105)
  expect(minimumAt).toBeGreaterThanOrEqual(180)
  expect(minimumAt).toBeLessThanOrEqual(230)
  expect(secondDip).toBe(false)
  expect(box.w).toBe(rest)
})

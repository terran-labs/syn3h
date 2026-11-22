import { afterEach, expect, it, vi } from 'vitest'
import { Vector4 } from 'three/webgpu'
import { GlassPress, pressAllowances, restSeparation } from '../../src/fx/post/GlassPress'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** A button stand-in: GlassPress needs only its dataset and an existing label. */
function fakeButton() {
  const label = { style: { transform: '', removeProperty() { this.transform = '' } }, parentNode: null as unknown }
  const button = { dataset: {} as Record<string, string>, querySelector: () => label }
  label.parentNode = button
  return button as unknown as HTMLElement
}

it('matches the native release minimum and recovers without a second dip', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const press = new GlassPress(fakeButton())
  const box = new Vector4(0, 0, 28, 28)
  const rest = box.w
  press.bind(box, new Vector4().setScalar(rest), new Vector4())
  const step = (t: number) => press.apply(press.advance(t))
  press.sync(true)
  now = 2000
  step(now)
  expect(box.w).toBeGreaterThan(rest)
  press.sync(false)
  let minimum = box.w
  const releasedAt = now
  let minimumAt = 0
  let recovering = false
  let secondDip = false
  let last = box.w
  for (const end = now + 2000; now <= end; now++) {
    step(now)
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

it('swelling neighbours never overlap, however many are held at once', () => {
  // Bug: Zorb and Brake fused or bent each other (the owner, 22 November 2026), and with every
  // thumb button swelling, two held neighbours would cover each other's labels.
  // The landscape phone grid: 56 px circles, 8 px gaps, Panels pill one gap above the top row.
  const r = 28, pitch = 64
  const boxes = [
    { x: 0, y: 0, z: r, w: r }, { x: pitch, y: 0, z: r, w: r },
    { x: 0, y: pitch, z: r, w: r }, { x: pitch, y: pitch, z: r, w: r },
    { x: pitch / 2, y: -r - 8 - 18, z: pitch / 2 + r, w: 18 },
  ]
  const out: number[] = []
  for (const wants of [[12, 12, 12, 12, 12], [0, 0, 12, 0, 0], [12, 12, 0, 0, 12], [3, 0, 40, 40, 0]]) {
    pressAllowances(boxes, wants, 1, out)
    for (let i = 0; i < boxes.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(0)
      expect(out[i]).toBeLessThanOrEqual(wants[i])
      for (let j = i + 1; j < boxes.length; j++) {
        expect(out[i] + out[j]).toBeLessThanOrEqual(restSeparation(boxes[i], boxes[j]) - 1 + 1e-9)
      }
    }
  }
  // Alone, a press is not held back by neighbours at rest beyond the gap itself.
  pressAllowances(boxes, [0, 0, 5, 0, 0], 1, out)
  expect(out[2]).toBe(5)
})

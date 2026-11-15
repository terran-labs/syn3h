import { expect, it } from 'vitest'
import { hotExposureDim } from '../../src/vehicles/skins/hotExposure'
it('keeps daylight unchanged and bounds night amplification to 25 percent', () => {
  expect(hotExposureDim(.3, .3)).toBe(1)
  expect(hotExposureDim(.1, .3)).toBe(1)
  for (const over of [2, 10, 100]) {
    const gain = over * hotExposureDim(.3 * over, .3)
    expect(gain).toBeGreaterThan(1)
    expect(gain).toBeLessThan(1.25)
  }
})

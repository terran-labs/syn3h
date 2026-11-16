import { expect, it } from 'vitest'
import { touchSide, touchHandedness, touchAimFires } from '../../src/ui/TouchPreferences'

it('defaults to right-handed drive-left and aim-right with firing enabled', () => {
  expect(touchHandedness.def.default).toBe(0)
  expect(touchAimFires.def.default).toBe(true)
  expect(touchSide(100, 800, false)).toBe('drive')
  expect(touchSide(700, 800, false)).toBe('aim')
  expect(touchSide(400, 800, false)).toBe('aim')
})
it('mirrors both pointer regions for left-handed play', () => {
  expect(touchSide(100, 800, true)).toBe('aim')
  expect(touchSide(700, 800, true)).toBe('drive')
  expect(touchSide(400, 800, true)).toBe('drive')
})

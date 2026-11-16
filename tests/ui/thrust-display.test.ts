import { expect, it } from 'vitest'
import { thrustPercent } from '../../src/ui/inspector/FocusHud'

it('shows signed resolved thrust, including neutral flight thrust', () => {
  expect(thrustPercent(.5)).toBe('50%')
  expect(thrustPercent(1)).toBe('100%')
  expect(thrustPercent(-1)).toBe('-100%')
  expect(thrustPercent(0)).toBe('0%')
  expect(thrustPercent(NaN)).toBe('0%')
})

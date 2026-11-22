/** Which long side keeps the cutout inset (src/ui/screenEdges.ts). */
import { expect, it } from 'vitest'
import { cutoutSide } from '../../src/ui/screenEdges'

it('keeps the inset only on the side with the Dynamic Island, and leaves reported asymmetry to env()', () => {
  // Bug: in landscape an iPhone's controls sat as far from the plain edge as from the island.
  expect(cutoutSide(47, 47, true, 90)).toBe('left')
  expect(cutoutSide(47, 47, true, 270)).toBe('right')
  expect(cutoutSide(47, 47, true, -90)).toBe('right')
  // Portrait, an iPad's zero insets, an Android punch hole that reports one side, an unknown angle.
  expect(cutoutSide(0, 0, false, 0)).toBe(null)
  expect(cutoutSide(0, 0, true, 90)).toBe(null)
  expect(cutoutSide(32, 0, true, 90)).toBe(null)
  expect(cutoutSide(47, 47, true, null)).toBe(null)
})

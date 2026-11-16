/** Which touch drives and which aims: a wrong answer steals a steering or aiming finger. */
import { expect, it } from 'vitest'
import { STICK_REGION, touchRole, type TouchDown } from '../../src/ui/TouchPreferences'

const W = 800
const at = (x: number, more: Partial<TouchDown> = {}): TouchDown => ({ x, width: W, leftHanded: false, onGameView: true, onMinimap: false, onActions: false, ...more })

it('right-handed drives on the left and aims on the right; left-handed mirrors it', () => {
  expect(touchRole(at(100))).toBe('drive')
  expect(touchRole(at(700))).toBe('aim')
  expect(touchRole(at(W * STICK_REGION - 1))).toBe('drive')
  expect(touchRole(at(W * STICK_REGION + 1))).toBe('aim')
  expect(touchRole(at(100, { leftHanded: true }))).toBe('aim')
  expect(touchRole(at(700, { leftHanded: true }))).toBe('drive')
  expect(touchRole(at(W * (1 - STICK_REGION) + 1, { leftHanded: true }))).toBe('drive')
  expect(touchRole(at(W * (1 - STICK_REGION) - 1, { leftHanded: true }))).toBe('aim')
})

it('a touch that starts on a button, panel, the minimap or the button block neither drives nor aims', () => {
  for (const leftHanded of [false, true]) {
    for (const x of [100, 700]) {
      expect(touchRole(at(x, { leftHanded, onGameView: false }))).toBeNull()
      expect(touchRole(at(x, { leftHanded, onMinimap: true }))).toBeNull()
      expect(touchRole(at(x, { leftHanded, onActions: true }))).toBeNull()
    }
  }
})

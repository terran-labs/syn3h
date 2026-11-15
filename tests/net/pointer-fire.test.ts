import { describe, expect, it } from 'vitest'
import { pressHoldsFire } from '../../src/net/pointerFire'

describe('a press on the game canvas', () => {
  it('holds the tag control for the primary mouse button', () => {
    expect(pressHoldsFire({ button: 0, pointerType: 'mouse' })).toBe(true)
    // Older browsers and synthetic events may not say what kind of pointer it was.
    expect(pressHoldsFire({ button: 0 })).toBe(true)
  })

  it('does not for a finger: a touch drag drives, and touch has its own tag control', () => {
    expect(pressHoldsFire({ button: 0, pointerType: 'touch' })).toBe(false)
  })

  it('does not for other mouse buttons', () => {
    expect(pressHoldsFire({ button: 1, pointerType: 'mouse' })).toBe(false)
    expect(pressHoldsFire({ button: 2, pointerType: 'mouse' })).toBe(false)
  })
})

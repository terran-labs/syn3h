import { describe, expect, it } from 'vitest'
import { graphicsOverride, isIOSOrIPadSafari } from '../../src/core/renderOptions'
describe('Safari fallback detection (not enabled)', () => {
  it('recognizes iPad desktop mode and iPhone Safari', () => {
    expect(isIOSOrIPadSafari('Macintosh AppleWebKit/605 Version/26 Safari/605', 5)).toBe(true)
    expect(isIOSOrIPadSafari('iPhone AppleWebKit/605 Version/26 Safari/605', 5)).toBe(true)
  })
  it('excludes Mac desktops, Android and alternative iOS browsers', () => {
    expect(isIOSOrIPadSafari('Macintosh Safari/605', 0)).toBe(false)
    expect(isIOSOrIPadSafari('Android Chrome/140 Safari/537', 5)).toBe(false)
    expect(isIOSOrIPadSafari('iPhone CriOS/140 Safari/605', 5)).toBe(false)
  })
})
it('accepts only explicit graphics levels', () => {
  expect(graphicsOverride('?gfx=0')).toBe(0)
  expect(graphicsOverride('?gfx=1')).toBe(1)
  expect(graphicsOverride('?gfx=2')).toBe(2)
  for (const value of ['', '?gfx=', '?gfx=3', '?gfx=NaN']) expect(graphicsOverride(value)).toBeUndefined()
})

import { describe, expect, it } from 'vitest'
import { heightPixels, mapPoint } from '../../src/ui/Minimap'
describe('minimap projection and terrain cache', () => {
  it('maps world center and corners without swapping north and east', () => {
    expect(mapPoint(0, 0, 600, 160)).toEqual([80, 80])
    expect(mapPoint(-300, -300, 600, 160)).toEqual([0, 0])
    expect(mapPoint(300, 300, 600, 160)).toEqual([160, 160])
  })
  it('samples exactly once per pixel and shades height differences', () => {
    let calls = 0
    const pixels = heightPixels({ size: 600, heightAt(x) { calls++; return x } }, 8)
    expect(calls).toBe(64); expect(pixels.length).toBe(256)
    expect(pixels[28]).toBeGreaterThan(pixels[0]); expect(pixels[3]).toBe(255)
  })
})

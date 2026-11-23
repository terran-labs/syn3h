import { describe, expect, it } from 'vitest'
import { blankShare, classifyFrame, coincidence, tally, type FrameFacts } from '../../src/core/blankFrames'

/** 128 RGBA pixels (the probe's 16 by 8 copy), `blank` of them black or transparent. */
function frame(blank: number, how: 'black' | 'clear' = 'black'): Uint8ClampedArray {
  const px = new Uint8ClampedArray(128 * 4)
  for (let i = 0; i < 128; i++) {
    const lit = i >= blank
    px.set(lit ? [90, 120, 140, 255] : how === 'black' ? [0, 0, 0, 255] : [0, 0, 0, 0], i * 4)
  }
  return px
}
const facts = (f: Partial<FrameFacts> = {}): FrameFacts => ({ frameCopies: 0, resized: null, step: null, deviceErrors: [], deviceLost: false, ...f })

describe('blank frame classifier', () => {
  it('reads black and cleared pixels as blank, lit ones as not', () => {
    expect(blankShare(frame(0))).toBe(0)
    expect(blankShare(frame(128))).toBe(1)
    expect(blankShare(frame(128, 'clear'))).toBe(1)
    expect(blankShare(frame(64))).toBe(0.5)
  })

  it('a black or cleared frame after a lit one is blank; a half black one is partly blank', () => {
    expect(classifyFrame(blankShare(frame(128)), 0)).toBe('blank')
    expect(classifyFrame(blankShare(frame(128, 'clear')), 0)).toBe('blank')
    expect(classifyFrame(blankShare(frame(64)), 0)).toBe('partly')
    expect(classifyFrame(blankShare(frame(10)), 0)).toBe('normal')
  })

  it('a dark scene that stays dark is not a flash', () => {
    expect(classifyFrame(1, 1)).toBe('normal')
    expect(classifyFrame(0.6, 0.6)).toBe('normal')
  })
})

describe('blank frame tally', () => {
  it('names what a blank frame coincides with, in its frame or the one before', () => {
    expect(coincidence({ frame: facts(), before: facts() })).toEqual(['nothing'])
    expect(coincidence({ frame: facts({ frameCopies: 6 }), before: facts() })).toEqual(['frame copy'])
    expect(coincidence({ frame: facts(), before: facts({ resized: 'setPixelRatio 1170x2532 to 936x2026' }) })).toEqual(['resize'])
    expect(coincidence({ frame: facts({ deviceErrors: ['copy out of range'], step: 'shed' }), before: facts() })).toEqual(['device error', 'quality step'])
  })

  it('counts each event under every coincidence it has', () => {
    const t = tally([
      { frame: facts({ frameCopies: 1 }), before: facts() },
      { frame: facts({ frameCopies: 7, resized: 'setSize' }), before: facts() },
      { frame: facts(), before: facts({ deviceLost: true }) },
      { frame: facts(), before: facts() },
    ])
    expect(t).toEqual({ 'frame copy': 2, resize: 1, 'quality step': 0, 'device error': 1, nothing: 1 })
  })
})

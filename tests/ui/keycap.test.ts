/**
 * Shortcuts drawn as keycaps (src/ui/keycap.ts). Bugs caught: a join or a mouse word ("or",
 * "click") drawn as a key, or a key left as plain text, anywhere a shortcut is shown.
 */
import { describe, expect, it } from 'vitest'
import { shortcutParts, shortcutHtml } from '../../src/ui/keycap'

const keys = (text: string) => shortcutParts(text).filter((p) => p.key !== undefined).map((p) => p.key)

describe('shortcut', () => {
  it('draws keys as caps and keeps joins, mouse and gamepad words as text', () => {
    expect(keys('L or click')).toEqual(['L'])
    expect(keys('W / S or arrows')).toEqual(['W', 'S'])
    expect(keys('WASD or arrows')).toEqual(['W', 'A', 'S', 'D'])
    expect(keys('Number keys 1 to 9')).toEqual(['1', '9'])
    expect(keys('Wheel or + / −')).toEqual(['+', '−'])
    expect(keys('Right click')).toEqual([])
    expect(keys('Space')).toEqual(['Space'])
  })
  it('keeps every word, in order, so nothing is lost from the line', () => {
    for (const text of ['L or left mouse', 'W / S or arrows', 'Number keys 1 to 9', 'Esc']) {
      expect(shortcutParts(text).map((p) => p.key ?? p.text).join('').replace(/\s+/g, ' ')).toBe(text)
    }
  })
  it('marks each cap once, by its own name', () => {
    expect(shortcutHtml('1 to 5')).toBe('<kbd class="keycap">1</kbd> to <kbd class="keycap">5</kbd>')
  })
})

import { describe, expect, it } from 'vitest'
import { CHAT_NAME_CONTRAST, CHAT_NAME_SURFACE, contrastRatio, legibleTint } from '../../src/ui/chat/ChatCard'

// A player's name in chat is drawn in their accent colour on a message bubble. Bug it catches:
// a dark accent (navy, black, deep purple) leaving that name unreadable over a bright sky.
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }

describe('legibleTint', () => {
  it('lifts every accent, dark or light, to AA contrast on the bubble', () => {
    for (const c of ['#000000', '#0000ff', '#200040', '#ff0000', '#808080', '#00ff00', '#ffff00', '#ffffff', '#f0f0ff', '#3b1f0a']) {
      expect(contrastRatio(rgb(legibleTint(c)), CHAT_NAME_SURFACE)).toBeGreaterThanOrEqual(CHAT_NAME_CONTRAST)
    }
  })
  it('leaves an accent that already reads alone', () => {
    expect(legibleTint('#ffff00')).toBe('#ffff00')
  })
})

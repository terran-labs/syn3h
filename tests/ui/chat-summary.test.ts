import { describe, expect, it } from 'vitest'
import { chatSummary } from '../../src/ui/chat/ChatCard'

// The Chat card's summary. Bugs it catches: "0 unread" instead of "All read", a count missing
// while lines wait unread, a sender's name in place of the count.
describe('chatSummary', () => {
  it('says All read when nothing waits', () => {
    expect(chatSummary(0)).toBe('All read')
  })
  it('counts unread lines', () => {
    expect(chatSummary(1)).toBe('1 unread')
    expect(chatSummary(2)).toBe('2 unread')
  })
  it('caps a long count', () => {
    expect(chatSummary(250)).toBe('99+ unread')
  })
})

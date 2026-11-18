import { describe, expect, it } from 'vitest'
import { chatSummary } from '../../src/ui/chat/ChatCard'

// The closed Chat card's summary. Bug it catches: a name cut short with an ellipsis, or the
// count missing while lines wait unread.
describe('chatSummary', () => {
  it('leads with the unread count and names who wrote', () => {
    expect(chatSummary(3, { name: 'Mibiwise', mine: false })).toBe('3 new · Mibiwise')
  })
  it('caps a long count and keeps names whole', () => {
    const name = 'Gevotek Spare Pilot of the Long Road'
    const text = chatSummary(250, { name, mine: false })
    expect(text).toBe(`99+ new · ${name}`)
    expect(text).not.toMatch(/…|\.\.\./)
  })
  it('says who spoke last when everything is read', () => {
    expect(chatSummary(0, { name: 'Ann', mine: false })).toBe('Last: Ann')
    expect(chatSummary(0, { name: 'Ann', mine: true })).toBe('Last: you')
  })
  it('says so when nothing has been said', () => {
    expect(chatSummary(0, null)).toBe('Nothing said yet')
  })
})

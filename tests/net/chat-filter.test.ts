import { describe, expect, it } from 'vitest'
import { ChatBucket, cleanChatText, filterChat } from '../../shared/chat'

describe('chat filter', () => {
  it('masks slurs through common disguises', () => {
    for (const text of ['F A G G O T', 'f.a.g.g.o.t', 'FAAAGGOT', 'f@gg0t', 'kill your self', 'k y s', 'rétard']) {
      expect(filterChat(text), text).toMatch(/^[* ]+$/)
    }
  })

  it('leaves ordinary words alone', () => {
    for (const text of ['the therapist said grapes are fine', 'raccoon', 'spice rack', 'Scunthorpe', 'a cocktail of rocks', 'I found a sand crab', 'Snigger? No, giggle.']) {
      expect(filterChat(text)).toBe(text)
    }
  })

  it('cleaning never returns blank text', () => {
    for (const raw of ['', ' ', '​​', '\n\t', '‮']) expect(cleanChatText(raw)).toBeNull()
  })

  it('a bucket allows its burst, then refills at its rate', () => {
    const b = new ChatBucket(2, 2, 0)
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false])
    expect(b.wait(0)).toBeCloseTo(2)
    expect(b.take(2000)).toBe(true)
  })
})

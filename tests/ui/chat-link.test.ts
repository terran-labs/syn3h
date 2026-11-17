/** The Chat row and the Chat card meet only through chatLink: a broken link means a row that opens nothing or shows a stale count. */
import { expect, it } from 'vitest'
import { chatLink } from '../../src/ui/chat/chatLink'

it('open() reports whether a chat surface handled it', () => {
  chatLink.setOpener(null)
  expect(chatLink.open()).toBe(false)
  let opened = 0
  chatLink.setOpener(() => { opened++ })
  expect(chatLink.open()).toBe(true)
  expect(opened).toBe(1)
  chatLink.setOpener(null)
})

it('the unread count reaches subscribers once per change, and stops after unsubscribe', () => {
  const seen: Array<[number, boolean]> = []
  const off = chatLink.subscribe((n, person) => seen.push([n, person]))
  chatLink.setUnread(2, true); chatLink.setUnread(2, true); chatLink.setUnread(0, false)
  off(); chatLink.setUnread(5, false)
  expect(seen).toEqual([[2, true], [0, false]])
  expect(chatLink.unread).toBe(5)
  chatLink.setUnread(0, false)
})

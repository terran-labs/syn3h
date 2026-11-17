import { expect, it } from 'vitest'
import { DEFAULT_ROOM, isDefaultRoom, roomFromQuery, roomLabel, writeRoom } from '../../src/core/roomAddress'
import { inviteUrl } from '../../src/ui/InviteView'

// Bug caught: the public room's internal name leaking into an address or a label.
it('writes the public room as no parameter and any other room by name', () => {
  for (const room of ['lobby', 'Lobby', ' lobby ', '']) expect(writeRoom(new URL('https://syn3h.com/?room=x&v=1'), room).href).toBe('https://syn3h.com/?v=1')
  expect(writeRoom(new URL('https://syn3h.com/'), 'party').href).toBe('https://syn3h.com/?room=party')
  expect(inviteUrl('https://syn3h.com', 'lobby', 'volcanic.1')).toBe('https://syn3h.com/?world=volcanic.1')
  expect(inviteUrl('https://syn3h.com', 'party')).toBe('https://syn3h.com/?room=party')
})

it('reads a missing room, and an old ?room=lobby, as the same public room', () => {
  expect(roomFromQuery(new URLSearchParams(''))).toBe(DEFAULT_ROOM)
  expect(roomFromQuery(new URLSearchParams('room=lobby'))).toBe(DEFAULT_ROOM)
  expect(roomFromQuery(new URLSearchParams('room=party'))).toBe('party')
  expect(isDefaultRoom(null) && isDefaultRoom('LOBBY') && !isDefaultRoom('lobby2')).toBe(true)
})

it('describes the public room in words', () => {
  expect(roomLabel('lobby')).toBe('Public room')
  expect(roomLabel('party')).toBe('party')
})

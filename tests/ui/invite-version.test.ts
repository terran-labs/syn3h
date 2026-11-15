import { describe, expect, it } from 'vitest'
import { inviteUrl } from '../../src/ui/InviteView'

describe('invite versions', () => {
  it('keeps a frozen version while replacing the room and world', () => {
    const result = new URL(inviteUrl('https://example.test/?v=v26.11.1506&room=old&world=old&autoplay=1&vehicle=tank#debug', 'friends & family', 'new-world'))
    expect(result.origin).toBe('https://example.test')
    expect([...result.searchParams]).toEqual([['v', 'v26.11.1506'], ['room', 'friends & family'], ['world', 'new-world']])
    expect(result.hash).toBe('')
  })
  it('leaves unversioned builds unversioned and accepts an origin', () => {
    expect(inviteUrl('https://example.test', 'lobby')).toBe('https://example.test/?room=lobby')
    expect(new URL(inviteUrl('https://example.test/?v=&autoplay=1', 'lobby')).searchParams.has('v')).toBe(false)
  })
})

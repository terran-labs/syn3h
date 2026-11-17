import { describe, expect, it } from 'vitest'
import { LobbyAddress } from '../../src/ui/LobbyAddress'

function browser(href: string) {
  const location = { href }
  const state = { position: 4, ownedBy: 'navigation' }
  const writes: string[] = []
  const history = { state, replaceState(data: unknown, _unused: string, url?: string | URL | null) {
    expect(data).toBe(state)
    location.href = new URL(String(url), location.href).href
    writes.push(location.href)
  } }
  return { location, history, writes, address: new LobbyAddress(location, history) }
}

describe('lobby address presentation', () => {
  it('removes every query field and fragment without changing pathname or history state', () => {
    const b = browser('https://syn3h.com/game/?room=party&world=alpine.15&v=26.11.1519&debug=yes#hello')
    b.address.showLobby()
    expect(b.location.href).toBe('https://syn3h.com/game/')
    expect(b.address.playURL().searchParams.get('world')).toBe('alpine.15')
    b.address.showPlay('party')
    expect(b.location.href).toBe('https://syn3h.com/game/?room=party&world=alpine.15&v=26.11.1519&debug=yes#hello')
  })
  it('keeps nothing in the lobby address, the developer overrides included', () => {
    const b = browser('https://syn3h.com/?room=party&wordmark=3&intro=1#x')
    b.address.showLobby()
    expect(b.location.href).toBe('https://syn3h.com/')
  })
  it('retains entry intent across repeated lobby calls and repeated already-joined play', () => {
    const b = browser('https://syn3h.com/?room=saved&seed=8&autoplay=1#entry')
    b.address.showLobby(); b.address.showLobby(); b.address.showPlay('saved')
    b.address.showLobby(); b.address.showPlay('saved'); b.address.showPlay('saved')
    expect(b.address.playURL().searchParams.get('seed')).toBe('8')
    expect(b.address.playURL().hash).toBe('#entry')
    expect(b.writes).toHaveLength(4)
  })
  it('never shows the public room: an old ?room=lobby link is cleaned at once, and play adds no room', () => {
    const b = browser('https://syn3h.com/?room=lobby&name=Pilot')
    expect(b.location.href).toBe('https://syn3h.com/?name=Pilot')
    b.address.showLobby(); b.address.showPlay('lobby')
    expect(b.location.href).toBe('https://syn3h.com/?name=Pilot')
    expect(b.address.playURL().searchParams.has('room')).toBe(false)
    expect(b.address.inviteURL('lobby', 'volcanic.1')).toBe('https://syn3h.com/?world=volcanic.1')
    for (const write of b.writes) expect(new URL(write).searchParams.has('room')).toBe(false)
  })
  it('keeps flags and the pinned version in play, and never brings room=lobby back with them', () => {
    const b = browser('https://syn3h.com/?v=26.11.1605&wordmark=7&intro=2&gfx=low&webgl&diag&autoplay=1')
    b.address.showLobby()
    expect(b.location.href).toBe('https://syn3h.com/')
    b.address.showPlay('lobby')
    expect(b.location.href).toBe('https://syn3h.com/?v=26.11.1605&wordmark=7&intro=2&gfx=low&webgl=&diag=&autoplay=1')
    expect(b.address.inviteURL('lobby', 'volcanic.1')).toBe('https://syn3h.com/?v=26.11.1605&world=volcanic.1')
  })
  it('hides the world the public room already holds, but keeps it for reloads the game makes', () => {
    const b = browser('https://syn3h.com/?world=volcanic.1&seed=4')
    b.address.showPlay('lobby')
    expect(b.location.href).toBe('https://syn3h.com/')
    expect(b.address.playURL().searchParams.get('world')).toBe('volcanic.1')
    b.address.showLobby(); b.address.showPlay('lobby')
    expect(b.address.playURL().searchParams.get('world')).toBe('volcanic.1')
  })
  it('keeps a private room in the address and its invite', () => {
    const b = browser('https://syn3h.com/?world=volcanic.1')
    b.address.showPlay('party')
    expect(b.location.href).toBe('https://syn3h.com/?world=volcanic.1&room=party')
    expect(b.address.inviteURL('party', 'volcanic.1')).toBe('https://syn3h.com/?room=party&world=volcanic.1')
  })
  it('captures intentional changes made during play and restores them after the menu', () => {
    const b = browser('https://syn3h.com/?room=one')
    b.location.href = 'https://syn3h.com/?room=two&world=desert.42'
    b.address.showLobby(); b.address.showPlay('two')
    expect(b.location.href).toBe('https://syn3h.com/?room=two&world=desert.42')
  })
  it('preserves frozen pathnames and retains query versions only for intentional play and invites', () => {
    const path = browser('https://syn3h.com/v/26.11.1519/?room=ice#x')
    path.address.showLobby()
    expect(path.location.href).toBe('https://syn3h.com/v/26.11.1519/')
    expect(path.address.inviteURL('ice', 'ice.3')).toBe('https://syn3h.com/v/26.11.1519/?room=ice&world=ice.3')
    const query = browser('https://syn3h.com/?v=26.11.1519&room=ice&autoplay=1#x')
    query.address.showLobby()
    expect(query.location.href).toBe('https://syn3h.com/') // Reload here intentionally resolves latest.
    expect(query.address.inviteURL('ice', 'ice.3')).toBe('https://syn3h.com/?v=26.11.1519&room=ice&world=ice.3')
    expect(query.location.href).toBe('https://syn3h.com/') // Copy/QR must not restore the visible URL.
  })
  it('does not alias retained state through a caller-modified URL', () => {
    const b = browser('https://syn3h.com/?room=saved')
    b.address.showLobby()
    const reload = b.address.playURL(); reload.searchParams.set('autoplay', '1')
    b.address.showPlay('saved')
    expect(b.location.href).toBe('https://syn3h.com/?room=saved')
  })
})
// Browser allocation must exercise actual startup invite/resume consumption,
// normal/autoplay entry, openMenu/closeMenu, joined early return and invite/QR.
// These units do not claim the composition or frozen server has been exercised.

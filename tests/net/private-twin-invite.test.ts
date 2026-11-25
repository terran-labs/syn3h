import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeRoom } from '../../src/core/roomAddress'
import { isParallelRoom } from '../../src/net/parallel'
import { privateTwinURL } from '../../src/ui/galaxy/privateTwinInvite'

let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

function entry(visit: string) {
  return (room: string) => {
    const url = writeRoom(new URL(visit), room)
    url.searchParams.set('autoplay', '1')
    return url
  }
}

const roomURL = entry('https://mira.cc/')

describe('private twin invites', () => {
  it('reuses the original room and world for that recipe with the current entry options', () => {
    const originalWorld = 'desert.123~terrain.islandRadius=520'
    const first = privateTwinURL('desert', originalWorld, entry('https://mira.cc/?v=1'))
    const room = first.searchParams.get('room')!
    expect(isParallelRoom(room)).toBe(true)
    expect(first.searchParams.get('world')).toBe(originalWorld)
    expect(first.searchParams.get('autoplay')).toBe('1')

    const again = privateTwinURL('desert', 'desert.999', entry('https://mira.cc/?v=2'))
    expect(again.searchParams.get('room')).toBe(room)
    expect(again.searchParams.get('world')).toBe(originalWorld)
    expect(again.searchParams.get('v')).toBe('2')

    const otherRecipe = privateTwinURL('alpine', 'alpine.321', roomURL)
    expect(otherRecipe.searchParams.get('room')).not.toBe(room)
    expect(otherRecipe.searchParams.get('world')).toBe('alpine.321')
  })

  it('creates its own room on a guest visit and stores only the invite fields', () => {
    const guestRoom = 'p-abcdefghijklmnopqrstuv'
    const guestEntry = entry(`https://mira.cc/?room=${guestRoom}&world=desert.999&token=visit-secret`)
    const own = privateTwinURL('desert', 'desert.123', guestEntry)
    const room = own.searchParams.get('room')!
    expect(isParallelRoom(room)).toBe(true)
    expect(room).not.toBe(guestRoom)
    expect([...store.values()].map(value => JSON.parse(value))).toEqual([{ room, world: 'desert.123' }])
  })

  it('starts fresh after storage is cleared or an invite is invalid', () => {
    const first = privateTwinURL('desert', 'desert.123', roomURL)
    store.clear()
    const second = privateTwinURL('desert', 'desert.456', roomURL)
    expect(second.searchParams.get('room')).not.toBe(first.searchParams.get('room'))
    expect(second.searchParams.get('world')).toBe('desert.456')

    const [key] = store.keys()
    store.set(key, JSON.stringify({ room: 'lobby', world: 'desert.456' }))
    const third = privateTwinURL('desert', 'desert.789', roomURL)
    expect(isParallelRoom(third.searchParams.get('room')!)).toBe(true)
    expect(third.searchParams.get('world')).toBe('desert.789')
  })

  it('opens a fresh room on each tap when storage is unavailable or a write fails', () => {
    const tap = () => privateTwinURL('desert', 'desert.123', roomURL).searchParams.get('room')!
    vi.stubGlobal('localStorage', undefined)
    const first = tap()
    expect(isParallelRoom(first)).toBe(true)
    expect(tap()).not.toBe(first)

    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('Storage quota exceeded') },
    })
    const second = tap()
    expect(isParallelRoom(second)).toBe(true)
    expect(tap()).not.toBe(second)
  })
})

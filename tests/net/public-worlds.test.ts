/**
 * One public world per planet (core/publicWorlds.ts). Bugs caught: tapping a planet and landing on
 * whichever planet the one public room was on (the walkthrough of 25 November 2026); two visitors
 * who chose the same planet in different rooms, or on different worlds of it; an internal room
 * name leaking into an address or invite; a reload of a public planet losing its planet; a full
 * public planet sending someone to a universe of another planet, or not back to its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalNameSeed, canonicalSeed, joinRoom, namesItsOwnWorld, publicRecipeOf, publicRoomFor } from '../../src/core/publicWorlds'
import { canonicalRoom, isDefaultRoom, roomFromQuery, roomLabel, writeRoom } from '../../src/core/roomAddress'
import { inviteAddress, visiblePlayURL } from '../../src/ui/LobbyAddress'
import { parseResume } from '../../src/core/resume'
import { applyStartWorld } from '../../src/core/startWorld'
import { PLANETS, currentPlanet } from '../../src/world/planets'
import { params, worldNameSeed, worldSeed } from '../../shared/params'
import { ROOM_FULL_STATUS } from '../../src/net'
import { ParallelUniverses, type NoticeAction, type UniverseState } from '../../src/ui/parallelUniverse'
import { roomName } from '../../server/util'

const recipes = PLANETS.map(p => p.id)

describe('a planet\'s public world', () => {
  it('is one canonical world per planet: the same for every visitor and session, a different one per planet', () => {
    for (const id of recipes) {
      expect(canonicalSeed(id)).toBe(canonicalSeed(id)); expect(canonicalNameSeed(id)).toBe(canonicalNameSeed(id))
      expect(canonicalSeed(id)).toBeGreaterThanOrEqual(1); expect(canonicalSeed(id)).toBeLessThanOrEqual(999998)
      expect(canonicalNameSeed(id)).toBeGreaterThanOrEqual(1); expect(canonicalNameSeed(id)).toBeLessThanOrEqual(999999998)
    }
    expect(new Set(recipes.map(canonicalSeed)).size).toBe(recipes.length)
  })

  it('two visitors who tap the same planet meet in one room; another planet is another room; nobody joins "lobby"', () => {
    for (const id of recipes) {
      const a = joinRoom('lobby', id), b = joinRoom('', id)
      expect(a).toEqual(b); expect(a.room).toBe(publicRoomFor(id)); expect(a.recipe).toBe(id)
      expect(a.room).not.toBe('lobby')
      // The server keeps the name as it is: the client's room is the server's room.
      expect(roomName(a.room)).toBe(a.room)
    }
    expect(joinRoom('lobby', 'alpine').room).not.toBe(joinRoom('lobby', 'desert').room)
    // A public room's own name typed into ?room= is that planet's public room, whatever planet was current.
    expect(joinRoom('public-alpine', 'desert')).toEqual({ room: 'public-alpine', recipe: 'alpine' })
    // Private rooms and universes are left as they are, with their own worlds.
    expect(joinRoom('friends', 'alpine')).toEqual({ room: 'friends', recipe: null })
    expect(joinRoom('p-abcdefghijklmnopqrstuv', 'alpine')).toEqual({ room: 'p-abcdefghijklmnopqrstuv', recipe: null })
  })

  it('never puts its internal name in an address or an invite', () => {
    const room = publicRoomFor('alpine')
    expect(isDefaultRoom(room)).toBe(true); expect(roomLabel(room)).toBe('Public room')
    expect(writeRoom(new URL('https://mira.cc/?gfx=2'), room).searchParams.has('room')).toBe(false)
    const invite = new URL(inviteAddress(new URL('https://mira.cc/?v=26.11.2405&room=public-alpine'), room, 'alpine.123'))
    expect(invite.searchParams.has('room')).toBe(false); expect(invite.href).not.toContain('public-')
    // A public invite names the planet, never a seed: a seed would open a universe of it.
    expect(invite.searchParams.get('planet')).toBe('alpine'); expect(invite.searchParams.has('world')).toBe(false)
    // A private room's invite still carries its world, so an empty room rebuilds it.
    expect(new URL(inviteAddress(new URL('https://mira.cc/'), 'friends', 'alpine.123')).searchParams.get('world')).toBe('alpine.123')
    const bar = visiblePlayURL(new URL('https://mira.cc/?room=public-alpine&world=alpine.123&gfx=2'))
    expect(bar.href).not.toContain('public-'); expect(bar.searchParams.get('gfx')).toBe('2')
    // Private rooms keep theirs: that is what makes them joinable.
    expect(writeRoom(new URL('https://mira.cc/'), 'friends').searchParams.get('room')).toBe('friends')
    expect(publicRecipeOf('public-alpine')).toBe('alpine'); expect(publicRecipeOf('friends')).toBeNull()
    expect(canonicalRoom('public-alpine')).toBe('public-alpine')
  })
})

describe('a link shared before planets had public worlds', () => {
  it('still shows the world its seed names: a seeded link with no room opens a universe of it, a planet alone its public world', () => {
    expect(namesItsOwnWorld(new URLSearchParams('seed=777'), 777)).toBe(true)
    expect(namesItsOwnWorld(new URLSearchParams('world=alpine.777~world.nameSeed%3D5'), 777)).toBe(true)
    expect(namesItsOwnWorld(new URLSearchParams('planet=alpine'), 777)).toBe(false)
    expect(namesItsOwnWorld(new URLSearchParams(''), 777)).toBe(false)
    // Once the visitor has chosen another world in the lobby, the link no longer decides.
    expect(namesItsOwnWorld(new URLSearchParams('seed=777'), 4242)).toBe(false)
  })
})

describe('a reload of a public planet', () => {
  const saved = (room: string) => ({
    getItem: () => JSON.stringify({
      version: 1, savedAt: Date.now(), room, seed: 777, wasHost: false, world: {}, kind: 'buggy',
      colors: { body: '#123456', accent: '#abcdef' }, p: [10, 12, 20], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
      wingsOpen: false, special: false, cameraMode: 0, timeOfDay: 10,
    }),
  })
  afterEach(() => { params.set(worldSeed.def.id, 1) })

  it('resumes the same public room from the clean address, on its planet\'s canonical world', () => {
    expect(parseResume(saved('public-alpine').getItem(), roomFromQuery(new URLSearchParams()))).not.toBeNull()
    const { source } = applyStartWorld(new URLSearchParams(), saved('public-alpine'), () => 4242)
    expect(source).toBe('resume')
    expect(currentPlanet().id).toBe('alpine')
    expect(worldSeed.value).toBe(canonicalSeed('alpine')); expect(worldNameSeed.value).toBe(canonicalNameSeed('alpine'))
    expect(joinRoom(roomFromQuery(new URLSearchParams()), currentPlanet().id).room).toBe('public-alpine')
  })
  it('never resumes a private room from a clean address', () => {
    expect(parseResume(saved('friends').getItem(), roomFromQuery(new URLSearchParams()))).toBeNull()
  })
})

describe('a full public planet', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  })
  afterEach(() => vi.unstubAllGlobals())
  function page(href: string, joined: (url: URL) => string) {
    const url = new URL(href), navigations: URL[] = [], notices: { text: string; actions: NoticeAction[] }[] = []
    let universe: UniverseState = null
    const u = new ParallelUniverses({
      room: () => joined(url), entryURL: () => new URL(url.href), world: () => 'alpine.' + canonicalSeed('alpine'),
      navigate: next => navigations.push(next), notice: (text, actions) => notices.push({ text, actions }),
      setUniverse: state => { universe = state }, copyLink: () => {},
    })
    return { u, navigations, notices, universe: () => universe }
  }
  const asJoined = (url: URL) => joinRoom(roomFromQuery(url.searchParams), 'alpine').room

  it('leads to a parallel universe of that planet, and Try again back to that planet\'s public world', () => {
    const tapped = page('https://mira.cc/', asJoined)
    tapped.u.onJoinStatus(ROOM_FULL_STATUS)
    const there = new URL(tapped.navigations[0].href)
    expect(there.searchParams.get('room')).toMatch(/^p-/)
    expect(there.searchParams.get('world')).toBe('alpine.' + canonicalSeed('alpine'))
    const inside = page(there.href, asJoined); inside.u.onWelcome()
    expect(inside.notices[0].actions.map(a => a.label)).toEqual(['Copy link', 'Try the main world again'])
    inside.notices[0].actions[1].run()
    const back = inside.navigations[0]
    expect(back.searchParams.has('room')).toBe(false)
    // By its planet alone: a seed here would open a universe of it instead.
    expect(back.searchParams.get('planet')).toBe('alpine'); expect(back.searchParams.has('world')).toBe(false)
    // That address joins Alpine's public room again, not "lobby" and not another planet's.
    expect(asJoined(back)).toBe('public-alpine')
    const main = page(back.href, asJoined); main.u.onWelcome()
    expect(main.universe()?.kind).toBe('public')
  })
})

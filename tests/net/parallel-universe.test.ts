/**
 * Parallel universes (net/parallel.ts, ui/parallelUniverse.ts). Bugs caught: a full public room
 * stranding a newcomer in a world nobody can join; a universe link that does not lead back to the
 * same room and planet; Try again bouncing between full rooms for ever, or throwing away the
 * player's universe; a universe's name showing up where strangers can read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomRegistry } from '../../server/registry'
import { ROOM_FULL_STATUS } from '../../src/net'
import { MAX_HOPS, isParallelRoom, parallelRoomName, takeMove } from '../../src/net/parallel'
import { ParallelUniverses, moveVeilLine, type NoticeAction, type UniverseState } from '../../src/ui/parallelUniverse'
import { canonicalRoom, roomFromQuery } from '../../src/core/roomAddress'

const WORLD = 'desert.12345'
/** One page of the game: its address, what it navigated to, what it showed. */
function page(href: string) {
  const url = new URL(href)
  const navigations: URL[] = [], notices: { text: string; actions: NoticeAction[] }[] = []
  let universe: UniverseState = null
  const u = new ParallelUniverses({
    room: () => roomFromQuery(url.searchParams),
    entryURL: () => new URL(url.href),
    world: () => WORLD,
    navigate: next => navigations.push(next),
    notice: (text, actions) => notices.push({ text, actions }),
    setUniverse: state => { universe = state },
    copyLink: () => {},
  })
  return { u, navigations, notices, universe: () => universe }
}

let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
})
afterEach(() => vi.unstubAllGlobals())

describe('a parallel universe', () => {
  it('is named unguessably, within the server\'s room names', () => {
    const a = parallelRoomName(), b = parallelRoomName()
    expect(a).not.toBe(b)
    expect(canonicalRoom(a)).toBe(a); expect(a.length).toBeLessThanOrEqual(32)
    expect(isParallelRoom(a)).toBe(true); expect(isParallelRoom('lobby')).toBe(false)
  })

  it('takes in a newcomer refused by the full public room: same world, its own link, the line said once', () => {
    const first = page('https://mira.cc/?v=26.11.2405&gfx=2')
    expect(first.u.onJoinStatus(ROOM_FULL_STATUS)).toBe(true)
    expect(first.navigations).toHaveLength(1)
    const to = first.navigations[0]
    const room = to.searchParams.get('room')!
    expect(isParallelRoom(room)).toBe(true)
    expect(to.searchParams.get('world')).toBe(WORLD)
    expect(to.searchParams.get('autoplay')).toBe('1')
    // The visit's own flags and its pinned version go along.
    expect(to.searchParams.get('v')).toBe('26.11.2405'); expect(to.searchParams.get('gfx')).toBe('2')
    // A second refusal on the same page does not navigate twice.
    first.u.onJoinStatus(ROOM_FULL_STATUS); expect(first.navigations).toHaveLength(1)

    const there = page(to.href)
    there.u.onWelcome()
    expect(there.notices).toHaveLength(1)
    expect(there.notices[0].text).toBe("This world is full, so you're in a parallel universe of it. Invite friends with your link.")
    expect(there.notices[0].actions.map(a => a.label)).toEqual(['Copy link', 'Try the main world again'])
    expect(there.universe()?.kind).toBe('parallel')
    // A rejoin after a dropout is not an arrival: nothing is said again.
    there.u.onWelcome(); expect(there.notices).toHaveLength(1)
    // A reload of the universe stays in it (the room is in the address) and says nothing.
    const reload = page(to.href); reload.u.onWelcome()
    expect(reload.notices).toHaveLength(0); expect(reload.universe()?.kind).toBe('parallel')
  })

  it('Try again: joins the main world when it has a seat, and when it is still full goes back to the same universe, said once, with no loop', () => {
    const universe = 'https://mira.cc/?room=p-abcdefghijklmnopqrstuv&world=desert.12345&autoplay=1'
    const inUniverse = page(universe)
    inUniverse.u.tryAgain('lobby')
    const tryMain = inUniverse.navigations[0]
    expect(tryMain.searchParams.has('room')).toBe(false)

    // Still full: back to this very universe, and the line says so.
    const refused = page(tryMain.href)
    refused.u.onJoinStatus(ROOM_FULL_STATUS)
    expect(refused.navigations).toHaveLength(1)
    expect(refused.navigations[0].searchParams.get('room')).toBe('p-abcdefghijklmnopqrstuv')
    const back = page(refused.navigations[0].href)
    back.u.onWelcome()
    expect(back.notices.map(n => n.text)).toEqual(["The main world is still full, so you're back in your parallel universe."])
    expect(back.notices[0].actions.map(a => a.label)).toEqual(['Copy link'])
    expect(back.navigations).toHaveLength(0)

    // A seat was free: in the main world, nothing to say, and the card offers a universe.
    const again = page(universe); again.u.tryAgain('lobby')
    const joined = page(again.navigations[0].href)
    joined.u.onWelcome()
    expect(joined.notices).toHaveLength(0); expect(joined.universe()?.kind).toBe('public')
  })

  it('a friend whose invited room was still full is told it was that world, not the main one', () => {
    const friend = page('https://mira.cc/?room=p-abcdefghijklmnopqrstuv&world=desert.12345')
    friend.u.onJoinStatus(ROOM_FULL_STATUS)
    const there = page(friend.navigations[0].href); there.u.onWelcome()
    expect(there.notices[0].actions.map(a => a.label)).toEqual(['Copy link', 'Try that room again'])
    there.notices[0].actions[1].run()
    const retry = page(there.navigations[0].href)
    expect(retry.navigations).toHaveLength(0)
    retry.u.onJoinStatus(ROOM_FULL_STATUS)
    const back = page(retry.navigations[0].href); back.u.onWelcome()
    expect(back.notices[0].text).toBe("That world is still full, so you're back in your parallel universe.")
    expect(moveVeilLine({ reason: 'still-full', asked: 'p-abcdefghijklmnopqrstuv' })).toBe('That world is still full. Back to your parallel universe.')
    expect(moveVeilLine({ reason: 'returning', asked: 'lobby' })).toBe('Trying the main world.')
  })

  it('stops chasing full rooms: the third refusal in a row stays in local play', () => {
    expect(MAX_HOPS).toBe(3)
    let href = 'https://mira.cc/'
    for (let hop = 1; hop < MAX_HOPS; hop++) {
      const p = page(href); p.u.onJoinStatus(ROOM_FULL_STATUS)
      expect(p.navigations).toHaveLength(1); href = p.navigations[0].href
    }
    const last = page(href); last.u.onJoinStatus(ROOM_FULL_STATUS)
    expect(last.navigations).toHaveLength(0)
    expect(last.notices[0].text).toMatch(/on your own with bots/)
  })

  it('the card\'s button opens a fresh universe of this world; Return goes to the main world', () => {
    const main = page('https://mira.cc/')
    main.u.onWelcome()
    const state = main.universe()
    expect(state?.kind).toBe('public')
    if (state?.kind === 'public') state.enter()
    const to = main.navigations[0]
    expect(isParallelRoom(to.searchParams.get('room')!)).toBe(true); expect(to.searchParams.get('world')).toBe(WORLD)
    const there = page(to.href); there.u.onWelcome()
    expect(there.notices[0].text).toMatch(/^You're in a parallel universe of this planet/)
    const inside = there.universe()
    if (inside?.kind === 'parallel') inside.back()
    expect(there.navigations[0].searchParams.has('room')).toBe(false)
  })

  it('with storage blocked, a full room means local play, said plainly, and no navigation', () => {
    const throwing = () => { throw new Error('SecurityError: storage is blocked') }
    vi.stubGlobal('sessionStorage', { getItem: throwing, setItem: throwing, removeItem: throwing })
    const p = page('https://mira.cc/')
    expect(p.u.onJoinStatus(ROOM_FULL_STATUS)).toBe(true)
    expect(p.navigations).toHaveLength(0)
    expect(p.notices.map(n => n.text)).toEqual(["This world is full, so you're exploring on your own with bots."])
    vi.stubGlobal('sessionStorage', undefined)
    const q = page('https://mira.cc/'); q.u.onJoinStatus(ROOM_FULL_STATUS)
    expect(q.navigations).toHaveLength(0)
  })

  it('leaves any other join status to be shown as it is, and an old note does not outlive its moment', () => {
    expect(page('https://mira.cc/').u.onJoinStatus('This game continued in another tab.')).toBe(false)
    store.set('mira.roomMove', JSON.stringify({ reason: 'full', asked: 'lobby', hops: 1, at: Date.now() - 10 * 60_000 }))
    expect(takeMove()).toBeNull()
  })

  it('is never named where strangers can read: presence counts it under its planet, by number only', () => {
    const r = new RoomRegistry()
    const name = parallelRoomName()
    r.report('lobby', 16, 1000, 'volcanic')
    r.report(name, 2, 1000, 'volcanic')
    const presence = JSON.stringify(r.presence(1500)), totals = JSON.stringify(r.totals(1500))
    expect(presence).not.toContain(name); expect(totals).not.toContain(name)
    expect(r.presence(1500).byRecipe).toEqual([{ recipeId: 'volcanic', rooms: 2, players: 18, oldestReportAt: 1000 }])
  })
})

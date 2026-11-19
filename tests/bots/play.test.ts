/**
 * Bots playing with people (src/bots/play/PlayDirector.ts). Bugs caught: a person who says stop
 * and is grabbed again; a grab with no word first; a grab on someone new, busy or just played
 * with; breaking free three times not counting as stop; the first play not saying how to stop.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { BREAKS_ARE_STOP, COOLDOWN_S, NEW_FOR_S, PlayDirector, type PlayHooks, type PlayPerson, type Tug } from '../../src/bots/play/PlayDirector'
import type { Vehicle } from '../../src/vehicles/Vehicle'

const vehicle = (x: number) => ({ body: { translation: () => ({ x, y: 0, z: 0 }), isValid: () => true } }) as unknown as Vehicle

function room(options: { busy?: boolean; allows?: boolean; sayOk?: boolean; bots?: number } = {}) {
  let t = 0
  const said: { bot: number; text: string; exempt: boolean }[] = []
  const tugs: { bot: number; cancelled: boolean; finished: boolean }[] = []
  const attached = new Set<number>()
  const person: PlayPerson = { id: 1, name: 'Ada', vehicle: vehicle(0), allows: options.allows ?? true, busy: options.busy ?? false }
  const bots = Array.from({ length: options.bots ?? 3 }, (_, i) => ({ id: 0xff00 + i, vehicle: vehicle(10 + i), free: true }))
  const hooks: PlayHooks = {
    now: () => t, explore: () => true, people: () => [person], bots: () => bots,
    tug: (bot) => { const rec = { bot, cancelled: false, finished: false }; tugs.push(rec); attached.add(bot); return { get finished() { return rec.finished || rec.cancelled }, cancel: () => { rec.cancelled = true; attached.delete(bot) } } satisfies Tug },
    attached: (bot) => attached.has(bot),
    say: (bot, text, exempt = false) => { if (options.sayOk === false && !exempt) return false; said.push({ bot, text, exempt }); return true },
    distance: (a, b) => Math.abs(a.body.translation().x - b.body.translation().x),
  }
  const play = new PlayDirector(hooks, 'test')
  const run = (seconds: number) => { for (let i = 0; i < seconds * 2; i++) { t += 0.5; play.update() } }
  /** Run until a play is under way (at most an hour); returns whether one started. */
  const untilPlaying = () => { for (let i = 0; i < 7200 && !play.current; i++) { t += 0.5; play.update() } return play.current !== null }
  return { play, run, untilPlaying, said, tugs, person, advance: (s: number) => { t += s } }
}

afterEach(() => { for (const p of params.all()) params.set(p.def.id, p.def.default) })

describe('bots playing with people', () => {
  it('plays, saying so first, and the first time says how to stop', () => {
    params.set('bots.playRate', 30)
    const r = room()
    expect(r.untilPlaying()).toBe(true)
    expect(r.tugs.length).toBeGreaterThan(0)
    expect(r.said[0].text).toMatch(/say stop/i)
  })
  it('never grabs without a line first: no budget, no play', () => {
    params.set('bots.playRate', 30)
    const r = room({ sayOk: false })
    r.run(3600)
    expect(r.tugs).toEqual([])
  })
  it('never someone new, busy, or who said no in their settings', () => {
    params.set('bots.playRate', 30)
    const fresh = room(); fresh.run(NEW_FOR_S - 10); expect(fresh.tugs).toEqual([])
    const busy = room({ busy: true }); busy.run(3600); expect(busy.tugs).toEqual([])
    const no = room({ allows: false }); no.run(3600); expect(no.tugs).toEqual([])
  })
  it('waits the cooldown before playing with the same person again', () => {
    params.set('bots.playRate', 30)
    const r = room()
    expect(r.untilPlaying()).toBe(true)
    const first = r.tugs.length
    r.run(30)
    expect(r.play.current).toBeNull()
    r.run(COOLDOWN_S - 60)
    expect(r.tugs.length).toBe(first)
    expect(r.untilPlaying()).toBe(true)
    expect(r.tugs.length).toBeGreaterThan(first)
  })
  it('a stop request ends every grab on them at once, kindly, and no play ever again', () => {
    params.set('bots.playRate', 30)
    const r = room()
    expect(r.untilPlaying()).toBe(true)
    r.play.hear(1, 'stop it')
    expect(r.tugs.every(t => t.cancelled)).toBe(true)
    expect(r.play.current).toBeNull()
    const acks = r.said.filter(s => s.exempt)
    expect(acks).toHaveLength(1)
    const before = r.tugs.length
    r.run(COOLDOWN_S * 3)
    expect(r.tugs.length).toBe(before)
    expect(r.play.stopped(1)).toBe(true)
  })
  it('during a play, an unhappy "ugh" counts as stop', () => {
    params.set('bots.playRate', 30)
    const r = room()
    expect(r.untilPlaying()).toBe(true)
    r.play.hear(1, 'ugh')
    expect(r.play.stopped(1)).toBe(true)
  })
  it(`breaking a bot's cord yourself ${BREAKS_ARE_STOP} times counts as stop`, () => {
    params.set('bots.playRate', 30)
    const r = room()
    expect(r.untilPlaying()).toBe(true)
    for (let i = 0; i < BREAKS_ARE_STOP - 1; i++) r.play.unhooked(1, 0xff00)
    expect(r.play.stopped(1)).toBe(false)
    r.play.unhooked(1, 0xff00)
    expect(r.play.stopped(1)).toBe(true)
  })
  it('the room setting turns it off', () => {
    params.set('bots.playRate', 30); params.set('bots.play', false)
    const r = room()
    r.run(3600)
    expect(r.tugs).toEqual([])
  })
})

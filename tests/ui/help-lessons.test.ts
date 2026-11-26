/** Control tips taught by use. Each test names the bug it would catch. */
import { describe, expect, it } from 'vitest'
import { CAP_SECONDS, LEARNED_SECONDS, Lessons, type TipInput } from '../../src/ui/help/lessons'

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } }
const jet = (o: Partial<TipInput> = {}): TipInput => ({ kind: 'jet', touch: false, x: 0, y: 0, z: 0, brakes: false, special: false, fire: false, tagAllowed: true, ...o })
const ids = (lines: { id: string }[]) => lines.map(l => l.id)
const run = (l: Lessons, s: TipInput, seconds: number) => { let out = l.update(0, s); for (let t = 0; t < seconds; t += 0.1) out = l.update(0.1, s); return out }

describe('control tips', () => {
  it('teach a new pilot the jet in hover: lift off, switch to flight, move', () => {
    // Bug: a parked jet with no word on E, Q or Space (the owner's complaint).
    const lines = new Lessons(memory()).update(0.016, jet())
    expect(ids(lines)).toEqual(['jet.hover.liftoff', 'jet.hover.mode', 'jet.hover.move'])
    expect(lines[0].text).toBe('E hold: lift off and climb · Q come down')
    expect(lines[1].text).toBe('Space switch to flight')
  })
  it('drop a lesson once it is used, and remember it on the device', () => {
    // Bug: a player who has lifted off keeps being told how, this visit or the next.
    const store = memory(), l = new Lessons(store)
    run(l, jet({ z: 1 }), 0.6)
    const after = run(l, jet(), LEARNED_SECONDS + 0.2)
    expect(ids(after)).toEqual(['jet.hover.mode', 'jet.hover.move'])
    expect(ids(new Lessons(store).update(0.016, jet()))).toEqual(['jet.hover.mode', 'jet.hover.move'])
  })
  it('a tap of E is not learning to hold it', () => {
    expect(ids(run(new Lessons(memory()), jet({ z: 1 }), 0.2))).toContain('jet.hover.liftoff')
  })
  it('Space teaches the switch and shows the flight lessons', () => {
    // Bug: flight's thrust keys never shown, or the switch lesson never counted.
    const store = memory(), l = new Lessons(store)
    l.update(0.016, jet())
    expect(ids(l.update(0.016, jet({ special: true })))).toEqual(['jet.flight.thrust', 'jet.flight.pitch', 'jet.flight.hover'])
    expect(l.isLearned('jet.hover', 'mode')).toBe(true)
  })
  it('give up after the cap and come back on the next entry', () => {
    // Bug: a box that never leaves a player who ignores it.
    const l = new Lessons(memory())
    expect(run(l, jet(), CAP_SECONDS + 1)).toEqual([])
    l.restart()
    expect(l.update(0.016, jet()).length).toBe(3)
  })
  it('Show tips again forgets every lesson', () => {
    const store = memory(), l = new Lessons(store)
    run(l, jet({ z: 1 }), 0.6); l.forget()
    expect(ids(l.update(0.016, jet()))).toContain('jet.hover.liftoff')
    expect(store.m.size).toBe(0)
  })
  it('say nothing about Plasma Tag where it is not allowed, nor in the Zorb', () => {
    const buggy = (o: Partial<TipInput> = {}) => jet({ kind: 'buggy', ...o })
    expect(ids(new Lessons(memory()).update(0.016, buggy({ tagAllowed: false })))).toEqual(['buggy.drive', 'buggy.wings'])
    expect(new Lessons(memory()).update(0.016, buggy({ zorbed: true }))).toEqual([])
  })
  it('read broken storage as nothing learned', () => {
    const store = memory(); store.setItem('mira.tips.learned', '{nope')
    expect(new Lessons(store).update(0.016, jet()).length).toBe(3)
  })
  it('name the thumb the stick is under, left-handed or not', () => {
    // Bug: a left-handed player was told "Left thumb" while the stick sat under the right thumb.
    const touch = (leftHanded: boolean) => new Lessons(memory()).update(0.016, jet({ touch: true, leftHanded })).find(l => l.id === 'jet.hover.move')!.text
    expect(touch(false)).toBe('Left thumb: move and turn')
    expect(touch(true)).toBe('Right thumb: move and turn')
  })
})

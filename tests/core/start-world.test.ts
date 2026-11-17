import { afterEach, describe, expect, it } from 'vitest'
import { applyStartWorld } from '../../src/core/startWorld'
import { params, worldSeed } from '../../shared/params'
import type { ResumeSnapshot } from '../../src/core/resume'

// Bugs caught: a reload rolling a new planet under a player; a shared link opening the
// wrong world; every new room starting on the same planet.
const session = (seed: number, extra: Partial<ResumeSnapshot> = {}): Pick<Storage, 'getItem'> => ({
  getItem: () => JSON.stringify({
    version: 1, savedAt: Date.now(), room: 'lobby', seed, wasHost: true, world: { 'world.seed': seed }, kind: 'buggy',
    colors: { body: '#123456', accent: '#abcdef' }, p: [10, 12, 20], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
    wingsOpen: false, special: false, cameraMode: 0, timeOfDay: 10, ...extra,
  }),
})
const none: Pick<Storage, 'getItem'> = { getItem: () => null }
afterEach(() => { params.set(worldSeed.def.id, 1) })

describe('the world a tab starts on', () => {
  it('draws a fresh seed when nothing names one', () => {
    expect(applyStartWorld(new URLSearchParams(), none, () => 4242).source).toBe('fresh')
    expect(worldSeed.value).toBe(4242)
  })
  it('keeps the world across a reload of the clean public address', () => {
    const { source, saved } = applyStartWorld(new URLSearchParams(), session(777), () => 4242)
    expect(source).toBe('resume')
    expect(saved?.seed).toBe(777)
    expect(worldSeed.value).toBe(777)
  })
  it('keeps the world across a reload of the link it was entered by', () => {
    applyStartWorld(new URLSearchParams('world=alpine.55'), session(56, { entrySeed: 55 }), () => 4242)
    expect(worldSeed.value).toBe(56)
  })
  it("opens a link's seed, even over a session in this tab on another world", () => {
    applyStartWorld(new URLSearchParams('world=desert.31337'), session(777), () => 4242)
    expect(worldSeed.value).toBe(31337)
    applyStartWorld(new URLSearchParams('seed=9001'), session(777), () => 4242)
    expect(worldSeed.value).toBe(9001)
    applyStartWorld(new URLSearchParams('planet=ice&seed=12'), none, () => 4242)
    expect(worldSeed.value).toBe(12)
  })
})
// An occupied room is never replaced by a newcomer's seed: tests/net/room.test.ts
// 'adopts the first player world into an empty room only'.

/**
 * Day and night (src/world/sky/dayCycle.ts). The bugs these catch: a planet whose day is
 * unplayably short or long, an inner world slower than an outer one, two players in one room
 * under different skies, a sky that jumps when the host changes the day length, and a room
 * that loses or ignores its day length.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { applyPlanet, PLANETS } from '../../src/world/planets'
import { applyRoomWorld } from '../../src/net/params'
import {
  ORBIT_DAY_MAX, ORBIT_DAY_MIN, ORBIT_DEFAULT, bindDayClock, currentHour, effectiveDayLength, followHour,
  hourAt, planetDayLength, planetOrbit, setDayClock,
} from '../../src/world/sky/dayCycle'
import { sunDayEpoch, sunDayLength, sunTimeOfDay } from '../../src/world/sky/skyParams'
import { dayToPosition, positionToSetting } from '../../src/ui/inspector/dayLength'

let now = 1_800_000_000
let unbind: () => void = () => {}
beforeEach(() => {
  now = 1_800_000_000
  setDayClock(() => now)
  applyPlanet('archipelago', 1, { source: 'remote' })
  params.set(sunDayLength.def.id, ORBIT_DEFAULT, 'remote')
  unbind = bindDayClock()
})
afterEach(() => { unbind(); setDayClock(() => Date.now() / 1000) })

describe('day length from orbit', () => {
  it('rises with distance from the sun and stays playable on every planet', () => {
    const byOrbit = PLANETS.map(p => ({ id: p.id, orbit: planetOrbit(p.id), day: planetDayLength(p.id) })).sort((a, b) => a.orbit - b.orbit)
    for (let i = 1; i < byOrbit.length; i++) expect(byOrbit[i].day, `${byOrbit[i].id} after ${byOrbit[i - 1].id}`).toBeGreaterThan(byOrbit[i - 1].day)
    for (const p of byOrbit) {
      expect(p.day).toBeGreaterThanOrEqual(ORBIT_DAY_MIN)
      expect(p.day).toBeLessThanOrEqual(ORBIT_DAY_MAX)
    }
  })
})

describe('the hour', () => {
  it('is the same for two clients on the same room clock and settings, however long each has run', () => {
    // A has been in the room since the anchor; B joins later with nothing but the settings.
    const anchor = { hour: 9.25, at: now - 4321.5, length: 333 }
    const a = hourAt(anchor.hour, anchor.at, anchor.length, now)
    const b = hourAt(anchor.hour, anchor.at, anchor.length, now)
    expect(b).toBe(a)
    // And the registry route a client takes after a welcome agrees with the pure one.
    applyRoomWorld({ ...params.snapshot('world'), [sunTimeOfDay.def.id]: anchor.hour, [sunDayEpoch.def.id]: anchor.at, [sunDayLength.def.id]: anchor.length })
    expect(currentHour(now)).toBeCloseTo(a, 9)
    expect(Number.isFinite(currentHour(now + 1e7))).toBe(true)
  })

  it('does not jump when the day length changes, only its pace', () => {
    now += 1234.5
    const before = currentHour()
    params.set(sunDayLength.def.id, 1800, 'local')
    expect(currentHour()).toBeCloseTo(before, 6)
    params.set(sunDayLength.def.id, 0, 'local')
    expect(currentHour()).toBeCloseTo(before, 6)
    now += 500
    expect(currentHour()).toBeCloseTo(before, 6)
    params.set(sunDayLength.def.id, ORBIT_DEFAULT, 'local')
    expect(currentHour()).toBeCloseTo(before, 6)
    now += planetDayLength('archipelago') / 4
    expect(currentHour()).toBeCloseTo((before + 6) % 24, 6)
  })

  it('setting the hour sets it now', () => {
    now += 999
    params.set(sunTimeOfDay.def.id, 3.5, 'local')
    expect(currentHour()).toBeCloseTo(3.5, 6)
  })

  it('glides across a step and never leaves 0 to 24', () => {
    let shown = 23.9
    for (let i = 0; i < 120; i++) { shown = followHour(shown, 0.5, 1 / 60); expect(shown).toBeGreaterThanOrEqual(0); expect(shown).toBeLessThan(24) }
    expect(shown).toBeCloseTo(0.5, 6)
  })
})

describe('the room setting', () => {
  it('keeps an explicit value and gives the planet default when nothing was stored', () => {
    const world = params.snapshot('world')
    applyRoomWorld({ ...world, [sunDayLength.def.id]: 900 })
    expect(effectiveDayLength()).toBe(900)
    const { [sunDayLength.def.id]: _, ...without } = world
    applyRoomWorld(without)
    expect(sunDayLength.value).toBe(ORBIT_DEFAULT)
    expect(effectiveDayLength()).toBe(planetDayLength('archipelago'))
  })
})

describe('the World card slider', () => {
  it('lands on the planet day as the orbit default, and its first sliver stops the clock', () => {
    const orbit = planetDayLength('desert')
    expect(positionToSetting(dayToPosition(orbit), orbit)).toBe(ORBIT_DEFAULT)
    expect(positionToSetting(0, orbit)).toBe(0)
    expect(positionToSetting(1, orbit)).toBe(3600)
  })
})

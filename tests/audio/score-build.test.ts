// Invariants of the slow build and the theremin lead (src/audio/score/arc.ts). Mix levels are
// tuning and are reported by tests/audio/score-build.mjs, not pinned here.
import { describe, expect, it } from 'vitest'
import { Composer, levels, STEPS_PER_SECTION, type Role } from '../../src/audio/score/Composer'
import { OPENS, intensityCeiling, leadPresence, nightness, roleOpen } from '../../src/audio/score/arc'
import { leadDaylight, leadLobby, leadVolume, scoreBuildTime } from '../../src/audio/params'

/** Play the composer as the conductor does: growth rises with real time, and gates the arc and the intensity. */
function play(buildTime: number, hour: number, seconds: number, lobby = false) {
  let growth = 0, time = 0
  const presence = leadPresence(!lobby, hour, leadVolume.def.default, leadDaylight.def.default, leadLobby.def.default)
  const composer = new Composer(1234)
  composer.allow = role => roleOpen(role, growth, presence, lobby)
  const first: Partial<Record<Role | 'lead' | 'kick', number>> = {}
  const roles = new Set<Role>()
  while (time < seconds) {
    const mood = { intensity: lobby ? 0.06 : Math.min(intensityCeiling(growth), 0.9), lift: 0, darkness: 0.3, triumph: 0 }
    const step = composer.step(mood)
    roles.add(composer.role); first[composer.role] ??= time
    if (step.lead) first.lead ??= time
    if (step.kick) first.kick ??= time
    time += 15 / levels(mood).bpm
    if (!lobby) growth = Math.min(1, growth + 15 / levels(mood).bpm / buildTime)
  }
  return { first, roles }
}

describe('slow build', () => {
  it('never reaches the climb or release faster than the configured build time', () => {
    for (const buildTime of [scoreBuildTime.def.min!, scoreBuildTime.def.default, 600]) {
      const { first } = play(buildTime, 23, buildTime + 400)
      for (const role of ['climb', 'release'] as const) expect(first[role] ?? Infinity, `${role} at ${buildTime}`).toBeGreaterThanOrEqual(OPENS.climb * buildTime)
      expect(first.build ?? Infinity).toBeGreaterThanOrEqual(OPENS.build * buildTime)
      // It does arrive: the full arc is reached in play.
      expect(first.release).toBeDefined()
    }
  })

  it('opens on the still section, with no lead, drums or climb', () => {
    const { first } = play(scoreBuildTime.def.default, 23, 60)
    expect(Object.keys(first).filter(k => k !== 'still')).toEqual([])
  })

  it('keeps the lobby in its still opening, without the lead, however long it plays', () => {
    const { first, roles } = play(scoreBuildTime.def.default, 23, 1800, true)
    expect([...roles]).toEqual(['still'])
    expect(first.lead).toBeUndefined()
    expect(first.kick).toBeUndefined()
    for (const hour of [0, 6, 12, 18.5, 23]) expect(leadPresence(false, hour, 1, 1, 0)).toBe(0)
  })

  it('caps intensity by growth and stays finite on bad input', () => {
    expect(intensityCeiling(0)).toBeLessThan(levels({ intensity: 0, lift: 0, darkness: 0, triumph: 0 }).drums + 0.28)
    expect(levels({ intensity: intensityCeiling(0), lift: 0, darkness: 0, triumph: 0 }).drums).toBe(0)
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(Number.isFinite(intensityCeiling(v))).toBe(true)
      expect(Number.isFinite(nightness(v))).toBe(true)
      expect(Number.isFinite(leadPresence(true, v, v, v, v))).toBe(true)
    }
  })
})

describe('the theremin lead and the hour', () => {
  it('stays under its daytime ceiling by day', () => {
    for (let hour = 8; hour <= 17; hour += 0.25) for (const level of [0, 0.5, 1]) for (const day of [0, 0.25, 1]) {
      expect(leadPresence(true, hour, level, day, 0)).toBeLessThanOrEqual(level * day + 1e-9)
    }
    // With the defaults, the theme is not stated by day at all: the lead waits for the climb.
    const { first } = play(scoreBuildTime.def.default, 13, scoreBuildTime.def.default * 0.79)
    expect(first.lead).toBeUndefined()
  })

  it('changes continuously across dusk and dawn, and is fully forward at night', () => {
    for (let hour = 0; hour < 24; hour += 0.01) expect(Math.abs(nightness(hour + 0.01) - nightness(hour))).toBeLessThan(0.01)
    expect(nightness(13)).toBe(0); expect(nightness(23)).toBe(1); expect(nightness(2)).toBe(1)
    expect(Math.abs(nightness(24) - nightness(0))).toBeLessThan(1e-9)
  })
})

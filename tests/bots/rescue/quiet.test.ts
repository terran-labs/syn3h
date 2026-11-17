/**
 * A stuck bot first frees itself quietly: trouble is announced as a rescue only after
 * bots.rescueAfter seconds of failed self-help, or at once when the bot plainly cannot help
 * itself (upside down past its own righting). The bug it guards: most "rescues" in play were
 * moments a bot got out of by itself a few seconds later, and each one was announced.
 */
import { describe, expect, it } from 'vitest'
import { HostRescue, type RescueEvent } from '../../../src/bots/rescue/HostRescue'
import { rescueAfter, STUCK_AFTER } from '../../../src/bots/rescue/rules'
import type { BotBrain, BotTerrain } from '../../../src/bots/BotBrain'
import type { Vehicle } from '../../../src/vehicles/Vehicle'

function room() {
  const p = { x: 0, y: 1, z: 0 }
  const vehicle = { kind: 'buggy', body: { isValid: () => true, translation: () => p, rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) } } as unknown as Vehicle
  const brain = { trouble: { stuck: 0, flipped: 0, bog: 0 }, holdRecovery: false, directive: null, mind: { reset() {} }, raceGoal: null, rescues: 0, clearTrouble() {}, recover() { brain.rescues++ } }
  const terrain = { heightAt: () => 0, normalAt: (_x: number, _z: number, out: { set(...a: number[]): unknown }) => out.set(0, 1, 0), liquidHeightAt: () => -Infinity } as unknown as BotTerrain
  const events: { t: number; e: RescueEvent }[] = []
  let t = 0
  const rescue = new HostRescue(terrain, {
    isHost: true, connected: true, mode: 2, vehicleOf: (id) => (id === 0xff00 ? vehicle : undefined),
    botGearHooks: {} as never, botCord: () => null, displayName: () => 'Temolin', people: () => [],
  }, { vehicles: [vehicle], brainList: [brain as unknown as BotBrain] }, null, (e) => events.push({ t, e }), () => null)
  const run = (seconds: number, trouble: (s: number) => Partial<typeof brain.trouble>) => {
    for (let i = 0; i < seconds / 0.1; i++) { t += 0.1; Object.assign(brain.trouble, { stuck: 0, flipped: 0, bog: 0 }, trouble(t)); rescue.update(0.1) }
  }
  return { brain, events, run, get t() { return t } }
}

describe('calling a rescue', () => {
  it('a bot that frees itself before bots.rescueAfter is never announced, and its hold is released', () => {
    const r = room()
    const free = rescueAfter.value - 2
    // Stuck from t = 0 until it gets itself out.
    r.run(free, (t) => ({ stuck: t }))
    expect(r.brain.holdRecovery).toBe(true)
    r.run(10, () => ({}))
    expect(r.events.filter((x) => x.e.kind === 'stuck')).toEqual([])
    expect(r.brain.holdRecovery).toBe(false)
  })

  it('a bot still stuck after bots.rescueAfter seconds is announced then, not at the old limit', () => {
    const r = room()
    r.run(rescueAfter.value + 2, (t) => ({ stuck: t }))
    const called = r.events.find((x) => x.e.kind === 'stuck')
    expect(called).toBeDefined()
    expect(called!.t).toBeGreaterThan(rescueAfter.value - 0.6)
    expect(called!.t).toBeLessThan(rescueAfter.value + 1)
  })

  it('a bot upside down past its own righting is announced at once', () => {
    const r = room()
    r.run(STUCK_AFTER.flipped + 1, (t) => ({ flipped: t }))
    const called = r.events.find((x) => x.e.kind === 'stuck')
    expect(called).toBeDefined()
    expect(called!.t).toBeLessThan(STUCK_AFTER.flipped + 1)
  })
})

/**
 * Rescue decisions as invariants: a stuck bot is noticed in bounded time, at most two go,
 * nobody goes with the setting off, a rescue attempt always ends, and the accident-prone bot's
 * mishap rate stays near its setting over a long session.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { MAX_RESCUERS, MishapSchedule, STUCK_AFTER, chooseRescuers, stuckKind, type Candidate } from '../../../src/bots/rescue/rules'
import { TowRescue, type TowGear } from '../../../src/bots/rescue/TowRescue'
import { emptyInput } from '../../../src/core/Input'
import type { Vehicle } from '../../../src/vehicles/Vehicle'
import type { BotTerrain } from '../../../src/bots/BotBrain'
import type { Pilot } from '../../../src/bots/pilot/types'

const crowd = (n: number, over: Partial<Candidate> = {}): Candidate[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, distance: 20 + i * 5, loyalty: 0.3, withPlayer: false, able: true, ...over }))

describe('rescue rules', () => {
  it('notices a stuck, bogged or flipped bot once its trouble passes the limit, and not before', () => {
    expect(stuckKind({ stuck: 0, flipped: 0, bog: 0 })).toBeNull()
    expect(stuckKind({ stuck: STUCK_AFTER.stuck - 0.1, flipped: 0, bog: 0 })).toBeNull()
    expect(stuckKind({ stuck: STUCK_AFTER.stuck, flipped: 0, bog: 0 })).toBe('wedged')
    expect(stuckKind({ stuck: 9, flipped: 0, bog: STUCK_AFTER.bog })).toBe('bogged')
    expect(stuckKind({ stuck: 0, flipped: STUCK_AFTER.flipped, bog: 0 })).toBe('flipped')
    // The coordinator checks twice a second, so noticing takes at most the limit plus half a second.
    expect(Math.max(...Object.values(STUCK_AFTER)) + 0.5).toBeLessThanOrEqual(6)
  })

  it('never sends more than two rescuers, however many could go', () => {
    for (let n = 0; n < 12; n++) {
      for (const stuckFor of [0, 10, 60]) {
        const going = chooseRescuers(crowd(n, { distance: 5 }), { stuckFor, helpers: 0, tag: false, enabled: true })
        expect(going.length).toBeLessThanOrEqual(MAX_RESCUERS)
        const more = chooseRescuers(crowd(n, { distance: 5 }), { stuckFor, helpers: 1, tag: false, enabled: true })
        expect(more.length).toBeLessThanOrEqual(MAX_RESCUERS - 1)
      }
    }
  })

  it('sends nobody with "Bots rescue each other" off', () => {
    expect(chooseRescuers(crowd(6, { distance: 1, eager: true }), { stuckFor: 60, helpers: 0, tag: false, enabled: false })).toEqual([])
  })

  it('the loyal one stays with its player at first; guilt and time change minds', () => {
    const loyal: Candidate = { id: 1, distance: 40, loyalty: 0.8, withPlayer: true, able: true }
    const free: Candidate = { id: 2, distance: 60, loyalty: 0.3, withPlayer: false, able: true }
    expect(chooseRescuers([loyal, free], { stuckFor: 0, helpers: 0, tag: false, enabled: true })).toEqual([2])
    expect(chooseRescuers([loyal], { stuckFor: 30, helpers: 0, tag: false, enabled: true })).toEqual([1])
  })

  it('a rescue attempt always ends, even when the hook never catches', () => {
    const body = (x: number) => {
      const p = new Vector3(x, 0, 0)
      return { body: { isValid: () => true, translation: () => p, rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }), mass: () => 30, applyTorqueImpulse() {} }, kind: 'buggy', input: emptyInput() } as unknown as Vehicle
    }
    const rescuer = body(40), stuck = body(0)
    const terrain = { heightAt: () => 0, normalAt: (_x: number, _z: number, out: Vector3) => out.set(0, 1, 0), size: 400 } as unknown as BotTerrain
    const gear: TowGear = { fire() {}, reel() {}, hold() {}, release() {}, attachedTo: () => false, flying: () => false }
    // A pilot that drives the rescuer straight at its goal, a metre per step.
    const pilot = { profile: {}, reset() {}, drive(goal: { x: number; z: number }) { const p = rescuer.body.translation() as Vector3; const d = Math.hypot(goal.x - p.x, goal.z - p.z) || 1; p.x += (goal.x - p.x) / d * Math.min(1, d); p.z += (goal.z - p.z) / d * Math.min(1, d); return { stuckFor: 0, airborne: false, flipped: false } } } as unknown as Pilot
    const tow = new TowRescue(rescuer, stuck, terrain, gear, pilot, { kind: 'wedged', pull: { x: 1, z: 0 } })
    let t = 0
    while (!tow.finished && t < 600) { tow.step(0.02, emptyInput()); t += 0.02 }
    expect(tow.phase).toBe('failed')
    expect(t).toBeLessThan(150)
  })

  it('the accident-prone bot\'s mishaps stay near their configured rate over a long session', () => {
    for (const perHour of [1, 3, 6, 12]) {
      const hours = 200
      const schedule = new MishapSchedule(`seed${perHour}`, 0, () => perHour)
      let count = 0, last = -Infinity, closest = Infinity
      for (let t = 0; t < hours * 3600; t += 0.5) if (schedule.due(t)) { schedule.happened(t); count++; closest = Math.min(closest, t - last); last = t }
      const rate = count / hours
      expect(rate, `${perHour}/h`).toBeGreaterThan(perHour * 0.85)
      expect(rate, `${perHour}/h`).toBeLessThan(perHour * 1.15)
      expect(closest).toBeGreaterThanOrEqual(240)
    }
    const off = new MishapSchedule('off', 0, () => 0)
    let any = false
    for (let t = 0; t < 36000; t += 0.5) any ||= off.due(t)
    expect(any).toBe(false)
  })

  it('a mishap that comes due while the bot is busy waits for it, and a new rate applies at once', () => {
    // The bug: a turn that came due while the bot was busy was used up, so a bot that was
    // nearly always busy never had a mishap at all.
    let perHour = 3
    const schedule = new MishapSchedule('busy', 0, () => perHour)
    let t = 0
    while (!schedule.due(t)) t += 0.5
    // Busy for ten minutes: still due all along, until it happens.
    for (let k = 0; k < 1200; k++) { t += 0.5; expect(schedule.due(t)).toBe(true) }
    schedule.happened(t)
    expect(schedule.due(t + 239)).toBe(false)
    // Turned up to the most: the next comes within about four minutes plus a short wait, not
    // after the long gap the old rate drew.
    perHour = 12
    let u = t
    while (!schedule.due(u)) u += 0.5
    expect(u - t).toBeGreaterThanOrEqual(240)
    expect(u - t).toBeLessThan(240 + 60 * 8)
  })
})

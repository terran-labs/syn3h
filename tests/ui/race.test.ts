import { describe, expect, it } from 'vitest'
import type { RaceState } from '../../shared/protocol'
import { raceDirection, raceSeconds, raceView } from '../../src/ui/raceModel'
const race: RaceState = { id: 'race-a', revision: 1, phase: 'countdown', remainingMs: 5000, updatedAt: 100, destination: { label: 'Peak', x: -490, y: 1, z: 0, radius: 12 }, participants: [{ id: 1, name: 'Host', status: 'racing' }], winnerId: null, winnerName: null }
const host = { id: 1, host: true, connected: true }
describe('canonical race presentation', () => {
  it('converts seconds to milliseconds and clamps expired or future timestamps', () => {
    expect(raceSeconds(race, 102.1)).toBe(3)
    expect(raceSeconds(race, 90)).toBe(5)
    expect(raceSeconds(race, 110)).toBe(0)
    expect(raceView(race, host, 110).status).toBe('Waiting for start')
    expect(race.phase).toBe('countdown')
  })
  it('never declares a winner when the running deadline expires', () => {
    expect(raceView({ ...race, phase: 'running' }, host, 110).status).toBe('Waiting for result')
  })
  it('separates observer, participant and host controls', () => {
    expect(raceView(race, host, 100)).toMatchObject({ leave: true, cancel: true, role: 'Racing' })
    expect(raceView(race, { id: 2, host: false, connected: true }, 100)).toMatchObject({ leave: false, cancel: false, role: 'Watching' })
    expect(raceView(race, { ...host, connected: false }, 100)).toMatchObject({ leave: false, cancel: false })
    expect(raceView({ ...race, participants: [{ ...race.participants[0], status: 'withdrawn' }] }, host, 100)).toMatchObject({ leave: false, cancel: true, role: 'You left' })
  })
  it('uses the preserved winner name and disables actions at terminal phases', () => {
    expect(raceView({ ...race, phase: 'finished', winnerId: 1, winnerName: 'Original name', participants: [] }, host, 110)).toMatchObject({ status: 'Original name wins', leave: false, cancel: false })
    expect(raceView({ ...race, phase: 'cancelled', reason: 'Host left' }, host, 101).status).toBe('Race cancelled: Host left')
  })
  it('points across the nearby world seam instead of around the world', () => {
    expect(raceDirection(race, { x: 490, z: 0, heading: 0 }, 1000)).toEqual({ metres: 20, degrees: 90 })
    expect(raceDirection(race, { x: 490, z: 0, heading: -Math.PI / 2 }, 1000).degrees).toBe(0)
  })
  it('says how the player did once the race is over, never "Racing"', () => {
    const over = (winnerId: number | null, status: 'racing' | 'finished' | 'withdrawn') => raceView({ ...race, phase: 'finished', winnerId, participants: [{ id: 1, name: 'Host', status }] }, host, 100).role
    expect(over(9, 'racing')).toBe('Did not finish')
    expect(over(1, 'finished')).toBe('You won')
    expect(over(9, 'finished')).toBe('You finished')
    expect(over(9, 'withdrawn')).toBe('You left')
    expect(raceView({ ...race, phase: 'cancelled' }, host, 100).role).not.toBe('Racing')
  })
})

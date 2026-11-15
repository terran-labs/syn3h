import { describe, expect, it } from 'vitest'
import type { RaceState, RaceUpdate } from '../../shared/protocol'
import type { Terrain } from '../../src/world/Terrain'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import type { Navigator } from '../../src/bots/pilot/types'
import { BotRaces, type BotRaceCandidate } from '../../src/bots/races'

function setup() {
  let now = 100, reachable = true, dry = true
  const humanPos = { x: 0, y: 1, z: 0 }, botPos = { x: 4, y: 1, z: 0 }
  const vehicle = (name: string, p: typeof humanPos) => ({ name, kind: 'buggy', body: { isValid: () => true, translation: () => p } }) as unknown as Vehicle
  const candidates: BotRaceCandidate[] = [{ id: 1, vehicle: vehicle('Alice', humanPos), active: true, human: true }, { id: 65280, vehicle: vehicle('Bot', botPos), active: true, human: false }]
  const terrain = { size: 1000, heightAt: () => 0, liquidHeightAt: () => dry ? -Infinity : 1 } as unknown as Terrain
  const nav: Navigator = { passable: () => dry, invalidate() {}, route: (from, to) => ({ points: [from, to], cost: 150, reached: reachable }) }
  const published: RaceUpdate[] = []
  const races = new BotRaces(terrain, nav, () => [{ x: 150, y: 0, z: 0, kind: 'road-end', name: 'East road' }])
  races.setHooks({ now: () => now, candidates: () => candidates, publish: s => published.push(s) })
  const ack = (overrides: Partial<RaceState> = {}) => { const s = published.at(-1)!; races.apply({ ...s, updatedAt: now, winnerName: null, ...overrides }) }
  const advance = (seconds: number) => { now += seconds; races.update() }
  const start = () => { advance(30); ack(); advance(5); ack() }
  return { races, candidates, humanPos, botPos, published, ack, advance, start, setReachable: (v: boolean) => { reachable = v }, setDry: (v: boolean) => { dry = v } }
}

describe('automatic landmark races', () => {
  it('announces a countdown and waits for the room to accept transitions', () => {
    const s = setup()
    s.advance(29); expect(s.published).toHaveLength(0)
    s.advance(1); expect(s.published[0].phase).toBe('countdown')
    expect(s.races.goal(s.candidates[1].vehicle)).toBeNull()
    s.advance(1); expect(s.published).toHaveLength(1)
    s.ack(); expect(s.races.goal(s.candidates[1].vehicle)?.countdown).toBe(true)
    s.advance(5); expect(s.published.at(-1)?.phase).toBe('running')
    s.ack(); expect(s.races.goal(s.candidates[1].vehicle)?.countdown).toBe(false)
    expect(s.races.goal(s.candidates[0].vehicle)).toBeNull()
  })
  it('does not draft spectators or race to unreachable or wet landmarks', () => {
    for (const cause of ['spectator', 'route', 'water']) {
      const s = setup()
      if (cause === 'spectator') s.candidates[0].active = false
      if (cause === 'route') s.setReachable(false)
      if (cause === 'water') s.setDry(false)
      s.advance(30); expect(s.published).toHaveLength(0)
    }
  })
  it('records a finish crossing and keeps a cooldown after the result', () => {
    const s = setup(); s.start()
    for (let x = 0; x <= 145; x += 5) { s.humanPos.x = x; s.advance(0.1) }
    expect(s.published.at(-1)?.phase).toBe('finished')
    expect(s.published.at(-1)?.winnerId).toBe(1)
    s.ack(); const n = s.published.length
    s.advance(8); s.advance(20); expect(s.published).toHaveLength(n)
  })
  it('does not award a teleport into the finish circle', () => {
    const s = setup(); s.start(); s.advance(0.02)
    s.humanPos.x = 150; s.advance(0.02); s.advance(0.02)
    expect(s.published.at(-1)?.phase).toBe('running')
  })
  it('cancels when withdrawal leaves no contest and clears bot direction', () => {
    const s = setup(); s.start()
    s.candidates[0].active = false; s.advance(0.02)
    expect(s.published.at(-1)?.reason).toBe('no-contest')
    expect(s.races.goal(s.candidates[1].vehicle)).toBeNull()
  })
  it('accepts canonical withdrawals and ignores stale state', () => {
    const s = setup(); s.start()
    const state = s.published.at(-1)!
    s.ack({ revision: state.revision + 1, participants: state.participants.map(p => ({ ...p, status: p.id === 1 ? 'withdrawn' : 'racing' })) })
    s.ack({ revision: 1 })
    s.advance(0.02)
    expect(s.published.at(-1)?.phase).toBe('cancelled')
    expect(s.published.at(-1)!.revision).toBeGreaterThan(state.revision + 1)
  })
  it('never migrates an old host race and stops driving after authority loss', () => {
    const s = setup(); s.start()
    s.races.setHooks(null)
    s.ack(); s.advance(200)
    expect(s.published).toHaveLength(2)
    expect(s.races.goal(s.candidates[1].vehicle)).toBeNull()
  })
  it('uses the countdown deadline to bound a late running transition', () => {
    const s = setup(); s.advance(30); s.ack(); s.advance(8)
    expect(s.published.at(-1)?.remainingMs).toBe(117000)
  })
  it('times out without inventing a winner', () => {
    const s = setup(); s.start(); s.advance(120)
    expect(s.published.at(-1)?.phase).toBe('finished')
    expect(s.published.at(-1)?.winnerId).toBeNull()
    expect(s.published.at(-1)?.reason).toBe('timeout')
  })
})

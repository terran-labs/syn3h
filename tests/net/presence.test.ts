import { describe, expect, it } from 'vitest'
import { RoomRegistry, PRESENCE_TTL_MS } from '../../server/registry'
import { PresenceReporter, type RoomPresenceReport } from '../../server/presenceReporter'
import { Room, type Peer } from '../../server/room'
import { PROTOCOL_VERSION } from '../../shared/protocol'
import { PLANETS } from '../../src/world/planets'
import { recipeIdForLook } from '../../shared/recipes'

const row = (recipeId: string | null, rooms: number, players: number, oldestReportAt: number) => ({ recipeId, rooms, players, oldestReportAt })
describe('aggregate presence', () => {
  it('groups distinct rooms and replaces world classification without duplicating population', () => {
    const r = new RoomRegistry()
    r.report('private-a', 2, 100, 'alpine'); r.report('private-b', 1, 200, 'alpine')
    expect(r.presence(300).byRecipe).toEqual([row('alpine', 2, 3, 100)])
    r.report('private-a', 2, 400, 'desert')
    expect(r.presence(500).byRecipe).toEqual([row('alpine', 1, 1, 200), row('desert', 1, 2, 400)])
    expect(JSON.stringify(r.presence(500))).not.toContain('private-')
    r.report('private-a', 0, 500)
    expect(r.presence(500).byRecipe).toEqual([row('alpine', 1, 1, 200)])
  })
  it('expires presence at ninety seconds without shortening status retention', () => {
    const r = new RoomRegistry(); r.report('a', 2, 100, 'alpine')
    expect(r.presence(100 + PRESENCE_TTL_MS - 1).byRecipe).toHaveLength(1)
    expect(r.presence(100 + PRESENCE_TTL_MS).byRecipe).toEqual([])
    expect(r.totals(100 + PRESENCE_TTL_MS)).toEqual({ rooms: 1, players: 2 })
  })
  it('restores old data as unknown and clears old classification on legacy report', () => {
    const r = new RoomRegistry({ legacy: { players: 2, at: 100 } })
    expect(r.presence(200).byRecipe).toEqual([row(null, 1, 2, 100)])
    r.report('legacy', 2, 300, 'alpine'); r.report('legacy', 2, 400)
    expect(new RoomRegistry(r.save()).presence(500).byRecipe).toEqual([row(null, 1, 2, 400)])
  })
  it('uses the same recipe mapping as every planet', () => {
    for (const p of PLANETS) expect(recipeIdForLook(p.values['terrain.look'])).toBe(p.id)
    expect(recipeIdForLook(999)).toBeNull(); expect(recipeIdForLook('2')).toBeNull()
  })
  it('reflects an idle world reset even with a connected spectator', () => {
    let now = 1000
    const r = new Room('idle', { now: () => now })
    const peer: Peer = { send() {}, close() {} }
    r.connect(peer)
    r.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'A', params: { 'terrain.look': 2, 'world.seed': 123 } }))
    for (let i = 0; i < 320; i++) {
      now += 1000; r.receive(peer, JSON.stringify({ type: 'ping', t: i }))
    }
    expect(r.presence().players).toBe(1)
    expect(r.presence().recipeId).toBe(new Room('fresh').presence().recipeId)
    expect(r.presence().seed).toBe(new Room('fresh').presence().seed)
  })
  it('reads current room settings and excludes pending and held clients', () => {
    let now = 1000
    const r = new Room('private', { now: () => now })
    const peer: Peer = { send() {}, close() {} }
    r.connect(peer); expect(r.presence().players).toBe(0)
    r.receive(peer, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'A', resume: 'presence-test-token-12345678', params: { 'terrain.look': 2, 'world.seed': 123 } }))
    expect(r.presence()).toEqual({ players: 1, recipeId: 'alpine', seed: 123 })
    r.receive(peer, JSON.stringify({ type: 'param', id: 'terrain.look', value: 1 }))
    r.receive(peer, JSON.stringify({ type: 'param', id: 'world.seed', value: 456 }))
    expect(r.presence()).toEqual({ players: 1, recipeId: 'desert', seed: 456 })
    now += 100; r.disconnect(peer)
    expect(r.presence().players).toBe(0)
    expect(r.heldCount).toBe(1)
  })
})

describe('ordered room reports', () => {
  const report = (players = 1, recipeId: RoomPresenceReport['recipeId'] = 'alpine') => ({ room: 'room', players, recipeId })
  it('coalesces changes during a request and sends the latest after it finishes', async () => {
    const sent: RoomPresenceReport[] = []; let release!: () => void
    const first = new Promise<void>(r => { release = r })
    const reporter = new PresenceReporter(async r => { sent.push(r); if (sent.length === 1) await first }, () => 1000)
    const done = reporter.report(report(), 1)
    void reporter.report(report(2, 'desert'), 2)
    void reporter.report(report(0, 'desert'), 3)
    expect(sent).toHaveLength(1); release(); await done
    expect(sent).toEqual([report(), report(0, 'desert')])
  })
  it('refreshes on seed-only changes and after thirty seconds, without publishing the seed', async () => {
    let now = 0; const sent: RoomPresenceReport[] = []
    const reporter = new PresenceReporter(async r => { sent.push(r) }, () => now)
    await reporter.report(report(), 1); now = 1; await reporter.report(report(), 1)
    expect(sent).toHaveLength(1)
    await reporter.report(report(), 2); expect(sent).toHaveLength(2)
    now = 30001; await reporter.report(report(), 2); expect(sent).toHaveLength(3)
    expect(Object.keys(sent[0]).sort()).toEqual(['players', 'recipeId', 'room'])
  })
  it('retries failed delivery with bounded backoff rather than marking it delivered', async () => {
    let now = 0, attempts = 0
    const reporter = new PresenceReporter(async () => { if (++attempts === 1) throw new Error('offline') }, () => now)
    await reporter.report(report(), 1); now = 500; await reporter.report(report(2), 1)
    expect(attempts).toBe(1)
    now = 1000; await reporter.report(report(2), 1); expect(attempts).toBe(2)
    await reporter.report(report(2), 1); expect(attempts).toBe(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { RaceBridge } from '../../src/net/races'
import type { ClientMessage, RaceState } from '../../shared/protocol'

const snapshot = (): RaceState => ({ id: 'race-a', revision: 1, phase: 'countdown', remainingMs: 5000, updatedAt: 10,
  destination: { label: 'Ridge', x: 100, y: 0, z: 0, radius: 10 }, participants: [{ id: 1, name: 'Host', status: 'racing' }], winnerId: null, winnerName: null })
function fixture() {
  const role = { id: 1, host: true, connected: true }
  const messages: ClientMessage[] = []
  let driving = false, synced = true
  const bots = { setRaces: vi.fn(), applyRace: vi.fn() }
  const display = vi.fn(), now = () => 10
  const bridge = new RaceBridge({ now, role: () => role, synced: () => synced, bots: () => bots, candidates: () => [], send: m => messages.push(m) })
  bridge.configure({ isDriving: () => driving, setRace: display })
  return { bridge, role, messages, bots, display, now, drive: (v: boolean) => { driving = v }, sync: (v: boolean) => { synced = v } }
}
describe('Race client lifecycle', () => {
  it('announces actual driving changes once and preserves the stable UI clock callback', () => {
    const f = fixture()
    expect(f.messages).toEqual([{ type: 'race-ready', driving: false }])
    f.bridge.update(); expect(f.messages).toHaveLength(1)
    f.drive(true); f.bridge.update()
    expect(f.messages.at(-1)).toEqual({ type: 'race-ready', driving: true })
    f.bridge.receive(snapshot())
    expect(f.display).toHaveBeenLastCalledWith(snapshot(), f.now, f.role)
    expect(f.bots.setRaces).toHaveBeenCalledTimes(1)
  })
  it('forwards canonical corrections including lower revisions and null to the director', () => {
    const f = fixture()
    f.bridge.receive({ ...snapshot(), revision: 2 }); f.bridge.receive(snapshot()); f.bridge.receive(null)
    expect(f.bots.applyRace.mock.calls.slice(-3).map(c => c[0]?.revision ?? null)).toEqual([2, 1, null])
    expect(f.bridge.snapshot).toBeNull()
  })
  it('uninstalls host simulation on role loss and disconnect, then republishes readiness on rejoin', () => {
    const f = fixture()
    f.drive(true); f.bridge.update(); f.bridge.receive(snapshot())
    f.role.host = false; f.bridge.update()
    expect(f.bots.setRaces).toHaveBeenLastCalledWith(null)
    f.role.connected = false; f.bridge.disconnect()
    expect(f.bridge.snapshot).toBeNull()
    f.role.connected = true; f.bridge.update()
    expect(f.messages.at(-1)).toEqual({ type: 'race-ready', driving: true })
    expect(f.bots.setRaces).toHaveBeenCalledTimes(2)
  })
  it('does not install simulation before clock sync, and restricts cancel to host', () => {
    const f = fixture()
    f.sync(false); f.bridge.update(); expect(f.bots.setRaces).toHaveBeenLastCalledWith(null)
    f.bridge.receive(snapshot()); f.role.host = false
    f.bridge.cancel(); expect(f.messages.filter(m => m.type === 'race')).toEqual([])
    f.bridge.leave(); expect(f.messages.at(-1)).toEqual({ type: 'race-leave', id: 'race-a' })
    f.role.host = true; f.bridge.cancel()
    expect(f.messages.at(-1)).toMatchObject({ type: 'race', race: { phase: 'cancelled', revision: 2 } })
  })
})

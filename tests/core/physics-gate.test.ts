import { describe, expect, it } from 'vitest'
import { PhysicsGate } from '../../src/core/physicsGate'

/**
 * The bug a player hit before 23 November 2026: a physics download that failed once (a dropped
 * connection, a stalled file) ended the page in "reload". The gate must keep trying in place,
 * let a waiting player try at once, and become ready exactly once.
 */
function fakeClock() {
  const timers: { fn: () => void; ms: number }[] = []
  return { timers, set: (fn: () => void, ms: number) => { const t = { fn, ms }; timers.push(t); return t }, clear: (t: unknown) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1) }, fire() { const t = timers.shift(); t?.fn() } }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('PhysicsGate', () => {
  it('fails once, waits, retries by itself and becomes ready', async () => {
    let calls = 0
    const clock = fakeClock()
    const gate = new PhysicsGate(async () => { if (++calls === 1) throw new Error('offline') }, [2000, 5000], clock)
    let ready = false
    void gate.start().then(() => { ready = true })
    await tick()
    expect(gate.state).toBe('waiting'); expect(gate.nextDelayMs).toBe(2000); expect(ready).toBe(false)
    clock.fire(); await tick(); await tick()
    expect(gate.state).toBe('ready'); expect(ready).toBe(true); expect(gate.attempts).toBe(2)
  })
  it('lets a waiting player try at once, and backs off further on repeated failure', async () => {
    let fail = true
    const clock = fakeClock()
    const gate = new PhysicsGate(async () => { if (fail) throw new Error('blocked') }, [2000, 5000], clock)
    void gate.start(); await tick()
    gate.retryNow(); await tick()
    expect(gate.attempts).toBe(2); expect(gate.nextDelayMs).toBe(5000); expect(clock.timers.length).toBe(1)
    fail = false
    gate.retryNow(); await tick(); await tick()
    expect(gate.state).toBe('ready'); expect(clock.timers.length).toBe(0)
    gate.retryNow()
    expect(gate.attempts).toBe(3)
  })
  it('starts once however often it is asked', async () => {
    let calls = 0
    const gate = new PhysicsGate(async () => { calls++ })
    await Promise.all([gate.start(), gate.start()])
    expect(calls).toBe(1)
  })
})

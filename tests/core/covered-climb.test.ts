// A covered quality climb's job control (src/core/coveredClimb.ts). The bugs these catch: a
// player who leaves a world mid-climb must not leave the job drawing a disposed scene; a slow
// device behind an open menu must not have its climb cut short when nobody is waiting; and the
// Applying veil must not hang once someone is.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CoveredClimbRun } from '../../src/core/coveredClimb'

const VEIL_MS = 8_000
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** A job of `steps` steps, one per `stepMs`, checking between steps as Game's job does. */
function job(steps: number, stepMs: number, ran: { steps: number }) {
  return async (run: CoveredClimbRun) => {
    for (let i = 0; i < steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepMs))
      run.check()
      ran.steps++
    }
  }
}

it('stops a job at its next step when the world goes away, and runs no step after', async () => {
  const run = new CoveredClimbRun(VEIL_MS), ran = { steps: 0 }
  const outcome = run.run(job(10, 100, ran))
  await vi.advanceTimersByTimeAsync(350)
  const before = ran.steps
  run.abort()
  await expect(outcome).resolves.toBe('aborted')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(ran.steps).toBe(before)
  expect(run.signal.aborted).toBe(true)
})

it('lets a job behind the open menu take as long as it needs', async () => {
  const run = new CoveredClimbRun(VEIL_MS), ran = { steps: 0 }
  const steps = Math.ceil((VEIL_MS * 3) / 100)
  const outcome = run.run(job(steps, 100, ran))
  await vi.advanceTimersByTimeAsync(VEIL_MS * 3 + 100)
  await expect(outcome).resolves.toBe('done')
  expect(ran.steps).toBe(steps)
})

it('ends a job not done the veil ceiling after the Applying veil went up', async () => {
  const run = new CoveredClimbRun(VEIL_MS), ran = { steps: 0 }
  const outcome = run.run(job(1_000, 100, ran))
  await vi.advanceTimersByTimeAsync(VEIL_MS * 2) // behind the menu: no ceiling yet
  run.veilShown()
  await vi.advanceTimersByTimeAsync(VEIL_MS - 1)
  let settled = false
  void outcome.then(() => { settled = true })
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await expect(outcome).resolves.toBe('veil')
})

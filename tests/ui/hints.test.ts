import { describe, expect, it } from 'vitest'
import { PlayHints, liftOffHint, type HintState } from '../../src/ui/PlayHints'
import { quickHelp, touchHelp, vehicleHelp } from '../../src/ui/VehicleHelp'

const parked: HintState = { kind: 'jet', touch: false, altitude: 0.8, speed: 0, steer: 0, pitch: 1, throttle: 0, hoverMode: true }
const run = (hints: PlayHints, seconds: number, state: HintState) => { const out = []; for (let t = 0; t < seconds; t += 0.1) { const h = hints.update(0.1, state); if (h) out.push(h.text) } return out }

describe('jet lift-off', () => {
  it('every jet controls text leads with how to lift off', () => {
    expect(quickHelp('jet')[0]).toMatch(/^Hold R to lift off/)
    expect(vehicleHelp('jet')[0]).toMatch(/^Hold R to lift off/)
    expect(quickHelp('jet', true)[0]).toBe('Hold THR + to lift off')
    expect(touchHelp('jet')).toMatch(/^Hold THR \+ to lift off/)
  })
  it('speaks up after two seconds of W on a parked jet, naming the right control', () => {
    expect(run(new PlayHints(), 1.8, parked)).toEqual([])
    expect(run(new PlayHints(), 2.5, parked)).toEqual(['Hold R to lift off'])
    expect(run(new PlayHints(), 2.5, { ...parked, touch: true })).toEqual(['Hold THR + to lift off'])
    expect(liftOffHint(true).touchAction).toBe('throttleUp')
  })
  it('waits between repeats and gives up after three', () => {
    expect(run(new PlayHints(), 13, parked)).toHaveLength(1)
    expect(run(new PlayHints(), 120, parked)).toHaveLength(3)
  })
  it('stays quiet for a jet that is idle, flying, throttling, or not a jet', () => {
    expect(run(new PlayHints(), 10, { ...parked, pitch: 0 })).toEqual([])
    expect(run(new PlayHints(), 10, { ...parked, altitude: 40 })).toEqual([])
    expect(run(new PlayHints(), 10, { ...parked, hoverMode: false, speed: 60 })).toEqual([])
    expect(run(new PlayHints(), 10, { ...parked, kind: 'buggy' })).toEqual([])
    const hints = new PlayHints()
    run(hints, 1, { ...parked, throttle: 1 })
    expect(run(hints, 30, parked), 'once the throttle has been found, never again').toEqual([])
  })
})

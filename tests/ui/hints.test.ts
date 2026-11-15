import { describe, expect, it } from 'vitest'
import { PlayHints, liftOffHint, wingsHint, type HintState } from '../../src/ui/PlayHints'
import { quickHelp, touchHelp, vehicleHelp } from '../../src/ui/VehicleHelp'

const parked: HintState = { kind: 'jet', touch: false, altitude: 0.8, speed: 0, steer: 0, pitch: 1, throttle: 0, hoverMode: true, canLiftOut: false }
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

describe('wings out of lava or water', () => {
  const sunk: HintState = { kind: 'buggy', touch: false, altitude: 0, speed: 1, steer: 0, pitch: 1, throttle: 0, hoverMode: true, canLiftOut: true }
  it('names Space on a keyboard and the WINGS button on touch', () => {
    expect(run(new PlayHints(), 2, sunk)).toEqual(['Space: wings to lift out'])
    expect(run(new PlayHints(), 2, { ...sunk, touch: true })).toEqual(['WINGS: lift out'])
    expect(wingsHint(true).touchAction).toBe('special')
  })
  it('ignores a splash, repeats while the buggy stays sunk and stops at five', () => {
    expect(run(new PlayHints(), 0.5, sunk)).toEqual([])
    expect(run(new PlayHints(), 20, sunk)).toHaveLength(3)
    expect(run(new PlayHints(), 200, sunk)).toHaveLength(5)
    expect(run(new PlayHints(), 30, { ...sunk, canLiftOut: false })).toEqual([])
  })
  it('controls text mentions the zorb ball for every vehicle', () => {
    for (const kind of ['buggy', 'jet', 'hovercraft'] as const) { expect(vehicleHelp(kind).join(' ')).toContain('X: zorb ball'); expect(touchHelp(kind)).toContain('ZORB') }
  })
})


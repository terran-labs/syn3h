import { describe, expect, it } from 'vitest'
import { motionMix } from '../../src/audio/Engine'
import { params } from '../../shared/params'
import '../../src/audio/params'

describe('vehicle audio mix', () => {
  it('keeps idle audible and raises pitch under load', () => {
    const idle = motionMix({ speed: 0, throttle: 0, airborne: false })
    const drive = motionMix({ speed: 35, throttle: 1, airborne: false })
    expect(idle.engine).toBeGreaterThan(0)
    expect(idle.dirt).toBe(0)
    expect(idle.wind).toBe(0)
    expect(drive.pitch).toBeGreaterThan(idle.pitch)
    expect(drive.engine).toBeGreaterThan(idle.engine)
    expect(drive.dirt).toBeGreaterThan(0)
  })
  it('removes dirt in flight and adds wind without changing engine pitch', () => {
    const ground = motionMix({ speed: 20, throttle: 0.5, airborne: false })
    const flight = motionMix({ speed: 20, throttle: 0.5, airborne: true })
    expect(flight.dirt).toBe(0)
    expect(flight.wind).toBeGreaterThan(ground.wind)
    expect(flight.pitch).toBe(ground.pitch)
  })
  it('bounds extreme input and treats reverse like forward', () => {
    expect(motionMix({ speed: -30, throttle: -1, airborne: false })).toEqual(motionMix({ speed: 30, throttle: 1, airborne: false }))
    const extreme = motionMix({ speed: 1e9, throttle: 1e9, airborne: true })
    for (const [name, value] of Object.entries(extreme)) {
      expect(Number.isFinite(value)).toBe(true)
      if (name !== 'pitch') expect(value).toBeLessThanOrEqual(1)
    }
  })
  it('never shares personal audio settings with the room', () => {
    const audio = params.all().filter(p => p.def.id.startsWith('audio.'))
    expect(audio.length).toBeGreaterThan(5)
    expect(audio.every(p => p.def.scope === 'client')).toBe(true)
    expect(Object.keys(params.snapshot('world')).some(key => key.startsWith('audio.'))).toBe(false)
  })
})

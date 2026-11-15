import { describe, expect, it } from 'vitest'
import { CrashWatcher, SURFACES, impactStrength, surfaceOf } from '../../src/audio/Impacts'
import { PLANETS } from '../../src/world/planets'

describe('impact sounds', () => {
  it('turns speed lost into a strength', () => {
    expect(impactStrength(0)).toBe(0); expect(impactStrength(2)).toBe(0)
    expect(impactStrength(11)).toBeCloseTo(0.5)
    expect(impactStrength(20)).toBe(1); expect(impactStrength(400)).toBe(1)
    expect(impactStrength(Number.NaN)).toBe(0)
  })

  it('knows what every world is made of', () => {
    for (const planet of PLANETS) expect(SURFACES, planet.id).toContain(surfaceOf(planet.id))
    // Every world has been given a surface on purpose; none falls through to the default.
    const named = new Set(['volcanic', 'desert', 'alpine', 'archipelago', 'ice', 'obsidian', 'badlands', 'moon', 'swamp'])
    expect(PLANETS.map(p => p.id).filter(id => !named.has(id))).toEqual([])
    expect(surfaceOf('desert')).toBe('sand'); expect(surfaceOf('obsidian')).toBe('glass'); expect(surfaceOf('moon')).toBe('dust')
    expect(surfaceOf('alpine', 10, 80)).toBe('soil'); expect(surfaceOf('alpine', 120, 80)).toBe('snow')
    expect(surfaceOf('somewhere new')).toBe('rock')
  })
})

describe('crash watcher', () => {
  const at = (x: number) => ({ x, y: 0, z: 0 }), going = (vx: number) => ({ x: vx, y: 0, z: 0 })
  it('hears a sudden stop and ignores ordinary driving', () => {
    const watch = new CrashWatcher()
    expect(watch.step(at(0), going(20), 0)).toBe(0)
    // Braking hard: a quarter of a metre per second in a step.
    expect(watch.step(at(0.33), going(19.75), 1 / 60)).toBe(0)
    // A wall.
    expect(watch.step(at(0.66), going(2), 2 / 60)).toBeCloseTo(17.75)
  })
  it('counts a bounce off the same wall once', () => {
    const watch = new CrashWatcher()
    watch.step(at(0), going(20), 0)
    expect(watch.step(at(0.3), going(0), 0.016)).toBe(20)
    expect(watch.step(at(0.3), going(-6), 0.033)).toBe(0)
    expect(watch.step(at(0.2), going(4), 0.5)).toBe(10)
  })
  it('does not mistake a respawn or a wrap of the world for a crash', () => {
    const watch = new CrashWatcher()
    watch.step(at(0), going(30), 0)
    expect(watch.step(at(500), going(0), 0.016)).toBe(0)
    expect(watch.step(at(500), going(0), 0.033)).toBe(0)
  })
  it('stays quiet when another system has already made the sound', () => {
    const watch = new CrashWatcher()
    watch.step(at(0), going(20), 0)
    watch.suppress(0.01)
    expect(watch.step(at(0.3), going(0), 0.016)).toBe(0)
  })
  it('starts clean after a reset', () => {
    const watch = new CrashWatcher()
    watch.step(at(0), going(20), 0); watch.reset()
    expect(watch.step(at(0), going(0), 0.016)).toBe(0)
  })
})

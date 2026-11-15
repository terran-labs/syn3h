import { describe, expect, it } from 'vitest'
import { steer, type V3 } from '../../src/weapons/pester/steer'
import { pesterLife, pesterSpeed, pesterTurn } from '../../src/weapons/pester/params'

const DT = 1 / 50

/** Chase a target moving along `path(t)`; the closest the Pester gets in its lifetime. */
function chase(path: (t: number) => V3, speed: number = pesterSpeed.def.default, turn: number = pesterTurn.def.default, life: number = pesterLife.def.default): number {
  const p: V3 = [0, 2, 0]
  const v: V3 = [0, speed * 0.3, -speed]
  let closest = Infinity
  for (let i = 0; i < life / DT; i++) {
    const tgt = path(i * DT)
    steer(v, [tgt[0] - p[0], tgt[1] - p[1], tgt[2] - p[2]], speed, turn, DT)
    for (let k = 0; k < 3; k++) p[k] += v[k] * DT
    closest = Math.min(closest, Math.hypot(tgt[0] - p[0], tgt[1] - p[1], tgt[2] - p[2]))
  }
  return closest
}

describe('Pester steering', () => {
  it('catches a parked vehicle', () => {
    expect(chase(() => [30, 1, -60])).toBeLessThan(1)
  })

  it('catches a slow driver', () => {
    expect(chase((t) => [0, 1, -40 - 10 * t])).toBeLessThan(1)
  })

  it('cannot catch a buggy driving straight away at full speed', () => {
    expect(chase((t) => [0, 1, -40 - 32 * t])).toBeGreaterThan(10)
  })

  it('overshoots a driver who jinks hard at the last moment', () => {
    // Driving across its path at 20 m/s, swerving back and forth every 1.5 s.
    const weave = (t: number): V3 => [40 * Math.sin(t * 2.1), 1, -50 - 12 * t]
    expect(chase(weave, pesterSpeed.def.default, 0.9)).toBeGreaterThan(2)
  })

  it('keeps its speed', () => {
    const v: V3 = [5, 0, 0]
    steer(v, [0, 0, -10], 24, 1.6, DT)
    expect(Math.hypot(...v)).toBeCloseTo(24)
  })
})

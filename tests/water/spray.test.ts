import { describe, expect, it } from 'vitest'
import { ARMS, SpraySim, WAKE_LIFT, sprayCapacity } from '../../src/world/water/spraySim'

// A gently sloping sea so tests can tell a re-queried height from the caller's y.
const sea = { liquidHeightAt: (x: number) => x * .01 }
const cap = sprayCapacity(2)
const drive = (sim: SpraySim, frames: number, speed = 20, sub = .5, dt = 1 / 60, id = 'a') => {
  let x = 0
  for (let i = 0; i < frames; i++) { sim.step(dt); x += speed * dt; sim.vehicle(id, x, sea.liquidHeightAt(x), 0, speed, 0, 0, sub, dt) }
  return x
}
const live = (sim: SpraySim) => sim.dropletCount + sim.wakePoints + sim.ringCount
/** Everything on the surface, as the renderer gets it. */
const foam = (sim: SpraySim) => {
  const n = cap.vehicles * ARMS * cap.points + cap.rings + cap.ripplets, A = new Float32Array(n * 4), B = new Float32Array(n * 4), S = new Float32Array(n * 4), L = new Float32Array(n * 4)
  return { A, B, S, L, m: sim.packSurface(A, B, S, L) }
}
/** Strips of a kind (1 crest, 2 churn, 3 trail) by their side vectors' length. */
const strips = (f: ReturnType<typeof foam>, kind: number) => {
  const out: number[] = []
  for (let i = 0; i < f.m; i++) { const l = Math.hypot(f.S[i * 4], f.S[i * 4 + 1]); if (l > .5 && Math.round(l) === kind) out.push(i) }
  return out
}

describe('spray simulation', () => {
  it('emits nothing while dry', () => {
    const sim = new SpraySim(cap, sea)
    drive(sim, 300, 20, 0)
    expect(live(sim)).toBe(0)
    expect(sim.packSurface(new Float32Array(4096), new Float32Array(4096), new Float32Array(4096), new Float32Array(4096))).toBe(0)
  })

  it('makes droplets, mist and a connected wake when skimming', () => {
    const sim = new SpraySim(cap, sea)
    drive(sim, 120)
    expect(sim.dropletCount).toBeGreaterThan(50)
    // A run of points down the middle; segments join consecutive points plus the live head.
    expect(sim.wakePoints).toBeGreaterThan(10)
    const n = cap.vehicles * ARMS * cap.points + cap.rings + cap.ripplets, A = new Float32Array(n * 4), B = new Float32Array(n * 4), S = new Float32Array(n * 4), L = new Float32Array(n * 4)
    const segments = sim.packSurface(A, B, S, L)
    // A fast first touchdown also splashes: its foam ring, and the small rings where its drops
    // landed, are drawn after the wake.
    expect(segments).toBe(sim.wakePoints + sim.ringCount + sim.rippletCount)
    // Consecutive segments of one arm share their joint exactly: no gaps, no overlapping slats.
    expect(A[4]).toBe(B[0]); expect(A[6]).toBe(B[2]); expect(S[4 + 0]).toBe(S[2]); expect(S[4 + 1]).toBe(S[3])
    // Foam rides the true moving surface, a little above it.
    for (let i = 0; i < segments - sim.ringCount - sim.rippletCount; i++) expect(A[i * 4 + 1]).toBeCloseTo(sea.liquidHeightAt(A[i * 4]) + WAKE_LIFT, 4)
  })

  it('grows the wake with speed', () => {
    const span = (speed: number) => {
      const sim = new SpraySim(cap, sea); drive(sim, 240, speed)
      const { A, m } = foam(sim)
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < m; i++) { lo = Math.min(lo, A[i * 4]); hi = Math.max(hi, A[i * 4]) }
      return hi - lo
    }
    expect(span(20)).toBeGreaterThan(span(6))
  })

  it('lays no points while stationary, so nothing stacks', () => {
    const sim = new SpraySim(cap, sea)
    for (let i = 0; i < 600; i++) { sim.step(1 / 60); sim.vehicle('a', 0, 0, 0, 0, 0, 0, 1, 1 / 60) }
    expect(sim.wakePoints).toBe(0); expect(sim.dropletCount).toBe(0)
  })

  it('lands droplets on the surface and ages the wake out', () => {
    const sim = new SpraySim(cap, sea)
    drive(sim, 60)
    expect(sim.dropletCount).toBeGreaterThan(0)
    for (let i = 0; i < 600; i++) sim.step(1 / 60)
    expect(sim.dropletCount).toBe(0); expect(sim.wakePoints).toBe(0)
    // Droplets die where they meet the water, not at some fixed life.
    const one = new SpraySim(cap, { liquidHeightAt: () => 0 })
    one.vehicle('a', 0, 0, 0, 10, 0, 0, 1, .1)
    let t = 0; while (one.dropletCount > 0 && t < 5) { one.step(1 / 120); t += 1 / 120 }
    expect(t).toBeLessThan(2)
  })

  it('throws a crown and one ring on entry, scaled by impact', () => {
    const count = (vy: number) => {
      const sim = new SpraySim(cap, sea)
      sim.vehicle('a', 0, 0, 0, 0, 0, 0, 0, 1 / 60)
      expect(sim.vehicle('a', 0, 0, 0, 0, vy, 0, .6, 1 / 60)).toBe(true)
      expect(sim.ringCount).toBe(1)
      return sim.dropletCount
    }
    expect(count(-12)).toBeGreaterThan(count(-3))
    const calm = new SpraySim(cap, sea)
    calm.vehicle('a', 0, 0, 0, 0, 0, 0, 0, 1 / 60)
    expect(calm.vehicle('a', 0, 0, 0, 0, -.5, 0, .6, 1 / 60)).toBe(false)
  })

  it('shift moves live state', () => {
    const sim = new SpraySim(cap, { liquidHeightAt: () => 0 })
    drive(sim, 60)
    sim.vehicle('b', 0, 0, 0, 0, -8, 0, 0, 0); sim.vehicle('b', 0, 0, 0, 0, -8, 0, 1, 1 / 60)
    const d = sim.droplets[0], p = sim.points[0], r = sim.rings[0], h = sim.armHead[0]
    sim.shift(1000, -500)
    expect(sim.droplets[0]).toBeCloseTo(d + 1000, 2); expect(sim.droplets[2]).not.toBeNaN()
    expect(sim.points[0]).toBeCloseTo(p + 1000, 2); expect(sim.rings[0]).toBeCloseTo(r + 1000, 2); expect(sim.armHead[0]).toBeCloseTo(h + 1000, 2)
    // After the shift a vehicle reported at the shifted place continues its wake rather than breaking it.
    const before = sim.wakePoints
    sim.step(1 / 60); sim.vehicle('a', 1000 + 20.5, 0, -500, 20, 0, 0, .5, 1 / 60)
    expect(sim.wakePoints).toBeGreaterThanOrEqual(before - 3)
  })

  // 30,000 simulation steps: the 5 s default timed out at load 25 on 17 Nov.
  it('stays bounded over 10,000 steps with more vehicles than slots', () => {
    for (const tier of [0, 1, 2]) {
      const c = sprayCapacity(tier), sim = new SpraySim(c, sea)
      const sizes = [sim.droplets.length, sim.points.length, sim.rings.length]
      for (let i = 0; i < 10000; i++) {
        sim.step(1 / 60)
        for (let v = 0; v < c.vehicles + 3; v++) {
          const x = (i * .4 + v * 7) % 300
          sim.vehicle(`v${v}`, x, 0, v * 9, 24, i % 97 === 0 ? -10 : 0, 3, i % 97 === 1 ? 0 : .6, 1 / 60)
        }
        expect(sim.dropletCount).toBeLessThanOrEqual(c.droplets)
        expect(sim.ringCount).toBeLessThanOrEqual(c.rings)
        expect(sim.wakePoints).toBeLessThanOrEqual(c.vehicles * ARMS * c.points)
        expect(sim.vehicleCount).toBeLessThanOrEqual(c.vehicles)
      }
      expect([sim.droplets.length, sim.points.length, sim.rings.length]).toEqual(sizes)
    }
  }, 20000)

  it('thins every source evenly instead of overwriting when the pool is full', () => {
    const c = sprayCapacity(0), sim = new SpraySim(c, sea)
    let full = 0
    for (let i = 0; i < 1200; i++) {
      sim.step(1 / 60)
      for (let v = 0; v < 4; v++) sim.vehicle(`v${v}`, i * .4, 0, v * 20, 24, 0, 0, .8, 1 / 60)
      if (i > 300 && sim.dropletCount >= c.droplets) full++
    }
    expect(sim.throttle).toBeLessThan(.6)
    expect(sim.dropletCount).toBeLessThanOrEqual(c.droplets)
    // Once the throttle has settled the pool is rarely at its limit and refusals stop growing.
    expect(full).toBeLessThan(60)
    const refused = sim.refused
    for (let i = 0; i < 300; i++) { sim.step(1 / 60); for (let v = 0; v < 4; v++) sim.vehicle(`v${v}`, (1200 + i) * .4, 0, v * 20, 24, 0, 0, .8, 1 / 60) }
    expect(sim.refused - refused).toBeLessThan(60)
  })

  it('leaves a hull one wake from its stern, with no lines beside it unless the bow swell is on', () => {
    // The owner (18 November 2026): no edge wakes; arms beside a hull read as drawn lines.
    const sim = new SpraySim(cap, sea); drive(sim, 120, 14)
    const f = foam(sim), trail = strips(f, 3)
    expect(trail.length).toBeGreaterThan(4)
    // All of it down the middle: no strip leaves the line the hull drove along by more than its own half width.
    for (const i of trail) expect(Math.abs(f.A[i * 4 + 2])).toBeLessThan(f.A[i * 4 + 3] + .01)
    expect(Math.max(...trail.map((i) => f.L[i * 4]))).toBeGreaterThan(0)
    const swell = new SpraySim(cap, sea); swell.bowSwell = true; drive(swell, 120, 14)
    const g = foam(swell)
    expect(strips(g, 3).some((i) => Math.abs(g.A[i * 4 + 2]) > 1)).toBe(true)
  })

  it('leaves a ball one trail from its patch, and no bridge over the water it skipped', () => {
    const sim = new SpraySim(cap, sea), ball = { ball: 5 }
    let x = 0
    const run = (frames: number, sub: number) => { for (let i = 0; i < frames; i++) { sim.step(1 / 60); x += 14 / 60; sim.vehicle('z', x, sea.liquidHeightAt(x), 0, 14, 0, 0, sub, 1 / 60, 1, ball) } }
    run(60, .2); const leftAt = x; run(30, 0); const backAt = x; run(60, .2)
    const f = foam(sim)
    const trail = strips(f, 3)
    expect(trail.length).toBeGreaterThan(4)
    // No strip spans the half second in the air.
    for (const i of trail) expect(Math.min(f.A[i * 4], f.B[i * 4]) >= backAt - .5 || Math.max(f.A[i * 4], f.B[i * 4]) <= leftAt + .5).toBe(true)
    // Wider than a hull's crest: as wide as the patch the ball dips.
    expect(Math.max(...trail.map((i) => f.A[i * 4 + 3]))).toBeGreaterThan(1)
  })

  it('disturbs the water under a cushion or a low jet only when close, never when far', () => {
    for (const air of ['cushion', 'downwash'] as const) {
      const near = new SpraySim(cap, sea), far = new SpraySim(cap, sea)
      for (let i = 0; i < 120; i++) for (const [sim, n] of [[near, .8], [far, 0]] as const) { sim.step(1 / 60); sim.vehicle('h', i * .25, sea.liquidHeightAt(i * .25), 0, 15, 0, 0, 0, 1 / 60, 1, { ball: 0, air, near: n, beam: 1.6 }) }
      expect(strips(foam(near), 3).length, air).toBeGreaterThan(2); expect(near.dropletCount, air).toBeGreaterThan(0)
      expect(live(far), air).toBe(0)
    }
  })

  it('fades strips through bends tighter than their width instead of folding', () => {
    // A turn of 2.5 m radius at 15 m/s: some strips are wider than their bend, some narrower.
    const sim = new SpraySim(cap, sea), r = 2.5, w = 15 / r
    for (let i = 0; i < 240; i++) {
      const t = i / 60, x = r * Math.sin(w * t), z = r * Math.cos(w * t)
      sim.step(1 / 60); sim.vehicle('a', x, 0, z, 15 * Math.cos(w * t), 0, -15 * Math.sin(w * t), .5, 1 / 60)
    }
    const n = cap.vehicles * ARMS * cap.points + cap.rings, A = new Float32Array(n * 4), B = new Float32Array(n * 4), S = new Float32Array(n * 4), L = new Float32Array(n * 4)
    const m = sim.packSurface(A, B, S, L)
    // Wherever a segment is wider than the bend it sits on, it must have faded out rather than
    // cross itself. Bend radius from the turn between the two end sides, as the strip is drawn.
    let tight = 0, loose = 0
    for (let i = 0; i < m; i++) {
      const o = i * 4, ax = S[o], az = S[o + 1], bx = S[o + 2], bz = S[o + 3], la = Math.hypot(ax, az), lb = Math.hypot(bx, bz)
      if (la < .5) continue
      const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / la / lb)))
      const radius = Math.hypot(B[o] - A[o], B[o + 2] - A[o + 2]) / Math.max(turn, 1e-6), half = Math.max(A[o + 3], B[o + 3])
      if (half > radius) { tight++; expect(Math.max(L[o], L[o + 1])).toBeLessThan(.01) } else if (half < radius * .5) loose++
    }
    expect(tight).toBeGreaterThan(0); expect(loose).toBeGreaterThan(0)
  })

  it('ignores bad input', () => {
    const sim = new SpraySim(cap, sea)
    sim.vehicle('a', NaN, 0, 0, 20, 0, 0, 1, 1 / 60); sim.vehicle('a', 0, 0, 0, Infinity, 0, 0, 1, 1 / 60); sim.shift(NaN, 0); sim.step(NaN)
    expect(live(sim)).toBe(0)
  })
})

describe('spray render wrapper', () => {
  it('allocates once at the quality tier, emits nothing when off, and disposes', async () => {
    const T = await import('three/webgpu')
    const { Spray, waterSpray } = await import('../../src/world/water/spray')
    const { graphicsLevel } = await import('../../src/core/quality')
    const level = graphicsLevel.value, enabled = waterSpray.value
    const scene = new T.Scene(), ripples = { disturb: () => {} } as never
    const spray = new Spray(scene, ripples, sea)
    try {
      (graphicsLevel as { value: number }).value = 1; spray.update(1 / 60)
      expect(scene.children.map(o => o.name).sort()).toEqual(['water-foam', 'water-spray'])
      expect(spray.state!.cap).toEqual(sprayCapacity(1))
      const meshes = [...scene.children]
      for (let i = 0; i < 30; i++) { spray.update(1 / 60); spray.vehicle('a', new T.Vector3(i * .5, 0, 0), new T.Vector3(30, 0, 0), .5, 1 / 60) }
      expect(scene.children).toEqual(meshes)
      waterSpray.value = false; spray.update(1 / 60)
      spray.vehicle('a', new T.Vector3(), new T.Vector3(30, 0, 0), 1, 1 / 60)
      expect(scene.children).toHaveLength(0); expect(spray.state).toBeNull()
    } finally { waterSpray.value = enabled; (graphicsLevel as { value: number }).value = level; spray.dispose() }
  })
})

/**
 * Headless Zorb liquid scenarios: a full-size zorbed buggy launched across open water or lava at
 * a chosen speed and entry angle, shared by the skip invariants (zorb-skip.test.ts) and the
 * handling report. The liquid surface is y = 0 and the ball travels toward -Z, coasting with no
 * input unless a scenario presses something.
 */
import * as THREE from 'three/webgpu'
import { FIXED_DT } from '../../src/core/physics'
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { basinBed, type Liquid } from '../vehicles/liquidScenarios'

export interface ZorbSea {
  liquid: Liquid
  /** Bed depth below the surface, metres. Shallower than the ball's diameter means it scrapes. */
  depth: number
  /** Real waves from the game's wave field, on the scenario's clock. */
  waves?: 'sea' | 'inland'
}

export interface ZorbSample { t: number; z: number; y: number; vy: number; speed: number; base: number; skipping: number }
export interface ZorbRun { v: Vehicle; clock: { t: number }; step(n?: number): void; trace: ZorbSample[]; dispose(): void; radius: number; bed: (z: number) => number }

const c = new THREE.Vector3()

/**
 * A grown ball over the open sea, its base `clearance` metres above the surface, moving at
 * `speed` m/s along -Z and `angle` degrees down toward the surface. The ball grows in zero
 * gravity far above the liquid first, so it starts full size and still.
 */
export function zorbLaunch(sea: ZorbSea, speed: number, angle: number, clearance = 0.05): ZorbRun {
  const length = 1600
  const { h, g, clock } = basinBed({ liquid: sea.liquid, length, depth: sea.depth, slope: 30, waves: sea.waves })
  const v = new MiraBuggy(h.game, h.terrain, new THREE.Vector3(0, 60, -40))
  v.isLocal = false
  v.input.zorb = true
  const gravity = h.world.gravity.y
  h.world.gravity = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < 900 && !(v.zorb.target > 0 && v.zorb.radius === v.zorb.target); i++) {
    h.step(v)
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }
  h.world.gravity = { x: 0, y: gravity, z: 0 }
  const r = v.zorb.radius
  const a = (angle * Math.PI) / 180
  // Put the ball's centre where asked; the body origin sits the keel below it.
  const off = v.zorb.centre(c).sub(v.body.translation() as THREE.Vector3)
  const start = new THREE.Vector3(0, r + clearance, -40)
  v.body.setTranslation({ x: start.x - off.x, y: start.y - off.y, z: start.z - off.z }, true)
  v.body.setLinvel({ x: 0, y: -speed * Math.sin(a), z: -speed * Math.cos(a) }, true)
  v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  const trace: ZorbSample[] = []
  const run: ZorbRun = {
    v, clock, trace, radius: r, bed: g,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        h.step(v)
        clock.t += FIXED_DT
        const p = v.zorb.centre(c), l = v.body.linvel()
        const s = h.terrain.liquidHeightAt!(p.x, p.z)
        trace.push({ t: clock.t, z: p.z, y: p.y, vy: l.y, speed: Math.hypot(l.x, l.z), base: p.y - r - (Number.isFinite(s) ? s : 0), skipping: v.zorb.skimming })
      }
    },
    dispose() { v.dispose(); h.world.free() },
  }
  return run
}

/** Step until `seconds` have passed. */
export const coast = (run: ZorbRun, seconds: number) => run.step(Math.round(seconds / FIXED_DT))

/**
 * Times the ball left the liquid after touching it: its base rose `gap` metres clear of the
 * surface. A skip, not the bob of a ball floating on a wave.
 */
export function skipsOf(trace: ZorbSample[], gap = 0.15): number {
  let wet = false, n = 0
  for (const s of trace) {
    if (s.base <= 0) wet = true
    else if (wet && s.base > gap) { n++; wet = false }
  }
  return n
}

/** Horizontal speed at time `t` into the run. */
export const speedAt = (trace: ZorbSample[], t: number) => trace[Math.min(trace.length - 1, Math.max(0, Math.round(t / FIXED_DT) - 1))].speed

/** Summary used by the report and the tests. */
export function summary(run: ZorbRun) {
  const tr = run.trace, t0 = tr.findIndex((s) => s.base <= 0)
  const first = t0 < 0 ? tr[0] : tr[t0]
  const after1 = tr[Math.min(tr.length - 1, Math.max(0, t0) + Math.round(1 / FIXED_DT))]
  const last = tr[tr.length - 1]
  const settled = tr.findIndex((s, i) => i > t0 && s.speed < first.speed * 0.5)
  return {
    skips: skipsOf(tr),
    entrySpeed: first.speed,
    lossFirstSecond: first.speed - after1.speed,
    lossPerMetreFirstSecond: (first.speed - after1.speed) / Math.max(1e-6, Math.abs(after1.z - first.z)),
    halfSpeedAfter: settled < 0 ? null : (settled - t0) * FIXED_DT,
    halfSpeedDistance: settled < 0 ? null : Math.abs(tr[settled].z - first.z),
    deepest: -Math.min(...tr.map((s) => s.base)),
    finalSpeed: last.speed,
    distance: Math.abs(last.z - tr[0].z),
  }
}

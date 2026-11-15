/**
 * Hovercraft pilot on real Rapier with the real Hovercraft. Every test logs its measurements
 * ("hovercraft pilot:" lines) so a run reports times and errors, not only pass or fail.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { FIXED_DT, initPhysics, RAPIER } from '../../../src/core/physics'
import { Hovercraft, hoverAssist } from '../../../src/vehicles/Hovercraft'
import { createHovercraftPilot } from '../../../src/bots/pilot/hovercraft'
import type { DriveGoal, Pilot, PilotStatus } from '../../../src/bots/pilot/types'
import { ridge, testWorld, type HeightFn, type TestWorld } from './world'

beforeAll(initPhysics)
afterEach(() => { hoverAssist.value = 1 })
const report = (name: string, values: Record<string, number | string | boolean>) =>
  console.log(`hovercraft pilot: ${name}: ` + Object.entries(values).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(2) : v}`).join(', '))

interface Run { w: TestWorld; v: Hovercraft; pilot: Pilot; t: number; status: PilotStatus; path: number; turned: number; maxStuck: number }
function launch(height: HeightFn = () => 0, heading = 0, size = 600): Run {
  const w = testWorld(height, size)
  const v = new Hovercraft(w.game, w.terrain, new THREE.Vector3(0, height(0, 0) + 2.5, 0), heading); v.isLocal = false
  return { w, v, pilot: createHovercraftPilot(v, w.terrain), t: 0, status: { stuckFor: 0, airborne: false, flipped: false }, path: 0, turned: 0, maxStuck: 0 }
}
const where = (r: Run) => r.v.body.translation()
const distTo = (r: Run, g: { x: number; z: number }) => { const p = where(r); return Math.hypot(g.x - p.x, g.z - p.z) }
function drive(r: Run, goal: DriveGoal, seconds: number, until?: () => boolean, each?: () => void): number {
  const start = r.t
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    const a = where(r), ax = a.x, az = a.z
    r.status = r.w.step(r.v, r.pilot, goal); r.t += FIXED_DT
    const b = where(r); r.path += Math.hypot(b.x - ax, b.z - az)
    r.turned += Math.abs(r.v.body.angvel().y) * FIXED_DT * 180 / Math.PI
    r.maxStuck = Math.max(r.maxStuck, r.status.stuckFor)
    each?.()
    if (until?.()) break
  }
  return r.t - start
}
/** Drive a waypoint list, switching at `radius` metres; the last one is a stop. */
function course(r: Run, points: { x: number; z: number }[], speed: number, radius: number, seconds: number) {
  const times: number[] = []
  for (let k = 0; k < points.length; k++) {
    const last = k === points.length - 1, g = points[k]
    const t = drive(r, { ...g, speed, stopWithin: last ? 4 : undefined }, seconds, () => distTo(r, g) < (last ? 4 : radius))
    times.push(t)
  }
  let ideal = 0, px = 0, pz = 0
  for (const p of points) { ideal += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z }
  return { times, ideal, total: times.reduce((a, b) => a + b, 0) }
}

describe('hovercraft pilot, glide assistance on', () => {
  it('drives a four corner square without orbiting', () => {
    const r = launch()
    const square = [{ x: 0, z: -60 }, { x: 60, z: -60 }, { x: 60, z: 0 }, { x: 0, z: 0 }]
    const c = course(r, square, 15, 6, 40)
    report('square', { total_s: c.total, legs_s: c.times.map(t => t.toFixed(1)).join('/'), path_m: r.path, ideal_m: c.ideal, ratio: r.path / c.ideal, yawTurned_deg: r.turned })
    expect(distTo(r, square[3])).toBeLessThan(4)
    expect(r.path / c.ideal).toBeLessThan(1.2)
    // A square turns 270 degrees in total; an orbit would add 360 more.
    expect(r.turned).toBeLessThan(450)
    expect(c.total).toBeLessThan(30)
  })

  it('runs a slalom through alternating gates', () => {
    const r = launch()
    const gates = Array.from({ length: 6 }, (_, i) => ({ x: i % 2 ? -10 : 10, z: -35 * (i + 1) }))
    const c = course(r, gates, 12, 5, 30)
    let worstGate = 0
    report('slalom', { total_s: c.total, path_m: r.path, ideal_m: c.ideal, ratio: r.path / c.ideal, yawTurned_deg: r.turned })
    for (const t of c.times) worstGate = Math.max(worstGate, t)
    expect(distTo(r, gates[5])).toBeLessThan(4)
    expect(r.path / c.ideal).toBeLessThan(1.15)
    expect(worstGate).toBeLessThan(8)
  })

  it('holds the requested speed on a straight', () => {
    const r = launch()
    let sum = 0, n = 0, max = 0
    drive(r, { x: 0, z: -400, speed: 8 }, 40, () => where(r).z < -250, () => {
      const v = r.v.body.linvel(), s = Math.hypot(v.x, v.z)
      if (where(r).z < -50) { sum += s; n++; max = Math.max(max, s) }
    })
    report('speed 8', { mean: sum / n, max })
    expect(Math.abs(sum / n - 8)).toBeLessThan(.5)
    expect(max).toBeLessThan(9)
  })

  it('stops inside the radius and stays for 10 seconds', () => {
    const r = launch()
    const goal: DriveGoal = { x: 30, z: -90, speed: 15, stopWithin: 4 }
    const arrive = drive(r, goal, 30, () => distTo(r, goal) < 4)
    let worst = 0
    drive(r, goal, 10, undefined, () => { worst = Math.max(worst, distTo(r, goal)) })
    report('stop and stay', { arrive_s: arrive, worstDistanceIn10s_m: worst, distanceAfter10s_m: distTo(r, goal), stuckFor: r.status.stuckFor })
    expect(worst).toBeLessThan(4)
    expect(r.status.stuckFor).toBe(0)
  })

  it('recovers from a 180 degree heading error', () => {
    // Facing +Z; the goal is 80 m toward -Z. It cannot reverse, so it must turn round.
    const r = launch(() => 0, Math.PI)
    const goal = { x: 0, z: -80 }
    const t = drive(r, { ...goal, speed: 12, stopWithin: 4 }, 30, () => distTo(r, goal) < 4)
    report('180 degree heading error', { reached_s: t, path_m: r.path, ratio: r.path / 80 })
    expect(distTo(r, goal)).toBeLessThan(4)
    expect(r.path / 80).toBeLessThan(1.3)
  })

  it('crosses a ridge and a side slope to a waypoint', () => {
    // A 12 m ridge across the route on ground that also slopes to one side.
    const height: HeightFn = (x, z) => ridge(-60, 12, 20)(x, z) + x * .15
    const r = launch(height)
    const goal = { x: 20, z: -130 }
    let flippedOnce = false
    const t = drive(r, { ...goal, speed: 12, stopWithin: 4 }, 40, () => distTo(r, goal) < 4, () => { flippedOnce ||= r.status.flipped })
    report('ridge and slope', { reached_s: t, path_m: r.path, ideal_m: Math.hypot(20, 130), corrections: r.v.clearanceCorrections })
    expect(distTo(r, goal)).toBeLessThan(4)
    expect(flippedOnce).toBe(false)
    expect(r.path / Math.hypot(20, 130)).toBeLessThan(1.2)
  })

  it('backs off a wall it is pushing against, reports stuckFor, and gets round', () => {
    // Note: the assisted hovercraft climbs any slope that matches heightAt (its clearance
    // correction lifts it), so a solid obstacle stands in for an unclimbable slope.
    const r = launch()
    r.w.world.createCollider(RAPIER.ColliderDesc.cuboid(6, 10, 1).setTranslation(0, 10, -40)); r.w.world.step()
    const goal = { x: 0, z: -100 }
    let blockedAt = NaN
    const t = drive(r, { ...goal, speed: 12, stopWithin: 4 }, 60, () => distTo(r, goal) < 4, () => {
      if (Number.isNaN(blockedAt) && r.status.stuckFor > 1) blockedAt = r.t
    })
    report('wall', { blockedReportedAt_s: blockedAt, maxStuckFor_s: r.maxStuck, reached_s: t, path_m: r.path })
    expect(r.maxStuck).toBeGreaterThan(1.5)
    expect(distTo(r, goal)).toBeLessThan(4)
    expect(r.status.stuckFor).toBe(0)
  })

  it('rides over water as its surface', () => {
    const r = launch(() => -8)
    r.w.terrain.liquidHeightAt = () => 0
    r.v.teleport(new THREE.Vector3(0, 2.5, 0))
    const goal = { x: -40, z: -60 }
    const t = drive(r, { ...goal, speed: 12, stopWithin: 4 }, 30, () => distTo(r, goal) < 4)
    report('water', { reached_s: t, height_m: where(r).y })
    expect(distTo(r, goal)).toBeLessThan(4)
    expect(r.pilot.profile.liquid).toBe('surface')
  })
})

describe('hovercraft pilot, original controller (hover.assist 0)', () => {
  it('stays sane: upright, finite, heading for the goal', () => {
    ;(hoverAssist as { value: number }).value = 0
    const r = launch()
    const goal = { x: 20, z: -80 }
    const start = distTo(r, goal)
    let flipped = 0
    drive(r, { ...goal, speed: 12, stopWithin: 4 }, 40, undefined, () => { if (r.status.flipped) flipped++ })
    const p = where(r)
    report('assist 0', { startDistance_m: start, endDistance_m: distTo(r, goal), closest_m: Math.min(start, distTo(r, goal)), flippedSteps: flipped, height_m: p.y })
    expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true)
    expect(flipped).toBe(0)
    expect(distTo(r, goal)).toBeLessThan(start * .5)
  })
})

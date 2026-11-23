/**
 * Whole rescues, headless: the real HostRescue coordinating several real bots (Rapier,
 * buggies, a hovercraft, the real grapple through BotGear) round one stuck buggy. The bots'
 * brains are stand-ins with only what HostRescue reads (trouble, the recovery hold, a
 * directive), so this measures the coordination: who goes, the escalation, the outcome.
 *
 *   farbog       a buggy bogged 22 m out in deep water, first help a buggy from the shore,
 *                a hovercraft farther off
 *   heavy        a buggy in a deep trench, made heavy enough that one cord cannot lift it
 *                out: it needs a second rescuer pulling with the first
 *   rescuerstuck the nearest rescuer has to cross a soft bog on its way; it gets stuck, says
 *                so, and the others come for both
 *   notch, shore the ordinary cases, for comparison with the single-rescuer trials
 */
import * as THREE from 'three/webgpu'
import { Quaternion, Vector3 } from 'three/webgpu'
import type { Game } from '../../../src/core/Game'
import { emptyInput, type InputState } from '../../../src/core/Input'
import { createWorld, FIXED_DT } from '../../../src/core/physics'
import type { Vehicle } from '../../../src/vehicles/Vehicle'
import { MiraBuggy } from '../../../src/vehicles/MiraBuggy'
import { Hovercraft } from '../../../src/vehicles/Hovercraft'
import { BotGear } from '../../../src/weapons/BotGear'
import { createNavigator } from '../../../src/bots/nav'
import type { BotBrain, BotTerrain } from '../../../src/bots/BotBrain'
import type { BotGearAction } from '../../../src/bots/gear'
import { HostRescue, type RescueEvent } from '../../../src/bots/rescue/HostRescue'
import { terrainOf } from './scenarios'

export type Hard = 'farbog' | 'heavy' | 'rescuerstuck' | 'notch' | 'shore'
type Height = (x: number, z: number) => number

export interface EscalationResult {
  scenario: Hard
  seed: number
  freed: boolean
  /** Seconds from noticing to freed (or to the end). */
  seconds: number
  /** Pulls that did not free it, across all rescuers. */
  attempts: number
  /** Distinct bots that worked the rescue. */
  rescuers: number
  events: string[]
}

/** A stand-in brain: only what HostRescue reads and writes. */
interface FakeBrain {
  trouble: { stuck: number; flipped: number; bog: number }
  holdRecovery: boolean
  directive: { kind: string; step?: (dt: number, input: InputState) => boolean } | null
  mind: { reset(): void }
  raceGoal: null
  rescues: number
  clearTrouble(): void
  recover(): void
}

const NAMES = ['Temolin Dust Clerk', 'Detodak Rust Auditor', 'Fanirek Cone Marshal', 'Lomavin Hull Intern', 'Begonek Spare Pilot']

export function escalationTrial(scenario: Hard, seed: number, limit = 600, log?: (line: string) => void): EscalationResult {
  const world = createWorld(9.81)
  let height: Height, liquid: Height | undefined
  let stuckAt: Vector3, heading = 0
  // Rescuers: kind and start position.
  let helpers: { kind: 'buggy' | 'hovercraft'; x: number; z: number }[]
  let extraMass = 0
  const jitter = ((seed * 9301 + 49297) % 233280) / 233280 - 0.5
  if (scenario === 'farbog') {
    // A lake 2.2 m deep; the shore rises at x > 14. The buggy is 22 m out.
    height = (x) => (x < 8 ? -2.2 : x > 16 ? 0.6 : -2.2 + (x - 8) * 2.8 / 8)
    liquid = () => 0
    stuckAt = new Vector3(-8, 0.2, jitter * 6); heading = Math.PI / 2
    helpers = [{ kind: 'buggy', x: 30, z: 10 + jitter * 8 }, { kind: 'hovercraft', x: 45, z: -40 }, { kind: 'buggy', x: 50, z: 40 }]
  } else if (scenario === 'heavy' || scenario === 'notch') {
    // A trench across z; for 'heavy' deeper, and the stuck buggy carries extra mass.
    const depth = scenario === 'heavy' ? 3.8 : 3.2
    height = (x, z) => -depth * Math.max(0, 1 - Math.abs(z) / 1.6) ** 0.6 * Math.min(1, Math.max(0, (14 - Math.abs(x)) / 3))
    stuckAt = new Vector3(jitter * 4, 0.5, -0.4); heading = 0
    if (scenario === 'heavy') extraMass = 2600
    helpers = [{ kind: 'buggy', x: 6, z: 30 }, { kind: 'buggy', x: -20, z: 34 }, { kind: 'buggy', x: 25, z: -35 }]
  } else if (scenario === 'rescuerstuck') {
    // The stuck buggy in a pond to the west; a soft, deep bog lies between it and the nearest
    // rescuer, who will drive straight into it (the planner does not route short trips).
    height = (x, z) => {
      if (x < -2) return -1.6
      if (x < 6) return -1.6 + (x + 2) * 0.275
      // The bog: a basin 2 m deep at x 18 to 26.
      if (x > 16 && x < 28 && Math.abs(z) < 9) return -2
      return 0.6
    }
    liquid = (x, z) => (x < 6 || (x > 16 && x < 28 && Math.abs(z) < 9) ? 0 : -Infinity)
    stuckAt = new Vector3(-6, 0.2, jitter * 4); heading = Math.PI / 2
    helpers = [{ kind: 'buggy', x: 36, z: 0 }, { kind: 'buggy', x: 20, z: 45 }, { kind: 'hovercraft', x: 10, z: -50 }]
  } else {
    height = (x) => (x < -2 ? -1.4 : x > 6 ? 0.6 : -1.4 + (x + 2) * 0.25)
    liquid = () => 0
    stuckAt = new Vector3(-6, 0.2, jitter * 4); heading = Math.PI / 2
    helpers = [{ kind: 'buggy', x: 30, z: 20 }, { kind: 'buggy', x: 35, z: -30 }]
  }
  const terrain = terrainOf(world, height, liquid, 200)
  const game = { world, scene: new THREE.Scene(), tick: 0, time: 0, camera: new THREE.PerspectiveCamera(), canvas: {}, input: { state: emptyInput() } } as unknown as Game
  const place = (x: number, z: number) => new Vector3(x, terrain.heightAt(x, z) + 0.9, z)
  const stuck = new MiraBuggy(game, terrain, place(stuckAt.x, stuckAt.z), heading)
  const vehicles: Vehicle[] = [stuck]
  for (const h of helpers) {
    const facing = Math.atan2(stuckAt.x - h.x, stuckAt.z - h.z)
    vehicles.push(h.kind === 'hovercraft' ? new Hovercraft(game, terrain, place(h.x, h.z), facing) : new MiraBuggy(game, terrain, place(h.x, h.z), facing))
  }
  for (const v of vehicles) v.isLocal = false
  if (extraMass) stuck.body.setAdditionalMass(extraMass, true)
  const BASE = 0xff00
  const idOf = (v: Vehicle) => BASE + vehicles.indexOf(v)
  const vehicleOf = (id: number) => vehicles[id - BASE]
  const gears = new Map<number, BotGear>()
  const gearOf = (id: number) => {
    let g = gears.get(id)
    if (!g) {
      g = new BotGear(game, id, vehicleOf(id), {
        vehicleOf, vehicleIds: () => vehicles.map(idOf),
        idOfBody: (h) => { const v = vehicles.find((x) => x.body.handle === h); return v ? idOf(v) : null },
        owns: () => true, lagOf: () => 0, wrapSize: () => 0, now: () => game.time,
        heldElsewhere: () => false, responding: () => true, sendCord: () => {}, sendYoink: () => {}, fireRed: () => {}, launchPester: () => true,
      })
      gears.set(id, g)
    }
    return g
  }
  const brains: FakeBrain[] = vehicles.map(() => {
    const b: FakeBrain = { trouble: { stuck: 0, flipped: 0, bog: 0 }, holdRecovery: false, directive: null, mind: { reset() {} }, raceGoal: null, rescues: 0, clearTrouble() { b.trouble.stuck = b.trouble.flipped = b.trouble.bog = 0 }, recover() { b.rescues++; b.clearTrouble() } }
    return b
  })
  const events: string[] = []
  let notedAt = -1, freedAt = -1, attempts = 0
  const worked = new Set<number>()
  const rescue = new HostRescue(terrain as BotTerrain, {
    isHost: true, connected: true, mode: 2, // Explore (0 is Tag)
    vehicleOf,
    botGearHooks: { available: () => [], threats: () => [], act: (v: Vehicle, a: BotGearAction) => gearOf(idOf(v)).act(a) } as never,
    botCord: (id) => { const c = gears.get(id)?.bungee.mine; return c ? { flying: !!c.hook, to: c.hook ? null : c.to } : null },
    displayName: (id) => NAMES[(id - BASE) % NAMES.length],
    people: () => [],
  }, { vehicles, brainList: brains as unknown as BotBrain[] }, createNavigator(terrain), (e: RescueEvent) => {
    const t = game.time.toFixed(1)
    events.push(`${t} ${JSON.stringify(e)}`)
    log?.(`${t} ${JSON.stringify(e)}`)
    if (e.kind === 'stuck' && e.stuck === BASE && notedAt < 0) notedAt = game.time
    if (e.kind === 'freed' && e.stuck === BASE) freedAt = game.time
    if (e.kind === 'retry' || e.kind === 'swap' || e.kind === 'handoff') attempts++
  }, () => null)

  // Trouble as BotBrain keeps it: seconds in liquid (wheels), upside down, or going nowhere
  // while trying to drive. Idle bots are not trying.
  const last = vehicles.map((v) => { const p = v.body.translation(); return new Vector3(p.x, p.y, p.z) })
  const up = new Vector3(), q = new Quaternion()
  let sinceCheck = 0
  const updateTrouble = (dt: number) => {
    sinceCheck += dt
    const check = sinceCheck >= 1
    vehicles.forEach((v, i) => {
      const b = brains[i], p = v.body.translation()
      const wheeled = v.kind !== 'hovercraft'
      const l = liquid?.(p.x, p.z)
      const wet = wheeled && l != null && Number.isFinite(l) && terrain.heightAt(p.x, p.z) <= l + 0.5
      b.trouble.bog = wet ? b.trouble.bog + dt : 0
      up.set(0, 1, 0).applyQuaternion(q.copy(v.body.rotation()))
      b.trouble.flipped = up.y < 0.3 ? b.trouble.flipped + dt : 0
      const trying = i === 0 || (b.directive?.kind === 'control' && !b.holdRecovery)
      if (check) {
        const moved = Math.hypot(p.x - last[i].x, p.z - last[i].z)
        b.trouble.stuck = trying && moved < 0.5 ? b.trouble.stuck + sinceCheck : 0
        last[i].set(p.x, p.y, p.z)
      }
    })
    if (check) sinceCheck = 0
  }
  const trace = () => {
    const p = stuck.body.translation()
    const parts: string[] = []
    for (const r of rescue.active()) r.rescuers.forEach((id, k) => {
      const q = vehicleOf(id).body.translation(), c = gears.get(id)?.bungee.mine
      const cord = !c ? '-' : c.hook ? 'hook' : c.to !== null ? 'on ' + c.pull.toFixed(0) : 'ground'
      parts.push(`${id - BASE}:${r.phases[k]} at ${q.x.toFixed(0)},${q.y.toFixed(1)},${q.z.toFixed(0)} cord ${cord}`)
    })
    return `  ${game.time.toFixed(0)}s stuck ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} ${parts.join(' | ')}`
  }
  const step = () => {
    game.time += FIXED_DT
    vehicles.forEach((v, i) => {
      const b = brains[i]
      if (b.directive?.kind === 'control' && b.directive.step) { if (!b.directive.step(FIXED_DT, v.input)) b.directive = null }
      // The stuck one tries to drive out for its first seconds, as in the single trials, then
      // waits (still trying, as far as its trouble goes).
      else if (i === 0 && !b.holdRecovery && game.time < 5) { Object.assign(v.input, emptyInput()); v.input.y = game.time < 3 ? 1 : -1 }
      else Object.assign(v.input, emptyInput(), { brakes: true })
    })
    for (const g of gears.values()) g.fixedUpdate(FIXED_DT)
    for (const v of vehicles) v.fixedUpdate(FIXED_DT)
    world.step()
    for (const v of vehicles) v.postPhysics(FIXED_DT)
    updateTrouble(FIXED_DT)
    rescue.update(FIXED_DT)
    for (const r of rescue.active()) for (const id of r.rescuers) worked.add(id)
    if (log && Math.round(game.time / FIXED_DT) % 100 === 0) log(trace())
  }
  for (let i = 0; i < 1 / FIXED_DT; i++) step()
  let t = 0
  while (t < limit && freedAt < 0) {
    step(); t += FIXED_DT
    // A rescue that is not going on any more, with the bot noticed and not freed: given up.
    if (notedAt >= 0 && !rescue.active().some((r) => r.stuck === BASE) && events.some((e) => e.includes('"giveup"') && e.includes(`"stuck":${BASE}`))) break
  }
  for (const g of gears.values()) g.dispose()
  world.free()
  return { scenario, seed, freed: freedAt >= 0, seconds: Math.round(((freedAt >= 0 ? freedAt : game.time) - Math.max(0, notedAt)) * 10) / 10, attempts, rescuers: worked.size, events }
}

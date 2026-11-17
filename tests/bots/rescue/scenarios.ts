/**
 * Headless rescue scenarios: real Rapier, real buggies, the real grapple (BotGear's Bungee),
 * and the rescue skill (src/bots/rescue/TowRescue.ts). Used by the invariant test and by
 * tools/rescue-trials.ts for success rates over many seeded trials.
 *
 *   notch    a buggy nose-down in a narrow trench it cannot climb out of
 *   flipped  a buggy upside down on a slope
 *   shore    a buggy bogged in a pond, wheels under the surface
 */
import * as THREE from 'three/webgpu'
import { Quaternion, Vector3 } from 'three/webgpu'
import { params } from '../../../shared/params'
import type { Game } from '../../../src/core/Game'
import { emptyInput } from '../../../src/core/Input'
import { createWorld, FIXED_DT, GROUP_ALL, GROUP_TERRAIN, groups, RAPIER } from '../../../src/core/physics'
import type { Vehicle } from '../../../src/vehicles/Vehicle'
import { Syn3hBuggy } from '../../../src/vehicles/Syn3hBuggy'
import { BotGear } from '../../../src/weapons/BotGear'
import { createPilot } from '../../../src/bots/pilot'
import { createNavigator } from '../../../src/bots/nav'
import type { BotTerrain } from '../../../src/bots/BotBrain'
import { TowRescue, type StuckKind, type TowGear, type TowPhase } from '../../../src/bots/rescue/TowRescue'
import { seededRandom } from '../../../src/bots/random'

export type Scenario = 'notch' | 'flipped' | 'shore'

/** Aim at the roof, as the rescue does in the game (src/bots/rescue/RescueCoordinator.ts). */
const AIM_UP = 0.9

type Height = (x: number, z: number) => number

function terrainOf(world: RAPIER.World, height: Height, liquid?: Height, size = 160, cell = 1): BotTerrain {
  const n = Math.round(size / cell), half = size / 2, row = n + 1
  const grid = new Float32Array(row * row)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid[j * row + i] = height(-half + i * cell, -half + j * cell)
  const vertices = new Float32Array(row * row * 3), indices = new Uint32Array(n * n * 6)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j * row + i) * 3
    vertices[k] = -half + i * cell; vertices[k + 1] = grid[j * row + i]; vertices[k + 2] = -half + j * cell
  }
  let t = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1
    indices.set([a, c, b, b, c, d], t); t += 6
  }
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
  const heightAt = (x: number, z: number) => {
    const fx = THREE.MathUtils.clamp((x + half) / cell, 0, n - 1e-6), fz = THREE.MathUtils.clamp((z + half) / cell, 0, n - 1e-6)
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j
    const h00 = grid[j * row + i], h10 = grid[j * row + i + 1], h01 = grid[(j + 1) * row + i], h11 = grid[(j + 1) * row + i + 1]
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v)
  }
  const terrain = {
    size, heightAt,
    normalAt: (x: number, z: number, out: Vector3) => out.set(heightAt(x - .5, z) - heightAt(x + .5, z), 1, heightAt(x, z - .5) - heightAt(x, z + .5)).normalize(),
    spawnPoint: () => ({ position: new Vector3(0, 2, 0), heading: 0 }),
    dispose() {},
    roads: [], roadNetwork: undefined,
  } as unknown as BotTerrain
  if (liquid) terrain.liquidHeightAt = liquid
  world.step()
  return terrain
}

export interface TrialResult {
  scenario: Scenario
  seed: number
  freed: boolean
  seconds: number
  attempts: number
  /** The stuck buggy could not get itself out in the first seconds (the scenario is real). */
  stuckAlone: boolean
  phases: string[]
}

/**
 * Run one trial. The stuck buggy first tries to drive out on its own for `selfTry` seconds
 * (full throttle, the way a stuck bot's pilot would); then the rescuer, parked `away` metres
 * off at a seeded angle, does the rescue. Up to `limit` seconds.
 */
export function trial(scenario: Scenario, seed: number, limit = 60, selfTry = 4, log?: (line: string) => void): TrialResult {
  const r = seededRandom(seed * 7919 + scenario.length)
  const world = createWorld(9.81)
  let height: Height, liquid: Height | undefined
  let stuckAt: Vector3, stuckHeading: number, kind: StuckKind, pull: { x: number; z: number }, flip = false
  if (scenario === 'notch') {
    // A trench 2.4 m deep and 3 m wide across the z axis, steep walls.
    height = (x, z) => -2.4 * Math.max(0, 1 - Math.abs(z) / 1.5) ** 0.6 * Math.min(1, Math.max(0, (14 - Math.abs(x)) / 3))
    stuckAt = new Vector3(0, 0.5, -0.4); stuckHeading = 0; kind = 'wedged'
    pull = { x: 0, z: 1 } // back out the way it came in (it drove in from +z, heading -z)
  } else if (scenario === 'flipped') {
    // A 14 degree slope rising towards +x.
    height = (x) => 0.25 * x
    stuckAt = new Vector3(0, 1.6, 0); stuckHeading = r() * Math.PI * 2; kind = 'flipped'; flip = true
    pull = { x: 0.6, z: 0.8 }
  } else {
    // A pond 1.4 m deep with a sloping shore towards +x; the liquid surface is at 0.
    height = (x) => (x < -2 ? -1.4 : x > 6 ? 0.6 : -1.4 + (x + 2) * 0.25)
    liquid = () => 0
    stuckAt = new Vector3(-6, 0.2, 0); stuckHeading = Math.PI / 2 + (r() - 0.5); kind = 'bogged'
    pull = { x: 1, z: 0 }
  }
  const terrain = terrainOf(world, height, liquid)
  const game = { world, scene: new THREE.Scene(), tick: 0, time: 0, camera: new THREE.PerspectiveCamera(), canvas: {}, input: { state: emptyInput() } } as unknown as Game
  const place = (p: Vector3, heading: number) => new Vector3(p.x, terrain.heightAt(p.x, p.z) + (flip ? 1.4 : 0.9), p.z)
  const stuck = new Syn3hBuggy(game, terrain, place(stuckAt, stuckHeading), stuckHeading); stuck.isLocal = false
  if (flip) {
    // Every vehicle sets itself upright after 3 s on its roof near the ground (Vehicle.uprightRescue),
    // so in play a flipped bot rarely waits for help. Switched off here to test the grapple's pull.
    ;(stuck as unknown as { uprightRescue(): void }).uprightRescue = () => {}
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), stuckHeading).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI))
    stuck.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
  }
  // The rescuer starts 30 to 45 m away at a seeded angle, on dry ground.
  const angle = r() * Math.PI * 2, away = 30 + r() * 15
  const start = new Vector3(stuckAt.x + Math.cos(angle) * away, 0, stuckAt.z + Math.sin(angle) * away)
  if (scenario === 'shore' && start.x < 8) start.x = 8 + r() * 20
  if (scenario === 'notch' && Math.abs(start.z) < 6) start.z = 10 * Math.sign(start.z || 1)
  const rescuer = new Syn3hBuggy(game, terrain, place(start, 0), Math.atan2(stuckAt.x - start.x, stuckAt.z - start.z)); rescuer.isLocal = false

  const ids = new Map<number, Vehicle>([[0xff00, rescuer], [0xff01, stuck]])
  const gear = new BotGear(game, 0xff00, rescuer, {
    vehicleOf: (id) => ids.get(id), vehicleIds: () => [...ids.keys()],
    idOfBody: (h) => (h === rescuer.body.handle ? 0xff00 : h === stuck.body.handle ? 0xff01 : null),
    owns: () => true, lagOf: () => 0, wrapSize: () => 0, now: () => game.time,
    heldElsewhere: () => false, responding: () => true, sendCord: () => {}, sendYoink: () => {}, fireRed: () => {}, launchPester: () => true,
  })
  const tow: TowGear = {
    fire: (target) => gear.act({ gear: 'bungee', target, phase: 'press', aimUp: AIM_UP }),
    reel: (target) => gear.act({ gear: 'bungee', target, phase: 'hold', aimUp: AIM_UP }),
    hold: (target) => gear.act({ gear: 'bungee', target, phase: 'hold', aimUp: AIM_UP, reel: false }),
    release: (target) => gear.act({ gear: 'bungee', target, phase: 'release' }),
    attachedTo: (target) => { const c = gear.bungee.mine; return !!c && !c.hook && c.to !== null && ids.get(c.to) === target },
    flying: () => !!gear.bungee.mine?.hook,
  }
  const phases: string[] = []
  const rescue = new TowRescue(rescuer, stuck, terrain, tow, createPilot(rescuer, terrain)!, { kind, pull, navigator: createNavigator(terrain), onPhase: (p: TowPhase, a) => phases.push(`${p}${a > 1 ? a : ''}`) })
  const up = new Vector3(), q = new Quaternion()
  const step = (rescuing: boolean) => {
    game.time += FIXED_DT
    if (rescuing) { rescue.step(FIXED_DT, rescuer.input); rescue.assist(stuck.input) }
    else Object.assign(rescuer.input, emptyInput(), { brakes: true })
    gear.fixedUpdate(FIXED_DT)
    rescuer.fixedUpdate(FIXED_DT); stuck.fixedUpdate(FIXED_DT)
    world.step()
    rescuer.postPhysics(FIXED_DT); stuck.postPhysics(FIXED_DT)
  }
  // Settle, then the stuck buggy tries on its own: full throttle forward, then reverse.
  Object.assign(stuck.input, emptyInput())
  for (let i = 0; i < 1 / FIXED_DT; i++) step(false)
  const settled = stuck.body.translation()
  const from = new Vector3(settled.x, settled.y, settled.z)
  for (let i = 0; i < selfTry / FIXED_DT; i++) {
    stuck.input.y = i < selfTry / FIXED_DT / 2 ? 1 : -1
    step(false)
  }
  Object.assign(stuck.input, emptyInput())
  const after = stuck.body.translation()
  up.set(0, 1, 0).applyQuaternion(q.copy(stuck.body.rotation()))
  const wet = liquid ? terrain.heightAt(after.x, after.z) < liquid(after.x, after.z) + 0.3 : false
  const stuckAlone = scenario === 'flipped' ? up.y < 0.5 : scenario === 'shore' ? wet : Math.hypot(after.x - from.x, after.z - from.z) < 3.5
  // The rescue.
  let t = 0
  while (!rescue.finished && t < limit) {
    step(true); t += FIXED_DT
    if (log && Math.round(t / FIXED_DT) % 50 === 0) {
      const s = stuck.body.translation(), p = rescuer.body.translation(), c = gear.bungee.mine
      up.set(0, 1, 0).applyQuaternion(q.copy(stuck.body.rotation()))
      log(`${t.toFixed(0).padStart(3)}s ${rescue.phase}${rescue.attempt} stuck ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)} up ${up.y.toFixed(2)} rescuer ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} cord ${c ? (c.hook ? 'hook' : c.to !== null ? `on rest ${c.rest.toFixed(1)} pull ${c.pull.toFixed(1)}` : 'ground') : '-'} in ${JSON.stringify(rescuer.input).slice(0, 60)}`)
    }
  }
  const result = { scenario, seed, freed: rescue.phase === 'done', seconds: Math.round(t * 10) / 10, attempts: rescue.attempt, stuckAlone, phases }
  gear.dispose(); world.free()
  return result
}

/** The params the scenarios need: the grapple allowed for bots, as the rescue setting does. */
export function allowGrapple(): () => void {
  const was = params.get('bungee.allowed')?.value
  params.set('bungee.allowed', true)
  return () => { if (was !== undefined) params.set('bungee.allowed', was) }
}

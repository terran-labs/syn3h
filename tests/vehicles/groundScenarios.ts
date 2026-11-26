/**
 * The buggy's steering on real ground: the generated island (tests/bots/island.ts), not the flat
 * test bed. On 26 November 2026 the game and the flat-ground sim agreed exactly on a flat slab,
 * and disagreed on the island's rolling ground, where both handling presets slide further and
 * settle later (tools/buggy-browser-diag.mjs). These scenarios measure that, for the handling
 * report; nothing here is pinned by a test.
 *
 * Each seed's island is built once and kept. A run puts a fresh buggy at the start of the
 * flattest straight 600 m that stays above the sea, at speed along it, then steers.
 */
import * as THREE from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { FIXED_DT, GROUP_ALL, GROUP_TERRAIN, RAPIER, createWorld, groups, initPhysics } from '../../src/core/physics'
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
import type { BotTerrain } from '../../src/bots/BotBrain'
import { island } from '../bots/island'
import { slip } from './miraScenarios'

const STRIP = 600
interface Ground { game: Game; terrain: BotTerrain; start: THREE.Vector3; heading: number; roughness: number }
const grounds = new Map<number, Ground>()

/**
 * The island for `seed` and its flattest straight strip (searched on a fixed grid, so it repeats).
 * Seed 0 is the control: a flat slab through the same code, which reads as the flat test bed does.
 */
async function ground(seed: number): Promise<Ground> {
  const known = grounds.get(seed)
  if (known) return known
  await initPhysics()
  const world = createWorld(9.81)
  if (seed === 0) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 1, 20000).setTranslation(0, -1, 0).setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
    const flat = { size: 40000, heightAt: () => 0, normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(0, 1, 0), spawnPoint: () => ({ position: new THREE.Vector3(0, 1, 0), heading: 0 }), dispose() {} } as unknown as BotTerrain
    const g = { game: { world, scene: new THREE.Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game, terrain: flat, start: new THREE.Vector3(0, 1.5, 0), heading: 0, roughness: 0 }
    grounds.set(0, g)
    return g
  }
  const terrain = island(world, seed)
  const game = { world, scene: new THREE.Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const half = terrain.size / 2 - STRIP
  let best = { x: 0, z: 0, heading: 0, roughness: Infinity }
  for (let x = -half; x <= half; x += 80) for (let z = -half; z <= half; z += 80) for (let k = 0; k < 8; k++) {
    const heading = (k * Math.PI) / 4, dx = -Math.sin(heading), dz = -Math.cos(heading)
    const hs: number[] = []
    let dry = true
    for (let s = 0; s <= STRIP && dry; s += 10) {
      const px = x + dx * s, pz = z + dz * s, h = terrain.heightAt(px, pz)
      if (h < (terrain.liquidHeightAt?.(px, pz) ?? -Infinity) + 2) dry = false
      hs.push(h)
    }
    if (!dry) continue
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length
    const roughness = Math.max(...hs.map((h) => Math.abs(h - mean)))
    if (roughness < best.roughness) best = { x, z, heading, roughness }
  }
  const g = { game, terrain, start: new THREE.Vector3(best.x, terrain.heightAt(best.x, best.z) + 1.5, best.z), heading: best.heading, roughness: best.roughness }
  grounds.set(seed, g)
  return g
}

/**
 * On the island for `seed`, at `v` m/s along its flattest strip: `kick` false steers `lock` for
 * one second then lets go; `kick` true yaws the nose 40 degrees off the travel and holds full
 * counter-steer. The largest slide angle, the seconds until the slide is over for good after
 * letting go (or after the kick; Infinity if not within the run), and the least upright.
 */
export async function onGround(seed: number, v: number, kick: boolean, lock = 1) {
  const g = await ground(seed)
  const b = new MiraBuggy(g.game, g.terrain, g.start.clone(), g.heading)
  b.isLocal = false
  const world = g.game.world
  const step = (each?: () => void) => { b.fixedUpdate(FIXED_DT); world.step(); b.postPhysics(FIXED_DT); each?.() }
  try {
    for (let i = 0; i < 1 / FIXED_DT; i++) step()
    // Up to speed along the strip, as miraScenarios.cruise does, for one second.
    const dir = new THREE.Vector3(-Math.sin(g.heading), 0, -Math.cos(g.heading))
    b.input.y = 1
    b.motorSpeed = v
    for (let i = 0; i < 1 / FIXED_DT; i++) step(() => { const l = b.body.linvel(); b.body.setLinvel({ x: dir.x * v, y: l.y, z: dir.z * v }, true) })
    if (kick) {
      const r = b.body.rotation()
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (40 * Math.PI) / 180).multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w))
      b.body.setRotation(q, true)
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    let t = 0, worstSlip = 0, settled = Infinity, upright = 1
    const seconds = kick ? 5 : 6
    for (let i = 0; i < seconds / FIXED_DT; i++) step(() => {
      t += FIXED_DT
      const s = slip(b)
      if (kick) b.input.x = Math.abs(s) > 1 ? Math.sign(s) : 0
      else b.input.x = t <= 1 ? lock : 0
      const r = b.body.rotation()
      upright = Math.min(upright, 1 - 2 * (r.x * r.x + r.z * r.z))
      const l = b.body.linvel()
      if (Math.hypot(l.x, l.z) > 2) worstSlip = Math.max(worstSlip, Math.abs(s))
      const after = kick ? t : t - 1
      if (after <= 0) return
      const still = Math.abs(s) < 3 && Math.abs(b.body.angvel().y) < 0.3
      if (still && settled === Infinity) settled = after
      else if (Math.abs(s) > 6) settled = Infinity
    })
    return { worstSlip, settled, upright, roughness: g.roughness }
  } finally { b.dispose() }
}

/**
 * The four-bot summit chase, headless: the real generated island and its collider, a target
 * carried up the volcano road at a steady speed, and real bots with real buggy physics
 * chasing it. The browser version (tools/island-bot-qa.mjs) takes five minutes and a GPU;
 * this takes a few seconds, so the pursuit can be tuned against it.
 */
import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu'
import type { Game, System } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, RAPIER, GROUP_ALL, GROUP_VEHICLE, groups } from '../../src/core/physics'
import { PlaceholderVehicle } from '../../src/vehicles/Vehicle'
import { BotManager } from '../../src/bots/BotManager'
import { roadPaths } from '../../src/bots/navigation'
import { params } from '../../shared/params'
import { island } from './island'

const DT = 0.02

export function chase(seed: number, bots: number, seconds: number, speed = 11, kind = 0, log?: (line: string) => void, wrap = false, peerContacts = true) {
  const world = createWorld(9.81), terrain = island(world, seed, { kind }, 0, wrap)
  const systems: System[] = []
  const game = {
    world, scene: new Scene(), camera: new PerspectiveCamera(), tick: 0, input: { state: emptyInput(), external: {}, suspended: false },
    add<T extends System>(s: T) { systems.push(s); return s },
    remove(s: System) { const i = systems.indexOf(s); if (i >= 0) systems.splice(i, 1); s.dispose?.() },
  } as unknown as Game
  const roads = roadPaths(terrain), climb = (roads.find(r => 'kind' in r && r.kind === 'volcano') ?? roads[0]) as { points: { x: number; y: number; z: number }[] }
  const points = climb.points
  const player = new PlaceholderVehicle(game, terrain, new Vector3(points[0].x, points[0].y + 1, points[0].z)); player.isLocal = false
  player.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  params.set('bots.fleet', 0); params.set('bots.count', bots); params.set('bots.canFire', false); params.set('bots.freeSpirit', 0); params.set('daydream.seconds', 0)
  const manager = game.add(new BotManager(game, terrain, player)); manager.update()
  // A diagnostic control run can exclude vehicle contacts while keeping terrain physics.
  // It is never a gameplay setting and cannot establish a fix by itself.
  if (!peerContacts) for (const bot of manager.vehicles) for (let c = 0; c < bot.body.numColliders(); c++) {
    bot.body.collider(c).setCollisionGroups(groups(GROUP_VEHICLE, GROUP_ALL & ~GROUP_VEHICLE))
  }
  const lastContact: Record<string, number> = {}, contactAtFall: Record<string, number | null> = {}
  // How far along the road each point is, to carry the target at a steady speed.
  const along = [0]
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z))
  const roadDistance = (p: { x: number; z: number }) => { let d = Infinity; for (const q of points) d = Math.min(d, Math.hypot(q.x - p.x, q.z - p.z)); return d }
  let travelled = 0, index = 0
  const fell: Record<string, number> = {}, off: Record<string, number> = {}, highest: Record<string, number> = {}
  for (let i = 0; i < seconds / DT; i++) {
    travelled = Math.min(along[along.length - 1], travelled + speed * DT)
    while (index < points.length - 2 && along[index + 1] < travelled) index++
    const t = (travelled - along[index]) / Math.max(1e-6, along[index + 1] - along[index]), a = points[index], b = points[index + 1]
    const target = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + 1, z: a.z + (b.z - a.z) * t }
    player.body.setNextKinematicTranslation(target)
    player.body.setLinvel({ x: (b.x - a.x) / (along[index + 1] - along[index]) * speed, y: 0, z: (b.z - a.z) / (along[index + 1] - along[index]) * speed }, true)
    for (const s of systems) s.fixedUpdate?.(DT); world.step(); for (const s of systems) s.postPhysics?.(DT); game.tick++
    if (log && i % 5 === 0) for (let a = 0; a < manager.vehicles.length; a++) for (let b = a + 1; b < manager.vehicles.length; b++) {
      const first = manager.vehicles[a], second = manager.vehicles[b]
      let touching = false
      for (let c = 0; c < first.body.numColliders() && !touching; c++) for (let d = 0; d < second.body.numColliders() && !touching; d++) {
        world.contactPair(first.body.collider(c), second.body.collider(d), manifold => { if (manifold.numSolverContacts() > 0) touching = true })
      }
      if (touching) { lastContact[first.id] = i * DT; lastContact[second.id] = i * DT }
    }
    for (const bot of manager.vehicles) {
      const p = bot.body.translation(), d = roadDistance(p)
      // Leaving the spiral for the summit ring is normal. A fall loses substantial height
      // from a place the bot actually reached on the road; planar distance alone lied here.
      if (d < 8) highest[bot.id] = Math.max(highest[bot.id] ?? p.y, p.y)
      if ((highest[bot.id] ?? 0) > 60 && p.y < highest[bot.id] - 20 && !(bot.id in fell)) { fell[bot.id] = i * DT; contactAtFall[bot.id] = lastContact[bot.id] ?? null; log?.(`${bot.id} lost 20m of road height at ${(i * DT).toFixed(1)}s pos ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} last peer contact ${contactAtFall[bot.id]}`) }
      if (d > 8) off[bot.id] = (off[bot.id] ?? 0) + DT
      if (log && i % 250 === 0) { const v = bot.body.linvel(); log(`${(i * DT).toFixed(0)} ${bot.id} pos ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} v ${Math.hypot(v.x, v.z).toFixed(1)} road ${d.toFixed(1)} in ${bot.input.x.toFixed(2)},${bot.input.y.toFixed(2)}${bot.input.brakes ? 'B' : ''}`) }
    }
  }
  const end = player.body.translation()
  const result = manager.vehicles.map(bot => { const p = bot.body.translation(); return { id: bot.id, gap: Math.hypot(p.x - end.x, p.y - end.y, p.z - end.z), height: p.y, fellAt: fell[bot.id] ?? null, lastContactBeforeFall: contactAtFall[bot.id] ?? null, offRoad: off[bot.id] ?? 0 } })
  const summit = end.y
  manager.dispose(); world.free()
  return { summit, bots: result, arrived: result.filter(b => b.gap < 40).length }
}

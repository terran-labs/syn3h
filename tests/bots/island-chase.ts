/**
 * The four-bot summit chase, headless: the real generated island and its collider, a target
 * carried up the volcano road at a steady speed, and real bots with real buggy physics
 * chasing it. The browser version (tools/island-bot-qa.mjs) takes five minutes and a GPU;
 * this takes a few seconds, so the pursuit can be tuned against it.
 */
import { Scene, Vector3 } from 'three/webgpu'
import type { Game, System } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, RAPIER } from '../../src/core/physics'
import { PlaceholderVehicle } from '../../src/vehicles/Vehicle'
import { BotManager } from '../../src/bots/BotManager'
import { roadPaths } from '../../src/bots/navigation'
import { params } from '../../shared/params'
import { island } from './island'

const DT = 0.02

export function chase(seed: number, bots: number, seconds: number, speed = 11, kind = 0, log?: (line: string) => void, wrap = false) {
  const world = createWorld(9.81), terrain = island(world, seed, { kind }, 0, wrap)
  const systems: System[] = []
  const game = {
    world, scene: new Scene(), tick: 0, input: { state: emptyInput(), external: {}, suspended: false },
    add<T extends System>(s: T) { systems.push(s); return s },
    remove(s: System) { const i = systems.indexOf(s); if (i >= 0) systems.splice(i, 1); s.dispose?.() },
  } as unknown as Game
  const roads = roadPaths(terrain), climb = (roads.find(r => 'kind' in r && r.kind === 'volcano') ?? roads[0]) as { points: { x: number; y: number; z: number }[] }
  const points = climb.points
  const player = new PlaceholderVehicle(game, terrain, new Vector3(points[0].x, points[0].y + 1, points[0].z)); player.isLocal = false
  player.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  params.set('bots.count', bots); params.set('bots.canFire', false); params.set('bots.freeSpirit', 0); params.set('daydream.seconds', 0)
  const manager = game.add(new BotManager(game, terrain, player)); manager.update()
  // How far along the road each point is, to carry the target at a steady speed.
  const along = [0]
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z))
  const roadDistance = (p: { x: number; z: number }) => { let d = Infinity; for (const q of points) d = Math.min(d, Math.hypot(q.x - p.x, q.z - p.z)); return d }
  let travelled = 0, index = 0
  const fell: Record<string, number> = {}, off: Record<string, number> = {}
  for (let i = 0; i < seconds / DT; i++) {
    travelled = Math.min(along[along.length - 1], travelled + speed * DT)
    while (index < points.length - 2 && along[index + 1] < travelled) index++
    const t = (travelled - along[index]) / Math.max(1e-6, along[index + 1] - along[index]), a = points[index], b = points[index + 1]
    const target = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + 1, z: a.z + (b.z - a.z) * t }
    player.body.setNextKinematicTranslation(target)
    player.body.setLinvel({ x: (b.x - a.x) / (along[index + 1] - along[index]) * speed, y: 0, z: (b.z - a.z) / (along[index + 1] - along[index]) * speed }, true)
    for (const s of systems) s.fixedUpdate?.(DT); world.step(); for (const s of systems) s.postPhysics?.(DT); game.tick++
    for (const bot of manager.vehicles) {
      const p = bot.body.translation(), d = roadDistance(p)
      // Once a bot has climbed, count it as fallen the first time it is far from the road.
      if (p.y > 60 && d > 25 && !(bot.id in fell)) { fell[bot.id] = i * DT; log?.(`${bot.id} left the road at ${(i * DT).toFixed(1)}s pos ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`) }
      if (d > 8) off[bot.id] = (off[bot.id] ?? 0) + DT
      if (log && i % 250 === 0) { const v = bot.body.linvel(); log(`${(i * DT).toFixed(0)} ${bot.id} pos ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} v ${Math.hypot(v.x, v.z).toFixed(1)} road ${d.toFixed(1)} in ${bot.input.x.toFixed(2)},${bot.input.y.toFixed(2)}${bot.input.brakes ? 'B' : ''}`) }
    }
  }
  const end = player.body.translation()
  const result = manager.vehicles.map(bot => { const p = bot.body.translation(); return { id: bot.id, gap: Math.hypot(p.x - end.x, p.y - end.y, p.z - end.z), height: p.y, fellAt: fell[bot.id] ?? null, offRoad: off[bot.id] ?? 0 } })
  const summit = end.y
  manager.dispose(); world.free()
  return { summit, bots: result, arrived: result.filter(b => b.gap < 40).length }
}

import { worldSeed } from '../../shared/params'
import { generateName } from '../ui/data/names'
import { attachVehicleEffects } from '../vehicles/effects'
import { Vector3 } from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { qualityBudget } from '../core/quality'
import { createVehicle } from '../vehicles'
import type { Vehicle } from '../vehicles/Vehicle'
import { BotBrain, isSafeGround, type BotTerrain } from './BotBrain'
import { botCount, spawnRadius } from './params'
export class BotManager implements System {
  private readonly bots: Vehicle[] = []
  private readonly brains: BotBrain[] = []
  private readonly effects = new Map<Vehicle, () => void>()
  private nextBotId = 0
  private targets: readonly Vehicle[]
  private disposed = false
  private isRemote = false
  /** Networking owns inputs and rescue decisions on non-host clients. */
  get remote() { return this.isRemote }
  set remote(value: boolean) {
    this.isRemote = value
    if (value) this.clearBots()
  }
  get vehicles(): readonly Vehicle[] { return this.bots }
  constructor(private readonly game: Game, private readonly terrain: BotTerrain, private readonly player: Vehicle) { this.targets = [player] }
  setTargets(vehicles: readonly Vehicle[]) {
    this.targets = [...vehicles]
    for (const brain of this.brains) brain.setTargets(this.targets)
  }
  private removeLast() {
    const bot = this.bots.pop()!
    this.effects.get(bot)?.(); this.effects.delete(bot)
    this.game.remove(this.brains.pop()!); this.game.remove(bot)
  }
  private clearBots() { while (this.bots.length) this.removeLast() }
  private spawn(index: number) {
    const center = this.player.body.translation()
    for (let attempt = 0; attempt < 32; attempt++) {
      // Index and simulation tick replace Unity's random bot placement. No wall clock dependency.
      const angle = (index + attempt * 0.37) * 2.3999632297 + (this.game.tick % 997) * 0.001
      const radius = spawnRadius.value + attempt % 4 * 4
      const x = center.x + Math.cos(angle) * radius, z = center.z + Math.sin(angle) * radius
      if (!isSafeGround(this.terrain, x, z) || this.terrain.normalAt(x, z, new Vector3()).y < 0.65) continue
      if (this.bots.some(bot => { const p = bot.body.translation(); return Math.hypot(p.x - x, p.z - z) < 5 })) continue
      const heading = Math.atan2(x - center.x, z - center.z)
      const bot = createVehicle(this.game, this.terrain, 'buggy', new Vector3(x, this.terrain.heightAt(x, z) + 2, z), heading)
      bot.isLocal = false; bot.id = `bot-${this.nextBotId++}`; bot.name = generateName(`${worldSeed.value}:${bot.id}`, 'bot')
      bot.setColors(`hsl(${(index * 137.508 + 15) % 360}, 85%, 55%)`, '#ffffff')
      const brain = new BotBrain(this.game, this.terrain, bot, this.player, index)
      brain.remote = this.remote
      brain.setTargets(this.targets)
      // Register brain first so its input reaches the vehicle in the same physics step.
      this.game.add(brain); this.game.add(bot); this.brains.push(brain); this.bots.push(bot)
      this.effects.set(bot, attachVehicleEffects(this.game, this.terrain, bot, { local: false }))
      for (const controller of this.brains) controller.setPeers(this.bots)
      return true
    }
    return false
  }
  /** Reconcile outside the physics iterator so removing bots cannot skip another body's step. */
  update() {
    if (this.disposed || this.remote) return
    const count = Math.max(0, Math.min(qualityBudget().bots, Math.floor(botCount.value)))
    while (this.bots.length > count) this.removeLast()
    while (this.bots.length < count) if (!this.spawn(this.bots.length)) break
  }
  dispose() {
    this.disposed = true
    this.clearBots()
  }
}

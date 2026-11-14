import { Vector3 } from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { createVehicle } from '../vehicles'
import type { Vehicle } from '../vehicles/Vehicle'
import { BotBrain, isSafeGround, type BotTerrain } from './BotBrain'
import { botCount, spawnRadius } from './params'
export class BotManager implements System {
  private readonly bots: Vehicle[] = []
  private readonly brains: BotBrain[] = []
  private targets: readonly Vehicle[]
  private disposed = false
  get vehicles(): readonly Vehicle[] { return this.bots }
  constructor(private readonly game: Game, private readonly terrain: BotTerrain, private readonly player: Vehicle) { this.targets = [player] }
  setTargets(vehicles: readonly Vehicle[]) {
    this.targets = [...vehicles]
    for (const brain of this.brains) brain.setTargets(this.targets)
  }
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
      bot.isLocal = false; bot.id = `bot-${index}`; bot.name = `Bot ${index + 1}`
      const brain = new BotBrain(this.game, this.terrain, bot, this.player, index)
      brain.setTargets(this.targets)
      // Register brain first so its input reaches the vehicle in the same physics step.
      this.game.add(brain); this.game.add(bot); this.brains.push(brain); this.bots.push(bot)
      return true
    }
    return false
  }
  /** Reconcile outside the physics iterator so removing bots cannot skip another body's step. */
  update() {
    if (this.disposed) return
    const count = Math.max(0, Math.min(16, Math.floor(botCount.value)))
    while (this.bots.length > count) { this.game.remove(this.brains.pop()!); this.game.remove(this.bots.pop()!) }
    while (this.bots.length < count) if (!this.spawn(this.bots.length)) break
  }
  dispose() {
    this.disposed = true
    while (this.bots.length) { this.game.remove(this.brains.pop()!); this.game.remove(this.bots.pop()!) }
  }
}

import { worldSeed } from '../../shared/params'
import { generateName } from '../ui/data/names'
import { attachVehicleEffects } from '../vehicles/effects'
import { Frustum, Matrix4, Sphere, Vector3 } from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { qualityBudget } from '../core/quality'
import { createVehicle } from '../vehicles'
import type { Vehicle } from '../vehicles/Vehicle'
import { BotBrain, isSafeGround, type BotMatch, type BotTerrain } from './BotBrain'
import { botCount, fleet, spawnRadius } from './params'
import { Daydream } from './Daydream'
import { curveFactor, curveOffset, overHorizon } from '../world/curve'
import { Mind } from './mind/Mind'
import { createPilot } from './pilot'
import { createNavigator, pointsOfInterest, type PointOfInterest } from './nav'
import type { Navigator } from './pilot/types'
import type { BotGearHooks } from './gear'
import { BotRaces, type BotRaceHooks } from './races'
import type { RaceState } from '../../shared/protocol'
/** Slot by slot: half buggies, a quarter hovercraft, a quarter jets. */
const MIXED_FLEET = ['buggy', 'hovercraft', 'buggy', 'jet'] as const
export class BotManager implements System {
  private readonly bots: Vehicle[] = []
  private readonly brains: BotBrain[] = []
  private readonly effects = new Map<Vehicle, () => void>()
  private gearHooks: BotGearHooks | null = null
  setGear(hooks: BotGearHooks | null) {
    this.gearHooks = hooks
    for (const brain of this.brains) brain.setGear(this.remote ? null : hooks)
  }
  private readonly retentionFrustum = new Frustum()
  private readonly retentionMatrix = new Matrix4()
  private readonly retentionSphere = new Sphere(new Vector3(), 5)
  private readonly retentionBend = new Vector3()
  private readonly offscreenSince = new Map<Vehicle, number>()
  private nextBotId = 0
  private targets: readonly Vehicle[]
  private disposed = false
  private isRemote = false
  /** Networking owns inputs and rescue decisions on non-host clients. */
  get remote() { return this.isRemote }
  set remote(value: boolean) {
    this.isRemote = value
    if (value) { this.races.setHooks(null); this.clearBots() }
  }
  get vehicles(): readonly Vehicle[] { return this.bots }
  /** The player's own vehicle driving itself after a spell of no input. See Daydream.ts. */
  readonly daydream: Daydream
  readonly races: BotRaces
  setRaces(hooks: BotRaceHooks | null) { this.races.setHooks(this.remote ? null : hooks) }
  applyRace(state: RaceState | null) { this.races.apply(state) }
  readonly navigator: Navigator & { dispose?(): void }
  /** Places worth driving to, found once per world and shared by every mind. */
  private sights: PointOfInterest[] | null = null
  private readonly places = () => this.sights ??= pointsOfInterest(this.terrain)
  constructor(private readonly game: Game, private readonly terrain: BotTerrain, private player: Vehicle) {
    this.targets = [player]
    // Owned here so the composition root needs no extra wiring: this manager already holds
    // the player, the terrain and every vehicle a daydreaming driver might tail.
    // One route planner per terrain, shared by every mind: its caches are megabytes.
    this.navigator = createNavigator(terrain)
    this.races = new BotRaces(terrain, this.navigator, this.places)
    terrain.onRegenerate?.(() => { this.sights = null; this.races.cancel('world-changed') })
    this.daydream = new Daydream(game, terrain, player, { navigator: this.navigator, places: this.places, others: () => [...this.targets, ...this.bots] })
  }
  fixedUpdate(dt: number) {
    this.daydream.fixedUpdate(dt)
    if (!this.remote) {
      this.races.update()
      for (const brain of this.brains) brain.raceGoal = this.races.goal(brain.vehicle)
    }
  }
  /**
   * The player changed vehicle in place (main.ts swapVehicle). Everything that held the old
   * one follows: the spawn centre, every bot's chase target, and the daydream's pilot.
   */
  setPlayer(next: Vehicle) {
    const previous = this.player
    if (next === previous) return
    this.player = next
    for (const brain of this.brains) brain.setLocalPlayer(next)
    this.setTargets(this.targets.map(t => t === previous ? next : t))
    this.daydream.setPlayer(next)
  }
  setTargets(vehicles: readonly Vehicle[]) {
    this.targets = [...vehicles]
    for (const brain of this.brains) brain.setTargets(this.targets)
  }
  private readonly look = new Vector3()
  private match: BotMatch | null = null
  /**
   * Tell the bots what game is on: who is "it" in tag, or where the hill is. Call whenever
   * it changes, with null for free play. Networking owns the rules; this only shapes how
   * the host's bots behave. Remote managers ignore it, as they hold no bots.
   */
  setMatch(match: BotMatch | null) {
    this.match = match
    for (const brain of this.brains) brain.match = match
  }
  private removeAt(index: number) {
    const [bot] = this.bots.splice(index, 1)
    const [brain] = this.brains.splice(index, 1)
    this.offscreenSince.delete(bot)
    this.effects.get(bot)?.(); this.effects.delete(bot)
    this.game.remove(brain); this.game.remove(bot)
  }
  private removeLast() { this.removeAt(this.bots.length - 1) }
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
      const bot = createVehicle(this.game, this.terrain, Math.round(fleet.value) === 1 ? MIXED_FLEET[index % MIXED_FLEET.length] : 'buggy', new Vector3(x, this.terrain.heightAt(x, z) + 2, z), heading)
      bot.isLocal = false; bot.id = `bot-${this.nextBotId++}`; bot.name = generateName(`${worldSeed.value}:${bot.id}`, 'bot')
      bot.setColors(`hsl(${(index * 137.508 + 15) % 360}, 85%, 55%)`, '#ffffff')
      const brain = new BotBrain(this.game, this.terrain, bot, this.player, index)
      brain.requestRecovery = () => {
        // Reuse the same vehicle and stable identity when sticky terrain defeats it.
        for (let attempt = 0; attempt < 16; attempt++) {
          const spawn = this.terrain.spawnPoint(index + attempt + 1)
          if (!isSafeGround(this.terrain, spawn.position.x, spawn.position.z)) continue
          bot.teleport(spawn.position, spawn.heading); return true
        }
        return false
      }
      // Each bot gets a character from the world seed and its own id, and a mind to act on it.
      const pilot = createPilot(bot, this.terrain)
      if (pilot) brain.mind = new Mind(bot, this.terrain, pilot, { seed: `${worldSeed.value}:${bot.id}`, navigator: this.navigator, places: this.places, others: () => [...this.targets, ...this.bots] })
      brain.navigator = this.navigator
      brain.setGear(this.gearHooks)
      brain.match = this.match
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
  /** Visible companions survive a budget drop; hidden ones get three wall-clock seconds. */
  private retainForQuality(index: number, now: number): boolean {
    const bot = this.bots[index], p = bot.body.translation(), camera = this.game.camera
    if (!camera) return false
    camera.updateMatrixWorld()
    this.retentionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.retentionFrustum.setFromProjectionMatrix(this.retentionMatrix, camera.coordinateSystem)
    curveOffset(p.x, p.y, p.z, this.retentionBend)
    this.retentionSphere.center.set(p.x, p.y, p.z).add(this.retentionBend)
    const visible = !overHorizon(p.x, p.z, 5, p.y + 3) && this.retentionFrustum.intersectsSphere(this.retentionSphere)
    if (visible) { this.offscreenSince.delete(bot); return true }
    const since = this.offscreenSince.get(bot) ?? now
    this.offscreenSince.set(bot, since)
    return now - since < 3000
  }
  /** Reconcile outside the physics iterator so removing bots cannot skip another body's step. */
  update(dt = 0) {
    if (this.disposed) return
    this.daydream.update(dt)
    if (this.remote) return
    const requested = Math.max(0, Math.floor(botCount.value))
    // Explicit population changes and remote/dispose cleanup still take effect immediately.
    while (this.bots.length > requested) this.removeLast()
    const count = Math.min(qualityBudget().bots, requested)
    if (this.bots.length > count) {
      const now = performance.now()
      // Scan past protected bots: one visible tail must not retain the entire population.
      for (let i = this.bots.length - 1; i >= 0 && this.bots.length > count; i--) {
        if (!this.retainForQuality(i, now)) this.removeAt(i)
      }
    }
    // A completed reduction must not carry unvisited timers into the next budget drop.
    if (this.bots.length <= count) this.offscreenSince.clear()
    while (this.bots.length < count) if (!this.spawn(this.bots.length)) break
    // On a round world most of the map is behind the planet. A bot there still drives (its
    // physics is the host's to run) but there is nothing of it to draw.
    // On a round world three's own frustum culling is off (the bend moves things after it
    // would have tested them), so a bot behind the camera would still be submitted: test
    // that here. Eight metres of slack covers the vehicle's size and the bend up close.
    const round = curveFactor() > 0, camera = this.game.camera
    if (round) camera.getWorldDirection(this.look)
    for (const bot of this.bots) {
      const p = bot.body.translation()
      const behind = round && (p.x - camera.position.x) * this.look.x + (p.y - camera.position.y) * this.look.y + (p.z - camera.position.z) * this.look.z < -8
      bot.object.visible = !behind && !overHorizon(p.x, p.z, 4, p.y + 3)
    }
  }
  dispose() {
    this.disposed = true
    this.races.setHooks(null)
    this.daydream.dispose(); this.navigator.dispose?.()
    this.clearBots()
  }
}

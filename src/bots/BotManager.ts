import { worldSeed } from '../../shared/params'
import { generateName } from '../ui/data/names'
import { attachVehicleEffects } from '../vehicles/effects'
import { Vector3 } from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { qualityBudget } from '../core/quality'
import { createVehicle } from '../vehicles'
import type { Vehicle } from '../vehicles/Vehicle'
import { BotBrain, isSafeGround, type BotMatch, type BotTerrain } from './BotBrain'
import { botCount, fleet, spawnRadius } from './params'
import { Daydream } from './Daydream'
import { curveFactor, overHorizon } from '../world/curve'
import { Mind } from './mind/Mind'
import { createPilot } from './pilot'
import { createNavigator, pointsOfInterest, type PointOfInterest } from './nav'
import type { Navigator } from './pilot/types'
import type { BotGearHooks } from './gear'
import { BotRaces, type BotRaceHooks } from './races'
import type { RaceState } from '../../shared/protocol'
import { BotPacer } from './pacing'

/** The arrival effect (src/vehicles/effects/Materialize.ts), as far as bots use it. */
export interface BotArrivalEffect {
  begin(vehicle: Vehicle, options?: { at?: Vector3; heading?: number; hold?: boolean; holdSeconds?: number }): Promise<void>
  cancel(vehicle: Vehicle): void
}
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
  private nextBotId = 0
  /** Paces arrivals and measures what this device carries (see pacing.ts). */
  readonly pacer = new BotPacer()
  /** Bots may arrive only while this is true: driving, not entering a world or in the menus. */
  private gate: () => boolean = () => true
  setArrivalGate(open: () => boolean) { this.gate = open }
  private effect: BotArrivalEffect | null = null
  /** Bots arrive in the arrival cloud and leave in it. Without one they appear and go plainly. */
  setArrivalEffect(effect: BotArrivalEffect | null) { this.effect = effect }
  /** A bot being built and compiled before it appears; at most one at a time. */
  private arriving = false
  /** Bots on their way out, still in the scene inside their cloud. */
  private readonly leaving = new Set<Vehicle>()
  /** Changes when the world is rebuilt, so an arrival started on the old one is dropped. */
  private world = 0
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
    terrain.onRegenerate?.(() => {
      this.sights = null; this.races.cancel('world-changed')
      // A new world: the bots of the old one go (the world is rebuilt under cover), and the
      // new world's arrive one at a time near the player once they can drive.
      this.world++; this.clearBots(); this.pacer.restart()
    })
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
  private removeLast() {
    const bot = this.bots.pop()!
    this.effects.get(bot)?.(); this.effects.delete(bot)
    this.game.remove(this.brains.pop()!); this.game.remove(bot)
    for (const controller of this.brains) controller.setPeers(this.bots)
  }
  /** Send the newest bot away: it vanishes in the arrival cloud where it is, then goes. */
  private depart() {
    const bot = this.bots[this.bots.length - 1]
    if (!bot) return
    if (!this.effect) { this.removeLast(); return }
    // Out of the count now, so the next decision sees one fewer; gone once its cloud has gathered.
    const index = this.bots.length - 1
    this.bots.splice(index, 1); const brain = this.brains.splice(index, 1)[0]
    for (const controller of this.brains) controller.setPeers(this.bots)
    this.leaving.add(bot)
    const gone = () => {
      if (!this.leaving.delete(bot)) return
      this.effects.get(bot)?.(); this.effects.delete(bot)
      this.game.remove(brain); this.game.remove(bot)
    }
    this.effect.begin(bot, { hold: false, holdSeconds: 0.7 }).then(gone, gone)
  }
  private clearBots() {
    while (this.bots.length) this.removeLast()
    for (const bot of [...this.leaving]) { this.effect?.cancel(bot); this.leaving.delete(bot); this.effects.get(bot)?.(); this.effects.delete(bot); this.game.remove(bot) }
  }
  /**
   * A place for a new bot near the player, wherever they are: on ground its vehicle can use
   * (water only for a hovercraft or a jet, never lava), clear of every other vehicle, out of
   * the player's way ahead, and close enough to be seen arriving: off to one side and a little
   * ahead first, where the chase camera looks, then further round. Null when there is none.
   */
  private spot(index: number, kind: string): { position: Vector3; heading: number } | null {
    const p = this.player.body.translation(), v = this.player.body.linvel()
    // Where the player is heading: the way they are moving, or the way the vehicle faces.
    const moving = Math.hypot(v.x, v.z) > 2
    const r = this.player.body.rotation()
    const facing = moving ? Math.atan2(v.x, v.z) : Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x))
    const floats = kind === 'hovercraft' || kind === 'jet'
    const others = [...this.targets, ...this.bots, ...this.leaving]
    // Bands of bearing off the heading, best first, each tried on both sides and at a few distances.
    const bands: [number, number][] = [[0.75, 1.1], [1.1, 1.75], [1.75, 2.6], [2.6, Math.PI]]
    const side = index % 2 ? 1 : -1
    for (const [from, to] of bands) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const off = from + (to - from) * ((attempt * 0.618 + index * 0.31) % 1)
        const angle = facing + (attempt % 2 ? -side : side) * off
        const radius = spawnRadius.value * (0.75 + 0.15 * (attempt % 4))
        const x = p.x + Math.sin(angle) * radius, z = p.z + Math.cos(angle) * radius
        const ground = this.terrain.heightAt(x, z)
        if (!Number.isFinite(ground)) continue
        if (floats) {
          if (this.terrain.liquidKindAt?.(x, z) === 'lava') continue
        } else if (!isSafeGround(this.terrain, x, z) || this.terrain.normalAt(x, z, new Vector3()).y < 0.65) continue
        if (others.some(o => { const q = o.body.translation(); return Math.hypot(q.x - x, q.z - z) < 7 })) continue
        // Facing roughly the player's way, so it falls in alongside rather than head on.
        const surface = floats ? Math.max(ground, this.terrain.liquidHeightAt?.(x, z) ?? -Infinity) : ground
        return { position: new Vector3(x, surface + 2, z), heading: facing }
      }
    }
    return null
  }

  /** Build the vehicle for bot `index` at a place near the player, or null when there is none. */
  private build(index: number): { bot: Vehicle; place: { position: Vector3; heading: number } } | null {
    const kind = Math.round(fleet.value) === 1 ? MIXED_FLEET[index % MIXED_FLEET.length] : 'buggy'
    const place = this.spot(index, kind)
    if (!place) return null
    const start = performance.now()
    const bot = createVehicle(this.game, this.terrain, kind, place.position, place.heading)
    bot.isLocal = false; bot.id = `bot-${this.nextBotId++}`; bot.name = generateName(`${worldSeed.value}:${bot.id}`, 'bot')
    bot.setColors(`hsl(${(index * 137.508 + 15) % 360}, 85%, 55%)`, '#ffffff')
    try { performance.measure('syn3h:bot build', { start, end: performance.now(), detail: kind }) } catch { /* Older engines. */ }
    return { bot, place }
  }

  /** Put a built bot into play: its brain, mind, effects and the arrival cloud. */
  private enter(bot: Vehicle, place: { position: Vector3; heading: number }, index: number): void {
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
    void this.effect?.begin(bot, { at: place.position, heading: place.heading })
  }

  /**
   * One bot arrives. It is built off stage, its shaders compiled a slice per frame, and only
   * then shown, in the arrival cloud at its place near the player, so its arrival costs no
   * frame of its own. Resolves false when there was nowhere to put it or the world changed.
   */
  private async arrive(index: number): Promise<boolean> {
    const world = this.world
    const built = this.build(index)
    if (!built) return false
    const { bot, place } = built
    // Off stage while its shaders compile: no body in the world, nothing drawn.
    bot.setParked(true)
    try {
      bot.update(0, 1)
      await this.game.compileAhead?.(bot.object)
    } catch (error) { console.warn('Bot shaders not compiled ahead', error) }
    if (this.disposed || this.remote || world !== this.world) { bot.dispose(); return false }
    bot.setParked(false)
    this.enter(bot, place, index)
    return true
  }

  /**
   * In a running game bots are paced and measured. Without a renderer (tests, headless
   * simulations) there is nothing to compile ahead or to measure: the fleet appears at once.
   */
  private get paced(): boolean { return typeof (this.game as Partial<Game>).compileAhead === 'function' }

  /** Reconcile outside the physics iterator so removing bots cannot skip another body's step. */
  update(dt = 0) {
    if (this.disposed) return
    this.daydream.update(dt)
    if (this.remote) return
    // The host's count is an upper bound; the level's budget and what this device was measured
    // to carry come under it. One arrival or departure at a time, an interval apart.
    const wanted = Math.max(0, Math.min(qualityBudget().bots, Math.floor(botCount.value)))
    if (!this.paced) {
      while (this.bots.length > wanted) this.removeLast()
      while (this.bots.length < wanted) { const built = this.build(this.bots.length); if (!built) break; this.enter(built.bot, built.place, this.bots.length) }
    } else {
      const governor = (this.game as { quality?: { governor?: { targetMs: number; level: number } } }).quality?.governor
      // A bot still compiling counts as here: it is judged from the moment it was asked for.
      const action = this.pacer.step(performance.now(), dt * 1000, {
        have: this.bots.length + (this.arriving ? 1 : 0), wanted, targetMs: governor?.targetMs ?? 1000 / 60, level: governor?.level ?? 0, open: this.gate(),
      })
      if (action === 'remove') { if (!this.arriving) this.depart() }
      else if (action === 'add' && !this.arriving) {
        this.arriving = true
        void this.arrive(this.bots.length).catch(error => { console.warn('Bot arrival failed', error); return false }).finally(() => { this.arriving = false })
      }
    }
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

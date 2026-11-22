import { worldSeed } from '../../shared/params'
import { uniqueBotName } from '../ui/data/names'
import { attachVehicleEffects } from '../vehicles/effects'
import { Vector3, type Mesh, type Object3D } from 'three/webgpu'
import { longFrames } from '../core/longFrames'
import type { CoveredWarm, Game, System } from '../core/Game'
import { qualityBudget } from '../core/quality'
import type { VehicleKind } from '../vehicles'
import type { Vehicle } from '../vehicles/Vehicle'
import { BotBrain, isSafeGround, type BotMatch, type BotTerrain } from './BotBrain'
import { BotRenderWarm } from './BotRenderWarm'
import { botCount, botsKeepCount, fleet, spawnRadius } from './params'
import { Daydream } from './Daydream'
import { curveFactor, overHorizon } from '../world/curve'
import { Mind } from './mind/Mind'
import { createPilot } from './pilot'
import { createNavigator, pointsOfInterest, type PointOfInterest } from './nav'
import type { Navigator } from './pilot/types'
import type { BotGearHooks } from './gear'
import { BotRaces, type BotRaceHooks } from './races'
import type { RaceState } from '../../shared/protocol'
import { BotPacer, BudgetHysteresis } from './pacing'
import { assignTargets, type Candidate } from './tactics'
import { difficultyScale, PER_PERSON, skill } from './skills'
import { wrapDistance } from '../../shared/wrap'

/** The arrival effect (src/vehicles/effects/Materialize.ts), as far as bots use it. */
export interface BotArrivalEffect {
  begin(vehicle: Vehicle, options?: { at?: Vector3; heading?: number; hold?: boolean; holdSeconds?: number }): Promise<void>
  /** The arrival in reverse, look only; resolves when the vehicle can be removed inside the cloud. */
  depart?(vehicle: Vehicle, options?: { holdSeconds?: number }): Promise<void>
  cancel(vehicle: Vehicle): void
}
/** Slot by slot: half buggies, a quarter hovercraft, a quarter jets. */
const MIXED_FLEET = ['buggy', 'hovercraft', 'buggy', 'jet'] as const
export type ArrivalGate = 'playing' | 'idle' | 'closed'

export class BotManager implements System {
  private readonly bots: Vehicle[] = []
  private readonly covered: BotRenderWarm
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
  /**
   * Whether bots may arrive now: 'playing' (the host is in the world: arrivals are judged by
   * their frames), 'idle' (the host is in the lobby or a menu: they still arrive, unjudged, so
   * a room's bots never depend on its host looking at the game) or 'closed' (a descent or an
   * ascent is running, where an arrival would cost a frame of the transition).
   */
  private gate: () => ArrivalGate = () => 'playing'
  setArrivalGate(gate: () => ArrivalGate) { this.gate = gate }
  private effect: BotArrivalEffect | null = null
  /** Bots arrive in the arrival cloud and leave in it. Without one they appear and go plainly. */
  setArrivalEffect(effect: BotArrivalEffect | null) { this.effect = effect }
  /** A bot being built and compiled before it appears; at most one at a time. */
  private arriving = false
  /** Bots on their way out, still in the scene inside their cloud. */
  /** Bots on their way out, with the brain still driving each until its cloud has gathered. */
  private readonly leaving = new Map<Vehicle, BotBrain>()
  /** Changes when the world is rebuilt, so an arrival started on the old one is dropped. */
  private world = 0
  private targets: readonly Vehicle[]
  private disposed = false
  private isRemote = false
  /** Networking owns inputs and rescue decisions on non-host clients. */
  get remote() { return this.isRemote }
  set remote(value: boolean) {
    const was = this.isRemote
    this.isRemote = value
    if (value) { this.races.setHooks(null); this.clearBots() }
    // Becoming the host: the race hooks handed over while these bots were still remote (the
    // race bridge installs in the same frame, before networking flips this) take effect now.
    else if (was) this.races.setHooks(this.raceHooks)
  }
  suspendDiagnosticPacing = false
  get vehicles(): readonly Vehicle[] { return this.bots }
  /** What the host asked for, within the quality level's budget: never exceeded. */
  get requested(): number {
    // In a running game a larger level budget waits for the level to settle (BudgetHysteresis).
    const budget = botsKeepCount.value ? Infinity : this.paced ? this.budgetHold.value(qualityBudget().bots, performance.now()) : qualityBudget().bots
    return Math.max(0, Math.min(budget, Math.floor(botCount.value)))
  }
  private readonly budgetHold = new BudgetHysteresis()
  /** The brains, index for index with `vehicles` (chatter and rescues read and steer them). */
  get brainList(): readonly BotBrain[] { return this.brains }
  /** The player's own vehicle driving itself after a spell of no input. See Daydream.ts. */
  readonly daydream: Daydream
  readonly races: BotRaces
  /** The race hooks last given, kept while the bots are remote so they apply on becoming host. */
  private raceHooks: BotRaceHooks | null = null
  setRaces(hooks: BotRaceHooks | null) { this.raceHooks = hooks; this.races.setHooks(this.remote ? null : hooks) }
  applyRace(state: RaceState | null) { this.races.apply(state) }
  readonly navigator: Navigator & { dispose?(): void }
  /** Places worth driving to, found once per world and shared by every mind. */
  private sights: PointOfInterest[] | null = null
  private readonly places = () => this.sights ??= pointsOfInterest(this.terrain)
  constructor(private readonly game: Game, private readonly terrain: BotTerrain, private player: Vehicle) {
    this.targets = [player]
    this.covered = new BotRenderWarm(game, terrain)
    // Owned here so the composition root needs no extra wiring: this manager already holds
    // the player, the terrain and every vehicle a daydreaming driver might tail.
    // One route planner per terrain, shared by every mind: its caches are megabytes.
    this.navigator = createNavigator(terrain)
    this.races = new BotRaces(terrain, this.navigator, this.places)
    terrain.onRegenerate?.(() => {
      this.sights = null; this.races.cancel('world-changed')
      // A new world: the bots of the old one go (the world is rebuilt under cover), and the
      // new world's arrive one at a time near the player once they can drive.
      this.covered.worldChanged()
      this.world++; this.clearBots(); this.pacer.restart()
    })
    this.daydream = new Daydream(game, terrain, player, { navigator: this.navigator, places: this.places, others: () => [...this.targets, ...this.bots] })
  }
  drawReliefFleet(minimal: boolean, draw: () => void): void { this.covered.drawReliefFleet(minimal, draw) }
  drawClimbFleet(draw: () => void): void { this.covered.drawClimbFleet(draw) }

  warmCovered(warm: CoveredWarm): Promise<void> { return this.covered.warm(warm) }
  acquireBotVehicle(kind: VehicleKind, position: Vector3, heading: number): Vehicle {
    return this.covered.acquire(kind, position, heading)
  }

  releaseBotVehicle(vehicle: Vehicle): boolean { return this.covered.release(vehicle) }

  private removeBotVehicle(vehicle: Vehicle): void {
    this.effect?.cancel(vehicle)
    if (this.releaseBotVehicle(vehicle)) this.game.remove(vehicle, false)
    else this.game.remove(vehicle)
  }

  fixedUpdate(dt: number) {
    this.daydream.fixedUpdate(dt)
    if (!this.remote) {
      this.races.update()
      for (const brain of this.brains) brain.raceGoal = this.races.goal(brain.vehicle)
      this.assignClock -= dt
      if (this.assignClock <= 0) { this.assignClock = 1; this.assignGames() }
    }
  }
  private assignClock = 0
  private lastIt: Vehicle | null = null
  /**
   * Whether a vehicle may be gone after in a game right now. Networking sets it: not while it
   * is materializing, paused, or was just tagged or knocked. Everyone, until then.
   */
  gameAvailable: (vehicle: Vehicle) => boolean = () => true
  /**
   * Who each bot goes after in the games, at most PER_PERSON bots on any one person (the
   * Foreman, 18 November 2026), the rest on each other. On the hill: anyone in the zone, the
   * holder first. In tag: whoever is "it" (persistently, so the two on a person keep at it),
   * and for a bot that is "it", someone near to score on. Free play gives no game targets.
   */
  private assignGames(): void {
    const match = this.match
    const brains = this.brains
    if (!match) { for (const b of brains) { b.gameTarget = null; b.gameSlot = 0; b.gameOf = 1 } return }
    const wrap = this.terrain.wrapSize
    const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => wrap ? wrapDistance(a.x, a.z, b.x, b.z, wrap) : Math.hypot(a.x - b.x, a.z - b.z)
    const isBot = new Set<Vehicle>(this.bots)
    const people = this.targets.filter(v => v.body.isValid() && !isBot.has(v))
    const everyone = [...people, ...this.bots.filter(v => v.body.isValid())]
    const idOf = new Map<Vehicle, string>(everyone.map((v, i) => [v, `v${i}`]))
    const byId = new Map<string, Vehicle>([...idOf].map(([v, id]) => [id, v]))
    const candidate = (v: Vehicle, weight = 0): Candidate => ({ id: idOf.get(v)!, position: v.body.translation(), person: !isBot.has(v), available: this.gameAvailable(v), weight })
    let hunters = brains.filter(b => b.vehicle.body.isValid())
    let candidates: Candidate[] = []
    if (match.mode === 'hill') {
      const ring = match.ring
      const inZone = (v: Vehicle) => {
        if (!ring) return false
        const q = v.body.translation(), d = flat(q, ring)
        return d >= ring.inner - 6 && d <= ring.outer + 6
      }
      candidates = everyone.filter(inZone).map(v => candidate(v, v === match.holder ? 40 : 0))
      // The bots near the hill do the fighting (the ones far off are still on their way up);
      // and a person in the zone is who they go for first, before each other.
      if (ring) hunters = hunters.filter(b => flat(b.vehicle.body.translation(), ring) <= ring.outer + 300)
    } else if (match.it?.body.isValid() && idOf.has(match.it)) {
      const it = match.it
      // Everyone else goes for "it"; a bot that is "it" picks someone to score on.
      const itBrain = brains.find(b => b.vehicle === it)
      hunters = hunters.filter(b => b !== itBrain)
      // At most PER_PERSON bots go after "it", a bot as much as a person: with bot-on-bot rams
      // passing the role, three or four bots on a bot "it" would keep it among themselves and
      // leave the person watching. The rest keep the person company, as in free play.
      candidates = [{ ...candidate(it, 30), person: true }]
      if (itBrain) {
        const scoreOn = assignTargets([{ id: idOf.get(it)!, position: it.body.translation(), current: itBrain.gameTarget ? idOf.get(itBrain.gameTarget) : null }], everyone.filter(v => v !== it).map(v => candidate(v)), PER_PERSON - 1, flat)
        const pick = scoreOn.get(idOf.get(it)!)
        itBrain.gameTarget = pick ? byId.get(pick) ?? null : null
        itBrain.gameSlot = 0; itBrain.gameOf = 1
      }
    }
    if (match.mode === 'hill' && match.ring) {
      // A few bots at once take a turn holding the zone, the ones nearest it: one at the default
      // difficulty, more as it rises. Four parked in it at once left a person no hill to hold.
      const cap = Math.max(1, Math.round(skill(1.5)))
      const order = [...brains].sort((p, q) => flat(p.vehicle.body.translation(), match.ring!) - flat(q.vehicle.body.translation(), match.ring!))
      order.forEach((b, i) => { b.mayContest = i < cap })
    } else for (const b of brains) b.mayContest = true
    if (match.mode === 'tag') {
      // When the role changes hands, the hunters take a beat to regroup: about three seconds at
      // the default difficulty, less as it rises, so a new "it" has a moment to use it.
      const it = match.it ?? null
      if (it !== this.lastIt) {
        this.lastIt = it
        for (const b of brains) b.regroupUntil = b.clock + 2.5 / difficultyScale()
      }
    }
    const assigned = assignTargets(hunters.map(b => ({ id: idOf.get(b.vehicle) ?? '', position: b.vehicle.body.translation(), current: b.gameTarget ? idOf.get(b.gameTarget) ?? null : null })), candidates, PER_PERSON, flat, match.mode === 'hill' ? 250 : 25, 60)
    const slots = new Map<string, number>()
    for (const b of hunters) {
      const id = assigned.get(idOf.get(b.vehicle) ?? '') ?? null
      b.gameTarget = id ? byId.get(id) ?? null : null
      b.gameSlot = id ? slots.get(id) ?? 0 : 0
      if (id) slots.set(id, b.gameSlot + 1)
    }
    for (const b of hunters) { const id = b.gameTarget ? idOf.get(b.gameTarget) : undefined; b.gameOf = id ? slots.get(id) ?? 1 : 1 }
    for (const b of brains) if (!hunters.includes(b) && !(match.mode === 'tag' && b.vehicle === match.it)) b.gameTarget = null
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
    const spanStart = longFrames.start()
    try {
      longFrames.event('bot.remove')
      const bot = this.bots.pop()!
      this.effects.get(bot)?.(); this.effects.delete(bot)
      this.game.remove(this.brains.pop()!); this.removeBotVehicle(bot)
      for (const controller of this.brains) controller.setPeers(this.bots)
    } finally {
      longFrames.end('bot.remove', spanStart)
    }
  }
  /** Send the newest bot away: it leaves in the departure cloud where it is, then goes. */
  private depart() {
    const bot = this.bots[this.bots.length - 1]
    if (!bot) return
    if (!this.effect) { this.removeLast(); return }
    const spanStart = longFrames.start()
    try {
      longFrames.event('bot.depart')
      // Out of the count now, so the next decision sees one fewer; gone once its cloud has gathered.
      const index = this.bots.length - 1
      this.bots.splice(index, 1); const brain = this.brains.splice(index, 1)[0]
      for (const controller of this.brains) controller.setPeers(this.bots)
      this.leaving.set(bot, brain)
      const gone = () => {
        if (!this.leaving.delete(bot)) return
        this.removeDeparting(bot, brain)
      }
      ;(this.effect.depart?.(bot) ?? this.effect.begin(bot, { hold: false, holdSeconds: 0.7 })).then(gone, gone)
    } finally {
      longFrames.end('bot.depart', spanStart)
    }
  }
  private removeDeparting(bot: Vehicle, brain: BotBrain): void {
    const spanStart = longFrames.start()
    try {
      longFrames.event('bot.remove')
      this.effects.get(bot)?.(); this.effects.delete(bot)
      this.game.remove(brain); this.removeBotVehicle(bot)
    } finally {
      longFrames.end('bot.remove', spanStart)
    }
  }
  private clearBots() {
    while (this.bots.length) this.removeLast()
    // A bot still leaving goes with its brain: a brain left running would read a removed body,
    // which panics the physics engine for the rest of the session.
    for (const [bot, brain] of [...this.leaving]) {
      this.leaving.delete(bot)
      this.removeDeparting(bot, brain)
    }
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
    const others = [...this.targets, ...this.bots, ...this.leaving.keys()]
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
    const spanStart = longFrames.start()
    try {
      const kind = Math.round(fleet.value) === 1 ? MIXED_FLEET[index % MIXED_FLEET.length] : 'buggy'
      const place = this.spot(index, kind)
      if (!place) return null
      const start = performance.now()
      const bot = this.acquireBotVehicle(kind, place.position, place.heading)
      bot.isLocal = false; bot.id = `bot-${this.nextBotId++}`; bot.name = uniqueBotName(`${worldSeed.value}:${bot.id}`, new Set([this.player.name, ...this.bots.map(other => other.name), ...[...this.leaving.keys()].map(other => other.name)].filter(Boolean).map(n => n!.toLowerCase())))
      bot.setColors(`hsl(${(index * 137.508 + 15) % 360}, 85%, 55%)`, '#ffffff')
      try { performance.measure('syn3h:bot build', { start, end: performance.now(), detail: kind }) } catch { /* Older engines. */ }
      return { bot, place }
    } finally {
      longFrames.end('bot.build', spanStart)
    }
  }

  /** Put a built bot into play: its brain, mind, effects and the arrival cloud. */
  private enter(bot: Vehicle, place: { position: Vector3; heading: number }, index: number): void {
    const spanStart = longFrames.start()
    try {
      longFrames.event('bot.add')
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
    } finally {
      longFrames.end('bot.add', spanStart)
    }
  }

  /**
   * One bot arrives, in the arrival cloud at its place near the player. Its shaders compile in
   * the frame it is first drawn; arrivals are an interval apart, so those frames are spread
   * out. Resolves false when there was nowhere to put it.
   */
  private async arrive(index: number): Promise<boolean> {
    const built = this.build(index)
    if (!built) return false
    this.enter(built.bot, built.place, index)
    return true
  }

  /**
   * In a running game bots are paced and measured. Without a renderer (tests, headless
   * simulations) there is nothing to measure: the fleet appears at once.
   */
  private get paced(): boolean { return typeof (this.game as Partial<Game>).precompile === 'function' }

  /** Reconcile outside the physics iterator so removing bots cannot skip another body's step. */
  update(dt = 0) {
    if (this.disposed) return
    this.daydream.update(dt)
    if (this.remote || this.suspendDiagnosticPacing) return
    // The host's count is an upper bound; the level's budget and what this device was measured
    // to carry come under it. One arrival or departure at a time, an interval apart.
    const wanted = this.requested
    if (!this.paced) {
      while (this.bots.length > wanted) this.removeLast()
      while (this.bots.length < wanted) { const built = this.build(this.bots.length); if (!built) break; this.enter(built.bot, built.place, this.bots.length) }
    } else {
      const governor = (this.game as { quality?: { governor?: { targetMs: number; level: number } } }).quality?.governor
      // A bot still compiling counts as here: it is judged from the moment it was asked for.
      // Wall time: performance.now() and the frame's own duration. Right for players; under a
      // capture tool's virtual clock frames look free or costly regardless of the real work.
      const gate = this.gate()
      const action = this.pacer.step(performance.now(), dt * 1000, {
        have: this.bots.length + (this.arriving ? 1 : 0), wanted, targetMs: governor?.targetMs ?? 1000 / 60, level: governor?.level ?? 0, open: gate !== 'closed', judge: gate === 'playing', keep: botsKeepCount.value,
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
  /**
   * Bots hidden this frame (behind the camera or over the horizon, see update), and inside a shown
   * bot the top-most hidden node of each branch: a quality change draws them too, so a level's new
   * vehicle and shadow materials are built before they come into view in play. A bot's other distance
   * looks are hidden groups (Box arm mid body, silhouette) around visible merged models. Medium is
   * the first level with shadows, so a bot that later drove into another look built that look's
   * shadow pipeline in play. The climb preparation draws each node unseen with all it holds.
   */
  *precompileQualityMeshes(): Iterable<Mesh> {
    const hidden: Object3D[] = []
    const visit = (o: Object3D) => { if (!o.visible) { hidden.push(o); return } for (const c of o.children) visit(c) }
    for (const bot of this.bots) visit(bot.object as unknown as Object3D)
    yield* hidden as unknown as Mesh[]
  }
  dispose() {
    this.disposed = true
    this.covered.dispose()
    this.races.setHooks(null)
    this.daydream.dispose(); this.navigator.dispose?.()
    this.clearBots()
  }
}

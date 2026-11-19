import { Quaternion, Vector3 } from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { emptyInput, type InputState } from '../core/Input'
import { GROUP_PROJECTILE, GROUP_TERRAIN, RAPIER, groups } from '../core/physics'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import * as p from './params'
import { isRoadFord } from './nav/fords'
import { BotGearController, type BotGearHooks } from './gear'
import { DuckFollower, GATHER_RADIUS } from './duck'
import { roadWaypoint, type RoadTerrain, type RoadPoint } from './navigation'
import type { Mind } from './mind/Mind'
import { GROUND_PROFILE } from './pilot/ground'
import type { Navigator } from './pilot/types'
import { hashString, seededRandom } from './random'
import { gameGear, intercept as interceptSkill, ramming, skill } from './skills'
import { interceptPoint, pincerOffset } from './tactics'
import { nearestImage, wrapCoord, wrapDistance } from '../../shared/wrap'
export type BotTerrain = Terrain & RoadTerrain & { liquidHeightAt?(x: number, z: number): number | null | undefined }
const clamp = (x: number, max = 1) => Math.max(-max, Math.min(max, x))
/** Centre to centre distance a playful bot keeps from the vehicle it chases: about two metres of air between bumpers. */
const KEEP_GAP = 7
/** Fastest a bot that is "it" in tag closes the last metres: a touch, not a ram. m/s. */
const TAP_SPEED = 1
/** Positive means turn right. Our forward is -Z; positive Y rotation turns left. */
export function steeringError(forward: { x: number; z: number }, delta: { x: number; z: number }): number {
  return Math.atan2(forward.x * delta.z - forward.z * delta.x, forward.x * delta.x + forward.z * delta.z)
}
export function isSafeGround(terrain: BotTerrain, x: number, z: number): boolean {
  // A wrapping world has no edge to stay away from: the far side of the seam is more ground.
  if (!terrain.wrapSize && (Math.abs(x) > terrain.size / 2 - 3 || Math.abs(z) > terrain.size / 2 - 3)) return false
  const ground = terrain.heightAt(x, z), liquid = terrain.liquidHeightAt?.(x, z)
  return Number.isFinite(ground) && (liquid == null || !Number.isFinite(liquid) || ground > liquid + 0.5 || isRoadFord(terrain, x, z))
}
export interface BotMatch {
  mode: 'tag' | 'hill'
  /** Tag: the vehicle that is "it", if any. */
  it?: Vehicle | null
  /** King of the Hill: the zone to hold. */
  zone?: { x: number; z: number; radius: number } | null
  /** King of the Hill: the zone itself (a ring round the lake, or a disc), to tell who is in it. */
  ring?: { x: number; z: number; inner: number; outer: number } | null
  /** King of the Hill: who holds it now, if anyone. */
  holder?: Vehicle | null
}
/**
 * A request from outside the bot's own head, for a while: a player's chat request
 * (src/bots/banter) or a rescue (src/bots/rescue). While set it wins over moods and games;
 * a race still comes first. `until` is in brain seconds (see `clock`).
 *   follow   trail this vehicle like a duckling, as the bots trail the host by default
 *   chase    tail it closely through the mind's pursuit
 *   goto     drive to a point and stay there
 *   stay     brake where it is
 *   avoid    keep away from this vehicle
 *   control  the caller writes the controls each step; returns false when finished
 */
export type BrainDirective =
  | { kind: 'follow' | 'chase'; leader: Vehicle; until: number }
  | { kind: 'goto'; x: number; y: number; z: number; radius: number; until: number }
  | { kind: 'stay'; until: number }
  | { kind: 'avoid'; threat: Vehicle; until: number }
  | { kind: 'control'; step(dt: number, input: InputState): boolean }

export class BotBrain implements System {
  directive: BrainDirective | null = null
  /** Seconds this brain has run: the clock directives count against. */
  clock = 0
  /** While true the old self-rescue (a teleport to a pad) waits: someone is coming to help. */
  holdRecovery = false
  private applied: BrainDirective | null = null
  /** Freed by someone else (src/bots/rescue): start the trouble clocks again. */
  clearTrouble(): void {
    this.immobileTime = this.liquidTime = this.flippedTime = 0
    this.lastPosition.copy(this.vehicle.body.translation())
    this.mind?.reset()
  }
  /** Seconds going nowhere, upside down, or with wheels in liquid: for the bots' chatter. */
  get trouble(): { stuck: number; flipped: number; bog: number } {
    return { stuck: Math.max(this.mind?.troubleFor ?? 0, this.immobileTime), flipped: this.flippedTime, bog: this.liquidTime }
  }

  remote = false
  /**
   * The games (src/bots/BotManager.ts assigns it): whom this bot goes after. On the hill, a
   * person or bot in the zone to ram or grapple off it; in tag, whoever is "it" (to take the
   * role), or for a bot that is "it", whom to score on with a laser. Null leaves it to its
   * moods. `gameSlot` of `gameOf` is its place among the bots on the same target (the pincer).
   */
  gameTarget: Vehicle | null = null
  gameSlot = 0
  gameOf = 1
  /** The hill: whether this bot may take its turn holding the zone (a few at once, by difficulty). */
  mayContest = true
  /** Tag: brain seconds until which this bot lets a new "it" get away, before going after them. */
  regroupUntil = 0
  /** Driving at `target` to make contact in a game: interception, pincer and ram commitment. */
  private hunting = false
  /** The hill, in turns: holding the zone, then moving on so it does not become a jam. */
  private hillPhase: 'contest' | 'away' = 'contest'
  private hillTime = 0
  private gear: BotGearController | null = null
  setGear(hooks: BotGearHooks | null) {
    if (hooks && !this.gear) this.gear = new BotGearController(this.vehicle, () => this.terrain.wrapSize, target => {
      const here = this.vehicle.body.translation(), there = this.imageOf(target.body.translation(), here)
      const delta = new Vector3(there.x - here.x, there.y - here.y, there.z - here.z), length = delta.length()
      if (length < 0.01) return false
      delta.multiplyScalar(1 / length)
      return !this.game.world.castRay(new RAPIER.Ray(here, delta), length, true, undefined, groups(GROUP_PROJECTILE, GROUP_TERRAIN))
    }, (x, z) => isSafeGround(this.terrain, x, z) && (this.navigator?.passable(x, z, GROUND_PROFILE) ?? this.terrain.normalAt(x, z, new Vector3()).y > 0.85))
    this.gear?.setHooks(hooks)
  }
  dispose() { this.gear?.setHooks(null) }
  requestRecovery?: () => boolean
  target: Vehicle | null = null
  /**
   * The player changed vehicle in place: chase the new one where the old one was the target.
   * A duckling's line moves with it on its next step (DuckFollower.follow starts a fresh
   * track for a new leader), and a mind tailing the old vehicle is pointed at the new one.
   */
  setLocalPlayer(next: Vehicle): void {
    const previous = this.localPlayer
    if (next === previous) return
    if (this.target === previous) this.target = next
    this.localPlayer = next
    if (this.mind?.activity.leader === previous) this.mind.activity.leader = next
  }
  /**
   * The bot's own mind, when it has one. With it the bot alternates between chasing and
   * roaming on its own agenda, in the share set by `bots.freeSpirit`. Without it, it chases.
   */
  mind: Mind | null = null
  /** What it is doing now: 'chase' is the original pursuit, 'roam' is the mind's choice. */
  raceGoal: { countdown: boolean; destination: { x: number; y: number; z: number; radius: number } } | null = null
  private racing = false
  mood: 'chase' | 'roam' = 'chase'
  private moodTime = 0
  private steer = 0
  /**
   * The game being played, when networking tells the manager. In tag, the bot that is "it"
   * hunts the nearest vehicle and the others run from it when it is close; on the hill, most
   * bots go and hold the zone. Null leaves a bot to its own moods.
   */
  match: BotMatch | null = null
  /** Route planner for open ground, shared by every bot. Without it the chase is by sight. */
  navigator: Navigator | null = null
  private lineClear = true
  private lineTime = 0
  private random: () => number = () => 0.5
  reversing = false
  rescues = 0
  private reverseBrake = 0
  private routeTime = 0
  private waypoint: RoadPoint | null = null
  private strategyTime = 0
  private targetTime = 2
  private fireTime = 0
  private immobileTime = 0
  private liquidTime = 0
  private flippedTime = 0
  private readonly lastPosition = new Vector3()
  private readonly forward = new Vector3()
  private readonly up = new Vector3()
  private readonly quaternion = new Quaternion()
  private targets: readonly Vehicle[] = []
  private peers: readonly Vehicle[] = []
  /** Baby duck following, while chasing at a playful aggression. See duck.ts. */
  readonly duck: DuckFollower
  private duckClock = 0
  /** Backing away from the target: out of its way as it reverses, or out of its lap when it stops. */
  private backing = false
  setPeers(vehicles: readonly Vehicle[]) { this.peers = vehicles }
  constructor(private readonly game: Game, private readonly terrain: BotTerrain, readonly vehicle: Vehicle, private localPlayer: Vehicle, readonly index = 0) {
    vehicle.isLocal = false
    this.lastPosition.copy(vehicle.body.translation())
    // Original VhiclBot.cs:25 staggered checks randomly. Index gives repeatable staggering.
    this.strategyTime = (index * 0.61803398875 % 1) * p.strategyInterval.value
    this.random = seededRandom(hashString(`mood:${vehicle.id}:${index}`))
    this.duck = new DuckFollower(vehicle, index)
  }

  /** May a bot stand here: dry, inside the world, not a cliff. */
  private standable(x: number, z: number): boolean {
    return isSafeGround(this.terrain, x, z) && (this.navigator?.passable(x, z, GROUND_PROFILE) ?? true)
  }

  /** Playful company rather than a hunt: at or below RAM_AGGRESSION, with following on. */
  private get playful(): boolean {
    return p.followYou.value > 0 && p.aggression.value <= p.RAM_AGGRESSION
  }
  /**
   * Chase or roam for the next while. Sociable bots chase more, and a player close by is
   * hard to ignore. Spells are long enough to get somewhere and short enough to surprise.
   */
  private chooseMood(distance: number) {
    const free = p.freeSpirit.value, sociable = this.mind!.personality.sociability - 0.5
    // The ends of the slider are absolute: 0 is the original relentless pursuit, 1 never chases.
    // Between them a playful bot is a duckling: it follows most of the time and wanders off
    // only briefly, for longer the more playful it is, then hurries back.
    const duckling = this.playful
    const chase = free <= 0 ? 1 : free >= 1 ? 0 : duckling ? (p.followYou.value >= 1 ? 1 : p.followYou.value + sociable * 0.2 + (distance < 60 ? 0.1 : 0)) : 1 - free + sociable * 0.4 + (distance < 60 ? 0.2 : 0)
    this.mood = this.random() < chase ? 'chase' : 'roam'
    const spell = this.random()
    this.moodTime = duckling
      ? this.mood === 'chase' ? 20 + spell * 25 : (4 + spell * 8) * (0.5 + p.playfulness.value)
      : this.mood === 'chase' ? 15 + spell * 20 : 30 + spell * 40
    this.mind!.reset(); this.reversing = false; this.immobileTime = 0; this.strategyTime = 0
    this.lastPosition.copy(this.vehicle.body.translation())
  }
  private nearestOther(here: { x: number; z: number }): Vehicle | null {
    let best: Vehicle | null = null, bestDistance = Infinity
    for (const candidate of [...this.targets, ...this.peers]) {
      if (candidate === this.vehicle || !candidate.body.isValid()) continue
      const q = candidate.body.translation(), wrap = this.terrain.wrapSize
      const d = wrap ? wrapDistance(here.x, here.z, q.x, q.z, wrap) : Math.hypot(q.x - here.x, q.z - here.z)
      if (d < bestDistance) { bestDistance = d; best = candidate }
    }
    return best
  }
  private readonly targetImage = { x: 0, y: 0, z: 0 }
  private readonly peerImage = { x: 0, y: 0, z: 0 }
  /**
   * Where `p` is as seen from `ref`. On a wrapping world that is the nearest of its images,
   * so a target just across the seam is a few metres ahead, not a whole world behind.
   * Elsewhere it is `p` itself.
   */
  private imageOf<T extends { x: number; y: number; z: number }>(p: T, ref: { x: number; z: number }, out = this.targetImage): { x: number; y: number; z: number } {
    const wrap = this.terrain.wrapSize
    if (!wrap) return p
    out.x = nearestImage(p.x, ref.x, wrap); out.y = p.y; out.z = nearestImage(p.z, ref.z, wrap)
    return out
  }

  /** True when a vehicle can drive straight from a to b with two metres to spare each side. */
  /** Liquid on the straight line from a to b, sampled every two metres (short lines only). */
  private liquidBetween(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz)
    for (let t = 2; t < d; t += 2) if (!isSafeGround(this.terrain, a.x + dx / d * t, a.z + dz / d * t)) return true
    return false
  }
  private afloatAt(p: { x: number; z: number }): boolean {
    const liquid = this.terrain.liquidHeightAt?.(p.x, p.z)
    return liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(p.x, p.z) <= liquid + 0.5 && !isRoadFord(this.terrain, p.x, p.z)
  }
  private targetAshore = true
  private clearLine(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz)
    if (d < 1) return true
    const nx = -dz / d * 2, nz = dx / d * 2
    for (let t = 2; t <= Math.min(d, 90); t += 2) {
      const x = a.x + dx / d * t, z = a.z + dz / d * t
      for (const side of [-1, 0, 1]) if (!this.navigator!.passable(x + nx * side, z + nz * side, GROUND_PROFILE)) return false
    }
    return true
  }
  /** Roaming: the mind drives. The brain only watches for the cases that need a rescue. */
  private roam(dt: number, input: InputState, here: { x: number; y: number; z: number }) {
    this.duck.active = false
    const status = this.mind!.step(dt, input)
    const liquid = this.terrain.liquidHeightAt?.(here.x, here.z)
    const afloat = liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(here.x, here.z) <= liquid + 0.5 && !isRoadFord(this.terrain, here.x, here.z)
    // Being over liquid is trouble only for wheels: a hovercraft rides on it and a jet is above it.
    const wheeled = this.vehicle.kind !== 'jet' && this.vehicle.kind !== 'hovercraft'
    // In liquid counts as trouble only while it is trying to drive and getting nowhere: a buggy
    // paddling, or driving along the bed, is fine, and one that stops in water by choice (it
    // sinks, since water-sinks) can drive out again whenever it likes.
    // A buggy that stops in water by choice sinks to the bed and looks stuck: it heads for the
    // nearest dry ground instead, and only then, if it cannot get there, is it in trouble.
    if (afloat && wheeled && Math.abs(input.y) < 0.1 && !this.holdRecovery) {
      const shore = this.shoreNear(here, here)
      if (shore) this.mind!.hold({ x: shore.x, y: here.y, z: shore.z }, 3, 15)
    }
    this.liquidTime = afloat && wheeled && this.slow() && Math.abs(input.y) > 0.1 ? this.liquidTime + dt : 0
    this.flippedTime = status.flipped ? this.flippedTime + dt : 0
    // A rescue holds the bot's own recovery, but never for a bot that is lost.
    if (this.holdRecovery) { if (this.lost(here)) { this.rescue(); this.mind!.reset() } return }
    if (this.liquidTime >= p.recoveryTime.value || this.flippedTime >= p.recoveryTime.value / 2 || this.mind!.troubleFor >= p.recoveryTime.value || this.lost(here)) {
      this.rescue(); this.mind!.reset()
    }
  }
  /**
   * A little feeling, shown with the controls the vehicle already has. Drawn over the
   * pursuit's own commands; the ground probe after this still has the last word.
   *   wiggle  the wheels waggle side to side, standing or trotting
   *   nod     a blip of throttle against the brakes: the nose dips and bobs
   *   spin    a tight happy circle on arrival, only with room all round
   */
  private flourish(kind: 'wiggle' | 'nod' | 'spin', t: number, input: InputState, here: { x: number; z: number }, distance: number) {
    if (kind === 'wiggle') { input.x = Math.sin(this.duckClock * 9) * 0.9; return }
    if (kind === 'nod') { const on = t % 0.4 < 0.15; input.y = on ? 0.8 : 0; input.brakes = !on; return }
    // Room for a spin: the target and every other bot at least a spin's width away.
    if (distance < 9) return
    for (const peer of this.peers) {
      if (peer === this.vehicle || !peer.body.isValid()) continue
      const q = this.imageOf(peer.body.translation(), here, this.peerImage)
      if (Math.hypot(q.x - here.x, q.z - here.z) < 8) return
    }
    input.x = this.index % 2 ? 1 : -1; input.y = 0.55; input.brakes = false
  }
  setTargets(vehicles: readonly Vehicle[]) { this.targets = vehicles; this.targetTime = 2 }
  private selectTarget() {
    // VhiclBot.cs:61 targets the player. VehicleBot.js:14-25 selects nearest, excluding self.
    if (Math.round(p.targetMode.value) === 0) { this.target = this.localPlayer.body.isValid() ? this.localPlayer : null; return }
    const here = this.vehicle.body.translation()
    let distance = Infinity
    this.target = null
    for (const candidate of this.targets) {
      if (candidate === this.vehicle || !candidate.body.isValid()) continue
      const q = candidate.body.translation(), wrap = this.terrain.wrapSize
      const flat = wrap ? wrapDistance(here.x, here.z, q.x, q.z, wrap) : Math.hypot(q.x - here.x, q.z - here.z)
      const d = flat ** 2 + (q.y - here.y) ** 2
      if (d < distance) { distance = d; this.target = candidate }
    }
  }
  /** The nearest safe dry ground to `here`, preferring the side towards `towards`; at most 256 m. */
  private shoreNear(here: { x: number; z: number }, towards: { x: number; z: number }): { x: number; z: number } | null {
    let shore: { x: number; z: number } | null = null
    for (const radius of [8, 16, 32, 64, 128, 256]) {
      let best = Infinity
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8, x = here.x + Math.cos(angle) * radius, z = here.z + Math.sin(angle) * radius
        if (!isSafeGround(this.terrain, x, z)) continue
        // A bank too steep to climb out on only drops the bot back in: gentle ground counts as
        // twice as close.
        const steep = this.terrain.normalAt(x, z, this.shoreNormal).y < 0.85
        const d = Math.hypot(x - towards.x, z - towards.z) * (steep ? 2 : 1) + (steep ? radius : 0)
        if (d < best) { best = d; shore = { x, z } }
      }
      if (shore) return shore
    }
    return shore
  }
  private readonly shoreNormal = new Vector3()
  /** Moving slower over the ground than a buggy paddles or crawls along a bed. */
  private slow(): boolean {
    const v = this.vehicle.body.linvel()
    return Math.hypot(v.x, v.z) < 1.5
  }
  /** Somewhere no tow can reach: below the world, or not a number at all. Recovered at once. */
  private lost(here: { x: number; y: number; z: number }): boolean {
    return !Number.isFinite(here.x) || !Number.isFinite(here.y) || !Number.isFinite(here.z) || here.y < this.terrain.heightAt(here.x, here.z) - 10
  }
  /**
   * Hop back to a landing pad now: the old self-rescue, when a rescue has given up (its line
   * says so). Waiting for the timers instead let the bot be noticed again first, and loop.
   */
  recover(): void { this.rescue(); this.mind?.reset() }
  private rescue() {
    // A hop is for bots only: never move a vehicle a person drives (the owner's rule, AGENTS.md).
    if (this.vehicle.isLocal) return
    if (this.requestRecovery) {
      if (this.requestRecovery()) {
        this.lastPosition.copy(this.vehicle.body.translation()); this.immobileTime = this.liquidTime = this.flippedTime = this.strategyTime = 0
        this.reversing = false; this.routeTime = 0; this.waypoint = null; this.reverseBrake = p.reverseBrakeTime.value; this.rescues++
      }
      return
    }
    for (let i = 0; i < 16; i++) {
      const spawn = this.terrain.spawnPoint(this.index + i + 1)
      if (!isSafeGround(this.terrain, spawn.position.x, spawn.position.z)) continue
      this.vehicle.teleport(spawn.position, spawn.heading)
      this.lastPosition.copy(spawn.position); this.immobileTime = this.liquidTime = this.flippedTime = this.strategyTime = 0
      this.reversing = false; this.routeTime = 0; this.waypoint = null; this.reverseBrake = p.reverseBrakeTime.value; this.rescues++; return
    }
  }
  /**
   * Whether gear may be used now. In the games (bots.gameGear) only with a part in them: on
   * the hill at whoever it is driving off the zone, in tag at "it", or by "it" at its target.
   * In free play, bots.tagBeams governs as before.
   */
  mayUseGear: () => boolean = () => {
    const match = this.match
    if (!match) return p.canFire.value
    if (!gameGear.value || !this.target) return false
    if (match.mode === 'hill') return this.hunting
    return this.hunting || (match.it === this.vehicle && this.target === this.gameTarget)
  }
  fixedUpdate(dt: number) {
    if (this.remote) { this.gear?.cancel(); return }
    this.drive(dt)
    this.gear?.step(dt, this.target, this.vehicle.input, this.mayUseGear(), p.canDrive.value)
  }
  /**
   * The hill in turns. A bot holds the zone for 20 to 35 seconds, then goes elsewhere for 15
   * to 25 (seeded per bot), so bots fight for it without parking in it for good: a person is
   * never stalled indefinitely, and a parked bot can always be pushed. True while contesting.
   */
  private hillSpell(dt: number): boolean {
    this.hillTime -= dt
    if (this.hillTime <= 0) {
      this.hillPhase = this.hillPhase === 'contest' ? 'away' : 'contest'
      const r = this.random()
      this.hillTime = this.hillPhase === 'contest' ? 20 + r * 15 : 15 + r * 10
      if (this.hillPhase === 'away') { this.mind?.reset(); this.moodTime = 0 }
    }
    return this.hillPhase === 'contest'
  }
  /** Nearest other vehicle within `radius` metres, for a bot that is "it" to run from. */
  private nearestWithin(here: { x: number; z: number }, radius: number): Vehicle | null {
    const v = this.nearestOther(here)
    if (!v) return null
    const q = v.body.translation(), wrap = this.terrain.wrapSize
    const d = wrap ? wrapDistance(here.x, here.z, q.x, q.z, wrap) : Math.hypot(q.x - here.x, q.z - here.z)
    return d <= radius ? v : null
  }
  /** Act on the directive. True when it has driven this step; false to carry on as usual. */
  private steerByDirective(dt: number, input: InputState): boolean {
    const d = this.directive!, mind = this.mind!
    const gone = (v: Vehicle) => !v.body.isValid() || v === this.vehicle
    if (('until' in d && this.clock >= d.until) || ((d.kind === 'follow' || d.kind === 'chase') && gone(d.leader)) || (d.kind === 'avoid' && gone(d.threat))) {
      this.directive = this.applied = null; mind.reset(); this.moodTime = 0
      return false
    }
    const fresh = this.applied !== d
    this.applied = d
    const left = 'until' in d ? d.until - this.clock : 0
    const here = this.vehicle.body.translation()
    switch (d.kind) {
      case 'control':
        if (!d.step(dt, input)) { this.directive = this.applied = null; mind.reset(); this.moodTime = 0 }
        return true
      case 'stay':
        input.brakes = true
        return true
      case 'goto':
        if (fresh || mind.activity.kind !== 'hold') mind.hold({ x: d.x, y: d.y, z: d.z }, d.radius, left)
        this.mood = 'roam'; this.roam(dt, input, here)
        return true
      case 'avoid':
        if (fresh || mind.activity.kind !== 'flee') mind.flee(d.threat, left)
        this.mood = 'roam'; this.roam(dt, input, here)
        return true
      case 'chase':
        if (fresh || mind.activity.kind !== 'follow' || mind.activity.leader !== d.leader) mind.pursue(d.leader, left)
        this.mood = 'roam'; this.roam(dt, input, here)
        return true
      case 'follow':
        // The ordinary duckling follow, pointed at this leader rather than the host.
        this.target = d.leader; this.mood = 'chase'; this.moodTime = Math.max(this.moodTime, 1)
        return false
    }
  }
  private drive(dt: number) {
    // Do not even clear input: network playback owns this state.
    if (this.remote) return
    const input = this.vehicle.input
    Object.assign(input, emptyInput())
    this.clock += dt
    this.targetTime += dt; this.fireTime += dt
    // VehicleBot.js:11 refreshes enemies every two seconds; invalid targets refresh immediately.
    if (this.targetTime >= 2 || !this.target?.body.isValid()) { this.selectTarget(); this.targetTime = 0 }
    // A rescue under way (a 'control' directive) outranks a race: a tow is not dropped mid-pull.
    if (this.directive?.kind === 'control' && this.mind && p.canDrive.value && p.topThrottle.value > 0 && this.steerByDirective(dt, input)) return
    if (this.raceGoal && this.mind && p.canDrive.value && p.topThrottle.value > 0) {
      if (this.raceGoal.countdown) { input.brakes = true; return }
      if (!this.racing) { this.mind.hold(this.raceGoal.destination, Math.max(1, this.raceGoal.destination.radius / 2), 125); this.racing = true }
      this.roam(dt, input, this.vehicle.body.translation()); return
    }
    if (this.racing) { this.mind?.reset(); this.racing = false; this.moodTime = 0 }
    if (this.directive && this.mind && p.canDrive.value && p.topThrottle.value > 0 && this.steerByDirective(dt, input)) return
    // A part in a game (BotManager.assignGames): on the hill, someone in the zone to drive off;
    // in tag, whoever is "it", to take the role. Then the target is theirs.
    {
      const m = this.match, g = this.gameTarget
      this.hunting = Boolean(m && g?.body.isValid() && g !== this.vehicle && (m.mode === 'hill' || (m.mode === 'tag' && m.it === g && this.clock >= this.regroupUntil)))
      if (this.hunting) this.target = g
    }
    if (this.mind && p.canDrive.value && p.topThrottle.value > 0) {
      const here = this.vehicle.body.translation(), there = this.target ? this.imageOf(this.target.body.translation(), here) : undefined
      const match = this.match
      if (match?.mode === 'hill' && match.zone) {
        if (this.hunting) {
          // Someone is in the zone: drive at them to ram them off it (the grapple is gear).
          this.mood = 'chase'; this.moodTime = Math.max(this.moodTime, 1)
        } else if (this.mayContest && this.hillSpell(dt)) {
          if (this.mind.activity.kind !== 'hold') this.mind.hold(match.zone, match.zone.radius, 120)
          this.mood = 'roam'; this.roam(dt, input, here); return
        }
      } else if (match?.mode === 'tag' && match.it?.body.isValid()) {
        if (match.it === this.vehicle) {
          // It: run from whoever comes close, catchably (the flee re-plans every two seconds,
          // and a gentler bot runs slower); between threats, keep near someone to score on.
          if (this.gameTarget?.body.isValid()) this.target = this.gameTarget
          const chaser = this.nearestWithin(here, 45)
          if (chaser) {
            if (this.mind.activity.kind !== 'flee' || this.mind.activity.leader !== chaser) this.mind.flee(chaser, 6)
            this.mood = 'roam'; this.roam(dt, input, here)
            input.y *= 0.6 + 0.4 * skill(ramming.value, 'unit')
            return
          }
        } else if (this.hunting) {
          // Someone else is it: go and take the role, cutting them off.
          this.mood = 'chase'; this.moodTime = Math.max(this.moodTime, 1)
        }
      }
      // The older competitive tag below (above RAM_AGGRESSION, or following off) still applies
      // to a bot the games gave no part.
      if (!this.hunting && !this.playful && match?.mode === 'tag' && match.it?.body.isValid()) {
        if (match.it === this.vehicle) {
          // It: hunt whoever is nearest, relentlessly, until someone else is it.
          this.mood = 'chase'; this.moodTime = Math.max(this.moodTime, 1); this.target = this.nearestOther(here) ?? this.target
        } else {
          const t = match.it.body.translation(), wrap = this.terrain.wrapSize
          const gap = wrap ? wrapDistance(here.x, here.z, t.x, t.z, wrap) : Math.hypot(t.x - here.x, t.z - here.z)
          if (gap < 70 || this.mind.activity.kind === 'flee') {
            if (this.mind.activity.kind !== 'flee') this.mind.flee(match.it, 10)
            this.mood = 'roam'; this.roam(dt, input, here); return
          }
        }
      }
      this.moodTime -= dt
      if (this.moodTime <= 0) this.chooseMood(there ? Math.hypot(there.x - here.x, there.z - here.z) : Infinity)
      // The original pursuit below steers wheels. A hovercraft or a jet chases through its
      // mind instead: it tails the target with its own pilot.
      const wheeled = this.vehicle.kind !== 'jet' && this.vehicle.kind !== 'hovercraft'
      if (!wheeled && this.mood === 'chase' && this.target && (this.mind.activity.leader !== this.target || this.mind.activity.kind !== 'follow')) this.mind.pursue(this.target, Math.max(this.moodTime, this.hunting ? 5 : 0), this.hunting)
      if (this.mood === 'roam' || !this.target || !wheeled) { this.roam(dt, input, here); return }
    }
    if (!this.target) return
    const here = this.vehicle.body.translation(), there = this.imageOf(this.target.body.translation(), here)
    this.quaternion.copy(this.vehicle.body.rotation())
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion)
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion)
    const dx = there.x - here.x, dz = there.z - here.z, distance = Math.hypot(dx, dz)
    const velocity = this.vehicle.body.linvel(), speed = Math.hypot(velocity.x, velocity.z)
    // Outside races, a playful bot trails its target like a duckling. Being tagged
    // does not silently change the player's following choice.
    const ducking = this.mind !== null && this.playful && !this.hunting && !this.raceGoal && p.canDrive.value
    if (ducking) this.duck.follow(this.target)
    this.duck.active = ducking
    const step = ducking ? this.duck.step(dt, here, there, p.playfulness.value, (x, z) => this.standable(x, z)) : null
    // On a road the duckling steers as the pursuit does: the road waypoints are tuned for
    // switchbacks and banks. The duck then only sets its speed, which is what keeps the line.
    // Off road it heads for its place on the leader's track (the pursuit would aim ahead of
    // a moving leader); gathering and giving way are always the duck's.
    const duck = step && (step.mode !== 'line' || !this.waypoint) ? step : null
    this.duckClock += dt
    // The pursuit below drives straight at the target. When a cliff or liquid lies on that
    // line and no road leads there, the mind takes the detour: it follows a planned route
    // with the same pilot that tours the island, then hands back once the way is clear.
    if (this.mind && this.navigator && p.canDrive.value && p.topThrottle.value > 0) {
      this.lineTime -= dt
      if (this.lineTime <= 0) {
        // A target where wheels cannot go (in lava or water, on a cliff) is not followed in: the
        // bot waits on the shore nearest it, and the chase picks up once it is back on land.
        // Close in, the straight line is still checked for liquid (a bank, a lava tongue).
        this.targetAshore = this.standable(there.x, there.z)
        this.lineClear = this.targetAshore && (distance < 18 ? !this.liquidBetween(here, there) : this.clearLine(here, there))
        this.lineTime = 0.5
        if (!this.targetAshore && !this.afloatAt(here)) {
          const shore = this.shoreNear(there, here)
          if (shore) {
            // Wait a few metres back from the edge, not on it: a holding bot drifts.
            const ax = shore.x - there.x, az = shore.z - there.z, l = Math.hypot(ax, az) || 1
            const bx = shore.x + ax / l * 6, bz = shore.z + az / l * 6
            const back = this.standable(bx, bz), wx = back ? bx : shore.x, wz = back ? bz : shore.z
            // Re-planned only when the waiting place moves: a fresh hold drops the route.
            const d = this.mind.activity.kind === 'hold' ? this.mind.activity.destination : null
            if (!d || Math.hypot(d.x - wx, d.z - wz) > 3) this.mind.hold({ x: wx, y: here.y, z: wz }, 4, 30)
          }
        }
      }
      if (!this.targetAshore) { this.roam(dt, input, here); return }
      if (!this.lineClear && !this.waypoint) {
        if (this.mind.activity.leader !== this.target || this.mind.activity.kind !== 'follow') this.mind.pursue(this.target, 30, this.hunting)
        this.roam(dt, input, here); return
      }
    }
    const targetVelocity = this.target.body.linvel()
    const lead = Math.min(0.8, distance / 45) * p.aggression.value
    let aimX = duck ? duck.x : there.x + targetVelocity.x * lead, aimZ = duck ? duck.z : there.z + targetVelocity.z * lead
    if (this.hunting) {
      // Cut them off: head for where we can meet, at the speed this bot can make, blended from
      // where they are by the interception skill; a second pursuer takes the other flank.
      const reach = Math.max(speed, p.cornerSpeed.value)
      const meet = interceptPoint(here, reach, there, targetVelocity, skill(interceptSkill.value, 'unit'))
      const side = pincerOffset(this.gameSlot, this.gameOf, distance)
      const tx = meet.x - here.x, tz = meet.z - here.z, tl = Math.hypot(tx, tz) || 1
      aimX = meet.x + tz / tl * side; aimZ = meet.z - tx / tl * side
    }
    const liquid = this.terrain.liquidHeightAt?.(here.x, here.z)
    const afloat = liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(here.x, here.z) <= liquid + 0.5 && !isRoadFord(this.terrain, here.x, here.z)
    // Chasing, a bot in liquid always heads for the shore (below): trouble only while slow.
    this.liquidTime = afloat && p.canDrive.value && this.slow() ? this.liquidTime + dt : 0
    if (afloat) {
      // Bots try to crawl toward dry ground before requesting a return to their pad.
      const shore = this.shoreNear(here, there)
      if (shore) { aimX = shore.x; aimZ = shore.z }
    }
    this.routeTime -= dt
    if (this.routeTime <= 0) {
      // Roads are given inside the tile; on a wrapping world this bot may be at an image
      // outside it. Ask in tile coordinates, then bring the answer back beside the bot.
      const w = this.terrain.wrapSize
      const from = w ? { x: wrapCoord(here.x, w), y: here.y, z: wrapCoord(here.z, w) } : here
      const to = w ? { x: wrapCoord(there.x, w), y: there.y, z: wrapCoord(there.z, w) } : there
      const found = !afloat && distance > 4 ? roadWaypoint(this.terrain, from, to, Math.max(8, Math.min(16, speed * 0.6))) : null
      this.waypoint = found && w ? { ...found, x: nearestImage(found.x, here.x, w), z: nearestImage(found.z, here.z, w) } : found
      this.routeTime = 0.4
    }
    // A duckling keeps to the target's own track, which is already the way the target drove.
    const waypoint = !duck && !afloat && distance > 4 ? this.waypoint : null
    if (waypoint) { aimX = waypoint.x; aimZ = waypoint.z }
    // Stable per-bot lateral offsets fade out near contact so every bot can still ram.
    const spread = this.hunting ? 0 : ((this.index * 0.61803398875 % 1) - 0.5) * p.approachSpread.value * Math.min(1, Math.max(0, distance - 8) / 20)
    if (!duck && !afloat && distance > 0.1) {
      const ax = aimX - here.x, az = aimZ - here.z, length = Math.hypot(ax, az) || 1
      const offset = waypoint ? Math.max(-1, Math.min(1, spread)) : spread
      aimX += az / length * offset; aimZ -= ax / length * offset
    }
    // Repel nearby allies, never the selected target. This prevents a single-file pileup.
    for (const peer of this.peers) {
      if (peer === this.vehicle || peer === this.target || !peer.body.isValid()) continue
      const pos = this.imageOf(peer.body.translation(), here, this.peerImage), px = here.x - pos.x, pz = here.z - pos.z, separation = Math.hypot(px, pz)
      if (separation > 0.1 && separation < 7) { aimX += px / separation * (7 - separation) * (waypoint ? 0.25 : 2); aimZ += pz / separation * (7 - separation) * (waypoint ? 0.25 : 2) }
    }
    // On a road, queue behind traffic instead of steering around it toward the edge.
    // Include the pursued player: catching a slow leader is not permission to ram on a bend.
    let trafficLimit = Infinity
    const roadAhead = (aimX - here.x) * this.forward.x + (aimZ - here.z) * this.forward.z
    if (waypoint && roadAhead > Math.hypot(aimX - here.x, aimZ - here.z) * 0.8) for (const peer of new Set(this.hunting ? this.peers : [...this.peers, this.target])) {
      if (peer === this.vehicle || !peer.body.isValid()) continue
      const pos = this.imageOf(peer.body.translation(), here, this.peerImage)
      const px = pos.x - here.x, pz = pos.z - here.z
      const ahead = px * this.forward.x + pz * this.forward.z
      const side = Math.abs(px * this.forward.z - pz * this.forward.x)
      if (ahead <= 3 || ahead > 25 || side > 4 || Math.abs(pos.y - here.y) > 6) continue
      const v = peer.body.linvel(), along = Math.max(0, v.x * this.forward.x + v.z * this.forward.z)
      trafficLimit = Math.min(trafficLimit, Math.max(0, along + (ahead - 6 - speed * 0.7) * 0.8))
    }
    // Playful by default: below RAM_AGGRESSION the chase ends a little way short of the
    // target, closing no faster than it pulls away plus a margin that shrinks to nothing at
    // KEEP_GAP, so a bot catches up, matches speed and waits rather than ramming. In tag a
    // bot that is "it" must touch to pass it on: it may close all the way, but only at a
    // tap's speed. The limit rides on the traffic brake below, which also stops a bot
    // waiting politely from counting as stuck.
    // Getting out of a reversing target's way is the one time the gap must not hold a bot back.
    // Only while heading toward it: a bot moving off to a place farther away is not closing.
    const toward = (aimX - here.x) * dx + (aimZ - here.z) * dz > 0
    if (this.hunting && distance > 0.1 && toward) {
      // In a game contact is the point: close as fast as the ramming skill commits to, from a
      // firm nudge (about 3 m/s faster than the target) to a full-speed hit.
      const away = (targetVelocity.x * dx + targetVelocity.z * dz) / distance
      const commit = skill(ramming.value, 'unit')
      trafficLimit = Math.min(trafficLimit, Math.max(0, away + 3 + commit * 14 + Math.max(0, distance - 12) * 0.8))
    } else if (p.aggression.value <= p.RAM_AGGRESSION && distance > 0.1 && duck?.mode !== 'give-way' && toward) {
      const tagging = this.match?.mode === 'tag' && this.match.it === this.vehicle
      const away = (targetVelocity.x * dx + targetVelocity.z * dz) / distance
      const allowed = tagging ? away + Math.max(TAP_SPEED, (distance - KEEP_GAP) * 0.8) : away + (distance - KEEP_GAP) * 0.8
      trafficLimit = Math.min(trafficLimit, Math.max(0, allowed))
    }
    if (step) trafficLimit = Math.min(trafficLimit, step.limit)
    const error = steeringError(this.forward, { x: aimX - here.x, z: aimZ - here.z })
    // VhiclBot.cs:35-55 and VehicleBot.js:79-91: wrap yaw, divide by 20 degrees,
    // 2 degree dead zone, full steering within 15 metres, 0.6 clamp farther away.
    const rotation = error / (20 * Math.PI / 180)
    if (p.canDrive.value && p.topThrottle.value > 0 && p.aggression.value > 0) {
      this.strategyTime += dt
      this.flippedTime = this.up.y < 0.2 ? this.flippedTime + dt : 0
      if (this.strategyTime >= p.strategyInterval.value) {
        // VhiclBot.cs:63-74 switches to reverse when movement is below one metre.
        const moved = this.lastPosition.distanceTo(here)
        const wasReversing = this.reversing
        this.reversing = moved < p.stuckDistance.value
        if (this.reversing && !wasReversing) this.reverseBrake = p.reverseBrakeTime.value
        this.immobileTime = this.reversing ? this.immobileTime + this.strategyTime : 0
        this.strategyTime = 0; this.lastPosition.copy(here)
      }
      // A duckling facing its target backs away rather than turning in front of it: when the
      // target reverses towards it (swinging aside on full lock to the open side), and when it
      // has ended up closer than the gathering arc after a stop (straight back). Facing away,
      // it simply drives to its place.
      const facing = dx * this.forward.x + dz * this.forward.z > 0
      const backing = duck !== null && !afloat && facing && (duck.mode === 'give-way' || (duck.mode === 'gather' && distance < GATHER_RADIUS - 3))
      if (backing) { this.reversing = true; this.reverseBrake = 0 } else if (this.backing) this.reversing = false
      this.backing = backing
      if (afloat || trafficLimit < 1) {
        this.reversing = false
        if (!afloat) { this.immobileTime = 0; this.strategyTime = 0; this.lastPosition.copy(here) }
      }
      const gain = this.hunting ? Math.max(1, p.aggression.value) : p.aggression.value
      input.x = this.reversing ? clamp(-rotation) : Math.abs(rotation) < 0.1 ? 0 : clamp(rotation * gain, waypoint || distance < 15 ? 1 : 0.6)
      if (waypoint && !this.reversing) {
        // Four-wheel steering needs a gentle curvature command on narrow roads.
        // Full original pursuit lock makes the buggy circle an eight-metre waypoint.
        const look = Math.max(8, Math.hypot(aimX - here.x, aimZ - here.z))
        input.x = Math.abs(error) > Math.PI / 2 ? Math.sign(error) * 0.6 : clamp(6 * Math.sin(error) / look, 0.6)
      }
      input.y = (this.hunting ? 1 : Math.min(1, p.aggression.value)) * p.topThrottle.value * (this.reversing ? -1 : 1)
      // Keep enough throttle to turn, but shed speed before a tight corner.
      if (!this.reversing && Math.abs(error) > 0.6 && speed > p.cornerSpeed.value) {
        input.y *= 0.25; input.brakes = speed > p.cornerSpeed.value * 1.5
      }
      const roadLimit = Math.max(p.roadCornerSpeed.value, p.roadSpeed.value * (1 - Math.min(1, Math.abs(error))))
      if (waypoint && !this.reversing && speed > roadLimit) {
        input.y = Math.min(input.y, 0.15); input.brakes ||= speed > roadLimit * 1.2
      }
      if (trafficLimit < Infinity && !this.reversing && speed > trafficLimit) {
        input.y = 0; input.brakes ||= speed > trafficLimit + 0.5
      }
      // Told to wait: hold still on the brakes rather than creep forward and brake by turns.
      if (trafficLimit < 0.3 && !this.reversing) { input.y = 0; input.brakes = true }
      if (duck?.flourish && !this.reversing && !afloat) this.flourish(duck.flourish, duck.flourishTime, input, here, distance)
      // Stop spinning wheels before asking the drivetrain to reverse.
      if (this.reverseBrake > 0) { input.brakes = true; this.reverseBrake = Math.max(0, this.reverseBrake - dt) }
      if (this.backing) {
        // Reversing on full lock swings the tail toward the side the wheel is turned: the
        // driver's right for +1. Steer toward the side the place to go lies on.
        const giveWay = duck!.mode === 'give-way', rx = -this.forward.z, rz = this.forward.x
        input.brakes = false; input.y = -p.topThrottle.value * (giveWay ? 1 : 0.5)
        input.x = giveWay ? ((duck!.x - here.x) * rx + (duck!.z - here.z) * rz >= 0 ? 1 : -1) : 0
      }
      // Probe the intended travel direction. Reverse and steer away from water or world edges.
      const direction = this.reversing ? -1 : 1
      // Far enough ahead to stop in: reaction distance, or braking distance at about 7 m/s^2.
      // Far enough ahead to stop in off road; on a road the bends make a long probe see
      // the bank it is about to turn away from.
      const lookAhead = waypoint ? Math.max(4, Math.min(16, speed * 0.7)) : Math.max(4, Math.min(45, Math.max(speed * 0.7, speed * speed / 14)))
      const probeX = here.x + this.forward.x * direction * lookAhead, probeZ = here.z + this.forward.z * direction * lookAhead
      // On a road the bank beside a bend is steep but the road is fine, so the cliff check
      // applies only off road; the liquid and world edge check applies everywhere.
      const cliff = !waypoint && this.navigator !== null && !this.navigator.passable(probeX, probeZ, GROUND_PROFILE)
      if (!afloat && (cliff || !isSafeGround(this.terrain, probeX, probeZ))) {
        input.y = -direction * p.topThrottle.value * 0.5
        input.x = (this.index % 2 ? -1 : 1) * -direction
      }
      // Whatever the pursuit asked for, the wheel gets there at the rate hands can move it:
      // quick when crawling, slower at speed. The original snapped lock to lock every step.
      const rate = (speed < 20 ? 3.6 - speed * 0.09 : 1.8) * dt
      this.steer += Math.max(-rate, Math.min(rate, input.x - this.steer)); input.x = this.steer
      if (this.lost(here) || (!this.holdRecovery && (this.liquidTime >= p.recoveryTime.value || this.immobileTime >= p.recoveryTime.value || this.flippedTime >= p.recoveryTime.value / 2))) this.rescue()
    } else {
      // VehicleBot.js:118-120 disables driving. Pausing must not trigger a rescue.
      input.brakes = true; this.strategyTime = this.immobileTime = this.liquidTime = this.flippedTime = 0; this.lastPosition.copy(here)
    }
    // VehicleBot.js:124-126 fires once per second if terrain does not block the target.
    // Weapons consume input.fire; this controller never spawns projectiles itself.
    if (p.canFire.value && this.fireTime >= p.fireInterval.value) {
      const delta = new Vector3(dx, there.y - here.y, dz), length = delta.length()
      if (length > 0.01) {
        delta.multiplyScalar(1 / length)
        const hit = this.game.world.castRay(new RAPIER.Ray(here, delta), length, true, undefined, groups(GROUP_PROJECTILE, GROUP_TERRAIN))
        if (!hit) { input.fire = true; this.fireTime = 0 }
      }
    }
  }
}

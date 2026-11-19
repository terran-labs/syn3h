/**
 * The mind of a self-driving vehicle: it decides what to do next and where, and asks a pilot
 * to get there. It has no opinion about which vehicle it drives.
 *
 * Every few seconds to a minute it picks an activity, weighted by its personality: take a
 * road somewhere, climb to the summit, strike out for ground it has not seen, tail another
 * vehicle, or show off. While driving it checks the ground ahead and steers round water,
 * cliffs and the world edge. When it stops making progress it gives up on that place and
 * picks another; it never teleports, so it is safe to put in charge of a player's vehicle.
 */
import { Quaternion, Vector3 } from 'three/webgpu'
import type { InputState } from '../../core/Input'
import type { Vehicle } from '../../vehicles/Vehicle'
import { isSafeGround, type BotTerrain } from '../BotBrain'
import { roadPaths, roadWaypoint } from '../navigation'
import { jetForwardFlight, roadSpeed } from '../params'
import type { DriveGoal, Navigator, NavPoint, Pilot, PilotStatus, Route } from '../pilot/types'
import { planningBudget, type PlanningBudget } from '../nav/budget'
import { hashString, seededRandom } from '../random'
import { nearestImage, wrapDistance } from '../../../shared/wrap'
import { type Personality, personalityFor } from './personality'

export type ActivityKind = 'road' | 'summit' | 'explore' | 'follow' | 'donut' | 'weave' | 'pause' | 'retreat' | 'visit' | 'flee' | 'hold'

export interface Activity {
  kind: ActivityKind
  /** Where it is going, when the activity has a place. */
  destination: NavPoint | null
  /** The vehicle being tailed, for 'follow'. */
  leader: Vehicle | null
  /** Mind time at which it gives up or finishes, seconds. */
  until: number
}

export interface Place extends NavPoint { kind: string; name?: string }

/** How a visit to each kind of place reads on screen. */
const SIGHTS: Record<string, string> = {
  peak: 'climbing to a lookout', vent: 'going to see the fire', shore: 'heading for the shore',
  spawn: 'dropping by a landing pad', 'road-end': 'seeing where the road ends',
}

export interface MindOptions {
  /** Seeds the personality and every choice. Same seed, same terrain, same start: same drive. */
  seed: string
  personality?: Personality
  /** Route planner for open ground. Without one it follows roads and steers by sight. */
  navigator?: Navigator
  /**
   * Places worth a visit: peaks, vents, shores, pads. Read fresh each time it chooses, so a
   * regenerated world is picked up. See `pointsOfInterest` in nav/explore.ts.
   */
  places?: () => readonly Place[]
  /** Other vehicles it may tail. Read fresh each time it chooses. */
  others?: () => readonly Vehicle[]
}

/** What the vehicle is up to, for a label on screen. */
const CAPTIONS: Record<ActivityKind, string> = {
  road: 'cruising the road', summit: 'heading for the summit', explore: 'exploring', follow: 'tagging along',
  donut: 'doing donuts', weave: 'carving', pause: 'taking in the view', retreat: 'finding another way', visit: 'sightseeing',
  flee: 'making a run for it', hold: 'holding the hill',
}

const VISIT_CELL = 64
/** Candidate headings relative to the wanted one, nearest first, radians. */
const SWERVES = [0, 0.3, -0.3, 0.6, -0.6, 1, -1, 1.5, -1.5]

/** A reachability test: the route it found (null without a navigator), or null when unreachable. */
type Reach = { route: Route | null } | null

export class Mind {
  readonly personality: Personality
  activity: Activity = { kind: 'pause', destination: null, leader: null, until: 0 }
  /** Seconds the way ahead has been blocked or the pilot stuck. The owner may rescue on this. */
  troubleFor = 0
  /** Places abandoned as unreachable since the last reset, for tests and tuning. */
  abandoned = 0
  private time = 0
  private readonly random: () => number
  private readonly visits = new Map<number, number>()
  private route: Route | null = null
  private routeIndex = 0
  private routeTime = 0
  private waypoint: NavPoint | null = null
  private waypointTime = 0
  private swerveSide = 1
  private lastKind: ActivityKind = 'pause'
  private bestDistance = Infinity
  private leaderIdle = 0
  private readonly slide: NavPoint = { x: 0, z: 0 }
  private fleeTime = 0
  private holdRadius = 10
  private lastX = NaN
  private lastZ = NaN
  private sight: Place | null = null
  /** Where it has been, one point every few metres, newest last: the proven way back out. */
  private readonly trail: NavPoint[] = []
  private bestTime = 0
  private readonly goal: DriveGoal = { x: 0, z: 0, speed: 0 }
  private readonly q = new Quaternion()
  private readonly forward = new Vector3()
  private readonly normal = new Vector3()
  private readonly idle: PilotStatus = { stuckFor: 0, airborne: false, flipped: false }
  /**
   * Route searches are rationed across every mind on the navigator (see nav/budget.ts). A
   * choice that has to test more places than this step allows is resumed next step: this
   * holds it, and the old activity carries on meanwhile.
   */
  private readonly budget: PlanningBudget | null
  private deciding: Generator<void, void, void> | null = null

  constructor(
    readonly vehicle: Vehicle,
    private readonly terrain: BotTerrain,
    private readonly pilot: Pilot,
    private readonly options: MindOptions,
  ) {
    this.personality = options.personality ?? personalityFor(options.seed)
    this.random = seededRandom(hashString(`mind:${options.seed}`))
    this.budget = options.navigator ? planningBudget(options.navigator) : null
  }

  /** A short phrase for what it is doing now. */
  get caption(): string {
    const name = this.activity.kind === 'follow' ? this.activity.leader?.name : ''
    if (this.activity.kind === 'visit' && this.sight) return SIGHTS[this.sight.kind] ?? CAPTIONS.visit
    return name ? `following ${name}` : CAPTIONS[this.activity.kind]
  }

  /** The kind of place it is visiting ('vent', 'peak', 'shore'...), or null. */
  get sightKind(): string | null {
    return this.activity.kind === 'visit' ? this.sight?.kind ?? null : null
  }

  /** Share of the map's coarse cells this mind has driven through, 0..1. */
  get explored(): number {
    const side = Math.ceil(this.terrain.size / VISIT_CELL)
    return this.visits.size / (side * side)
  }

  /**
   * Go after one vehicle for a while: how a bot that cannot ram still joins the chase. With
   * `contact` (a game: taking "it", driving someone off the hill) it heads for the vehicle
   * itself, leading it, at full speed, and keeps on when it stops.
   */
  pursue(leader: Vehicle, seconds: number, contact = false): void {
    this.clearPlan(); this.begin('follow', null, leader, seconds); this.contact = contact
  }
  /** The current pursuit is for contact (see `pursue`). */
  private contact = false

  /** Get away from one vehicle for a while: what a bot does when whoever is "it" comes close. */
  flee(threat: Vehicle, seconds: number): void {
    this.clearPlan(); this.begin('flee', null, threat, seconds); this.fleeTime = 0
  }

  /** Go to a place and stay inside it: King of the Hill. */
  hold(place: NavPoint, radius: number, seconds: number): void {
    this.clearPlan(); this.begin('hold', { x: place.x, z: place.z, y: place.y }, null, seconds); this.holdRadius = radius
  }

  /** Forget the current plan: after a teleport, a regenerated world, or a handover. */
  reset(): void {
    this.activity = { kind: 'pause', destination: null, leader: null, until: 0 }
    this.route = null; this.waypoint = null; this.troubleFor = 0; this.bestDistance = Infinity; this.deciding = null
    this.pilot.reset()
  }

  /** One physics step: decide, then write the controls into `input`. */
  step(dt: number, input: InputState): PilotStatus {
    const body = this.vehicle.body
    if (!body.isValid()) return this.idle
    this.time += dt
    this.budget?.enter(this)
    const here = body.translation(), v = body.linvel(), speed = Math.hypot(v.x, v.z)
    this.q.copy(body.rotation()); this.forward.set(0, 0, -1).applyQuaternion(this.q)
    // A jump in one step is a teleport. Across the seam of a wrapping world it is a whole
    // tile, and the plan is still good once it is moved the same way; otherwise start afresh.
    const jx = here.x - this.lastX, jz = here.z - this.lastZ
    if (Number.isFinite(jx) && Math.hypot(jx, jz) > 30) {
      const wrap = this.terrain.wrapSize
      const sx = wrap ? Math.round(jx / wrap) * wrap : 0, sz = wrap ? Math.round(jz / wrap) * wrap : 0
      if ((sx || sz) && Math.hypot(jx - sx, jz - sz) < 30) this.shiftPlan(sx, sz)
      else this.reset()
    }
    this.lastX = here.x; this.lastZ = here.z
    const cell = this.cellOf(here.x, here.z)
    this.visits.set(cell, (this.visits.get(cell) ?? 0) + dt)
    const crumb = this.trail[this.trail.length - 1]
    if (!crumb || Math.hypot(crumb.x - here.x, crumb.z - here.z) > 8) { this.trail.push({ x: here.x, z: here.z }); if (this.trail.length > 48) this.trail.shift() }

    const a = this.activity
    if (a.kind === 'follow' && !a.leader?.body.isValid()) {
      // Expiring the plan alone still reaches the follow read below in this step.
      a.until = 0; a.leader = null
    }
    if (a.kind === 'follow' && a.leader) {
      // Sit a few lengths behind the leader, on a side that is stable for this driver.
      // On a wrapping world, tail the nearest image of the leader: it may be just over the seam.
      const raw = a.leader.body.translation(), wrap = this.terrain.wrapSize
      const p = wrap ? { x: nearestImage(raw.x, here.x, wrap), z: nearestImage(raw.z, here.z, wrap) } : raw
      const lv = a.leader.body.linvel(), ls = Math.hypot(lv.x, lv.z) || 1
      const side = this.personality.mischief > 0.5 ? 4 : -4
      if (this.contact) {
        // For contact: where it will be a moment from now, not a few lengths behind it.
        const lead = Math.min(1.2, Math.hypot(p.x - here.x, p.z - here.z) / 20)
        a.destination = { x: p.x + lv.x * lead, z: p.z + lv.z * lead }
      } else a.destination = { x: p.x - lv.x / ls * 9 + lv.z / ls * side, z: p.z - lv.z / ls * 9 - lv.x / ls * side }
      // A leader that has stopped is no longer leading anywhere (unless the point is to reach it).
      this.leaderIdle = !this.contact && Math.hypot(lv.x, lv.z) < 1.5 ? this.leaderIdle + dt : 0
      if (this.leaderIdle > 4) a.until = 0
    }
    if (a.kind === 'flee') {
      // Every couple of seconds, pick somewhere it can stand that puts distance between
      // them: straight away from the threat if that is drivable, else off to one side.
      this.fleeTime -= dt
      if (!a.leader?.body.isValid()) a.until = 0
      else if (this.fleeTime <= 0 || !a.destination) {
        this.fleeTime = 2
        const t = a.leader.body.translation(), away = Math.atan2(here.z - t.z, here.x - t.x)
        a.destination = null
        for (const turn of [0, 0.7, -0.7, 1.4, -1.4]) {
          const x = here.x + Math.cos(away + turn) * 110, z = here.z + Math.sin(away + turn) * 110
          if (this.standable(x, z)) { a.destination = { x, z }; break }
        }
        this.route = null; this.bestDistance = Infinity; this.bestTime = this.time
        if (!a.destination || Math.hypot(t.x - here.x, t.z - here.z) > 160) a.until = 0
      }
    }
    const destination = a.destination
    const distance = destination ? Math.hypot(destination.x - here.x, destination.z - here.z) : Infinity
    // A shore is admired from a little way back, not from the waterline.
    const near = a.kind === 'visit' && this.sight?.kind === 'shore' ? 28 : 10
    const arrived = destination !== null && a.kind !== 'follow' && a.kind !== 'hold' && a.kind !== 'flee' && distance < near
    // Give up on a place it has stopped getting closer to: 12 seconds without gaining 5 m.
    if (destination && a.kind !== 'follow' && a.kind !== 'hold' && a.kind !== 'flee' && !this.deciding) {
      if (distance < this.bestDistance - 5) { this.bestDistance = distance; this.bestTime = this.time }
      else if (this.time - this.bestTime > 12) { this.abandoned++; a.until = 0 }
    }
    if (this.deciding || this.time >= a.until || arrived || this.troubleFor > 6) {
      if (!this.deciding) {
        const trouble = this.troubleFor > 6
        if (trouble) this.abandoned++
        // In trouble, do not pick another place from the same bad spot: first go back the way
        // it came, which is ground it has already driven, and choose again from there.
        const back = trouble && a.kind !== 'retreat' ? this.wayBack(here) : null
        if (back) { this.clearPlan(); this.begin('retreat', back, null, 10) }
        else this.deciding = this.choose(here, speed, arrived)
      }
      // Usually done at once; when the planning budget is spent, resumed on a later step.
      if (this.deciding?.next().done) this.deciding = null
    }

    const goal = this.goal
    goal.special = false; goal.stopWithin = undefined; goal.altitude = undefined
    // What is behind matters to a pilot that backs out of trouble: look two lengths back and
    // one, and forbid reversing onto anything this vehicle cannot stand on.
    const flatF = Math.hypot(this.forward.x, this.forward.z) || 1, bx = -this.forward.x / flatF, bz = -this.forward.z / flatF
    goal.noReverse = !this.pilot.profile.flies && (!this.standable(here.x + bx * 5, here.z + bz * 5) || !this.standable(here.x + bx * 10, here.z + bz * 10))
    const act = this.activity
    if (act.kind === 'pause') {
      goal.x = here.x + this.forward.x * 10; goal.z = here.z + this.forward.z * 10; goal.speed = 0; goal.stopWithin = 1e6
    } else if (act.kind === 'donut') {
      // A point always off to one side is a circle; full lock and a steady speed do the rest.
      goal.x = here.x + this.forward.x * 2 - this.forward.z * 6 * this.swerveSide
      goal.z = here.z + this.forward.z * 2 + this.forward.x * 6 * this.swerveSide
      goal.speed = 9
      // A donut drifts. If it has wandered to within a few lengths of anything it cannot
      // stand on, that is the end of the show.
      for (let i = 0; i < 6; i++) if (!this.standable(here.x + Math.cos(i * Math.PI / 3) * 12, here.z + Math.sin(i * Math.PI / 3) * 12)) { act.until = 0; break }
    } else {
      // A follow chosen this step has no offset point yet: aim at the leader itself for now.
      const target = act.destination ?? act.leader?.body.translation() ?? here
      this.aimFor(here, target, speed, dt)
      let aimX = this.waypoint?.x ?? target.x, aimZ = this.waypoint?.z ?? target.z
      if (act.kind === 'weave') {
        const dx = aimX - here.x, dz = aimZ - here.z, d = Math.hypot(dx, dz) || 1, swing = Math.sin(this.time * 1.6) * 7
        aimX += dz / d * swing; aimZ -= dx / d * swing
      }
      goal.speed = this.cruiseSpeed(act, distance)
      const clear = act.kind === 'retreat' ? { x: aimX, z: aimZ, swerved: true } : this.steerClear(here, aimX, aimZ, speed)
      if (clear) { goal.x = clear.x; goal.z = clear.z; if (clear.swerved) goal.speed = Math.min(goal.speed, 7) }
      else {
        // Nothing ahead is drivable: stop, let the pilot back out, and count the trouble.
        goal.x = here.x - this.forward.x * 10; goal.z = here.z - this.forward.z * 10; goal.speed = 4
      }
      this.troubleFor = clear ? Math.max(0, this.troubleFor - dt) : this.troubleFor + dt
      if (act.kind === 'follow' && distance < 6) { goal.stopWithin = 6; goal.x = target.x; goal.z = target.z }
      // On the hill: stop well inside the zone and stay, rather than circling its centre.
      if (act.kind === 'hold' && distance < this.holdRadius * 0.6) { goal.stopWithin = this.holdRadius * 0.6; goal.x = target.x; goal.z = target.z }
      if (act.kind === 'flee') goal.speed = Math.max(goal.speed, 16)
    }
    if (this.pilot.profile.flies && act.kind !== 'pause') {
      // An aircraft must be above the ground ahead before it gets there. Look along the way
      // it is going: hold a height that clears the highest ground within reach, and slow
      // down in proportion to how fast that ground rises, because it can only climb so quickly.
      const dx = goal.x - here.x, dz = goal.z - here.z, d = Math.hypot(dx, dz) || 1, base = this.surface(here.x, here.z)
      let top = base, grade = 0
      for (const reach of [12, 25, 45, 70]) {
        const h = this.surface(here.x + dx / d * reach, here.z + dz / d * reach)
        top = Math.max(top, h); grade = Math.max(grade, (h - base) / reach)
      }
      // Enough to clear a steep cone ahead. Towers are kept out of it by never being a destination and by the wall check.
      goal.altitude = this.pilot.profile.cruiseAltitude + Math.min(60, top - base)
      if (grade > 0.2) goal.speed = Math.max(3, Math.min(goal.speed, 3 / grade))
    }
    // Wings for a long straight leg, where the pilot has them and the owner allows it.
    if (this.pilot.profile.flies && jetForwardFlight.value && destination && distance > 400 && act.kind !== 'follow' && act.kind !== 'pause') {
      // The ordinary route aim is only 10 to 30 metres away. Passing that to the jet
      // permanently selected its arrival/hover mode, even with forward flight enabled.
      // Offer a long aim only when the whole corridor is clear and the nose is aligned.
      const dx = destination.x - here.x, dz = destination.z - here.z, d = Math.hypot(dx, dz) || 1
      const reach = Math.min(d, 260), x = here.x + dx / d * reach, z = here.z + dz / d * reach
      const aligned = (this.forward.x * dx + this.forward.z * dz) / d > 0.85
      if (aligned && this.crossable(here.x, here.z, x, z)) {
        goal.x = x; goal.z = z; goal.altitude = Math.max(30, goal.altitude ?? 0); goal.special = true
      }
    }
    const status = this.pilot.drive(goal, input, dt)
    if (status.stuckFor > 3 || status.flipped) this.troubleFor += dt
    return status
  }

  // ---- choosing what to do -----------------------------------------------------------

  private shiftPlan(dx: number, dz: number): void {
    const moved = new Set<NavPoint>()
    const move = (p: NavPoint | null | undefined) => { if (p && !moved.has(p)) { moved.add(p); p.x += dx; p.z += dz } }
    // Destinations may be shared objects (a road point, a place of interest): move a copy.
    if (this.activity.destination) this.activity.destination = { ...this.activity.destination, x: this.activity.destination.x + dx, z: this.activity.destination.z + dz }
    for (const p of this.trail) move(p)
    // Routes and road waypoints are asked for again rather than moved: they are cheap. A
    // choice still being made weighed places in the old frame: make it again.
    this.route = null; this.waypoint = null; this.waypointTime = 0; this.deciding = null
  }

  private clearPlan(): void {
    this.deciding = null; this.route = null; this.waypoint = null; this.troubleFor = 0; this.bestDistance = Infinity; this.bestTime = this.time
  }

  /** A point about 40 m back along its own trail, or null if it has barely moved. */
  private wayBack(here: { x: number; z: number }): NavPoint | null {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const c = this.trail[i]
      if (Math.hypot(c.x - here.x, c.z - here.z) > 40) { this.trail.length = i + 1; return c }
    }
    return null
  }

  /**
   * Pick the next activity. A generator: each place it weighs is checked with a route search,
   * and when this step's share of searches is spent it yields and is resumed next step, with
   * the same random draws in the same order. The old activity carries on until it commits.
   */
  private *choose(here: { x: number; z: number }, speed: number, arrived: boolean): Generator<void, void, void> {
    const p = this.personality, r = this.random
    // Having got somewhere, the patient stop to look; the restless do not.
    if (arrived && this.lastKind !== 'pause' && r() < 0.25 + p.patience * 0.5) {
      return this.commit('pause', null, null, 1.5 + r() * 2.5)
    }
    const flat = this.terrain.normalAt(here.x, here.z, this.normal).y > 0.96
    const roomy = flat && [0, 1, 2, 3, 4, 5].every(i => this.standable(here.x + Math.cos(i * Math.PI / 3) * 28, here.z + Math.sin(i * Math.PI / 3) * 28))
    const leader = this.pickLeader(here)
    const road = this.pickRoadPoint(here)
    const summit = this.pickSummit()
    const options: [ActivityKind, number][] = [
      ['explore', 1 + p.curiosity * 1.5],
      ['road', road ? 0.8 + p.patience : 0],
      ['summit', summit ? 0.3 + p.boldness * 0.8 : 0],
      ['visit', this.options.places ? 0.7 + p.curiosity : 0],
      ['follow', leader ? p.sociability * 1.6 : 0],
      // Stunts are for wheels and skirts; an aircraft showing off near a mountain ends badly.
      ['donut', roomy && speed < 12 && !this.pilot.profile.flies ? p.mischief * 0.7 : 0],
      ['weave', this.pilot.profile.flies ? 0 : p.mischief * 0.5],
    ]
    let total = 0
    for (const o of options) { if (o[0] === this.lastKind) o[1] *= o[0] === 'explore' ? 0.6 : 0.15; total += o[1] }
    let roll = r() * total, kind: ActivityKind = 'explore', found: Reach
    for (const [k, w] of options) { roll -= w; if (roll <= 0) { kind = k; break } }
    if (kind === 'road' && (found = yield* this.reachable(here, road!))) return this.commit('road', road, null, 90, found.route)
    if (kind === 'summit' && (found = yield* this.reachable(here, summit!))) return this.commit('summit', summit, null, 150, found.route)
    if (kind === 'visit') {
      const sight = this.pickSight(here)
      if (sight && (found = yield* this.reachable(here, sight))) { this.commit('visit', sight, null, 120, found.route); this.sight = sight; return }
    }
    if (kind === 'follow') return this.commit('follow', null, leader, 20 + r() * 30)
    if (kind === 'donut') { this.swerveSide = r() < 0.5 ? 1 : -1; return this.commit('donut', null, null, 3.5 + r() * 3) }
    // A few tries at somewhere new that the planner agrees can be reached.
    for (let i = 0; i < 3; i++) {
      const place = this.pickFrontier(here)
      if (place && (found = yield* this.reachable(here, place))) return this.commit(kind === 'weave' ? 'weave' : 'explore', place, null, kind === 'weave' ? 12 + r() * 10 : 75, found.route)
    }
    if (road && (found = yield* this.reachable(here, road))) return this.commit('road', road, null, 90, found.route)
    this.commit('pause', null, null, 2)
  }

  /**
   * Ask the planner before committing to a place, and return the route if there is one so
   * it is not searched for again. Waits for a share of the planning budget first.
   */
  private *reachable(here: { x: number; z: number }, place: NavPoint): Generator<void, Reach, void> {
    const navigator = this.options.navigator
    if (!navigator) return { route: null }
    // Waiting moves the vehicle a little: plan from where it is when the search runs.
    while (!this.mayPlan()) { yield; here = this.vehicle.body.translation() }
    const route = navigator.route(here, place, this.pilot.profile)
    const end = route?.points[route.points.length - 1]
    if (!route || !end || (!route.reached && Math.hypot(end.x - place.x, end.z - place.z) > 25)) return null
    return { route }
  }

  /** May this mind run a route search now? Aircraft routes are straight lines, never searched. */
  private mayPlan(): boolean {
    return this.pilot.profile.flies || !this.budget || this.budget.take()
  }

  /** Drop the old plan and start a new activity, keeping the route the choice found. */
  private commit(kind: ActivityKind, destination: NavPoint | null, leader: Vehicle | null, seconds: number, route: Route | null = null): void {
    this.clearPlan()
    if (route) { this.route = route; this.routeIndex = 0; this.routeTime = 4 }
    this.begin(kind, destination, leader, seconds)
  }

  private begin(kind: ActivityKind, destination: NavPoint | null, leader: Vehicle | null, seconds: number): void {
    this.activity = { kind, destination, leader, until: this.time + seconds }
    this.contact = false
    this.leaderIdle = 0
    this.lastKind = kind
  }

  /** Somewhere drivable it has seen little of, biased to the way it is already facing. */
  private pickFrontier(here: { x: number; z: number }): NavPoint | null {
    const heading = Math.atan2(this.forward.z, this.forward.x), p = this.personality
    let best: NavPoint | null = null, bestScore = -Infinity
    for (let i = 0; i < 16; i++) {
      const angle = heading + (this.random() - 0.5) * Math.PI * 1.6, radius = 70 + this.random() * 230
      const x = here.x + Math.cos(angle) * radius, z = here.z + Math.sin(angle) * radius
      if (!this.standable(x, z)) continue
      const seen = this.visits.get(this.cellOf(x, z)) ?? 0
      const climb = (this.terrain.heightAt(x, z) - this.terrain.heightAt(here.x, here.z)) / radius
      const score = (1 + p.curiosity * 2) / (1 + seen * 0.2) + climb * (p.boldness - 0.3) * 4 + this.random() * 0.5
      if (score > bestScore) { bestScore = score; best = { x, z } }
    }
    return best
  }

  /** A point on some road, well away from here, preferring roads it has not driven. */
  private pickRoadPoint(here: { x: number; z: number }): NavPoint | null {
    let best: NavPoint | null = null, bestScore = -Infinity
    for (const road of roadPaths(this.terrain)) {
      const points = 'points' in road ? road.points : road
      if (points.length < 2) continue
      for (let i = 0; i < 3; i++) {
        const point = points[Math.floor(this.random() * points.length)]
        const d = Math.hypot(point.x - here.x, point.z - here.z)
        if (d < 120) continue
        // Prefer road it has not driven and road that lies ahead: doubling straight back
        // along the way it came looks aimless.
        const ahead = ((point.x - here.x) * this.forward.x + (point.z - here.z) * this.forward.z) / d
        const score = 1 / (1 + (this.visits.get(this.cellOf(point.x, point.z)) ?? 0) * 0.2) + this.random() * 0.6 - d / 4000 + ahead * 0.4
        if (score > bestScore) { bestScore = score; best = point }
      }
    }
    return best
  }

  /** A place of interest at a sensible distance that it has not been to. */
  private pickSight(here: { x: number; z: number }): Place | null {
    let best: Place | null = null, bestScore = -Infinity
    for (const place of this.options.places?.() ?? []) {
      if (place.kind === 'summit' || place.kind === 'road-mid') continue
      const d = Math.hypot(place.x - here.x, place.z - here.z)
      if (d < 90 || d > 700) continue
      const score = 1 / (1 + (this.visits.get(this.cellOf(place.x, place.z)) ?? 0)) + this.random() * 0.8 - Math.abs(d - 300) / 800
      if (score > bestScore) { bestScore = score; best = place }
    }
    return best
  }

  private pickSummit(): NavPoint | null {
    const s = this.terrain.summit?.()
    if (!s) return null
    const angle = this.random() * Math.PI * 2
    const point = { x: s.x + Math.cos(angle) * s.rimRadius, z: s.z + Math.sin(angle) * s.rimRadius, y: s.rimHeight }
    return (this.visits.get(this.cellOf(point.x, point.z)) ?? 0) > 20 ? null : point
  }

  private pickLeader(here: { x: number; z: number }): Vehicle | null {
    let best: Vehicle | null = null, bestDistance = 400
    for (const other of this.options.others?.() ?? []) {
      if (other === this.vehicle || !other.body.isValid()) continue
      const p = other.body.translation(), v = other.body.linvel(), wrap = this.terrain.wrapSize
      const d = wrap ? wrapDistance(here.x, here.z, p.x, p.z, wrap) : Math.hypot(p.x - here.x, p.z - here.z)
      // Someone going somewhere, not someone parked or already on our bumper: tailing a
      // vehicle that is itself chasing us turns into two cars circling each other.
      if (d < 20 || Math.hypot(v.x, v.z) < 3) continue
      if (d < bestDistance) { bestDistance = d; best = other }
    }
    return best
  }

  // ---- getting there -----------------------------------------------------------------

  /** Refresh the look ahead point: along a planned route, else along the roads, else direct. */
  private aimFor(here: { x: number; y: number; z: number }, target: NavPoint, speed: number, dt: number): void {
    // Look further ahead the faster it goes, as a driver does: a near aim point at speed
    // means sawing at the wheel.
    const look = Math.max(10, Math.min(30, speed * 1.2))
    const navigator = this.options.navigator
    if (navigator) {
      this.routeTime -= dt
      // Refresh the route every few seconds, when this step's planning budget allows: if it
      // is spent, keep the route it has (or steer by the roads) and ask again next step. Not
      // while a new choice is being made: the old target is about to be dropped.
      if ((!this.route || this.routeTime <= 0) && !this.deciding && this.mayPlan()) {
        this.route = navigator.route(here, target, this.pilot.profile); this.routeIndex = 0
        this.routeTime = this.activity.kind === 'follow' ? 1.5 : 4
        // The planner says there is no way there: do not spend a minute proving it by driving.
        if (this.route && !this.route.reached && this.activity.kind !== 'follow' && this.activity.kind !== 'retreat') {
          const end = this.route.points[this.route.points.length - 1]
          if (!end || Math.hypot(end.x - target.x, end.z - target.z) > 25) { this.abandoned++; this.activity.until = 0 }
        }
      }
      const points = this.route?.points
      if (points?.length) {
        while (this.routeIndex < points.length - 1 && Math.hypot(points[this.routeIndex].x - here.x, points[this.routeIndex].z - here.z) < look) this.routeIndex++
        // Aim at the spot on the route that is `look` metres away, sliding along it, rather
        // than at the next waypoint: a waypoint aim jumps each time one is passed, and every
        // jump is a twitch at the wheel.
        const b = points[this.routeIndex], a = this.routeIndex > 0 ? points[this.routeIndex - 1] : null
        const db = Math.hypot(b.x - here.x, b.z - here.z), da = a ? Math.hypot(a.x - here.x, a.z - here.z) : db
        if (a && db > look && da < look) {
          // Where a circle of radius `look` round the vehicle crosses the segment, ahead of it.
          // Interpolating by distance instead put the aim inside the turning circle once the
          // vehicle was a few metres along a long segment, and it orbited the aim at full lock.
          const ex = b.x - a.x, ez = b.z - a.z, length = Math.hypot(ex, ez) || 1, ux = ex / length, uz = ez / length
          const s = (here.x - a.x) * ux + (here.z - a.z) * uz, off = da * da - s * s
          const along = Math.min(length, s + Math.sqrt(Math.max(0, look * look - Math.max(0, off))))
          this.slide.x = a.x + ux * along; this.slide.z = a.z + uz * along; this.waypoint = this.slide
        } else this.waypoint = b
        return
      }
    }
    this.waypointTime -= dt
    if (this.waypointTime > 0) return
    this.waypointTime = 0.4
    const far = Math.hypot(target.x - here.x, target.z - here.z) > 18
    this.waypoint = far && !this.pilot.profile.flies ? roadWaypoint(this.terrain, here, { x: target.x, z: target.z, y: target.y ?? this.terrain.heightAt(target.x, target.z) }, look) : null
  }

  private cruiseSpeed(activity: Activity, distance: number): number {
    const bold = this.personality.boldness
    const onRoad = this.waypoint !== null && !this.options.navigator
    let speed = onRoad ? roadSpeed.value * (0.85 + bold * 0.4) : 8 + bold * 6
    if (this.pilot.profile.flies) speed = 11 + bold * 4
    // Going for contact in a game: as fast as it dares for the last stretch. Farther off it
    // drives as usual, so switchbacks on the way are taken at road speed.
    if (activity.kind === 'follow' && this.contact && distance < 60) speed = Math.max(speed, this.pilot.profile.flies ? 18 : 16 + bold * 6)
    return speed
  }

  /**
   * Check the ground toward the aim point and, if it is not drivable, the nearest heading
   * that is. Returns null when every direction ahead is blocked.
   */
  private steerClear(here: { x: number; y: number; z: number }, aimX: number, aimZ: number, speed: number): { x: number; z: number; swerved: boolean } | null {
    const profile = this.pilot.profile
    const dx = aimX - here.x, dz = aimZ - here.z, d = Math.hypot(dx, dz) || 1
    // An aircraft looks much further: what matters is a wall it cannot out-climb.
    // A driver who turns the wheel smoothly has to see trouble earlier: about two seconds ahead.
    const reach = profile.flies ? 70 : Math.max(10, Math.min(36, speed * 2)), base = Math.atan2(dz, dx)
    for (const swerve of SWERVES) {
      // Try the side it last chose first, so it does not dither between two ways round.
      const angle = base + swerve * this.swerveSide, cx = Math.cos(angle), cz = Math.sin(angle)
      const midX = here.x + cx * reach * 0.5, midZ = here.z + cz * reach * 0.5
      const endX = here.x + cx * reach, endZ = here.z + cz * reach
      const nearX = here.x + cx * reach * 0.25, nearZ = here.z + cz * reach * 0.25
      if (!this.crossable(here.x, here.z, nearX, nearZ) || !this.crossable(nearX, nearZ, midX, midZ) || !this.crossable(midX, midZ, endX, endZ)) continue
      if (this.parkedInWay(here, endX, endZ)) continue
      if (swerve === 0) return { x: aimX, z: aimZ, swerved: false }
      if (swerve * this.swerveSide < 0) this.swerveSide = -this.swerveSide
      return { x: here.x + cx * Math.max(reach, Math.min(d, 20)), z: here.z + cz * Math.max(reach, Math.min(d, 20)), swerved: true }
    }
    return null
  }

  /**
   * Is a vehicle that is standing still (or nearly) on the line from here to (bx, bz)?
   * Moving traffic sorts itself out; a parked one has to be driven round. The vehicle being
   * tailed and anything on a hill this mind is trying to hold do not count.
   */
  private parkedInWay(here: { x: number; z: number }, bx: number, bz: number): boolean {
    const others = this.options.others?.()
    if (!others || this.pilot.profile.flies) return false
    const dx = bx - here.x, dz = bz - here.z, length = Math.hypot(dx, dz) || 1
    const a = this.activity, hill = a.kind === 'hold' ? a.destination : null
    for (const other of others) {
      if (other === this.vehicle || other === a.leader || !other.body.isValid()) continue
      const v = other.body.linvel()
      if (v.x * v.x + v.z * v.z > 9) continue
      const p = other.body.translation(), px = p.x - here.x, pz = p.z - here.z
      if (hill && Math.hypot(p.x - hill.x, p.z - hill.z) < this.holdRadius) continue
      const along = (px * dx + pz * dz) / length
      if (along < 0 || along > length) continue
      if (Math.abs(px * dz - pz * dx) / length < 4) return true
    }
    return false
  }

  /** May this vehicle travel from a to b: dry (or floating), inside the world, not too steep. */
  private crossable(ax: number, az: number, bx: number, bz: number): boolean {
    const profile = this.pilot.profile
    if (profile.flies) {
      // Fly over what rises gently and round what towers: a mesa, a spire or a crag face
      // that stands far above the aircraft within a few seconds' flight is a wall. Sample
      // the whole leg, and a wing's width to each side: a shard of glass a few metres wide
      // slips between two samples taken thirty metres apart.
      // An aircraft cannot stop in three metres: turn back well before the world's edge.
      if (!this.terrain.wrapSize && (Math.abs(bx) > this.terrain.size / 2 - 40 || Math.abs(bz) > this.terrain.size / 2 - 40)) return false
      const ceiling = this.vehicle.body.translation().y + 22, dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz) || 1
      const sx = -dz / length * 5, sz = dx / length * 5
      for (let t = 6; t <= length; t += 6) {
        const x = ax + dx / length * t, z = az + dz / length * t
        if (this.surface(x, z) > ceiling || this.surface(x + sx, z + sz) > ceiling || this.surface(x - sx, z - sz) > ceiling) return false
      }
      return true
    }
    if (this.options.navigator) { if (!this.options.navigator.passable(bx, bz, profile)) return false }
    else if (profile.liquid === 'blocked' ? !isSafeGround(this.terrain, bx, bz) : Math.abs(bx) > this.terrain.size / 2 - 3 || Math.abs(bz) > this.terrain.size / 2 - 3) return false
    const run = Math.hypot(bx - ax, bz - az) || 1
    const grade = (this.surface(bx, bz) - this.surface(ax, az)) / run
    if (grade > profile.maxGrade || grade < -profile.maxGrade * 1.5) return false
    // Gentle along the line of travel can still be a steep side slope: a traverse across a
    // flank rolls a wheeled vehicle. Reject ground tilted past the descent limit any way.
    return profile.liquid !== 'blocked' || this.terrain.normalAt(bx, bz, this.normal).y >= 1 / Math.hypot(1, profile.maxGrade * 1.5)
  }

  private standable(x: number, z: number): boolean {
    const profile = this.pilot.profile
    if (profile.flies) {
      // An aircraft can hover anywhere, but a place on top of a tower (a spire, a shard, a
      // butte) can only be reached by climbing its face, and that is how jets crash. Somewhere
      // is a destination only if the ground round it is not far below it.
      if (!this.terrain.wrapSize && (Math.abs(x) > this.terrain.size / 2 - 40 || Math.abs(z) > this.terrain.size / 2 - 40)) return false
      const top = this.surface(x, z)
      for (let a = 0; a < 8; a++) if (top - this.surface(x + Math.cos(a * Math.PI / 4) * 50, z + Math.sin(a * Math.PI / 4) * 50) > 40) return false
      return true
    }
    if (this.options.navigator) return this.options.navigator.passable(x, z, profile)
    if (profile.liquid !== 'blocked') return Math.abs(x) < this.terrain.size / 2 - 3 && Math.abs(z) < this.terrain.size / 2 - 3
    return isSafeGround(this.terrain, x, z) && this.terrain.normalAt(x, z, this.normal).y > 0.85
  }

  private surface(x: number, z: number): number {
    const ground = this.terrain.heightAt(x, z)
    if (this.pilot.profile.liquid === 'blocked') return ground
    const liquid = this.terrain.liquidHeightAt?.(x, z)
    return liquid != null && Number.isFinite(liquid) ? Math.max(ground, liquid) : ground
  }

  private cellOf(x: number, z: number): number {
    return Math.floor(x / VISIT_CELL + 4096) * 8192 + Math.floor(z / VISIT_CELL + 4096)
  }
}

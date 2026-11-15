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
import { roadSpeed } from '../params'
import type { DriveGoal, Navigator, NavPoint, Pilot, PilotStatus, Route } from '../pilot/types'
import { hashString, seededRandom } from '../random'
import { type Personality, personalityFor } from './personality'

export type ActivityKind = 'road' | 'summit' | 'explore' | 'follow' | 'donut' | 'weave' | 'pause' | 'retreat'

export interface Activity {
  kind: ActivityKind
  /** Where it is going, when the activity has a place. */
  destination: NavPoint | null
  /** The vehicle being tailed, for 'follow'. */
  leader: Vehicle | null
  /** Mind time at which it gives up or finishes, seconds. */
  until: number
}

export interface MindOptions {
  /** Seeds the personality and every choice. Same seed, same terrain, same start: same drive. */
  seed: string
  personality?: Personality
  /** Route planner for open ground. Without one it follows roads and steers by sight. */
  navigator?: Navigator
  /** Other vehicles it may tail. Read fresh each time it chooses. */
  others?: () => readonly Vehicle[]
}

/** What the vehicle is up to, for a label on screen. */
const CAPTIONS: Record<ActivityKind, string> = {
  road: 'cruising the road', summit: 'heading for the summit', explore: 'exploring', follow: 'tagging along',
  donut: 'doing donuts', weave: 'carving', pause: 'taking in the view', retreat: 'finding another way',
}

const VISIT_CELL = 64
/** Candidate headings relative to the wanted one, nearest first, radians. */
const SWERVES = [0, 0.3, -0.3, 0.6, -0.6, 1, -1, 1.5, -1.5]

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
  /** Where it has been, one point every few metres, newest last: the proven way back out. */
  private readonly trail: NavPoint[] = []
  private bestTime = 0
  private readonly goal: DriveGoal = { x: 0, z: 0, speed: 0 }
  private readonly q = new Quaternion()
  private readonly forward = new Vector3()
  private readonly normal = new Vector3()
  private readonly idle: PilotStatus = { stuckFor: 0, airborne: false, flipped: false }

  constructor(
    readonly vehicle: Vehicle,
    private readonly terrain: BotTerrain,
    private readonly pilot: Pilot,
    private readonly options: MindOptions,
  ) {
    this.personality = options.personality ?? personalityFor(options.seed)
    this.random = seededRandom(hashString(`mind:${options.seed}`))
  }

  /** A short phrase for what it is doing now. */
  get caption(): string {
    const name = this.activity.kind === 'follow' ? this.activity.leader?.name : ''
    return name ? `following ${name}` : CAPTIONS[this.activity.kind]
  }

  /** Share of the map's coarse cells this mind has driven through, 0..1. */
  get explored(): number {
    const side = Math.ceil(this.terrain.size / VISIT_CELL)
    return this.visits.size / (side * side)
  }

  /** Forget the current plan: after a teleport, a regenerated world, or a handover. */
  reset(): void {
    this.activity = { kind: 'pause', destination: null, leader: null, until: 0 }
    this.route = null; this.waypoint = null; this.troubleFor = 0; this.bestDistance = Infinity
    this.pilot.reset()
  }

  /** One physics step: decide, then write the controls into `input`. */
  step(dt: number, input: InputState): PilotStatus {
    const body = this.vehicle.body
    if (!body.isValid()) return this.idle
    this.time += dt
    const here = body.translation(), v = body.linvel(), speed = Math.hypot(v.x, v.z)
    this.q.copy(body.rotation()); this.forward.set(0, 0, -1).applyQuaternion(this.q)
    const cell = this.cellOf(here.x, here.z)
    this.visits.set(cell, (this.visits.get(cell) ?? 0) + dt)
    const crumb = this.trail[this.trail.length - 1]
    if (!crumb || Math.hypot(crumb.x - here.x, crumb.z - here.z) > 8) { this.trail.push({ x: here.x, z: here.z }); if (this.trail.length > 48) this.trail.shift() }

    const a = this.activity
    if (a.kind === 'follow' && !a.leader?.body.isValid()) a.until = 0
    if (a.kind === 'follow' && a.leader) {
      // Sit a few lengths behind the leader, on a side that is stable for this driver.
      const p = a.leader.body.translation(), lv = a.leader.body.linvel(), ls = Math.hypot(lv.x, lv.z) || 1
      const side = this.personality.mischief > 0.5 ? 4 : -4
      a.destination = { x: p.x - lv.x / ls * 9 + lv.z / ls * side, z: p.z - lv.z / ls * 9 - lv.x / ls * side }
      // A leader that has stopped is no longer leading anywhere.
      this.leaderIdle = Math.hypot(lv.x, lv.z) < 1.5 ? this.leaderIdle + dt : 0
      if (this.leaderIdle > 4) a.until = 0
    }
    const destination = a.destination
    const distance = destination ? Math.hypot(destination.x - here.x, destination.z - here.z) : Infinity
    const arrived = destination !== null && a.kind !== 'follow' && distance < 10
    // Give up on a place it has stopped getting closer to: 12 seconds without gaining 5 m.
    if (destination && a.kind !== 'follow') {
      if (distance < this.bestDistance - 5) { this.bestDistance = distance; this.bestTime = this.time }
      else if (this.time - this.bestTime > 12) { this.abandoned++; a.until = 0 }
    }
    if (this.time >= a.until || arrived || this.troubleFor > 6) {
      const trouble = this.troubleFor > 6
      if (trouble) this.abandoned++
      // In trouble, do not pick another place from the same bad spot: first go back the way
      // it came, which is ground it has already driven, and choose again from there.
      const back = trouble && a.kind !== 'retreat' ? this.wayBack(here) : null
      if (back) { this.clearPlan(); this.begin('retreat', back, null, 10) }
      else this.choose(here, speed, arrived)
    }

    const goal = this.goal
    goal.special = false; goal.stopWithin = undefined; goal.altitude = undefined
    const act = this.activity
    if (act.kind === 'pause') {
      goal.x = here.x + this.forward.x * 10; goal.z = here.z + this.forward.z * 10; goal.speed = 0; goal.stopWithin = 1e6
    } else if (act.kind === 'donut') {
      // A point always off to one side is a circle; full lock and a steady speed do the rest.
      goal.x = here.x + this.forward.x * 2 - this.forward.z * 6 * this.swerveSide
      goal.z = here.z + this.forward.z * 2 + this.forward.x * 6 * this.swerveSide
      goal.speed = 9
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
    }
    const status = this.pilot.drive(goal, input, dt)
    if (status.stuckFor > 3 || status.flipped) this.troubleFor += dt
    return status
  }

  // ---- choosing what to do -----------------------------------------------------------

  private clearPlan(): void {
    this.route = null; this.waypoint = null; this.troubleFor = 0; this.bestDistance = Infinity; this.bestTime = this.time
  }

  /** A point about 40 m back along its own trail, or null if it has barely moved. */
  private wayBack(here: { x: number; z: number }): NavPoint | null {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const c = this.trail[i]
      if (Math.hypot(c.x - here.x, c.z - here.z) > 40) { this.trail.length = i + 1; return c }
    }
    return null
  }

  private choose(here: { x: number; z: number }, speed: number, arrived: boolean): void {
    const p = this.personality, r = this.random
    this.clearPlan()
    // Having got somewhere, the patient stop to look; the restless do not.
    if (arrived && this.lastKind !== 'pause' && r() < 0.25 + p.patience * 0.5) {
      return this.begin('pause', null, null, 1.5 + r() * 2.5)
    }
    const flat = this.terrain.normalAt(here.x, here.z, this.normal).y > 0.96
    const roomy = flat && [0, 1, 2, 3, 4, 5].every(i => isSafeGround(this.terrain, here.x + Math.cos(i * Math.PI / 3) * 16, here.z + Math.sin(i * Math.PI / 3) * 16))
    const leader = this.pickLeader(here)
    const road = this.pickRoadPoint(here)
    const summit = this.pickSummit()
    const options: [ActivityKind, number][] = [
      ['explore', 1 + p.curiosity * 1.5],
      ['road', road ? 0.8 + p.patience : 0],
      ['summit', summit ? 0.3 + p.boldness * 0.8 : 0],
      ['follow', leader ? p.sociability * 1.6 : 0],
      ['donut', roomy && speed < 12 ? p.mischief * 0.7 : 0],
      ['weave', p.mischief * 0.5],
    ]
    let total = 0
    for (const o of options) { if (o[0] === this.lastKind) o[1] *= o[0] === 'explore' ? 0.6 : 0.15; total += o[1] }
    let roll = r() * total, kind: ActivityKind = 'explore'
    for (const [k, w] of options) { roll -= w; if (roll <= 0) { kind = k; break } }
    if (kind === 'road') return this.begin('road', road, null, 90)
    if (kind === 'summit') return this.begin('summit', summit, null, 150)
    if (kind === 'follow') return this.begin('follow', null, leader, 20 + r() * 30)
    if (kind === 'donut') { this.swerveSide = r() < 0.5 ? 1 : -1; return this.begin('donut', null, null, 3.5 + r() * 3) }
    const place = this.pickFrontier(here)
    if (!place) return this.begin(road ? 'road' : 'pause', road, null, road ? 90 : 2)
    this.begin(kind === 'weave' ? 'weave' : 'explore', place, null, kind === 'weave' ? 12 + r() * 10 : 75)
  }

  private begin(kind: ActivityKind, destination: NavPoint | null, leader: Vehicle | null, seconds: number): void {
    this.activity = { kind, destination, leader, until: this.time + seconds }
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
      const p = other.body.translation(), v = other.body.linvel(), d = Math.hypot(p.x - here.x, p.z - here.z)
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
    const look = Math.max(8, Math.min(18, speed * 0.7))
    const navigator = this.options.navigator
    if (navigator) {
      this.routeTime -= dt
      if (!this.route || this.routeTime <= 0) {
        this.route = navigator.route(here, target, this.pilot.profile); this.routeIndex = 0
        this.routeTime = this.activity.kind === 'follow' ? 1.5 : 4
      }
      const points = this.route?.points
      if (points?.length) {
        while (this.routeIndex < points.length - 1 && Math.hypot(points[this.routeIndex].x - here.x, points[this.routeIndex].z - here.z) < look) this.routeIndex++
        this.waypoint = points[this.routeIndex]
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
    if (activity.kind === 'weave') speed = 11 + bold * 3
    if (activity.kind === 'follow') {
      const lv = activity.leader!.body.linvel()
      speed = Math.min(22, Math.hypot(lv.x, lv.z) + Math.max(0, distance - 4) * 0.5)
    }
    return speed
  }

  /**
   * Check the ground toward the aim point and, if it is not drivable, the nearest heading
   * that is. Returns null when every direction ahead is blocked.
   */
  private steerClear(here: { x: number; y: number; z: number }, aimX: number, aimZ: number, speed: number): { x: number; z: number; swerved: boolean } | null {
    const profile = this.pilot.profile
    if (profile.flies) return { x: aimX, z: aimZ, swerved: false }
    const dx = aimX - here.x, dz = aimZ - here.z, d = Math.hypot(dx, dz) || 1
    const reach = Math.max(8, Math.min(24, speed * 1.2)), base = Math.atan2(dz, dx)
    for (const swerve of SWERVES) {
      // Try the side it last chose first, so it does not dither between two ways round.
      const angle = base + swerve * this.swerveSide, cx = Math.cos(angle), cz = Math.sin(angle)
      const midX = here.x + cx * reach * 0.5, midZ = here.z + cz * reach * 0.5
      const endX = here.x + cx * reach, endZ = here.z + cz * reach
      if (!this.crossable(here.x, here.z, midX, midZ) || !this.crossable(midX, midZ, endX, endZ)) continue
      if (swerve === 0) return { x: aimX, z: aimZ, swerved: false }
      if (swerve * this.swerveSide < 0) this.swerveSide = -this.swerveSide
      return { x: here.x + cx * Math.max(reach, Math.min(d, 20)), z: here.z + cz * Math.max(reach, Math.min(d, 20)), swerved: true }
    }
    return null
  }

  /** May this vehicle travel from a to b: dry (or floating), inside the world, not too steep. */
  private crossable(ax: number, az: number, bx: number, bz: number): boolean {
    const profile = this.pilot.profile
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

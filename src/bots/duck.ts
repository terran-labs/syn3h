/**
 * Baby duck following: how a playful bot keeps the player company.
 *
 * Each follower takes a place in a loose line along the ground the player has just driven:
 * the first a few lengths back, the next a little further, and so on. Following the
 * player's own track instead of heading for the player means the line bends where the
 * player turned, stays on the road the player kept to, and never cuts across in front.
 * There is no path search: the track is a ring of breadcrumbs, and finding a place on it is
 * a walk of a few dozen points. When the line of sight to the place is blocked the brain
 * hands over to the mind, whose route planner is rationed (nav/budget.ts).
 *
 * When the player stops, the line gathers into an arc behind them at a polite distance,
 * leaving the way ahead open. When the player reverses, anyone in the way pulls aside.
 * Feeling shows through motion the vehicles already have: a wiggle of the wheels, a little
 * nod on the throttle, a happy spin on arriving, more often the more playful the bot.
 *
 * Decisions only: the brain steers, brakes and checks the ground (BotBrain.ts).
 */
import type { Vehicle } from '../vehicles/Vehicle'
import { seededRandom, hashString } from './random'

/** Centre to centre metres from the player to the first place in line. */
export const LINE_START = 8
/** Metres between places in line. */
export const LINE_SPACING = 6
/** Radius of the arc the line gathers into when the player stops. */
export const GATHER_RADIUS = 10
/** The arc never comes within this angle of straight ahead of the player, radians (about 70 degrees). */
const GATHER_FRONT_CLEAR = 1.2
/** Followers within this many metres of their own place in line gather round a stopped leader. */
const GATHER_NEAR = 15
/** Player speed below which it counts as stopped, and how long it must stay so, m/s and s. */
const STOPPED_SPEED = 0.8
const STOPPED_AFTER = 0.7
/** Reversing faster than this counts as backing up, m/s. */
const REVERSING_SPEED = 0.8
/** Breadcrumbs: one every CRUMB metres, enough for the longest line. */
const CRUMB = 2
const CRUMBS = 80

export type Flourish = 'wiggle' | 'nod' | 'spin'

export interface DuckAim {
  x: number
  z: number
  /** Fastest it should go now, m/s. Infinity to hurry. */
  limit: number
  /** What it is doing, for tests and captions. */
  mode: 'line' | 'gather' | 'give-way'
  /** A bit of feeling to show now, when it is safe to. */
  flourish: Flourish | null
  /** Seconds since that flourish began. */
  flourishTime: number
  /**
   * Well behind its place in line. The brain then catches up the way the original pursuit
   * does, along the roads with their speed limits, and uses this aim only for its speed.
   */
  far: boolean
}

/** Followers of each leader, so each can find its place in line. */
const lines = new WeakMap<Vehicle, Set<DuckFollower>>()

export class DuckFollower {
  private readonly crumbs: { x: number; z: number }[] = []
  private leader: Vehicle | null = null
  private stoppedFor = 0
  private arrived = false
  private flourish: Flourish | null = null
  private flourishLeft = 0
  private flourishLength = 0
  private nextFlourish = 0
  /**
   * In line this step. A follower off on a distraction stays the leader's but gives up its
   * place, so the line closes up behind the leader and it rejoins at the back of its rank.
   */
  active = false
  private readonly random: () => number
  private readonly aim: DuckAim = { x: 0, z: 0, limit: Infinity, mode: 'line', flourish: null, flourishTime: 0, far: false }

  constructor(readonly vehicle: Vehicle, readonly index: number) {
    this.random = seededRandom(hashString(`duck:${vehicle.id}:${index}`))
  }

  /** Start or stop following `leader`. Null leaves the line. */
  follow(leader: Vehicle | null): void {
    if (leader === this.leader) return
    if (this.leader) lines.get(this.leader)?.delete(this)
    this.leader = leader; this.crumbs.length = 0; this.stoppedFor = 0; this.arrived = false; this.flourish = null
    if (leader) { let set = lines.get(leader); if (!set) lines.set(leader, set = new Set()); set.add(this) }
  }

  get following(): Vehicle | null { return this.leader }

  /** What it was doing at its last step, for tests and captions. */
  get mode(): DuckAim['mode'] { return this.aim.mode }

  /** Place in line among everyone following the same leader: lower spawn index goes first. */
  private rank(): number {
    let rank = 0
    for (const other of lines.get(this.leader!) ?? []) if (other !== this && other.active && other.vehicle.body.isValid() && other.index < this.index) rank++
    return rank
  }

  /**
   * Where to head and how fast, this step. `leaderAt` is the leader's position as seen from
   * here (the nearest image on a wrapping world); `ok` says whether a bot may stand somewhere.
   */
  step(dt: number, here: { x: number; z: number }, leaderAt: { x: number; z: number }, playfulness: number, ok: (x: number, z: number) => boolean): DuckAim {
    const leader = this.leader!
    const v = leader.body.linvel(), q = leader.body.rotation()
    // The leader's nose: three's (0, 0, -1) turned by its rotation, flattened.
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const fl = Math.hypot(fx, fz) || 1, nx = fx / fl, nz = fz / fl
    const speed = Math.hypot(v.x, v.z), forwardSpeed = v.x * nx + v.z * nz
    // Breadcrumbs, newest last. A jump (a teleport, the seam of a wrapping world) starts afresh.
    const last = this.crumbs[this.crumbs.length - 1]
    if (last && Math.hypot(leaderAt.x - last.x, leaderAt.z - last.z) > 30) this.crumbs.length = 0
    if (!last || this.crumbs.length === 0 || Math.hypot(leaderAt.x - last.x, leaderAt.z - last.z) >= CRUMB) {
      this.crumbs.push({ x: leaderAt.x, z: leaderAt.z }); if (this.crumbs.length > CRUMBS) this.crumbs.shift()
    }
    this.stoppedFor = speed < STOPPED_SPEED ? this.stoppedFor + dt : 0
    const rank = this.rank(), a = this.aim
    a.flourish = null; a.far = false
    const dx = leaderAt.x - here.x, dz = leaderAt.z - here.z, gap = Math.hypot(dx, dz)

    // Backing up: whoever is behind and near pulls out of the way to the side it is already on.
    // From here to the leader runs along its nose when this follower is behind it.
    const behind = dx * nx + dz * nz, side = dx * nz - dz * nx
    // Only when the leader is really coming at this follower: going backwards by its own nose
    // and closing on it. A leader whose nose does not follow its motion (sliding, spun round,
    // carried) is not taken for one backing up unless it is actually closing.
    const closing = gap > 0.1 ? -(v.x * dx + v.z * dz) / gap : 0
    if (forwardSpeed < -REVERSING_SPEED && closing > REVERSING_SPEED && behind > 0 && behind < 12 + (-forwardSpeed) * 2.5 && Math.abs(side) < 5) {
      const s = side >= 0 ? -1 : 1
      // Out to the side, perpendicular to the leader's line, and a little back.
      a.x = here.x + nz * s * 10 - nx * 3; a.z = here.z - nx * s * 10 - nz * 3
      a.limit = 8; a.mode = 'give-way'; this.arrived = false; this.flourish = null
      return a
    }

    // Gathering is for those already close. One far behind a stopped leader catches up along
    // the line first: a straight dash to the arc would cut across whatever lies between.
    if (this.stoppedFor > STOPPED_AFTER && gap < LINE_START + rank * LINE_SPACING + GATHER_NEAR) {
      // Gather in an arc behind the leader, alternating sides outwards, never in front.
      const ring = Math.floor(rank / 5), slot = rank % 5
      const turn = Math.min(Math.PI - GATHER_FRONT_CLEAR, Math.ceil(slot / 2) * 0.6) * (slot % 2 ? 1 : -1)
      const angle = Math.atan2(-nz, -nx) + turn, radius = GATHER_RADIUS + ring * 5
      let x = leaderAt.x + Math.cos(angle) * radius, z = leaderAt.z + Math.sin(angle) * radius
      if (!ok(x, z)) { x = leaderAt.x - nx * radius; z = leaderAt.z - nz * radius }
      a.x = x; a.z = z; a.mode = 'gather'
      const d = Math.hypot(x - here.x, z - here.z)
      a.limit = d < 2.5 ? 0 : Math.min(9, 1 + d * 0.5)
      if (d < 2.5 && !this.arrived) {
        // Arriving is worth a little celebration: a spin when there is room, else a wiggle.
        this.arrived = true
        if (this.random() < 0.3 + playfulness * 0.6) this.begin(gap > GATHER_RADIUS - 1 && playfulness > 0.4 ? 'spin' : 'wiggle', 1.4)
        this.nextFlourish = 3 + this.random() * 6
      } else if (this.arrived) {
        // Waiting is fidgety for a playful one.
        this.nextFlourish -= dt
        if (this.nextFlourish <= 0 && !this.flourish) { this.begin(this.random() < 0.5 ? 'wiggle' : 'nod', 0.8); this.nextFlourish = (4 + this.random() * 8) / (0.3 + playfulness) }
      }
      return this.flourishing(dt, a)
    }
    this.arrived = false

    // In line: walk back along the leader's track to this follower's place.
    const want = LINE_START + rank * LINE_SPACING
    let x = leaderAt.x - nx * want, z = leaderAt.z - nz * want, walked = 0, placeAt = this.crumbs.length - 1
    for (let i = this.crumbs.length - 1; i > 0; i--) {
      const p = this.crumbs[i], o = this.crumbs[i - 1], step = Math.hypot(p.x - o.x, p.z - o.z)
      if (walked + step >= want) { const t = (want - walked) / (step || 1); x = p.x + (o.x - p.x) * t; z = p.z + (o.z - p.z) * t; placeAt = i; walked = want; break }
      walked += step
      if (i === 1) { x = o.x; z = o.z; placeAt = 0 }
    }
    const d = Math.hypot(x - here.x, z - here.z)
    a.mode = 'line'; a.far = d > 25
    // Hurry when well back; match the leader's pace at its place; drop back when too close.
    a.limit = gap < want - 2 ? Math.max(0, speed - 2) : a.far ? Infinity : speed + 1 + d * 0.6
    // Steer along the track, not across to the place: aiming straight at a point twenty
    // metres on round a switchback cuts the corner and goes over the edge. Aim a short look
    // ahead of the nearest breadcrumb, never past the place itself.
    let near = -1, nearD = Infinity
    for (let i = 0; i < this.crumbs.length; i++) { const c = this.crumbs[i], e = Math.hypot(c.x - here.x, c.z - here.z); if (e < nearD) { nearD = e; near = i } }
    const own = this.vehicle.body.linvel(), look = Math.max(8, Math.min(16, Math.hypot(own.x, own.z) * 1.2))
    const ahead = near + Math.ceil(look / CRUMB)
    if (near >= 0 && nearD < 12 && ahead < placeAt) { a.x = this.crumbs[ahead].x; a.z = this.crumbs[ahead].z; return this.flourishing(dt, a) }
    // At its place: loose, not regimented. Alternate a step to either side, more for a
    // playful one, where the ground there will take it. On a narrow road that falls back to
    // single file.
    const lateral = (rank % 2 ? 1 : -1) * 1.5 * playfulness
    if (lateral && ok(x + nz * lateral * 2, z - nx * lateral * 2)) { x += nz * lateral; z -= nx * lateral }
    a.x = x; a.z = z
    // An occasional wiggle while trotting along slowly.
    if (!this.flourish && speed < 8 && d < 4) {
      this.nextFlourish -= dt
      if (this.nextFlourish <= 0) { if (this.random() < playfulness) this.begin('wiggle', 0.6); this.nextFlourish = 6 + this.random() * 10 }
    }
    return this.flourishing(dt, a)
  }

  private begin(kind: Flourish, seconds: number): void { this.flourish = kind; this.flourishLeft = this.flourishLength = seconds }

  private flourishing(dt: number, a: DuckAim): DuckAim {
    if (this.flourish) {
      a.flourish = this.flourish; a.flourishTime = this.flourishLength - this.flourishLeft
      this.flourishLeft -= dt
      if (this.flourishLeft <= 0) this.flourish = null
    }
    return a
  }
}

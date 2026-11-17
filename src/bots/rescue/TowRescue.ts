/**
 * One rescuer freeing one stuck vehicle with the grapple, the way a player would: pick an
 * anchor on the line the stuck vehicle should come out along, stop there, fire the hook at
 * it, reel in and drive away, ease off when it comes free, let go. If a pull does not do
 * it, reposition at a different angle and try again; after a few tries, give up.
 *
 * It drives through a pilot and fires through `TowGear`, so it runs the same in the game
 * (BotGear, networked cords) and in headless physics tests (a Bungee on a test world).
 * One `step` per physics step; it allocates nothing per step.
 *
 * The pull directions by situation:
 *   wedged, high-centred, stuck  back out along the way it came in (`entry`)
 *   bogged in lava or water      towards the nearest dry ground (`shore`)
 *   flipped                      across its roll axis, a little uphill, so the line rolls it over
 * Flipped is the hard case: the grapple pulls at the body's centre, which slides a vehicle but
 * cannot turn it. While the cord is tight on an upside-down vehicle, this adds the turning
 * effect the same pull would have if the hook sat on its roof (see `rightingTorque`).
 */
import { Quaternion, Vector3 } from 'three/webgpu'
import type { InputState } from '../../core/Input'
import type { Vehicle } from '../../vehicles/Vehicle'
import type { DriveGoal, Navigator, NavPoint, Pilot } from '../pilot/types'
import type { BotTerrain } from '../BotBrain'

export type StuckKind = 'flipped' | 'wedged' | 'bogged'

/** The grapple, as the rescue uses it. */
export interface TowGear {
  /** Fire the hook at `target` (it flies, then ties to whatever it hits). */
  fire(target: Vehicle): void
  /** Keep reeling in; call every step while pulling. */
  reel(target: Vehicle): void
  /** Keep the cord tied without reeling, so driving away does the pulling. */
  hold(target: Vehicle): void
  /** Let go of the cord. */
  release(target: Vehicle): void
  /** The cord is tied to `target`. */
  attachedTo(target: Vehicle): boolean
  /** The hook is in the air. */
  flying(): boolean
}

export type TowPhase = 'approach' | 'brace' | 'fire' | 'tow' | 'ease' | 'done' | 'failed'

export interface TowOptions {
  kind: StuckKind
  /** Unit vector on the ground (x, z): the way the stuck vehicle should come out. */
  pull: { x: number; z: number }
  /** Metres from the stuck vehicle to the anchor. Within the grapple's reach. */
  anchor?: number
  /** Tries before giving up. */
  attempts?: number
  /** Called when the phase changes, for chatter and tests. */
  onPhase?(phase: TowPhase, attempt: number): void
  /** Route planner: the way to the anchor goes round trenches and cliffs, as the bots' own drives do. */
  navigator?: Navigator
}

const BRACE_S = 0.6
const HOOK_WAIT_S = 2
const PULL_S = 9
const APPROACH_S = 30
const EASE_S = 1
/** Shortest cord the rescuer reels to: closer than this and it would be pulled into the hole. */
const MIN_SPAN = 9
/** The roof hitch a hook would grip, metres above the centre, for the righting effect. */
const HITCH_UP = 0.9

export class TowRescue {
  phase: TowPhase = 'approach'
  attempt = 1
  /** Seconds since the rescue began, and in the current phase. */
  elapsed = 0
  private inPhase = 0
  private readonly start = new Vector3()
  private pull: { x: number; z: number }
  private readonly anchorDistance: number
  private readonly maxAttempts: number
  private readonly goal: DriveGoal = { x: 0, z: 0, speed: 0 }
  private readonly q = new Quaternion()
  private readonly up = new Vector3()
  private freedFor = 0
  private route: NavPoint[] | null = null
  private waypoint: NavPoint | null = null
  private waypointTime = 0

  constructor(
    readonly rescuer: Vehicle,
    readonly stuck: Vehicle,
    private readonly terrain: BotTerrain,
    private readonly gear: TowGear,
    private readonly pilot: Pilot,
    private readonly options: TowOptions,
  ) {
    this.pull = { ...options.pull }
    this.anchorDistance = options.anchor ?? (options.kind === 'wedged' ? 11 : 16)
    this.maxAttempts = options.attempts ?? 3
    const p = stuck.body.translation()
    this.start.set(p.x, p.y, p.z)
  }

  get finished(): boolean { return this.phase === 'done' || this.phase === 'failed' }

  /** Where the rescuer stands to pull: on the pull line, out from the stuck vehicle. */
  anchor(): { x: number; z: number } {
    const p = this.stuck.body.translation()
    return { x: p.x + this.pull.x * this.anchorDistance, z: p.z + this.pull.z * this.anchorDistance }
  }

  /**
   * The stuck vehicle's own controls while it is being pulled: it drives with the cord, the
   * way a stuck driver guns the engine when a friend takes up the slack. Otherwise nothing.
   */
  assist(input: InputState): void {
    input.x = 0; input.z = 0; input.w = 0; input.brakes = false; input.fire = false
    if (this.phase !== 'tow') { input.y = 0; return }
    this.q.copy(this.stuck.body.rotation())
    this.up.set(0, 0, -1).applyQuaternion(this.q)
    const s = this.stuck.body.translation(), r = this.rescuer.body.translation()
    const towards = this.up.x * (r.x - s.x) + this.up.z * (r.z - s.z)
    input.y = towards >= 0 ? 1 : -1
  }

  /** One physics step. Writes the rescuer's controls into `input`. */
  step(dt: number, input: InputState): TowPhase {
    if (this.finished) return this.phase
    this.elapsed += dt
    this.inPhase += dt
    if (!this.rescuer.body.isValid() || !this.stuck.body.isValid()) { this.gear.release(this.stuck); return this.set('failed') }
    // Freed on its own (it self-righted, or another rescuer did it): stand down.
    if (this.phase !== 'tow' && this.phase !== 'ease' && this.free(dt)) { this.gear.release(this.stuck); return this.set('done') }
    const here = this.rescuer.body.translation()
    switch (this.phase) {
      case 'approach': {
        const a = this.anchor()
        const d = Math.hypot(a.x - here.x, a.z - here.z)
        // Far off, the planner's route (it sees cliffs and seas, not narrow notches); close in,
        // a straight drive if the ground on the way is level and dry, or round by the nearest
        // waypoint whose legs both are. Re-chosen once a second.
        this.waypointTime -= dt
        if (this.waypointTime <= 0) { this.waypointTime = 1; this.waypoint = this.chooseWay(here, a) }
        const w = this.waypoint ?? a
        const last = w === a
        this.drive(input, dt, w.x, w.z, d > 25 ? 10 : last ? 5 : 7, last ? 2.5 : undefined)
        if (d < 4.5) return this.set('brace')
        if (this.inPhase > APPROACH_S) return this.retry()
        return this.phase
      }
      case 'brace':
        this.brake(input)
        if (this.inPhase > BRACE_S) { this.gear.fire(this.stuck); return this.set('fire') }
        return this.phase
      case 'fire':
        this.brake(input)
        this.gear.reel(this.stuck)
        if (this.gear.attachedTo(this.stuck)) { this.freedFor = 0; return this.set('tow') }
        if (this.inPhase > HOOK_WAIT_S && !this.gear.flying()) return this.retry()
        return this.phase
      case 'tow': {
        if (!this.gear.attachedTo(this.stuck)) return this.retry()
        // The grapple pulls both ends alike, so reeling all the way in would drag the rescuer
        // back into the hole. Reel while the cord is long; once it is short, hold the line
        // and let driving away take up the strain.
        const s = this.stuck.body.translation()
        const span = Math.hypot(s.x - here.x, s.y - here.y, s.z - here.z)
        if (span > MIN_SPAN) this.gear.reel(this.stuck); else this.gear.hold(this.stuck)
        const a = this.anchor()
        this.drive(input, dt, a.x + this.pull.x * 30, a.z + this.pull.z * 30, 6)
        if (this.options.kind === 'flipped') this.rightingTorque(dt)
        if (this.free(dt)) { this.gear.release(this.stuck); return this.set('ease') }
        if (this.inPhase > PULL_S) return this.retry()
        return this.phase
      }
      case 'ease':
        this.brake(input)
        return this.inPhase > EASE_S ? this.set('done') : this.phase
    }
    return this.phase
  }

  /** The next point to drive to on the way to the anchor `a`. */
  private chooseWay(here: { x: number; z: number }, a: NavPoint): NavPoint {
    const d = Math.hypot(a.x - here.x, a.z - here.z)
    const nav = this.options.navigator
    if (nav && d > 40) {
      this.route ??= nav.route({ x: here.x, z: here.z }, a, this.pilot.profile)?.points ?? []
      while (this.route.length > 1 && Math.hypot(this.route[0].x - here.x, this.route[0].z - here.z) < 10) this.route.shift()
      if (this.route.length > 1) return this.route[0]
    }
    if (this.clear(here, a)) return a
    const s = this.stuck.body.translation()
    let best: NavPoint | null = null, cost = Infinity
    for (const reach of [10, 16, 24]) for (let k = 0; k < 8; k++) {
      const w = { x: s.x + Math.cos(k * Math.PI / 4) * reach, z: s.z + Math.sin(k * Math.PI / 4) * reach }
      const c = Math.hypot(w.x - here.x, w.z - here.z) + Math.hypot(a.x - w.x, a.z - w.z)
      if (c < cost && this.level(w.x, w.z) && this.clear(here, w) && this.clear(w, a)) { cost = c; best = w }
    }
    return best ?? a
  }

  /** The straight drive from a to b crosses only level, dry ground. */
  private clear(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 1.5)
    for (let i = 1; i < n; i++) {
      const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n
      const liquid = this.terrain.liquidHeightAt?.(x, z)
      if (liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(x, z) < liquid + 0.3) return false
      if (this.terrain.normalAt(x, z, this.up).y < 0.85) return false
    }
    return true
  }

  /** Level, dry ground a vehicle can stand on, sampled around (x, z). */
  private level(x: number, z: number): boolean {
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const liquid = this.terrain.liquidHeightAt?.(x + dx, z + dz)
      if (liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(x + dx, z + dz) < liquid + 0.3) return false
      if (this.terrain.normalAt(x + dx, z + dz, this.up).y < 0.9) return false
    }
    return true
  }

  /** Give up cleanly from outside (rescue cancelled, setting turned off). */
  abort(): void {
    if (this.finished) return
    this.gear.release(this.stuck)
    this.set('failed')
  }

  /** Free: upright, out of any liquid, and moved off the spot (or, flipped, simply upright). */
  private free(dt: number): boolean {
    const p = this.stuck.body.translation()
    this.q.copy(this.stuck.body.rotation())
    this.up.set(0, 1, 0).applyQuaternion(this.q)
    const liquid = this.terrain.liquidHeightAt?.(p.x, p.z)
    const wet = liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(p.x, p.z) <= liquid + 0.3
    const moved = Math.hypot(p.x - this.start.x, p.z - this.start.z)
    const ok = this.up.y > 0.75 && !wet && (this.options.kind === 'flipped' ? true : moved > 3.5)
    this.freedFor = ok ? this.freedFor + dt : 0
    return this.freedFor > 0.5
  }

  /** Try again from a different angle, or give up after the last try. */
  private retry(): TowPhase {
    this.gear.release(this.stuck)
    if (this.attempt >= this.maxAttempts) return this.set('failed')
    this.attempt++
    this.inPhase = 0
    this.route = null
    this.waypointTime = 0
    // Swing the pull line by 35 degrees, alternating sides.
    const angle = (this.attempt % 2 ? -1 : 1) * 0.61
    const c = Math.cos(angle), s = Math.sin(angle)
    this.pull = { x: this.pull.x * c - this.pull.z * s, z: this.pull.x * s + this.pull.z * c }
    return this.set('approach')
  }

  /**
   * The pull of a hook on the roof, not the centre: torque = hitch offset x pull. Only the
   * turning part is added; the cord's own pull at the centre is already applied by the
   * grapple. Applied by whoever owns the stuck vehicle's body (the host, for a bot).
   */
  private rightingTorque(dt: number): void {
    const s = this.stuck.body.translation(), r = this.rescuer.body.translation()
    let dx = r.x - s.x, dy = r.y - s.y, dz = r.z - s.z
    const len = Math.hypot(dx, dy, dz) || 1
    dx /= len; dy /= len; dz /= len
    // Roughly the grapple's own pull on this body: two g, shared with the rescuer.
    const mass = this.stuck.body.mass()
    const force = mass * 9.81 * 2
    const hx = this.up.x * HITCH_UP, hy = this.up.y * HITCH_UP, hz = this.up.z * HITCH_UP
    const tx = hy * dz - hz * dy, ty = hz * dx - hx * dz, tz = hx * dy - hy * dx
    this.stuck.body.applyTorqueImpulse({ x: tx * force * dt, y: ty * force * dt, z: tz * force * dt }, true)
  }

  private drive(input: InputState, dt: number, x: number, z: number, speed: number, stopWithin?: number): void {
    this.goal.x = x; this.goal.z = z; this.goal.speed = speed; this.goal.stopWithin = stopWithin
    this.goal.noReverse = undefined; this.goal.altitude = this.rescuer.kind === 'jet' ? 4 : undefined
    this.pilot.drive(this.goal, input, dt)
  }

  private brake(input: InputState): void {
    input.x = 0; input.y = 0; input.z = 0; input.w = 0; input.brakes = true; input.fire = false
    if (this.rescuer.kind === 'jet') { this.goal.x = this.rescuer.body.translation().x; this.goal.z = this.rescuer.body.translation().z; this.goal.speed = 0; this.goal.altitude = 4; this.goal.stopWithin = 1; this.pilot.drive(this.goal, input, 0.02) }
  }

  private set(phase: TowPhase): TowPhase {
    if (phase !== this.phase) {
      this.phase = phase
      this.inPhase = 0
      this.options.onPhase?.(phase, this.attempt)
    }
    return phase
  }
}

/**
 * CPU lifecycle for vehicle spray, wakes and entry splashes. No three.js and no GPU, so it
 * runs in unit tests; `spray.ts` only copies this state into two instanced batches.
 *
 * Everything lives in typed arrays allocated once at a fixed capacity. Nothing in `step`,
 * `vehicle` or `pack*` allocates, so a fleet skimming the sea makes no garbage per frame.
 *
 * Three kinds of thing:
 * - Droplets: ballistic points under gravity, a few centimetres across, drawn stretched along
 *   their velocity. Mist is the same record with kind 1: large, slow, dragged and soft.
 * - Wake arms: each vehicle owns three trails (left arm, right arm and the churned wash down
 *   the middle). An arm is a ring of points laid down behind the hull as it moves; each point
 *   drifts outward, widens and fades with age, and follows the moving water surface. Joining
 *   consecutive points gives one continuous strip per arm, so nothing stacks.
 * - Rings: one expanding foam circle per entry splash.
 * - Ripplets: a small faint ring where a falling drop lands, so a splash's rain dimples the
 *   water. Only drops big enough to show make one; a small pool, overwritten oldest first.
 *
 * What touches the water shapes the wake (`WakeShape`). A hull leaves the three arms. A Zorb's
 * ball touches at one patch, so it leaves one soft trail from that patch, as wide as the patch
 * and spreading behind it, broken wherever the ball leaves the water, and a soft ring where
 * each skip lands. Soft trails and rings are flagged for the renderer's soft foam.
 */

/** Where the water is. `liquidHeightAt` includes the waves. Optional: without it the caller's y is used. */
export interface SprayWater { liquidHeightAt?(x: number, z: number): number }

export interface SprayCapacity { droplets: number; vehicles: number; points: number; rings: number; ripplets: number }
/** Pools per graphics level: safe, mobile, desktop. */
export function sprayCapacity(tier: number): SprayCapacity {
  const t = Math.max(0, Math.min(2, Math.round(Number.isFinite(tier) ? tier : 0)))
  return [
    { droplets: 384, vehicles: 4, points: 14, rings: 4, ripplets: 16 },
    { droplets: 900, vehicles: 6, points: 24, rings: 6, ripplets: 40 },
    { droplets: 1800, vehicles: 8, points: 36, rings: 8, ripplets: 96 },
  ][t]
}

// Droplet record layout.
const D = 11, DX = 0, DY = 1, DZ = 2, DVX = 3, DVY = 4, DVZ = 5, DAGE = 6, DLIFE = 7, DSIZE = 8, DFLOOR = 9, DKIND = 10
// Wake point layout: position, outward drift velocity, age, life, starting half width, strength, linked to previous.
const W = 12, WX = 0, WY = 1, WZ = 2, WVX = 3, WVZ = 4, WAGE = 5, WLIFE = 6, WWIDTH = 7, WSTRENGTH = 8, WLINK = 9, WSPREAD = 10, WRUN = 11
// Ring layout.
const R = 8, RX = 0, RY = 1, RZ = 2, RAGE = 3, RLIFE = 4, RSIZE = 5, RSTRENGTH = 6, RSOFT = 7
/** Arms per vehicle: left, right and the churned wash down the middle. */
export const ARMS = 3
const GRAVITY = 9.81
/** Foam sits this far above the water it was sampled from, so it never z-fights the sea. */
export const WAKE_LIFT = .04
/** Drop the oldest wake points at this age, seconds, at full speed. */
const WAKE_LIFE = 2.8
/** Smallest drop radius (m) that leaves a ripplet where it lands: splash drops, not fine spray. */
const RIPPLET_DROP = .05
/** Half the beam of a typical hull, metres: where the wash starts and the arms leave from. */
const HULL = .95
/** Index of the centre trail among a vehicle's arms: the wash, or a ball's one trail. */
const CENTRE = 2
/** Metres over which a strip rises from nothing at its live source. */
const HEAD_FADE = 1.5
/** Metres over which a piece of soft trail fades in from where it began and out to where it ended. */
const SOFT_END = 2.5
/** A ball off the water for less than this (s) is skimming, not skipping: its trail stays joined. */
const SKIM_GAP = .12
/**
 * Coming out of the water (`exitSplash`). A hull counts as out only after it has been wholly under:
 * wetted fraction 1, then this many metres deeper; and it fires once, as it breaks back through
 * moving up at least EXIT_RISE m/s. A ball is wholly under once its top is: its base deeper than
 * its diameter. Bobbing, wallowing and floating never get there, so they never fire.
 */
const EXIT_BAND = .3, EXIT_RISE = .3
/** A hull's fraction below which it has broken back out (a ball: its top above the surface). */
const EXIT_OUT = .5
/**
 * Seconds after an exit splash in which the wetted fraction climbing back (the caller eases a
 * surfacing craft's wake back in) is not taken for an entry, unless the craft is falling back in.
 */
const EXIT_QUIET = .6
/**
 * With the craft's depth known: an entry needs its bottom to have been clear of the surface this
 * recently (s). The fraction the caller sends also climbs while a craft is in the water (its wake
 * easing back in as it surfaces, the envelope round a hovering jet dipping), which is no entry.
 */
const ENTRY_CLEAR = .5
/** Buggy mass and half beam, the reference an entry or exit is scaled against. */
const REF_MASS = 30, REF_BEAM = 1.2

/**
 * What meets the water. `ball` is a Zorb's radius, metres (0 for a hull): it touches at one
 * patch, so it leaves one soft trail and soft skip rings instead of a boat's arms and wash.
 */
export interface WakeShape {
  ball: number
  /** Air over the liquid that does not touch it: a hovercraft's cushion or a jet's downwash. */
  air?: 'cushion' | 'downwash' | null
  /** 0..1: how close that air is, 1 at the surface, 0 out of reach. */
  near?: number
  /** Half the craft's beam, metres. */
  beam?: number
  /** The craft's mass, kg: heavier hulls throw a heavier splash. Unset, a buggy's. */
  mass?: number
  /**
   * Metres the craft's top is below the surface (negative above it), and its height top to
   * bottom, from the caller's real colliders (WaterEffects). Given, they decide coming out:
   * the wetted fraction the caller sends fades to nothing once a craft's top is under, so it
   * cannot. Unset, the depth is integrated from the fraction and the vertical speed.
   */
  under?: number
  height?: number
}
const HULL_SHAPE: WakeShape = { ball: 0 }
/**
 * How big a craft's splashes are against a buggy's: by the square root of its mass and its beam,
 * so a tank throws a slab and a buggy a spray. A ball is sized by its own patch instead.
 */
export function sizeScale(shape: WakeShape): number {
  if (shape.ball) return 1
  const m = Number.isFinite(shape.mass) && shape.mass! > 0 ? shape.mass! : REF_MASS
  const b = Number.isFinite(shape.beam) && shape.beam! > 0 ? shape.beam! : REF_BEAM
  return Math.max(.6, Math.min(2.5, Math.sqrt(m / REF_MASS) * .5 + (b / REF_BEAM) * .5))
}
/**
 * Half width of the patch where a ball of radius `r` meets water `depth` deep: the chord of
 * the sphere at that depth, at least a hand's width so a ball just kissing the water still
 * leaves a line, at most the radius.
 */
export function ballPatch(r: number, depth: number): number {
  const d = Math.max(0, Math.min(r, depth))
  return Math.max(.25, Math.min(r, Math.sqrt(Math.max(0, 2 * r * d - d * d))))
}

/**
 * The size of an entry splash for an impact speed (m/s): all of it bounded, none of it ever
 * smaller for a harder hit. Real splashes: a crown thrown up and out round the hole, then the
 * cavity closing and firing a column (the Worthington jet) up the middle, which rises and falls
 * under gravity; a fast oblique entry also throws sheets forward along the direction of travel.
 */
export interface SplashShape {
  /** Droplets in the crown, before the pool's throttle. */
  crown: number
  /** Crown droplets' outward and upward speeds, m/s. */
  crownOut: number
  crownUp: number
  /** Droplets in the column and its height, metres. */
  column: number
  columnHeight: number
  /** Share of a forward sheet (0..1) and its droplets per unit of that share. */
  sheet: number
  /** Mist puffs. */
  mist: number
  /** Foam ring radius, metres, and lifetime, seconds. */
  ringSize: number
  ringLife: number
}
/** The hardest impact a splash grows for; beyond it the splash stays the same size. */
export const SPLASH_MAX_IMPACT = 40
const ramp = (impact: number, from: number, to: number) => Math.max(0, Math.min(1, (impact - from) / (to - from)))
export function splashShape(impact: number): SplashShape {
  const i = Math.max(0, Math.min(SPLASH_MAX_IMPACT, Number.isFinite(impact) ? impact : 0))
  return {
    crown: Math.round(16 + i * 9),
    crownOut: 1 + Math.min(7, i * .28),
    crownUp: 1 + Math.min(11, i * .55),
    // A slow entry is a slosh: no column until about 6 m/s.
    column: Math.round(ramp(i, 6, 30) * 120),
    columnHeight: ramp(i, 6, 40) * 9,
    sheet: ramp(i, 8, 35),
    mist: Math.round(ramp(i, 5, 30) * 30),
    ringSize: 1.6 + Math.min(6, i * .22),
    ringLife: 1.6 + Math.min(2.4, i * .09),
  }
}

/**
 * What entry and exit detection needs of a vehicle that has lost its slot to others (more vehicles
 * on the water than the tier has slots): kept by id, so it neither splashes again on getting a
 * slot back nor misses coming out.
 */
type Crossing = Pick<VehicleState, 'seen' | 'submerged' | 'x' | 'z' | 'depth' | 'deepest' | 'under' | 'exitAt' | 'clearAt'>
interface VehicleState {
  slot: number; seen: number; submerged: number
  x: number; z: number; dirX: number; dirZ: number
  bow: number; tail: number; mist: number
  touching: boolean; speed: number; ball: number
  /** Seconds since it last touched the water. */
  dry: number
  /** Metres below its wholly-wet point (integrated from its vertical speed), or its wetted fraction while not wholly wet. */
  depth: number
  /** Deepest its top went under since it was last wholly under, metres. */
  deepest: number
  /** A breaching ball still shedding sheets of water: seconds left, the breach's size, carried part of a drop. */
  shed: number
  shedSize: number
  shedCarry: number
  /** It has been wholly under since it last came out: an exit may fire. */
  under: boolean
  /** Simulation time of its last exit splash. */
  exitAt: number
  /** Simulation time its bottom was last clear of the surface (with the depth known). */
  clearAt: number
}

export class SpraySim {
  readonly cap: SprayCapacity
  readonly droplets: Float32Array
  dropletCount = 0
  readonly points: Float32Array
  /** Per arm: index of its oldest point in its ring, and how many points it holds. */
  readonly armStart: Int32Array
  readonly armCount: Int32Array
  /** Per arm: live head anchor (x, y, z, half width, strength), drawn from the newest point to the hull. */
  readonly armHead: Float32Array
  readonly armHeadActive: Uint8Array
  readonly rings: Float32Array
  ringCount = 0
  /** Ripplets, in the ring layout; `rippletCount` live, `rippletNext` the slot to overwrite when full. */
  readonly ripplets: Float32Array
  rippletCount = 0
  private rippletNext = 0
  /** Per arm: what it draws as (3 a soft trail, the only kind drawn now; 0 unset). */
  readonly armKind: Uint8Array
  /** Multiplies every soft trail's and ring's strength and width (water.wakeStrength, water.wakeWidth). */
  /**
   * Exit splash scale (water.splash.exit) and how much each metre a hull was under adds to it
   * (water.splash.depthGain). The Zorb breach: its size (water.splash.zorbBreach) and the depth
   * its top went under at which it is full size (water.splash.zorbBreachDepth, metres).
   */
  exitScale = 1
  depthGain = .08
  zorbBreach = 1
  zorbBreachDepth = 8
  /** Entry splashes, and exits, since the simulation began (for tests and evidence). */
  entries = 0
  exits = 0
  /** Of the entries, those flagged as a skip touching down (src/vehicles/skip.ts). */
  touchdowns = 0
  wakeStrength = 1
  wakeWidth = 1
  /**
   * The foam trail behind a moving craft (not its rings): width and how long it lasts, each a
   * multiple of the trail before 25 November 2026 (water.wakeFoamWidth, water.wakeFoamLife).
   * Lasting longer spaces its points further apart over the same fixed pool.
   */
  foamWidth = 1
  foamLife = 1
  /** A broad low swell beside a hull (water.bowSwell); off by default. */
  bowSwell = false
  private vehicles = new Map<string, VehicleState>()
  private crossings = new Map<string, Crossing>()
  /**
   * Share of requested droplets actually emitted. When the pool would overflow, every source is
   * thinned by the same factor instead of overwriting live drops, so density degrades evenly.
   * Steady-state demand is the requested rate times the mean droplet life, both smoothed.
   */
  throttle = 1
  private requested = 0
  private requestRate = 0
  private meanLife = .6
  /** Droplets refused because the pool was full; with the throttle working this stays near zero. */
  refused = 0
  private slotUsed: Uint8Array
  private time = 0
  private seed = 0x5eed
  /** Droplets emitted, for their drawn size. */
  private drops = 0
  /** Bumped whenever anything visible changes, so the renderer packs at most once per change. */
  version = 0
  constructor(cap: SprayCapacity, private water: SprayWater | null = null) {
    this.cap = cap
    this.droplets = new Float32Array(cap.droplets * D)
    this.points = new Float32Array(cap.vehicles * ARMS * cap.points * W)
    this.armStart = new Int32Array(cap.vehicles * ARMS)
    this.armCount = new Int32Array(cap.vehicles * ARMS)
    this.armHead = new Float32Array(cap.vehicles * ARMS * 5)
    this.armHeadActive = new Uint8Array(cap.vehicles * ARMS)
    this.armKind = new Uint8Array(cap.vehicles * ARMS)
    this.ripplets = new Float32Array(cap.ripplets * R)
    this.rings = new Float32Array(cap.rings * R)
    this.slotUsed = new Uint8Array(cap.vehicles)
  }
  setWater(water: SprayWater | null) { this.water = water }
  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296 }
  private surface(x: number, z: number, fallback: number) {
    const h = this.water?.liquidHeightAt?.(x, z)
    return h !== undefined && Number.isFinite(h) ? h : fallback
  }
  get wakePoints() { let n = 0; for (let i = 0; i < this.armCount.length; i++) n += this.armCount[i]; return n }
  get vehicleCount() { return this.vehicles.size }

  clear() {
    this.dropletCount = this.ringCount = this.rippletCount = this.rippletNext = 0
    this.armStart.fill(0); this.armCount.fill(0); this.armHeadActive.fill(0); this.armKind.fill(0); this.slotUsed.fill(0)
    this.vehicles.clear(); this.crossings.clear(); this.version++
  }

  /** Advance everything already emitted. Call once per frame before `vehicle`. */
  step(dt: number) {
    dt = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0))
    this.time += dt
    if (dt === 0) return
    const d = this.droplets
    for (let i = 0; i < this.dropletCount;) {
      const o = i * D, mist = d[o + DKIND] === 1
      d[o + DAGE] += dt
      // Mist hangs and spreads; droplets are small enough that air drag matters a little.
      const drag = mist ? Math.exp(-2.5 * dt) : Math.exp(-.35 * dt)
      d[o + DVX] *= drag; d[o + DVZ] *= drag
      d[o + DVY] = d[o + DVY] * (mist ? drag : 1) - (mist ? .6 : GRAVITY) * dt
      d[o + DX] += d[o + DVX] * dt; d[o + DY] += d[o + DVY] * dt; d[o + DZ] += d[o + DVZ] * dt
      const landed = !mist && d[o + DVY] < 0 && d[o + DY] <= d[o + DFLOOR]
      if (landed && d[o + DSIZE] >= RIPPLET_DROP) this.ripplet(d[o + DX], d[o + DFLOOR], d[o + DZ], d[o + DSIZE])
      if (d[o + DAGE] >= d[o + DLIFE] || landed) {
        this.meanLife += (d[o + DAGE] - this.meanLife) * .01
        const last = (--this.dropletCount) * D
        if (last !== o) d.copyWithin(o, last, last + D)
        continue
      }
      i++
    }
    // Smooth the demand over about a second and set the shared throttle from it.
    this.requestRate += (this.requested / dt - this.requestRate) * Math.min(1, dt * 2)
    this.requested = 0
    const demand = this.requestRate * this.meanLife
    this.throttle = demand > this.cap.droplets * .85 ? this.cap.droplets * .85 / demand : 1
    const p = this.points, P = this.cap.points
    for (let arm = 0; arm < this.armCount.length; arm++) {
      let start = this.armStart[arm], count = this.armCount[arm]
      // Oldest first: drop expired points from the tail of the ring.
      while (count > 0 && p[(arm * P + start) * W + WAGE] + dt >= p[(arm * P + start) * W + WLIFE]) { start = (start + 1) % P; count-- }
      this.armStart[arm] = start; this.armCount[arm] = count
      if (count > 0) p[(arm * P + start) * W + WLINK] = 0
      for (let k = 0; k < count; k++) {
        const o = (arm * P + (start + k) % P) * W
        p[o + WAGE] += dt
        const slow = Math.exp(-.45 * dt)
        p[o + WVX] *= slow; p[o + WVZ] *= slow
        p[o + WX] += p[o + WVX] * dt; p[o + WZ] += p[o + WVZ] * dt
        p[o + WY] = this.surface(p[o + WX], p[o + WZ], p[o + WY] - WAKE_LIFT) + WAKE_LIFT
      }
    }
    const r = this.rings
    for (let i = 0; i < this.ringCount;) {
      const o = i * R
      r[o + RAGE] += dt
      if (r[o + RAGE] >= r[o + RLIFE]) { const last = (--this.ringCount) * R; if (last !== o) r.copyWithin(o, last, last + R); continue }
      r[o + RY] = this.surface(r[o + RX], r[o + RZ], r[o + RY] - WAKE_LIFT) + WAKE_LIFT
      i++
    }
    const q = this.ripplets
    for (let i = 0; i < this.rippletCount;) {
      const o = i * R
      q[o + RAGE] += dt
      if (q[o + RAGE] >= q[o + RLIFE]) { const last = (--this.rippletCount) * R; if (last !== o) q.copyWithin(o, last, last + R); if (this.rippletNext > this.rippletCount) this.rippletNext = 0; continue }
      i++
    }
    for (const [id, s] of this.vehicles) {
      if (this.time - s.seen > 8) { this.slotUsed[s.slot] = 0; for (let a = 0; a < ARMS; a++) this.armHeadActive[s.slot * ARMS + a] = 0; this.vehicles.delete(id) }
      else if (this.time - s.seen > .25) for (let a = 0; a < ARMS; a++) this.armHeadActive[s.slot * ARMS + a] = 0
    }
    for (const [id, c] of this.crossings) if (this.time - c.seen > 8) this.crossings.delete(id)
    this.version++
  }

  private slotFor(id: string, x: number, z: number): VehicleState {
    let s = this.vehicles.get(id)
    if (s) return s
    let slot = this.slotUsed.indexOf(0)
    if (slot < 0) {
      // Full: take the slot of the vehicle seen longest ago.
      let oldest: string | null = null, seen = Infinity
      for (const [k, v] of this.vehicles) if (v.seen < seen) { seen = v.seen; oldest = k }
      const evicted = this.vehicles.get(oldest!)!
      slot = evicted.slot; this.vehicles.delete(oldest!)
      const { seen: was, submerged, x: ex, z: ez, depth, deepest, under, exitAt, clearAt } = evicted
      this.crossings.set(oldest!, { seen: was, submerged, x: ex, z: ez, depth, deepest, under, exitAt, clearAt })
      for (let a = 0; a < ARMS; a++) { this.armCount[slot * ARMS + a] = 0; this.armHeadActive[slot * ARMS + a] = 0 }
    }
    this.slotUsed[slot] = 1
    this.armKind.fill(0, slot * ARMS, slot * ARMS + ARMS)
    s = { slot, seen: this.time, submerged: 0, x, z, dirX: 0, dirZ: 1, bow: 0, tail: 0, mist: 0, touching: false, speed: 0, ball: 0, dry: 0, depth: 0, deepest: 0, under: false, exitAt: -Infinity, clearAt: -Infinity, shed: 0, shedSize: 0, shedCarry: 0 }
    const kept = this.crossings.get(id)
    if (kept) { Object.assign(s, kept, { seen: this.time }); this.crossings.delete(id) }
    this.vehicles.set(id, s)
    return s
  }

  /**
   * One vehicle this frame. `y` is the water surface under it; `submerged` 0 to 1 (for a ball,
   * the share of its bottom metre under water). `shape` says what touches the water. Returns
   * true when this call detected an entry splash.
   */
  vehicle(id: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, submerged: number, dt: number, scale = 1, shape: WakeShape = HULL_SHAPE, touchdown = false): boolean {
    if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return false
    dt = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0))
    scale = Math.max(.25, Math.min(3, scale))
    const sub = Math.max(0, Math.min(1, Number.isFinite(submerged) ? submerged : 0))
    const s = this.slotFor(id, x, z)
    const teleported = Math.hypot(x - s.x, z - s.z) > 20
    const speed = Math.hypot(vx, vz)
    if (speed > .3) { s.dirX = vx / speed; s.dirZ = vz / speed }
    const fx = s.dirX, fz = s.dirZ, sx = -fz, sz = fx
    // From dry or nearly dry only, so a hull bobbing back down after a landing does not splash again.
    // A fast hull touching down flat (a jet skimming, a Zorb skipping) splashes too: a skip.
    // `touchdown`: a skip landing again (src/vehicles/skip.ts), which may not have dried the hull's
    // whole envelope in a low hop but is an entry all the same.
    // Not while coming up from under (one exit splash, not an entry too), unless falling back in.
    const surfacing = s.under || (this.time - s.exitAt < EXIT_QUIET && vy > -1.5)
    const depthKnown = Number.isFinite(shape.under) && Number.isFinite(shape.height) && shape.height! > 0
    if (depthKnown && shape.under! + shape.height! < 0) s.clearAt = this.time
    // In: its bottom clear of the water a moment ago and in it now.
    const wasClear = !depthKnown || (this.time - s.clearAt < ENTRY_CLEAR && shape.under! + shape.height! >= 0)
    const entering = !surfacing && (touchdown || wasClear) && (touchdown || (s.submerged < .1 && sub - s.submerged > .1 && (vy < -1.5 || (speed > 9 && sub - s.submerged > .15))))
    s.seen = this.time; s.speed = speed
    // A trail joins points laid while the ball stayed on the water; a skimming ball that lifts
    // for a moment (under SKIM_GAP) is still on it, a skip is not.
    const skipped = s.dry > SKIM_GAP
    s.touching = sub > 0
    s.dry = sub > 0 ? 0 : s.dry + dt
    const ball = Number.isFinite(shape.ball) && shape.ball > 0 ? shape.ball : 0
    const near = shape.air && sub <= 0 ? Math.max(0, Math.min(1, Number.isFinite(shape.near) ? shape.near! : 0)) : 0
    if (near > .02) { s.touching = true; s.dry = 0 }
    // What each arm draws as: 1 a crest, 2 a churned patch, 3 a trail.
    // Every strip draws as a soft trail now: no crest lines.
    for (let a = 0; a < ARMS; a++) this.armKind[s.slot * ARMS + a] = 3
    s.ball = ball
    // Wholly under (its top below the surface, with the depth known) it touches no surface: no bow
    // spray, no wake and no trail. A ball deep under still reports a sliver wetted, and laid a full
    // trail strip on the water over it, a pale patch hiding what was under.
    const wholeUnder = depthKnown && shape.under! > 0
    if (sub > 0 && dt > 0 && !wholeUnder) {
      // Bow spray: rate grows with speed; a slow wade sheds only the odd drop.
      // Demand is measured before throttling; measuring after it would chase its own tail.
      const want = this.throttle
      const rawBow = Math.min(this.cap.droplets * 1.5, speed * speed * 2 + speed * 8) * sub * (speed > .8 ? 1 : 0)
      const rawTail = speed > 7 ? Math.min(this.cap.droplets, (speed - 7) * 18) * sub : 0
      const rawMist = speed > 5 ? Math.min(50, (speed - 5) * 3) * sub : 0
      this.requested += (rawBow + rawTail + rawMist) * dt
      const bowRate = want * rawBow
      let n = due(bowRate, dt, s.bow); s.bow = carried
      for (let i = 0; i < n; i++) {
        const sign = i % 2 ? 1 : -1, out = .4 + this.random() * 1.2, up = .5 + this.random() * 1.5
        const ox = fx * (1.3 + this.random() * .4) + sx * sign * (.6 + this.random() * .35), oz = fz * (1.3 + this.random() * .4) + sz * sign * (.6 + this.random() * .35)
        const k = Math.min(1.6, .15 + speed * .07)
        this.drop(x + ox, y + .05, z + oz, vx * .6 + sx * sign * out * k * 1.7, up * k * 2.2, vz * .6 + sz * sign * out * k * 1.7, .007 + this.random() * .012, y, 0, scale)
      }
      // Rooster tail: a column thrown up behind a fast hull, falling back into its own wake.
      const tailRate = want * rawTail
      n = due(tailRate, dt, s.tail); s.tail = carried
      for (let i = 0; i < n; i++) {
        const k = speed * (.22 + this.random() * .2), j = (this.random() - .5) * .9
        this.drop(x - fx * 1.6 + sx * j * .4, y + .1, z - fz * 1.6 + sz * j * .4, vx * .35 + sx * j * 1.2, k, vz * .35 + sz * j * 1.2, .015 + this.random() * .02, y, 0, scale)
      }
      // A low, soft sheet of mist along the hull at speed.
      const mistRate = want * rawMist
      n = due(mistRate, dt, s.mist); s.mist = carried
      for (let i = 0; i < n; i++) {
        const sign = i % 2 ? 1 : -1, along = (this.random() - .5) * 2.4
        this.drop(x + fx * along + sx * sign * 1.1, y + .25, z + fz * along + sz * sign * 1.1, vx * .4 + sx * sign * 1.2, .5 + this.random() * .5, vz * .4 + sz * sign * 1.2, .45 + this.random() * .35, y, 1, scale)
      }
      if (ball) this.trail(s, x, y, z, speed, sub, teleported || skipped, scale)
      else this.lay(s, x, y, z, speed, sub, teleported || skipped, scale)
    } else if (near > .02 && dt > 0) this.air(s, x, y, z, vx, vz, speed, shape.air === 'cushion', near, Math.max(.5, shape.beam ?? 1.5) * scale, dt, teleported || skipped, scale)
    else this.off(s)
    // Size and weight: a tank throws a slab, a buggy a spray.
    const size = sizeScale(shape)
    if (entering && touchdown) this.touchdowns++
    if (entering) this.splash(x, y, z, vx, Math.min(vy, 0), vz, scale * size, ball)
    // Coming out. Depth below the wholly-wet point is integrated from the vertical speed (the
    // caller gives the surface and the wetted fraction, not the hull's height): a ball is wholly
    // wet with its bottom metre under, a hull with its whole envelope under.
    let out: boolean
    const under = shape.under, height = shape.height
    if (Number.isFinite(under) && Number.isFinite(height) && height! > 0) {
      // The caller's depth of the craft's top: wholly under past the band, out once more than
      // half its height is clear (a ball: its centre above the surface).
      if (under! > EXIT_BAND) { s.under = true; s.deepest = Math.max(s.deepest, under!) }
      out = under! < -height! * EXIT_OUT
    } else {
      if (sub < .999) s.depth = sub
      else s.depth = Math.max(s.depth, 1) - vy * dt
      const top = ball ? 2 * ball : 1
      if (s.depth > top + EXIT_BAND) { s.under = true; s.deepest = Math.max(s.deepest, s.depth - top) }
      out = ball ? s.depth < top : sub < EXIT_OUT
    }
    if (s.under && out && vy > EXIT_RISE && !teleported) {
      const b = this.exitSplash(x, y, z, vx, vy, vz, scale * size, ball, s.deepest)
      if (ball && b > 0) { s.shed = .35 + .3 * Math.min(1.5, b); s.shedSize = b; s.shedCarry = 0 }
      s.under = false; s.deepest = 0; s.exitAt = this.time
    } else if (s.under && out) { s.under = false; s.deepest = 0 }
    // Sheets of water running off a breaching ball as it rises clear, from its sides.
    if (s.shed > 0 && ball && dt > 0) {
      s.shed -= dt
      const under = Number.isFinite(shape.under) ? shape.under! : -ball, cy = y - under - ball
      const due = 260 * s.shedSize * dt * Math.min(1, scale) + s.shedCarry, n = Math.floor(due)
      s.shedCarry = due - n
      for (let i = 0; i < n; i++) {
        const a = this.random() * Math.PI * 2, e = (this.random() * .55 - .15) * Math.PI / 2, c = Math.cos(e)
        const nx = Math.cos(a) * c, ny = Math.sin(e), nz = Math.sin(a) * c, out = .8 + this.random() * 1.6
        if (cy + ny * ball < y) continue
        this.drop(x + nx * ball, cy + ny * ball, z + nz * ball, vx + nx * out, vy * (.35 + this.random() * .3), vz + nz * out, (.08 + this.random() * .14) * Math.sqrt(s.shedSize), y, 0, scale, true)
      }
    }
    s.submerged = sub; s.x = x; s.z = z
    this.version++
    return entering
  }

  private drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, floor: number, kind: number, scale: number, priority = false) {
    // When full, new spray is refused; a splash with priority (the Zorb breach) takes the oldest
    // live droplet instead, so the showpiece is whole at the smallest pool.
    let i: number
    if (this.dropletCount < this.cap.droplets) i = this.dropletCount++
    else if (priority) i = this.oldest()
    else { this.refused++; return }
    const d = this.droplets, o = i * D
    d[o + DX] = x; d[o + DY] = y; d[o + DZ] = z; d[o + DVX] = vx; d[o + DVY] = vy; d[o + DVZ] = vz
    // Ballistic droplets live until they land; the cap only bounds a stray one.
    // Drawn sizes vary (0.6 to 1.7 times), from their own hash so the motion's random
    // sequence is untouched.
    d[o + DAGE] = 0; d[o + DLIFE] = kind ? .7 + this.random() * .5 : 3; d[o + DSIZE] = size * scale * (kind ? 1 : .6 + 1.1 * hashUnit(++this.drops) ** 1.5)
    d[o + DFLOOR] = this.surface(x, z, floor); d[o + DKIND] = kind
  }

  /** A mist puff with a given life, drawing nothing from the shared random sequence. */
  private mistAt(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, floor: number, scale: number, life: number) {
    if (this.dropletCount >= this.cap.droplets) { this.refused++; return }
    const o = (this.dropletCount++) * D, d = this.droplets
    d[o + DX] = x; d[o + DY] = y; d[o + DZ] = z; d[o + DVX] = vx; d[o + DVY] = vy; d[o + DVZ] = vz
    d[o + DAGE] = 0; d[o + DLIFE] = life; d[o + DSIZE] = size * scale; d[o + DFLOOR] = this.surface(x, z, floor); d[o + DKIND] = 1
  }

  /** Impact speed for an entry: all of the vertical speed and part of the horizontal. */
  static impact(vx: number, vy: number, vz: number): number { return Math.hypot(vy, .45 * Math.hypot(vx, vz)) }

  /** A splash with no vehicle behind it (a shot hitting the surface): as an entry at that velocity. */
  impact(x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number): void { this.splash(x, y, z, vx, vy, vz, scale) }

  private splash(x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number, ball = 0) {
    this.entries++
    const impact = SpraySim.impact(vx, vy, vz)
    const k = splashShape(impact)
    // Whatever the impact, a splash takes at most half the pool, shared out by the throttle.
    const budget = Math.floor(this.cap.droplets * .5)
    const want = Math.max(1, k.crown + k.column + k.sheet * 80 + k.mist)
    const share = Math.min(this.throttle * scale, budget / want)
    // Splash drops are drawn far larger than spray: each stands for a clot of aerated water,
    // which is what reads as white mass from twenty metres away.
    // Crown: up and out round the hole.
    const crown = Math.round(k.crown * share)
    for (let i = 0; i < crown; i++) {
      const a = i / crown * Math.PI * 2 + this.random() * .3, r = 1 + this.random() * .5, out = (.6 + this.random() * .8) * k.crownOut
      this.drop(x + Math.cos(a) * r, y + .05, z + Math.sin(a) * r, Math.cos(a) * out, (.6 + this.random() * .6) * k.crownUp, Math.sin(a) * out, .05 + this.random() * .07, y, 0, scale)
    }
    // Column: big drops fired straight up from the middle; speed for its height, so it rises
    // and falls back with a believable second or so of hang.
    const column = Math.round(k.column * share), jet = Math.sqrt(2 * GRAVITY * k.columnHeight)
    for (let i = 0; i < column; i++) {
      const a = this.random() * Math.PI * 2, r = this.random() * .35, lift = jet * (.55 + this.random() * .45)
      this.drop(x + Math.cos(a) * r, y + .1, z + Math.sin(a) * r, Math.cos(a) * .5, lift, Math.sin(a) * .5, .1 + this.random() * .2, y, 0, scale)
    }
    // Sheets thrown forward in a fan along the direction of travel.
    const h = Math.hypot(vx, vz)
    if (h > 1 && k.sheet > 0) {
      const fx = vx / h, fz = vz / h, sheet = Math.round(k.sheet * 80 * share)
      for (let i = 0; i < sheet; i++) {
        const spread = (this.random() - .5) * 1.2, c = Math.cos(spread), sn = Math.sin(spread)
        const dx = fx * c - fz * sn, dz = fz * c + fx * sn, out = h * (.35 + this.random() * .35)
        this.drop(x + dx * 1.2, y + .05, z + dz * 1.2, dx * out, (.3 + this.random() * .5) * k.crownUp, dz * out, .04 + this.random() * .06, y, 0, scale)
      }
    }
    // Fine mist at the top of a tall column, where its spray breaks up.
    if (column > 0) {
      const fine = Math.round(column * .2)
      // Its own hash, not the shared random sequence, so every other particle moves as before.
      const h = () => hashUnit(++this.drops)
      for (let i = 0; i < fine; i++) {
        const a = h() * Math.PI * 2, r = h() * .8, top = k.columnHeight * (.55 + h() * .45)
        this.mistAt(x + Math.cos(a) * r, y + top, z + Math.sin(a) * r, Math.cos(a) * .6, .3 + h() * .6, Math.sin(a) * .6, .35 + h() * .3, y, scale, .7 + h() * .5)
      }
    }
    // Mist that hangs for a moment round the impact.
    const mist = Math.round(k.mist * share)
    for (let i = 0; i < mist; i++) {
      const a = this.random() * Math.PI * 2, r = 1 + this.random() * k.ringSize * .5
      this.drop(x + Math.cos(a) * r, y + .4 + this.random() * k.columnHeight * .3, z + Math.sin(a) * r, Math.cos(a) * 1.2 + vx * .1, .4 + this.random() * .8, Math.sin(a) * 1.2 + vz * .1, .9 + this.random() * .9, y, 1, scale)
    }
    const i = this.ringCount < this.cap.rings ? this.ringCount++ : 0, o = i * R, r = this.rings
    r[o + RX] = x; r[o + RY] = y + WAKE_LIFT; r[o + RZ] = z; r[o + RAGE] = 0; r[o + RLIFE] = k.ringLife
    r[o + RSIZE] = k.ringSize * scale; r[o + RSTRENGTH] = Math.min(1, .4 + impact * .06); r[o + RSOFT] = 0
    if (ball) {
      // A skip: a soft ring spreading from the patch the ball struck, as wide as that patch to
      // start with, so a skipping run leaves a dotted line of spreading rings.
      r[o + RSIZE] = Math.max(k.ringSize, ballPatch(ball, .6) * 2.2) * scale * this.wakeWidth
      r[o + RSTRENGTH] = Math.min(1, .35 + impact * .05) * this.wakeStrength; r[o + RLIFE] = k.ringLife + .8; r[o + RSOFT] = 1
    }
    this.lastSplash = impact
  }
  /** Index of the live droplet that has lived the largest share of its life. */
  private oldest(): number {
    const d = this.droplets
    let best = 0, worst = -1
    for (let i = 0; i < this.dropletCount; i++) { const o = i * D, a = d[o + DAGE] / Math.max(1e-3, d[o + DLIFE]); if (a > worst) { worst = a; best = i } }
    return best
  }

  /**
   * Coming out of the water, going up: water carried up with the hull and shed. A column that
   * follows the hull briefly and falls back, sheets thrown off its sides, run-off falling from its
   * footprint, and a soft ring where it left; scaled by its upward speed. A ball rising from
   * deep (the Zorb breach) is the largest splash in the game: a dome of water it lifts, a tall
   * column, a wide crown and a strong ring, bigger the deeper it came from (`deepest`, metres its
   * top went under). It takes priority over older droplets, so it is whole even at the smallest
   * pool. A slow crawl up a shore gives a few drips and a faint ring.
   */
  private exitSplash(x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number, ball: number, deepest: number): number {
    this.exits++
    const rise = Math.max(0, vy)
    if (!(rise > 0)) return 0
    if (ball) return this.breach(x, y, z, vx, rise, vz, scale, ball, deepest)
    const depth = 1 + this.depthGain * Math.max(0, Math.min(30, Number.isFinite(deepest) ? deepest : 0))
    const strength = rise * depth * this.exitScale
    // 0 (a crawl) to 1 (a jet launching out), at most 3.
    const k = Math.min(3, strength / 10)
    const reach = 1.3
    const want = Math.max(1, (60 + 40 + 30) * k + 8)
    const share = Math.min(this.throttle * scale, Math.floor(this.cap.droplets * .5) / want)
    const n = (count: number) => Math.round(count * share)
    // Column: water lifted with the hull, following it briefly and falling back.
    for (let i = 0, c = n(60 * k); i < c; i++) {
      const a = this.random() * Math.PI * 2, r = this.random() * reach * .6
      this.drop(x + Math.cos(a) * r, y + .1, z + Math.sin(a) * r, vx * .5 + Math.cos(a) * .4, rise * (.7 + this.random() * .45), vz * .5 + Math.sin(a) * .4, .08 + this.random() * .12, y, 0, scale)
    }
    // Sheets shed off the sides.
    for (let i = 0, c = n(40 * k); i < c; i++) {
      const a = this.random() * Math.PI * 2, out = 1 + this.random() * 2.2 * Math.min(1.5, k + .3)
      this.drop(x + Math.cos(a) * reach, y + .2, z + Math.sin(a) * reach, vx * .4 + Math.cos(a) * out, rise * (.1 + this.random() * .3) + .3, vz * .4 + Math.sin(a) * out, .04 + this.random() * .06, y, 0, scale)
    }
    // Run-off: drips falling from the footprint (all a crawl up a shore gives, with the ring).
    for (let i = 0, c = n(30 * k + 8); i < c; i++) {
      const a = this.random() * Math.PI * 2, r = Math.sqrt(this.random()) * reach
      this.drop(x + Math.cos(a) * r, y + .25 + this.random() * .3, z + Math.sin(a) * r, vx * .8, this.random() * .4, vz * .8, .015 + this.random() * .02, y, 0, scale)
    }
    this.ring(x, y, z, reach * 1.8 * scale, Math.min(1, .2 + k * .3), 1.4 + Math.min(2, k))
    return k
  }

  /**
   * The Zorb breach, the largest splash in the game: a ball of radius `ball` bursting up through
   * the surface at `rise` m/s from `deepest` metres under. Its size `b` is the depth over
   * water.splash.zorbBreachDepth and the exit speed over 10 m/s, times water.splash.zorbBreach:
   * from 2.5 m a modest pop (about a quarter), from 8 m at 10 m/s full size. A crown wider than the
   * ball thrown out and up from its rim, a dome of water lifted on top of it, a column falling back
   * behind, a cloud of mist round the crown, sheets shed off its sides for a moment after (vehicle,
   * `shed`) and two rings of foam spreading where it came through. Its drops take priority over
   * older ones, so it is whole even at the smallest pool. Returns `b`.
   */
  private breach(x: number, y: number, z: number, vx: number, rise: number, vz: number, scale: number, ball: number, deepest: number): number {
    const depth = Math.max(0, Math.min(30, Number.isFinite(deepest) ? deepest : 0))
    const b = Math.max(.15, Math.min(1.5, depth / Math.max(.5, this.zorbBreachDepth))) * Math.max(.4, Math.min(1.5, rise / 10)) * this.zorbBreach
    if (!(b > 0)) return 0
    const R = ball, grow = Math.sqrt(b)
    // Drops it wants; the pool is shared out if it cannot hold them all (it can at Low and up).
    const want = (200 + 90 + 110) * b
    const share = Math.min(scale, this.cap.droplets / Math.max(1, want))
    const n = (count: number) => Math.round(count * share)
    // Crown: thrown out and up from the rim, landing two to three radii out.
    for (let i = 0, c = n(200 * b); i < c; i++) {
      const a = i / Math.max(1, c) * Math.PI * 2 + this.random() * .15, r = R * (.85 + this.random() * .3)
      const out = (2.5 + this.random() * 4.5) * grow * Math.min(2, .5 + R / 3), up = (3.5 + this.random() * 6) * grow
      this.drop(x + Math.cos(a) * r, y + .1, z + Math.sin(a) * r, vx * .3 + Math.cos(a) * out, up, vz * .3 + Math.sin(a) * out, (.12 + this.random() * .22) * grow, y, 0, scale, true)
    }
    // Dome: water lifted on the top of the ball, carried up with it and sliding off.
    for (let i = 0, c = n(90 * b); i < c; i++) {
      const a = this.random() * Math.PI * 2, r = Math.sqrt(this.random()) * R * .7, out = .5 + this.random() * 1.5
      this.drop(x + Math.cos(a) * r, y + .2, z + Math.sin(a) * r, vx + Math.cos(a) * out, rise * (.85 + this.random() * .3), vz + Math.sin(a) * out, (.2 + this.random() * .3) * grow, y, 0, scale, true)
    }
    // Column: the water it pulled up behind it, rising more slowly and falling back.
    for (let i = 0, c = n(110 * b); i < c; i++) {
      const a = this.random() * Math.PI * 2, r = this.random() * R * .45
      this.drop(x + Math.cos(a) * r, y + .1, z + Math.sin(a) * r, vx * .5 + Math.cos(a) * .3, rise * (.45 + this.random() * .45), vz * .5 + Math.sin(a) * .3, (.1 + this.random() * .2) * grow, y, 0, scale, true)
    }
    // Mist: soft puffs round the crown, hanging for a moment.
    for (let i = 0, c = n(36 * b); i < c; i++) {
      const a = this.random() * Math.PI * 2, r = R * (1 + this.random() * .8)
      this.mistAt(x + Math.cos(a) * r, y + .4 + this.random() * R, z + Math.sin(a) * r, Math.cos(a) * (1 + this.random() * 2) * grow, .5 + this.random() * 1.5, Math.sin(a) * (1 + this.random() * 2) * grow, (1 + this.random() * 1.4) * grow, y, scale, 1.1 + this.random() * .9)
    }
    // Foam: a strong ring at the rim and a wider, fainter one, both lingering.
    this.ring(x, y, z, R * (2.2 + .8 * b) * scale, Math.min(1, .55 + .3 * b), 2.2 + 1.4 * b)
    this.ring(x, y, z, R * (3.4 + 1.6 * b) * scale, Math.min(1, .3 + .25 * b), 3 + 1.6 * b)
    return b
  }

  /** A soft foam ring spreading on the surface from (x, z). */
  private ring(x: number, y: number, z: number, size: number, strength: number, life: number) {
    const i = this.ringCount < this.cap.rings ? this.ringCount++ : 0, o = i * R, rr = this.rings
    rr[o + RX] = x; rr[o + RY] = y + WAKE_LIFT; rr[o + RZ] = z; rr[o + RAGE] = 0; rr[o + RLIFE] = life
    rr[o + RSIZE] = size; rr[o + RSTRENGTH] = strength; rr[o + RSOFT] = 1
  }

  /** A small ring where a drop of `size` (radius, m) landed. */
  private ripplet(x: number, y: number, z: number, size: number) {
    if (!this.cap.ripplets || !Number.isFinite(x + y + z)) return
    let i: number
    if (this.rippletCount < this.cap.ripplets) i = this.rippletCount++
    else { i = this.rippletNext; this.rippletNext = (this.rippletNext + 1) % this.cap.ripplets }
    const o = i * R, q = this.ripplets
    q[o + RX] = x; q[o + RY] = y + WAKE_LIFT; q[o + RZ] = z; q[o + RAGE] = 0; q[o + RLIFE] = .6 + Math.min(.6, size * 6)
    q[o + RSIZE] = Math.max(.2, Math.min(.6, size * 4)); q[o + RSTRENGTH] = Math.min(.35, .12 + size); q[o + RSOFT] = 2
  }
  /** Impact speed of the most recent entry splash, m/s: for the ripple field and evidence. */
  lastSplash = 0

  /**
   * Lay one point of an arm at (x, z), joined to the last unless `fresh` (a skip, a teleport,
   * the first touch after leaving the liquid), and keep its live head there. `half` is its half
   * width, `life` seconds, `spread` how many half widths it gains a second, `drift` its outward
   * speed along the side (sx, sz), m/s. Points are laid by distance, so a stopped source adds none.
   */
  private point(arm: number, x: number, y: number, z: number, half: number, strength: number, life: number, spread: number, spacing: number, fresh: boolean, sx = 0, sz = 0, drift = 0) {
    const P = this.cap.points, p = this.points, head = arm * 5, h = this.armHead
    h[head] = x; h[head + 1] = this.surface(x, z, y) + WAKE_LIFT; h[head + 2] = z; h[head + 3] = half; h[head + 4] = strength
    this.armHeadActive[arm] = 1
    let count = this.armCount[arm]
    if (count > 0 && !fresh) {
      const o = (arm * P + (this.armStart[arm] + count - 1) % P) * W
      if (Math.hypot(x - p[o + WX], z - p[o + WZ]) < spacing) return
    }
    if (count === P) { this.armStart[arm] = (this.armStart[arm] + 1) % P; count--; p[(arm * P + this.armStart[arm]) * W + WLINK] = 0 }
    const o = (arm * P + (this.armStart[arm] + count) % P) * W
    p[o + WX] = x; p[o + WY] = h[head + 1]; p[o + WZ] = z; p[o + WVX] = sx * drift; p[o + WVZ] = sz * drift
    p[o + WAGE] = 0; p[o + WLIFE] = life; p[o + WWIDTH] = half; p[o + WSTRENGTH] = strength; p[o + WSPREAD] = spread
    p[o + WLINK] = count > 0 && !fresh ? 1 : 0
    // Metres from where this piece began, for its soft ends.
    if (p[o + WLINK]) { const l = (arm * P + (this.armStart[arm] + count - 1) % P) * W; p[o + WRUN] = p[l + WRUN] + Math.hypot(x - p[l + WX], z - p[l + WZ]) } else p[o + WRUN] = 0
    this.armCount[arm] = count + 1
  }
  private off(s: VehicleState, except = -1) { for (let a = 0; a < ARMS; a++) if (a !== except) this.armHeadActive[s.slot * ARMS + a] = 0 }

  /**
   * A ball's one soft trail, laid from its contact patch. As wide as the patch (which grows
   * with how deep the ball sits), spreading behind it, faster at speed; strongest at the patch
   * and gone about 40 m behind whatever the speed.
   */
  private trail(s: VehicleState, x: number, y: number, z: number, speed: number, sub: number, fresh: boolean, scale: number) {
    this.off(s, CENTRE)
    if (speed < .3) { this.off(s); return }
    // A skimming ball throws water wider than the chord it dips: never narrower than a 15 cm dip.
    const half = ballPatch(s.ball, Math.max(sub, .15)) * .85 * scale * this.wakeWidth * this.foamWidth
    // Nothing at a drift, full by a brisk roll; a ball barely touching leaves a little less. A big
    // ball's patch is metres wide: drifting, it laid a short wide strip of full foam on the water,
    // a pale rectangle, so the trail comes in with speed.
    const roll = Math.min(1, Math.max(0, (speed - .3) / 2.2))
    const strength = Math.min(1, .5 + speed / 8) * roll * roll * (3 - 2 * roll) * Math.min(1, .7 + sub * 2) * this.wakeStrength
    this.point(s.slot * ARMS + CENTRE, x, y, z, half, strength, Math.max(1.5, Math.min(4, 40 / Math.max(1, speed))) * this.foamLife, .3 + Math.min(.6, speed * .03), Math.max(.5, speed * 2.4 * this.foamLife / (this.cap.points - 2)), fresh)
  }

  /**
   * A hull: one wake from the stern, dense foam there that spreads and breaks into lace and
   * patches behind, wider and longer lived the faster it goes and the deeper it sits. With
   * `bowSwell` on, a broad, low, short-lived swell of disturbed water beside the hull too
   * (off by default: arms beside a hull read as drawn lines).
   */
  private lay(s: VehicleState, x: number, y: number, z: number, speed: number, sub: number, fresh: boolean, scale: number) {
    if (speed < .8) { this.off(s); return }
    const fx = s.dirX, fz = s.dirZ, sx = -fz, sz = fx, P = this.cap.points, wet = Math.min(1, .5 + sub)
    const spacing = Math.max(.6, speed * 2.4 / (P - 2)), k = this.wakeStrength * wet, w = scale * this.wakeWidth
    const trailSpacing = Math.max(.6, speed * 2.4 * this.foamLife / (P - 2))
    if (this.bowSwell) for (const side of [-1, 1]) {
      const ax = x + fx * .4 + sx * side * HULL * 1.6, az = z + fz * .4 + sz * side * HULL * 1.6
      this.point(s.slot * ARMS + (side < 0 ? 0 : 1), ax, y, az, (1 + speed * .03) * w, Math.min(1, speed / 8) * .3 * k, .7, 1, spacing, fresh, sx * side, sz * side, speed * .12)
    } else { this.armHeadActive[s.slot * ARMS] = 0; this.armHeadActive[s.slot * ARMS + 1] = 0 }
    const strength = Math.min(1, .3 + speed / 8) * k
    this.point(s.slot * ARMS + CENTRE, x - fx * 1.4, y, z - fz * 1.4, HULL * (1.1 + Math.min(.6, speed * .03)) * w * this.foamWidth, strength, Math.max(1, Math.min(3, 30 / Math.max(1, speed))) * this.foamLife, .5 + Math.min(.6, speed * .03), trailSpacing, fresh)
  }

  /**
   * Air over the liquid without touching it: a hovercraft's cushion, or a jet's downwash.
   * `near` is 1 at the surface, 0 out of reach. A cushion flattens a wide patch and throws a
   * ring of spray round the craft, leaving a wide soft trail; a downwash streaks the surface
   * under a low jet and raises mist, and only when close.
   */
  private air(s: VehicleState, x: number, y: number, z: number, vx: number, vz: number, speed: number, cushion: boolean, near: number, beam: number, dt: number, fresh: boolean, scale: number) {
    this.off(s, CENTRE)
    const fx = s.dirX, fz = s.dirZ, k = this.wakeStrength
    // Spray: a cushion sheds it all round its skirt; a downwash blows it back and up as mist.
    const rawDrops = (cushion ? 30 + speed * 5 : speed * 1.5) * near
    const rawMist = (cushion ? 4 + speed * .6 : 10 + speed * .8) * near
    this.requested += (rawDrops + rawMist) * dt
    let n = due(this.throttle * rawDrops, dt, s.bow); s.bow = carried
    for (let i = 0; i < n; i++) {
      const a = this.random() * Math.PI * 2, r = beam * (cushion ? 1.3 + this.random() * .5 : .4 * this.random()), out = cushion ? 1.5 + this.random() * 1.5 : .5
      const cx = Math.cos(a), cz = Math.sin(a)
      this.drop(x + cx * r, y + .05, z + cz * r, vx * .5 + cx * out - (cushion ? 0 : fx * speed * .3), (cushion ? 1 : .6) + this.random() * 1.5, vz * .5 + cz * out - (cushion ? 0 : fz * speed * .3), .006 + this.random() * .01, y, 0, scale)
    }
    n = due(this.throttle * rawMist, dt, s.mist); s.mist = carried
    for (let i = 0; i < n; i++) {
      const a = this.random() * Math.PI * 2, r = beam * (cushion ? 1.2 + this.random() * .4 : this.random() * .6)
      this.drop(x + Math.cos(a) * r - fx * (cushion ? 0 : 1.5), y + .2, z + Math.sin(a) * r - fz * (cushion ? 0 : 1.5), vx * .3 + Math.cos(a) * 1.2, .3 + this.random() * .6, vz * .3 + Math.sin(a) * 1.2, .5 + this.random() * .4, y, 1, scale)
    }
    if (speed < .5 && !cushion) { this.off(s); return }
    const w = scale * this.wakeWidth * this.foamWidth, spacing = Math.max(.6, speed * 2.4 * this.foamLife / (this.cap.points - 2)), life = this.foamLife
    if (cushion) this.point(s.slot * ARMS + CENTRE, x, y, z, beam * 1.1 * Math.sqrt(near) * w, near * Math.min(1, .45 + speed / 10) * k, Math.max(1.5, Math.min(4, 30 / Math.max(1, speed))) * life, .4 + Math.min(.5, speed * .02), spacing, fresh)
    else this.point(s.slot * ARMS + CENTRE, x - fx * 2, y, z - fz * 2, (.8 + speed * .02) * w, near ** 1.5 * Math.min(1, speed / 15) * k, Math.max(1, Math.min(2.5, 20 / Math.max(1, speed))) * life, .6, spacing, fresh)
  }

  /** The world moved by a whole tile under the player: move everything with it. */
  shift(dx: number, dz: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return
    for (let i = 0; i < this.dropletCount; i++) { this.droplets[i * D + DX] += dx; this.droplets[i * D + DZ] += dz }
    for (let i = 0; i < this.points.length; i += W) { this.points[i + WX] += dx; this.points[i + WZ] += dz }
    for (let i = 0; i < this.armHead.length; i += 5) { this.armHead[i] += dx; this.armHead[i + 2] += dz }
    for (let i = 0; i < this.ringCount; i++) { this.rings[i * R + RX] += dx; this.rings[i * R + RZ] += dz }
    for (let i = 0; i < this.rippletCount; i++) { this.ripplets[i * R + RX] += dx; this.ripplets[i * R + RZ] += dz }
    for (const s of this.vehicles.values()) { s.x += dx; s.z += dz }
    for (const c of this.crossings.values()) { c.x += dx; c.z += dz }
    this.version++
  }

  /**
   * Droplets as two vec4 per instance: (x, y, z, radius) and (vx, vy, vz, alpha with mist
   * flagged as alpha + 2). Returns the instance count.
   */
  packDroplets(a: Float32Array, b: Float32Array): number {
    const d = this.droplets, n = Math.min(this.dropletCount, a.length >> 2, b.length >> 2)
    for (let i = 0; i < n; i++) {
      const o = i * D, mist = d[o + DKIND] === 1, age = d[o + DAGE], life = d[o + DLIFE]
      let alpha: number
      if (mist) alpha = Math.sin(Math.PI * Math.min(1, age / life)) * .55
      else {
        // Fade in over the first few frames, out over the last 40 cm of the fall.
        const above = d[o + DY] - d[o + DFLOOR]
        alpha = Math.min(1, age / .04) * (d[o + DVY] < 0 ? Math.min(1, Math.max(0, above / .4)) : 1) * Math.min(1, (life - age) / .2)
      }
      const size = mist ? d[o + DSIZE] * (1 + age * 1.6) : d[o + DSIZE]
      a[i * 4] = d[o + DX]; a[i * 4 + 1] = d[o + DY]; a[i * 4 + 2] = d[o + DZ]; a[i * 4 + 3] = size
      b[i * 4] = d[o + DVX]; b[i * 4 + 1] = d[o + DVY]; b[i * 4 + 2] = d[o + DVZ]; b[i * 4 + 3] = mist ? alpha + 2 : alpha
    }
    return n
  }

  /**
   * Surface foam as flat quads, four vec4 per instance: start (x, y, z, half width), end
   * (x, y, z, half width), sides (start side x, z, end side x, z) and look (alpha start, alpha
   * end, age start, age end). A ring has zero sides, its centre in start and radius in start.w.
   */
  packSurface(a: Float32Array, b: Float32Array, side: Float32Array, look: Float32Array): number {
    const max = Math.min(a.length, b.length, side.length, look.length) >> 2
    const p = this.points, P = this.cap.points
    let n = 0
    for (let arm = 0; arm < this.armCount.length; arm++) {
      const count = this.armCount[arm], start = this.armStart[arm], head = this.armHeadActive[arm] === 1
      const total = count + (head ? 1 : 0)
      this.pieceEnds(arm, head)
      for (let k = 1; k < total && n < max; k++) {
        if (k < count && p[(arm * P + (start + k) % P) * W + WLINK] === 0) continue
        n = this.segment(arm, k - 1, k, total, n, a, b, side, look)
      }
    }
    n = this.packRings(this.rings, this.ringCount, n, max, a, b, side, look)
    n = this.packRings(this.ripplets, this.rippletCount, n, max, a, b, side, look)
    return n
  }

  /** Rings as foam instances: zero sides, centre and radius in a, style (0 hard, 1 soft, 2 ripplet) in b.w. */
  private packRings(r: Float32Array, count: number, n: number, max: number, a: Float32Array, b: Float32Array, side: Float32Array, look: Float32Array) {
    for (let i = 0; i < count && n < max; i++, n++) {
      const o = i * R, t = r[o + RAGE] / r[o + RLIFE]
      a[n * 4] = r[o + RX]; a[n * 4 + 1] = r[o + RY]; a[n * 4 + 2] = r[o + RZ]; a[n * 4 + 3] = r[o + RSIZE] * (.35 + .65 * (1 - (1 - t) ** 2))
      b.fill(0, n * 4, n * 4 + 4); side.fill(0, n * 4, n * 4 + 4); b[n * 4 + 3] = r[o + RSOFT]
      const alpha = r[o + RSTRENGTH] * Math.min(1, r[o + RAGE] / .08) * (1 - t) ** 1.5
      look[n * 4] = alpha; look[n * 4 + 1] = alpha; look[n * 4 + 2] = r[o + RAGE]; look[n * 4 + 3] = t
    }
    return n
  }

  /**
   * For a soft arm: the run (metres) at which each point's piece of trail ends, into `ends`, so
   * a piece fades out toward where the ball left the water. The piece still being laid has no
   * end yet (Infinity): it runs on under the ball.
   */
  private ends = new Float32Array(64)
  private headRun = Infinity
  private pieceEnds(arm: number, head: boolean) {
    const P = this.cap.points, p = this.points, count = this.armCount[arm], start = this.armStart[arm]
    if (this.ends.length < count) this.ends = new Float32Array(P)
    let k = count - 1, end = head ? Infinity : count ? p[(arm * P + (start + k) % P) * W + WRUN] : 0
    // Where the live head reaches along the newest piece, for the fade-in from the source.
    this.headRun = Infinity
    if (head && count) { const o = (arm * P + (start + k) % P) * W, h = arm * 5; this.headRun = p[o + WRUN] + Math.hypot(this.armHead[h] - p[o + WX], this.armHead[h + 2] - p[o + WZ]) }
    for (; k >= 0; k--) {
      const o = (arm * P + (start + k) % P) * W
      this.ends[k] = end
      // This point began its piece: the piece before it ended at the point before.
      if (p[o + WLINK] === 0 && k > 0) end = p[(arm * P + (start + k - 1) % P) * W + WRUN]
    }
  }

  /** Point k of an arm in draw order, oldest first; index `count` is the live head. */
  private node(arm: number, k: number, out: Float32Array, at: number) {
    const count = this.armCount[arm]
    if (k >= count) {
      const h = arm * 5
      out[at] = this.armHead[h]; out[at + 1] = this.armHead[h + 1]; out[at + 2] = this.armHead[h + 2]
      // Nothing at the source itself: the strip rises from it over its first segment, so it
      // never ends square at a skirt, a stern or under a jet.
      out[at + 3] = this.armHead[h + 3]; out[at + 4] = 0; out[at + 5] = 0
      return
    }
    const p = this.points, o = (arm * this.cap.points + (this.armStart[arm] + k) % this.cap.points) * W
    const t = p[o + WAGE] / p[o + WLIFE]
    out[at] = p[o + WX]; out[at + 1] = p[o + WY]; out[at + 2] = p[o + WZ]
    // The wash spreads fast behind the hull; the crests stay thin.
    out[at + 3] = p[o + WWIDTH] * (1 + p[o + WAGE] * p[o + WSPREAD])
    // A soft trail holds its strength longer, fades out at the end of its life, and fades in
    // and out over SOFT_END at the ends of each piece, so no piece starts or stops square.
    const ends = smoothstep01(p[o + WRUN] / SOFT_END) * smoothstep01((this.ends[k] - p[o + WRUN]) / SOFT_END) * (this.ends[k] === Infinity ? smoothstep01((this.headRun - p[o + WRUN]) / HEAD_FADE) : 1)
    out[at + 4] = p[o + WSTRENGTH] * Math.max(0, 1 - t) ** .6 * ends
    out[at + 5] = t
  }
  private scratch = new Float32Array(24)
  private segment(arm: number, k0: number, k1: number, total: number, n: number, a: Float32Array, b: Float32Array, side: Float32Array, look: Float32Array) {
    const s = this.scratch
    // Previous, start, end and next nodes give each end its own tangent, so joints meet.
    this.node(arm, Math.max(0, k0 - 1), s, 0); this.node(arm, k0, s, 6); this.node(arm, k1, s, 12); this.node(arm, Math.min(total - 1, k1 + 1), s, 18)
    sideOf(s[0], s[2], s[12], s[14], side, n * 4)
    sideOf(s[6], s[8], s[18], s[20], side, n * 4 + 2)
    // A strip folds on the inside of a bend tighter than its half width. Estimate the bend
    // radius from the turn between the two end sides and fade the segment as it approaches that.
    const turn = Math.acos(Math.max(-1, Math.min(1, side[n * 4] * side[n * 4 + 2] + side[n * 4 + 1] * side[n * 4 + 3])))
    const length = Math.hypot(s[12] - s[6], s[14] - s[8]), half = Math.max(s[9], s[15])
    const fold = turn > 1e-3 ? Math.max(0, Math.min(1, (length / turn / Math.max(half, 1e-3) - 1) / .5)) : 1
    // Strips carry side vectors of length three (a soft trail); rings have none.
    const mark = this.armKind[arm] || (arm % ARMS === CENTRE ? 2 : 1)
    if (mark > 1) for (let j = 0; j < 4; j++) side[n * 4 + j] *= mark
    a[n * 4] = s[6]; a[n * 4 + 1] = s[7]; a[n * 4 + 2] = s[8]; a[n * 4 + 3] = s[9]
    b[n * 4] = s[12]; b[n * 4 + 1] = s[13]; b[n * 4 + 2] = s[14]; b[n * 4 + 3] = s[15]
    look[n * 4] = s[10] * fold; look[n * 4 + 1] = s[16] * fold; look[n * 4 + 2] = s[11]; look[n * 4 + 3] = s[17]
    return n + 1
  }
}

/** Unit vector to the left of the ground direction from a to b, written at out[at], out[at + 1]. */
function sideOf(ax: number, az: number, bx: number, bz: number, out: Float32Array, at: number) {
  let tx = bx - ax, tz = bz - az; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l
  out[at] = -tz; out[at + 1] = tx
}

/** Fraction left over by the last `due`, so emission counts do not depend on frame rate. */
let carried = 0
/** Whole emissions due at `rate` per second this frame; the remainder goes to `carried`. No allocation. */
function due(rate: number, dt: number, carry: number): number {
  const total = carry + Math.max(0, Number.isFinite(rate) ? rate : 0) * dt, count = Math.floor(total)
  carried = total - count
  return count
}

/** A number in 0..1 from an integer, for drawn variation that must not touch the random sequence. */
function hashUnit(i: number) { let n = Math.imul(i ^ 0x9e3779b9, 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }

function smoothstep01(x: number) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }

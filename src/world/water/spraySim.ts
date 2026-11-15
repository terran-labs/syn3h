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
 */

/** Where the water is. `liquidHeightAt` includes the waves. Optional: without it the caller's y is used. */
export interface SprayWater { liquidHeightAt?(x: number, z: number): number }

export interface SprayCapacity { droplets: number; vehicles: number; points: number; rings: number }
/** Pools per graphics level: safe, mobile, desktop. */
export function sprayCapacity(tier: number): SprayCapacity {
  const t = Math.max(0, Math.min(2, Math.round(Number.isFinite(tier) ? tier : 0)))
  return [
    { droplets: 384, vehicles: 4, points: 14, rings: 4 },
    { droplets: 900, vehicles: 6, points: 24, rings: 6 },
    { droplets: 1800, vehicles: 8, points: 36, rings: 8 },
  ][t]
}

// Droplet record layout.
const D = 11, DX = 0, DY = 1, DZ = 2, DVX = 3, DVY = 4, DVZ = 5, DAGE = 6, DLIFE = 7, DSIZE = 8, DFLOOR = 9, DKIND = 10
// Wake point layout: position, outward drift velocity, age, life, starting half width, strength, linked to previous.
const W = 10, WX = 0, WY = 1, WZ = 2, WVX = 3, WVZ = 4, WAGE = 5, WLIFE = 6, WWIDTH = 7, WSTRENGTH = 8, WLINK = 9
// Ring layout.
const R = 7, RX = 0, RY = 1, RZ = 2, RAGE = 3, RLIFE = 4, RSIZE = 5, RSTRENGTH = 6
/** Arms per vehicle: left, right and the churned wash down the middle. */
export const ARMS = 3
const GRAVITY = 9.81
/** Foam sits this far above the water it was sampled from, so it never z-fights the sea. */
export const WAKE_LIFT = .04
/** Drop the oldest wake points at this age, seconds, at full speed. */
const WAKE_LIFE = 2.8

interface VehicleState {
  slot: number; seen: number; submerged: number
  x: number; z: number; dirX: number; dirZ: number
  bow: number; tail: number; mist: number
  touching: boolean; speed: number
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
  private vehicles = new Map<string, VehicleState>()
  private slotUsed: Uint8Array
  private time = 0
  private seed = 0x5eed
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
    this.dropletCount = this.ringCount = 0
    this.armStart.fill(0); this.armCount.fill(0); this.armHeadActive.fill(0); this.slotUsed.fill(0)
    this.vehicles.clear(); this.version++
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
      if (d[o + DAGE] >= d[o + DLIFE] || landed) {
        const last = (--this.dropletCount) * D
        if (last !== o) d.copyWithin(o, last, last + D)
        continue
      }
      i++
    }
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
        const slow = Math.exp(-1.1 * dt)
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
    for (const [id, s] of this.vehicles) {
      if (this.time - s.seen > 8) { this.slotUsed[s.slot] = 0; for (let a = 0; a < ARMS; a++) this.armHeadActive[s.slot * ARMS + a] = 0; this.vehicles.delete(id) }
      else if (this.time - s.seen > .25) for (let a = 0; a < ARMS; a++) this.armHeadActive[s.slot * ARMS + a] = 0
    }
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
      slot = this.vehicles.get(oldest!)!.slot; this.vehicles.delete(oldest!)
      for (let a = 0; a < ARMS; a++) { this.armCount[slot * ARMS + a] = 0; this.armHeadActive[slot * ARMS + a] = 0 }
    }
    this.slotUsed[slot] = 1
    s = { slot, seen: this.time, submerged: 0, x, z, dirX: 0, dirZ: 1, bow: 0, tail: 0, mist: 0, touching: false, speed: 0 }
    this.vehicles.set(id, s)
    return s
  }

  /**
   * One vehicle this frame. `y` is the water surface under it; `submerged` 0 to 1. Returns
   * true when this call detected an entry splash.
   */
  vehicle(id: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, submerged: number, dt: number, scale = 1): boolean {
    if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return false
    dt = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0))
    scale = Math.max(.25, Math.min(3, scale))
    const sub = Math.max(0, Math.min(1, Number.isFinite(submerged) ? submerged : 0))
    const s = this.slotFor(id, x, z)
    const teleported = Math.hypot(x - s.x, z - s.z) > 20
    const speed = Math.hypot(vx, vz)
    if (speed > .3) { s.dirX = vx / speed; s.dirZ = vz / speed }
    const fx = s.dirX, fz = s.dirZ, sx = -fz, sz = fx
    const entering = sub - s.submerged > .15 && vy < -1.5
    s.seen = this.time; s.speed = speed
    s.touching = sub > 0
    if (sub > 0 && dt > 0) {
      // Bow spray: rate grows with speed; a slow wade sheds only the odd drop.
      const bowRate = Math.min(this.cap.droplets * 1.2, speed * speed * 1.4 + speed * 6) * sub * (speed > .8 ? 1 : 0)
      let n = due(bowRate, dt, s.bow); s.bow = carried
      for (let i = 0; i < n; i++) {
        const sign = i % 2 ? 1 : -1, out = .4 + this.random() * 1.2, up = .5 + this.random() * 1.5
        const ox = fx * (1.3 + this.random() * .4) + sx * sign * (.6 + this.random() * .35), oz = fz * (1.3 + this.random() * .4) + sz * sign * (.6 + this.random() * .35)
        const k = Math.min(1.6, .15 + speed * .07)
        this.drop(x + ox, y + .05, z + oz, vx * .55 + sx * sign * out * k * 2.2, up * k * 2.4, vz * .55 + sz * sign * out * k * 2.2, .02 + this.random() * .025, y, 0, scale)
      }
      // Rooster tail: a column thrown up behind a fast hull, falling back into its own wake.
      const tailRate = speed > 7 ? Math.min(this.cap.droplets, (speed - 7) * 18) * sub : 0
      n = due(tailRate, dt, s.tail); s.tail = carried
      for (let i = 0; i < n; i++) {
        const k = speed * (.22 + this.random() * .2), j = (this.random() - .5) * .9
        this.drop(x - fx * 1.6 + sx * j * .4, y + .1, z - fz * 1.6 + sz * j * .4, vx * .35 + sx * j * 1.2, k, vz * .35 + sz * j * 1.2, .025 + this.random() * .03, y, 0, scale)
      }
      // A low, soft sheet of mist along the hull at speed.
      const mistRate = speed > 5 ? Math.min(40, (speed - 5) * 2.2) * sub : 0
      n = due(mistRate, dt, s.mist); s.mist = carried
      for (let i = 0; i < n; i++) {
        const sign = i % 2 ? 1 : -1, along = (this.random() - .5) * 2.4
        this.drop(x + fx * along + sx * sign * 1.1, y + .25, z + fz * along + sz * sign * 1.1, vx * .4 + sx * sign * 1.2, .5 + this.random() * .5, vz * .4 + sz * sign * 1.2, .45 + this.random() * .35, y, 1, scale)
      }
      this.lay(s, x, y, z, speed, teleported, scale)
    } else for (let a = 0; a < ARMS; a++) this.armHeadActive[s.slot * ARMS + a] = 0
    if (entering) this.splash(x, y, z, -vy, scale)
    s.submerged = sub; s.x = x; s.z = z
    this.version++
    return entering
  }

  private drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, floor: number, kind: number, scale: number) {
    // When full, overwrite a random live droplet rather than dropping new spray on the floor.
    const i = this.dropletCount < this.cap.droplets ? this.dropletCount++ : Math.floor(this.random() * this.cap.droplets)
    const d = this.droplets, o = i * D
    d[o + DX] = x; d[o + DY] = y; d[o + DZ] = z; d[o + DVX] = vx; d[o + DVY] = vy; d[o + DVZ] = vz
    // Ballistic droplets live until they land; the cap only bounds a stray one.
    d[o + DAGE] = 0; d[o + DLIFE] = kind ? .7 + this.random() * .5 : 3; d[o + DSIZE] = size * scale
    d[o + DFLOOR] = this.surface(x, z, floor); d[o + DKIND] = kind
  }

  private splash(x: number, y: number, z: number, impact: number, scale: number) {
    const n = Math.min(Math.floor(this.cap.droplets * .5), Math.round((20 + impact * 14) * scale))
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + this.random() * .3, r = 1 + this.random() * .5, out = (1 + this.random() * 1.2) * Math.min(6, impact * .3)
      this.drop(x + Math.cos(a) * r, y + .05, z + Math.sin(a) * r, Math.cos(a) * out, (.6 + this.random() * .6) * Math.min(9, impact * .7), Math.sin(a) * out, .025 + this.random() * .035, y, 0, scale)
    }
    const i = this.ringCount < this.cap.rings ? this.ringCount++ : 0, o = i * R, r = this.rings
    r[o + RX] = x; r[o + RY] = y + WAKE_LIFT; r[o + RZ] = z; r[o + RAGE] = 0; r[o + RLIFE] = 1.6 + Math.min(1.4, impact * .08)
    r[o + RSIZE] = (1.6 + Math.min(4, impact * .3)) * scale; r[o + RSTRENGTH] = Math.min(1, .4 + impact * .06)
  }

  /** Extend the three arms of a vehicle's wake. Points are laid by distance, so a stationary hull adds none. */
  private lay(s: VehicleState, x: number, y: number, z: number, speed: number, teleported: boolean, scale: number) {
    const P = this.cap.points, p = this.points, fx = s.dirX, fz = s.dirZ, sx = -fz, sz = fx
    const moving = speed > .8
    const strength = Math.min(1, speed / 7)
    // Space points so a full ring spans the whole wake lifetime: length then grows with speed.
    const spacing = Math.max(.6, speed * WAKE_LIFE / (P - 2))
    for (let a = 0; a < ARMS; a++) {
      const arm = s.slot * ARMS + a, side = a === 0 ? -1 : a === 1 ? 1 : 0
      const ax = x - fx * 1.5 + sx * side * .8, az = z - fz * 1.5 + sz * side * .8
      const halfWidth = (side ? .22 + speed * .018 : .5 + speed * .03) * scale
      const head = arm * 5
      if (!moving) { this.armHeadActive[arm] = 0; continue }
      const h = this.armHead
      h[head] = ax; h[head + 1] = this.surface(ax, az, y) + WAKE_LIFT; h[head + 2] = az; h[head + 3] = halfWidth; h[head + 4] = strength
      this.armHeadActive[arm] = 1
      let count = this.armCount[arm]
      if (count > 0 && !teleported) {
        const o = (arm * P + (this.armStart[arm] + count - 1) % P) * W
        if (Math.hypot(ax - p[o + WX], az - p[o + WZ]) < spacing) continue
      }
      if (count === P) { this.armStart[arm] = (this.armStart[arm] + 1) % P; count--; p[(arm * P + this.armStart[arm]) * W + WLINK] = 0 }
      const o = (arm * P + (this.armStart[arm] + count) % P) * W
      p[o + WX] = ax; p[o + WY] = h[head + 1]; p[o + WZ] = az
      // Arms spread outward at roughly the Kelvin angle; the centre wash stays put and widens.
      const drift = side * speed * .2
      p[o + WVX] = sx * drift; p[o + WVZ] = sz * drift
      p[o + WAGE] = 0; p[o + WLIFE] = side ? WAKE_LIFE : WAKE_LIFE * .6
      p[o + WWIDTH] = halfWidth; p[o + WSTRENGTH] = side ? strength : strength * .8
      p[o + WLINK] = count > 0 && !teleported ? 1 : 0
      this.armCount[arm] = count + 1
    }
  }

  /** The world moved by a whole tile under the player: move everything with it. */
  shift(dx: number, dz: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return
    for (let i = 0; i < this.dropletCount; i++) { this.droplets[i * D + DX] += dx; this.droplets[i * D + DZ] += dz }
    for (let i = 0; i < this.points.length; i += W) { this.points[i + WX] += dx; this.points[i + WZ] += dz }
    for (let i = 0; i < this.armHead.length; i += 5) { this.armHead[i] += dx; this.armHead[i + 2] += dz }
    for (let i = 0; i < this.ringCount; i++) { this.rings[i * R + RX] += dx; this.rings[i * R + RZ] += dz }
    for (const s of this.vehicles.values()) { s.x += dx; s.z += dz }
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
      for (let k = 1; k < total && n < max; k++) {
        if (k < count && p[(arm * P + (start + k) % P) * W + WLINK] === 0) continue
        n = this.segment(arm, k - 1, k, total, n, a, b, side, look)
      }
    }
    const r = this.rings
    for (let i = 0; i < this.ringCount && n < max; i++, n++) {
      const o = i * R, t = r[o + RAGE] / r[o + RLIFE]
      a[n * 4] = r[o + RX]; a[n * 4 + 1] = r[o + RY]; a[n * 4 + 2] = r[o + RZ]; a[n * 4 + 3] = r[o + RSIZE] * (.35 + .65 * (1 - (1 - t) ** 2))
      b.fill(0, n * 4, n * 4 + 4); side.fill(0, n * 4, n * 4 + 4)
      const alpha = r[o + RSTRENGTH] * Math.min(1, r[o + RAGE] / .08) * (1 - t) ** 1.5
      look[n * 4] = alpha; look[n * 4 + 1] = alpha; look[n * 4 + 2] = r[o + RAGE]; look[n * 4 + 3] = t
    }
    return n
  }

  /** Point k of an arm in draw order, oldest first; index `count` is the live head. */
  private node(arm: number, k: number, out: Float32Array, at: number) {
    const count = this.armCount[arm]
    if (k >= count) {
      const h = arm * 5
      out[at] = this.armHead[h]; out[at + 1] = this.armHead[h + 1]; out[at + 2] = this.armHead[h + 2]
      out[at + 3] = this.armHead[h + 3]; out[at + 4] = this.armHead[h + 4] * .9; out[at + 5] = 0
      return
    }
    const p = this.points, o = (arm * this.cap.points + (this.armStart[arm] + k) % this.cap.points) * W
    const t = p[o + WAGE] / p[o + WLIFE]
    out[at] = p[o + WX]; out[at + 1] = p[o + WY]; out[at + 2] = p[o + WZ]
    out[at + 3] = p[o + WWIDTH] * (1 + p[o + WAGE] * .9)
    out[at + 4] = p[o + WSTRENGTH] * Math.max(0, 1 - t) ** 1.4
    out[at + 5] = t
  }
  private scratch = new Float32Array(24)
  private segment(arm: number, k0: number, k1: number, total: number, n: number, a: Float32Array, b: Float32Array, side: Float32Array, look: Float32Array) {
    const s = this.scratch
    // Previous, start, end and next nodes give each end its own tangent, so joints meet.
    this.node(arm, Math.max(0, k0 - 1), s, 0); this.node(arm, k0, s, 6); this.node(arm, k1, s, 12); this.node(arm, Math.min(total - 1, k1 + 1), s, 18)
    sideOf(s[0], s[2], s[12], s[14], side, n * 4)
    sideOf(s[6], s[8], s[18], s[20], side, n * 4 + 2)
    a[n * 4] = s[6]; a[n * 4 + 1] = s[7]; a[n * 4 + 2] = s[8]; a[n * 4 + 3] = s[9]
    b[n * 4] = s[12]; b[n * 4 + 1] = s[13]; b[n * 4 + 2] = s[14]; b[n * 4 + 3] = s[15]
    look[n * 4] = s[10]; look[n * 4 + 1] = s[16]; look[n * 4 + 2] = s[11]; look[n * 4 + 3] = s[17]
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

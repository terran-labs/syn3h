/**
 * Plasma Thunder's fireworks (the owner, 18 November 2026: "burst into beautiful fireworks
 * displays when they finally detonate ... use them like flares where everyone can see where
 * you're at"). A detonation on the ground sends a star shell up thunder.flareHeight metres, and
 * the burst is there; one in the air or on a vehicle bursts where it is.
 *
 * Shapes, chosen from the shot so every client draws the same one (thunderRules.fireworkShape):
 *   peony          a sphere of stars;
 *   chrysanthemum  a sphere of stars with long trails;
 *   ring           a tilted ring, with a few stars of the second colour inside;
 *   willow         slow, drooping, long golden trails;
 *   palm           a few big comets thrown up and out;
 *   crossette      stars that split into four, part way out.
 * Then for all: a crackle of white twinkles, and slow embers falling and fading.
 *
 * Colours from the shooter's two vehicle colours, lifted so a dark paint still shows. Fog off,
 * so a burst is seen from across the world. At night the ground under it lights up (the light
 * disc of ImpactPulses, no real light).
 *
 * Every star is a spark in one SparkBatch, written once when the burst is made, including the
 * later stages (born later, at positions worked out here from the same formula the shader uses).
 * At most MAX_BURSTS are alive at once: the batch holds exactly that many bursts' worth, and a
 * new burst reuses the oldest one's slots. Five hundred stars per burst at High at most.
 */
import * as T from 'three/webgpu'
import type { Game } from '../../core/Game'
import { graphicsLevel } from '../../core/quality'
import { ImpactPulses } from '../pulse'
import { SparkBatch, type SparkSpec } from '../impact/SparkBatch'
import { fireworkSize, fireworkSmoke, fireworkWidth } from '../impact/params'
import { flashSprite } from '../impact/flashSprite'
import { ParticleBatch } from '../../vehicles/effects/ParticleBatch'
import { dustSprite } from '../../vehicles/effects/sprites'
import { vehicleNightAmount } from '../../vehicles/skins/nightReadability'
import { fireworkShape, type FireworkShape } from '../thunderRules'

export const MAX_BURSTS = 6
/** Stars of the main burst, by graphics level (0 Minimal, 1 Low and Medium, 2 High and up). */
const STARS = [60, 90, 220] as const
/** Room in the batch for one burst: the main stars, splits or comet trails, crackle, embers, the shell. */
const PER_BURST = [180, 260, 520] as const
/** Seconds the star shell takes to climb (Lasers delays the map ping and sound by as much). */
export const CLIMB_SECONDS = 1.4
/** Smoke puffs for one burst, by graphics level: the cloud, the shell's trail and a share of the stars' trails. */
const SMOKE = [20, 60, 200] as const
/** Every how many stars leaves a smoke trail, by graphics level, and puffs to a trail. */
const SMOKE_EVERY = [10, 6, 4] as const, SMOKE_PUFFS = [1, 2, 4] as const
/** Stars are this much wider than their old widths: thick enough to hold their colour. */
const WIDTH = 4
/**
 * Stars slow this many times faster than their old drag, and leave that much faster, so a burst
 * reaches its full size in about half a second (as a real shell does) instead of fading on the
 * way out. The size, speed over drag, is unchanged by it.
 */
const SNAP = 1.8
/** Smoke puffs' strength before fx.fireworks.smoke: the dust sprite is made faint for tyre dust. */
const SMOKE_ALPHA = 4.5
const GRAVITY = 9.8

export interface BurstSpec {
  /** Where it detonated. */
  at: T.Vector3
  /** Metres the shell climbs before the burst; 0 to burst at `at`. */
  climb: number
  /** Height of the ground under it, for the light it throws; -Infinity for none. */
  ground: number
  /** The shooter's two colours. */
  colors: readonly [T.Color, T.Color]
  seed: number
}

/** A spark's position `t` seconds after birth, as the shader works it out (SparkBatch). */
function travel(o: T.Vector3, v: T.Vector3, drag: number, gravity: number, t: number, out: T.Vector3): T.Vector3 {
  const k = Math.max(0.01, drag), keep = (1 - Math.exp(-k * t)) / k
  return out.set(o.x + v.x * keep, o.y + v.y * keep - 0.5 * GRAVITY * gravity * t * t, o.z + v.z * keep)
}

export class Fireworks {
  private stars!: SparkBatch
  private readonly light: ImpactPulses
  /** The pop at the moment of the burst: a small sun by day, a bloom at night. */
  private flash!: ParticleBatch
  /**
   * By day, every star again, blended normally in its colour at full saturation: additive light
   * adds nothing to a white cloud and little to a noon sky, so this is what shows the shape (as
   * a daytime display reads by coloured smoke). Faded out, then hidden, at night.
   */
  private dayStars!: SparkBatch
  /** Daytime smoke, blended normally so it darkens a bright sky: what shows a burst at noon. */
  private smoke!: ParticleBatch
  private level = -1
  private clock = 0
  private rand = 0
  private readonly ends: number[] = []
  private readonly lights: { at: T.Vector3; time: number; radius: number; color: T.Color }[] = []
  private readonly spec: SparkSpec = { life: 2, width: 0.1, drag: 1.2, gravity: 0.35, streak: 0.06, normal: { x: 0, y: 1, z: 0 }, bounce: -1 }
  private readonly o = new T.Vector3()
  private readonly v = new T.Vector3()
  private readonly v2 = new T.Vector3()
  private readonly dayColor = new T.Color()
  private readonly trails: { at: T.Vector3; size: number; delay: number }[] = []
  private readonly p = new T.Vector3()
  private readonly c = new T.Color()
  private readonly palette = [new T.Color(), new T.Color(), new T.Color()]
  readonly stats = { bursts: 0, stars: 0, last: '' as FireworkShape | '' }

  constructor(private readonly game: Game) {
    this.light = new ImpactPulses(game, 'glow')
    this.rebuild()
  }

  /** Bursts alive now (at most MAX_BURSTS). */
  get alive(): number { return this.ends.filter(e => e > this.clock).length }

  private rebuild(): void {
    this.level = Math.max(0, Math.min(2, Number(graphicsLevel.value)))
    this.stars?.dispose()
    this.stars = new SparkBatch(MAX_BURSTS * PER_BURST[this.level], 'thunder fireworks')
    this.stars.clock.value = this.clock
    // Long streaks for fast stars, and their own colour rather than an impact spark's white-hot.
    this.stars.maxLength.value = 14; this.stars.heat.value = 0.15
    this.game.scene.add(this.stars.mesh)
    this.flash?.dispose(); this.smoke?.dispose(); this.dayStars?.dispose()
    this.dayStars = new SparkBatch(MAX_BURSTS * PER_BURST[this.level], 'thunder fireworks by day', true)
    this.dayStars.maxLength.value = 14; this.dayStars.clock.value = this.clock
    this.game.scene.add(this.dayStars.mesh)
    this.flash = new ParticleBatch(MAX_BURSTS * 2, flashSprite, true, 1)
    this.smoke = new ParticleBatch(MAX_BURSTS * SMOKE[this.level], dustSprite, false, this.level === 0 ? 1 : 2)
    this.flash.clock.value = this.smoke.clock.value = this.clock
    // Fog off, as for the stars: a burst high and far would otherwise fade into the sky colour.
    this.flash.mesh.material.fog = false; this.smoke.mesh.material.fog = false
    this.game.scene.add(this.flash.mesh, this.smoke.mesh)
  }

  /** A seeded sequence for one burst, so its shape and scatter come from the shot. */
  private next(): number {
    this.rand = (Math.imul(this.rand ^ (this.rand >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0
    return this.rand / 4294967296
  }

  burst(spec: BurstSpec): void {
    this.rand = spec.seed >>> 0
    const shape = fireworkShape(spec.seed), level = this.level, budget = PER_BURST[level]
    let used = 0
    // While `trailing`, every SMOKE_EVERY-th star also leaves smoke along its path (made below).
    let trailing = false, trailSize = 0
    const emit = (at: T.Vector3, v: T.Vector3, s: SparkSpec, color: T.Color, delay: number) => {
      if (used >= budget) return
      this.stars.emit(at, v, s, color, delay); used++
      // Its daytime twin: the same path, in the colour brought down to a plain, saturated paint.
      const top = Math.max(color.r, color.g, color.b, 1e-3)
      this.dayStars.emit(at, v, s, this.dayColor.setRGB(color.r / top * 0.8, color.g / top * 0.8, color.b / top * 0.8), delay)
      if (!trailing || used % SMOKE_EVERY[level] !== 0) return
      for (let k = 1; k <= SMOKE_PUFFS[level]; k++) {
        const t = k * 0.28
        if (t < s.life * 0.8) this.trails.push({ at: travel(at, v, s.drag, s.gravity, t, new T.Vector3()), size: trailSize, delay: delay + t })
      }
    }
    // Colours: the shooter's two paints, lifted so a dark paint still shows, and white-gold.
    const [a, b, gold] = this.palette
    for (const [out, from] of [[a, spec.colors[0]], [b, spec.colors[1]]] as const) {
      // Full strength in its own hue (a dark paint keeps its hue, not lifted toward white); a
      // grey paint, which has no hue to keep, is lifted to a bright silver.
      out.copy(from)
      const top = Math.max(out.r, out.g, out.b), low = Math.min(out.r, out.g, out.b)
      if (top < 0.02 || (top - low) / top < 0.15) out.setRGB(0.85, 0.88, 1)
      else out.multiplyScalar(1 / top)
      out.multiplyScalar(4.2)
    }
    gold.setRGB(4.4, 2.6, 0.7)
    // Smoke: grey, faintly the shooter's first colour.
    const grey = this.c.setRGB(0.72, 0.72, 0.74).lerp(new T.Color(a.r / 4.2, a.g / 4.2, a.b / 4.2), 0.18).clone()
    let puffs = 0
    const puff = (at: T.Vector3, life: number, size: number, grow: number, delay: number) => {
      if (puffs >= SMOKE[level]) return
      this.smoke.emit(at, this.v2.set((this.next() - 0.5) * 0.6, -0.4, (this.next() - 0.5) * 0.6), life, size, grow, grey, delay); puffs++
    }

    const s = this.spec
    let delay = 0
    const top = this.o.copy(spec.at)
    if (spec.climb > 0) {
      // The star shell: up from the detonation, slowing to a stop at the top as the burst comes.
      const g = 2 * spec.climb / (CLIMB_SECONDS * CLIMB_SECONDS)
      // Five short segments, each born fresh where the last one was, so the head stays bright all
      // the way up (a spark fades over its life) and is gone, under the pop, at the top.
      s.width = 1.6; s.drag = 0.01; s.gravity = g / GRAVITY; s.streak = 0.1
      for (let k = 0; k < 5; k++) {
        const t = k / 5 * CLIMB_SECONDS, from = this.p.copy(spec.at).setY(spec.at.y + g * CLIMB_SECONDS * t - 0.5 * g * t * t)
        s.life = CLIMB_SECONDS / 5 * 1.25
        emit(from, this.v.set(0, g * (CLIMB_SECONDS - t), 0), s, this.c.copy(gold).multiplyScalar(1.5), t)
      }
      // Its trail: sparks shed on the way up, hanging and fading behind it, and by day smoke.
      s.life = 1.1; s.width = 0.9; s.drag = 2; s.gravity = 0.3; s.streak = 0.05
      for (let k = 1; k <= 12; k++) {
        const t = k / 13 * CLIMB_SECONDS, at = this.p.copy(spec.at).setY(spec.at.y + g * CLIMB_SECONDS * t - 0.5 * g * t * t)
        emit(at, this.v.set((this.next() - 0.5) * 3, -2, (this.next() - 0.5) * 3), s, this.c.copy(gold).multiplyScalar(0.6), t)
        if (k % 3 === 0) puff(at, 3.5, 2.5, 1.2, t)
      }
      top.y += spec.climb; delay = CLIMB_SECONDS
    }
    const stars = STARS[level], speed = (20 + this.next() * 6) * fireworkSize.value * SNAP
    const colour = (i: number) => (i % 3 === 2 ? b : a)
    trailing = true; trailSize = speed / (1.25 * SNAP) * 0.07
    // A unit direction from the Fibonacci sphere, turned by the burst's own angle.
    const turn = this.next() * Math.PI * 2
    const sphere = (i: number, n: number) => {
      const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), phi = i * 2.399963229728653 + turn
      return this.v.set(Math.cos(phi) * r, y, Math.sin(phi) * r)
    }
    const base = (life: number, width: number, drag: number, gravity: number, streak: number) => { s.life = life; s.width = width * WIDTH; s.drag = drag * SNAP; s.gravity = gravity; s.streak = streak }

    if (shape === 'peony' || shape === 'chrysanthemum') {
      base(shape === 'peony' ? 2.1 : 2.6, 0.12, 1.25, 0.35, shape === 'peony' ? 0.05 : 0.16)
      for (let i = 0; i < stars; i++) emit(top, sphere(i, stars).multiplyScalar(speed * (0.9 + this.next() * 0.2)), s, colour(i), delay)
    } else if (shape === 'ring') {
      const tilt = new T.Quaternion().setFromEuler(new T.Euler(this.next() * 1.2 - 0.6, this.next() * Math.PI, this.next() * 1.2 - 0.6))
      base(2.2, 0.13, 1.2, 0.3, 0.06)
      const ring = Math.round(stars * 0.75)
      for (let i = 0; i < ring; i++) { const a2 = i / ring * Math.PI * 2; emit(top, this.v.set(Math.cos(a2), 0, Math.sin(a2)).applyQuaternion(tilt).multiplyScalar(speed), s, a, delay) }
      for (let i = 0; i < stars - ring; i++) emit(top, sphere(i, stars - ring).multiplyScalar(speed * 0.45), s, b, delay)
    } else if (shape === 'willow') {
      base(3.8, 0.1, 0.7, 0.85, 0.22)
      for (let i = 0; i < stars; i++) emit(top, sphere(i, stars).multiplyScalar(speed * 0.75), s, i % 4 === 0 ? a : gold, delay)
    } else if (shape === 'palm') {
      // A few big comets up and out, each shedding a trail of small stars as it goes.
      const comets = 9
      for (let i = 0; i < comets; i++) {
        const a2 = i / comets * Math.PI * 2 + turn, up = 0.55 + this.next() * 0.3
        const v = new T.Vector3(Math.cos(a2) * (1 - up), up, Math.sin(a2) * (1 - up)).normalize().multiplyScalar(speed * 1.15)
        base(2.8, 0.34, 0.9, 0.5, 0.18)
        emit(top, v, s, i % 2 ? b : a, delay)
        base(1.2, 0.07, 2, 0.4, 0.03)
        for (let k = 1; k <= 14; k++) {
          const at = k * 0.14
          travel(top, v, 0.9 * SNAP, 0.5, at, this.p)
          // Shed, it drifts down a little and scatters: a trail hanging behind the comet.
          emit(this.p, this.v.set((this.next() - 0.5) * 2, -1, (this.next() - 0.5) * 2), s, gold, delay + at)
        }
      }
    } else {
      // Crossette: stars that split into four part way out.
      const parents = Math.round(stars / 5), split = 0.75
      for (let i = 0; i < parents; i++) {
        const v = sphere(i, parents).multiplyScalar(speed * 0.8).clone()
        base(split, 0.16, 1.1, 0.3, 0.05)
        emit(top, v, s, a, delay)
        travel(top, v, 1.1 * SNAP, 0.3, split, this.p)
        const at = this.p.clone(), side = new T.Vector3(-v.z, 0, v.x).normalize(), upV = new T.Vector3().crossVectors(v, side).normalize()
        base(1.4, 0.11, 1.4, 0.4, 0.07)
        for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) emit(at, this.v.copy(side).multiplyScalar(x * 12 * fireworkSize.value * SNAP).addScaledVector(upV, y * 12 * fireworkSize.value * SNAP), s, b, delay + split)
      }
    }
    trailing = false
    const radius = speed / (1.25 * SNAP)
    // The pop: a small sun at the moment of the burst, then a softer bloom the size of the burst.
    this.flash.emit(top, this.v2.set(0, 0, 0), 0.35, radius * 0.45, radius * 0.6, this.c.setRGB(8, 7.5, 6.8), delay)
    this.flash.emit(top, this.v2.set(0, 0, 0), 0.6, radius * 0.6, radius * 0.9, this.c.copy(a).multiplyScalar(0.5), delay)
    // Smoke: a soft cloud where it burst, and trails where some of the stars went.
    const cloud = level === 0 ? 8 : 14
    for (let i = 0; i < cloud; i++) puff(this.p.copy(top).add(sphere(i, cloud).multiplyScalar(radius * (0.15 + this.next() * 0.25))), 6 + this.next() * 2, radius * 0.35, radius * 0.05, delay + 0.05)
    for (const t of this.trails) puff(t.at, 4.5 + this.next() * 1.5, t.size, t.size * 0.25, t.delay)
    this.trails.length = 0
    // Crackle: white twinkles scattered through the burst a second in.
    base(0.08, 0.14, 4, 0, 0)
    const crackle = level === 0 ? 14 : level === 1 ? 24 : 48
    for (let i = 0; i < crackle; i++) {
      const d = sphere(i, crackle).multiplyScalar(radius * (0.4 + this.next() * 0.6))
      emit(this.p.copy(top).add(d), this.v.set(0, 0, 0), s, this.c.setRGB(5, 5, 4.6), delay + 1 + this.next() * 0.9)
    }
    // Embers: slow, dim, falling and fading for a few seconds.
    base(4, 0.09, 2.5, 0.25, 0.02)
    const embers = level === 0 ? 10 : 24
    for (let i = 0; i < embers; i++) emit(top, sphere(i, embers).multiplyScalar(speed * 0.5), s, this.c.copy(a).multiplyScalar(0.35), delay + 0.3)

    // The light it throws on the ground, as the burst comes.
    if (Number.isFinite(spec.ground)) this.lights.push({ at: new T.Vector3(top.x, spec.ground, top.z), time: this.clock + delay, radius: Math.max(12, (top.y - spec.ground) * 0.9), color: this.c.copy(a).multiplyScalar(0.12).clone() })
    this.ends.push(this.clock + delay + 4.5); if (this.ends.length > MAX_BURSTS) this.ends.shift()
    this.stats.bursts++; this.stats.stars += used; this.stats.last = shape
  }

  update(dt: number): void {
    if (this.level !== Math.max(0, Math.min(2, Number(graphicsLevel.value)))) this.rebuild()
    this.clock += Math.min(0.1, dt)
    // Stars written this frame go up together (SparkBatch.flush).
    this.stars.flush(); this.dayStars.flush()
    this.stars.minWidth.value = fireworkWidth.value
    // By day the stars draw about 2.5 times as wide and fully opaque: the share of sky a burst
    // covers is what makes it seen from across the map against a bright sky.
    this.dayStars.minWidth.value = fireworkWidth.value * 2.5
    const day = 1 - vehicleNightAmount(this.game.scene)
    this.dayStars.opacity.value = 1.8 * day; this.dayStars.mesh.visible = day > 0.02
    this.dayStars.clock.value = this.stars.clock.value = this.flash.clock.value = this.smoke.clock.value = this.clock
    // Smoke shows by day and fades out at night, when the stars carry the burst alone.
    this.smoke.opacity.value = SMOKE_ALPHA * fireworkSmoke.value * day
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i]
      if (this.clock < l.time) continue
      this.light.emit(l.at, T.Object3D.DEFAULT_UP, { radius: l.radius, seconds: 1.6, color: l.color })
      this.lights.splice(i, 1)
    }
    this.light.update(dt)
  }

  shift(dx: number, dz: number): void { this.stars.shift(dx, dz); this.dayStars.shift(dx, dz); this.flash.shift(dx, dz); this.smoke.shift(dx, dz); this.light.shift(dx, dz); for (const l of this.lights) { l.at.x += dx; l.at.z += dz } }
  reset(): void { this.lights.length = 0; this.light.reset() }
  dispose(): void { this.stars.dispose(); this.dayStars.dispose(); this.flash.dispose(); this.smoke.dispose(); this.light.dispose() }
}

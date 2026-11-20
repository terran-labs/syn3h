/**
 * A let-go cord, drawn for a moment after it stops pulling: a loose rope of point masses,
 * stepped as position-based dynamics and held to its segment lengths, so it whips and falls
 * like a cord. Looks only: it touches no body, pulls nothing and catches nothing.
 *
 *   released, unhooked, timedOut  the owner's end stays on the roof and reels the cord in, the
 *                                 far end flies loose back toward the owner, and it fades.
 *   snapped                       the same, with a flash at the far end where it gave.
 *   severed                       it parts in the middle with a white-gold flash, and each half
 *                                 reels back to its own end.
 *   sail                          a hook that missed: the whole cord flies on along the hook's
 *                                 path, loose and falling, and fades.
 *
 * Bungee.ts makes one from the last points it drew for a cord and draws it in a free cord
 * slot of the shared tether look; with no slot free there is no effect, and the cord has
 * already been let go regardless.
 */
import * as THREE from 'three/webgpu'
import type { CordRelease } from './Bungee'

export type LooseKind = CordRelease | 'sail'

const GRAVITY = 9.8
/** Speed the far end leaves with toward the owner when a cord is let go, m/s. */
const WHIP = 26
/** Share of its speed a point keeps each second (air drag on a light cord). */
const DRAG = 0.25
/** Constraint passes per step. */
const PASSES = 4
/** The cord reels fully in over this share of its life (released and severed). */
const REEL_SHARE = 0.75
/** Seconds a flash (severed, snapped) lasts. */
export const FLASH_TIME = 0.35

export class LooseCord {
  readonly pos: THREE.Vector3[]
  private readonly vel: THREE.Vector3[]
  private readonly next: THREE.Vector3[]
  private readonly rest: number[]
  /** Where a severed cord parts (the segment after this point is cut), or -1. */
  readonly cut: number
  /** Where the flash is, for severed and snapped; null for none. */
  readonly flash: THREE.Vector3 | null
  age = 0
  private readonly d = new THREE.Vector3()

  /**
   * `points` are the cord as last drawn, owner's end first. `hookVel` is the hook's velocity
   * for a sailing cord.
   */
  constructor(points: readonly THREE.Vector3[], readonly kind: LooseKind, readonly life: number, readonly rgb: readonly number[], readonly phase: number, hookVel?: THREE.Vector3) {
    const n = points.length - 1
    this.pos = points.map(p => p.clone())
    this.next = points.map(p => p.clone())
    this.rest = []
    for (let i = 0; i < n; i++) this.rest.push(points[i].distanceTo(points[i + 1]))
    this.cut = kind === 'severed' ? Math.floor(n / 2) : -1
    this.flash = kind === 'severed' ? points[this.cut].clone().lerp(points[this.cut + 1], 0.5) : kind === 'snapped' ? points[n].clone() : null
    const a = points[0], b = points[n]
    const back = new THREE.Vector3().subVectors(a, b)
    if (back.lengthSq() > 1e-8) back.normalize()
    this.vel = points.map((_, i) => {
      const u = n > 0 ? i / n : 0
      if (kind === 'sail') return hookVel ? hookVel.clone().multiplyScalar(0.55 + 0.45 * u) : new THREE.Vector3()
      // Severed: each half springs back toward its own end, fastest at the cut.
      if (kind === 'severed') return i <= this.cut ? back.clone().multiplyScalar(WHIP * 0.6 * u / Math.max(1e-3, this.cut / n)) : back.clone().multiplyScalar(-WHIP * 0.6 * (1 - u) / Math.max(1e-3, 1 - (this.cut + 1) / n))
      // Let go: the far end whips back toward the owner, the near end barely moves.
      return back.clone().multiplyScalar(WHIP * u * u)
    })
  }

  get done(): boolean { return this.age >= this.life }

  /** 1 when made, falling to 0 at the end of its life. */
  get fade(): number { const x = Math.min(1, this.age / this.life); return (1 - x) ** 1.5 }

  /** Brightness of the flash now, 0 once it is over. */
  get flashLevel(): number { return this.flash ? Math.max(0, 1 - this.age / FLASH_TIME) : 0 }

  /**
   * Step `dt` seconds. `ownerEnd` pins the first point (the owner's roof) and `farEnd` the last
   * (a severed cord's far vehicle or anchor); null leaves that end loose. `ground`, when given,
   * keeps every point above the surface.
   */
  step(dt: number, ownerEnd: THREE.Vector3 | null, farEnd: THREE.Vector3 | null, ground?: (x: number, z: number) => number): void {
    if (!(dt > 0)) return
    this.age += dt
    const n = this.pos.length - 1
    const pinA = this.kind !== 'sail' && ownerEnd !== null
    const pinB = this.kind === 'severed' && farEnd !== null
    const keep = DRAG ** dt
    for (let i = 0; i <= n; i++) {
      const v = this.vel[i]
      v.y -= GRAVITY * dt
      v.multiplyScalar(keep)
      this.next[i].copy(this.pos[i]).addScaledVector(v, dt)
    }
    if (pinA) this.next[0].copy(ownerEnd!)
    if (pinB) this.next[n].copy(farEnd!)
    // Reeling in: segment lengths shrink toward nothing, so each piece draws back to its pin.
    const reel = this.kind === 'sail' ? 1 : Math.max(0.02, 1 - this.age / (this.life * REEL_SHARE))
    for (let pass = 0; pass < PASSES; pass++) {
      for (let i = 0; i < n; i++) {
        if (i === this.cut) continue
        const p = this.next[i], q = this.next[i + 1]
        const wp = i === 0 && pinA ? 0 : 1, wq = i + 1 === n && pinB ? 0 : 1
        if (wp + wq === 0) continue
        const d = this.d.subVectors(q, p), len = d.length()
        if (len < 1e-6) continue
        const corr = d.multiplyScalar((len - this.rest[i] * reel) / len / (wp + wq))
        p.addScaledVector(corr, wp)
        q.addScaledVector(corr, -wq)
      }
    }
    for (let i = 0; i <= n; i++) {
      const p = this.next[i]
      if (ground) p.y = Math.max(p.y, ground(p.x, p.z) + 0.05)
      this.vel[i].subVectors(p, this.pos[i]).divideScalar(dt)
      this.pos[i].copy(p)
    }
  }
}

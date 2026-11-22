/**
 * Chasers (Pesters in the code): slow glowing clouds of light that chase another player and tag them if they
 * catch up. They fade after `pester.life` seconds. How they look is in cloud.ts.
 *
 * Networking rides on the tag beam's messages: a Pester is a shot of kind 'pester' naming its
 * target (`shot.to`). Every client flies every Pester toward its own view of the target, so
 * screens differ a little, which is fine for something this slow and wobbly. Only the target's
 * own client, where the target's position is exact, decides it was caught, and reports it as
 * a hit; the room checks the shot was real, as for beams. The bump a caught vehicle gets is
 * capped by that player's own client, never by the sender.
 *
 * Positions are re-imaged near the local player every step, so Pesters survive the seam of
 * the wrapping world.
 */
import { EDGE_MAX_PX, EDGE_MIN_PX, metresPerPixel, ringEdges, type RingEdges } from '../pulse'
import { vehicleNightAmount } from '../../vehicles/skins/nightReadability'
import { pesterSize } from './params'
import * as THREE from 'three/webgpu'
import type { ShotInfo } from '../../../shared/protocol'
import { nearestImage, wrapDelta } from '../../../shared/wrap'
import type { Game, System } from '../../core/Game'
import { FIXED_DT, type RAPIER } from '../../core/physics'
import { aimFrom } from '../aim'
import { warmGear } from '../warm'
import { PesterCloud } from './cloud'
import { pesterAllowed, pesterLife, pesterMax, pesterRadius, pesterRange, pesterSpeed, pesterTurn } from './params'
import { steer, type V3 } from './steer'
import { HeldFire } from '../heldFire'

export interface PesterHooks {
  self(): number
  bodyOf(id: number): RAPIER.RigidBody | undefined
  vehicleIds(): number[]
  /** True if this client judges catches on the vehicle (its own, and bots it simulates). */
  judges(id: number): boolean
  heightAt(x: number, z: number): number
  wrapSize(): number
  inHand(): boolean
  /** Launch a Pester at `target` (null: none in range) from the local vehicle. */
  launch(target: number | null): void
  /** Whether a launch now would go (cooldown and the cap on Chasers in flight), so a held button looks for a target only then. */
  canLaunch?(): boolean
  /** A Pester caught a vehicle this client judges. */
  onCatch(shooter: number, shot: number, victim: number, at: THREE.Vector3, dir: THREE.Vector3): void
  /** A Pester caught something at `at`; once per Pester on every client. For the impact push. */
  onBurst?(at: THREE.Vector3): void
}

interface Orb {
  shooter: number
  id: number
  to: number | null
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: V3
  age: number
  life: number
  /** Seconds since popping, or -1 while alive. */
  popped: number
  /** Its place in the cloud's buffers, or -1 if every place was taken. */
  slot: number
}

/** Pesters keep this far above the ground. */
const HOVER = 1.4
/** The cone, degrees, in which an aimed-at vehicle is preferred over the nearest one. */
const PICK_CONE = 30
/** Chasers given a dark outline at once (the first this many slots of the cloud). */
const OUTLINES = 16
const POP_TIME = 0.3
const MAX_CATCH_UP = 2
/** Lift and lean of a launch: up and ahead from the roof. */
const LAUNCH_UP = 0.5

/** Distance to its target, metres, at which a Pester is at its loosest and dimmest. */
const FAR = 60

export class Pesters implements System {
  private readonly orbs: Orb[] = []
  private readonly cloud = new PesterCloud()
  private readonly unwarm: () => void
  private fireWas = false
  /** The player's press, held: a Chaser goes each time one may (heldFire.ts). */
  private readonly trigger = new HeldFire()
  stats = { launched: 0, caught: 0, popped: 0 }

  constructor(private readonly game: Game, private readonly hooks: PesterHooks) {
    game.scene.add(this.cloud.haze, this.cloud.light)
    this.unwarm = warmGear(game, [], () => this.cloud.warm(), () => [this.cloud.haze, this.cloud.light])
    this.edges = ringEdges(game)
    this.edgeFirst = this.edges.look.take(OUTLINES)
  }
  /**
   * By day, a thin dark outline round each Chaser's core (pulse.ts RingEdges), facing the camera:
   * over a bright sky its additive glow alone washed out to a pale smudge. Kept 1.5 to 3 pixels
   * wide on screen, as the rings' edges are; nothing at night.
   */
  private readonly edges: { look: RingEdges; release(): void }
  private readonly edgeFirst: number
  private readonly edgeMatrix = new THREE.Matrix4()
  private readonly edgeAt = new THREE.Vector3()
  private readonly edgeScale = new THREE.Vector3()

  /** Pesters the local player has out. */
  get mine(): number {
    const me = this.hooks.self()
    return this.orbs.filter((o) => o.shooter === me && o.popped < 0).length
  }

  /** Every live Pester, for checks: shooter, target and position. */
  list(): { id: number; shooter: number; to: number | null; pos: [number, number, number]; velocity: [number, number, number] }[] {
    return this.orbs.filter((o) => o.popped < 0).map((o) => ({ id: o.id, shooter: o.shooter, to: o.to, pos: [o.pos.x, o.pos.y, o.pos.z], velocity: [o.vel[0], o.vel[1], o.vel[2]] }))
  }

  /** Metres to the closest Pester hunting the local player, or null. For the sound lane. */
  nearest(): number | null {
    const me = this.hooks.self()
    const at = this.hooks.bodyOf(me)?.translation()
    if (!at) return null
    let best: number | null = null
    for (const o of this.orbs) {
      if (o.to !== me || o.popped >= 0) continue
      const d = this.offset(o.pos, at).length()
      if (best === null || d < best) best = d
    }
    return best
  }

  /**
   * The best target from the local vehicle: a vehicle inside the aim cone, else the nearest,
   * within range. Null if nobody is in range.
   */
  pick(): number | null {
    const self = this.hooks.self()
    const body = this.hooks.bodyOf(self)
    if (!body) return null
    const aim = aimFrom(this.game, body, pesterRange.value)
    const o = body.translation()
    const cos = Math.cos((PICK_CONE * Math.PI) / 180)
    let aimed: number | null = null, aimedScore = Infinity, nearest: number | null = null, nearestD = Infinity
    for (const id of this.hooks.vehicleIds()) {
      if (id === self) continue
      const b = this.hooks.bodyOf(id)
      if (!b) continue
      const to = this.offset(o, b.translation())
      const d = to.length()
      if (d > pesterRange.value || d < 0.5) continue
      if (d < nearestD) { nearestD = d; nearest = id }
      const c = to.dot(aim.d) / d
      if (c >= cos && (1 - c) * 50 + d / pesterRange.value < aimedScore) { aimedScore = (1 - c) * 50 + d / pesterRange.value; aimed = id }
    }
    return aimed ?? nearest
  }

  /** Muzzle direction for a launch: forward and up from the vehicle. */
  launchDirection(body: RAPIER.RigidBody): [number, number, number] {
    const aim = aimFrom(this.game, body, pesterRange.value)
    const d = aim.d.clone().add(new THREE.Vector3(0, LAUNCH_UP, 0)).normalize()
    return [d.x, d.y, d.z]
  }

  /** Start a Pester. `age` is how long ago it was launched; that much is replayed. */
  spawn(shooter: number, shot: ShotInfo, age = 0): void {
    // A shooter's own oldest Pester gives way if a relayed one would go past the cap here.
    const theirs = this.orbs.filter((o) => o.shooter === shooter && o.popped < 0)
    if (theirs.length >= pesterMax.value) this.pop(theirs[0])
    const speed = pesterSpeed.value
    const d = new THREE.Vector3(...shot.d).normalize()
    const o: Orb = {
      shooter, id: shot.id, to: typeof shot.to === 'number' ? shot.to : null,
      pos: new THREE.Vector3(...shot.o), prev: new THREE.Vector3(...shot.o),
      vel: [d.x * speed, d.y * speed, d.z * speed], age: 0, life: pesterLife.value, popped: -1,
      slot: this.cloud.take(),
    }
    this.orbs.push(o)
    let catchUp = Math.min(MAX_CATCH_UP, Math.max(0, age))
    while (catchUp >= FIXED_DT && o.popped < 0) { this.step(o, FIXED_DT); catchUp -= FIXED_DT }
    o.prev.copy(o.pos)
    if (shooter === this.hooks.self()) this.stats.launched++
  }

  /** The room confirmed a catch: pop that Pester everywhere. */
  confirmHit(shooter: number, shot: number): void {
    const o = this.orbs.find((p) => p.shooter === shooter && p.id === shot && p.popped < 0)
    if (o) { this.hooks.onBurst?.(o.pos); this.pop(o) }
  }

  /** A player left: pop their Pesters. */
  forget(id: number): void {
    for (const o of this.orbs) if (o.shooter === id && o.popped < 0) this.pop(o)
  }

  /** Pesters here, in flight or popping, for automated checks. */
  get count(): number {
    return this.orbs.length
  }

  /** Remove every Pester in flight, popping or not, at once: for a world change or leaving it. */
  reset(): void {
    for (const o of this.orbs) this.cloud.free(o.slot)
    this.orbs.length = 0
    this.fireWas = false
    this.trigger.clear()
  }

  fixedUpdate(dt: number): void {
    if (!pesterAllowed.value) {
      for (const o of this.orbs) if (o.popped < 0) this.pop(o)
      this.fireWas = false
    } else {
      // Held, it sends one each time the cooldown and the cap on Chasers in flight allow, as
      // if pressed then (the launch refuses the rest); a press alone sends one, as always.
      this.trigger.step(this.game.input.state.fire, this.hooks.inHand())
      if (this.trigger.held && (this.hooks.canLaunch?.() ?? true)) this.hooks.launch(this.pick())
    }
    for (const o of this.orbs) {
      o.prev.copy(o.pos)
      if (o.popped < 0) this.step(o, dt)
    }
  }

  update(dt: number, alpha: number): void {
    const size = this.hooks.wrapSize(), day = 1 - vehicleNightAmount(this.game.scene)
    // Slots whose Chaser ended last frame are cleared here; live ones are written below.
    for (let i = 0; i < OUTLINES; i++) this.edges.look.set(this.edgeFirst + i, null, 0)
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]
      const x = o.prev.x + (o.pos.x - o.prev.x) * alpha, y = o.prev.y + (o.pos.y - o.prev.y) * alpha, z = o.prev.z + (o.pos.z - o.prev.z) * alpha
      if (o.popped >= 0) {
        // Ended: the swarm scatters outward and fades where it was.
        o.popped += dt
        const k = o.popped / POP_TIME
        if (k >= 1) {
          this.cloud.free(o.slot)
          this.orbs.splice(i, 1)
          continue
        }
        this.cloud.set(o.slot, x, y, z, 0, 0, 0, 1, k)
        this.outline(o.slot, x, y, z, k, day)
        continue
      }
      // Brighter and tighter the closer it is to catching its target.
      let energy = 0.3
      const t = o.to !== null ? this.hooks.bodyOf(o.to)?.translation() : undefined
      if (t) {
        const dx = size > 0 ? wrapDelta(x, t.x, size) : t.x - x, dz = size > 0 ? wrapDelta(z, t.z, size) : t.z - z
        energy = Math.max(0.3, 1 - Math.hypot(dx, t.y - y, dz) / FAR)
      }
      this.cloud.set(o.slot, x, y, z, o.vel[0], o.vel[1], o.vel[2], energy, 0)
      this.outline(o.slot, x, y, z, 0, day)
    }
    this.cloud.update(this.game.time)
    this.edges.look.commit()
  }

  /** Chaser `slot`'s outline this frame, at its centre, as it scatters (`k`) and by daylight. */
  private outline(slot: number, x: number, y: number, z: number, k: number, day: number): void {
    if (slot < 0 || slot >= OUTLINES) return
    const cam = this.game.camera
    // Just outside the core's visible glow: about three quarters of its sprite's half width.
    const radius = pesterSize.value * 2.6 * 0.5 * 0.78 * (1 + k * 1.5)
    const at = this.edgeAt.set(x, y, z), mPerPx = metresPerPixel(this.game, at)
    const half = mPerPx > 0 ? Math.min(EDGE_MAX_PX, Math.max(EDGE_MIN_PX, 0.035 * radius / mPerPx)) * mPerPx / radius : 0.035
    this.edgeMatrix.compose(at, cam.quaternion, this.edgeScale.setScalar(radius))
    this.edges.look.set(this.edgeFirst + slot, this.edgeMatrix, (1 - k) * day, 0.94 + half, half)
  }

  dispose(): void {
    this.orbs.length = 0
    this.edges.release()
    this.unwarm()
    this.cloud.dispose()
  }

  // ---------------------------------------------------------------------------------------

  private step(o: Orb, dt: number): void {
    o.age += dt
    if (o.age > o.life) { this.pop(o); return }
    const size = this.hooks.wrapSize()
    const me = this.hooks.bodyOf(this.hooks.self())?.translation()
    if (size > 0 && me) {
      const x = nearestImage(o.pos.x, me.x, size), z = nearestImage(o.pos.z, me.z, size)
      o.prev.x += x - o.pos.x; o.prev.z += z - o.pos.z
      o.pos.x = x; o.pos.z = z
    }
    const target = o.to !== null ? this.hooks.bodyOf(o.to) : undefined
    if (target) {
      const t = target.translation()
      const to = this.offset(o.pos, t)
      // Aim a little above the centre, at the cabin, and arrive by the side if it can.
      to.y += 0.4
      steer(o.vel, [to.x, to.y, to.z], pesterSpeed.value, pesterTurn.value, dt)
    }
    o.pos.x += o.vel[0] * dt
    o.pos.y += o.vel[1] * dt
    o.pos.z += o.vel[2] * dt
    const floor = this.hooks.heightAt(o.pos.x, o.pos.z) + HOVER
    if (o.pos.y < floor) { o.pos.y = floor; if (o.vel[1] < 0) o.vel[1] = 0 }
    if (target && o.to !== null && this.hooks.judges(o.to)) {
      const t = target.translation()
      const to = this.offset(o.pos, t)
      if (to.length() <= pesterRadius.value) {
        const dir = new THREE.Vector3(...o.vel).normalize()
        this.stats.caught++
        this.hooks.onCatch(o.shooter, o.id, o.to, o.pos.clone(), dir)
        this.hooks.onBurst?.(o.pos)
        this.pop(o)
      }
    }
  }

  /** From `from` to `p`, the short way round the wrap. */
  private offset(from: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }): THREE.Vector3 {
    const size = this.hooks.wrapSize()
    return size > 0
      ? new THREE.Vector3(wrapDelta(from.x, p.x, size), p.y - from.y, wrapDelta(from.z, p.z, size))
      : new THREE.Vector3(p.x - from.x, p.y - from.y, p.z - from.z)
  }

  private pop(o: Orb): void {
    if (o.popped >= 0) return
    o.popped = 0
    this.stats.popped++
  }
}

/**
 * Yoink: a gravity gun for vehicles, and nobody gets hurt.
 *
 * With Yoink in hand, press and hold the tag control:
 *   - a vehicle inside the grab cone is grabbed and floats in front of you, weight held up,
 *     while you drive around with it; let go and it is flung where you aim;
 *   - with nothing in the cone, the press is a gust instead: everything close in front gets
 *     a shove and a little lift.
 * Carries end by themselves after `yoink.holdTime` seconds (0 = never), dropping gently.
 *
 * Only the carried vehicle's own client pushes it (see hold.ts), toward a carry point it
 * works out from the holder's vehicle as it sees it, carried forward by the holder's lag.
 * The carry point uses the holder's heading but not its pitch, so a bumpy road does not
 * slam the load into the ground. Nothing is kept in world x and z across steps.
 */
import * as THREE from 'three/webgpu'
import type { YoinkWire } from '../../../shared/protocol'
import { wrapDelta } from '../../../shared/wrap'
import type { Game, System } from '../../core/Game'
import { LiftFieldLook } from './field'
import { hotExposureDim } from '../../vehicles/skins/hotExposure'
import { aimFrom, type GearControl } from '../aim'
import { sharedLook, warmGear } from '../warm'
import { gustPush, holdAccel, type V3 } from './hold'
import { HeldFire } from '../heldFire'
import {
  yoinkAllowed, yoinkCone, yoinkCooldown, yoinkFling, yoinkGrip, yoinkHoldDistance, yoinkHoldHeight, yoinkHoldTime,
  yoinkPunt, yoinkPuntRange, yoinkRange,
} from './params'

export type { YoinkWire }

export interface YoinkVehicle {
  body: import('../../core/physics').RAPIER.RigidBody
  object: THREE.Object3D
}

export interface YoinkHooks {
  control?(): GearControl
  /** Prevent competing local controllers from grabbing the same vehicle. */
  heldElsewhere?(id: number): boolean

  self(): number
  vehicleOf(id: number): YoinkVehicle | undefined
  /** Every vehicle here, by id: ours, remote players and bots. */
  vehicleIds(): number[]
  owns(id: number): boolean
  lagOf(id: number): number
  wrapSize(): number
  inHand(): boolean
  /** False when this client has stopped hearing from player `id`. */
  responding?(id: number): boolean
  send?(y: YoinkWire): void
  cue?(name: 'yoinkGrab' | 'yoinkFling' | 'yoinkGust', at: THREE.Vector3): void
}

interface Carry {
  holder: number
  since: number
  field: THREE.Mesh
}

const EARTH_G = 9.81
/** Carry spring: stiff and well damped. One sided, so lag cannot pump it. */
const OMEGA = 3.2
const ZETA = 0.9
/** Spin damping on a carried vehicle, per second, so it does not tumble in the beam. */
const SPIN_DAMP = 3
/** The gust's cone is wider than the grab's. */
const GUST_CONE_SCALE = 2
const GUST_LIFE = 0.35
/** Seconds past the carry time limit before the carried side ends a carry itself. */
const CARRY_SLACK = 1
/** The longest any carry lasts on the carried side, whatever the sliders say. */
const CARRY_MAX = 30
/** The room's own allowance for a sender's speed in a fling, m/s (server/room.ts YOINK_OWN_SPEED). */
const OWN_SPEED = 60

/** Linear RGB at daytime exposure: a warm amber tractor beam. */
const BEAM_RGB = [3, 1.5, 0.25] as const
/** Gust rings ready to show at once, for the whole game. A gust lasts a third of a second. */
const WAVES = 6

interface Wave { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; busy: boolean }

/**
 * Everything a Yoink draws with. One per game, shared by the player's Yoink and every bot's,
 * and compiled before anyone uses it (see warm.ts). Gust rings fade on their own, so each
 * has its own material; they are made once and reused, never cloned per gust.
 */
class YoinkLook {
  readonly field: LiftFieldLook
  private readonly waveGeo = new THREE.RingGeometry(0.6, 1, 40)
  private readonly waves: Wave[] = []
  private readonly unwarm: () => void

  constructor(game: Game) {
    this.field = new LiftFieldLook(game)
    for (let i = 0; i < WAVES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        name: 'gear yoink wave', color: new THREE.Color(...BEAM_RGB), transparent: true, opacity: 0.8, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
      this.waves.push({ mesh: new THREE.Mesh(this.waveGeo, mat), mat, age: 0, busy: false })
    }
    this.unwarm = warmGear(game, [
      ...this.waves.map((w) => [this.waveGeo, w.mat] as const),
    ])
  }

  /** A free gust ring, or null when every one is on screen: that gust goes unseen. */
  takeWave(): Wave | null {
    const w = this.waves.find((x) => !x.busy)
    if (!w) return null
    w.busy = true
    w.age = 0
    return w
  }

  dispose(): void {
    this.unwarm()
    this.field.dispose()
    for (const w of this.waves) { w.mesh.removeFromParent(); w.mat.dispose() }
    this.waveGeo.dispose()
  }
}

export class Yoink implements System {
  /** Every carry in the room, by carried vehicle id. */
  private readonly carries = new Map<number, Carry>()
  private readonly shared: { look: YoinkLook; release(): void }
  private readonly look: YoinkLook
  private readonly waves: Wave[] = []
  private fireWas = false
  /**
   * The player's press, held (heldFire.ts): one refused while the Yoink recharges goes as soon as
   * it is ready, and a gust that caught nothing goes again each time it is. Once something is
   * grabbed, holding is the carry, and that same hold never grabs again.
   */
  private readonly trigger = new HeldFire()
  private waiting = false
  private readyAt = 0
  /** Counts for automated checks. */
  stats = { grabs: 0, flings: 0, drops: 0, gusts: 0, gusted: 0, carried: 0 }

  constructor(private readonly game: Game, private readonly hooks: YoinkHooks) {
    this.shared = sharedLook(game, 'yoink', () => new YoinkLook(game))
    this.look = this.shared.look
  }

  /** The vehicle the local player is carrying, or null. */
  get holding(): number | null {
    const me = this.hooks.self()
    for (const [to, c] of this.carries) if (c.holder === me) return to
    return null
  }

  /** Who is carrying vehicle `id`, or null. */
  holderOf(id: number): number | null {
    return this.carries.get(id)?.holder ?? null
  }

  /**
   * Press: grab what is in the cone, or gust if nothing is. For the tag control and
   * automated checks. Returns what happened.
   */
  press(): 'grab' | 'gust' | null {
    const me = this.hooks.vehicleOf(this.hooks.self())
    if (!me || !yoinkAllowed.value || this.game.time < this.readyAt || this.holding !== null) return null
    const aim = aimFrom(this.game, me.body, yoinkRange.value, 0.4, 2.4, 0, !this.hooks.control)
    const control = this.hooks.control?.()
    if (control) aim.d.set(...control.direction).normalize()
    const target = this.pick(aim.o, aim.d, yoinkRange.value, yoinkCone.value)
    if (target !== null) {
      this.grab(this.hooks.self(), target)
      this.hooks.send?.({ s: 'grab', to: target })
      this.stats.grabs++
      const v = this.hooks.vehicleOf(target)
      if (v) this.hooks.cue?.('yoinkGrab', v.object.position)
      return 'grab'
    }
    this.gust(aim.o, aim.d)
    return 'gust'
  }

  /** Release: fling what the local player carries where they aim. */
  release(): void {
    const to = this.holding
    if (to === null) return
    const me = this.hooks.vehicleOf(this.hooks.self())
    const aim = me ? aimFrom(this.game, me.body, yoinkRange.value, 0.4, 2.4, 0, !this.hooks.control) : null
    if (aim && this.hooks.control) aim.d.set(...this.hooks.control().direction).normalize()
    const d = aim?.d ?? new THREE.Vector3(0, 0.3, -1).normalize()
    // A little lift, so a flat aim still sails.
    const dir = d.clone().add(new THREE.Vector3(0, 0.15, 0)).normalize()
    const hv = me?.body.linvel()
    const v: V3 = [dir.x * yoinkFling.value + (hv?.x ?? 0), dir.y * yoinkFling.value + (hv?.y ?? 0), dir.z * yoinkFling.value + (hv?.z ?? 0)]
    this.endCarry(to)
    this.applyFling(to, v)
    this.hooks.send?.({ s: 'fling', to, v: round3(v) })
    this.stats.flings++
    this.readyAt = this.game.time + yoinkCooldown.value
    const tv = this.hooks.vehicleOf(to)
    if (tv) this.hooks.cue?.('yoinkFling', tv.object.position)
  }

  /** Put down what the local player carries, without a fling. */
  drop(): void {
    const to = this.holding
    if (to === null) return
    this.endCarry(to)
    this.hooks.send?.({ s: 'drop', to })
    this.stats.drops++
    this.readyAt = this.game.time + yoinkCooldown.value
  }

  /** Drop gently and clear the input edge when a controller is interrupted. */
  cancel(): void {
    this.drop()
    this.fireWas = false
    this.trigger.clear(); this.waiting = false
  }

  /**
   * Drop every carry, the player's and everyone else's, clear gust rings and held input.
   * For a world change, leaving the world or the room, or the vehicle being replaced. The
   * player's own carry is reported dropped so the room and the others end it too. No
   * cooldown: this is not a drop the player chose. Shared materials are kept (see warm.ts).
   */
  reset(): void {
    const mine = this.holding
    for (const to of [...this.carries.keys()]) this.endCarry(to)
    if (mine !== null) this.hooks.send?.({ s: 'drop', to: mine })
    for (const w of this.waves) {
      this.game.scene.remove(w.mesh)
      w.busy = false
    }
    this.waves.length = 0
    this.fireWas = false
    this.trigger.clear(); this.waiting = false
    this.readyAt = 0
  }

  /** Live carries and gust rings, for automated checks. */
  get count(): number {
    return this.carries.size + this.waves.length
  }

  /** Another player's Yoink, as relayed. */
  applyRemote(from: number, y: YoinkWire): void {
    if (from === this.hooks.self()) {
      // The room ended our carry (too long, out of reach, or the load went away): stop
      // drawing the beam and holding on.
      if (y.s === 'drop' && this.carries.get(y.to)?.holder === from) {
        this.endCarry(y.to)
        this.readyAt = this.game.time + yoinkCooldown.value
      }
      return
    }
    if (y.s === 'grab') this.grab(from, y.to)
    else {
      if (this.carries.get(y.to)?.holder === from) this.endCarry(y.to)
      if (y.s === 'fling') this.applyFling(y.to, y.v)
    }
  }

  /** A player left: end carries they made or were in. */
  forget(id: number): void {
    this.endCarry(id)
    for (const [to, c] of [...this.carries]) if (c.holder === id) this.endCarry(to)
  }

  fixedUpdate(dt: number): void {
    if (!yoinkAllowed.value) {
      for (const to of [...this.carries.keys()]) this.endCarry(to)
      this.fireWas = false
      return
    }
    this.controls()
    for (const [to, c] of [...this.carries]) this.carry(to, c, dt)
  }

  update(dt: number): void {
    const dim = hotExposureDim(this.game.renderer.toneMappingExposure)
    this.look.field.update(this.game.time)
    for (const [to, c] of this.carries) this.drawField(to, c)
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]
      w.age += dt
      const k = w.age / GUST_LIFE
      w.mesh.scale.setScalar(1 + k * yoinkPuntRange.value * 0.35)
      w.mat.opacity = 0.8 * Math.max(0, 1 - k)
      w.mat.color.setRGB(BEAM_RGB[0] * dim, BEAM_RGB[1] * dim, BEAM_RGB[2] * dim)
      if (k >= 1) {
        this.game.scene.remove(w.mesh)
        w.busy = false
        this.waves.splice(i, 1)
      }
    }
  }

  dispose(): void {
    for (const to of [...this.carries.keys()]) this.endCarry(to)
    for (const w of this.waves) {
      this.game.scene.remove(w.mesh)
      w.busy = false
    }
    this.waves.length = 0
    this.shared.release()
  }

  // ---------------------------------------------------------------------------------------

  private controls(): void {
    const control = this.hooks.control?.()
    if (control) {
      // A bot: press and release, as always.
      const fire = this.hooks.inHand() && control.fire
      const pressed = fire && !this.fireWas
      const released = !fire && this.fireWas
      this.fireWas = fire
      if (pressed) this.press()
      else if (released) this.release()
    } else {
      const { pressed, released } = this.trigger.step(this.game.input.state.fire, this.hooks.inHand())
      if (pressed || (this.waiting && this.trigger.held)) this.waiting = this.press() !== 'grab'
      else if (released) { this.waiting = false; this.release() }
    }
    const to = this.holding
    if (to !== null) {
      const limit = yoinkHoldTime.value
      const c = this.carries.get(to)!
      if (!this.hooks.vehicleOf(to)) this.endCarry(to)
      else if (limit > 0 && this.game.time - c.since > limit) this.drop()
    }
  }

  /** The vehicle best inside the cone: smallest angle, then nearest. */
  private pick(o: THREE.Vector3, d: THREE.Vector3, range: number, coneDeg: number): number | null {
    const self = this.hooks.self()
    const cos = Math.cos((coneDeg * Math.PI) / 180)
    let best: number | null = null
    let bestScore = Infinity
    for (const id of this.hooks.vehicleIds()) {
      if (id === self || this.hooks.heldElsewhere?.(id)) continue
      const to = this.offset(o, id)
      if (!to) continue
      const dist = to.length()
      if (dist < 0.5 || dist > range) continue
      const c = to.dot(d) / dist
      if (c < cos) continue
      const score = (1 - c) * 50 + dist / range
      if (score < bestScore) { bestScore = score; best = id }
    }
    return best
  }

  /** Vector from `from` to vehicle `id`, the short way round the wrap. */
  private offset(from: THREE.Vector3, id: number): THREE.Vector3 | null {
    const v = this.hooks.vehicleOf(id)
    if (!v) return null
    const p = v.body.translation()
    const size = this.hooks.wrapSize()
    return size > 0
      ? new THREE.Vector3(wrapDelta(from.x, p.x, size), p.y - from.y, wrapDelta(from.z, p.z, size))
      : new THREE.Vector3(p.x - from.x, p.y - from.y, p.z - from.z)
  }

  private gust(o: THREE.Vector3, d: THREE.Vector3): void {
    this.stats.gusts++
    this.readyAt = this.game.time + yoinkCooldown.value
    this.hooks.cue?.('yoinkGust', o)
    this.addWave(o, d)
    const self = this.hooks.self()
    const cos = Math.cos((Math.min(80, yoinkCone.value * GUST_CONE_SCALE) * Math.PI) / 180)
    for (const id of this.hooks.vehicleIds()) {
      if (id === self) continue
      const to = this.offset(o, id)
      if (!to) continue
      const dist = to.length()
      if (dist < 0.1 || to.dot(d) / dist < cos) continue
      const dir = to.clone().normalize()
      const push = gustPush([dir.x, dir.y, dir.z], dist, yoinkPuntRange.value, yoinkPunt.value)
      if (!push) continue
      this.stats.gusted++
      this.applyFling(id, push)
      this.hooks.send?.({ s: 'fling', to: id, v: round3(push) })
    }
  }

  /**
   * A velocity change for a vehicle, applied only where that vehicle is simulated, and never
   * more than this room's sliders allow: the room bounds it too, but the pushed player's own
   * client is the last line of defence and does not trust the sender.
   */
  private applyFling(id: number, v: readonly number[]): void {
    if (!this.hooks.owns(id)) return
    const body = this.hooks.vehicleOf(id)?.body
    if (!body) return
    const most = flingLimit()
    const n = Math.hypot(v[0], v[1], v[2])
    if (!Number.isFinite(n)) return
    const k = n > most ? most / n : 1
    const m = body.mass() * k
    body.applyImpulse({ x: v[0] * m, y: v[1] * m, z: v[2] * m }, true)
  }

  private grab(holder: number, to: number): void {
    if (to === holder) return
    this.endCarry(to)
    const field = this.look.field.create()
    this.game.scene.add(field)
    this.carries.set(to, { holder, since: this.game.time, field })
  }

  private endCarry(to: number): void {
    const c = this.carries.get(to)
    if (!c) return
    this.game.scene.remove(c.field)
    this.carries.delete(to)
  }

  /** Where a holder carries things: ahead along its heading, and up. */
  private carryPoint(holder: YoinkVehicle, lag: number): { p: V3; v: V3 } {
    const t = holder.body.translation()
    const lv = holder.body.linvel()
    const r = holder.body.rotation()
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    const k = Math.max(0, Math.min(0.5, lag))
    const ahead = yoinkHoldDistance.value
    return {
      p: [t.x + lv.x * k + fwd.x * ahead, t.y + lv.y * k + yoinkHoldHeight.value, t.z + lv.z * k + fwd.z * ahead],
      v: [lv.x, lv.y, lv.z],
    }
  }

  private carry(to: number, c: Carry, dt: number): void {
    const holder = this.hooks.vehicleOf(c.holder)
    const load = this.hooks.vehicleOf(to)
    if (!holder || !load) { this.endCarry(to); return }
    if (!this.hooks.owns(to)) return
    // Our own clock, beside the room's: a carry made by someone else ends after the time
    // limit plus a second, at 30 s whatever the limit, and as soon as we stop hearing from
    // the holder.
    if (c.holder !== this.hooks.self()) {
      const limit = yoinkHoldTime.value > 0 ? yoinkHoldTime.value + CARRY_SLACK : CARRY_MAX
      if (this.game.time - c.since > Math.min(limit, CARRY_MAX) || this.hooks.responding?.(c.holder) === false) {
        this.endCarry(to)
        return
      }
    }
    this.stats.carried++
    const { p: target, v: tv } = this.carryPoint(holder, this.hooks.lagOf(c.holder))
    const lp = load.body.translation()
    const lv = load.body.linvel()
    // The carry point, brought to the load's image of the wrapping world.
    const size = this.hooks.wrapSize()
    if (size > 0) { target[0] = lp.x + wrapDelta(lp.x, target[0], size); target[2] = lp.z + wrapDelta(lp.z, target[2], size) }
    const g = Math.abs(this.game.world.gravity.y)
    const a = holdAccel([lp.x, lp.y, lp.z], [lv.x, lv.y, lv.z], target, tv, { omega: OMEGA, zeta: ZETA, maxAccel: yoinkGrip.value * EARTH_G, gravity: g })
    const m = load.body.mass()
    load.body.applyImpulse({ x: a[0] * m * dt, y: a[1] * m * dt, z: a[2] * m * dt }, true)
    const w = load.body.angvel()
    const k = Math.max(0, 1 - SPIN_DAMP * dt)
    load.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true)
  }

  private drawField(to: number, c: Carry): void {
    const load = this.hooks.vehicleOf(to)
    if (!load) { c.field.visible = false; return }
    // Use the rendered vehicle's image of the wrapping world, so the field stays on it.
    c.field.position.copy(load.object.position)
    c.field.position.y -= 0.3
    c.field.visible = true
  }

  private addWave(o: THREE.Vector3, d: THREE.Vector3): void {
    const w = this.look.takeWave()
    if (!w) return
    w.mesh.position.copy(o).addScaledVector(d, 2)
    w.mesh.lookAt(w.mesh.position.clone().add(d))
    w.mesh.scale.setScalar(1)
    w.mat.opacity = 0.8
    this.game.scene.add(w.mesh)
    this.waves.push(w)
  }
}

/**
 * The fastest velocity change a fling or gust may give, m/s: the room's bound
 * (server/room.ts onYoink) with the most generous allowance for the sender's own speed.
 */
export function flingLimit(): number {
  return Math.max(yoinkFling.value, yoinkPunt.value * 1.3) * 1.25 + OWN_SPEED + 5
}

function round3(v: readonly number[]): V3 {
  return [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100]
}

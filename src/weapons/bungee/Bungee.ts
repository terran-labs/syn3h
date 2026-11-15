/**
 * The Bungee: a hook on a stretchy cord. It sticks to whatever it reaches, the ground or
 * another vehicle, and stays attached until the player lets go (or the host's timeout).
 *
 * Controls, with the Bungee in hand:
 *   tag control (click, L, Enter, gamepad A, touch TAG)  launch; hold to reel in
 *   V, mouse wheel down, gamepad LB                       let cord out (wheel up reels in)
 *   G, gamepad RB, or a double tap of the tag control     let go
 * G lets go whatever gear is in hand, so a player can switch to the tag beam while hanging.
 *
 * Physics is in rope.ts. Each client pulls only the vehicles it simulates (its own, and the
 * bots when it hosts), toward the other end as it sees it, carried forward by that end's lag.
 * A ground anchor is stored in the canonical tile and brought to the nearest image whenever
 * it is used, so a cord survives the seam of the wrapping world. Nothing about a cord is kept
 * in world x and z across steps except a hook in flight, which is re-imaged each step.
 *
 * Networking: `send` reports this player's cord as a CordWire whenever it changes, and
 * `applyRemote` takes another player's. Until the room relays cords, a cord to a remote
 * player pulls only you, like a winch on a moving post.
 */
import * as THREE from 'three/webgpu'
import type { CordWire } from '../../../shared/protocol'
import { nearestImage, wrapDelta } from '../../../shared/wrap'
import type { Game, System } from '../../core/Game'
import { GROUP_ALL, GROUP_LIQUID, GROUP_PROJECTILE, RAPIER, groups } from '../../core/physics'
import { hotExposureDim } from '../../vehicles/skins/hotExposure'
import { aimFrom, castAim } from '../aim'
import {
  bungeeAllowed, bungeeCooldown, bungeeDamping, bungeeHookSpeed, bungeeLength, bungeeMaxPull, bungeeMinLength,
  bungeeReelSpeed, bungeeSnap, bungeeStiffness, bungeeTimeout, bungeeVehicles,
} from './params'
import { cordGlow, cordPull, cordSag, predict, reducedMass, type CordTuning } from './rope'

type Vec3 = [number, number, number]

export type { CordWire }

export interface BungeeVehicle {
  body: RAPIER.RigidBody
  object: THREE.Object3D
}

export interface BungeeHooks {
  /** The local player's id. */
  self(): number
  vehicleOf(id: number): BungeeVehicle | undefined
  /** Id of any vehicle with this body handle, local, remote or bot. */
  idOfBody(handle: number): number | null
  /** True if this client simulates the vehicle, so it may push it. */
  owns(id: number): boolean
  /** Seconds this client's view of the vehicle is behind; 0 for one it owns. */
  lagOf(id: number): number
  wrapSize(): number
  /** Server clock seconds. */
  now(): number
  /** True when the Bungee is the gear in hand. */
  inHand(): boolean
  /** Report the local player's cord. */
  send?(cord: CordWire): void
  /** A short cue for the sound lane to voice; optional. */
  cue?(name: 'bungeeLaunch' | 'bungeeAttach' | 'bungeeRelease', at: THREE.Vector3): void
}

interface Hook {
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: THREE.Vector3
  travelled: number
}

interface Cord {
  owner: number
  hook: Hook | null
  /** Vehicle at the far end, or null for a ground anchor. */
  to: number | null
  /** Ground anchor, canonical, and its surface normal. */
  at: THREE.Vector3 | null
  normal: THREE.Vector3
  rest: number
  since: number
  /** For drawing: last pull and reduced mass, and a twang that decays. */
  pull: number
  mass: number
  twang: number
  view: CordView
}

export const SEGMENTS = 24
/** Each layer's width grows with distance past this many metres per metre of width. */
const MIN_SCREEN = 0.03
/** The cord's strength slider is in multiples of this, whatever the world's gravity. */
const EARTH_G = 9.81
/** Roof hitch above a vehicle's centre, metres. Forces act at the centre, so nothing spins. */
const HITCH = 0.9
/** Muzzle, in the vehicle's frame. The hook leaves from the roof. */
const MUZZLE_UP = 1.1
const MUZZLE_AHEAD = 1.2
/** Straight ahead aim tilts up this much (radians) so a free cursor still reaches ledges. */
const LIFT = 0.12
const DOUBLE_TAP = 0.35
/** Wheel notch in metres of cord. */
const WHEEL_STEP = 3
const RESEND = 2
const SEND_GAP = 0.1

/** Linear RGB at daytime exposure: slack is cool plasma blue, taut runs hot gold. */
const SLACK_RGB = [0.25, 1.4, 2.2] as const
const TAUT_RGB = [3.2, 2.2, 0.6] as const
const TINT_RGB = [0.05, 0.35, 0.5] as const

/** A camera facing ribbon along the cord, drawn three times: tint, halo and core. */
export class CordView {
  readonly group = new THREE.Group()
  readonly points = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3())
  private readonly layers: { geo: THREE.BufferGeometry; width: number }[] = []

  constructor(mats: THREE.Material[], widths: number[]) {
    const index: number[] = []
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    mats.forEach((mat, k) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 6), 3).setUsage(THREE.DynamicDrawUsage))
      geo.setIndex(index)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.frustumCulled = false
      mesh.renderOrder = k - 1
      this.group.add(mesh)
      this.layers.push({ geo, width: widths[k] })
    })
  }

  draw(camera: THREE.Vector3): void {
    const side = new THREE.Vector3()
    const tan = new THREE.Vector3()
    const view = new THREE.Vector3()
    for (const { geo, width } of this.layers) {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i <= SEGMENTS; i++) {
        const p = this.points[i]
        tan.subVectors(this.points[Math.min(SEGMENTS, i + 1)], this.points[Math.max(0, i - 1)])
        view.subVectors(camera, p)
        // Never thinner than about two pixels: a far cord stays a visible line.
        const w = Math.max(width, view.length() * width * MIN_SCREEN)
        side.crossVectors(tan, view).normalize().multiplyScalar(w / 2)
        pos.setXYZ(i * 2, p.x - side.x, p.y - side.y, p.z - side.z)
        pos.setXYZ(i * 2 + 1, p.x + side.x, p.y + side.y, p.z + side.z)
      }
      pos.needsUpdate = true
    }
  }

  dispose(): void {
    for (const { geo } of this.layers) geo.dispose()
  }
}

export class Bungee implements System {
  private readonly cords = new Map<number, Cord>()
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...SLACK_RGB), side: THREE.DoubleSide })
  private readonly haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...SLACK_RGB), transparent: true, opacity: 0.35, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  // As the tag beam does: a normally blended tint under the additive light keeps the cord
  // readable over a sunlit desert, where additive colour alone washes out to white.
  private readonly tintMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...TINT_RGB), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  })
  private readonly hookGeo = new THREE.OctahedronGeometry(0.35, 0)
  private readonly ringGeo = new THREE.RingGeometry(0.7, 1, 32)
  private readonly ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...SLACK_RGB), transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  })
  private readonly hookMeshes = new Map<number, THREE.Mesh>()
  private readonly anchorMeshes = new Map<number, THREE.Mesh>()
  private readonly reticle: THREE.Mesh
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

  private fireWas = false
  private lastPress = -Infinity
  private readyAt = 0
  private wheel = 0
  private readonly keys = new Set<string>()
  private padWas = { release: false }
  private sentAt = -Infinity
  private sentRest = 0
  /** Counts for automated checks. */
  stats = { launched: 0, attachedGround: 0, attachedVehicle: 0, released: 0, snapped: 0, timedOut: 0 }

  constructor(private readonly game: Game, private readonly hooks: BungeeHooks, target: Window = window) {
    this.reticle = new THREE.Mesh(this.ringGeo, this.ringMat)
    this.reticle.visible = false
    this.reticle.renderOrder = 10
    game.scene.add(this.reticle)
    target.addEventListener('keydown', (e) => {
      if (e.repeat || game.input.suspended) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      this.keys.add(e.code)
      if (e.code === 'KeyG') this.letGo('released')
    })
    target.addEventListener('keyup', (e) => this.keys.delete(e.code))
    target.addEventListener('blur', () => this.keys.clear())
    // Capture phase on the window runs before the camera's wheel zoom on the canvas: while a
    // cord is out and the Bungee is in hand, the wheel reels instead of zooming.
    target.addEventListener('wheel', (e) => {
      if (!this.mine?.to && !this.mine?.at) return
      if (!hooks.inHand() || e.target !== game.canvas) return
      this.wheel += Math.sign(e.deltaY)
      e.stopPropagation()
      e.preventDefault()
    }, { capture: true, passive: false })
  }

  /** The local player's cord, if any. */
  get mine(): Cord | undefined {
    return this.cords.get(this.hooks.self())
  }

  /** True while the local player's cord is attached. For the HUD. */
  get attached(): boolean {
    const c = this.mine
    return Boolean(c && !c.hook)
  }

  /** Metres of cord out on the local player's cord, or 0. */
  get cordLength(): number {
    return this.attached ? this.mine!.rest : 0
  }

  private tuning(): CordTuning {
    return { omega: bungeeStiffness.value, zeta: bungeeDamping.value, maxAccel: bungeeMaxPull.value * EARTH_G }
  }

  /**
   * Launch the local player's hook where they aim, or along `direction` (world, any length)
   * for automated checks.
   */
  launch(direction?: [number, number, number]): boolean {
    const me = this.hooks.vehicleOf(this.hooks.self())
    if (!me || !bungeeAllowed.value || this.mine || this.game.time < this.readyAt) return false
    const aim = aimFrom(this.game, me.body, bungeeLength.value, MUZZLE_UP, MUZZLE_AHEAD, LIFT)
    if (direction) aim.d.set(...direction).normalize()
    const v = me.body.linvel()
    // The hook inherits the vehicle's velocity, so it leaves cleanly at speed.
    const vel = aim.d.clone().multiplyScalar(bungeeHookSpeed.value).add(new THREE.Vector3(v.x, v.y, v.z))
    this.startHook(this.hooks.self(), aim.o, vel)
    this.stats.launched++
    this.hooks.cue?.('bungeeLaunch', aim.o)
    this.hooks.send?.({ s: 'hook', o: this.canonical(aim.o), d: [vel.x, vel.y, vel.z], t: this.hooks.now() })
    return true
  }

  /** Let go of the local player's cord. */
  letGo(why: 'released' | 'snapped' | 'timedOut' = 'released'): void {
    const c = this.mine
    if (!c) return
    this.stats[why]++
    const me = this.hooks.vehicleOf(c.owner)
    if (me) this.hooks.cue?.('bungeeRelease', me.object.position)
    this.remove(c.owner)
    this.readyAt = this.game.time + bungeeCooldown.value
    this.hooks.send?.({ s: 'off' })
  }

  /** Another player's cord, as relayed. `age` is seconds since it was sent. */
  applyRemote(from: number, wire: CordWire, age = 0): void {
    if (from === this.hooks.self()) return
    if (wire.s === 'off') { this.remove(from); return }
    if (wire.s === 'hook') {
      this.remove(from)
      const o = this.nearest(new THREE.Vector3(...wire.o))
      const c = this.startHook(from, o, new THREE.Vector3(...wire.d))
      // Replay the flight it missed, but never let a remote hook decide what it caught: the
      // owner does, and says so with an 'on'.
      const hook = c.hook!
      hook.pos.addScaledVector(hook.vel, Math.min(1, Math.max(0, age)))
      hook.prev.copy(hook.pos)
      return
    }
    let c = this.cords.get(from)
    if (!c) c = this.makeCord(from)
    c.hook = null
    c.to = wire.to ?? null
    c.at = wire.at ? new THREE.Vector3(...wire.at) : null
    if (wire.n) c.normal.set(...wire.n)
    if (c.rest === 0 || Math.abs(c.rest - wire.r) > 0.01) {
      if (c.rest === 0) { c.twang = 1; c.since = this.game.time }
      c.rest = wire.r
    }
  }

  /** A player left: drop their cord, and any cord tied to them. */
  forget(id: number): void {
    this.remove(id)
    for (const c of [...this.cords.values()]) if (c.to === id) {
      if (c.owner === this.hooks.self()) this.letGo('released')
      else this.remove(c.owner)
    }
  }

  fixedUpdate(dt: number): void {
    if (!bungeeAllowed.value) {
      if (this.cords.size) for (const id of [...this.cords.keys()]) this.remove(id)
      return
    }
    this.controls(dt)
    for (const c of [...this.cords.values()]) {
      if (c.hook) this.flyHook(c, dt)
      else this.pullCord(c, dt)
    }
    this.report()
  }

  update(dt: number): void {
    const dim = hotExposureDim(this.game.renderer.toneMappingExposure)
    const camPos = this.game.camera.getWorldPosition(new THREE.Vector3())
    const t = this.tuning()
    for (const c of this.cords.values()) this.drawCord(c, dt, dim, camPos, t)
    this.drawReticle(dim, camPos)
  }

  dispose(): void {
    for (const id of [...this.cords.keys()]) this.remove(id)
    this.game.scene.remove(this.reticle)
    this.coreMat.dispose(); this.haloMat.dispose(); this.tintMat.dispose(); this.ringMat.dispose()
    this.hookGeo.dispose(); this.ringGeo.dispose()
  }

  // ---------------------------------------------------------------------------------------

  private controls(dt: number): void {
    const input = this.game.input.state
    const inHand = this.hooks.inHand()
    const fire = inHand && input.fire
    const pressed = fire && !this.fireWas
    this.fireWas = fire
    const pad = navigator.getGamepads?.().find((p) => p && p.connected)
    const padOut = Boolean(pad?.buttons[4]?.pressed)
    const padRelease = Boolean(pad?.buttons[5]?.pressed)
    if (padRelease && !this.padWas.release) this.letGo('released')
    this.padWas.release = padRelease

    const c = this.mine
    if (!c) {
      this.wheel = 0
      if (pressed) { this.launch(); this.lastPress = this.game.time }
      return
    }
    if (c.hook) return
    if (pressed) {
      if (this.game.time - this.lastPress < DOUBLE_TAP) { this.letGo('released'); this.lastPress = -Infinity; return }
      this.lastPress = this.game.time
    }
    const me = this.hooks.vehicleOf(c.owner)
    const length = me ? this.span(c, me.body.translation()) : c.rest
    const t = this.tuning()
    // Reeling in never winds the stretch past where the pull saturates: holding the reel
    // against a stuck load waits instead of storing an ever larger spring.
    const deepest = Math.max(bungeeMinLength.value, length - (t.maxAccel / (t.omega * t.omega)) * 1.1)
    let rest = c.rest
    if (fire) rest = Math.max(deepest, rest - bungeeReelSpeed.value * dt)
    if (inHand && (this.keys.has('KeyV') || padOut)) rest += bungeeReelSpeed.value * dt
    if (this.wheel) {
      rest = this.wheel > 0 ? rest + this.wheel * WHEEL_STEP : Math.max(deepest, rest + this.wheel * WHEEL_STEP)
      this.wheel = 0
    }
    c.rest = Math.min(bungeeLength.value, Math.max(bungeeMinLength.value, rest))

    const timeout = bungeeTimeout.value
    if (timeout > 0 && this.game.time - c.since > timeout) this.letGo('timedOut')
    else if (length > bungeeLength.value * bungeeSnap.value) this.letGo('snapped')
  }

  private startHook(owner: number, o: THREE.Vector3, vel: THREE.Vector3): Cord {
    const c = this.makeCord(owner)
    c.hook = { pos: o.clone(), prev: o.clone(), vel: vel.clone(), travelled: 0 }
    const mesh = new THREE.Mesh(this.hookGeo, this.coreMat)
    mesh.position.copy(o)
    this.game.scene.add(mesh)
    this.hookMeshes.set(owner, mesh)
    return c
  }

  private makeCord(owner: number): Cord {
    this.remove(owner)
    const view = new CordView([this.tintMat, this.haloMat, this.coreMat], [0.28, 0.5, 0.11])
    view.group.visible = false
    this.game.scene.add(view.group)
    const c: Cord = {
      owner, hook: null, to: null, at: null, normal: new THREE.Vector3(0, 1, 0), rest: 0, since: this.game.time,
      pull: 0, mass: 1, twang: 0, view,
    }
    this.cords.set(owner, c)
    return c
  }

  private remove(owner: number): void {
    const c = this.cords.get(owner)
    if (!c) return
    this.game.scene.remove(c.view.group)
    c.view.dispose()
    const hook = this.hookMeshes.get(owner)
    if (hook) { this.game.scene.remove(hook); this.hookMeshes.delete(owner) }
    const anchor = this.anchorMeshes.get(owner)
    if (anchor) { this.game.scene.remove(anchor); this.anchorMeshes.delete(owner) }
    this.cords.delete(owner)
  }

  private flyHook(c: Cord, dt: number): void {
    const h = c.hook!
    const owner = this.hooks.vehicleOf(c.owner)
    if (!owner) { this.remove(c.owner); return }
    const ref = owner.body.translation()
    const size = this.hooks.wrapSize()
    if (size > 0) {
      h.pos.x = nearestImage(h.pos.x, ref.x, size)
      h.pos.z = nearestImage(h.pos.z, ref.z, size)
    }
    h.prev.copy(h.pos)
    const dist = h.vel.length() * dt
    const dir = h.vel.clone().normalize()
    const mine = c.owner === this.hooks.self()
    // Only the owner decides what its hook catches; a relayed hook just flies for show until
    // the owner's 'on' or 'off' arrives.
    const hit = mine ? this.castHook(h.pos, dir, dist, owner.body) : null
    h.travelled += dist
    if (!hit) {
      h.pos.addScaledVector(dir, dist)
      if (h.travelled > bungeeLength.value * (mine ? 1 : 1.5)) {
        if (mine) this.letGo('released')
        else this.remove(c.owner)
      }
      return
    }
    h.pos.copy(hit.point)
    const victim = hit.handle !== null ? this.hooks.idOfBody(hit.handle) : null
    // A loose physics body that is not a vehicle anchors where it was touched, like ground.
    if (victim !== null && !bungeeVehicles.value) { this.letGo('released'); return }
    c.hook = null
    const span = this.span(c, ref, victim, hit.point)
    c.to = victim
    c.at = victim === null ? this.canonical3(hit.point) : null
    c.normal.copy(hit.normal)
    c.rest = Math.min(bungeeLength.value, Math.max(bungeeMinLength.value, span))
    c.since = this.game.time
    c.twang = 1
    if (victim === null) this.stats.attachedGround++
    else this.stats.attachedVehicle++
    this.hooks.cue?.('bungeeAttach', hit.point)
    this.send(c, true)
  }

  private castHook(from: THREE.Vector3, dir: THREE.Vector3, dist: number, skip: RAPIER.RigidBody) {
    const self = this.hooks.self()
    this.ray.origin = { x: from.x, y: from.y, z: from.z }
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z }
    const hit = this.game.world.castRayAndGetNormal(
      this.ray, dist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP_PROJECTILE, GROUP_ALL & ~GROUP_LIQUID),
      undefined, skip, (col) => {
        const p = col.parent()
        return !p || this.hooks.idOfBody(p.handle) !== self
      },
    )
    if (!hit) return null
    const parent = hit.collider.parent()
    return {
      point: from.clone().addScaledVector(dir, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      handle: parent && !parent.isFixed() ? parent.handle : null,
    }
  }

  /** The two ends of a cord, near each other in the wrapping world, from this client's view. */
  private ends(c: Cord, predicted: boolean): { a: THREE.Vector3; va: THREE.Vector3; b: THREE.Vector3; vb: THREE.Vector3; ma: number; mb: number } | null {
    const owner = this.hooks.vehicleOf(c.owner)
    if (!owner) return null
    const pa = owner.body.translation()
    const la = owner.body.linvel()
    const a = new THREE.Vector3(pa.x, pa.y, pa.z)
    const va = new THREE.Vector3(la.x, la.y, la.z)
    if (predicted) predictInto(a, va, this.hooks.lagOf(c.owner))
    const ma = massOf(owner.body)
    if (c.to === null) {
      if (!c.at) return null
      return { a, va, b: this.nearestTo(c.at, a), vb: new THREE.Vector3(), ma, mb: Infinity }
    }
    const other = this.hooks.vehicleOf(c.to)
    if (!other) return null
    const pb = other.body.translation()
    const lb = other.body.linvel()
    const b = new THREE.Vector3(pb.x, pb.y, pb.z)
    const vb = new THREE.Vector3(lb.x, lb.y, lb.z)
    if (predicted) predictInto(b, vb, this.hooks.lagOf(c.to))
    const size = this.hooks.wrapSize()
    if (size > 0) { b.x = a.x + wrapDelta(a.x, b.x, size); b.z = a.z + wrapDelta(a.z, b.z, size) }
    return { a, va, b, vb, ma, mb: massOf(other.body) }
  }

  private pullCord(c: Cord, dt: number): void {
    if (c.to !== null && !this.hooks.vehicleOf(c.to)) {
      if (c.owner === this.hooks.self()) this.letGo('released')
      return
    }
    const ownsA = this.hooks.owns(c.owner)
    const ownsB = c.to !== null && this.hooks.owns(c.to)
    const e = this.ends(c, true)
    if (!e) return
    const dir = e.b.clone().sub(e.a)
    const length = dir.length()
    if (length < 1e-4) return
    dir.divideScalar(length)
    const rate = dir.dot(e.vb.clone().sub(e.va))
    const mu = reducedMass(e.ma, e.mb)
    const f = cordPull(length, c.rest, rate, mu, this.tuning())
    c.pull = f
    c.mass = mu
    if (f <= 0) return
    const j = f * dt
    const owner = this.hooks.vehicleOf(c.owner)!
    if (ownsA) owner.body.applyImpulse({ x: dir.x * j, y: dir.y * j, z: dir.z * j }, true)
    if (ownsB) this.hooks.vehicleOf(c.to!)!.body.applyImpulse({ x: -dir.x * j, y: -dir.y * j, z: -dir.z * j }, true)
  }

  private span(c: Cord, from: { x: number; y: number; z: number }, to: number | null = c.to, point?: THREE.Vector3): number {
    const a = new THREE.Vector3(from.x, from.y, from.z)
    let b: THREE.Vector3 | null = null
    if (point) b = point
    else if (to !== null) {
      const v = this.hooks.vehicleOf(to)
      if (v) { const p = v.body.translation(); b = new THREE.Vector3(p.x, p.y, p.z) }
    } else if (c.at) b = this.nearestTo(c.at, a)
    if (!b) return c.rest
    const size = this.hooks.wrapSize()
    if (size > 0) return Math.hypot(wrapDelta(a.x, b.x, size), b.y - a.y, wrapDelta(a.z, b.z, size))
    return a.distanceTo(b)
  }

  /** Send the local cord when it changes, a little at most, and now and then while attached. */
  private report(): void {
    const c = this.mine
    if (!c || c.hook) return
    const now = this.game.time
    if (Math.abs(c.rest - this.sentRest) > 0.05 && now - this.sentAt > SEND_GAP) this.send(c, false)
    else if (now - this.sentAt > RESEND) this.send(c, false)
  }

  private send(c: Cord, force: boolean): void {
    if (!this.hooks.send) return
    const now = this.game.time
    if (!force && now - this.sentAt < SEND_GAP) return
    this.sentAt = now
    this.sentRest = c.rest
    const wire: CordWire = c.to !== null
      ? { s: 'on', to: c.to, r: round(c.rest) }
      : { s: 'on', at: c.at ? [round(c.at.x), round(c.at.y), round(c.at.z)] : [0, 0, 0], n: [round(c.normal.x), round(c.normal.y), round(c.normal.z)], r: round(c.rest) }
    this.hooks.send(wire)
  }

  // ---------------------------------------------------------------------------------------

  private drawCord(c: Cord, dt: number, dim: number, camPos: THREE.Vector3, t: CordTuning): void {
    const owner = this.hooks.vehicleOf(c.owner)
    if (!owner) { c.view.group.visible = false; return }
    // Drawn between the rendered (interpolated) vehicles, not the physics bodies, so the cord
    // stays on the roof at any frame rate.
    const a = owner.object.position.clone().add(new THREE.Vector3(0, HITCH, 0).applyQuaternion(owner.object.quaternion))
    const hookMesh = this.hookMeshes.get(c.owner)
    let b: THREE.Vector3
    if (c.hook) {
      b = c.hook.pos.clone()
      if (hookMesh) {
        hookMesh.position.copy(b)
        hookMesh.rotation.y += dt * 12
      }
    } else if (c.to !== null) {
      const other = this.hooks.vehicleOf(c.to)
      if (!other) { c.view.group.visible = false; return }
      b = other.object.position.clone().add(new THREE.Vector3(0, HITCH, 0).applyQuaternion(other.object.quaternion))
      const size = this.hooks.wrapSize()
      if (size > 0) { b.x = a.x + wrapDelta(a.x, b.x, size); b.z = a.z + wrapDelta(a.z, b.z, size) }
    } else if (c.at) {
      b = this.nearestTo(c.at, a)
      this.drawAnchor(c, b)
    } else return
    if (!c.hook && hookMesh) { this.game.scene.remove(hookMesh); this.hookMeshes.delete(c.owner) }

    const span = a.distanceTo(b)
    const sag = c.hook ? 0 : cordSag(span, c.rest)
    c.twang = Math.max(0, c.twang - dt * 2.5)
    const glow = c.hook ? 0.2 : cordGlow(c.pull, c.mass, t)
    const time = this.game.time
    const side = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0))
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
    side.normalize()
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS
      const p = c.view.points[i].lerpVectors(a, b, u)
      const bell = 4 * u * (1 - u)
      p.y -= sag * bell
      // A plucked string: a twang on attach, and a hum that rises with tension.
      const wobble = (c.twang * 0.7 + glow * 0.05) * Math.sin(Math.PI * u) * Math.sin(time * (18 + glow * 30))
      p.addScaledVector(side, wobble)
    }
    c.view.draw(camPos)
    c.view.group.visible = true

    const r = SLACK_RGB[0] + (TAUT_RGB[0] - SLACK_RGB[0]) * glow
    const g = SLACK_RGB[1] + (TAUT_RGB[1] - SLACK_RGB[1]) * glow
    const bl = SLACK_RGB[2] + (TAUT_RGB[2] - SLACK_RGB[2]) * glow
    // One material set for every cord: the local cord's glow drives the colour, others share it.
    if (c.owner === this.hooks.self() || this.cords.size === 1) {
      this.coreMat.color.setRGB(r * dim, g * dim, bl * dim)
      this.haloMat.color.setRGB(r * dim * 0.6, g * dim * 0.6, bl * dim * 0.6)
      this.tintMat.color.setRGB(TINT_RGB[0] * dim, TINT_RGB[1] * dim, TINT_RGB[2] * dim)
    }
  }

  private drawAnchor(c: Cord, at: THREE.Vector3): void {
    let mesh = this.anchorMeshes.get(c.owner)
    if (!mesh) {
      mesh = new THREE.Mesh(this.ringGeo, this.haloMat)
      mesh.scale.setScalar(0.6)
      this.game.scene.add(mesh)
      this.anchorMeshes.set(c.owner, mesh)
    }
    mesh.position.copy(at).addScaledVector(c.normal, 0.05)
    mesh.lookAt(at.clone().add(c.normal))
  }

  /** The landing ring: where the hook would catch, shown while the Bungee is in hand. */
  private drawReticle(dim: number, camPos: THREE.Vector3): void {
    const me = this.hooks.vehicleOf(this.hooks.self())
    const show = bungeeAllowed.value && this.hooks.inHand() && !this.mine && me
    if (!show) { this.reticle.visible = false; return }
    const aim = aimFrom(this.game, me.body, bungeeLength.value, MUZZLE_UP, MUZZLE_AHEAD, LIFT)
    // The aim may pass the camera's target; check what the hook itself would meet first.
    const path = castAim(this.game, aim.o, aim.d, bungeeLength.value, me.body)
    if (!path) { this.reticle.visible = false; return }
    const vehicle = path.handle !== null && this.hooks.idOfBody(path.handle) !== null
    const ok = !vehicle || bungeeVehicles.value
    const k = ok ? dim : dim * 0.25
    this.ringMat.color.setRGB((vehicle ? TAUT_RGB[0] : SLACK_RGB[0]) * k, (vehicle ? TAUT_RGB[1] : SLACK_RGB[1]) * k, (vehicle ? TAUT_RGB[2] : SLACK_RGB[2]) * k)
    this.reticle.position.copy(path.point).addScaledVector(path.normal, 0.08)
    this.reticle.lookAt(path.point.clone().add(path.normal))
    this.reticle.scale.setScalar(Math.max(0.6, camPos.distanceTo(path.point) * 0.018))
    this.reticle.visible = true
  }

  // ---------------------------------------------------------------------------------------

  private canonical(p: THREE.Vector3): Vec3 {
    const c = this.canonical3(p)
    return [round(c.x), round(c.y), round(c.z)]
  }

  private canonical3(p: THREE.Vector3): THREE.Vector3 {
    const size = this.hooks.wrapSize()
    if (!(size > 0)) return p.clone()
    return new THREE.Vector3(nearestImage(p.x, 0, size), p.y, nearestImage(p.z, 0, size))
  }

  private nearestTo(p: THREE.Vector3, ref: THREE.Vector3): THREE.Vector3 {
    const size = this.hooks.wrapSize()
    if (!(size > 0)) return p.clone()
    return new THREE.Vector3(nearestImage(p.x, ref.x, size), p.y, nearestImage(p.z, ref.z, size))
  }

  private nearest(p: THREE.Vector3): THREE.Vector3 {
    const me = this.hooks.vehicleOf(this.hooks.self())
    if (!me) return p
    const t = me.body.translation()
    return this.nearestTo(p, new THREE.Vector3(t.x, t.y, t.z))
  }
}

function predictInto(p: THREE.Vector3, v: THREE.Vector3, lag: number): void {
  if (!(lag > 0)) return
  p.set(predict(p.x, v.x, lag), predict(p.y, v.y, lag), predict(p.z, v.z, lag))
}

function massOf(body: RAPIER.RigidBody): number {
  const m = body.mass()
  return m > 0 && Number.isFinite(m) ? m : 600
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}


/**
 * Pesters: slow, wobbly plasma orbs with googly eyes that chase another player and tag them
 * if they catch up. They pop after `pester.life` seconds.
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
import * as THREE from 'three/webgpu'
import type { ShotInfo } from '../../../shared/protocol'
import { nearestImage, wrapDelta } from '../../../shared/wrap'
import type { Game, System } from '../../core/Game'
import { FIXED_DT, type RAPIER } from '../../core/physics'
import { hotExposureDim } from '../../vehicles/skins/hotExposure'
import { aimFrom } from '../aim'
import { pesterAllowed, pesterLife, pesterMax, pesterRadius, pesterRange, pesterSpeed, pesterTurn } from './params'
import { steer, type V3 } from './steer'

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
  /** A Pester caught a vehicle this client judges. */
  onCatch(shooter: number, shot: number, victim: number, at: THREE.Vector3, dir: THREE.Vector3): void
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
  mesh: THREE.Group
  seed: number
}

/** Pesters keep this far above the ground. */
const HOVER = 1.4
/** The cone, degrees, in which an aimed-at vehicle is preferred over the nearest one. */
const PICK_CONE = 30
const POP_TIME = 0.3
const MAX_CATCH_UP = 2
/** Lift and lean of a launch: up and ahead from the roof. */
const LAUNCH_UP = 0.5

/** Linear RGB at daytime exposure: hot magenta plasma, which no other gear uses. */
const CORE_RGB = [3.6, 0.7, 3] as const
const HALO_RGB = [1.6, 0.2, 1.4] as const
const TINT_RGB = [0.45, 0.04, 0.4] as const

export class Pesters implements System {
  private readonly orbs: Orb[] = []
  private readonly sphere = new THREE.SphereGeometry(1, 18, 12)
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...CORE_RGB) })
  private readonly haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...HALO_RGB), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
  })
  private readonly tintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...TINT_RGB), transparent: true, opacity: 0.45, depthWrite: false })
  private readonly eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) })
  private readonly pupilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.01, 0.01, 0.02) })
  private fireWas = false
  private nextSeed = 1
  stats = { launched: 0, caught: 0, popped: 0 }

  constructor(private readonly game: Game, private readonly hooks: PesterHooks) {}

  /** Pesters the local player has out. */
  get mine(): number {
    const me = this.hooks.self()
    return this.orbs.filter((o) => o.shooter === me && o.popped < 0).length
  }

  /** Every live Pester, for checks: shooter, target and position. */
  list(): { shooter: number; to: number | null; pos: [number, number, number] }[] {
    return this.orbs.filter((o) => o.popped < 0).map((o) => ({ shooter: o.shooter, to: o.to, pos: [o.pos.x, o.pos.y, o.pos.z] }))
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
      mesh: this.makeMesh(), seed: this.nextSeed++,
    }
    o.mesh.position.copy(o.pos)
    this.game.scene.add(o.mesh)
    this.orbs.push(o)
    let catchUp = Math.min(MAX_CATCH_UP, Math.max(0, age))
    while (catchUp >= FIXED_DT && o.popped < 0) { this.step(o, FIXED_DT); catchUp -= FIXED_DT }
    o.prev.copy(o.pos)
    if (shooter === this.hooks.self()) this.stats.launched++
  }

  /** The room confirmed a catch: pop that Pester everywhere. */
  confirmHit(shooter: number, shot: number): void {
    const o = this.orbs.find((p) => p.shooter === shooter && p.id === shot && p.popped < 0)
    if (o) this.pop(o)
  }

  /** A player left: pop their Pesters. */
  forget(id: number): void {
    for (const o of this.orbs) if (o.shooter === id && o.popped < 0) this.pop(o)
  }

  fixedUpdate(dt: number): void {
    if (!pesterAllowed.value) {
      for (const o of this.orbs) if (o.popped < 0) this.pop(o)
      this.fireWas = false
    } else {
      const fire = this.hooks.inHand() && this.game.input.state.fire
      if (fire && !this.fireWas) this.hooks.launch(this.pick())
      this.fireWas = fire
    }
    for (const o of this.orbs) {
      o.prev.copy(o.pos)
      if (o.popped < 0) this.step(o, dt)
    }
  }

  update(dt: number, alpha: number): void {
    const dim = hotExposureDim(this.game.renderer.toneMappingExposure)
    this.coreMat.color.setRGB(CORE_RGB[0] * dim, CORE_RGB[1] * dim, CORE_RGB[2] * dim)
    this.haloMat.color.setRGB(HALO_RGB[0] * dim, HALO_RGB[1] * dim, HALO_RGB[2] * dim)
    this.tintMat.color.setRGB(TINT_RGB[0] * dim, TINT_RGB[1] * dim, TINT_RGB[2] * dim)
    const t = this.game.time
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]
      if (o.popped >= 0) {
        o.popped += dt
        const k = o.popped / POP_TIME
        o.mesh.scale.setScalar(1 + k * 2.5)
        o.mesh.children.forEach((c, j) => { c.visible = j === 1 })
        if (k >= 1) {
          this.game.scene.remove(o.mesh)
          this.orbs.splice(i, 1)
        }
        continue
      }
      // A jittery wobble on top of the path, its own for each Pester.
      const s = o.seed * 1.7
      o.mesh.position.lerpVectors(o.prev, o.pos, alpha)
      o.mesh.position.x += 0.35 * Math.sin(t * 7 + s)
      o.mesh.position.y += 0.3 * Math.sin(t * 9.3 + s * 2)
      o.mesh.position.z += 0.35 * Math.cos(t * 6.1 + s)
      o.mesh.scale.setScalar(1 + 0.12 * Math.sin(t * 13 + s))
      // The eyes look where it is going.
      o.mesh.lookAt(o.mesh.position.clone().add(new THREE.Vector3(...o.vel)))
    }
  }

  dispose(): void {
    for (const o of this.orbs) this.game.scene.remove(o.mesh)
    this.orbs.length = 0
    this.sphere.dispose()
    for (const m of [this.coreMat, this.haloMat, this.tintMat, this.eyeMat, this.pupilMat]) m.dispose()
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

  /** A glowing orb with googly eyes, all generated. */
  private makeMesh(): THREE.Group {
    const g = new THREE.Group()
    const tint = new THREE.Mesh(this.sphere, this.tintMat)
    tint.scale.setScalar(0.75)
    tint.renderOrder = -1
    const halo = new THREE.Mesh(this.sphere, this.haloMat)
    halo.scale.setScalar(1.15)
    const core = new THREE.Mesh(this.sphere, this.coreMat)
    core.scale.setScalar(0.55)
    g.add(tint, halo, core)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(this.sphere, this.eyeMat)
      eye.scale.setScalar(0.2)
      eye.position.set(side * 0.24, 0.2, 0.52)
      const pupil = new THREE.Mesh(this.sphere, this.pupilMat)
      pupil.scale.setScalar(0.1)
      pupil.position.set(side * 0.25, 0.2, 0.68)
      g.add(eye, pupil)
    }
    return g
  }
}

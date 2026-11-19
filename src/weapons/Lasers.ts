/**
 * Laser tag projectiles, after Rocket.js.
 *
 * Every client simulates every shot from the same origin, direction and server timestamp,
 * so they fly the same path everywhere. A client that learns of a shot late replays the time
 * it missed (the original's lag compensation, Rocket.js 57).
 *
 * Hits on vehicles are decided only by the victim's own client, where that vehicle's
 * position is exact (Rocket.js 82-85). Everywhere else lasers pass through remote vehicles
 * until the server announces the hit.
 *
 * What is drawn is not where the shot is simulated. The shot flies from the muzzle point
 * `aim` gives, along the aimed line, and that alone decides hits. The drawn beam keeps its
 * tail on the firing vehicle's drawn centre until the head is a full beam length out, so it
 * visibly leaves from inside the vehicle on every frame, at any speed, and for remote players
 * whose replicas are drawn a little in the past. A soft glow at that centre marks the shot.
 */
import * as THREE from 'three/webgpu'
import { float, normalView, positionViewDirection } from 'three/tsl'
import type { ShotInfo } from '../../shared/protocol'
import type { Game, System } from '../core/Game'
import { FIXED_DT, GROUP_ALL, GROUP_LIQUID, GROUP_PROJECTILE, RAPIER, groups } from '../core/physics'
import { createWeaponEffects } from '../vehicles/effects'
import { hotExposureDim } from '../vehicles/skins/hotExposure'
import { laserGravity, laserLifetime, laserRicochet, laserSpeed } from './params'
import { bigRedRadius, bigRedSpeed } from './bigRedParams'
import { warmGear } from './warm'
import { ImpactPulses } from './pulse'
import { ImpactFx, type ImpactTerrain } from './impact/ImpactFx'
import { CLIMB_SECONDS, Fireworks } from './fireworks/Fireworks'
import { thunderFlareHeight, thunderFuseAir, thunderFuseAirHeight, thunderFuseArm, thunderFuseGround, thunderSkipAngle, thunderSkipBounce, thunderSkipGravity, thunderSkipKeep, thunderSkipPush, thunderSkips } from './thunderParams'
import { fireworkSeed, fuseArmed, fuseRadius, nearestOnSegment, skipOff, type ThunderCause, type V3 } from './thunderRules'
import { thunderBlastRadius } from './blastParams'

export interface LaserHooks {
  /** Body of a player's (or bot's) vehicle, local or remote, if it exists here. */
  bodyOf(playerId: number): RAPIER.RigidBody | undefined
  /**
   * If this client judges hits on the vehicle with this body handle (its own player, and the
   * bots when it is host), that vehicle's id; otherwise null.
   */
  judgedId(handle: number): number | null
  /** True if the body belongs to some vehicle simulated elsewhere. */
  isVehicleBody(handle: number): boolean
  /** A shot hit a vehicle this client judges. `dir` is the shot's unit direction; `red` for Big Red. */
  onHit(shooter: number, shot: number, victim: number, at: THREE.Vector3, dir: THREE.Vector3, red: boolean): void
  /**
   * A shot ended at `at`, on anything; once per shot on every client. For the impact push;
   * `share` of the full push (a Plasma Thunder skip pushes less than its detonation).
   */
  onImpact?(at: THREE.Vector3, red: boolean, share?: number): void
  /** Vehicles this client judges (its own; the bots when it is host), for Plasma Thunder's fuse. */
  judged?(): Iterable<{ id: number; x: number; y: number; z: number; clearance: number }>
  /** True if this client speaks for shots from `shooter` (its own; a bot's when it is host). */
  ownsShot?(shooter: number): boolean
  /** Plasma Thunder went off here, as this client judged it: tell the room. */
  onDetonate?(shooter: number, shot: number, cause: ThunderCause, at: THREE.Vector3, victim?: number): void
  /** The shooter's two vehicle colours, for its fireworks. */
  colorsOf?(id: number): readonly [THREE.Color, THREE.Color] | undefined
  /** A Plasma Thunder burst, seen at `at` after `delay` s (a flare climbs first): for the map and the sound. */
  onBurst?(shooter: number, at: THREE.Vector3, cause: ThunderCause, delay: number): void
  /**
   * Writes the centre of a player's (or bot's) vehicle as it is drawn this frame, at blend
   * `alpha` between the last two physics steps, and returns true; false if it is not here.
   * The drawn beam leaves from this point. Without it, beams are drawn as they fly.
   */
  centreOf?(playerId: number, alpha: number, out: THREE.Vector3): boolean
  /** The world's terrain, for impacts that look like what they struck (impact/ImpactFx.ts). */
  terrain?(): ImpactTerrain | undefined
}

interface Projectile {
  shooter: number
  id: number
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: THREE.Vector3
  age: number
  life: number
  mesh: THREE.Group
  /** Big Red: fat, slow, no drop, no bounce, catches vehicles within its width. */
  red: boolean
  /** The drawn tail is still held at the shooter's centre. Cleared for good once it lets go. */
  tied: boolean
  /** Seconds since first drawn; -1 before. */
  shown: number
  /** Drawn length at the end of the hold, for a late shot whose head is already far out. */
  reach: number
  /** Plasma Thunder: skips off the ground so far. */
  skips: number
}

interface Glow {
  shooter: number
  age: number
  mesh: THREE.Mesh
}

/** The longest a late shot is replayed; older ones are mostly gone anyway. */
const MAX_CATCH_UP = 2
/** Bright core length, and the tapering trail behind it (LaserAuto: width .5 to .2). */
const LENGTH = 4
const TRAIL = 10
/** A shot younger than this is fresh: it gets a muzzle flash. Replayed old shots do not. */
const FRESH = 0.15
/** How far under the camera the sparks are compiled, metres: under any terrain. */
const SPARK_WARM_DEPTH = 4000

/** The beam's colours at daytime exposure, linear RGB: core, additive halo, blended tint. */
const CORE_RGB = [0.9, 4, 1.4] as const
const HALO_RGB = [0.25, 1.6, 0.45] as const
const TINT_RGB = [0.1, 0.75, 0.25] as const
/** Big Red's colours, the same recipe in red. */
/** Colours of an impact: the gear's own, bright (linear). */
const TAG_IMPACT = new THREE.Color(0.9, 4, 1.4)
const RED_IMPACT = new THREE.Color(4, 0.55, 0.35)
const RED_SHOCK = new THREE.Color(4, 0.55, 0.35).multiplyScalar(0.6)
/** Up, for a detonation with no surface (in the air). */
const UP_NORMAL = new THREE.Vector3(0, 1, 0)
/** Seconds a client waits for the room to say where a shot it did not fire went off. */
const END_WAIT = 1.5
const RED_FALLBACK = new THREE.Color(0.9, 0.08, 0.05)
const GOLD_FALLBACK = new THREE.Color(1, 0.75, 0.3)
const TAG_SHOCK = new THREE.Color(0.9, 4, 1.4).multiplyScalar(0.5)
const RED_CORE_RGB = [4, 0.55, 0.35] as const
const RED_HALO_RGB = [1.8, 0.18, 0.1] as const
const RED_TINT_RGB = [0.8, 0.05, 0.03] as const
/** Big Red's look: this much fatter, and a little longer. */
const RED_SCALE = [3, 3, 1.6] as const
/** Offsets around the centre line Big Red checks for vehicles, as fractions of its radius. */
/**
 * Local z of the beam's front and its full length, metres, before the mesh's own scale: the
 * core is centred on the shot and the halo trails behind it.
 */
const FRONT = LENGTH / 2
const SPAN = TRAIL
/**
 * A shot learnt of late (another player's, replayed) can already be far out on its first
 * frame. Its drawn tail starts at the shooter and catches up at this speed, metres a second,
 * instead of the beam appearing detached in mid air.
 */
const RETRACT = 400
/** Seconds such a late shot's tail stays on the shooter first, as a fresh shot's does. */
const HOLD = 0.04
/**
 * The firing glow: radius in metres, how long it lasts, and how far above the vehicle's
 * centre it sits, so it wells up through the body instead of pooling on the ground.
 */
const GLOW_RADIUS = 1.25
const GLOW_SECONDS = 0.16
const RED_GLOW_RADIUS = 2
const RED_GLOW_SECONDS = 0.28
const GLOW_LIFT = 0.35

const RED_RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const

export class Lasers implements System {
  private readonly shots: Projectile[] = []
  // Syn3h's LaserAuto look: plasma green. +Z is the direction of travel after rotateX.
  private readonly coreGeo = new THREE.CylinderGeometry(0.08, 0.08, LENGTH, 6, 1).rotateX(Math.PI / 2)
  /** Halo that tapers from 0.25 m at the head to 0.1 m at the tail, trailing behind. */
  private readonly haloGeo = new THREE.CylinderGeometry(0.25, 0.1, TRAIL, 8, 1).rotateX(Math.PI / 2).translate(0, 0, -TRAIL / 2 + LENGTH / 2)
  // Colours above 1 survive tone mapping as a hot, near white core: the glow without bloom.
  private readonly coreMat = new THREE.MeshBasicMaterial({ name: 'gear beam core', color: new THREE.Color(...CORE_RGB) })
  private readonly haloMat = new THREE.MeshBasicMaterial({
    name: 'gear beam halo', color: new THREE.Color(...HALO_RGB), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  // The wing material's recipe: additive light washes out to white over a sunlit desert, so a
  // normally blended tint underneath keeps the green readable at noon.
  private readonly tintMat = new THREE.MeshBasicMaterial({
    name: 'gear beam tint', color: new THREE.Color(...TINT_RGB), transparent: true, opacity: 0.3, depthWrite: false,
  })
  private readonly redCoreMat = new THREE.MeshBasicMaterial({ name: 'gear red core', color: new THREE.Color(...RED_CORE_RGB) })
  private readonly redHaloMat = new THREE.MeshBasicMaterial({
    name: 'gear red halo', color: new THREE.Color(...RED_HALO_RGB), transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  private readonly redTintMat = new THREE.MeshBasicMaterial({
    name: 'gear red tint', color: new THREE.Color(...RED_TINT_RGB), transparent: true, opacity: 0.35, depthWrite: false,
  })
  /**
   * The firing glow: a sphere bright at its middle and fading to nothing at its rim, so it
   * reads as light swelling out of the vehicle rather than a ball. Depth tested, so it shows
   * around the body and never through hills. Sized, not faded: the material is shared.
   */
  private readonly glowGeo = new THREE.SphereGeometry(1, 20, 14)
  private readonly glowMat = Lasers.glowMaterial('gear beam glow', HALO_RGB)
  private readonly redGlowMat = Lasers.glowMaterial('gear red glow', RED_HALO_RGB)
  private readonly glows: Glow[] = []
  private readonly centre = new THREE.Vector3()
  private readonly front = new THREE.Vector3()
  private readonly axis = new THREE.Vector3()
  private readonly effects: ReturnType<typeof createWeaponEffects> | null
  private readonly pulses: ImpactPulses
  /** What an impact looks like: flash, sparks, ground light, debris and scorch, by surface. */
  readonly fx: ImpactFx
  /** Plasma Thunder's fireworks. */
  readonly fireworks: Fireworks
  /** Plasma Thunder shots that have burst here (shooter:shot), so each bursts once. */
  private readonly burstKeys = new Set<string>()
  /** Shots another client speaks for, ended here, waiting for the room to say where they burst. */
  private readonly waiting = new Map<string, { shooter: number; shot: number; at: THREE.Vector3; normal: THREE.Vector3; until: number }>()
  /** Shots that already showed their impact here, so a later server confirmation does not repeat it. */
  private readonly impacted = new Set<string>()
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  private readonly tmp = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  /** Shots fired here, counted for ids. */
  private nextShotId = 1
  private readonly unwarm: () => void

  constructor(private readonly game: Game, private readonly hooks: LaserHooks) {
    this.pulses = new ImpactPulses(game)
    this.fx = new ImpactFx(game, () => this.hooks.terrain?.())
    this.fireworks = new Fireworks(game)
    let effects: ReturnType<typeof createWeaponEffects> | null = null
    try {
      effects = createWeaponEffects(game)
    } catch (err) {
      // Cosmetic only: lasers still fly and hit without sparks.
      console.warn('tag beam effects unavailable', err)
    }
    this.effects = effects
    // The sparks are instanced batches that draw nothing until a particle exists, so the
    // only way to compile them early is one short flash far below the ground.
    const below = new THREE.Vector3(), ahead = new THREE.Vector3(0, 0, -1)
    this.unwarm = warmGear(game, [
      [this.coreGeo, this.coreMat], [this.haloGeo, this.tintMat], [this.haloGeo, this.haloMat],
      [this.coreGeo, this.redCoreMat], [this.haloGeo, this.redTintMat], [this.haloGeo, this.redHaloMat],
      [this.glowGeo, this.glowMat], [this.glowGeo, this.redGlowMat],
    ], () => {
      game.camera.getWorldPosition(below).y -= SPARK_WARM_DEPTH
      this.effects?.muzzle(below, ahead, false)
      this.effects?.muzzle(below, ahead, true)
    })
  }

  get count(): number {
    return this.shots.length
  }

  private static glowMaterial(name: string, rgb: readonly [number, number, number]): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({
      name, color: new THREE.Color(...rgb), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    // Facing the camera at the middle, edge on at the rim: a soft disc in every direction.
    m.opacityNode = normalView.dot(positionViewDirection).max(0).pow(float(3.5)).mul(0.75)
    return m
  }

  /** Muzzle, direction and inherited speed for a shot from a vehicle body, as in VehicleMe.js 64. */
  aim(body: RAPIER.RigidBody, now: number): ShotInfo {
    const r = body.rotation()
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    const t = body.translation()
    const o = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(fwd, 2.4).addScaledVector(up, 0.4)
    const v = body.linvel()
    // Rocket.js 15-18: the launcher's forward speed adds to the laser's.
    const boost = Math.max(0, v.x * fwd.x + v.y * fwd.y + v.z * fwd.z)
    return { id: this.nextShotId++, o: [o.x, o.y, o.z], d: [fwd.x, fwd.y, fwd.z], boost, t: now }
  }

  /** Start a shot. `age` is how long ago it was fired, in seconds; that much is replayed. */
  spawn(shooter: number, shot: ShotInfo, age = 0): void {
    const red = shot.k === 'red'
    const speed = (red ? bigRedSpeed.value : laserSpeed.value) + shot.boost
    const p: Projectile = {
      shooter,
      id: shot.id,
      pos: new THREE.Vector3(...shot.o),
      prev: new THREE.Vector3(...shot.o),
      vel: new THREE.Vector3(...shot.d).normalize().multiplyScalar(speed),
      age: 0,
      // The room checks hits against this same lifetime, so Big Red keeps it too.
      life: laserLifetime(laserSpeed.value),
      mesh: new THREE.Group(),
      red,
      tied: true,
      shown: -1,
      reach: 0,
      skips: 0,
    }
    const tint = new THREE.Mesh(this.haloGeo, red ? this.redTintMat : this.tintMat)
    tint.renderOrder = -1
    p.mesh.add(new THREE.Mesh(this.coreGeo, red ? this.redCoreMat : this.coreMat), tint, new THREE.Mesh(this.haloGeo, red ? this.redHaloMat : this.haloMat))
    if (red) p.mesh.scale.set(...RED_SCALE)
    else p.mesh.scale.set(0.5, 0.5, 1)
    if (age < FRESH) {
      // The vehicle's own light swells as it fires. Without a vehicle to centre it on, the
      // old sparks at the muzzle stand in.
      if (this.hooks.centreOf) this.addGlow(shooter, red)
      else this.effects?.muzzle(p.pos.clone(), new THREE.Vector3(...shot.d).normalize(), red)
    }
    p.mesh.position.copy(p.pos)
    p.mesh.visible = false
    this.game.scene.add(p.mesh)
    this.shots.push(p)
    let catchUp = Math.min(MAX_CATCH_UP, Math.max(0, age))
    while (catchUp >= FIXED_DT && this.shots.includes(p)) {
      this.step(p, FIXED_DT)
      catchUp -= FIXED_DT
    }
    p.prev.copy(p.pos)
  }

  /** The server confirmed a hit: end that shot everywhere with one impact. */
  confirmHit(shooter: number, shot: number, at?: THREE.Vector3): void {
    const i = this.shots.findIndex((s) => s.shooter === shooter && s.id === shot)
    const p = i >= 0 ? this.shots[i] : null
    const where = at ?? p?.pos
    if (where) this.impact(shooter, shot, where, p ? p.vel.clone().normalize().negate() : undefined, p?.red ?? false, true)
    if (i >= 0) this.kill(i)
  }

  /**
   * The world wrapped under the local player, who moved one tile over by (dx, dz) (Vehicle's
   * tileshift): carry everything drawn here with it, so nothing jumps at the seam. Shots in
   * flight, their glows, a burst waiting for the room's word, impacts, scorches and fireworks.
   */
  shift(dx: number, dz: number): void {
    for (const p of this.shots) { p.pos.x += dx; p.pos.z += dz; p.prev.x += dx; p.prev.z += dz; p.mesh.position.x += dx; p.mesh.position.z += dz }
    for (const w of this.waiting.values()) { w.at.x += dx; w.at.z += dz }
    this.pulses.shift(dx, dz); this.fx.shift(dx, dz); this.fireworks.shift(dx, dz)
  }

  /** Remove every shot in flight: for a world change or leaving it. Impact effects fade on their own. */
  reset(): void {
    while (this.shots.length) this.kill(this.shots.length - 1)
    while (this.glows.length) this.dropGlow(this.glows.length - 1)
    this.pulses.reset()
    this.fx.reset()
    this.fireworks.reset()
    this.waiting.clear()
  }

  fixedUpdate(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i]
      p.prev.copy(p.pos)
      this.step(p, dt)
    }
  }

  update(dt: number, alpha: number): void {
    this.pulses.update(dt)
    this.fx.update(dt)
    this.fireworks.update(dt)
    // A shot another client spoke for, whose word never came: burst where it ended, no push.
    for (const [key, w] of this.waiting) if (this.game.time > w.until) { this.waiting.delete(key); this.burst(w.shooter, w.shot, w.at, w.normal, 'end', false) }
    // The sky raises the exposure at night, which would bleach these unlit HDR colours toward
    // white. Scale each from its own constant every frame; never from the current colour,
    // which would compound.
    const dim = hotExposureDim(this.game.renderer.toneMappingExposure)
    this.coreMat.color.setRGB(CORE_RGB[0] * dim, CORE_RGB[1] * dim, CORE_RGB[2] * dim)
    this.haloMat.color.setRGB(HALO_RGB[0] * dim, HALO_RGB[1] * dim, HALO_RGB[2] * dim)
    this.tintMat.color.setRGB(TINT_RGB[0] * dim, TINT_RGB[1] * dim, TINT_RGB[2] * dim)
    this.redCoreMat.color.setRGB(RED_CORE_RGB[0] * dim, RED_CORE_RGB[1] * dim, RED_CORE_RGB[2] * dim)
    this.redHaloMat.color.setRGB(RED_HALO_RGB[0] * dim, RED_HALO_RGB[1] * dim, RED_HALO_RGB[2] * dim)
    this.redTintMat.color.setRGB(RED_TINT_RGB[0] * dim, RED_TINT_RGB[1] * dim, RED_TINT_RGB[2] * dim)
    this.glowMat.color.setRGB(HALO_RGB[0] * dim, HALO_RGB[1] * dim, HALO_RGB[2] * dim)
    this.redGlowMat.color.setRGB(RED_HALO_RGB[0] * dim, RED_HALO_RGB[1] * dim, RED_HALO_RGB[2] * dim)
    for (const p of this.shots) this.place(p, dt, alpha)
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i]
      g.age += dt
      const red = g.mesh.material === this.redGlowMat
      const t = g.age / (red ? RED_GLOW_SECONDS : GLOW_SECONDS)
      if (t >= 1 || !this.hooks.centreOf?.(g.shooter, alpha, this.centre)) {
        this.dropGlow(i)
        continue
      }
      // Swells fast, then sinks back into the vehicle.
      const r = (red ? RED_GLOW_RADIUS : GLOW_RADIUS) * Math.sin(Math.PI * Math.sqrt(t))
      g.mesh.position.copy(this.centre).y += GLOW_LIFT
      g.mesh.scale.setScalar(Math.max(1e-3, r))
      g.mesh.visible = true
    }
  }

  /**
   * Where a shot is drawn this frame. Free flying, the front of the beam is the interpolated
   * shot plus half the core, and the beam is one span long behind it, along its velocity.
   * Tied, the tail sits on the shooter's drawn centre and the beam runs from there to the
   * same front, so it grows out of the vehicle. It lets go once a full span is out.
   */
  private place(p: Projectile, dt: number, alpha: number): void {
    const mesh = p.mesh
    mesh.visible = true
    p.shown = p.shown < 0 ? 0 : p.shown + dt
    const sz = p.red ? RED_SCALE[2] : 1
    const span = SPAN * sz
    const at = this.tmp.lerpVectors(p.prev, p.pos, alpha)
    const dir = this.axis.copy(p.vel)
    if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1)
    dir.normalize()
    const front = this.front.copy(at).addScaledVector(dir, FRONT * sz)
    let len = span
    if (p.tied) {
      if (this.hooks.centreOf?.(p.shooter, alpha, this.centre)) {
        const v = this.look.subVectors(front, this.centre)
        const out = v.length()
        // Through the hold the tail stays on the centre however far out the front is.
        if (p.shown <= HOLD) p.reach = Math.max(p.reach, out)
        const allowed = Math.max(span, p.reach - RETRACT * Math.max(0, p.shown - HOLD))
        // A front still level with or behind the centre (a replica drawn ahead of where the
        // shot was fired) would draw the beam backwards: hold it hidden until it is out.
        if (out < 1e-3 || v.dot(dir) <= 0) {
          mesh.visible = false
          return
        }
        if (out <= allowed) {
          len = out
          dir.copy(v).divideScalar(out)
        } else {
          len = allowed
          if (allowed <= span) p.tied = false
        }
      } else {
        p.tied = false
      }
    }
    // Scale the beam along its length; the front stays put.
    const k = len / SPAN
    mesh.scale.z = k
    mesh.position.copy(front).addScaledVector(dir, -FRONT * k)
    mesh.lookAt(this.look.copy(mesh.position).add(dir))
  }

  /** Where the drawn beam starts and ends this frame, for checks. Null while it is hidden. */
  drawnSpan(shooter: number, shot: number): { tail: THREE.Vector3; head: THREE.Vector3 } | null {
    const p = this.shots.find((s) => s.shooter === shooter && s.id === shot)
    if (!p || !p.mesh.visible) return null
    p.mesh.updateMatrixWorld()
    return {
      tail: new THREE.Vector3(0, 0, FRONT - SPAN).applyMatrix4(p.mesh.matrixWorld),
      head: new THREE.Vector3(0, 0, FRONT).applyMatrix4(p.mesh.matrixWorld),
    }
  }

  private addGlow(shooter: number, red: boolean): void {
    // One glow per vehicle: a new shot restarts it rather than stacking light.
    const i = this.glows.findIndex((g) => g.shooter === shooter)
    if (i >= 0) this.dropGlow(i)
    const mesh = new THREE.Mesh(this.glowGeo, red ? this.redGlowMat : this.glowMat)
    mesh.visible = false
    mesh.renderOrder = 1
    this.game.scene.add(mesh)
    this.glows.push({ shooter, age: 0, mesh })
  }

  private dropGlow(i: number): void {
    this.game.scene.remove(this.glows[i].mesh)
    this.glows.splice(i, 1)
  }

  dispose(): void {
    while (this.shots.length) this.kill(this.shots.length - 1)
    while (this.glows.length) this.dropGlow(this.glows.length - 1)
    this.glowGeo.dispose(); this.glowMat.dispose(); this.redGlowMat.dispose()
    this.effects?.dispose()
    this.pulses.dispose()
    this.fx.dispose()
    this.fireworks.dispose()
    this.unwarm()
    this.coreGeo.dispose(); this.haloGeo.dispose()
    for (const m of [this.coreMat, this.haloMat, this.tintMat, this.redCoreMat, this.redHaloMat, this.redTintMat]) m.dispose()
  }

  private step(p: Projectile, dt: number): void {
    p.age += dt
    if (p.age > p.life) {
      // Plasma Thunder goes off where it is when its life runs out: a burst in the air.
      if (p.red) this.detonate(p, p.pos.clone(), UP_NORMAL, 'end')
      else this.kill(this.shots.indexOf(p))
      return
    }
    // Rocket.js 71: laserGrav * 20 metres per second squared. Big Red flies flat until it
    // first skips off the ground; then it falls, so it comes down to skip again.
    if (!p.red) p.vel.y -= laserGravity.value * 20 * dt
    else if (p.skips > 0) p.vel.y -= thunderSkipGravity.value * dt
    const dist = p.vel.length() * dt
    if (dist < 1e-6) return
    const dir = this.tmp.copy(p.vel).normalize()
    this.ray.origin = { x: p.pos.x, y: p.pos.y, z: p.pos.z }
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z }

    const shooterBody = this.hooks.bodyOf(p.shooter)
    const hit = this.game.world.castRayAndGetNormal(
      this.ray, dist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP_PROJECTILE, GROUP_ALL & ~GROUP_LIQUID),
      undefined, shooterBody,
      (c) => {
        const parent = c.parent()
        if (!parent) return true
        // The launcher is immune (Rocket.js 79).
        if (shooterBody && parent.handle === shooterBody.handle) return false
        const judged = this.hooks.judgedId(parent.handle)
        if (judged !== null) return judged !== p.shooter
        // Remote vehicles are judged by their own clients.
        return !this.hooks.isVehicleBody(parent.handle)
      },
    )
    const parent0 = hit?.collider.parent()
    // Big Red is fat: if its centre line meets no vehicle we judge, look around the centre.
    if (p.red && !(parent0 && this.hooks.judgedId(parent0.handle) !== null)) {
      const wide = this.wideCatch(p, dir, hit ? hit.timeOfImpact : dist, shooterBody)
      if (wide) {
        // Contact with a vehicle: it goes off at once, armed or not.
        this.hooks.onHit(p.shooter, p.id, wide.victim, wide.point, dir.clone(), true)
        this.detonate(p, wide.point, dir.clone().negate(), 'contact', wide.victim)
        return
      }
    }
    if (hit) {
      const point = new THREE.Vector3(p.pos.x + dir.x * hit.timeOfImpact, p.pos.y + dir.y * hit.timeOfImpact, p.pos.z + dir.z * hit.timeOfImpact)
      const parent = hit.collider.parent()
      const victim = parent ? this.hooks.judgedId(parent.handle) : null
      if (victim !== null) {
        this.hooks.onHit(p.shooter, p.id, victim, point, dir.clone(), p.red)
        if (p.red) this.detonate(p, point, dir.clone().negate(), 'contact', victim)
        else { this.impact(p.shooter, p.id, point, dir.clone().negate(), false, true); this.kill(this.shots.indexOf(p)) }
        return
      }
    }
    // Plasma Thunder's proximity fuse, once armed: a vehicle this client judges within reach of
    // this step's flight (up to whatever it hits) sets it off. The shooter's own never does.
    if (p.red && this.hooks.judged && fuseArmed(p.age, thunderFuseArm.value)) {
      const reach = hit ? hit.timeOfImpact : dist
      const from: V3 = [p.pos.x, p.pos.y, p.pos.z], to: V3 = [p.pos.x + dir.x * reach, p.pos.y + dir.y * reach, p.pos.z + dir.z * reach]
      const rule = { ground: thunderFuseGround.value, air: thunderFuseAir.value, airHeight: thunderFuseAirHeight.value }
      for (const v of this.hooks.judged()) {
        if (v.id === p.shooter) continue
        const near = nearestOnSegment(from, to, [v.x, v.y, v.z])
        if (near.distance <= fuseRadius(v.clearance, rule)) {
          this.detonate(p, new THREE.Vector3(...near.point), dir.clone().negate(), 'fuse', v.id)
          return
        }
      }
    }
    if (!hit) {
      p.pos.addScaledVector(dir, dist)
      return
    }
    const point = new THREE.Vector3(p.pos.x + dir.x * hit.timeOfImpact, p.pos.y + dir.y * hit.timeOfImpact, p.pos.z + dir.z * hit.timeOfImpact)
    const parent = hit.collider.parent()
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
    const isBody = parent && !parent.isFixed()
    if (p.red) {
      // Plasma Thunder off the ground: a skip if it came in shallow and has skips left, else
      // it goes off. Nothing skips off anything that moves.
      const skip = isBody ? null : skipOff([p.vel.x, p.vel.y, p.vel.z], [n.x, n.y, n.z], {
        left: thunderSkips.value - p.skips, maxAngle: thunderSkipAngle.value, keep: thunderSkipKeep.value, bounce: thunderSkipBounce.value,
      })
      if (!skip) { this.detonate(p, point, n, 'end'); return }
      p.vel.set(...skip)
      p.pos.copy(point).addScaledVector(n, 0.05)
      p.skips++
      this.fx.impact(point, n, dir, false, RED_IMPACT, false)
      if (thunderSkipPush.value > 0) this.hooks.onImpact?.(point, true, thunderSkipPush.value)
      return
    }
    const rico = laserRicochet.value
    if (isBody || rico === 0) {
      this.impact(p.shooter, p.id, point, n, false, Boolean(isBody), dir)
      this.kill(this.shots.indexOf(p))
      return
    }
    // Rocket.js 107: rico * lerp(scale(v, n), reflect(v, n), rico).
    const scaled = new THREE.Vector3(p.vel.x * n.x, p.vel.y * n.y, p.vel.z * n.z)
    const reflected = p.vel.clone().reflect(n)
    p.vel.copy(scaled.lerp(reflected, rico).multiplyScalar(rico))
    p.pos.copy(point).addScaledVector(n, 0.05)
  }

  /**
   * Plasma Thunder goes off at `at` (thunderRules.ts). Contact and fuse are only ever found by
   * the client that judges the vehicle caught, and an end belongs to the shooter's client (the
   * host for a bot's shot): that client bursts at once and reports it to the room. Any other
   * client stops the bolt there and waits for the room's word on where it burst (detonated);
   * with none within END_WAIT seconds (the shooter left), it bursts there without a push.
   */
  private detonate(p: Projectile, at: THREE.Vector3, normal: THREE.Vector3, cause: ThunderCause, victim?: number): void {
    const key = `${p.shooter}:${p.id}`
    this.kill(this.shots.indexOf(p))
    if (this.burstKeys.has(key)) return
    const mine = cause !== 'end' || (this.hooks.ownsShot?.(p.shooter) ?? true)
    if (!mine) { this.waiting.set(key, { shooter: p.shooter, shot: p.id, at: at.clone(), normal: normal.clone(), until: this.game.time + END_WAIT }); return }
    this.hooks.onDetonate?.(p.shooter, p.id, cause, at, victim)
    this.burst(p.shooter, p.id, at, normal, cause, true)
  }

  /** The room says where Plasma Thunder shot `shot` from `shooter` went off: burst there, once. */
  detonated(shooter: number, shot: number, at: THREE.Vector3, cause: ThunderCause): void {
    const key = `${shooter}:${shot}`
    const i = this.shots.findIndex(s => s.shooter === shooter && s.id === shot)
    if (i >= 0) this.kill(i)
    const waited = this.waiting.get(key)
    this.waiting.delete(key)
    if (this.burstKeys.has(key)) return
    this.burst(shooter, shot, at, waited?.normal ?? UP_NORMAL, cause, true)
  }

  /** The look of a detonation (impact, ring, firework, flare) and, if `push`, its push. Once per shot. */
  private burst(shooter: number, shot: number, at: THREE.Vector3, normal: THREE.Vector3, cause: ThunderCause, push: boolean): void {
    const key = `${shooter}:${shot}`
    if (this.burstKeys.has(key)) return
    this.burstKeys.add(key)
    if (this.burstKeys.size > 256) this.burstKeys.delete(this.burstKeys.values().next().value as string)
    const ground = this.hooks.terrain?.()?.heightAt?.(at.x, at.z) ?? -Infinity
    // In the air (a fuse, a vehicle, old age) it leaves sparks but no scorch.
    const inAir = cause !== 'end' || !Number.isFinite(ground) || at.y - ground > 2
    this.impact(shooter, shot, at, normal, true, inAir, normal.clone().negate())
    if (push) this.hooks.onImpact?.(at, true, 1)
    // On the ground, a star shell climbs before it bursts: a flare seen across the world.
    const climb = cause === 'end' && Number.isFinite(ground) && at.y - ground < 6 ? thunderFlareHeight.value : 0
    const colors = this.hooks.colorsOf?.(shooter) ?? [RED_FALLBACK, GOLD_FALLBACK] as const
    const terrain = this.hooks.terrain?.()
    this.fireworks.burst({ at, climb, ground, colors, seed: fireworkSeed(shooter, shot), heightAt: terrain?.heightAt ? (x, z) => terrain.heightAt!(x, z) : undefined })
    this.hooks.onBurst?.(shooter, at.clone().setY(at.y + climb), cause, climb > 0 ? CLIMB_SECONDS : 0)
  }

  /**
   * Big Red's width: rays parallel to the centre line, around it, that see only vehicles this
   * client judges, up to `reach` along the path. The nearest such vehicle, if any.
   */
  private wideCatch(p: Projectile, dir: THREE.Vector3, reach: number, shooterBody?: RAPIER.RigidBody): { victim: number; point: THREE.Vector3 } | null {
    const r = bigRedRadius.value
    if (!(r > 0) || !(reach > 0)) return null
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize()
    const up = new THREE.Vector3().crossVectors(side, dir).normalize()
    let best: { victim: number; point: THREE.Vector3; toi: number } | null = null
    for (const [a, b] of RED_RING) {
      const o = p.pos.clone().addScaledVector(side, a * r).addScaledVector(up, b * r)
      this.ray.origin = { x: o.x, y: o.y, z: o.z }
      this.ray.dir = { x: dir.x, y: dir.y, z: dir.z }
      const hit = this.game.world.castRay(
        this.ray, reach, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP_PROJECTILE, GROUP_ALL & ~GROUP_LIQUID),
        undefined, shooterBody,
        (c) => {
          const parent = c.parent()
          if (!parent || (shooterBody && parent.handle === shooterBody.handle)) return false
          const judged = this.hooks.judgedId(parent.handle)
          return judged !== null && judged !== p.shooter
        },
      )
      if (!hit || (best && hit.timeOfImpact >= best.toi)) continue
      const victim = this.hooks.judgedId(hit.collider.parent()!.handle)!
      best = { victim, toi: hit.timeOfImpact, point: o.addScaledVector(dir, hit.timeOfImpact) }
    }
    return best
  }

  /**
   * The look of where a shot ended, once per shot. `onVehicle` for a vehicle (or anything else
   * that moves); `dir` the shot's own direction where known, else straight into the surface.
   */
  private impact(shooter: number, shot: number, at: THREE.Vector3, normal?: THREE.Vector3, red = false, onVehicle = false, dir?: THREE.Vector3): void {
    const key = `${shooter}:${shot}`
    if (this.impacted.has(key)) return
    this.impacted.add(key)
    if (this.impacted.size > 256) this.impacted.delete(this.impacted.values().next().value as string)
    const n = normal ?? new THREE.Vector3(0, 1, 0)
    this.fx.impact(at, n, dir ?? n.clone().negate(), onVehicle, red ? RED_IMPACT : TAG_IMPACT, red)
    // A shock ring: Thunder's the size of its push; Plasma Tag's small and quick, which is what
    // reads at a distance.
    if (red) this.pulses.emit(at, n, { radius: Math.max(1.5, thunderBlastRadius.value), seconds: 0.9, color: RED_SHOCK })
    else this.pulses.emit(at, n, { radius: 1.8, seconds: 0.3, color: TAG_SHOCK })
    // Plasma Thunder's push comes with its burst (burst), once, where the room says.
    if (!red) this.hooks.onImpact?.(at, red)
  }

  private kill(i: number): void {
    if (i < 0) return
    this.game.scene.remove(this.shots[i].mesh)
    this.shots.splice(i, 1)
  }
}

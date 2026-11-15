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
 */
import * as THREE from 'three/webgpu'
import type { ShotInfo } from '../../shared/protocol'
import type { Game, System } from '../core/Game'
import { FIXED_DT, GROUP_ALL, GROUP_LIQUID, GROUP_PROJECTILE, RAPIER, groups } from '../core/physics'
import { createWeaponEffects } from '../vehicles/effects'
import { hotExposureDim } from '../vehicles/skins/hotExposure'
import { laserGravity, laserLifetime, laserRicochet, laserSpeed } from './params'
import { bigRedRadius, bigRedSpeed } from './bigRedParams'
import { warmGear } from './warm'

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
const RED_CORE_RGB = [4, 0.55, 0.35] as const
const RED_HALO_RGB = [1.8, 0.18, 0.1] as const
const RED_TINT_RGB = [0.8, 0.05, 0.03] as const
/** Big Red's look: this much fatter, and a little longer. */
const RED_SCALE = [3, 3, 1.6] as const
/** Offsets around the centre line Big Red checks for vehicles, as fractions of its radius. */
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
  private readonly effects: ReturnType<typeof createWeaponEffects> | null
  /** Shots that already showed their impact here, so a later server confirmation does not repeat it. */
  private readonly impacted = new Set<string>()
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  private readonly tmp = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  /** Shots fired here, counted for ids. */
  private nextShotId = 1
  private readonly unwarm: () => void

  constructor(private readonly game: Game, private readonly hooks: LaserHooks) {
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
    ], () => {
      game.camera.getWorldPosition(below).y -= SPARK_WARM_DEPTH
      this.effects?.muzzle(below, ahead, false)
      this.effects?.muzzle(below, ahead, true)
    })
  }

  get count(): number {
    return this.shots.length
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
    }
    const tint = new THREE.Mesh(this.haloGeo, red ? this.redTintMat : this.tintMat)
    tint.renderOrder = -1
    p.mesh.add(new THREE.Mesh(this.coreGeo, red ? this.redCoreMat : this.coreMat), tint, new THREE.Mesh(this.haloGeo, red ? this.redHaloMat : this.haloMat))
    if (red) p.mesh.scale.set(...RED_SCALE)
    if (age < FRESH) this.effects?.muzzle(p.pos.clone(), new THREE.Vector3(...shot.d).normalize(), red)
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
    if (where) this.impact(shooter, shot, where, p ? p.vel.clone().normalize().negate() : undefined, p?.red ?? false)
    if (i >= 0) this.kill(i)
  }

  /** Remove every shot in flight: for a world change or leaving it. Impact effects fade on their own. */
  reset(): void {
    while (this.shots.length) this.kill(this.shots.length - 1)
  }

  fixedUpdate(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i]
      p.prev.copy(p.pos)
      this.step(p, dt)
    }
  }

  update(dt: number, alpha: number): void {
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
    for (const p of this.shots) {
      p.mesh.visible = true
      p.mesh.position.lerpVectors(p.prev, p.pos, alpha)
      if (p.vel.lengthSq() > 1e-6) p.mesh.lookAt(this.look.copy(p.mesh.position).add(p.vel))
    }
  }

  dispose(): void {
    while (this.shots.length) this.kill(this.shots.length - 1)
    this.effects?.dispose()
    this.unwarm()
    this.coreGeo.dispose(); this.haloGeo.dispose()
    for (const m of [this.coreMat, this.haloMat, this.tintMat, this.redCoreMat, this.redHaloMat, this.redTintMat]) m.dispose()
  }

  private step(p: Projectile, dt: number): void {
    p.age += dt
    if (p.age > p.life) {
      this.kill(this.shots.indexOf(p))
      return
    }
    // Rocket.js 71: laserGrav * 20 metres per second squared. Big Red flies flat.
    if (!p.red) p.vel.y -= laserGravity.value * 20 * dt
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
        this.hooks.onHit(p.shooter, p.id, wide.victim, wide.point, dir.clone(), true)
        this.impact(p.shooter, p.id, wide.point, dir.clone().negate(), true)
        this.kill(this.shots.indexOf(p))
        return
      }
    }
    if (!hit) {
      p.pos.addScaledVector(dir, dist)
      return
    }
    const point = new THREE.Vector3(p.pos.x + dir.x * hit.timeOfImpact, p.pos.y + dir.y * hit.timeOfImpact, p.pos.z + dir.z * hit.timeOfImpact)
    const parent = hit.collider.parent()
    const victim = parent ? this.hooks.judgedId(parent.handle) : null
    if (victim !== null) {
      this.hooks.onHit(p.shooter, p.id, victim, point, dir.clone(), p.red)
      this.impact(p.shooter, p.id, point, dir.clone().negate(), p.red)
      this.kill(this.shots.indexOf(p))
      return
    }
    const rico = p.red ? 0 : laserRicochet.value
    const isBody = parent && !parent.isFixed()
    if (isBody || rico === 0) {
      this.impact(p.shooter, p.id, point, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), p.red)
      this.kill(this.shots.indexOf(p))
      return
    }
    // Rocket.js 107: rico * lerp(scale(v, n), reflect(v, n), rico).
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
    const scaled = new THREE.Vector3(p.vel.x * n.x, p.vel.y * n.y, p.vel.z * n.z)
    const reflected = p.vel.clone().reflect(n)
    p.vel.copy(scaled.lerp(reflected, rico).multiplyScalar(rico))
    p.pos.copy(point).addScaledVector(n, 0.05)
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

  /** Sparks where a shot ended, once per shot. */
  private impact(shooter: number, shot: number, at: THREE.Vector3, normal?: THREE.Vector3, red = false): void {
    const key = `${shooter}:${shot}`
    if (this.impacted.has(key)) return
    this.impacted.add(key)
    if (this.impacted.size > 256) this.impacted.delete(this.impacted.values().next().value as string)
    this.effects?.impact(at.clone(), normal ?? new THREE.Vector3(0, 1, 0), red)
  }

  private kill(i: number): void {
    if (i < 0) return
    this.game.scene.remove(this.shots[i].mesh)
    this.shots.splice(i, 1)
  }
}

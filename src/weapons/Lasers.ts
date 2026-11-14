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
import { laserGravity, laserLifetime, laserRicochet, laserSpeed } from './params'

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
  /** A shot hit a vehicle this client judges. */
  onHit(shooter: number, shot: number, victim: number, at: THREE.Vector3): void
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
}

interface Flash {
  mesh: THREE.Mesh
  age: number
}

/** The longest a late shot is replayed; older ones are mostly gone anyway. */
const MAX_CATCH_UP = 2
const LENGTH = 3

export class Lasers implements System {
  private readonly shots: Projectile[] = []
  private readonly flashes: Flash[] = []
  private readonly coreGeo = new THREE.CylinderGeometry(0.07, 0.07, LENGTH, 6, 1).rotateX(Math.PI / 2)
  private readonly haloGeo = new THREE.CylinderGeometry(0.3, 0.3, LENGTH * 1.2, 8, 1).rotateX(Math.PI / 2)
  private readonly flashGeo = new THREE.SphereGeometry(1, 12, 8)
  // Colours above 1 survive tone mapping as a hot, near white core: the glow without bloom.
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 1.2, 0.8) })
  private readonly haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.5, 0.15, 0.08), transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  private readonly flashMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3, 1, 0.5), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  private readonly tmp = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  /** Shots fired here, counted for ids. */
  private nextShotId = 1

  constructor(private readonly game: Game, private readonly hooks: LaserHooks) {}

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
    const speed = laserSpeed.value + shot.boost
    const p: Projectile = {
      shooter,
      id: shot.id,
      pos: new THREE.Vector3(...shot.o),
      prev: new THREE.Vector3(...shot.o),
      vel: new THREE.Vector3(...shot.d).normalize().multiplyScalar(speed),
      age: 0,
      life: laserLifetime(laserSpeed.value),
      mesh: new THREE.Group(),
    }
    p.mesh.add(new THREE.Mesh(this.coreGeo, this.coreMat), new THREE.Mesh(this.haloGeo, this.haloMat))
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

  /** The server confirmed a hit: end that shot everywhere with a flash. */
  confirmHit(shooter: number, shot: number, at?: THREE.Vector3): void {
    const i = this.shots.findIndex((s) => s.shooter === shooter && s.id === shot)
    if (i >= 0) {
      this.flash(at ?? this.shots[i].pos)
      this.kill(i)
    } else if (at) {
      this.flash(at)
    }
  }

  fixedUpdate(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i]
      p.prev.copy(p.pos)
      this.step(p, dt)
    }
  }

  update(dt: number, alpha: number): void {
    for (const p of this.shots) {
      p.mesh.visible = true
      p.mesh.position.lerpVectors(p.prev, p.pos, alpha)
      if (p.vel.lengthSq() > 1e-6) p.mesh.lookAt(this.look.copy(p.mesh.position).add(p.vel))
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.age += dt
      const k = f.age / 0.35
      if (k >= 1) {
        this.game.scene.remove(f.mesh)
        this.flashes.splice(i, 1)
        continue
      }
      f.mesh.scale.setScalar(0.5 + k * 2.5)
    }
  }

  dispose(): void {
    while (this.shots.length) this.kill(this.shots.length - 1)
    for (const f of this.flashes) this.game.scene.remove(f.mesh)
    this.flashes.length = 0
  }

  private step(p: Projectile, dt: number): void {
    p.age += dt
    if (p.age > p.life) {
      this.kill(this.shots.indexOf(p))
      return
    }
    // Rocket.js 71: laserGrav * 20 metres per second squared.
    p.vel.y -= laserGravity.value * 20 * dt
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
    if (!hit) {
      p.pos.addScaledVector(dir, dist)
      return
    }
    const point = new THREE.Vector3(p.pos.x + dir.x * hit.timeOfImpact, p.pos.y + dir.y * hit.timeOfImpact, p.pos.z + dir.z * hit.timeOfImpact)
    const parent = hit.collider.parent()
    const victim = parent ? this.hooks.judgedId(parent.handle) : null
    if (victim !== null) {
      this.hooks.onHit(p.shooter, p.id, victim, point)
      this.flash(point)
      this.kill(this.shots.indexOf(p))
      return
    }
    const rico = laserRicochet.value
    const isBody = parent && !parent.isFixed()
    if (isBody || rico === 0) {
      this.flash(point)
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

  private flash(at: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.flashGeo, this.flashMat)
    mesh.position.copy(at)
    mesh.scale.setScalar(0.5)
    this.game.scene.add(mesh)
    this.flashes.push({ mesh, age: 0 })
  }

  private kill(i: number): void {
    if (i < 0) return
    this.game.scene.remove(this.shots[i].mesh)
    this.shots.splice(i, 1)
  }
}

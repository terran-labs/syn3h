import { Quaternion, Vector3 } from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { emptyInput } from '../core/Input'
import { GROUP_PROJECTILE, GROUP_TERRAIN, RAPIER, groups } from '../core/physics'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import * as p from './params'
import { roadWaypoint, type RoadTerrain, type RoadPoint } from './navigation'
export type BotTerrain = Terrain & RoadTerrain & { liquidHeightAt?(x: number, z: number): number | null | undefined }
const clamp = (x: number, max = 1) => Math.max(-max, Math.min(max, x))
/** Positive means turn right. Our forward is -Z; positive Y rotation turns left. */
export function steeringError(forward: { x: number; z: number }, delta: { x: number; z: number }): number {
  return Math.atan2(forward.x * delta.z - forward.z * delta.x, forward.x * delta.x + forward.z * delta.z)
}
export function isSafeGround(terrain: BotTerrain, x: number, z: number): boolean {
  if (Math.abs(x) > terrain.size / 2 - 3 || Math.abs(z) > terrain.size / 2 - 3) return false
  const ground = terrain.heightAt(x, z), liquid = terrain.liquidHeightAt?.(x, z)
  return Number.isFinite(ground) && (liquid == null || !Number.isFinite(liquid) || ground > liquid + 0.5)
}
export class BotBrain implements System {
  remote = false
  requestRecovery?: () => boolean
  target: Vehicle | null = null
  reversing = false
  rescues = 0
  private reverseBrake = 0
  private routeTime = 0
  private waypoint: RoadPoint | null = null
  private strategyTime = 0
  private targetTime = 2
  private fireTime = 0
  private immobileTime = 0
  private liquidTime = 0
  private flippedTime = 0
  private readonly lastPosition = new Vector3()
  private readonly forward = new Vector3()
  private readonly up = new Vector3()
  private readonly quaternion = new Quaternion()
  private targets: readonly Vehicle[] = []
  private peers: readonly Vehicle[] = []
  setPeers(vehicles: readonly Vehicle[]) { this.peers = vehicles }
  constructor(private readonly game: Game, private readonly terrain: BotTerrain, readonly vehicle: Vehicle, private readonly localPlayer: Vehicle, readonly index = 0) {
    vehicle.isLocal = false
    this.lastPosition.copy(vehicle.body.translation())
    // Original VhiclBot.cs:25 staggered checks randomly. Index gives repeatable staggering.
    this.strategyTime = (index * 0.61803398875 % 1) * p.strategyInterval.value
  }
  setTargets(vehicles: readonly Vehicle[]) { this.targets = vehicles; this.targetTime = 2 }
  private selectTarget() {
    // VhiclBot.cs:61 targets the player. VehicleBot.js:14-25 selects nearest, excluding self.
    if (Math.round(p.targetMode.value) === 0) { this.target = this.localPlayer.body.isValid() ? this.localPlayer : null; return }
    const here = this.vehicle.body.translation()
    let distance = Infinity
    this.target = null
    for (const candidate of this.targets) {
      if (candidate === this.vehicle || !candidate.body.isValid()) continue
      const q = candidate.body.translation(), d = (q.x - here.x) ** 2 + (q.y - here.y) ** 2 + (q.z - here.z) ** 2
      if (d < distance) { distance = d; this.target = candidate }
    }
  }
  private rescue() {
    if (this.requestRecovery) {
      if (this.requestRecovery()) {
        this.lastPosition.copy(this.vehicle.body.translation()); this.immobileTime = this.liquidTime = this.flippedTime = this.strategyTime = 0
        this.reversing = false; this.routeTime = 0; this.waypoint = null; this.reverseBrake = p.reverseBrakeTime.value; this.rescues++
      }
      return
    }
    for (let i = 0; i < 16; i++) {
      const spawn = this.terrain.spawnPoint(this.index + i + 1)
      if (!isSafeGround(this.terrain, spawn.position.x, spawn.position.z)) continue
      this.vehicle.teleport(spawn.position, spawn.heading)
      this.lastPosition.copy(spawn.position); this.immobileTime = this.liquidTime = this.flippedTime = this.strategyTime = 0
      this.reversing = false; this.routeTime = 0; this.waypoint = null; this.reverseBrake = p.reverseBrakeTime.value; this.rescues++; return
    }
  }
  fixedUpdate(dt: number) {
    // Do not even clear input: network playback owns this state.
    if (this.remote) return
    const input = this.vehicle.input
    Object.assign(input, emptyInput())
    this.targetTime += dt; this.fireTime += dt
    // VehicleBot.js:11 refreshes enemies every two seconds; invalid targets refresh immediately.
    if (this.targetTime >= 2 || !this.target?.body.isValid()) { this.selectTarget(); this.targetTime = 0 }
    if (!this.target) return
    const here = this.vehicle.body.translation(), there = this.target.body.translation()
    this.quaternion.copy(this.vehicle.body.rotation())
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion)
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion)
    const dx = there.x - here.x, dz = there.z - here.z, distance = Math.hypot(dx, dz)
    const velocity = this.vehicle.body.linvel(), speed = Math.hypot(velocity.x, velocity.z)
    const targetVelocity = this.target.body.linvel()
    const lead = Math.min(0.8, distance / 45) * p.aggression.value
    let aimX = there.x + targetVelocity.x * lead, aimZ = there.z + targetVelocity.z * lead
    const liquid = this.terrain.liquidHeightAt?.(here.x, here.z)
    const afloat = liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(here.x, here.z) <= liquid + 0.5
    this.liquidTime = afloat && p.canDrive.value ? this.liquidTime + dt : 0
    if (afloat) {
      // Bots try to crawl toward dry ground before requesting a return to their pad.
      let shore: { x: number; z: number } | null = null
      for (const radius of [8, 16, 32, 64, 128, 256]) {
        let best = Infinity
        for (let i = 0; i < 16; i++) {
          const angle = i * Math.PI / 8, x = here.x + Math.cos(angle) * radius, z = here.z + Math.sin(angle) * radius
          if (!isSafeGround(this.terrain, x, z)) continue
          const d = Math.hypot(x - there.x, z - there.z)
          if (d < best) { best = d; shore = { x, z } }
        }
        if (shore) break
      }
      if (shore) { aimX = shore.x; aimZ = shore.z }
    }
    this.routeTime -= dt
    if (this.routeTime <= 0) {
      this.waypoint = !afloat && distance > 18 ? roadWaypoint(this.terrain, here, there, Math.max(8, Math.min(16, speed * 0.6))) : null
      this.routeTime = 0.4
    }
    const waypoint = !afloat && distance > 18 ? this.waypoint : null
    if (waypoint) { aimX = waypoint.x; aimZ = waypoint.z }
    // Stable per-bot lateral offsets fade out near contact so every bot can still ram.
    const spread = ((this.index * 0.61803398875 % 1) - 0.5) * p.approachSpread.value * Math.min(1, Math.max(0, distance - 8) / 20)
    if (!afloat && distance > 0.1) {
      const ax = aimX - here.x, az = aimZ - here.z, length = Math.hypot(ax, az) || 1
      const offset = waypoint ? Math.max(-1, Math.min(1, spread)) : spread
      aimX += az / length * offset; aimZ -= ax / length * offset
    }
    // Repel nearby allies, never the selected target. This prevents a single-file pileup.
    for (const peer of this.peers) {
      if (peer === this.vehicle || peer === this.target || !peer.body.isValid()) continue
      const pos = peer.body.translation(), px = here.x - pos.x, pz = here.z - pos.z, separation = Math.hypot(px, pz)
      if (separation > 0.1 && separation < 7) { aimX += px / separation * (7 - separation) * (waypoint ? 0.25 : 2); aimZ += pz / separation * (7 - separation) * (waypoint ? 0.25 : 2) }
    }
    const error = steeringError(this.forward, { x: aimX - here.x, z: aimZ - here.z })
    // VhiclBot.cs:35-55 and VehicleBot.js:79-91: wrap yaw, divide by 20 degrees,
    // 2 degree dead zone, full steering within 15 metres, 0.6 clamp farther away.
    const rotation = error / (20 * Math.PI / 180)
    if (p.canDrive.value && p.topThrottle.value > 0 && p.aggression.value > 0) {
      this.strategyTime += dt
      this.flippedTime = this.up.y < 0.2 ? this.flippedTime + dt : 0
      if (this.strategyTime >= p.strategyInterval.value) {
        // VhiclBot.cs:63-74 switches to reverse when movement is below one metre.
        const moved = this.lastPosition.distanceTo(here)
        const wasReversing = this.reversing
        this.reversing = moved < p.stuckDistance.value
        if (this.reversing && !wasReversing) this.reverseBrake = p.reverseBrakeTime.value
        this.immobileTime = this.reversing ? this.immobileTime + this.strategyTime : 0
        this.strategyTime = 0; this.lastPosition.copy(here)
      }
      if (afloat) this.reversing = false
      input.x = this.reversing ? clamp(-rotation) : Math.abs(rotation) < 0.1 ? 0 : clamp(rotation * p.aggression.value, waypoint || distance < 15 ? 1 : 0.6)
      if (waypoint && !this.reversing) {
        // Four-wheel steering needs a gentle curvature command on narrow roads.
        // Full original pursuit lock makes the buggy circle an eight-metre waypoint.
        const look = Math.max(8, Math.hypot(aimX - here.x, aimZ - here.z))
        input.x = Math.abs(error) > Math.PI / 2 ? Math.sign(error) * 0.6 : clamp(6 * Math.sin(error) / look, 0.6)
      }
      input.y = Math.min(1, p.aggression.value) * p.topThrottle.value * (this.reversing ? -1 : 1)
      // Keep enough throttle to turn, but shed speed before a tight corner.
      if (!this.reversing && Math.abs(error) > 0.6 && speed > p.cornerSpeed.value) {
        input.y *= 0.25; input.brakes = speed > p.cornerSpeed.value * 1.5
      }
      const roadLimit = Math.max(p.roadCornerSpeed.value, p.roadSpeed.value * (1 - Math.min(1, Math.abs(error))))
      if (waypoint && !this.reversing && speed > roadLimit) {
        input.y = Math.min(input.y, 0.15); input.brakes ||= speed > roadLimit * 1.2
      }
      // Stop spinning wheels before asking the drivetrain to reverse.
      if (this.reverseBrake > 0) { input.brakes = true; this.reverseBrake = Math.max(0, this.reverseBrake - dt) }
      // Probe the intended travel direction. Reverse and steer away from water or world edges.
      const direction = this.reversing ? -1 : 1
      const lookAhead = Math.max(4, Math.min(16, speed * 0.7))
      if (!afloat && !isSafeGround(this.terrain, here.x + this.forward.x * direction * lookAhead, here.z + this.forward.z * direction * lookAhead)) {
        input.y = -direction * p.topThrottle.value * 0.5
        input.x = (this.index % 2 ? -1 : 1) * -direction
      }
      if (this.liquidTime >= p.recoveryTime.value || this.immobileTime >= p.recoveryTime.value || this.flippedTime >= p.recoveryTime.value / 2 || here.y < this.terrain.heightAt(here.x, here.z) - 10) this.rescue()
    } else {
      // VehicleBot.js:118-120 disables driving. Pausing must not trigger a rescue.
      input.brakes = true; this.strategyTime = this.immobileTime = this.liquidTime = this.flippedTime = 0; this.lastPosition.copy(here)
    }
    // VehicleBot.js:124-126 fires once per second if terrain does not block the target.
    // Weapons consume input.fire; this controller never spawns projectiles itself.
    if (p.canFire.value && this.fireTime >= p.fireInterval.value) {
      const delta = new Vector3(dx, there.y - here.y, dz), length = delta.length()
      if (length > 0.01) {
        delta.multiplyScalar(1 / length)
        const hit = this.game.world.castRay(new RAPIER.Ray(here, delta), length, true, undefined, groups(GROUP_PROJECTILE, GROUP_TERRAIN))
        if (!hit) { input.fire = true; this.fireTime = 0 }
      }
    }
  }
}

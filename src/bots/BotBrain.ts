import { Quaternion, Vector3 } from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { emptyInput } from '../core/Input'
import { GROUP_PROJECTILE, GROUP_TERRAIN, RAPIER, groups } from '../core/physics'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import * as p from './params'
export type BotTerrain = Terrain & { liquidHeightAt?(x: number, z: number): number | null | undefined }
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
  target: Vehicle | null = null
  reversing = false
  rescues = 0
  private strategyTime = 0
  private targetTime = 2
  private fireTime = 0
  private immobileTime = 0
  private flippedTime = 0
  private readonly lastPosition = new Vector3()
  private readonly forward = new Vector3()
  private readonly up = new Vector3()
  private readonly quaternion = new Quaternion()
  private targets: readonly Vehicle[] = []
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
    for (let i = 0; i < 16; i++) {
      const spawn = this.terrain.spawnPoint(this.index + i + 1)
      if (!isSafeGround(this.terrain, spawn.position.x, spawn.position.z)) continue
      this.vehicle.teleport(spawn.position, spawn.heading)
      this.lastPosition.copy(spawn.position); this.immobileTime = this.flippedTime = this.strategyTime = 0
      this.reversing = false; this.rescues++; return
    }
  }
  fixedUpdate(dt: number) {
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
    const error = steeringError(this.forward, { x: dx, z: dz })
    // VhiclBot.cs:35-55 and VehicleBot.js:79-91: wrap yaw, divide by 20 degrees,
    // 2 degree dead zone, full steering within 15 metres, 0.6 clamp farther away.
    const rotation = error / (20 * Math.PI / 180)
    if (p.canDrive.value && p.topThrottle.value > 0 && p.aggression.value > 0) {
      this.strategyTime += dt
      this.flippedTime = this.up.y < 0.2 ? this.flippedTime + dt : 0
      if (this.strategyTime >= p.strategyInterval.value) {
        // VhiclBot.cs:63-74 switches to reverse when movement is below one metre.
        const moved = this.lastPosition.distanceTo(here)
        this.reversing = moved < p.stuckDistance.value
        this.immobileTime = this.reversing ? this.immobileTime + this.strategyTime : 0
        this.strategyTime = 0; this.lastPosition.copy(here)
      }
      input.x = this.reversing ? clamp(-rotation) : Math.abs(rotation) < 0.1 ? 0 : clamp(rotation * p.aggression.value, distance < 15 ? 1 : 0.6)
      input.y = Math.min(1, p.aggression.value) * p.topThrottle.value * (this.reversing ? -1 : 1)
      // Probe the intended travel direction. Reverse and steer away from water or world edges.
      const direction = this.reversing ? -1 : 1
      const speed = this.vehicle.body.linvel(), lookAhead = Math.max(4, Math.min(16, Math.hypot(speed.x, speed.z) * 0.7))
      if (!isSafeGround(this.terrain, here.x + this.forward.x * direction * lookAhead, here.z + this.forward.z * direction * lookAhead)) {
        input.y = -direction * p.topThrottle.value * 0.5
        input.x = (this.index % 2 ? -1 : 1) * -direction
      }
      if (this.immobileTime >= p.recoveryTime.value || this.flippedTime >= p.recoveryTime.value / 2 || here.y < this.terrain.heightAt(here.x, here.z) - 10) this.rescue()
    } else {
      // VehicleBot.js:118-120 disables driving. Pausing must not trigger a rescue.
      input.brakes = true; this.strategyTime = this.immobileTime = this.flippedTime = 0; this.lastPosition.copy(here)
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

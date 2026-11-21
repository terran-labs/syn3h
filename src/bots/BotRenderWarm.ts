import { Mesh, Vector3 } from 'three/webgpu'
import type { CoveredWarm, Game } from '../core/Game'
import { recordEntryWarmIssue } from '../core/diagnostics'
import { RAPIER } from '../core/physics'
import type { Terrain } from '../world/Terrain'
import { canonicalVehicleKind, createVehicle, VEHICLE_KINDS, type VehicleKind } from '../vehicles'
import { Jet } from '../vehicles/Jet'
import { Syn3hBuggy } from '../vehicles/Syn3hBuggy'
import { Vehicle, vehicleDetail } from '../vehicles/Vehicle'
import { LOD_FAR, LOD_NEAR } from '../vehicles/skins/mergeStatic'
import { drawCoveredShowroom } from '../vehicles/skins/showroom'

type Look = { name: string; distance: number; gearDown?: boolean }
const near: Look = { name: 'near', distance: 8 }
const medium: Look = { name: 'medium', distance: (LOD_NEAR + LOD_FAR) / 2 }
const far: Look = { name: 'silhouette', distance: LOD_FAR + 10 }
const looks = [near, medium, far]
const jetLooks: Look[] = [
  near,
  { ...near, name: 'near gear down', gearDown: true },
  { ...medium, name: 'medium gear down', gearDown: true },
  { ...medium, name: 'medium gear up' },
  far,
]

/** The room can request at most sixteen bots. Retain only the observed concurrency. */
const MAX_PARKED_PER_KIND = 16

type Parked = { vehicle: Vehicle; afterFrame: number }

/** Park unused models between actor lifetimes without giving two actors the same vehicle. */
export class BotRenderWarm {
  private readonly parked = new Map<VehicleKind, Parked[]>()
  private readonly checkedOut = new WeakMap<Vehicle, number>()
  private readonly forward = new Vector3()
  private readonly detailPosition = new Vector3()
  private readonly drawPosition = new Vector3()
  private generation = 0
  private running = false
  private disposed = false

  constructor(private readonly game: Game, private readonly terrain: Terrain) {}

  worldChanged(): void {
    this.generation++
    this.disposeParked()
  }

  private takeParked(kind: VehicleKind): Vehicle | undefined {
    const entries = this.parked.get(kind)
    if (!entries) return
    for (let i = entries.length - 1; i >= 0; i--) {
      const { vehicle, afterFrame } = entries[i]
      if (this.game.frames <= afterFrame) continue
      // Ghosts use the old actor's live meshes and instance matrices until the last fade.
      let ghost = false
      vehicle.object.traverse(object => { ghost ||= object.userData.arrivalGhost === true })
      if (ghost) continue
      entries.splice(i, 1)
      return vehicle
    }
  }

  private park(vehicle: Vehicle, afterFrame: number): void {
    const entries = this.parked.get(vehicle.kind) ?? []
    if (entries.length >= MAX_PARKED_PER_KIND) {
      vehicle.dispose()
      return
    }
    entries.push({ vehicle, afterFrame })
    this.parked.set(vehicle.kind, entries)
  }

  acquire(kind: VehicleKind, position: Vector3, heading: number): Vehicle {
    const key = kind === 'buggy-syn3h' ? kind : canonicalVehicleKind(kind)
    const current = !this.disposed && typeof this.game.precompile === 'function'
    const parked = current ? this.takeParked(key) : undefined
    const vehicle = parked ?? createVehicle(this.game, this.terrain, kind, position, heading)
    if (parked) {
      vehicle.teleport(position, heading)
      vehicle.object.position.copy(vehicle.body.translation())
      vehicle.object.quaternion.copy(vehicle.body.rotation())
      vehicle.object.visible = true
      vehicle.setParked(false)
    }
    if (current) this.checkedOut.set(vehicle, this.generation)
    return vehicle
  }

  /** The caller retires actor systems and cancels holds before the next game update. */
  release(vehicle: Vehicle): boolean {
    const generation = this.checkedOut.get(vehicle)
    if (generation === undefined) return false
    this.checkedOut.delete(vehicle)
    if (this.disposed || generation !== this.generation || vehicle.detached || !vehicle.body.isValid()
      || vehicle.kind === 'tank') return false

    try {
      vehicle.setParked(true)
      this.reset(vehicle)
    } catch (error) {
      console.warn('Bot vehicle could not be reset for reuse', error)
      return false
    }
    // Give systems keyed by the former actor a frame to retire. The next checkout also
    // waits for any arrival/departure ghosts to leave the object tree.
    this.park(vehicle, this.game.frames + 1)
    return true
  }

  private reset(vehicle: Vehicle): void {
    vehicle.resetForWorld()
    vehicle.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false)
    vehicle.body.resetForces(false)
    vehicle.body.resetTorques(false)
    // Subclasses clear controller history in teleport. Leave the idle body at its last pose.
    vehicle.teleport(this.detailPosition.copy(vehicle.body.translation()))
    vehicle.wind.set(0, 0, 0)
    vehicle.zorbView = null
    vehicle.wheelsGrounded = 0
    vehicle.wingsOpen = false
    vehicle.landedThisStep = false
    vehicle.landingImpact = 0
    vehicle.groundGuardHits = 0
    vehicle.id = vehicle.name = ''
  }

  async warm(warm: CoveredWarm): Promise<void> {
    if (this.running || this.disposed) return
    this.running = true
    const generation = this.generation
    const current = () => !this.disposed && generation === this.generation
    try {
      for (const { kind } of VEHICLE_KINDS) {
        await warm.yieldFrame(`Bot ${kind} setup`)
        if (!current()) break
        const vehicle = this.takeParked(kind) ?? createVehicle(this.game, this.terrain, kind, this.game.camera.position)
        vehicle.isLocal = false
        vehicle.setParked(true)
        try {
          if (vehicle instanceof Syn3hBuggy && !(await vehicle.waitForCoveredBody())) continue
          for (const look of kind === 'jet' ? jetLooks : looks) {
            await warm.yieldFrame(`Bot ${kind} ${look.name}`)
            if (!current()) break
            try {
              this.draw(vehicle, look, warm)
            } catch (error) {
              recordEntryWarmIssue('Bot warm draw failed')
              console.warn('Covered bot draw failed', kind, look.name, error)
            }
          }
        } finally {
          if (!current()) vehicle.dispose()
          else {
            try {
              this.reset(vehicle)
              this.park(vehicle, -Infinity)
            } catch (error) {
              vehicle.dispose()
              throw error
            }
          }
        }
      }
    } finally {
      this.running = false
    }
  }

  private draw(vehicle: Vehicle, look: Look, warm: CoveredWarm): void {
    const camera = this.game.camera
    const parkedPosition = vehicle.object.position.clone()
    camera.getWorldDirection(this.forward)
    this.detailPosition.copy(camera.position).addScaledVector(this.forward, look.distance)
    camera.getWorldPosition(this.drawPosition).addScaledVector(this.forward, 12)
    // Select the live distance-driven variant, then rasterize it at full scale in front
    // of the camera. No simulation step moves this unregistered, disabled vehicle.
    Vehicle.prototype.teleport.call(vehicle, this.detailPosition, 0)
    const holdNear = vehicleDetail.holdNear
    const hiddenWings: Mesh[] = []
    try {
      if (look.gearDown) {
        // The real jet controller extends its visual gear even on a kinematic proxy.
        // Its dynamic force and collider changes are skipped on that branch.
        const bodyType = vehicle.body.bodyType()
        vehicle.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false)
        try { vehicle.fixedUpdate(1) }
        finally { vehicle.body.setBodyType(bodyType, false) }
      }
      // Near showroom materials must see the real scene environment. Choose distant
      // plain variants off-scene so the showroom does not queue redundant draw proxies.
      if (look.distance === near.distance) this.game.scene.add(vehicle.object)
      vehicleDetail.holdNear = false
      try {
        vehicle.update(0, 1)
        // Jet.update can create a new gear pose after Vehicle.update has run the
        // detail callbacks. Let that pose select its actual remote materials
        // before the canopy enters the colour and shadow passes.
        if (vehicle instanceof Jet && look.distance === medium.distance) vehicle.update(0, 1)
      } finally { vehicleDetail.holdNear = holdNear }

      if (!vehicle.object.parent) this.game.scene.add(vehicle.object)
      vehicle.object.position.copy(this.drawPosition)
      if (look === near && vehicle instanceof Syn3hBuggy) {
        vehicle.object.traverse(object => {
          if (object instanceof Mesh && object.geometry.hasAttribute('wingPlan') && !object.visible) {
            object.visible = true
            hiddenWings.push(object)
          }
        })
      }
      if (look.distance === near.distance) {
        drawCoveredShowroom(vehicle.object, this.game.scene, camera, () => {
          if (look === near && vehicle instanceof Syn3hBuggy) vehicle.drawCoveredStandIn(() => vehicle.drawCoveredMotorSparks(() => warm.draw(vehicle.kind)))
          else warm.draw(vehicle.kind)
        })
      } else warm.draw(vehicle.kind)
    } finally {
      for (const mesh of hiddenWings) mesh.visible = false
      vehicle.object.removeFromParent()
      vehicle.object.position.copy(parkedPosition)
      if (look.gearDown) vehicle.resetForWorld()
    }
  }

  /** The distant models always use plain shading. Their target changes only at Minimal. */
  drawReliefFleet(minimal: boolean, submit: () => void): void {
    const actors = [...this.parked.values()].flatMap(entries => entries.slice(0, 1).map(entry => entry.vehicle))
    if (!actors.length) { submit(); return }
    const drawPose = (index: number, pose: Look, jetOnly: boolean): void => {
      if (index === actors.length) { submit(); return }
      const vehicle = actors[index]
      const next = () => drawPose(index + 1, pose, jetOnly)
      if (jetOnly && !(vehicle instanceof Jet)) next()
      else this.draw(vehicle, pose, { draw: next, yieldFrame: async () => {} })
    }
    try {
      drawPose(0, near, false)
      if (actors.some(v => v instanceof Jet)) drawPose(0, jetLooks[1], true)
      if (minimal) {
        drawPose(0, medium, false)
        drawPose(0, jetLooks[2], true)
        drawPose(0, far, false)
      }
    } finally { for (const vehicle of actors) this.reset(vehicle) }
  }

  dispose(): void {
    this.disposed = true
    this.disposeParked()
  }

  private disposeParked(): void {
    for (const entries of this.parked.values()) for (const { vehicle } of entries) vehicle.dispose()
    this.parked.clear()
  }
}

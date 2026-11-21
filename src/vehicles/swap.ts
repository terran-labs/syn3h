/** Cache each real player vehicle so repeat switches retain their compiled GPU programs. */
import * as THREE from 'three/webgpu'
import { recordEntryWarmIssue } from '../core/diagnostics'
import { longFrames } from '../core/longFrames'
import type { CoveredWarm, Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { attachVehicleEffects } from './effects'
import { canonicalVehicleKind, createVehicle, isVehicleAvailable, type VehicleKind } from './index'
import type { PlayerSlot } from './PlayerSlot'
import { REST_HEIGHT, type Vehicle } from './Vehicle'
import { drawPlayerVehicleWarm } from './PlayerVehicleWarm'
import { Syn3hBuggy } from './Syn3hBuggy'

/** Metres of air left under the new vehicle's resting height when it has to be lifted clear. */
export const SWAP_CLEARANCE = 0.3

/** Where and how the old vehicle was moving when the player switched. */
export interface SwapPose {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  linvel: { x: number; y: number; z: number }
  angvel: { x: number; y: number; z: number }
}

/** Where the new vehicle starts and how it is moving. */
export interface SwapPlacement {
  position: THREE.Vector3
  heading: number
  linvel: THREE.Vector3
  angvel: THREE.Vector3
  /** Metres the vehicle was raised to clear the ground or liquid (0 when it stayed put). */
  lift: number
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0)
const forward = new THREE.Vector3()
const rotation = new THREE.Quaternion()

/**
 * The placement rule for a switch, the owner's of 16 November 2026: "switch at their current
 * location, velocity, etc., rather than dropping back into the home point".
 *
 *  - Same place. Raised only as far as the new body needs to clear the ground or the liquid
 *    surface under it (its resting height plus SWAP_CLEARANCE), never lowered: a switch in
 *    mid-air stays in mid-air and falls from there; one inside lava or water comes out on top.
 *  - Same heading, level. The nose's heading carries over; pitch and roll do not, so a switch
 *    while upside down or tumbling comes out the right way up, and a differently shaped body
 *    is never rotated into the ground.
 *  - Same velocity. All of it, except that a lifted vehicle does not keep sinking into what it
 *    was lifted out of. Of the spin only the yaw rate carries; the rest belonged to a pose
 *    that was just levelled.
 */
export function swapPlacement(pose: SwapPose, kind: string, terrain: Pick<Terrain, 'heightAt' | 'liquidHeightAt'>): SwapPlacement {
  const t = pose.position, r = pose.rotation
  // Heading from the nose projected on the ground; from the roof when the nose points
  // straight up or down. The same rule as Vehicle.uprightRescue.
  rotation.set(r.x, r.y, r.z, r.w)
  forward.set(0, 0, -1).applyQuaternion(rotation)
  if (forward.x * forward.x + forward.z * forward.z < 0.01) forward.set(0, 1, 0).applyQuaternion(rotation).negate()
  const heading = Math.atan2(-forward.x, -forward.z)
  const x = finite(t.x), z = finite(t.z)
  const surface = Math.max(terrain.heightAt(x, z), terrain.liquidHeightAt?.(x, z) ?? -Infinity)
  const floor = surface + (REST_HEIGHT[canonicalVehicleKind(kind)] ?? 0.7) + SWAP_CLEARANCE
  const y = Number.isFinite(t.y) ? Math.max(t.y, floor) : floor
  const lift = Number.isFinite(t.y) ? y - t.y : 0
  const v = pose.linvel, w = pose.angvel
  return {
    position: new THREE.Vector3(x, y, z),
    heading: Number.isFinite(heading) ? heading : 0,
    linvel: new THREE.Vector3(finite(v.x), lift > 0 ? Math.max(0, finite(v.y)) : finite(v.y), finite(v.z)),
    angvel: new THREE.Vector3(0, finite(w.y), 0),
    lift,
  }
}

export interface VehicleSwapper {
  /**
   * Put the player in a `kind` vehicle where they are now. Returns the vehicle now being
   * driven: a new one, or the current one untouched when it is already that kind.
   */
  swap(kind: VehicleKind): Vehicle
  /** Release cached vehicles and effects. The active vehicle stays with the game. */
  dispose(): void
}

/**
 * `attach` gives a vehicle its effects and returns the disposer; the default is the game's
 * own, with the real headlight a local vehicle gets. The swapper attaches them to the slot's
 * current vehicle straight away, so do not attach effects to the player elsewhere.
 */
export function createVehicleSwapper(
  game: Game,
  terrain: Terrain,
  slot: PlayerSlot,
  attach?: (vehicle: Vehicle) => () => void,
): VehicleSwapper {
  const lights = [0,1].map(() => new THREE.SpotLight(new THREE.Color(1,.9965517,.875),0,50,Math.PI/6,.45,2))
  const attachEffects = attach ?? ((vehicle: Vehicle) => attachVehicleEffects(game, terrain, vehicle, { local: true, spots: lights }))
  const cache = new Map<string, Vehicle>([[canonicalVehicleKind(slot.current.kind), slot.current]])
  let detach = attachEffects(slot.current)
  let disposed = false
  const kinds = (['jet', 'hovercraft', 'tank', 'buggy'] as const).filter(isVehicleAvailable)
  const warmStats = { pending: true, current: null as string | null, get active() { return slot.current } }
  game.scene.userData.playerVehicleCache = warmStats
  let warming: Promise<void> | null = null

  async function warmVehicles(warm: CoveredWarm): Promise<void> {
    warmStats.pending = true
    try {
      for (const kind of kinds) {
        if (disposed) return
        const key = canonicalVehicleKind(kind)
        warmStats.current = kind
        let vehicle = cache.get(key)
        if (!vehicle) {
          await warm.yieldFrame(`Preparing ${kind}`)
          if (disposed) return
          vehicle = cache.get(key)
          if (!vehicle) {
            const player = slot.current
            try {
              vehicle = createVehicle(game, terrain, kind, player.object.position, 0)
              vehicle.setParked(true)
              vehicle.isLocal = true
              vehicle.setColors(player.colors.body, player.colors.accent)
              cache.set(key, vehicle)
            } catch (error) {
              vehicle?.dispose()
              recordEntryWarmIssue('Player vehicle warm-up failed')
              console.warn('Covered vehicle creation failed', kind, error)
              continue
            }
          }
        }
        if (vehicle instanceof Syn3hBuggy && !(await vehicle.waitForCoveredBody())) continue
        if (disposed) return
        await warm.yieldFrame(`Warming ${kind}`)
        if (disposed) return
        try {
          drawPlayerVehicleWarm(game, slot.current, vehicle, warm)
        } catch (error) {
          recordEntryWarmIssue('Player vehicle warm-up failed')
          console.warn('Covered vehicle warm draw failed', kind, error)
        }
      }
    } finally {
      warmStats.current = null
      warmStats.pending = false
    }
  }

  const swapper: VehicleSwapper = {
    swap(kind) {
      if (disposed) throw new Error('Vehicle swapper disposed')
      const previous = slot.current
      // Aliases and retired names all build the buggy: asking for one while driving it is no change.
      if (canonicalVehicleKind(kind) === canonicalVehicleKind(previous.kind)) return previous
      const spanStart = longFrames.start()
      try {
        longFrames.event('vehicle.swap')
        const body = previous.body
        // A held (kinematic) body reports no velocity of its own: it is carried, not moving.
        const held = body.isKinematic()
        const place = swapPlacement({
          position: body.translation(), rotation: body.rotation(),
          linvel: held ? { x: 0, y: 0, z: 0 } : body.linvel(), angvel: held ? { x: 0, y: 0, z: 0 } : body.angvel(),
        }, kind, terrain)
        const { position, heading } = place

        const key = canonicalVehicleKind(kind)
        const next = cache.get(key) ?? createVehicle(game, terrain, kind, position, heading)
        cache.set(key, next)
        next.teleport(position, heading)
        next.setParked(false)
        next.isLocal = previous.isLocal
        next.id = previous.id
        next.name = previous.name
        next.spawnSlot = previous.spawnSlot
        next.setColors(previous.colors.body, previous.colors.accent)
        next.wind.copy(previous.wind)
        Object.assign(next.input, previous.input)
        next.body.setLinvel(place.linvel, true)
        next.body.setAngvel(place.angvel, true)
        // The old vehicle's zorb ball goes with it; the zorb toggle is the player's and carries in
        // the input, so the new vehicle grows its own ball if the mode is still on.
        previous.zorb.remove()
        // Preserve interpolation before the camera, including cached vehicle activation.
        game.add(next, previous)
        // Attach first so the shared effect world stays alive even when there are no bots.
        const oldDetach = detach
        detach = attachEffects(next)
        oldDetach()
        try {
          slot.set(next)
        } finally {
          // Even if a follower fails, the old controller and collider must stop.
          game.remove(previous, false)
          previous.setParked(true)
        }
        return next
      } finally {
        longFrames.end('vehicle.swap', spanStart)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      delete game.scene.userData.playerVehicleCache
      detach()
      for (const vehicle of cache.values()) if (vehicle !== slot.current) vehicle.dispose()
      cache.clear()
      for (const light of lights) { light.removeFromParent(); light.target.removeFromParent(); light.dispose() }
      detach = () => {}
    },
  }
  game.add({
    warmCovered(warm: CoveredWarm): Promise<void> {
      if (disposed) return Promise.resolve()
      return warming ??= warmVehicles(warm).finally(() => { warming = null })
    },
    dispose: () => swapper.dispose(),
  }, 'Vehicle cache')
  return swapper
}

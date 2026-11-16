/** Cache each real player vehicle so repeat switches retain their compiled GPU programs. */
import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { attachVehicleEffects } from './effects'
import { canonicalVehicleKind, createVehicle, type VehicleKind } from './index'
import type { PlayerSlot } from './PlayerSlot'
import type { Vehicle } from './Vehicle'
import { PlayerVehicleWarm } from './PlayerVehicleWarm'

/** Metres the new vehicle starts above the old one's origin, and at least above the surface. */
export const SWAP_LIFT = 0.5

/** Seconds the warm-up waits for a cached vehicle's real body before skipping it. */
const WARM_WAIT = 30
/** Vehicles that load a body (the buggy) say whether it has arrived; the rest are generated. */
const bodyReady = (vehicle: Vehicle) => (vehicle as { bodyReady?: boolean }).bodyReady !== false

const position = new THREE.Vector3()
const forward = new THREE.Vector3()
const rotation = new THREE.Quaternion()

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
  const warmer = new PlayerVehicleWarm(game)
  const queue: VehicleKind[] = ['jet', 'hovercraft', 'tank', 'buggy']
  const warmStats = { pending: true, current: null as string | null }
  game.scene.userData.playerVehicleCache = warmStats
  let idleSeconds = 0
  /**
   * A cached vehicle whose real body is still loading. Warming it now would compile only the
   * stand in, and the warm-up's saved visibility, put back after the body arrived, used to
   * leave that stand in showing. Wait for the body, up to WARM_WAIT seconds.
   */
  let waiting: Vehicle | null = null
  let waited = 0
  const warmUpdate = (dt: number) => {
    if (disposed || !game.renderer?.backend) return
    idleSeconds += Math.min(dt, .1)
    if (idleSeconds < 3) return
    if (warmer.current) { warmer.update(); warmStats.current = warmer.current?.kind ?? null; return }
    if (waiting) {
      waited += Math.min(dt, .1)
      if (!bodyReady(waiting) && waited < WARM_WAIT) return
      if (bodyReady(waiting)) { warmer.begin(waiting); warmStats.current = waiting.kind }
      waiting = null
      return
    }
    const kind = queue.shift()
    if (!kind) { warmStats.pending = false; return }
    const key = canonicalVehicleKind(kind)
    if (cache.has(key)) return
    const v = createVehicle(game, terrain, kind, slot.current.object.position, 0)
    v.isLocal = true
    v.setColors(slot.current.colors.body, slot.current.colors.accent)
    cache.set(key, v)
    if (bodyReady(v)) { warmer.begin(v); warmStats.current = kind; return }
    // Out of the world while it waits, as the warm-up would leave it.
    v.setParked(true)
    waiting = v
    waited = 0
  }
  const swapper: VehicleSwapper = {
    swap(kind) {
      if (disposed) throw new Error('Vehicle swapper disposed')
      const previous = slot.current
      // Aliases and retired names all build the buggy: asking for one while driving it is no change.
      if (canonicalVehicleKind(kind) === canonicalVehicleKind(previous.kind)) return previous
      const body = previous.body
      const t = body.translation(), r = body.rotation()
      // Heading from the nose projected on the ground; from the roof when the nose points
      // straight up or down. The same rule as Vehicle.uprightRescue.
      rotation.set(r.x, r.y, r.z, r.w)
      forward.set(0, 0, -1).applyQuaternion(rotation)
      if (forward.x * forward.x + forward.z * forward.z < 0.01) forward.set(0, 1, 0).applyQuaternion(rotation).negate()
      const heading = Math.atan2(-forward.x, -forward.z)
      const surface = Math.max(terrain.heightAt(t.x, t.z), terrain.liquidHeightAt?.(t.x, t.z) ?? -Infinity)
      position.set(t.x, Math.max(t.y, surface) + SWAP_LIFT, t.z)

      const key = canonicalVehicleKind(kind)
      const next = cache.get(key) ?? createVehicle(game, terrain, kind, position, heading)
      cache.set(key, next)
      if (warmer.current === next) warmer.finish()
      if (waiting === next) waiting = null
      next.teleport(position, heading)
      next.setParked(false)
      next.isLocal = previous.isLocal
      next.id = previous.id
      next.name = previous.name
      next.spawnSlot = previous.spawnSlot
      next.setColors(previous.colors.body, previous.colors.accent)
      next.wind.copy(previous.wind)
      Object.assign(next.input, previous.input)
      next.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
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
    },
    dispose() {
      if (disposed) return
      disposed = true
      warmer.finish()
      delete game.scene.userData.playerVehicleCache
      detach()
      for (const vehicle of cache.values()) if (vehicle !== slot.current) vehicle.dispose()
      cache.clear()
      for (const light of lights) { light.removeFromParent(); light.target.removeFromParent(); light.dispose() }
      detach = () => {}
    },
  }
  game.add({ update: warmUpdate, dispose: () => swapper.dispose() })
  return swapper
}

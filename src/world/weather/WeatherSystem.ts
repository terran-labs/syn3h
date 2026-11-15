/**
 * Weather system: sets the wind on the vehicles this client simulates.
 *
 * It is handed the vehicles it owns (the local player and the bots this client hosts), the
 * same way the terrain's seam follower is. Remote copies are never passed in: their owner
 * already applied the wind, and the same field on every client keeps them in agreement.
 *
 * `Vehicle.wind` is an acceleration that Vehicle.fixedUpdate adds as a force at the end of
 * its step. This system runs before the vehicles in the frame, so it reads the position and
 * velocity the last physics step left.
 */
import type { System } from '../../core/Game'
import type { Terrain } from '../Terrain'
import { exposureOf, windAcceleration } from './drag'
import { type Vec3Like, type WindFrame, currentWindFrame, weatherTime, windAt } from './wind'

/** What the system needs of a vehicle. `Vehicle` satisfies it. */
export interface WindVehicle {
  kind: string
  wingsOpen: boolean
  zorbed: boolean
  zorb: { radius: number }
  lavaDepth: number
  stuck: boolean
  wind: { set(x: number, y: number, z: number): unknown }
  body: {
    isKinematic(): boolean
    mass(): number
    translation(): Vec3Like
    linvel(): Vec3Like
    rotation(): { x: number; y: number; z: number; w: number }
  }
}

/** Height above ground (m) inside which a vehicle lying on its side or roof gets no wind. */
const RESCUE_HEIGHT = 3

export class WeatherSystem implements System {
  private readonly frame = {} as WindFrame
  private readonly w = { x: 0, y: 0, z: 0 }
  private readonly a = { x: 0, y: 0, z: 0 }

  constructor(
    private readonly terrain: () => Terrain | null,
    private readonly vehicles: () => Iterable<WindVehicle>,
  ) {}

  fixedUpdate(): void {
    const terrain = this.terrain()
    const f = currentWindFrame(terrain, this.frame)
    const t = weatherTime()
    for (const v of this.vehicles()) this.apply(v, f, t, terrain)
  }

  /** Set one vehicle's wind for this step. Public for tests. */
  apply(v: WindVehicle, f: WindFrame, t: number, terrain: Terrain | null): void {
    const b = v.body
    if (b.isKinematic() || !this.exposed(v, terrain)) { v.wind.set(0, 0, 0); return }
    const p = b.translation()
    windAt(f, p.x, p.y, p.z, t, this.w)
    windAcceleration(this.w, b.linvel(), exposureOf(v), b.mass(), f.atmosphere, this.a)
    v.wind.set(this.a.x, this.a.y, this.a.z)
  }

  /**
   * False where wind must not act:
   *  - in lava, which stays sticky by design (a zorb ball floats on it as a whole and is
   *    still blown, as on water);
   *  - lying on its side or roof near the ground, not zorbed: the upright rescue waits for
   *    the vehicle to be slower than 3 m/s, and a steady wind sliding it along would stop it.
   */
  private exposed(v: WindVehicle, terrain: Terrain | null): boolean {
    if (v.zorbed) return true
    if (v.stuck || v.lavaDepth > 0) return false
    const r = v.body.rotation()
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z)
    if (upY < 0.3 && terrain) {
      const p = v.body.translation()
      if (p.y - terrain.heightAt(p.x, p.z) < RESCUE_HEIGHT) return false
    }
    return true
  }

  dispose(): void {}
}

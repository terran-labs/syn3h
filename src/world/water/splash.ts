/**
 * A splash on water or lava from something that is not a vehicle (a Plasma Tag or Thunder shot
 * hitting the surface), drawn by the same spray as a vehicle's entry (WaterEffects' Spray): one
 * look for every splash, crown, column and foam ring, lit as the scene is. WaterEffects
 * registers its sprays; gear calls `splash` and does nothing if none are registered (unit tests,
 * a viewer without water).
 */
import type { Vector3 } from 'three/webgpu'

export type SplashKind = 'water' | 'lava'
type Splasher = (at: Vector3, kind: SplashKind, speed: number) => void
const splashers = new WeakMap<object, Splasher>()

/** WaterEffects, for its game: register its sprays (null to clear). */
export function setSplash(game: object, fn: Splasher | null): void {
  if (fn) splashers.set(game, fn)
  else splashers.delete(game)
}

/** A splash at `at` on `kind`, as an entry at `speed` m/s straight down would make. */
export function splash(game: object, at: Vector3, kind: SplashKind, speed: number): void {
  splashers.get(game)?.(at, kind, speed)
}

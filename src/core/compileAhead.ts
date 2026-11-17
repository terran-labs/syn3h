import type * as THREE from 'three/webgpu'

/**
 * Compile something before it is first drawn, a slice per frame, instead of in the frame
 * that first meets it (see Game.compileAhead). Modules without a Game (warm-ups in the
 * vehicle and gear code, which also run in labs) reach the running game's compiler here.
 * Returns null when no game has registered one: the caller then warms by drawing, as before.
 */
let compiler: ((object: THREE.Object3D) => Promise<void>) | null = null
let available: () => boolean = () => true
/** `can` says whether compiling ahead is safe right now (see Game.compilesAhead). */
export function setCompiler(next: ((object: THREE.Object3D) => Promise<void>) | null, can: () => boolean = () => true): void { compiler = next; available = can }
export function compileAhead(object: THREE.Object3D): Promise<void> | null { return compiler && available() ? compiler(object) : null }
/** True in a running game, whether or not compiling ahead is on (see Game.compilesAhead). */
export function hasGame(): boolean { return compiler !== null }
/** True in a running game where compileAhead does something now. */
export function canCompileAhead(): boolean { return compiler !== null && available() }

/**
 * Compile a vehicle that is about to appear, in every look it may wear in its first moments:
 * the close-up skin and the plain distant one (a remote vehicle switches at 25 to 30 m, see
 * vehicles/skins/showroom.ts), then its own. A bot appearing 20 m away and driving off would
 * otherwise compile the other look in the frame it crossed. Resolves at once with no game, or
 * where compiling ahead is off (see Game.compilesAhead).
 *
 * Vehicle.prepareLooks (the vehicle lane's seam) runs the looks itself and makes hidden parts
 * (folded wings, stowed gear, distance models) visible for the compile; it never compiles on
 * its own, so this module's rules still govern. Vehicles without it fall back to their detail
 * hooks, which are private to Vehicle and miss hidden parts.
 */
export async function compileVehicleAhead(vehicle: { object: THREE.Object3D; isLocal?: boolean; update?(dt: number, alpha: number): void; prepareLooks?(compile: (object: THREE.Object3D) => Promise<void>, level?: number): Promise<void> }, level: number): Promise<void> {
  if (!canCompileAhead()) return
  if (vehicle.prepareLooks) { await vehicle.prepareLooks(object => compileAhead(object) ?? Promise.resolve(), level); return }
  const details = (vehicle as unknown as { visualDetails?: Set<(distance: number, remote: boolean, level: number) => void> }).visualDetails
  if (details?.size) for (const distance of [0, 1e4]) {
    for (const detail of details) detail(distance, !vehicle.isLocal, level)
    await compileAhead(vehicle.object)
  }
  vehicle.update?.(0, 1)
  await compileAhead(vehicle.object)
}

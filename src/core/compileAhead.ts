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
/** True in a running game where compileAhead does something now. */
export function canCompileAhead(): boolean { return compiler !== null && available() }

/**
 * Compile a vehicle that is about to appear, in every look it may wear in its first moments:
 * the close-up skin and the plain distant one (a remote vehicle switches at 25 to 30 m, see
 * vehicles/skins/showroom.ts), then its own. A bot appearing 20 m away and driving off would
 * otherwise compile the other look in the frame it crossed. Resolves at once with no game.
 *
 * The looks are chosen through the vehicle's own detail hooks. They are private to Vehicle; a
 * public "prepare your looks" on Vehicle would be the cleaner seam (vehicle lane's call).
 */
export async function compileVehicleAhead(vehicle: { object: THREE.Object3D; isLocal?: boolean; update?(dt: number, alpha: number): void }, level: number): Promise<void> {
  if (!canCompileAhead()) return
  const details = (vehicle as unknown as { visualDetails?: Set<(distance: number, remote: boolean, level: number) => void> }).visualDetails
  if (details?.size) for (const distance of [0, 1e4]) {
    for (const detail of details) detail(distance, !vehicle.isLocal, level)
    await compileAhead(vehicle.object)
  }
  vehicle.update?.(0, 1)
  await compileAhead(vehicle.object)
}

/**
 * Rapier setup and the conventions every system shares.
 *
 * COORDINATES (read this before porting any Unity code)
 *  - World: right handed, +Y up, metres.
 *  - Vehicle local frame: +X right, +Y up, -Z forward (the Three.js convention).
 *  - Unity is left handed with +Z forward. To port a Unity local vector (x, y, z) use
 *    (x, y, -z). To port a Unity local torque or angular velocity (x, y, z) use (-x, -y, z).
 *    `unityVec` and `unityTorque` below do exactly that.
 *
 * TIME
 *  - Physics runs at a fixed 50 Hz (FIXED_DT), Unity's default, which the original Mars
 *    Explorer constants were tuned for. Never step with the frame delta.
 */
import RAPIER from '@dimforge/rapier3d-compat'

export { RAPIER }

export const FIXED_HZ = 50
export const FIXED_DT = 1 / FIXED_HZ

/** Collision group bits. */
export const GROUP_TERRAIN = 0x0001
export const GROUP_VEHICLE = 0x0002
export const GROUP_LIQUID = 0x0004
export const GROUP_PROJECTILE = 0x0008
export const GROUP_ALL = 0xffff

/** Pack Rapier interaction groups: what I am, and what I interact with. */
export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff)
}

/** Unity local vector to our local frame. */
export function unityVec(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y, z: -z }
}

/** Unity local torque or angular velocity to our local frame. */
export function unityTorque(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x: -x, y: -y, z }
}

let ready: Promise<void> | null = null

/**
 * Load the Rapier WASM module once. A failed load is forgotten, so the next call tries again
 * (physicsGate.ts): Rapier keeps nothing from a failed initialisation.
 */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init().catch(error => {
    ready = null
    throw error
  })
  return ready
}

export function createWorld(gravityY: number): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -gravityY, z: 0 })
  world.timestep = FIXED_DT
  return world
}

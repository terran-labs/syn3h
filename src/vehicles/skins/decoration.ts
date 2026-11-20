import type * as T from 'three/webgpu'
import { addLavaGlow } from './lavaGlow'
import { addNightReadability } from './nightReadability'
import type { Decorate } from './showroom'

/**
 * The passes every game vehicle's materials get: night readability, then the lava glow. One
 * shared value with an explicit id, because materials shared between vehicles are keyed by their
 * decoration (skins/showroom.ts `signature`): two vehicles share only if they name the same one.
 */
export const vehicleDecoration: Decorate = Object.assign((root: T.Object3D) => { addNightReadability(root); addLavaGlow(root) }, { decorationId: 'night-lava' })
/** No decoration (viewers and lab exhibits outside the game). */
export const noDecoration: Decorate = Object.assign(() => {}, { decorationId: 'none' })

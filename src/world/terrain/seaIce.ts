/**
 * A frozen sea: the Ice Moon's. When the world setting `world.seaFrozen` is on (defined by
 * the water's parameters; read here by id, so there is one flag and no import between the
 * lanes), the liquid queries treat the sea as absent and the sea is a sheet of ice instead:
 *  - a slab collider whose top is the sea level, slippery (friction SEA_ICE_FRICTION), over
 *    the same window of ground as the terrain's heightfield and moved with it;
 *  - the sea's meshes drawn with an ice material: pale floes, blue only in the cracks
 *    between them and in shadow, a little gloss.
 * Lakes and rivers inland stay liquid; only the sea freezes.
 */
import * as THREE from 'three/webgpu'
import { abs, color, float, mix, mx_noise_float, positionWorld, smoothstep, vec3 } from 'three/tsl'
import { params } from '../../../shared/params'
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../../core/physics'
import { COLLIDER_MARGIN } from './collider'
import type { TerrainData } from './generate'
import { SEA_ICE } from './palettes'

/** Grip of a tyre or a body on the ice sheet: the heightfield's is 1. */
export const SEA_ICE_FRICTION = 0.06
/** Half the slab's thickness. Thick enough that nothing tunnels through it at speed. */
const SLAB = 2

/** True when the world's sea is frozen. */
export function seaFrozen(): boolean {
  return params.get('world.seaFrozen')?.value === true
}

/**
 * The ice sheet's collider: a slab with its top at `level`, covering the same window as the
 * terrain's heightfield centred at (centreX, centreZ). Where the ground rises above the sea
 * the heightfield is on top; where it lies below, the ice is.
 */
export function createSeaIceCollider(world: RAPIER.World, data: TerrainData, centreX: number, centreZ: number, level: number): RAPIER.Collider {
  const extent = (data.resolution - 1 + 2 * COLLIDER_MARGIN) * data.cell
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(extent / 2, SLAB, extent / 2)
      .setTranslation(centreX, level - SLAB, centreZ)
      .setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL))
      .setFriction(SEA_ICE_FRICTION),
  )
}


/**
 * The ice sheet's look: floes in two whites, pressure cracks between them in blue, faint
 * frost grain. Flat and opaque. Drawn on the sea's own meshes, so it follows the window, the
 * apron to the horizon and the planet's curve exactly as the sea does.
 */
export function createSeaIceMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0 })
  const p = positionWorld.xz
  const floes = mx_noise_float(vec3(p.x.mul(0.012), float(0.5), p.y.mul(0.012))).mul(0.5).add(0.5)
  // Cracks: the zero contour of a second noise, thin, wandering, sharper up close.
  const crackField = abs(mx_noise_float(vec3(p.x.mul(0.006), float(3.7), p.y.mul(0.006))).add(mx_noise_float(vec3(p.x.mul(0.03), float(9.1), p.y.mul(0.03))).mul(0.25)))
  const crack = smoothstep(0.035, 0.0, crackField)
  const grain = mx_noise_float(vec3(p.x.mul(0.6), float(1.3), p.y.mul(0.6))).mul(0.04)
  const ice = mix(color(SEA_ICE.old), color(SEA_ICE.floe), smoothstep(0.35, 0.65, floes)).add(vec3(grain))
  material.colorNode = mix(ice, color(SEA_ICE.crack), crack.mul(0.85))
  material.roughnessNode = mix(float(0.28), float(0.6), crack)
  return material
}

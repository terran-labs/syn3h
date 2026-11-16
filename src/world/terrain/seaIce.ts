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
import { abs, cameraPosition, color, float, length, mix, mx_noise_float, positionWorld, smoothstep, vec3 } from 'three/tsl'
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
 * The ice sheet's look, from the driver's seat to the horizon. All generated from world
 * position, no textures:
 *  - floes a few hundred metres across in two whites, the older ice greyer;
 *  - wind-scoured patches of polished blue ice, smoother, so the sun glints off them;
 *  - pressure ridges: bright, rough bands where floes met, tens of metres apart;
 *  - cracks at three scales, the finest a few metres apart, blue, fading with distance
 *    before they could shimmer.
 * Flat and opaque. Drawn on the sea's own meshes, so it follows the window, the apron to the
 * horizon and the planet's curve exactly as the sea does.
 */
export function createSeaIceMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0 })
  const p = positionWorld.xz
  const at = (scale: number, salt: number) => mx_noise_float(vec3(p.x.mul(scale), float(salt), p.y.mul(scale)))
  // How far away: fine detail fades out by 160 m, before it is smaller than a pixel.
  const near = smoothstep(float(160), float(40), length(positionWorld.sub(cameraPosition)))
  const floes = at(0.006, 0.5).mul(0.5).add(0.5)
  const scour = smoothstep(0.15, 0.4, at(0.018, 5.2).add(at(0.07, 6.1).mul(0.3)))
  const ridge = smoothstep(0.06, 0.0, abs(at(0.011, 2.4).add(at(0.05, 4.4).mul(0.2)))).mul(0.8)
  const crack = (scale: number, salt: number, width: number) => smoothstep(width, 0.0, abs(at(scale, salt).add(at(scale * 5, salt + 1).mul(0.18))))
  const cracks = crack(0.009, 3.7, 0.03).max(crack(0.045, 8.3, 0.025).mul(0.8)).max(crack(0.16, 11.9, 0.03).mul(near).mul(0.7))
  const grain = at(0.9, 1.3).mul(0.035).mul(near)
  let ice = mix(color(SEA_ICE.old), color(SEA_ICE.floe), smoothstep(0.3, 0.7, floes))
  ice = mix(ice, color(SEA_ICE.scour), scour.mul(0.75))
  ice = mix(ice, color(SEA_ICE.floe).mul(1.06), ridge)
  material.colorNode = mix(ice.add(vec3(grain)), color(SEA_ICE.crack), cracks.mul(0.8))
  // Polished blue ice is smooth and catches the sun; ridges and cracks are rough.
  material.roughnessNode = mix(float(0.42), float(0.12), scour).add(ridge.mul(0.35)).add(cracks.mul(0.3))
  return material
}

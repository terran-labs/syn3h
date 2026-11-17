/**
 * The bed under every liquid: the terrain's height field as one wrapping texture, so water and
 * lava shaders know the depth under any pixel without a depth pass.
 */
import * as THREE from 'three/webgpu'

/** The terrain's height field as a texture, for depth under any pixel of any water surface. */
export interface WaterBed { texture: THREE.DataTexture; size: number; reference: number }

/**
 * The height field the terrain is drawn and driven on, as one wrapping half-float texture.
 *
 * The sea mesh has a vertex every ten metres or so. Depth interpolated across triangles that
 * size gives foam and shallows straight polygon edges. The height field has a sample every
 * four metres and the GPU interpolates it per pixel, so the shore follows the land. Heights
 * are stored relative to `reference` (the sea level), where half floats are finest.
 */
export function buildBedTexture(data: { heights: Float32Array; resolution: number; size: number }, reference: number): WaterBed {
  // The last row and column repeat the first on a wrapping tile.
  const n = data.resolution - 1
  const out = new Uint16Array(n * n)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) out[iz * n + ix] = THREE.DataUtils.toHalfFloat(Math.max(-60000, Math.min(60000, data.heights[iz * data.resolution + ix] - reference)))
  }
  const map = new THREE.DataTexture(out, n, n, THREE.RedFormat, THREE.HalfFloatType)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.magFilter = map.minFilter = THREE.LinearFilter
  map.generateMipmaps = false
  map.needsUpdate = true
  return { texture: map, size: data.size, reference }
}

/** Until a world is built: one texel far below any surface, so everything reads as deep. */
export const NO_BED = (() => {
  const map = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(-1000)]), 1, 1, THREE.RedFormat, THREE.HalfFloatType)
  map.needsUpdate = true
  return map
})()


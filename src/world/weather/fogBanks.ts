/**
 * The fog banks at run time: the world's fog map (fogMap.ts) as a texture the scene fog reads,
 * rebuilt when the terrain regenerates, and the per-frame numbers that depend only on the hour
 * and the camera. Environment owns one and feeds `input` to heightFog (fog.ts).
 */
import * as THREE from 'three/webgpu'
import { texture, uniform } from 'three/tsl'
import { params } from '../../../shared/params'
import type { Terrain } from '../Terrain'
import { seaLevel } from '../seaLevel'
import type { FogBanksInput } from './fog'
import { FOG_BANK_DENSITY, FOG_BANK_GLOW, type FogMap, buildFogMap, createFogMapTexture, fogAllDay, fogBankDetail, fogBankHeight, fogBanks, fogCoast, fogHourWeights, fogValley, sampleFogMap, writeFogMap } from './fogMap'
import { atmosphereValue } from './params'

type N = any // TSL node

export interface FogBanks {
  input: FogBanksInput
  /** The current map, for tests and tools (null before the first world). */
  readonly map: FogMap | null
  /** Per frame: the hour shown (Environment's eased hour), the camera's position and the sun's height (sine of its elevation). */
  update(hour: number, camera: THREE.Vector3, sunY?: number): void
  dispose(): void
}

export function createFogBanks(terrain: Terrain): FogBanks {
  // One texture for the life of the Environment; each world's map is written into it.
  const tex = createFogMapTexture()
  const mapNode = texture(tex) as N
  const weights = uniform(new THREE.Vector2(0, 0)) as N
  const invSize = uniform(1 / 2048) as N
  const height = uniform(25) as N
  const detail = uniform(2) as N
  const atCamera = uniform(new THREE.Vector3(0, 0, 0)) as N
  const glow = uniform(1) as N
  let map: FogMap | null = null
  const sample = { coast: 0, valley: 0, top: 0 }

  const build = () => {
    const ground = {
      size: terrain.size,
      heightAt: (x: number, z: number) => terrain.heightAt(x, z),
      liquidAt: (x: number, z: number) => terrain.liquidKindAt?.(x, z) ?? null,
    }
    if (!(ground.size > 0)) return
    map = buildFogMap(ground, seaLevel(), Number(params.get('world.seed')?.value ?? 0))
    writeFogMap(tex, map)
    invSize.value = 1 / map.size
  }
  build()
  const unsubscribe = terrain.onRegenerate?.(build) ?? (() => {})

  return {
    input: { map: mapNode, weights, invSize, height, detail, atCamera, glow },
    get map() { return map },
    update(hour, camera, sunY = 1) {
      // Lit by day: brighter than the haze while the sun is up, as the haze itself at night.
      const day = Math.min(1, Math.max(0, (sunY + 0.05) / 0.2))
      glow.value = 1 + FOG_BANK_GLOW * day * day * (3 - 2 * day)
      const air = Math.max(0, Math.min(1, atmosphereValue()))
      const strength = fogBanks.value * air * FOG_BANK_DENSITY
      const w = fogHourWeights(hour, fogAllDay.value)
      ;(weights.value as THREE.Vector2).set(strength * fogCoast.value * w.coast, strength * fogValley.value * w.valley)
      height.value = fogBankHeight.value
      detail.value = map ? fogBankDetail.value : 0
      if (map) {
        sampleFogMap(map, camera.x, camera.z, sample)
        // The map at the camera's ground position; the shader weights and profiles it.
        ;(atCamera.value as THREE.Vector3).set(sample.coast, sample.valley, sample.top)
      } else (atCamera.value as THREE.Vector3).set(0, 0, 0)
    },
    dispose() { unsubscribe(); tex.dispose() },
  }
}

/**
 * Terrain shading in TSL: no textures to download, everything from world position, the
 * vertex normal and a per-vertex volcanic mask from the generator.
 *
 *  - dusty red-orange lowlands, blotched at several scales
 *  - banded red rock on steep slopes (mesa cliffs)
 *  - dark basalt on volcano flanks, with dust settling on the flatter parts
 *  - pale ash toward the summit
 *
 * Detail noise is evaluated in 3D world space, so it does not stretch on cliffs the way a
 * top-down projection would, and a bump from the same noise breaks up flat lighting.
 */
import * as THREE from 'three/webgpu'
import {
  Fn, attribute, cameraPosition, color, float, max, mix, mx_noise_float, normalGeometry, normalView,
  positionView, positionWorld, sin, smoothstep, uniform, vec2,
} from 'three/tsl'
import { ROAD_WIDTH } from './roads'

export interface TerrainMaterial {
  material: THREE.MeshStandardNodeMaterial
  /** Altitude of the volcano rim; the ash band is placed relative to it. */
  setSummit(height: number): void
}

export function createTerrainMaterial(): TerrainMaterial {
  const summit = uniform(200)
  const p = positionWorld
  const volcanic = attribute<'float'>('volcanic', 'float')

  const huge = mx_noise_float(p.mul(0.0025)) // ~400 m regions
  const big = mx_noise_float(p.mul(0.012)) // ~80 m patches
  const mid = mx_noise_float(p.mul(0.09)) // ~10 m
  const fine = mx_noise_float(p.mul(0.7)) // ~1.5 m grain

  // Steepness from the geometry normal: 0 flat, 1 vertical.
  const slope = float(1).sub(normalGeometry.y)

  const dustDark = color(0xa9471f)
  const dustLight = color(0xd5814a)
  // Mostly large soft regions; the 80 m patches alone read as leopard spots from the air.
  let col = mix(dustDark, dustLight, smoothstep(-1.1, 1.1, huge.mul(0.9).add(big.mul(0.45)).add(mid.mul(0.25))))

  // Layered sandstone on cliffs: bands in altitude, wobbled so they are not ruler straight.
  const strata = sin(p.y.mul(0.9).add(big.mul(4))).mul(0.5).add(0.5)
  const rock = mix(color(0x6e2c18), color(0xa4502c), strata)
  const cliff = smoothstep(0.22, 0.42, slope.add(mid.mul(0.06)))
  col = mix(col, rock, cliff)

  // Basalt on volcanoes: darkest where steep, dusted where flat.
  const basalt = mix(color(0x2c201d), color(0x4a2d24), smoothstep(-0.5, 0.5, mid))
  const basaltAmount = volcanic.mul(float(0.55).add(smoothstep(0.03, 0.2, slope).mul(0.45)))
  col = mix(col, basalt, basaltAmount.clamp(0, 1))

  // Pale ash near the summit.
  // Only the top of the cone, streaked downhill by the mid noise rather than speckled.
  const ash = mix(color(0x9a887c), color(0xb09c8e), smoothstep(-0.6, 0.6, mid))
  const ashAmount = smoothstep(summit.mul(0.8), summit.mul(0.98), p.y.add(big.mul(25)))
    .mul(volcanic)
    .mul(0.85)
  col = mix(col, ash, ashAmount)

  // Roads: packed darker surface with faint lighter edge lines, from the per-vertex distance
  // to the nearest centreline. Distance interpolates almost linearly across a cell, so the
  // edges stay crisp even though the grid is 4 m.
  const roadDist = attribute<'float'>('road', 'float')
  const edge = ROAD_WIDTH / 2
  const paved = smoothstep(edge + 0.35, edge - 0.35, roadDist)
  const packed = mix(color(0x5e2d1d), color(0x74402b), smoothstep(-0.6, 0.6, mid.add(fine.mul(0.3))))
  col = mix(col, packed, paved.mul(0.92))
  const line = smoothstep(0.32, 0.08, roadDist.sub(edge - 0.9).abs())
  col = mix(col, color(0xc79670), line.mul(paved).mul(0.45))

  // Grain, so close ground never looks like flat paint.
  col = col.mul(fine.mul(0.08).add(0.96))

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.colorNode = col
  material.roughnessNode = max(float(0.78), float(0.97).sub(cliff.mul(0.1)).sub(paved.mul(0.15)))
  // Bump from the same world noise: metre-scale relief the 4 m grid cannot hold. Three's
  // bumpMap() only perturbs textures (it re-samples at offset UVs), so this is Mikkelsen's
  // surface gradient method written out, with unnormalised screen derivatives so the
  // relief is in real metres. It fades with distance, where the fine noise would shimmer.
  material.normalNode = Fn(() => {
    const fade = smoothstep(220, 40, p.sub(cameraPosition).length())
    const height = mid.mul(0.5).add(fine.mul(0.1)).mul(fade)
    const dH = vec2(height.dFdx(), height.dFdy())
    const sx = positionView.dFdx()
    const sy = positionView.dFdy()
    const n = normalView
    const r1 = sy.cross(n)
    const r2 = n.cross(sx)
    const det = sx.dot(r1)
    const grad = det.sign().mul(r1.mul(dH.x).add(r2.mul(dH.y)))
    return det.abs().mul(n).sub(grad).normalize()
  })()
  material.name = 'terrain'

  return {
    material,
    setSummit(height) {
      summit.value = Math.max(20, height)
    },
  }
}

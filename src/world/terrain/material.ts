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
  positionView, positionWorld, sin, smoothstep, uniform, vec2, vec3,
} from 'three/tsl'
import { ROAD_WIDTH } from './roads'

export interface TerrainMaterial {
  material: THREE.MeshStandardNodeMaterial
  /** Altitude of the volcano rim; the ash band is placed relative to it. */
  setSummit(height: number): void
  /** Height of the sea surface: the shore is scorched and glows just above it. */
  setSea(level: number): void
  /**
   * Recolour the ground for a kind of world. `lavaSea` and `lavaLake` say whether those glow
   * and scorch; `snowHeight` is where snow starts (pass a huge number for none).
   */
  setLook(kind: number, lavaSea: boolean, lavaLake: boolean, snowHeight: number): void
  /** Where the lava lake is, so the crater and its crown can glow. A radius of 0 turns it off. */
  setLake(x: number, z: number, radius: number, surface: number): void
}

interface Palette {
  groundDark: number; groundLight: number; rockDark: number; rockLight: number
  /** The darker rock of the centre feature and the mountain tops. */
  darkRockA: number; darkRockB: number
  /** Ground at the waterline (overridden to scorched black round a lava sea). */
  shore: number
  roadDark: number; roadLight: number; roadLine: number
}

/** Ground colours by kind of world: 0 volcanic, 1 desert, 2 alpine. */
const PALETTES: Palette[] = [
  // Volcanic: saturated rust and basalt, the colour of Tholus and the Mars Explorer worlds.
  {
    groundDark: 0xa5351a, groundLight: 0xd9602c, rockDark: 0x7a2a14, rockLight: 0xa8431f,
    darkRockA: 0x241715, darkRockB: 0x3f241c, shore: 0xc28a5a,
    roadDark: 0x5e2d1d, roadLight: 0x74402b, roadLine: 0xc79670,
  },
  // Desert: gold sand, banded orange sandstone, a pale beach.
  {
    groundDark: 0xc98a3c, groundLight: 0xf0c878, rockDark: 0x9a4a22, rockLight: 0xd08040,
    darkRockA: 0x8a4a26, darkRockB: 0xb86a34, shore: 0xf2deb0,
    roadDark: 0x7a5230, roadLight: 0x93683f, roadLine: 0xf6e3b4,
  },
  // Alpine: meadow green, grey granite, shingle at the water.
  {
    groundDark: 0x3f5f26, groundLight: 0x86a04a, rockDark: 0x55555a, rockLight: 0x8a8782,
    darkRockA: 0x3e4044, darkRockB: 0x63625f, shore: 0xb8b29c,
    roadDark: 0x5a4a38, roadLight: 0x6e5c46, roadLine: 0xd8cfb8,
  },
]

export function createTerrainMaterial(): TerrainMaterial {
  const summit = uniform(200)
  const sea = uniform(0)
  // Lava lake: x, z of its centre, its radius and its surface height.
  const lake = uniform(new THREE.Vector4(0, 0, 0, -1000))
  const p = positionWorld
  const volcanic = attribute<'float'>('volcanic', 'float')

  const huge = mx_noise_float(p.mul(0.0025)) // ~400 m regions
  const big = mx_noise_float(p.mul(0.012)) // ~80 m patches
  const mid = mx_noise_float(p.mul(0.09)) // ~10 m
  const fine = mx_noise_float(p.mul(0.7)) // ~1.5 m grain

  // Steepness from the geometry normal: 0 flat, 1 vertical.
  const slope = float(1).sub(normalGeometry.y)

  // The palette is a set of uniforms, so one material serves every kind of world and a
  // change of kind recolours the ground without rebuilding anything. See PALETTES.
  const U = (hex: number) => uniform(new THREE.Color(hex))
  const pal = {
    groundDark: U(0), groundLight: U(0), rockDark: U(0), rockLight: U(0),
    darkRockA: U(0), darkRockB: U(0), shore: U(0), roadDark: U(0), roadLight: U(0), roadLine: U(0),
  }
  // 0 or 1: does the liquid glow (lava) or not (water).
  const glow = uniform(1)
  // Snow lies above this height on ground that is not too steep. Far above the world: off.
  const snowLine = uniform(1e6)
  const dustDark = pal.groundDark
  const dustLight = pal.groundLight
  // Mostly large soft regions; the 80 m patches alone read as leopard spots from the air.
  let col = mix(dustDark, dustLight, smoothstep(-1.1, 1.1, huge.mul(0.9).add(big.mul(0.45)).add(mid.mul(0.25))))

  // Layered sandstone on cliffs: bands in altitude, wobbled so they are not ruler straight.
  // Kept faint and broken up by noise: strong regular bands read as turned wood.
  const strata = sin(p.y.mul(0.3).add(big.mul(7)).add(mid.mul(2.5))).mul(0.5).add(0.5)
  const rock = mix(pal.rockDark, pal.rockLight, strata.mul(0.22).add(mid.mul(0.45)).add(0.35))
  const cliff = smoothstep(0.16, 0.38, slope.add(mid.mul(0.05)))
  col = mix(col, rock, cliff)

  // Basalt on volcanoes: darkest where steep, dusted where flat.
  const basalt = mix(pal.darkRockA, pal.darkRockB, smoothstep(-0.8, 0.8, big.mul(0.7).add(mid.mul(0.3))))
  const basaltAmount = volcanic.mul(float(0.5).add(smoothstep(0.03, 0.2, slope).mul(0.4)))
  col = mix(col, basalt, basaltAmount.clamp(0, 1))

  // Scorched shore: ground just above the liquid is burnt black, and the last metre glows.
  const aboveSea = p.y.sub(sea)
  col = mix(col, pal.shore, smoothstep(8, 2, aboveSea).mul(0.9))

  // Snow: above the snow line, thinning on steep faces, with a ragged lower edge.
  const snow = smoothstep(snowLine, snowLine.add(45), p.y.add(big.mul(22)).add(mid.mul(6)))
    .mul(smoothstep(0.5, 0.22, slope))
  col = mix(col, color(0xeef2f6), snow)

  // Roads: packed darker surface with faint lighter edge lines, from the per-vertex distance
  // to the nearest centreline. Distance interpolates almost linearly across a cell, so the
  // edges stay crisp even though the grid is 4 m.
  const roadDist = attribute<'float'>('road', 'float')
  const edge = ROAD_WIDTH / 2
  // Faded out by 500 m: coarser levels of detail sample the distance too sparsely to draw
  // an 11 m road, and at that range it is a few pixels wide anyway.
  const roadFade = smoothstep(500, 280, p.sub(cameraPosition).length())
  const paved = smoothstep(edge + 0.35, edge - 0.35, roadDist).mul(roadFade)
  const packed = mix(pal.roadDark, pal.roadLight, smoothstep(-0.6, 0.6, mid.add(fine.mul(0.3))))
  col = mix(col, packed, paved.mul(0.92))
  const line = smoothstep(0.32, 0.08, roadDist.sub(edge - 0.9).abs())
  col = mix(col, pal.roadLine, line.mul(paved).mul(0.45))

  // Grain, so close ground never looks like flat paint.
  col = col.mul(fine.mul(0.08).add(0.96))

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.colorNode = col
  // Heat from the sea lights the waterline, so the coast reads at night and from the air.
  const shoreGlow = smoothstep(1.4, -1.5, aboveSea).mul(0.7)
  // Light from the lava lake on the crater walls and the rock crown round it. Not a real
  // light: a radial term that is strongest on faces turned toward the lake, falls off with
  // distance from it and with height above it. At night the summit glows from within.
  const toLake = vec2(lake.x.sub(p.x), lake.y.sub(p.z))
  const lakeDist = toLake.length()
  const facing = vec2(normalGeometry.x, normalGeometry.z).dot(toLake.div(lakeDist.max(0.001))).max(0)
  const reach = smoothstep(lake.z.mul(2.6), lake.z.mul(0.9), lakeDist)
  const rise = smoothstep(lake.w.add(95), lake.w.add(4), p.y).mul(smoothstep(lake.w.sub(6), lake.w.add(1), p.y))
  const lakeGlow = reach.mul(rise).mul(facing.mul(0.85).add(0.15)).mul(0.55)
  material.emissiveNode = vec3(1.0, 0.2, 0.02).mul(shoreGlow.add(lakeGlow)).mul(glow)
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
    setLook(kind, lavaSea, lavaLake, snowHeight) {
      const c = PALETTES[kind] ?? PALETTES[0]
      for (const k in pal) pal[k as keyof typeof pal].value.setHex(c[k as keyof Palette])
      // A lava sea scorches its shore black; water leaves the palette's own beach colour.
      if (lavaSea) pal.shore.value.setHex(0x140a08)
      glow.value = lavaSea || lavaLake ? 1 : 0
      snowLine.value = snowHeight
    },
    setLake(x, z, radius, surface) {
      lake.value.set(x, z, radius, surface)
    },
    setSea(level) {
      sea.value = level
    },
  }
}

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
import { applyCurve } from '../curve'
import { paletteFor } from './palettes'
import { LOOK_ALPINE } from './settings'

export interface TerrainMaterial {
  material: THREE.MeshStandardNodeMaterial
  /** Altitude of the volcano rim; the ash band is placed relative to it. */
  setSummit(height: number): void
  /** Height of the sea surface: the shore is scorched and glows just above it. */
  setSea(level: number): void
  /**
   * Recolour the ground for a look (an index into palettes.ts). `lavaSea` and `lavaLake` say
   * whether those glow and scorch; `snowHeight` is where snow starts (a huge number for none).
   */
  setLook(look: number, lavaSea: boolean, lavaLake: boolean, snowHeight: number): void
  /** Where the lava lake is, so the crater and its crown can glow. A radius of 0 turns it off. */
  setLake(x: number, z: number, radius: number, surface: number): void
  /**
   * The ground's colour at world position `at`, as a node: the same palette, noise, shore,
   * tundra and snow the terrain shows, without roads, grain or anything camera dependent.
   * `normalY` is the ground normal's y there and `rockMask` the terrain's volcanic mask.
   * It follows setLook, setSea and the snow line, so anything coloured with it recolours
   * with the ground.
   */
  groundColour(at: GroundNode, normalY: GroundNode, rockMask: GroundNode): GroundNode
  /**
   * Shade the ground under plants: `fn` receives the world position and the ground colour
   * (before roads) and returns the colour to use. Pass null to remove it. Rebuilds the
   * terrain's colour, so call it once at start, not every frame.
   */
  setCoverShade(fn: ((at: GroundNode, col: GroundNode) => GroundNode) | null): void
}

/** A TSL node. Left loose because TSL's own node types do not compose across calls. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GroundNode = any

export function createTerrainMaterial(): TerrainMaterial {
  const summit = uniform(200)
  const sea = uniform(0)
  // Lava lake: x, z of its centre, its radius and its surface height.
  const lake = uniform(new THREE.Vector4(0, 0, 0, -1000))
  const p = positionWorld
  const volcanic = attribute<'float'>('volcanic', 'float')

  const fine = mx_noise_float(p.mul(0.7)) // ~1.5 m grain

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
  // 1 on the alpine look, 0 elsewhere.
  const alpine = uniform(0)
  const snowColour = U(0xeef2f6)
  // Wet ice and volcanic glass are smoother than dust.
  const gloss = uniform(0)
  // Glowing seams in the rock; black turns them off.
  const seam = U(0)

  /**
   * The ground's colour at a world position, from the palette and three scales of noise:
   * dust, cliff rock, dark rock, shore, alpine tundra and snow. No roads, grain, bump or
   * anything that depends on the camera, so it can be evaluated anywhere, for example at
   * the foot of a plant in a vertex shader. The terrain's own colour is built from this
   * same function, so the two cannot drift apart.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ground = (at: any, normalY: any, rockMask: any) => {
    const huge = mx_noise_float(at.mul(0.0025)) // ~400 m regions
    const big = mx_noise_float(at.mul(0.012)) // ~80 m patches
    const mid = mx_noise_float(at.mul(0.09)) // ~10 m
    // Steepness: 0 flat, 1 vertical.
    const slope = float(1).sub(normalY)
    // Mostly large soft regions; the 80 m patches alone read as leopard spots from the air.
    let col = mix(pal.groundDark, pal.groundLight, smoothstep(-1.1, 1.1, huge.mul(0.9).add(big.mul(0.45)).add(mid.mul(0.25))))

    // Layered sandstone on cliffs: bands in altitude, wobbled so they are not ruler straight.
    // Kept faint and broken up by noise: strong regular bands read as turned wood.
    const strata = sin(at.y.mul(0.3).add(big.mul(7)).add(mid.mul(2.5))).mul(0.5).add(0.5)
    const rock = mix(pal.rockDark, pal.rockLight, strata.mul(0.22).add(mid.mul(0.45)).add(0.35))
    const cliff = smoothstep(0.16, 0.38, slope.add(mid.mul(0.05)))
    col = mix(col, rock, cliff)

    // Basalt on volcanoes: darkest where steep, dusted where flat.
    const basalt = mix(pal.darkRockA, pal.darkRockB, smoothstep(-0.8, 0.8, big.mul(0.7).add(mid.mul(0.3))))
    const basaltAmount = rockMask.mul(float(0.5).add(smoothstep(0.03, 0.2, slope).mul(0.4)))
    col = mix(col, basalt, basaltAmount.clamp(0, 1))

    // Scorched shore: ground just above the liquid is burnt black round lava, pale by water.
    col = mix(col, pal.shore, smoothstep(8, 2, at.y.sub(sea)).mul(0.9))

    // Alpine ground changes with height: meadow, then thin tan tundra and scree, well
    // below the snow. Off on other worlds.
    const zone = smoothstep(snowLine.mul(0.45), snowLine.mul(0.9), at.y.add(big.mul(18)))
    const tundra = mix(color(0x8a8452), color(0x6f6a5c), smoothstep(-0.4, 0.6, mid))
    col = mix(col, tundra, zone.mul(float(1).sub(cliff)).mul(alpine))

    // Snow: above the snow line, thinning on steep faces, with a ragged lower edge.
    const snow = smoothstep(snowLine, snowLine.add(45), at.y.add(big.mul(22)).add(mid.mul(6)))
      .mul(smoothstep(0.5, 0.22, slope))
    col = mix(col, snowColour, snow)
    return { col, cliff, mid, big, zone }
  }

  const base = ground(p, normalGeometry.y, volcanic)
  const { cliff, mid, big, zone } = base
  const aboveSea = p.y.sub(sea)
  // Set by the ground cover: darkens and tints the ground under dense growth.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let coverShade: ((at: any, col: any) => any) | null = null

  // Roads: packed darker surface with faint lighter edge lines, from the per-vertex distance
  // to the nearest centreline. Distance interpolates almost linearly across a cell, so the
  // edges stay crisp even though the grid is 4 m.
  const roadDist = attribute<'float'>('road', 'float')
  const edge = ROAD_WIDTH / 2
  // Faded out by 500 m: coarser levels of detail sample the distance too sparsely to draw
  // an 11 m road, and at that range it is a few pixels wide anyway.
  const roadFade = smoothstep(500, 280, p.sub(cameraPosition).length())
  const paved = smoothstep(edge + 0.35, edge - 0.35, roadDist).mul(roadFade)

  /** The terrain's full colour: the shared ground colour, then what only the terrain has. */
  const buildColour = () => {
    let col = base.col
    // Drifts of wild flowers painted into the alpine meadow, near the camera.
    const patch = smoothstep(0.25, 0.6, mx_noise_float(p.mul(0.021).add(40)))
    const petal = smoothstep(0.35, 0.75, mx_noise_float(p.mul(1.9)))
    const bloom = mix(color(0xe8c93a), color(0xb06ad0), smoothstep(-0.2, 0.2, mx_noise_float(p.mul(0.008).add(90))))
    const nearGround = smoothstep(160, 30, p.sub(cameraPosition).length())
    col = mix(col, bloom, patch.mul(petal).mul(nearGround).mul(float(1).sub(zone)).mul(float(1).sub(cliff)).mul(alpine).mul(0.7))
    if (coverShade) col = coverShade(p, col)
    const packed = mix(pal.roadDark, pal.roadLight, smoothstep(-0.6, 0.6, mid.add(fine.mul(0.3))))
    col = mix(col, packed, paved.mul(0.92))
    const line = smoothstep(0.32, 0.08, roadDist.sub(edge - 0.9).abs())
    col = mix(col, pal.roadLine, line.mul(paved).mul(0.45))
    // Grain, so close ground never looks like flat paint.
    return col.mul(fine.mul(0.08).add(0.96))
  }

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.colorNode = buildColour()
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
  // Seams: thin bright veins along a contour of the patch noise, broken up by a second
  // contour so they come and go instead of drawing closed loops.
  const vein = smoothstep(0.014, 0.0, big.add(mid.mul(0.12)).abs())
    .mul(smoothstep(-0.25, 0.35, mx_noise_float(p.mul(0.004).add(17))))
    .mul(float(1).sub(paved))
  material.emissiveNode = vec3(1.0, 0.2, 0.02).mul(shoreGlow.add(lakeGlow)).mul(glow).add(seam.mul(vein).mul(0.55))
  material.roughnessNode = max(float(0.78), float(0.97).sub(cliff.mul(0.1)).sub(paved.mul(0.15))).sub(gloss)
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
  // Planet curve: bends only the drawn position. Every colour above reads positionWorld,
  // which stays flat, so the ground does not recolour as the camera moves.
  applyCurve(material)

  return {
    material,
    setSummit(height) {
      summit.value = Math.max(20, height)
    },
    setLook(look, lavaSea, lavaLake, snowHeight) {
      const c = paletteFor(look)
      for (const k in pal) pal[k as keyof typeof pal].value.setHex(c[k as keyof typeof pal])
      snowColour.value.setHex(c.snow)
      seam.value.setHex(c.seam)
      gloss.value = c.gloss
      // A lava sea scorches its shore black; water leaves the palette's own beach colour.
      if (lavaSea) pal.shore.value.setHex(0x140a08)
      glow.value = lavaSea || lavaLake ? 1 : 0
      snowLine.value = snowHeight
      alpine.value = look === LOOK_ALPINE ? 1 : 0
    },
    groundColour(at, normalY, rockMask) {
      return ground(at, normalY, rockMask).col
    },
    setCoverShade(fn) {
      coverShade = fn
      material.colorNode = buildColour()
      material.needsUpdate = true
    },
    setLake(x, z, radius, surface) {
      lake.value.set(x, z, radius, surface)
    },
    setSea(level) {
      sea.value = level
    },
  }
}

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
  Fn, If, attribute, cameraPosition, color, float, max, mix, mx_noise_float, normalGeometry, normalView,
  positionView, positionWorld, sin, smoothstep, time, uniform, vec2, vec3, vec4,
} from 'three/tsl'
import { ROAD_WIDTH } from './roads'
import { applyCurve } from '../curve'
import { paletteFor } from './palettes'
import { LOOK_ALPINE, terrainRoadStyle } from './settings'
import { defineParam, params } from '../../../shared/params'

/**
 * Rich surface is enabled for ordinary play. The four personal sliders remain adjustable;
 * setting all four to zero removes the extra shader work for players who prefer it off.
 */
const R = { group: 'Terrain', scope: 'client', default: 1, min: 0, max: 1, step: 0.01 } as const
/** Centimetre to decimetre grain in the normal near the camera, gone by 60 m; ripples on sand. */
export const terrainDetailNormal = defineParam({ ...R, id: 'terrain.detailNormal', label: 'Ground: close-up grain' })
/** Roughness by zone (rock, ash, road) and glitter on sand and snow. */
export const terrainSurfaceResponse = defineParam({ ...R, id: 'terrain.surfaceResponse', label: 'Ground: surface response and glitter' })
/** Hue and value drift every few hundred metres. */
export const terrainMacroColour = defineParam({ ...R, id: 'terrain.macroColour', label: 'Ground: large colour variation' })
/** One accent colour per planet, used sparingly. */
export const terrainAccent = defineParam({ ...R, id: 'terrain.accent', label: 'Ground: accent colour' })
export const terrainRelief = defineParam({ ...R, id: 'terrain.relief', label: 'Ground: relief strength', default: 0.2 })
const RICH = [terrainDetailNormal, terrainSurfaceResponse, terrainMacroColour, terrainAccent]

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
  /**
   * How much of the rich ground the device's performance level affords, from the level's
   * `detail` share (0 to 1; see `groundTier`). It caps the four personal sliders, it does not
   * replace them: a player's own settings come back when the level rises again.
   */
  setDetail(share: number): void
  drawCoveredMinimal(draw: () => void): void
}

/**
 * Ground shading tier for a performance level's detail share. 2 (0.9 and up): everything.
 * 1 (0.6 and up): large colour variation and the accent, which cost almost nothing now that
 * their noise runs per vertex, but no close-up grain, zoned roughness or glitter. 0: the
 * plain ground, with the smallest shader. A share is used, not a level number, so any number
 * of performance levels maps onto it.
 */
export function groundTier(share: number): 0 | 1 | 2 {
  return share >= 0.9 ? 2 : share >= 0.6 ? 1 : 0
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

  // Cost: nearly all of this material's GPU time is noise evaluated per pixel (measured with
  // tools/terrainlab/rich-cost.mjs). Three rules keep the count down without changing the look:
  //  - noise slower than about 150 m is evaluated per vertex and interpolated; the grid is
  //    4 m, so the interpolation error is far below one colour step;
  //  - noise that only shows near the camera, on one look or beside a road sits inside an
  //    If, so every other pixel skips it;
  //  - anything read inside an If is first copied to a variable outside it, so nothing is
  //    first computed in a branch and then read where the branch was not taken, and no
  //    screen derivative is taken inside non-uniform control flow.
  /** The four slowest noises at `at`: 400 m regions, two colour drifts and the accent's patches. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slowNoise = (at: any) => vec4(
    mx_noise_float(at.mul(0.0025)), mx_noise_float(at.mul(0.0019).add(31)),
    mx_noise_float(at.mul(0.0041).add(77)), mx_noise_float(at.mul(0.006).add(3)),
  )
  const terrainSlow = slowNoise(p).toVarying()

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
  // Rich surface (see the sliders above). `rich` says whether the extra shader is built.
  // The performance level caps the sliders (setDetail): `near` the two that cost per pixel
  // close to the camera, `colour` the two that are nearly free.
  let tier: 0 | 1 | 2 = 2
  const near = () => (tier >= 2 ? 1 : 0)
  const colour = () => (tier >= 1 ? 1 : 0)
  const effective = () => [
    terrainDetailNormal.value * near(), terrainSurfaceResponse.value * near(),
    terrainMacroColour.value * colour(), terrainAccent.value * colour(),
  ]
  let rich = effective().some((v) => v > 0)
  const uDetail = uniform(terrainDetailNormal.value)
  const uResponse = uniform(terrainSurfaceResponse.value)
  const uMacro = uniform(terrainMacroColour.value)
  const uAccent = uniform(terrainAccent.value)
  const uRelief = uniform(terrainRelief.value)
  const accent = U(0)
  // x: 1 when this look has an accent; y: 1 for a shore margin, 0 for cliff streaks; z: sand glitter.
  const accentMode = uniform(new THREE.Vector3(0, 0, 0))

  /**
   * The ground's colour at a world position, from the palette and three scales of noise:
   * dust, cliff rock, dark rock, shore, alpine tundra and snow. No roads, grain, bump or
   * anything that depends on the camera, so it can be evaluated anywhere, for example at
   * the foot of a plant in a vertex shader. The terrain's own colour is built from this
   * same function, so the two cannot drift apart.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ground = (at: any, normalY: any, rockMask: any) => {
    // Per vertex for the terrain itself; evaluated in place for anything else (plants).
    const slow = at === p ? terrainSlow : slowNoise(at)
    const huge = slow.x // ~400 m regions
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

    if (rich) {
      // Large drift in value and in warmth, so an island is not one swatch from the air.
      const m1 = slow.y
      const m2 = slow.z
      const warm = m2.mul(0.07).mul(uMacro)
      col = col.mul(m1.mul(0.1).mul(uMacro).add(1)).mul(vec3(float(1).add(warm), 1, float(1).sub(warm)))
      // The planet's one accent: mineral streaks running down the cliffs (stretched in
      // height), or a margin of growth just above the waterline. Patchy at 150 m so it is
      // found, not everywhere.
      const where = smoothstep(0.0, 0.45, slow.w)
      const streak = smoothstep(0.2, 0.65, mx_noise_float(vec3(at.x.mul(0.11), at.y.mul(0.015), at.z.mul(0.11)).add(9))).mul(cliff)
      const up = at.y.sub(sea)
      const margin = smoothstep(1.5, 4, up).mul(smoothstep(16, 7, up)).mul(float(1).sub(cliff)).mul(smoothstep(-0.3, 0.3, mid))
      col = mix(col, accent, mix(streak, margin, accentMode.y).mul(where).mul(accentMode.x).mul(uAccent).mul(0.6))
    }

    // Alpine ground changes with height: meadow, then thin tan tundra and scree, well
    // below the snow. Off on other worlds.
    const zone = smoothstep(snowLine.mul(0.45), snowLine.mul(0.9), at.y.add(big.mul(18)))
    const tundra = mix(color(0x8a8452), color(0x6f6a5c), smoothstep(-0.4, 0.6, mid))
    col = mix(col, tundra, zone.mul(float(1).sub(cliff)).mul(alpine))

    // Snow: above the snow line, thinning on steep faces, with a ragged lower edge.
    const snow = smoothstep(snowLine, snowLine.add(45), at.y.add(big.mul(22)).add(mid.mul(6)))
      .mul(smoothstep(0.5, 0.22, slope))
    col = mix(col, snowColour, snow)
    return { col, cliff, mid, big, zone, snow, rockAmount: basaltAmount.clamp(0, 1) }
  }

  let base = ground(p, normalGeometry.y, volcanic)
  const { cliff, mid, big, zone, snow: snowAmount, rockAmount } = base
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
  // Road style, from the palette or the slider. `track` is 0 for a made road with crisp
  // edges and lines, 1 for a worn track; `wear` is how bare the track's band is.
  const track = uniform(0)
  const wear = uniform(1)
  const made = smoothstep(edge + 0.35, edge - 0.35, roadDist)
  // A track is narrower than the bed it runs on, and its edge wanders by a metre or so
  // with the ground's own noise, so it has no boundary to read as a ruled line.
  // (`mid` is this same 10 m noise, so it is reused, not evaluated again.)
  const ragged = roadDist.add(mid.mul(1.3)).add(fine.mul(0.45))
  const worn = smoothstep(4.4, 1.6, ragged)
  // Two wheel ruts either side of the centreline (the distance is unsigned, so one term
  // draws both), wobbling a little, with a less worn strip between them.
  // The ruts end 2.1 m from the centreline, so pixels beyond 3 m skip their noise.
  const rut = Fn(() => {
    const r = float(0).toVar()
    If(roadDist.lessThan(3), () => {
      r.assign(smoothstep(0.62, 0.12, roadDist.sub(1.3).add(mx_noise_float(p.mul(0.21)).mul(0.14)).abs()))
    })
    return r
  })()
  const crown = smoothstep(0.75, 0.2, roadDist)
  const trackAmount = worn.mul(wear).mul(float(1).sub(crown.mul(0.55))).mul(0.82).max(rut.mul(0.95)).mul(smoothstep(5.2, 3.6, ragged))
  // What the rest of the material treats as road: where plants, glitter and seams stay off.
  const paved = mix(made, trackAmount, track).mul(roadFade)

  /** The terrain's full colour: the shared ground colour, then what only the terrain has. */
  const buildColour = () => {
    let col = base.col
    // Drifts of wild flowers painted into the alpine meadow, near the camera. Other looks
    // skip the three noises altogether.
    const before = col
    const meadow = float(1).sub(zone).mul(float(1).sub(cliff))
    col = Fn(() => {
      const c = vec3(before).toVar()
      const open = meadow.toVar()
      If(alpine.greaterThan(0.5), () => {
        const patch = smoothstep(0.25, 0.6, mx_noise_float(p.mul(0.021).add(40)))
        const petal = smoothstep(0.35, 0.75, mx_noise_float(p.mul(1.9)))
        const bloom = mix(color(0xe8c93a), color(0xb06ad0), smoothstep(-0.2, 0.2, mx_noise_float(p.mul(0.008).add(90))))
        const nearGround = smoothstep(160, 30, p.sub(cameraPosition).length())
        c.assign(mix(c, bloom, patch.mul(petal).mul(nearGround).mul(open).mul(0.7)))
      })
      return c
    })()
    if (coverShade) col = coverShade(p, col)
    const packed = mix(pal.roadDark, pal.roadLight, smoothstep(-0.6, 0.6, mid.add(fine.mul(0.3))))
    // A made road is its own surface. A track is the ground itself, compacted: the ground
    // colour darkened and pulled part of the way to the road colour, so it belongs to
    // whatever it crosses.
    const compacted = mix(col.mul(0.62), packed, 0.55)
    col = mix(col, mix(packed, compacted, track), paved.mul(mix(float(0.92), float(1), track)))
    const line = smoothstep(0.32, 0.08, roadDist.sub(edge - 0.9).abs())
    col = mix(col, pal.roadLine, line.mul(paved).mul(0.45).mul(float(1).sub(track)))
    // Grain, so close ground never looks like flat paint.
    return col.mul(fine.mul(0.08).add(0.96))
  }

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.colorNode = buildColour()
  // Heat from the sea lights the waterline, so the coast reads at night and from the air.
  // Scorched and still glowing just above the shore: a broad warm wash out to about 3 m and,
  // nearer the lava, cracks of heat in the ground that brighten and fade.
  const scorchCracks = smoothstep(0.62, 0.85, mx_noise_float(vec3(p.x.mul(0.55), p.z.mul(0.55), time.mul(0.15))).mul(0.5).add(0.5))
  const shoreGlow = smoothstep(3, -1.5, aboveSea).pow(2).mul(0.55)
    .add(smoothstep(1.2, -0.2, aboveSea).mul(scorchCracks).mul(1.4))
    .mul(sin(time.mul(0.9).add(p.x.mul(0.13)).add(p.z.mul(0.11))).mul(0.12).add(0.95))
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
    .mul(smoothstep(-0.25, 0.35, mx_noise_float(p.mul(0.004).add(17)).toVarying()))
    .mul(float(1).sub(paved))
  material.emissiveNode = vec3(1.0, 0.2, 0.02).mul(shoreGlow.add(lakeGlow)).mul(glow).add(seam.mul(vein).mul(0.55))
  const camDist = p.sub(cameraPosition).length()
  // Glitter: about one grain in fifteen, in 2 cm cells, on loose sand and on snow. Each
  // grain is a tiny mirror with its own tilt, so the real sun lights it and nothing
  // sparkles at night. Gone by 35 m, where grains are smaller than a pixel and would shimmer.
  const grain = p.mul(45).floor().mul(0.731)
  const loose = max(snowAmount, accentMode.z.mul(float(1).sub(cliff)).mul(float(1).sub(rockAmount))).mul(float(1).sub(paved))
  const spark = Fn(() => {
    const s = float(0).toVar()
    const amount = loose.mul(smoothstep(35, 6, camDist)).mul(uResponse).toVar()
    const cellAt = grain.toVar()
    If(amount.greaterThan(0), () => {
      s.assign(smoothstep(0.42, 0.5, mx_noise_float(cellAt.add(0.37))).mul(amount))
    })
    return s
  })()

  const buildRoughness = () => {
    const plain = max(float(0.78), float(0.97).sub(cliff.mul(0.1)).sub(paved.mul(0.15).mul(float(1).sub(track))))
    if (!rich) return plain.sub(gloss)
    // By zone: dust and ash matt, dark rock smoother and wetter near lava, cliffs between,
    // packed road a little polished.
    let zoned = mix(float(0.9), float(0.52), rockAmount).sub(smoothstep(12, 1, aboveSea).mul(glow).mul(0.12))
    zoned = mix(zoned, float(0.8), cliff.mul(float(1).sub(rockAmount)))
    zoned = mix(zoned, float(0.7), paved)
    return mix(mix(plain, zoned, uResponse), float(0.1), spark).sub(gloss).max(0.08)
  }
  // Bump from the same world noise: metre-scale relief the 4 m grid cannot hold. Three's
  // bumpMap() only perturbs textures (it re-samples at offset UVs), so this is Mikkelsen's
  // surface gradient method written out, with unnormalised screen derivatives so the
  // relief is in real metres. It fades with distance, where the fine noise would shimmer.
  const buildNormal = (richSurface: boolean) => Fn(() => {
    const dist = camDist.toVar()
    const fade = smoothstep(220, 40, dist)
    // Suppress frequencies smaller than a pixel, especially across the long footprint
    // of a grazing view. Distance alone cannot detect that anisotropic undersampling.
    const footprint = max(p.dFdx().length(), p.dFdy().length()).toVar()
    const resolved = (frequency: number) => float(1).sub(smoothstep(0.25, 0.75, footprint.mul(frequency)))
    const height = mid.mul(0.5).add(fine.mul(0.1).mul(resolved(0.7))).mul(fade).toVar()
    if (richSurface) {
      const mid10 = mid.toVar()
      // Loose sand that ripples: not cliff, not dark rock, not road.
      const sandy = accentMode.z.mul(float(1).sub(cliff)).mul(float(1).sub(rockAmount)).mul(float(1).sub(paved)).toVar()
      // Everything here has faded out by 60 m, so pixels beyond it skip four noises, and
      // so does every pixel when the grain is turned off or the performance level sheds it.
      If(dist.lessThan(60).and(uDetail.greaterThan(0)), () => {
        // Grain from 30 cm down to 4 cm, near the camera only.
        const close = mx_noise_float(p.mul(3.1)).mul(0.05).mul(resolved(3.1))
          .add(mx_noise_float(p.mul(8.7)).mul(0.02).mul(resolved(8.7)))
          .add(mx_noise_float(p.mul(23)).mul(0.008).mul(resolved(23)))
        // Wind ripples on loose sand, half a metre apart, bent by the 10 m noise.
        const ripple = sin(p.x.mul(9.2).add(p.z.mul(7.6)).add(mid10.mul(14)).add(mx_noise_float(p.mul(0.35)).mul(5))).mul(0.007).mul(sandy)
        height.addAssign(close.add(ripple.mul(resolved(2))).mul(smoothstep(60, 6, dist)).mul(uDetail))
      })
    }
    // The old metre-scale amplitudes tilt normals enough to paint broad black bands
    // under low sunlight. Keep relief subtle; 1 on the slider restores the old amplitude.
    const dH = vec2(height.dFdx(), height.dFdy()).mul(uRelief)
    const sx = positionView.dFdx()
    const sy = positionView.dFdy()
    const n = normalView
    const r1 = sy.cross(n)
    const r2 = n.cross(sx)
    const det = sx.dot(r1)
    const grad = det.sign().mul(r1.mul(dH.x).add(r2.mul(dH.y)))
    const out = det.abs().mul(n).sub(grad).normalize().toVar()
    if (!richSurface) return out
    // Only a glittering grain is tilted; every other pixel skips the two noises.
    const glint = spark.toVar()
    const cellAt = grain.toVar()
    If(glint.greaterThan(0), () => {
      const tilt = vec3(mx_noise_float(cellAt.add(5.1)), mx_noise_float(cellAt.add(11.7)), 0)
      out.assign(out.add(tilt.mul(glint).mul(0.7)).normalize())
    })
    return out
  })()
  material.roughnessNode = buildRoughness()
  material.normalNode = buildNormal(rich)
  const snapshot = () => ({ base, colorNode: material.colorNode, normalNode: material.normalNode, roughnessNode: material.roughnessNode })
  const surfaces = new Map([[rich, snapshot()]])
  /** Keep each surface graph so reversing a quality step also restores its compiled program. */
  const rebuild = () => {
    const saved = surfaces.get(rich)
    if (saved) {
      base = saved.base
      material.colorNode = saved.colorNode
      material.roughnessNode = saved.roughnessNode
      material.normalNode = saved.normalNode
    } else {
      base = ground(p, normalGeometry.y, volcanic)
      material.colorNode = buildColour()
      material.roughnessNode = buildRoughness()
      material.normalNode = buildNormal(rich)
      surfaces.set(rich, snapshot())
    }
    material.needsUpdate = true
  }
  params.onChange((id) => {
    if (id === terrainRelief.def.id) { uRelief.value = terrainRelief.value; return }
    if (RICH.some((r) => r.def.id === id)) applyRich()
  })
  /** Push the sliders, capped by the performance tier, to the shader. */
  function applyRich(): void {
    const [d, r, m, a] = effective()
    uDetail.value = d
    uResponse.value = r
    uMacro.value = m
    uAccent.value = a
    // Dragging a slider only moves a uniform. The shader is rebuilt (one compile) only when
    // the rich surface as a whole goes on or off, which is how the lowest tier gets the
    // smallest shader.
    const on = d > 0 || r > 0 || m > 0 || a > 0
    if (on !== rich) { rich = on; rebuild() }
  }
  material.name = 'terrain'
  // Planet curve: bends only the drawn position. Every colour above reads positionWorld,
  // which stays flat, so the ground does not recolour as the camera moves.
  applyCurve(material)

  let paletteTrack = 1
  const applyRoadStyle = () => {
    const style = terrainRoadStyle.value as number
    const t = style === 1 ? 0 : style === 2 ? Math.max(paletteTrack, 0.9) : paletteTrack
    track.value = t > 0 ? 1 : 0
    wear.value = t
  }
  params.onChange((id) => { if (id === terrainRoadStyle.def.id) applyRoadStyle() })

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
      accent.value.setHex(c.accent)
      paletteTrack = c.track
      applyRoadStyle()
      accentMode.value.set(c.accent ? 1 : 0, c.accentShore, c.sparkle)
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
    setDetail(share) {
      const next = groundTier(share)
      if (next === tier) return
      tier = next
      applyRich()
    },
    drawCoveredMinimal(draw) {
      const previous = tier
      tier = 0
      try { applyRich(); draw() }
      finally { tier = previous; applyRich() }
    },
    setCoverShade(fn) {
      coverShade = fn
      surfaces.clear()
      material.colorNode = buildColour()
      surfaces.set(rich, snapshot())
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

/**
 * Showroom shading for vehicles, generated in the shader with no textures.
 *
 * The 2011 build used Unity's bumped, reflective paint ("Vehicle Main": bump map, cube map
 * and a sparkle texture), the `GlassGlowing` canopy shader and chrome trim. This file rebuilds
 * those looks from a few numbers: hexagonal scales as a height field, a clear coat, metal
 * flakes, a colour flip toward grazing angles, fresnel glass, knurled chrome and tyre tread.
 *
 * Cost is tiered through `gfx.vehicleShading` (see `core/quality.ts`):
 *   0  the plain materials the vehicle was built with, unchanged
 *   1  scales, knurl and tread as lit bump detail on a standard material
 *   2  adds the clear coat and see-through canopy glass
 *   3  adds metal flakes and the colour flip
 * Materials for a tier are built the first time that tier is used, so a phone that never
 * leaves tier 0 pays nothing. Remote vehicles drop to tier 0 beyond 30 m, where the detail is
 * smaller than a pixel, and never get flakes.
 */
import * as T from 'three/webgpu'
import {
  Fn, abs, atan, attribute, clamp, cross, dFdx, dFdy, dot, faceDirection, float, floor, fract, fwidth, length,
  max, mix, mod, normalLocal, normalView, normalize, positionLocal, positionView, positionViewDirection,
  select, sign, sin, smoothstep, uniform, vec2, vec3,
} from 'three/tsl'
import { params } from '../../../shared/params'
import { vehicleShading } from '../../core/quality'
import { mergedSurfaces, registerVehicleDetail } from './mergeStatic'

export type SurfaceRole = 'paint' | 'accent' | 'chrome' | 'glass' | 'tyre' | 'lamp' | 'trim'
export type ShadingTier = 0 | 1 | 2 | 3

/** Tag a source material with what it represents. Untagged materials are inferred or left as trim. */
export function setRole<M extends T.Material>(material: M, role: SurfaceRole): M {
  material.userData.showroom = role
  return material
}

/** Remote vehicles beyond this drop to plain materials; the lower bound is the way back in. */
const FAR_OUT = 30, FAR_IN = 25
/** The live sky map is captured for a subdued scene fill (0.15). Paint wants it at full strength. */
const ENV_BOOST = .42

// TSL node types do not compose through arithmetic chains, so shader values stay loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

interface Look {
  roughness: number; metalness: number; coat: number
  /** Scale size in metres, 0 for none. */
  cell: number
  /** Scale relief as a fraction of its size. */
  relief: number
  /** Each scale leans like an overlapping snake scale. */
  lean: number
}
/**
 * Looks by role. Paint and accent follow the 2011 screenshots: small scales on the body colour
 * and scales about twice the size on the darker panels. Chrome carries a fine knurl, as on the
 * canopy band. A source material that is already physically authored by a vehicle lead (the
 * jet, hovercraft and tank prefab values) keeps its own roughness, metalness and coat.
 */
const LOOK: Record<SurfaceRole, Look> = {
  paint: { roughness: .3, metalness: .8, coat: 1, cell: .03, relief: .1, lean: .35 },
  accent: { roughness: .26, metalness: .85, coat: 1, cell: .062, relief: .09, lean: .5 },
  chrome: { roughness: .14, metalness: 1, coat: 0, cell: .012, relief: .1, lean: 0 },
  glass: { roughness: .05, metalness: .2, coat: 1, cell: 0, relief: 0, lean: 0 },
  tyre: { roughness: .86, metalness: 0, coat: 0, cell: 0, relief: 0, lean: 0 },
  lamp: { roughness: .3, metalness: 0, coat: 0, cell: 0, relief: 0, lean: 0 },
  trim: { roughness: .5, metalness: .3, coat: 0, cell: 0, relief: 0, lean: 0 },
}

interface ScaleField { height: N; lit: N; fade: N }
type Standard = T.MeshStandardMaterial
const isStandard = (m: T.Material): m is Standard => m instanceof T.MeshStandardMaterial || m instanceof T.MeshStandardNodeMaterial

/** Role from an explicit tag, else from the mesh and material names and the material itself. */
export function roleOf(material: T.Material, meshName = ''): SurfaceRole {
  const tagged = material.userData.showroom as SurfaceRole | undefined
  if (tagged) return tagged
  const name = `${meshName} ${material.name}`
  if (/cockpit|canopy|glass/i.test(name)) return 'glass'
  if (/chrome|silver|spoiler/i.test(name)) return 'chrome'
  if (/tire|tyre|rubber/i.test(name)) return 'tyre'
  if (/headlight|tail ?light|lamp/i.test(name)) return 'lamp'
  if (/accent/i.test(name)) return 'trim'
  if (material instanceof T.MeshPhysicalMaterial && material.clearcoat > 0) return 'paint'
  return 'trim'
}

/**
 * Distance to the nearest edge of a hexagonal tiling with unit spacing, with the offset from
 * the cell centre: (edge distance 0 to 0.5, offset y). Pointy-top cells on a (1, sqrt 3) lattice.
 */
const hexCell = Fn(([p]: [N]) => {
  const r = vec2(1, 1.7320508), h = r.mul(.5)
  const a = mod(p, r).sub(h), b = mod(p.sub(h), r).sub(h)
  const g = select(dot(a, a).lessThan(dot(b, b)), a, b)
  const q = abs(g)
  return vec2(float(.5).sub(max(q.x, q.x.mul(.5).add(q.y.mul(.8660254)))), g.y)
})

/** Height of one scale, 0 in the groove to about 1 on its raised lip. */
const scale = (p: N, lean: number): N => {
  const c = hexCell(p)
  return smoothstep(0, .13, c.x).mul(float(1).add(c.y.mul(lean * 2)))
}

/**
 * Scales projected along the three body axes and blended by the surface normal, so the pattern
 * needs no UV unwrap and stays fixed to the body. Height is metres of relief. The relief fades
 * out as a scale shrinks toward a pixel, which is what stops distant paint from shimmering.
 */
function scaleHeight(cell: number, relief: number, lean: number): ScaleField {
  const n = abs(normalLocal), w4 = n.mul(n).mul(n).mul(n), w = w4.div(w4.x.add(w4.y).add(w4.z))
  const p = positionLocal.div(cell)
  const h = scale(p.zy, lean).mul(w.x).add(scale(p.xz, lean).mul(w.y)).add(scale(p.xy, lean).mul(w.z))
  const footprint = length(fwidth(positionLocal)).div(cell)
  // Full relief down to about three pixels per scale, gone at about one and a half.
  const fade = smoothstep(.7, .3, footprint)
  // `lit` is 0 in a seam and 1 on a scale. Past the fade it settles on the average of the
  // pattern, so paint too far away to resolve its scales keeps the same overall tone.
  return { height: h.mul(cell * relief).mul(fade), lit: mix(.88, smoothstep(0, .45, h), fade), fade }
}

/**
 * Tyre relief in the wheel's own frame (axle along x): chevron lugs across the tread, a centre
 * groove, and fine radial ribs on the sidewall. Returns metres.
 */
function tyreHeight(): N {
  const p = positionLocal, angle = atan(p.y, p.z), radius = length(p.yz)
  const sidewall = smoothstep(.5, .85, abs(normalLocal.x))
  const lug = abs(fract(angle.mul(26 / (Math.PI * 2)).add(abs(p.x).div(radius.max(.05)).mul(1.6))).sub(.5))
  const tread = smoothstep(.1, .2, lug).mul(smoothstep(.02, .07, abs(p.x).div(radius.max(.05))))
  const ribs = sin(angle.mul(96)).mul(.5).add(.5).mul(.25)
  const footprint = length(fwidth(positionLocal)).div(radius.max(.05).mul(.12))
  return mix(tread, ribs, sidewall).mul(radius.mul(.035)).mul(smoothstep(.6, .15, footprint))
}

/**
 * Bump a view space normal from a height in metres. Mikkelsen's surface gradient method, as in
 * three's BumpMapNode, but with true screen derivatives of a procedural height so the relief
 * keeps its physical depth at any zoom.
 */
const bumpNormal = Fn(([height, base]: [N, N]) => {
  const sx = dFdx(positionView), sy = dFdy(positionView)
  const r1 = cross(sy, base), r2 = cross(base, sx)
  const det = dot(sx, r1).mul(faceDirection)
  const gradient = sign(det).mul(dFdx(height).mul(r1).add(dFdy(height).mul(r2)))
  return normalize(abs(det).mul(base).sub(gradient))
})

/** Three decorrelated values in 0 to 1 for a lattice cell. */
const hash3 = Fn(([c]: [N]) => fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))).mul(43758.5453)))

/**
 * Build the material a mesh uses at a tier above 0. `sources` are the materials the mesh was
 * authored with: one, or several packed into a single draw by `mergeStatic`, selected per
 * vertex by `surfaceId`. Colours stay live because the uniforms hold the sources' own Color
 * objects, which is what the vehicle classes and `setColors` write to. `authoredEmission` is the
 * emission node the mesh's material already had, if any: a skin may add its own glow to it after
 * merging (the Syn3h stator tips do), and every tier must keep that.
 */
function build(sources: readonly Standard[], merged: boolean, tier: 1 | 2 | 3, meshName: string, authoredEmission: N | null): T.Material {
  const roles = sources.map(s => roleOf(s, meshName))
  // Canopy glass is its own draw (see `separate` in mergeStatic), so it can blend.
  if (!merged && roles[0] === 'glass' && tier >= 2) return buildGlass(sources[0])
  const physical = tier >= 2
  const material = physical ? new T.MeshPhysicalNodeMaterial() : new T.MeshStandardNodeMaterial()
  const first = sources[0]
  material.name = `${first.name || meshName} showroom ${tier}`
  material.side = first.side; material.transparent = first.transparent; material.opacity = first.opacity
  material.envMapIntensity = ENV_BOOST
  const id = merged ? attribute<'float'>('surfaceId', 'float').round() : null
  let color: N = vec3(0), emission: N = vec3(0), roughness: N = float(0), metalness: N = float(0)
  let coat: N = float(0), coatRoughness: N = float(0), height: N = float(0), flake: N = float(0), flip: N = float(0)
  // 1 everywhere except in the seams between scales.
  let lit: N = float(1)
  const heights = new Map<string, N>(), scales = new Map<string, ScaleField>()
  sources.forEach((source, i) => {
    const role = roles[i], look = LOOK[role]
    const mask: N = id ? id.equal(i).select(1, 0) : float(1)
    // Authored physical materials and unclassified trim keep their own response.
    const own = source instanceof T.MeshPhysicalMaterial || role === 'trim' || role === 'lamp'
    const authoredCoat = source instanceof T.MeshPhysicalMaterial ? source.clearcoat : 0
    color = color.add(uniform(source.color).mul(mask))
    emission = emission.add(uniform(source.emissive).mul(source.emissiveIntensity).mul(mask))
    roughness = roughness.add(mask.mul(own ? source.roughness : look.roughness))
    metalness = metalness.add(mask.mul(own ? source.metalness : look.metalness))
    coat = coat.add(mask.mul(own ? authoredCoat : look.coat))
    coatRoughness = coatRoughness.add(mask.mul(source instanceof T.MeshPhysicalMaterial ? source.clearcoatRoughness : .06))
    if (role === 'tyre') {
      const key = 'tyre'
      if (!heights.has(key)) heights.set(key, tyreHeight())
      height = height.add(heights.get(key).mul(mask))
    } else if (look.cell > 0) {
      const key = `${look.cell}`
      if (!scales.has(key)) { const field = scaleHeight(look.cell, look.relief, look.lean); scales.set(key, field); heights.set(key, field.height) }
      const field = scales.get(key)!
      height = height.add(field.height.mul(mask))
      lit = lit.sub(float(1).sub(field.lit).mul(mask))
      // Relief that has faded out still scatters light: unresolved bumps act as roughness.
      roughness = roughness.add(float(1).sub(field.fade).mul(.16).mul(mask))
    }
    if (role === 'paint' || role === 'accent') { flake = flake.add(mask); flip = flip.add(mask) }
  })
  let normal: N = heights.size ? bumpNormal(height, normalView) : normalView
  if (tier === 3) {
    // Metal flakes: each 2.5 mm lattice cell tilts the base layer a little, so single cells
    // catch the sun and the sky as the vehicle turns. Fades before a flake reaches a pixel.
    const cell = floor(positionLocal.mul(400))
    const near = smoothstep(.9, .25, length(fwidth(positionLocal)).mul(400))
    normal = normalize(normal.add(hash3(cell).sub(.5).mul(.34).mul(flake).mul(near)))
    // Colour flip: toward grazing angles the paint shifts to its neighbouring hue, the
    // deeper indigo that the 2011 body shows where it turns away from the camera.
    const grazing = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2.5)
    color = mix(color, color.zxy.mul(.35).add(color.mul(.45)), grazing.mul(.6).mul(flip))
  }
  // A little colour sinks into the grooves so the scales read in flat light as well.
  if (scales.size) {
    color = color.mul(mix(.3, 1, lit))
    roughness = roughness.add(float(1).sub(lit).mul(.25))
    // Seams are cavities: without occlusion their steep walls mirror the sky and the
    // pattern reads as bright wire instead of dark seams between scales.
    material.aoNode = mix(.1, 1, lit)
  }
  material.colorNode = color
  material.emissiveNode = authoredEmission ?? emission
  material.roughnessNode = clamp(roughness, .04, 1)
  material.metalnessNode = metalness
  if (heights.size || tier === 3) material.normalNode = normal
  if (material instanceof T.MeshPhysicalNodeMaterial) {
    // The lacquer fills the grooves part way: highlights break up over the scales without
    // losing the long, smooth reflection of the sky. It thins out in the seams, which keeps
    // them dark.
    material.clearcoatNode = scales.size ? coat.mul(mix(.15, 1, lit)) : coat
    material.clearcoatRoughnessNode = coatRoughness
    if (heights.size) material.clearcoatNormalNode = normalize(mix(normalView, bumpNormal(height, normalView), .2))
  }
  return material
}

/**
 * Canopy glass after the original `GlassGlowing` shader: alpha = 0.9 - 0.5 * (N.V), colour
 * leaning from the tint toward the reflection as the view grazes. Here the reflection comes
 * from the lit, clear coated surface and the live sky map instead of a baked cube map.
 */
function buildGlass(source: Standard): T.Material {
  const material = new T.MeshPhysicalNodeMaterial()
  material.name = `${source.name || 'canopy'} glass`
  material.transparent = true
  material.envMapIntensity = ENV_BOOST * 1.3
  const facing = clamp(abs(dot(normalView, positionViewDirection)), 0, 1)
  const fresnel = float(.9).sub(facing.mul(.5))
  // The 2011 canopy reads as pale lavender over the tint, so lift the tint toward white.
  material.colorNode = mix(uniform(source.color), vec3(.85, .7, 1), .35)
  material.emissiveNode = uniform(source.emissive).mul(source.emissiveIntensity)
  material.opacityNode = fresnel
  material.roughnessNode = float(.04)
  material.metalnessNode = float(.6)
  material.clearcoatNode = float(1)
  material.clearcoatRoughnessNode = float(.03)
  return material
}

/** Runs the shared night and lava passes over whatever materials the meshes currently hold. */
export type Decorate = (root: T.Object3D) => void

/**
 * Take over the standard materials under `root` and swap them by shading tier. Call once the
 * model is merged and attached. `decorate` is applied exactly once to each tier's materials.
 * Returns a disposer for everything built here.
 */
export function applyShowroom(root: T.Object3D, decorate: Decorate): () => void {
  const entries: { mesh: T.Mesh; source: Standard }[] = []
  root.traverse(o => { if (o instanceof T.Mesh && !Array.isArray(o.material) && isStandard(o.material)) entries.push({ mesh: o, source: o.material }) })
  // Read before anything is decorated: tier 0 decoration wraps these nodes in place.
  const authored = new Map<T.Material, N | null>()
  for (const e of entries) authored.set(e.source, (e.source as unknown as T.MeshStandardNodeMaterial).emissiveNode ?? null)
  const tiers: (Map<T.Mesh, T.Material> | undefined)[] = []
  const built = new Set<T.Material>()
  let current = -1, far = false, remote = false, distance = 0
  const use = (tier: ShadingTier): void => {
    if (tier === current) return
    let set = tiers[tier]
    if (set) for (const e of entries) e.mesh.material = set.get(e.mesh)!
    else {
      const cache = new Map<T.Material, T.Material>()
      for (const e of entries) {
        let variant = tier === 0 ? e.source : cache.get(e.source)
        if (!variant) {
          const packed = mergedSurfaces.get(e.source)
          variant = build(packed ?? [e.source], Boolean(packed), tier as 1 | 2 | 3, e.mesh.name, authored.get(e.source) ?? null)
          cache.set(e.source, variant); built.add(variant)
        }
        e.mesh.material = variant
      }
      decorate(root)
      set = new Map(entries.map(e => [e.mesh, e.mesh.material as T.Material]))
      for (const m of set.values()) built.add(m)
      tiers[tier] = set
    }
    current = tier
  }
  const refresh = (): void => {
    // The frame governor caps this by graphics level (safe 0, mobile 2, desktop 3) and sheds it
    // under load. A value the player set by hand is honoured as it is.
    let tier = Math.max(0, Math.min(3, Math.round(vehicleShading.value))) as ShadingTier
    far = remote && distance > (far ? FAR_IN : FAR_OUT)
    if (remote) tier = far ? 0 : Math.min(tier, 2) as ShadingTier
    use(tier)
    if (tier === 0) return
    // Reflect the scene's own sky map at paint strength. It appears a moment after start,
    // and a standalone viewer may have none.
    let scene: T.Object3D = root
    while (scene.parent) scene = scene.parent
    const environment = (scene as T.Scene).environment ?? null
    for (const m of tiers[tier]!.values()) {
      const std = m as Standard
      if (std.envMap !== environment) { std.envMap = environment; std.needsUpdate = true }
    }
  }
  const detach = registerVehicleDetail(root, (d, isRemote) => { distance = d; remote = isRemote; refresh() })
  const unsubscribe = params.onChange(id => { if (id === vehicleShading.def.id) refresh() })
  refresh()
  return () => {
    detach(); unsubscribe()
    const live = new Set<T.Material>()
    root.traverse(o => { if (o instanceof T.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) live.add(m) })
    // The owner releases whatever is still attached; drop the tiers that are not.
    for (const m of built) if (!live.has(m)) m.dispose()
    for (const e of entries) if (!live.has(e.source)) e.source.dispose()
  }
}

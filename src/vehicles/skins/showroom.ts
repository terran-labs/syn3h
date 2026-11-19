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
 *   1  scales, knurl, tread and track lugs as lit bump detail on a standard material, and the
 *      cockpit canopy as a plain force field
 *   2  adds the clear coat and the lattice on the force field canopy
 *   3  adds metal flakes and the colour flip
 * Materials for a tier are built the first time that tier is used, so a phone that never
 * leaves tier 0 pays nothing. Remote vehicles drop to tier 0 beyond 30 m, where the detail is
 * smaller than a pixel, and never get flakes.
 */
import * as T from 'three/webgpu'
import {
  Fn, abs, atan, attribute, clamp, cross, dFdx, dFdy, dot, faceDirection, float, floor, fract, fwidth, length,
  max, mix, mod, normalGeometry, normalLocal, normalView, normalize, positionGeometry, positionLocal, positionView, positionViewDirection,
  select, sign, sin, smoothstep, time, uniform, uv, vec2, vec3,
} from 'three/tsl'
import { defineParam, params } from '../../../shared/params'
import { vehicleShading } from '../../core/quality'
import { hotExposureNode } from './hotExposure'
import { mergedSurfaces, registerVehicleDetail, standardEmission } from './mergeStatic'
import { heatOwner } from './lavaGlow'

/**
 * Player-facing paint controls. Each drives a shader uniform, so a change shows on the next
 * frame with no recompile. Defaults are the tuned look; 0 on depth, seams and flakes gives
 * smooth lacquer with no pattern at all.
 */
export const paintScaleSize = defineParam({ id: 'paint.scaleSize', label: 'Scale size', group: 'Vehicle paint', scope: 'client', default: 1, min: .4, max: 4, step: .05 })
export const paintScaleDepth = defineParam({ id: 'paint.scaleDepth', label: 'Scale depth', group: 'Vehicle paint', scope: 'client', default: .45, min: 0, max: 2, step: .05 })
export const paintSeams = defineParam({ id: 'paint.seams', label: 'Seam darkness', group: 'Vehicle paint', scope: 'client', default: .35, min: 0, max: 1, step: .05 })
export const paintFlakes = defineParam({ id: 'paint.flakes', label: 'Metal flakes', group: 'Vehicle paint', scope: 'client', default: .6, min: 0, max: 2, step: .05 })
/**
 * Draw canopies still tagged `glass` as the shared force field by default. Players may
 * restore reflective glass; shading tier 0 uses a simple transparent tint.
 */
export const paintCanopy = defineParam({ id: 'paint.forceFieldCanopy', label: 'Force field canopy', group: 'Vehicle paint', scope: 'client', default: true })
export const paintGloss = defineParam({ id: 'paint.gloss', label: 'Sky reflection', group: 'Vehicle paint', scope: 'client', default: .42, min: 0, max: 1.5, step: .02 })
const live = (param: { value: number; def: { id: string } }): N => {
  const node = uniform(param.value)
  params.onChange(id => { if (id === param.def.id) node.value = param.value })
  return node
}
// One uniform per control, shared by every vehicle material.
let controls: { size: N; depth: N; seams: N; flakes: N } | null = null
const paintControls = () => controls ??= { size: live(paintScaleSize), depth: live(paintScaleDepth), seams: live(paintSeams), flakes: live(paintFlakes) }

/** `canopy` is the shared force field. `glass` is the first version's reflective canopy, kept until each vehicle moves over. */
export type SurfaceRole = 'paint' | 'accent' | 'chrome' | 'frame' | 'canopy' | 'glass' | 'glow' | 'tyre' | 'track' | 'lamp' | 'trim'
export type ShadingTier = 0 | 1 | 2 | 3

/** Tag a source material with what it represents. Untagged materials are inferred or left as trim. */
export function setRole<M extends T.Material>(material: M, role: SurfaceRole): M {
  material.userData.showroom = role
  return material
}

/** Remote vehicles beyond this drop to plain materials; the lower bound is the way back in. */
const FAR_OUT = 30, FAR_IN = 25

// ---------------------------------------------------------------------------------------
// Warming a far vehicle's close-up materials
// ---------------------------------------------------------------------------------------
//
// A remote vehicle (another player, or a bot) wears plain materials beyond FAR_OUT and the
// procedural ones inside FAR_IN. The renderer builds a material's shader and pipeline the
// first time something wearing it is drawn, so the frame a bot first came within 25 m, or was
// reeled in by a Yoink, used to stall while a dozen pipelines compiled.
//
// Now each far vehicle builds its close-up set ahead of need and draws it for a few frames on
// proxies: copies of its own meshes, a thousandth of their size, at its own position. The
// pipelines are built while the vehicle is a speck, and the crossing only swaps references.
// The proxies hang from the scene, not from the model: a far vehicle hides its close-up model
// (it shows a distance model instead), and anything under a hidden parent is never drawn.
// They cast shadows, so the shadow pass meets the close-up geometry now as well.
//
// The proxies are kept after warming, out of the scene and never drawn again. The renderer
// counts the objects using each pipeline and frees a pipeline when the last one goes, so
// disposing the proxies would hand back exactly what they were made to build. They are
// released when the vehicle is, or when a later warm-up replaces them.
// It happens again after a graphics level change, which replaces the render targets and with
// them every pipeline, and when the shading tier changes.
//
// Vehicles take turns, so a fleet arriving at once spreads its compiling over many frames.
// The same pattern as the gear's warm-up (src/weapons/warm.ts).

/** Drawn frames a vehicle's proxies stay in the scene. The first draw compiles; the rest are slack for passes that join late. */
const WARM_FRAMES = 3
/** Updates a vehicle may hold the turn without being drawn (hidden, or the world is behind the lobby) before it yields. */
const WARM_PATIENCE = 180
const WARM_SCALE = 1e-3
interface Warm { key: string; group: T.Group | null; drawn: boolean; frames: number; waited: number }
/** Vehicles waiting to warm, in order. Only the first one acts. */
const warmQueue: Warm[] = []
/** Counts for automated checks: sets warmed, turns given up or cancelled, and proxies now in a scene. */
export const showroomWarm = { warmed: 0, abandoned: 0, cancelled: 0, proxies: 0 }

// TSL node types do not compose through arithmetic chains, so shader values stay loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

// ---------------------------------------------------------------------------------------
// Materials shared between vehicles (perf/shared-showroom). Read this first.
// ---------------------------------------------------------------------------------------
//
// Why. The renderer builds every material object it meets (node graph to shader, then a
// pipeline per pass), and a node's cache key is its own id (Node.customCacheKey), so two
// materials built alike are still two builds. Every bot arriving with its own copies of its
// kind's showroom materials paid all of them again: 29 to 73 ms per arrival at High on a fast
// Mac, about half a second on a slow machine.
//
// Scheme.
//   1. `build` takes nothing per vehicle into the graph. Colours, emissive colours and the
//      accent are `perObject` uniforms: as each mesh draws, they read that mesh's own source
//      materials and its vehicle's accent from `paintOf`, which applyShowroom fills.
//   2. `signature` names everything `build` and the decoration do put into the graph (roles,
//      authored roughness and metalness, emissive intensity, flags, tier, canopy choice, the
//      decoration's source text, whether the vehicle can be heated). Equal signatures get the
//      same material object from `pool`.
//   3. Decoration (night readability, lava glow) runs once per shared material, by the first
//      vehicle that wears it (userData.sharedShowroom marks a pooled material; nightReadable and
//      lavaGlow mark it done). On a shared material the lava glow reads heat per object, from the
//      mesh's own vehicle. A vehicle's own materials (tier 0, and anything built unshared) are
//      decorated exactly as before: per-object uniforms there would give every mesh its own
//      binding, and a many-meshed vehicle's first frame stalled for half a second at Low.
//   4. Each vehicle's tier set counts once per shared material (`taken`); `drop` and the
//      disposer give each back once. The last release disposes it.
//
// Invariants (tests/vehicles2/showroom.test.ts):
//   - Two vehicles with equal signatures draw the same material, each in its own colours, and
//     setColors on a source shows on the next draw.
//   - Nothing differing per vehicle is baked into a shared graph: a surface whose emission the
//     vehicle authored itself (any node not in standardEmission, the buggy's stators) is built
//     for that vehicle alone.
//   - A shared material is never disposed while a vehicle holds it. The disposer puts the
//     vehicle's own plain set back on its meshes before returning, because every vehicle class
//     then disposes whatever is still attached.
//   - Heat is per vehicle: a shared material glows only on the vehicle in the lava.
//   - Per-object data lives in WeakMaps keyed by mesh, never in userData: Object3D.clone (used
//     for the warm-up proxies) copies userData through JSON. Proxies are given their mesh's paint.
//   - Tier 0 (the plain materials the vehicle was built with) is untouched: it was always per
//     vehicle, and still is.

/** What a drawn mesh paints with: its own source materials (packed order) and its vehicle's accent. */
interface Paint { sources: readonly Standard[]; accent: T.Color | null }
/** By mesh, not userData: Object3D.clone copies userData through JSON. */
const paintOf = new WeakMap<T.Object3D, Paint>()
/**
 * By geometry, for a mesh cloned from a registered one after the fact (the vehicle lab's stress
 * copies): a clone shares its original's geometry. Without this it would draw in the colours of
 * whichever vehicle first built the shared material. Found once, then kept by mesh.
 */
const paintOfGeometry = new WeakMap<object, Paint>()
function paintFor(object: T.Object3D): Paint | undefined {
  let paint = paintOf.get(object)
  if (!paint) { const geometry = (object as Partial<T.Mesh>).geometry; paint = geometry ? paintOfGeometry.get(geometry) : undefined; if (paint) paintOf.set(object, paint) }
  return paint
}
/** A colour read from the mesh being drawn, or `fallback` (a copy) for a mesh with no paint of its own. */
function perObject(fallback: T.Color, read: (paint: Paint) => T.Color | null | undefined): N {
  const own = fallback.clone()
  return uniform(own).onObjectUpdate(({ object }) => { const paint = object ? paintFor(object) : undefined; return (paint && read(paint)) ?? own })
}
/** Shared materials by signature, with how many vehicle tier sets hold each. */
const pool = new Map<string, { material: T.Material; users: number }>()
const pooled = new Map<T.Material, string>()
/** Counts for automated checks: shared materials alive, vehicle tier sets holding them, times one was reused, and materials built unshared. */
export const showroomShare = { alive: 0, users: 0, reused: 0, unshared: 0 }
function releaseShared(material: T.Material): boolean {
  const key = pooled.get(material)
  if (key === undefined) return false
  const entry = pool.get(key)!
  showroomShare.users--
  if (--entry.users <= 0) { pool.delete(key); pooled.delete(material); material.dispose(); showroomShare.alive-- }
  return true
}

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
  // Dark structural metal: suspension arms, struts, sockets. The vehicle gives the colour only.
  frame: { roughness: .38, metalness: .85, coat: 0, cell: 0, relief: 0, lean: 0 },
  glow: { roughness: 1, metalness: 0, coat: 0, cell: 0, relief: 0, lean: 0 },
  glass: { roughness: .05, metalness: .2, coat: 1, cell: 0, relief: 0, lean: 0 },
  canopy: { roughness: .05, metalness: .2, coat: 1, cell: 0, relief: 0, lean: 0 },
  tyre: { roughness: .86, metalness: 0, coat: 0, cell: 0, relief: 0, lean: 0 },
  // A rubber belt; its lugs are TRACK_LUGS below.
  track: { roughness: .84, metalness: 0, coat: 0, cell: 0, relief: 0, lean: 0 },
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
  // Before tyre: a "rubber belt" is a track.
  if (/tread|track|belt/i.test(name)) return 'track'
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
export const hexCell = Fn(([p]: [N]) => {
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
  const { size, depth } = paintControls(), span: N = size.mul(cell)
  const p = positionLocal.div(span)
  const h = scale(p.zy, lean).mul(w.x).add(scale(p.xz, lean).mul(w.y)).add(scale(p.xy, lean).mul(w.z))
  const footprint = length(fwidth(positionLocal)).div(span)
  // Full relief down to about three pixels per scale, gone at about one and a half.
  const fade = smoothstep(.7, .3, footprint)
  // `lit` is 0 in a seam and 1 on a scale. Past the fade it settles on the average of the
  // pattern, so paint too far away to resolve its scales keeps the same overall tone.
  return { height: h.mul(span).mul(relief).mul(depth).mul(fade), lit: mix(.88, smoothstep(0, .45, h), fade), fade }
}

/**
 * Tyre relief in the wheel's own frame (axle along x): chevron lugs across the tread, a centre
 * groove, and fine radial ribs on the sidewall. Returns metres.
 */
function tyreHeight(): N {
  // Geometry attributes stay in the wheel frame; local nodes include instance transforms.
  // Use the same frame for the footprint so filtering follows each rotating tyre too.
  const p = positionGeometry, angle = atan(p.y, p.z), radius = length(p.yz)
  const sidewall = smoothstep(.5, .85, abs(normalGeometry.x))
  const lug = abs(fract(angle.mul(26 / (Math.PI * 2)).add(abs(p.x).div(radius.max(.05)).mul(1.6))).sub(.5))
  const tread = smoothstep(.1, .2, lug).mul(smoothstep(.02, .07, abs(p.x).div(radius.max(.05))))
  const ribs = sin(angle.mul(96)).mul(.5).add(.5).mul(.25)
  const footprint = length(fwidth(positionGeometry)).div(radius.max(.05).mul(.12))
  return mix(tread, ribs, sidewall).mul(radius.mul(.035)).mul(smoothstep(.6, .15, footprint))
}

/**
 * The lug pattern of the `track` role: chevron lugs moulded across a rubber belt. The role owns
 * these, not the vehicle, so every tracked vehicle reads as the same make of track.
 *   pitch    metres from one lug to the next, along the belt
 *   depth    metres of relief
 *   chevron  degrees the lug arms sweep back from straight across, toward +v
 *   fill     fraction of the pitch the lug's top covers
 *   width    belt width in metres, used only to turn the chevron angle into a sweep across a
 *            0 to 1 u. A vehicle may give its own with `material.userData.trackWidth`.
 */
export const TRACK_LUGS = { pitch: .16, depth: .022, chevron: 28, fill: .42, width: .6 } as const

/**
 * Track lug relief from the belt's own coordinates: `uv` u runs across the belt 0 to 1, v along
 * it in metres. `scroll` is how far the belt has moved, in metres: the lugs sit at v - scroll, so
 * a positive scroll carries them toward +v. Returns the height in metres and `fade`, which falls
 * from 1 to 0 as the lug pitch shrinks from about seven pixels to three, so a distant track is
 * plain rubber rather than a shimmer. `raised` is 1 on a lug and 0 in the gap between.
 */
function trackHeight(scroll: N, width: number): { height: N; raised: N; fade: N } {
  const { pitch, depth, chevron, fill } = TRACK_LUGS
  const across = uv().x, along = uv().y.sub(scroll)
  // Lug phase: the arms sweep back from the centre line by the chevron angle.
  const sweep = width * Math.tan(chevron * Math.PI / 180)
  const phase = along.add(abs(across.sub(.5)).mul(sweep)).div(pitch)
  const half = fill * .5
  // Sloped walls, a flat top, and a plain margin along both edges of the belt.
  const raised = smoothstep(half + .07, half - .03, abs(fract(phase).sub(.5)))
    .mul(smoothstep(0, .06, across)).mul(smoothstep(1, .94, across))
  // The relief lives in the lug walls, a tenth of the pitch, so it fades sooner than the
  // scales do: full down to about seven pixels per lug, gone at about three.
  const fade = smoothstep(.35, .15, fwidth(phase))
  return { height: raised.mul(depth).mul(fade), raised, fade }
}
/** A scroll value wrapped to one lug pitch, which is exact for the pattern and keeps float precision. */
export function wrapTrackScroll(metres: number): number {
  const p = TRACK_LUGS.pitch, r = metres % p
  return r < 0 ? r + p : r
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
function build(sources: readonly Standard[], merged: boolean, tier: 1 | 2 | 3, meshName: string, authoredEmission: N | null, accent: T.Color | null, instancedScroll = false): T.Material {
  const roles = sources.map(s => roleOf(s, meshName))
  // The cockpit canopy is its own draw (see `separate` in mergeStatic), so it can blend.
  if (!merged && (roles[0] === 'canopy' || (roles[0] === 'glass' && paintCanopy.value))) return buildCanopy(sources[0], tier, accent)
  // Canopies still tagged `glass` keep the reflective glass of the first version from the clear coat tier up.
  if (!merged && roles[0] === 'glass' && tier >= 2) return buildGlass(sources[0])
  if (!merged && roles[0] === 'glow') return buildGlow(sources[0], accent)
  const physical = tier >= 2
  const material = physical ? new T.MeshPhysicalNodeMaterial() : new T.MeshStandardNodeMaterial()
  const first = sources[0]
  material.name = `${first.name || meshName} showroom ${tier}`
  material.side = first.side; material.transparent = first.transparent; material.opacity = first.opacity
  // Faceted panels are a property of the surface, not a look: carried into every tier.
  material.flatShading = first.flatShading
  const id = merged ? attribute<'float'>('surfaceId', 'float').round() : null
  let color: N = vec3(0), emission: N = vec3(0), roughness: N = float(0), metalness: N = float(0)
  let coat: N = float(0), coatRoughness: N = float(0), height: N = float(0), flake: N = float(0), flip: N = float(0)
  // 1 everywhere except in the seams between scales.
  let lit: N = float(1)
  // Shading for track lug gaps, 1 elsewhere. Built once however many sources are tracks.
  let groove: N = float(1), track: { height: N; raised: N; fade: N } | null = null
  const heights = new Map<string, N>(), scales = new Map<string, ScaleField>()
  sources.forEach((source, i) => {
    const role = roles[i], look = LOOK[role]
    const mask: N = id ? id.equal(i).select(1, 0) : float(1)
    // Authored physical materials and unclassified trim keep their own response.
    // `trim` is the one role where the vehicle supplies its own roughness and metalness.
    const own = source instanceof T.MeshPhysicalMaterial || role === 'trim' || role === 'lamp'
    const authoredCoat = source instanceof T.MeshPhysicalMaterial ? source.clearcoat : 0
    // Livery without an authored look: a paint surface whose geometry carries a per-vertex
    // `accentMask` (0 to 1) blends from its own colour to the vehicle's accent by it. Scales,
    // coat and flakes carry on across the boundary. Opt in with `userData.accentMask = true`.
    const own_colour: N = perObject(source.color, paint => paint.sources[i]?.color)
    color = color.add((role === 'paint' && source.userData.accentMask === true && accent
      ? mix(own_colour, perObject(accent, paint => paint.accent), clamp(attribute<'float'>('accentMask', 'float'), 0, 1)) : own_colour).mul(mask))
    emission = emission.add(perObject(source.emissive, paint => paint.sources[i]?.emissive).mul(source.emissiveIntensity).mul(mask))
    roughness = roughness.add(mask.mul(own ? source.roughness : look.roughness))
    metalness = metalness.add(mask.mul(own ? source.metalness : look.metalness))
    coat = coat.add(mask.mul(own ? authoredCoat : look.coat))
    coatRoughness = coatRoughness.add(mask.mul(source instanceof T.MeshPhysicalMaterial ? source.clearcoatRoughness : .06))
    if (role === 'tyre') {
      const key = 'tyre'
      if (!heights.has(key)) heights.set(key, tyreHeight())
      height = height.add(heights.get(key).mul(mask))
    } else if (role === 'track') {
      if (!track) {
        // Per object by default: a uniform refreshed from `userData.trackScroll` as each mesh
        // draws, so treads at different speeds share this material. With `instancedScroll`, a
        // per-instance `trackScroll` attribute instead, so many treads can be one instanced draw.
        const scroll: N = instancedScroll
          ? mod(attribute<'float'>('trackScroll', 'float'), TRACK_LUGS.pitch)
          : uniform(0).onObjectUpdate(({ object }) => wrapTrackScroll(Number(object?.userData.trackScroll ?? 0)))
        material.userData.trackScrollNode = scroll
        material.userData.instancedScroll = instancedScroll
        track = trackHeight(scroll, Number(source.userData.trackWidth ?? TRACK_LUGS.width))
        heights.set('track', track.height)
      }
      height = height.add(track.height.mul(mask))
      // Gaps between lugs a shade darker; past the fade, the pattern's average.
      groove = groove.sub(float(1).sub(mix(.92, mix(.78, 1, track.raised), track.fade)).mul(mask))
      // Lugs too small to resolve still scatter light: a little rougher, as the scales do.
      roughness = roughness.add(float(1).sub(track.fade).mul(.08).mul(mask))
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
    normal = normalize(normal.add(hash3(cell).sub(.5).mul(.34).mul(paintControls().flakes).mul(flake).mul(near)))
    // Colour flip: toward grazing angles the paint shifts to its neighbouring hue, the
    // deeper indigo that the 2011 body shows where it turns away from the camera.
    const grazing = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2.5)
    color = mix(color, color.zxy.mul(.35).add(color.mul(.45)), grazing.mul(.6).mul(flip))
  }
  // A little colour sinks into the grooves so the scales read in flat light as well.
  if (scales.size) {
    // `seams` 1 is the hard, dark seam of the first version; 0 leaves the relief to speak alone.
    const seams = paintControls().seams
    color = color.mul(mix(float(1).sub(seams.mul(.7)), 1, lit))
    roughness = roughness.add(float(1).sub(lit).mul(seams).mul(.25))
    // Seams are cavities: without occlusion their steep walls mirror the sky and the
    // pattern reads as bright wire instead of dark seams between scales.
    material.aoNode = mix(float(1).sub(seams.mul(.9)), 1, lit)
  }
  if (track) color = color.mul(groove)
  material.colorNode = color
  material.emissiveNode = authoredEmission ?? emission
  material.roughnessNode = clamp(roughness, .04, 1)
  material.metalnessNode = metalness
  if (heights.size || tier === 3) material.normalNode = normal
  if (material instanceof T.MeshPhysicalNodeMaterial) {
    // The lacquer fills the grooves part way: highlights break up over the scales without
    // losing the long, smooth reflection of the sky. It thins out in the seams, which keeps
    // them dark.
    material.clearcoatNode = scales.size ? coat.mul(mix(float(1).sub(paintControls().seams.mul(.85)), 1, lit)) : coat
    material.clearcoatRoughnessNode = coatRoughness
    if (heights.size) material.clearcoatNormalNode = normalize(mix(normalView, bumpNormal(height, normalView), .2))
  }
  return material
}

/**
 * A colour for things that emit light. An accent can be very dark (a deep navy is nearly
 * black in linear light) and a force field or a nozzle has to glow whatever the player
 * picked: keep the hue, lift it to full brightness, and add a little white.
 */
function glowTint(color: N, white: number): N {
  const hue: N = vec3(color)
  const brightest: N = max(max(hue.x, hue.y), max(hue.z, float(.02)))
  return mix(hue.div(brightest), vec3(1), white)
}

/**
 * Light with no surface: nozzle throats, hover ports, lift fans. Unlit, additive, in the
 * accent hue, dimmed with the night exposure like every other hot colour. The vehicle sets
 * `mesh.userData.glow` each frame (0 off, 1 nominal, more for an afterburner); the shader
 * reads it per object, so parts at different strengths share this one material.
 */
function buildGlow(source: Standard, accent: T.Color | null): T.Material {
  const material = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending })
  material.name = `${source.name || 'glow'} glow`
  material.fog = false
  material.forceSinglePass = true
  const level = uniform(1).onObjectUpdate(({ object }) => Number(object?.userData.glow ?? 1))
  // Hottest where the view looks straight into it, thinner toward the lip.
  const core = clamp(abs(dot(normalView, positionViewDirection)), 0, 1).pow(.6).mul(.75).add(.25)
  material.colorNode = glowTint(accentOf(source, accent), .3).mul(core).mul(level).mul(GLOW_GAIN).mul(hotExposureNode())
  return material
}
const GLOW_GAIN = 3
/** The vehicle's accent, per object; a model shown alone falls back to the colour it was authored with. */
const accentOf = (source: Standard, accent: T.Color | null): N => perObject(accent ?? source.color, paint => paint.accent ?? paint.sources[0]?.color)

/** Strength of the canopy's own light, for our tone mapped frame. */
const CANOPY_GAIN = 5
/** How much of the scene behind it the brightest parts of the canopy hold back. */
const CANOPY_COVER = .55

/**
 * The cockpit canopy every vehicle shares: a force field, in the vehicle's accent colour.
 *
 * From outside it is brightest at the rim, where the view grazes it, with a fine hexagonal
 * lattice and a band of light that sweeps along the vehicle. From inside (the back faces,
 * which is what a camera at the driver's eye sees) it is almost clear: a faint rim and a
 * trace of the lattice as the band passes, so the driver looks out through it and still
 * knows it is there. One draw, both faces in a single pass, no depth write. Like the zorb
 * shield it adds light and holds back a little of what is behind it, so the tint survives
 * in daylight. Tier 1 leaves out the lattice and the band.
 *
 * The original used a reflective glass shader (`GlassGlowing`). The owner chose a force field
 * for every cockpit on 14 November 2026, matching the wings.
 */
function buildCanopy(source: Standard, tier: 1 | 2 | 3, accent: T.Color | null): T.Material {
  const material = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide })
  material.name = `${source.name || 'canopy'} force field`
  material.fog = false
  // Additive light does not depend on draw order, so both faces go in one pass.
  material.forceSinglePass = true
  // The tint is the owner vehicle's accent Color object where there is one, so it follows
  // setColors; a model shown alone falls back to the colour it was authored with.
  const tint = glowTint(accentOf(source, accent), .34)
  const facing = clamp(abs(dot(normalView, positionViewDirection)), 0, 1)
  const rim = float(1).sub(facing).pow(2.5)
  // faceDirection is 1 on the outside and -1 seen from within.
  const outside = faceDirection.mul(.5).add(.5)
  let strength: N
  if (tier === 1) strength = mix(rim.mul(.3), rim.mul(1.1).add(.07), outside)
  else {
    const n = abs(normalLocal), w4 = n.mul(n).mul(n).mul(n), w = w4.div(w4.x.add(w4.y).add(w4.z))
    const p = positionLocal.div(CANOPY_CELL)
    const edge: N = hexCell(p.zy).x.mul(w.x).add(hexCell(p.xz).x.mul(w.y)).add(hexCell(p.xy).x.mul(w.z))
    const footprint = length(fwidth(positionLocal)).div(CANOPY_CELL)
    const lattice = float(1).sub(smoothstep(0, .07, edge)).mul(smoothstep(.7, .3, footprint))
    // A band of light travelling from nose to tail about every three seconds.
    const band = sin(positionLocal.z.mul(2.4).add(time.mul(2.1))).mul(.5).add(.5).pow(6)
    const seenOut = rim.mul(1.1).add(lattice.mul(band.mul(.9).add(.22))).add(.06)
    const seenIn = rim.mul(.3).add(lattice.mul(band).mul(.12))
    strength = mix(seenIn, seenOut, outside)
  }
  material.blending = T.CustomBlending
  material.blendSrc = T.OneFactor; material.blendDst = T.OneMinusSrcAlphaFactor
  material.blendSrcAlpha = T.OneFactor; material.blendDstAlpha = T.OneMinusSrcAlphaFactor
  // Not dimmed with the night exposure as the wings and thrusters are: the canopy is faint to
  // begin with, and that dimming (measured at 0.15 at 23:00) removed it altogether.
  material.colorNode = tint.mul(strength).mul(CANOPY_GAIN)
  material.opacityNode = clamp(strength.mul(CANOPY_COVER), 0, .6).mul(outside.mul(.8).add(.2))
  return material
}
/** Size of one cell of the canopy lattice, in metres. */
const CANOPY_CELL = .11

/**
 * Canopy glass after the original `GlassGlowing` shader: alpha = 0.9 - 0.5 * (N.V), colour
 * leaning from the tint toward the reflection as the view grazes. Here the reflection comes
 * from the lit, clear coated surface and the live sky map instead of a baked cube map.
 */
function buildGlass(source: Standard): T.Material {
  const material = new T.MeshPhysicalNodeMaterial()
  material.name = `${source.name || 'canopy'} glass`
  material.transparent = true
  // Glass mirrors the sky a little more strongly than paint (see `refresh`).
  material.userData.glass = true
  const facing = clamp(abs(dot(normalView, positionViewDirection)), 0, 1)
  const fresnel = float(.9).sub(facing.mul(.5))
  // The 2011 canopy reads as pale lavender over the tint, so lift the tint toward white.
  material.colorNode = mix(perObject(source.color, paint => paint.sources[0]?.color), vec3(.85, .7, 1), .35)
  material.emissiveNode = perObject(source.emissive, paint => paint.sources[0]?.emissive).mul(source.emissiveIntensity)
  material.opacityNode = fresnel
  material.roughnessNode = float(.04)
  material.metalnessNode = float(.6)
  material.clearcoatNode = float(1)
  material.clearcoatRoughnessNode = float(.03)
  return material
}

/**
 * Whether a mesh's `track` surfaces read their scroll per instance: when its material sets
 * `userData.instancedScroll = true`, or its geometry carries a `trackScroll` attribute. Either
 * way the attribute must be an InstancedBufferAttribute of one float per instance. Without it
 * the scroll is `mesh.userData.trackScroll`.
 */
function scrolls(mesh: T.Mesh, source: Standard): boolean {
  return source.userData.instancedScroll === true || mesh.geometry.hasAttribute('trackScroll')
}

/**
 * What makes two vehicles' materials for a surface interchangeable: everything `build` and the
 * decoration bake into the graph (roles, authored responses, intensities, tier, flags), and
 * nothing that is read per object (colours, accent). Null when the surface carries emission of
 * its vehicle's own (see standardEmission): that one is built for its vehicle alone.
 */
function signature(sources: readonly Standard[], merged: boolean, tier: number, meshName: string, authored: N | null, accent: T.Color | null, instanced: boolean, decorate: Decorate, heated: boolean): string | null {
  if (authored && !standardEmission.has(authored)) return null
  const surfaces = sources.map(m => [
    roleOf(m, meshName), m.name, m instanceof T.MeshPhysicalMaterial ? `p${m.clearcoat}/${m.clearcoatRoughness}` : 's', m.roughness, m.metalness, m.emissiveIntensity,
    m.userData.accentMask === true ? 'mask' : '', m.userData.trackWidth ?? '', m.side, m.transparent ? 't' : '', m.opacity, m.flatShading ? 'flat' : '',
  ].join(':'))
  return [tier, merged ? 'merged' : '', instanced ? 'instanced' : '', accent ? 'accent' : '', paintCanopy.value ? 'field' : 'glass', heated ? 'heat' : '', meshName, decorate.toString(), ...surfaces].join('|')
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
  // The owner vehicle publishes its live colours (see Vehicle.setColors); a viewer has none.
  let accent: T.Color | null = null
  for (let o: T.Object3D | null = root; o; o = o.parent) { const c = o.userData.vehicleColors as { accent?: T.Color } | undefined; if (c?.accent) { accent = c.accent; break } }
  // Lava glow coats a vehicle that can be heated; a model with no vehicle (a viewer) is left plain.
  const heated = Boolean(heatOwner(root))
  for (const e of entries) { const paint = { sources: mergedSurfaces.get(e.source) ?? [e.source], accent }; paintOf.set(e.mesh, paint); paintOfGeometry.set(e.mesh.geometry, paint) }
  // Read before anything is decorated: tier 0 decoration wraps these nodes in place.
  const authored = new Map<T.Material, N | null>()
  for (const e of entries) authored.set(e.source, (e.source as unknown as T.MeshStandardNodeMaterial).emissiveNode ?? null)
  const tiers: (Map<T.Mesh, T.Material> | undefined)[] = []
  const built = new Set<T.Material>()
  const plainCanopies = new Map<T.Mesh, T.Material>()
  let current = -1, far = false, remote = false, distance = 0
  // Warming state (see the note beside WARM_FRAMES); declared here because `use` must know of the proxies.
  let warm: Warm | null = null, warmed = '', lastKey = '', level = -1
  /** The scene this model is in, or null for a model that is not in one (a viewer mid-build). */
  const sceneOf = (): T.Scene | null => {
    let top: T.Object3D = root
    while (top.parent) top = top.parent
    return (top as Partial<T.Scene>).isScene ? top as T.Scene : null
  }
  const environment = (): T.Texture | null => sceneOf()?.environment ?? null
  const use = (tier: ShadingTier): void => {
    if (tier === current) return
    let set = tiers[tier]
    if (set) for (const e of entries) e.mesh.material = set.get(e.mesh)!
    else {
      // Keyed by source, and apart for meshes that scroll a track per instance (see `scrolls`).
      const cache = new Map<T.Material, T.Material>(), instancedCache = new Map<T.Material, T.Material>()
      // A set holds each shared material once, however many of its meshes wear it (see drop).
      const taken = new Set<T.Material>()
      for (const e of entries) {
        const instanced = scrolls(e.mesh, e.source), shared = instanced ? instancedCache : cache
        let variant = tier === 0 ? e.source : shared.get(e.source)
        if (!variant) {
          const packed = mergedSurfaces.get(e.source), sources = packed ?? [e.source], own = authored.get(e.source) ?? null
          const key = signature(sources, Boolean(packed), tier, e.mesh.name, own, accent, instanced, decorate, heated)
          const found = key === null ? undefined : pool.get(key)
          if (found) { variant = found.material; if (!taken.has(variant)) { taken.add(variant); found.users++; showroomShare.users++; showroomShare.reused++ } }
          else {
            variant = build(sources, Boolean(packed), tier as 1 | 2 | 3, e.mesh.name, own && standardEmission.has(own) ? null : own, accent, instanced)
            if (key === null) showroomShare.unshared++
            else { variant.userData.sharedShowroom = true; pool.set(key, { material: variant, users: 1 }); pooled.set(variant, key); taken.add(variant); showroomShare.alive++; showroomShare.users++ }
          }
          shared.set(e.source, variant); built.add(variant)
        }
        e.mesh.material = variant
      }
      decorate(root)
      set = new Map(entries.map(e => [e.mesh, e.mesh.material as T.Material]))
      for (const m of set.values()) built.add(m)
      tiers[tier] = set
      // Give a new set the sky map before it is first drawn. Setting it afterwards, as
      // `refresh` must when the map itself is replaced, costs a second compile.
      if (tier > 0) { const sky = environment(); for (const m of set.values()) (m as Standard).envMap = sky }
    }
    current = tier
  }

  // --- Warming (see the note beside WARM_FRAMES) -------------------------------------------
  /** The tier this vehicle will wear when it comes close, or 0 when there is nothing to warm. */
  const nearTier = (): ShadingTier => (remote && far ? Math.min(2, Math.max(0, Math.round(vehicleShading.value))) : 0) as ShadingTier
  /** Proxies from the last finished warm-up, out of the scene, holding their pipelines in the renderer's cache. */
  let kept: T.Group | null = null
  const releaseKept = (): void => {
    if (!kept) return
    for (const proxy of kept.children) (proxy as Partial<T.InstancedMesh>).dispose?.()
    kept = null
  }
  const endWarm = (outcome: 'warmed' | 'abandoned' | 'cancelled'): void => {
    if (!warm) return
    if (warm.group) {
      warm.group.removeFromParent()
      showroomWarm.proxies -= warm.group.children.length
      // A finished warm-up keeps its proxies alive (see the note above); any other outcome frees them.
      if (outcome === 'warmed') { releaseKept(); kept = warm.group }
      else for (const proxy of warm.group.children) (proxy as Partial<T.InstancedMesh>).dispose?.()
    }
    const at = warmQueue.indexOf(warm); if (at >= 0) warmQueue.splice(at, 1)
    // Abandoned counts as done for this tier and level: a vehicle nobody can see must not hold the queue for ever.
    if (outcome !== 'cancelled') warmed = warm.key
    showroomWarm[outcome]++
    warm = null
  }
  const stepWarm = (): void => {
    const tier = nearTier(), key = `${tier}:${level}`
    if (warm && warm.key !== key) endWarm('cancelled')
    // Any change of tier or graphics level, even away and back, replaces render targets and
    // with them every pipeline: what was warmed before no longer counts.
    if (key !== lastKey) { lastKey = key; warmed = '' }
    if (tier === 0 || warmed === key) return
    // Not in a scene (a viewer mid-build): nothing would draw the proxies, so do not take a turn.
    const scene = sceneOf()
    if (!scene) { endWarm('cancelled'); return }
    if (!warm) { warm = { key, group: null, drawn: false, frames: 0, waited: 0 }; warmQueue.push(warm) }
    if (warmQueue[0] !== warm) return
    const job = warm
    if (!job.group) {
      try {
        if (!tiers[tier]) {
          // Building a set dresses the meshes in it (decoration reads them there); put the
          // plain materials straight back, in the same update, before anything is drawn.
          use(tier); current = -1; refresh()
        }
        const set = tiers[tier]!, group = new T.Group(), seen = new Set<string>()
        group.name = 'Showroom warm'; group.scale.setScalar(WARM_SCALE)
        for (const e of entries) {
          const material = set.get(e.mesh)
          // One proxy per distinct pipeline: the same geometry and material on the same kind of mesh.
          const pair = `${e.mesh.geometry.uuid}:${material?.uuid}:${(e.mesh as Partial<T.InstancedMesh>).isInstancedMesh ? 'i' : 'm'}`
          if (!material || seen.has(pair)) continue
          seen.add(pair)
          const proxy = e.mesh.clone(false)
          const paint = paintOf.get(e.mesh); if (paint) paintOf.set(proxy, paint)
          proxy.material = material; proxy.visible = true; proxy.frustumCulled = false; proxy.castShadow = true
          // Only frames that really draw count: the world is not rendered behind the lobby.
          proxy.onBeforeRender = () => { job.drawn = true }
          group.add(proxy); showroomWarm.proxies++
        }
        job.group = group; root.getWorldPosition(group.position); scene.add(group)
      } catch (error) {
        // Warming is an optimisation. If a skin's meshes cannot be copied, the vehicle
        // simply compiles on arrival, as it did before.
        console.warn('Vehicle materials not warmed', error)
        job.group ??= new T.Group(); endWarm('abandoned')
      }
      return
    }
    // Stay with the vehicle, so the proxies are lit and shadowed as it will be.
    root.getWorldPosition(job.group.position)
    if (job.drawn) { job.drawn = false; if (++job.frames >= WARM_FRAMES) endWarm('warmed') }
    else if (++job.waited > WARM_PATIENCE) endWarm('abandoned')
  }
  /** Let go of a tier set: shared materials back to the pool (once each), the rest disposed. */
  const drop = (set: Map<T.Mesh, T.Material> | undefined): void => {
    for (const m of new Set(set?.values() ?? [])) { built.delete(m); if (!releaseShared(m)) m.dispose() }
  }
  const refresh = (): void => {
    // The frame governor caps this by graphics level (safe 0, mobile 0, desktop 3) and sheds it
    // under load. A value the player set by hand is honoured as it is.
    let tier = Math.max(0, Math.min(3, Math.round(vehicleShading.value))) as ShadingTier
    far = remote && distance > (far ? FAR_IN : FAR_OUT)
    if (remote) tier = far ? 0 : Math.min(tier, 2) as ShadingTier
    use(tier)
    if (tier === 0) {
      // Plain paint must not turn the cockpit into an opaque box. Keep the safe canopy
      // transparent without compiling the procedural rim, lattice or paint shaders.
      for (const e of entries) {
        if (mergedSurfaces.has(e.source)) continue
        const role = roleOf(e.source, e.mesh.name)
        if (role !== 'canopy' && role !== 'glass') continue
        if (role === 'glass' && !paintCanopy.value) { e.mesh.material = tiers[0]!.get(e.mesh)!; continue }
        let canopy = plainCanopies.get(e.mesh)
        if (!canopy) {
          const tint = new T.MeshBasicMaterial({ transparent: true, opacity: .08, depthWrite: false, side: T.DoubleSide, fog: false })
          tint.name = `${e.source.name || 'canopy'} plain force field`
          tint.color = accent ?? e.source.color
          tint.forceSinglePass = true
          canopy = tint; plainCanopies.set(e.mesh, canopy); built.add(canopy)
        }
        e.mesh.material = canopy
      }
      return
    }
    // Reflect the scene's own sky map at paint strength. It appears a moment after start,
    // and a standalone viewer may have none. A set is given the map when it is built (`use`),
    // so this recompiles only when the map itself is a different texture.
    const sky = environment()
    for (const m of tiers[tier]!.values()) {
      const std = m as Standard
      if (std.envMap !== sky) { std.envMap = sky; std.needsUpdate = true }
      // The live sky map is captured for a subdued scene fill (0.15); paint reflects it at its own strength.
      std.envMapIntensity = paintGloss.value * (std.userData.glass ? 1.3 : 1)
    }
  }
  const detach = registerVehicleDetail(root, (d, isRemote, graphics) => { distance = d; remote = isRemote; level = graphics; refresh(); stepWarm() })
  const unsubscribe = params.onChange(id => {
    if (id === paintCanopy.def.id) {
      // The switch changes which material a canopy gets, so the built tiers are stale.
      use(0)
      endWarm('cancelled'); releaseKept(); warmed = ''
      for (let tier = 1; tier < tiers.length; tier++) { drop(tiers[tier]); tiers[tier] = undefined }
      refresh()
    } else if (id === vehicleShading.def.id || id === paintGloss.def.id) refresh()
  })
  refresh()
  return () => {
    detach(); unsubscribe(); endWarm('cancelled'); releaseKept()
    // Shared materials go back to the pool, and the vehicle's own plain set goes back on its
    // meshes: the owner disposes whatever is attached, and must never dispose a material other
    // vehicles are drawing.
    for (const e of entries) if (pooled.has(e.mesh.material as T.Material)) e.mesh.material = tiers[0]?.get(e.mesh) ?? e.source
    for (let tier = 1; tier < tiers.length; tier++) { drop(tiers[tier]); tiers[tier] = undefined }
    const live = new Set<T.Material>()
    root.traverse(o => { if (o instanceof T.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) live.add(m) })
    // The owner releases whatever is still attached; drop the tiers that are not.
    for (const m of built) if (!live.has(m)) m.dispose()
    for (const e of entries) if (!live.has(e.source)) e.source.dispose()
  }
}

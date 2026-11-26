/**
 * The sea's surface exactly as it is drawn, at the lens: one function shared by the sea mesh's
 * vertices, the waterline on the lens and the underwater look, so the three meet at every pixel.
 *
 * The owner, on v26.11.2405: the line drawn where the water meets the lens sat elsewhere than where
 * the water stopped being drawn. The causes (tools/waterline-frames.mjs on the live build): the
 * line was a plane fitted to the physical surface on a sheet 1.5 near-plane distances out, while
 * the mesh is cut by the near plane itself and carries visual-only detail the physics does not
 * know; and the underwater look switched for the whole screen when the lens centre crossed.
 *
 * Here, for each pixel, the point where its sight line crosses the near plane is found, and its
 * height above the drawn surface there decides its medium. The near plane cuts the drawn mesh
 * exactly where that height is zero, so the medium's edge is the mesh's edge by construction, at
 * any pitch and roll and with waves. The drawn surface at the lens is the swell (each component
 * faded by the finest clipmap cell exactly as the vertex stage fades it), shoaled as at the lens,
 * plus the same visual detail nodes the mesh uses (seaDetail.ts).
 *
 * Only while the lens is within LENS_BAND of a water sea (lakes and rivers keep the lens-wide
 * switch); elsewhere a uniform branch skips the work.
 */
import * as THREE from 'three/webgpu'
import { cameraNear, cameraProjectionMatrix, cameraWorldMatrix, float, floor, Fn, If, max, mix, mod, positionView, renderGroup, select, sin, smoothstep, uniform, vec2, vec4 } from 'three/tsl'
import { SEA_COMPONENTS } from './seaWaves'
import { detailHeight } from './seaDetail'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/** Metres from the sea's surface within which the lens's medium is decided per pixel. */
export const LENS_BAND = 1.2
/**
 * Least underwater look on the water side of the line while the lens is at the surface: about what
 * the lens-wide blend and the old waterline tint gave just under the surface, a light clear teal.
 * The binary users (the sea's underside and haze) pass 1.
 */
const BELOW_LINE = 0.2
/**
 * The lens-wide underwater blend (underwater.ts), 0 at the surface to 1 from about 0.45 m down:
 * how much of the water's own look the sea's underside takes regardless of how far it is seen.
 */
export const lensBlend = uniform(0).setGroup(renderGroup)
/** Metres of water a sight line crosses for the underside's haze to reach about two thirds. */
export const UNDERSIDE_REACH = 25
/**
 * How much of the underwater haze the sea's underside takes at this pixel: by the water the sight
 * line crosses between the near plane and the surface (short near the line, so the underside's own
 * ripples and reflections show; long toward the far surface), and wholly once the lens is deep.
 * The Foreman, on the first feathered frames: a flat dark stripe below the line reads as paint.
 */
export function undersideHaze(): N {
  const path = positionView.length().sub(cameraNear).max(0)
  const byPath = float(1).sub(path.div(UNDERSIDE_REACH).negate().exp())
  return mix(byPath, float(1), lensBlend)
}
/**
 * The waterline in pixels at an 800 px tall view, scaled with the view's height. The meniscus is a
 * thin crisp line on the computed curve; the medium is feathered across FEATHER_PX either side of
 * it. The computed curve and the edge the mesh draws agree to a few millimetres at the lens, which
 * is several pixels there (a pixel is a fraction of a millimetre of the near plane): feathered, that
 * reads as the soft wet film a real lens has at the waterline, never as a hard sliver of the wrong
 * medium. tools/waterline-agreement.mjs takes its bound from FEATHER_PX.
 */
export const MENISCUS_PX = 1.2
export const FEATHER_PX = 12
/** Pixels of the view's height the widths above are given for. */
export const REFERENCE_HEIGHT = 800

const swell = Array.from({ length: SEA_COMPONENTS }, () => uniform(new THREE.Vector4()).setGroup(renderGroup))
const level = uniform(0).setGroup(renderGroup)
const shoal = uniform(0).setGroup(renderGroup)
const baseCell = uniform(1).setGroup(renderGroup)
/** The game's own camera: only its frames decide the medium per pixel (not reflection captures). */
let lensCamera: THREE.Camera | null = null
let near = 0
/** 1 while the lens is near a water sea and the per-pixel medium applies, for the game camera only. */
export const lensNearSea = uniform(0).setGroup(renderGroup).onRenderUpdate((frame) => (frame.camera === lensCamera ? near : 0))
/** The camera whose frames the per-pixel medium applies to. */
export function setLensCamera(camera: THREE.Camera | null): void { lensCamera = camera }
/** True while the per-pixel medium is on for the game camera (for the CPU side). */
export const lensNearSeaNow = (): boolean => near > 0

export interface DrawnSeaFrame {
  /** Sea level, metres. */
  level: number
  /** The sea's waves now (liquidWaves for the sea body), as the sea material receives them. */
  components: readonly { kx: number; kz: number; amplitude: number; phase: number }[]
  /** Share of the waves at the lens (surface.ts shoal, for the water depth under the camera). */
  shoal: number
  /** The clipmap's finest cell, metres (CLIPMAP_LAYOUTS[level].base). */
  cell: number
  /** The lens is within LENS_BAND of a water sea's surface. */
  near: boolean
}

/**
 * The waterline check (tools/waterline-agreement.mjs): 0 normal; 1 the waterline sheet paints
 * pixels whose near-plane point is under the drawn sea solid red (the computed line is its edge);
 * 2 the sheet is hidden and the sea paints its fragments at the near plane green (where the near
 * plane cuts the mesh: the drawn edge). Set from the page through window.__miraWaterlineProbe.
 */
let probeMode = 0
export const waterlineProbe = uniform(0).setGroup(renderGroup).onRenderUpdate(() => probeMode)
if (typeof window !== 'undefined') Object.assign(window, { __miraWaterlineProbe: Object.assign((m: number) => { probeMode = m }, { featherPx: FEATHER_PX, referenceHeight: 800 }) })

/**
 * Metres of the near plane that `px` pixels of an 800 px tall view span, scaled with the view: the
 * near plane is 2 near tan(fov / 2) tall, and projection[1][1] is 1 / tan(fov / 2). The same at
 * every pixel, so the feather and the meniscus are bands of constant width on screen. (Taken from
 * the camera, not from fwidth of the height: that derivative read far too wide in frames.)
 */
export function nearPixelHeight(px: number): N {
  return cameraNear.mul(2).div((cameraProjectionMatrix as N).element(1).element(1)).mul(px / REFERENCE_HEIGHT)
}

/** Per frame, after the sea material's update: the same numbers it drew with. */
export function updateDrawnSea(f: DrawnSeaFrame): void {
  level.value = f.level
  shoal.value = f.shoal
  baseCell.value = f.cell
  near = f.near ? 1 : 0
  for (let i = 0; i < swell.length; i++) {
    const c = f.components[i]
    if (!c) { swell[i].value.set(0, 0, 0, 0); continue }
    // The vertex stage keeps a component with smoothstep(3 cells, 5 cells, its length).
    const length = (Math.PI * 2) / Math.max(1e-4, Math.hypot(c.kx, c.kz))
    const u = Math.min(1, Math.max(0, (length - 3 * f.cell) / (2 * f.cell)))
    swell[i].value.set(c.kx, c.kz, c.phase, c.amplitude * u * u * (3 - 2 * u))
  }
}

/** The sea's surface at a vertex of the clipmap's finest level: what its vertex stage computes there. */
function vertexHeight(xz: N): N {
  let h: N = float(0)
  for (const u of swell) h = h.add(u.w.mul(sin(u.x.mul(xz.x).add(u.y.mul(xz.y)).add(u.z))))
  return level.add(h.mul(shoal)).add(detailHeight(xz, baseCell))
}

/**
 * The triangle of a clipmap cell that holds local point (u, v) in [0, 1)^2, as its three corners
 * (cell-relative), for cell (ix, iz): the rule drawnSeaHeight follows below, written out for the test
 * that holds it to clipmap.ts's index buffer (tests/water/drawn-surface.test.ts).
 */
export function cellTriangle(ix: number, iz: number, u: number, v: number): [number, number][] {
  const odd = (((ix + iz) % 2) + 2) % 2 === 1
  if (odd) return u + v < 1 ? [[0, 0], [1, 0], [0, 1]] : [[1, 0], [0, 1], [1, 1]]
  return v > u ? [[0, 0], [0, 1], [1, 1]] : [[0, 0], [1, 1], [1, 0]]
}

/**
 * Height of the drawn sea at world (x, z) near the lens, metres: the mesh itself, not the smooth
 * surface it samples. At the lens a pixel spans a fraction of a millimetre of the near plane, so the
 * flat triangles between vertices (a few millimetres off the smooth sum) would move the line tens
 * of pixels. So the four corners of the finest level's cell under (x, z) are evaluated as its
 * vertices are, and interpolated over the same triangle the GPU draws: clipmap.ts splits each cell
 * along the diagonal its index parity picks (clipmapIndices), and the finest level's vertices sit at
 * whole multiples of its cell (its centre snaps to two cells), with no morph near the camera.
 */
export function drawnSeaHeight(xz: N): N {
  const g = xz.div(baseCell)
  const i: N = floor(g)
  const f: N = g.sub(i)
  const corner = (dx: number, dz: number) => vertexHeight(i.add(vec2(dx, dz)).mul(baseCell))
  const h00 = corner(0, 0), h10 = corner(1, 0), h01 = corner(0, 1), h11 = corner(1, 1)
  const u = f.x, v = f.y
  // Odd cells: diagonal from (1, 0) to (0, 1). Even cells: from (0, 0) to (1, 1).
  const odd = mod(i.x.add(i.y), 2).abs().greaterThan(0.5)
  const oddLow = h00.add(u.mul(h10.sub(h00))).add(v.mul(h01.sub(h00)))
  const oddHigh = h11.add(float(1).sub(u).mul(h01.sub(h11))).add(float(1).sub(v).mul(h10.sub(h11)))
  const evenUpper = h00.add(u.mul(h11.sub(h01))).add(v.mul(h01.sub(h00)))
  const evenLower = h00.add(u.mul(h10.sub(h00))).add(v.mul(h11.sub(h10)))
  return select(odd, select(u.add(v).lessThan(1), oddLow, oddHigh), select(v.greaterThan(u), evenUpper, evenLower))
}

/**
 * Where this pixel's sight line crosses the near plane, in world space. From the fragment's own
 * view-space position (bent by the planet's curve as drawn), so it is the ray the pixel shows.
 */
export function nearPlanePoint(): N {
  const v = positionView
  const atNear = v.xyz.mul(cameraNear.div(v.z.negate().max(1e-5)))
  return cameraWorldMatrix.mul(vec4(atNear, 1)).xyz
}

/**
 * Height of this pixel's near-plane point above the drawn sea, metres: negative where the lens
 * looks out from under the water. Only meaningful while lensNearSea is 1.
 */
export function heightAtLens(): N {
  const p = nearPlanePoint()
  return p.y.sub(drawnSeaHeight(p.xz))
}

/**
 * The medium this pixel is seen from: `wholeLens` (the lens-wide 0..1 blend, as before) away from
 * the sea's surface, and per pixel while the lens is near it: 1 below the drawn surface at the near
 * plane, 0 above, over EDGE metres.
 */
export function mediumHere(wholeLens: N, floor: number = BELOW_LINE): N {
  return Fn(() => {
    const m = float(wholeLens).toVar()
    If(lensNearSea.greaterThan(0.5), () => {
      // Below the line the look is the lens-wide blend, as it always was (it deepens over the
      // first 0.45 m: just under the surface the water is light and clear), never less than
      // `floor`, so the water side of the line is always water. Above the line it is air.
      const h = heightAtLens()
      const feather = nearPixelHeight(FEATHER_PX)
      m.assign(smoothstep(feather, feather.negate(), h).mul(max(float(wholeLens), float(floor))))
    })
    return m
  })()
}

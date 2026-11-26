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
import { cameraNear, cameraWorldMatrix, float, Fn, If, mix, positionView, renderGroup, sin, smoothstep, uniform, vec4 } from 'three/tsl'
import { SEA_COMPONENTS } from './seaWaves'
import { detailHeight } from './seaDetail'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/** Metres from the sea's surface within which the lens's medium is decided per pixel. */
export const LENS_BAND = 1.2
/** Half width of the edge between the media, metres of height at the near plane. */
const EDGE = 0.002

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
if (typeof window !== 'undefined') Object.assign(window, { __miraWaterlineProbe: (m: number) => { probeMode = m } })

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

/** Height of the drawn sea at world (x, z) near the lens, metres. */
export function drawnSeaHeight(xz: N): N {
  let h: N = float(0)
  for (const u of swell) h = h.add(u.w.mul(sin(u.x.mul(xz.x).add(u.y.mul(xz.y)).add(u.z))))
  return level.add(h.mul(shoal)).add(detailHeight(xz, baseCell))
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
export function mediumHere(wholeLens: N): N {
  return Fn(() => {
    const m = float(wholeLens).toVar()
    If(lensNearSea.greaterThan(0.5), () => {
      m.assign(smoothstep(EDGE, -EDGE, heightAtLens()))
    })
    return m
  })()
}

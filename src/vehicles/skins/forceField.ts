/**
 * Force field shading shared by anything a vehicle projects: wings, canopies, shields.
 *
 * A field is light with no surface. This builds the parts every field has in common, as TSL
 * nodes a material adds to its own look:
 *
 * - `grazing`: off-angle opacity. A field seen face on is nearly clear and thickens toward
 *   edge on, as the canopy's rim does.
 * - `lattice`: the canopy's hexagonal lattice, projected on whichever axis the surface faces.
 * - `contact`: a glow where the field meets something solid (the ground, another vehicle, its
 *   own hull), from the depth the frame already holds. It costs one copy of the depth buffer
 *   per frame however many fields use it, and is left out below graphics tier 2.
 * - `absorb`: what the field does with a blow. `hit()` starts a flash at a point and a ring
 *   that runs out from it across the field; the lattice lights as the ring passes. Up to
 *   ABSORB_SLOTS at once, oldest replaced first.
 *
 * Everything is generated; there are no textures. See PATTERN.md rule 2.
 */
import * as T from 'three/webgpu'
import {
  abs, cameraFar, cameraNear, clamp, dot, exp, float, fwidth, length, normalLocal, normalView, perspectiveDepthToViewZ,
  positionLocal, positionView, positionViewDirection, renderGroup, smoothstep, uniform, uniformArray,
} from 'three/tsl'
import { GatedViewportDepthTexture, midPassCopyNode } from '../../core/midPassCopy'
import type Node from 'three/src/nodes/core/Node.js'
import { hexCell } from './showroom'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/** Impacts a field shows at once. */
export const ABSORB_SLOTS = 4
/** How fast an absorbed blow's ring runs across the field (m/s), and how wide it is (m). */
const RING_SPEED = 7
const RING_WIDTH = .28
/** Seconds for the ring and for the flash at the point of impact to fade to about a third. */
const RING_FADE = .45
const FLASH_FADE = .14
/** Reach of that flash (m). */
const FLASH_REACH = 1.1
/** Depth (m) behind the field over which the contact glow fades out. */
const CONTACT_DEPTH = .3

const clockStart = performance.now()
/** The fields' clock, in seconds. `hit()` stamps impacts with it and the shader reads it. */
export const fieldNow = (): number => (performance.now() - clockStart) / 1000
const clock = uniform(0).setGroup(renderGroup).onRenderUpdate(fieldNow)

export interface ForceFieldOptions {
  /** Size of one lattice cell in metres; omit for no lattice. */
  cell?: number
  /** Glow where the field meets solid things. Reads the frame's depth: tier 2 and up. */
  contact?: boolean
}

export interface ForceField {
  /** 0 face on to 1 edge on. */
  readonly grazing: Node<'float'>
  /** 0 to 1 on the lattice lines; 0 without a lattice. */
  readonly lattice: Node<'float'>
  /** 0 to 1, strongest where the field touches something solid; 0 without `contact`. */
  readonly contact: Node<'float'>
  /** Light from absorbed blows, 0 with none: about 1 on a fresh ring, more at the flash. */
  readonly absorb: Node<'float'>
  /**
   * The field takes a blow at `point` (in the frame of the mesh that wears the material),
   * `strength` about 0.2 for a knock to 1 for a hard hit.
   */
  hit(point: T.Vector3, strength: number): void
}

export function forceField(options: ForceFieldOptions = {}): ForceField {
  const grazing: N = float(1).sub(clamp(abs(dot(normalView, positionViewDirection)), 0, 1))

  let lattice: N = float(0)
  if (options.cell) {
    const n = abs(normalLocal), w4 = n.mul(n).mul(n).mul(n), w = w4.div(w4.x.add(w4.y).add(w4.z))
    const p = positionLocal.div(options.cell)
    const edge: N = hexCell(p.zy).x.mul(w.x).add(hexCell(p.xz).x.mul(w.y)).add(hexCell(p.xy).x.mul(w.z))
    // Fade the lines out before they are finer than a pixel, so the field does not shimmer.
    const footprint = length(fwidth(positionLocal)).div(options.cell)
    lattice = float(1).sub(smoothstep(0, .07, edge)).mul(smoothstep(.7, .3, footprint))
  }

  let contact: N = float(0)
  if (options.contact) {
    // Distance along the view from this fragment to whatever solid lies behind it. The depth is
    // a copy taken in the middle of the scene pass: not made where that is not yet proven (phones,
    // tablets, Safari: core/midPassCopy.ts), and the glow is zeroed there, in the same graph.
    const behind = perspectiveDepthToViewZ(new GatedViewportDepthTexture(), cameraNear, cameraFar).negate().sub(positionView.z.negate())
    const near: N = float(1).sub(smoothstep(0, CONTACT_DEPTH, behind))
    // Nothing in front of the field counts (that part of it is hidden anyway).
    contact = near.mul(near).mul(smoothstep(-.05, 0, behind)).mul(midPassCopyNode)
  }

  // Each impact: xyz the point, w when it happened; strength alongside. Far past, so idle.
  const impacts = Array.from({ length: ABSORB_SLOTS }, () => new T.Vector4(0, 0, 0, -1e3))
  const strengths = Array.from({ length: ABSORB_SLOTS }, () => 0)
  const impactNodes = uniformArray(impacts), strengthNodes = uniformArray(strengths)
  let absorb: N = float(0)
  for (let i = 0; i < ABSORB_SLOTS; i++) {
    const impact: N = impactNodes.element(i), age: N = clock.sub(impact.w)
    const reach: N = length(positionLocal.sub(impact.xyz))
    const ring = exp(reach.sub(age.mul(RING_SPEED)).div(RING_WIDTH).pow(2).negate()).mul(exp(age.div(RING_FADE).negate()))
    const flash = exp(reach.div(FLASH_REACH).pow(2).negate()).mul(exp(age.div(FLASH_FADE).negate())).mul(1.8)
    const strength: N = strengthNodes.element(i)
    absorb = absorb.add(ring.add(flash).mul(strength))
  }

  let next = 0
  return {
    grazing, lattice, contact, absorb,
    hit(point, strength) {
      impacts[next].set(point.x, point.y, point.z, fieldNow())
      strengths[next] = Math.min(1.5, Math.max(0, strength))
      next = (next + 1) % ABSORB_SLOTS
    },
  }
}

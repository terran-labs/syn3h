/**
 * Blended tank bodies: one continuous sculpted surface for the whole vehicle, in place of
 * separate lofts set against each other.
 *
 * The body is a plan outline with an upper and a lower skin hung from its rim:
 *   - `W(z)` is the outer half-width. It runs out to the tread pivots, so the body itself
 *     carries the running gear and no pylon is added.
 *   - `G(z)` opens a gap along the centreline where it is above zero: a forked nose, a split
 *     tail. Each side then has an inner edge as round as its outer one, and as the gap closes
 *     the two sides merge through a valley, not a join.
 *   - `T` and `B` are the thickness above and below the rim. The kit adds a swell to `T`
 *     that rises to the cockpit rim, so the skin sweeps up into the bubble.
 * Headlamps and tail lamps are patches of that same skin, cut along their outlines and given
 * a lamp surface inside a bright surround. Nothing is mounted on the body.
 */
import * as T from 'three/webgpu'
import { AXLE_SPACING, Batch, bosses, v, type ExpeditionSpec, type Surface, type TankHull } from './expeditionKit'
import { cockpit, cockpitOutline, normals, skin, type Bubble, type Outline, type Patch } from './sleekKit'

/** A lamp set into the upper skin on the right side, mirrored to the left: an ellipse in plan. */
export interface SkinLamp { kind: 'head' | 'tail'; x: number; z: number; long: number; wide: number; /** Degrees the long axis is turned from the vehicle's length, nose outward. */ turn?: number }
export interface BlendSpec {
  z0: number; z1: number
  W(z: number): number
  G?(z: number): number
  /** Height of the rim. */
  C(z: number): number
  T(x: number, z: number): number
  B(x: number, z: number): number
  /** Roundness of the edges: 2 is an ellipse, higher is fuller. */
  rim?: number
  /** `swell` is how far the skin rises to meet the cockpit rim. */
  bubble: Bubble & { swell: number }
  lamps: SkinLamp[]
  /** Accent panels cut into the upper skin, as plan outlines (anticlockwise), mirrored when `mirror`. */
  panels?: { outline: Outline; mirror?: boolean }[]
  fender: ExpeditionSpec['fender']
  trackWidth?: number
}

const PIVOT_X = 1.26
export const sm = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
export const bell = (u: number) => Math.exp(-u * u)
/** 1 between a and b, easing to 0 over `soft` outside them. */
export const span = (z: number, a: number, b: number, soft: number) => sm(z, a - soft, a) * (1 - sm(z, b, b + soft))

const ellipse = (x: number, z: number, long: number, wide: number, turn: number, grow: number, count = 16): Outline => {
  const c = Math.cos(turn * Math.PI / 180), s = Math.sin(turn * Math.PI / 180)
  // Long axis along Z, turned so its forward end swings outward.
  return Array.from({ length: count }, (_, k) => { const a = k / count * Math.PI * 2, px = Math.cos(a) * (wide + grow), pz = Math.sin(a) * (long + grow); return [x + px * c - pz * s, z + px * s + pz * c] })
}
const mirrored = (o: Outline): Outline => o.map(([x, z]) => [-x, z] as [number, number]).reverse()

export function blendHull(spec: BlendSpec): TankHull {
  const p = spec.rim ?? 2.6, length = spec.z1 - spec.z0, bubble = spec.bubble
  // Both skins close at the nose and tail whatever the thickness fields say.
  const ends = (z: number) => Math.max(0, 1 - Math.abs(2 * (z - spec.z0) / length - 1) ** 6) ** (1 / 6)
  const gap = (z: number) => Math.max(0, Math.min(spec.G?.(z) ?? 0, spec.W(z) - .02))
  // A slender prow or tail is shallower than the full body, so it ends in a point and not a blade.
  const slim = (w: number, g: number) => Math.min(1, (w - g) / .5) ** .6
  // The skin rises toward the cockpit rim and levels off under the bubble.
  const swell = (x: number, z: number) => bubble.swell * (1 - sm(Math.hypot(x / bubble.a, (z - bubble.z) / bubble.b), .95, 2.3))
  const round = (s: number, g: number) => {
    const outer = Math.max(0, 1 - s ** p) ** (1 / p), inner = Math.max(0, 1 - (1 - s) ** p) ** (1 / p)
    return outer * (1 + (inner - 1) * sm(g, 0, .14))
  }
  /** Height of the upper skin over a point in plan. */
  const top = (x: number, z: number) => {
    const w = Math.max(.01, spec.W(z)), g = gap(z), s = Math.min(1, Math.max(0, (Math.abs(x) - g) / Math.max(.01, w - g)))
    return spec.C(z) + (spec.T(x, z) + swell(x, z)) * round(s, g) * ends(z) * slim(w, g)
  }
  const patches = (level: 0 | 1): Patch[] => {
    const out: Patch[] = level ? [] : [{ outline: cockpitOutline(bubble), surface: null }]
    for (const l of spec.lamps) for (const mirror of [false, true]) {
      const shape = (grow: number) => { const o = ellipse(l.x, l.z, l.long, l.wide, l.turn ?? 0, grow, level ? 8 : 16); return mirror ? mirrored(o) : o }
      out.push({ outline: shape(0), surface: l.kind })
      if (!level) out.push({ outline: shape(.035), surface: 'chrome' })
    }
    for (const panel of spec.panels ?? []) { out.push({ outline: panel.outline, surface: 'accent' }); if (panel.mirror) out.push({ outline: mirrored(panel.outline), surface: 'accent' }) }
    return out
  }
  const build = (batch: Batch, level: 0 | 1 | 2): [number, number, number] => {
    const rows = level === 0 ? 30 : level === 1 ? 18 : 9, cols = level === 0 ? 9 : level === 1 ? 5 : 3
    const cut = level === 2 ? [] : patches(level)
    for (const sx of [1, -1]) {
      const up: T.Vector3[][] = [], under: T.Vector3[][] = [], open: boolean[] = []
      for (let i = 0; i <= rows; i++) {
        // Closer rings where the nose and tail turn in.
        const z = spec.z0 + length * (.5 - .5 * Math.cos(Math.PI * i / rows)), w = Math.max(.012, spec.W(z)), g = gap(z), c = spec.C(z), e = ends(z)
        const a: T.Vector3[] = [], b: T.Vector3[] = []
        for (let j = 0; j <= cols; j++) {
          // Closer columns toward both edges, where the skin turns under.
          const s = .5 - .5 * Math.cos(Math.PI * j / cols), x = sx * (g + s * (w - g)), r = round(s, g) * e * slim(w, g)
          a.push(v(x, c + (spec.T(x, z) + swell(x, z)) * r, z)); b.push(v(x, c - spec.B(x, z) * r, z))
        }
        up.push(a); under.push(b); open.push(g > 1e-4)
      }
      const nUp = normals(up, false, sx > 0), nUnder = normals(under, false, sx < 0)
      for (let i = 0; i <= rows; i++) {
        // The two skins meet in one rounded edge, and the two sides in one smooth crown.
        for (const j of open[i] ? [0, cols] : [cols]) { const n = nUp[i][j].clone().add(nUnder[i][j]); if (n.lengthSq() > 1e-8) { n.normalize(); nUp[i][j].copy(n); nUnder[i][j].copy(n) } }
        if (!open[i]) { nUp[i][0].setX(0).normalize(); nUnder[i][0].setX(0).normalize() }
      }
      skin(batch, up, false, sx > 0, () => 'paint', cut, nUp)
      skin(batch, under, false, sx < 0, () => level === 2 ? 'paint' : 'frame', [], nUnder)
    }
    const eye = cockpit(batch, bubble, top, level)
    // Each pivot boss starts inside the body's edge.
    if (level === 0) bosses(batch, PIVOT_X, Math.min(PIVOT_X - .1, ...[0, 1, 2].map(axle => spec.W((axle - 1) * AXLE_SPACING - .55) - .12)))
    return eye
  }
  return {
    trackWidth: spec.trackWidth ?? .93, fender: spec.fender, smoothFenders: true, powerFenders: true, pivotX: PIVOT_X,
    halfLength: Math.max(-spec.z0, spec.z1),
    headlamps: [-1, 1].flatMap(sx => spec.lamps.filter(l => l.kind === 'head').map(l => v(sx * l.x, top(l.x, l.z), l.z - l.long))),
    near: (batch, level) => build(batch, level),
    far: batch => { build(batch, 2) },
  }
}

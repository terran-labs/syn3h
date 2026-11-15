/**
 * The generated exploration tank: one longitudinal shell for nose, cabin and equipment deck,
 * and six tread pods that each swing on their own arm. Windows replace faces of the shell; no
 * second cabin is placed on its roof. This is the game model as well as the design study, built
 * to the vehicle pattern (../PATTERN.md):
 *
 * - Every surface carries a shared shading role. All opaque surfaces of one tank share a single
 *   packed material, selected per vertex, so the roles cost no extra draws.
 * - Three authored detail levels from the same numbers. Near: 7 draws (hull, canopy, left arms,
 *   right arms and one instanced pair of pods per axle). Mid: 3 draws. Far: 1 draw.
 * - Faces are single sided with outward winding. The cabin has its own inward-facing liner,
 *   floor, bulkheads, seats and dash, so the driver looks at walls and not through them.
 * - The belt lugs are the shared `track` role's relief, scrolled per instance.
 *
 * Coordinates: metres, +Y up, nose toward -Z, the ground at y = 0, three pods on each side.
 * Pods are numbered as the physics numbers its tracks: odd on the right (+X), two per axle,
 * front axle first.
 */
import * as T from 'three/webgpu'
import { attribute, float, uniform, vec3 } from 'three/tsl'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import { mergedSurfaces } from '../skins/mergeStatic'
import { TRACK_LUGS, applyShowroom, setRole, wrapTrackScroll, type Decorate } from '../skins/showroom'

export type Section = [z: number, width: number, keel: number, belt: number, roofWidth: number, roof: number]
export interface ExpeditionSpec {
  sections: Section[]
  /** First sloping windscreen bay and last occupied cabin bay, inclusive. */
  cabin: [number, number]
  fender: 'folded' | 'round' | 'deep' | 'swept' | 'short'
  ribs?: number[]
  radiator?: number[]
  portholes?: boolean
  stripe?: 'centre' | 'shoulders' | 'belt'
  trackWidth?: number
  pressureShell?: boolean
  /** Soften the hull: how far each corner is rounded back along its edges, 0 to about 0.4. */
  round?: number
}

/** 0 near (the player's own tank and others within 30 m), 1 mid, 2 far silhouette. */
export type Level = 0 | 1 | 2

/** Opaque surfaces, in the order the packed material numbers them. */
export const SOLIDS = ['paint', 'accent', 'chrome', 'frame', 'trim', 'rubber', 'track', 'head', 'tail'] as const
export type Solid = typeof SOLIDS[number]
export type Surface = Solid | 'canopy'

export type Quad = [T.Vector3, T.Vector3, T.Vector3, T.Vector3]
type Sheet = (u: number, t: number) => T.Vector3
export const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
export const UP = v(0, 1, 0), DOWN = v(0, -1, 0), FORE = v(0, 0, -1), AFT = v(0, 0, 1)
export const side = (s: number) => v(s, 0, 0)

/** Tail lamp emission: running, and under braking. */
const TAIL = { idle: .6, brake: 2.2 }

// ---------------------------------------------------------------------------------------------
// Geometry collector. Writes straight into flat arrays: a tank is several thousand faces, and
// one small BufferGeometry per face made building it slow enough to feel at spawn.
// ---------------------------------------------------------------------------------------------

const ab = v(0, 0, 0), ac = v(0, 0, 0), nn = v(0, 0, 0)

export class Batch {
  private p: number[] = []; private n: number[] = []; private uv: number[] = []; private id: number[] = []
  private cp: number[] = []; private cn: number[] = []

  /** One flat triangle. With `out`, it is wound to face that way whatever order it was given in. */
  tri(surface: Surface, a: T.Vector3, b: T.Vector3, c: T.Vector3, out?: T.Vector3, uvs?: number[]) {
    nn.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
    if (nn.lengthSq() < 1e-14) return
    nn.normalize()
    if (out && nn.dot(out) < 0) { const s = b; b = c; c = s; nn.negate(); if (uvs) uvs = [uvs[0], uvs[1], uvs[4], uvs[5], uvs[2], uvs[3]] }
    if (surface === 'canopy') {
      this.cp.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      for (let i = 0; i < 3; i++) this.cn.push(nn.x, nn.y, nn.z)
      return
    }
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    const k = SOLIDS.indexOf(surface)
    for (let i = 0; i < 3; i++) { this.n.push(nn.x, nn.y, nn.z); this.id.push(k) }
    if (uvs) this.uv.push(...uvs); else this.uv.push(0, 0, 0, 0, 0, 0)
  }
  /** One triangle with a normal at each corner, for lofted surfaces. Wound as given. */
  smooth(surface: Surface, a: T.Vector3, b: T.Vector3, c: T.Vector3, na: T.Vector3, nb: T.Vector3, nc: T.Vector3) {
    if (nn.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).lengthSq() < 1e-14) return
    if (surface === 'canopy') { this.cp.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); this.cn.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z); return }
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); this.n.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z)
    const k = SOLIDS.indexOf(surface); this.id.push(k, k, k); this.uv.push(0, 0, 0, 0, 0, 0)
  }
  /** A quad as two triangles. `uvs` is one [u, v] pair per corner, for the track belt. */
  quad(surface: Surface, q: Quad, out?: T.Vector3, uvs?: number[]) {
    this.tri(surface, q[0], q[1], q[2], out, uvs && [uvs[0], uvs[1], uvs[2], uvs[3], uvs[4], uvs[5]])
    this.tri(surface, q[0], q[2], q[3], out, uvs && [uvs[0], uvs[1], uvs[4], uvs[5], uvs[6], uvs[7]])
  }
  /** A three.js primitive, keeping its smooth normals. Disposes the geometry. */
  geometry(surface: Solid, source: T.BufferGeometry) {
    const g = source.index ? source.toNonIndexed() : source
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), k = SOLIDS.indexOf(surface)
    for (let i = 0; i < p.count; i++) {
      this.p.push(p.getX(i), p.getY(i), p.getZ(i)); this.n.push(n.getX(i), n.getY(i), n.getZ(i))
      this.uv.push(0, 0); this.id.push(k)
    }
    if (g !== source) g.dispose()
    source.dispose()
  }
  box(surface: Solid, size: number[], at: number[]) {
    this.geometry(surface, new T.BoxGeometry(size[0], size[1], size[2]).translate(at[0], at[1], at[2]))
  }
  rod(surface: Solid, a: T.Vector3, b: T.Vector3, radius: number, segments = 10, open = false) {
    const d = b.clone().sub(a), g = new T.CylinderGeometry(radius, radius, d.length(), segments, 1, open)
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(UP, d.normalize()))
    g.translate(...a.clone().add(b).multiplyScalar(.5).toArray()); this.geometry(surface, g)
  }
  /** A flat disc or annulus facing along X or Z. */
  disc(surface: Solid, centre: T.Vector3, axis: 'x' | 'z', facing: number, inner: number, outer: number, segments: number) {
    const out = axis === 'x' ? side(facing) : v(0, 0, facing)
    const at = (angle: number, r: number) => axis === 'x'
      ? v(centre.x, centre.y + Math.sin(angle) * r, centre.z + Math.cos(angle) * r)
      : v(centre.x + Math.cos(angle) * r, centre.y + Math.sin(angle) * r, centre.z)
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2
      if (inner > 0) this.quad(surface, [at(a, inner), at(a, outer), at(b, outer), at(b, inner)], out)
      else this.tri(surface, centre, at(a, outer), at(b, outer), out)
    }
  }
  /** Blend the normals of faces that meet at less than `angle`, for the rounded shells and fenders. */
  soften(angle = 1.05) {
    if (!this.p.length) return
    const g = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(this.p, 3)).setAttribute('normal', new T.Float32BufferAttribute(this.n, 3))
    const smooth = toCreasedNormals(g, angle)
    this.n = Array.from(smooth.getAttribute('normal').array)
    if (smooth !== g) smooth.dispose()
    g.dispose()
  }
  append(other: Batch) {
    for (const key of ['p', 'n', 'uv', 'id', 'cp', 'cn'] as const) { const to = this[key], from = other[key]; for (let i = 0; i < from.length; i++) to.push(from[i]) }
  }
  solid(): T.BufferGeometry {
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3))
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2)); g.setAttribute('surfaceId', new T.Float32BufferAttribute(this.id, 1))
    return g
  }
  canopy(): T.BufferGeometry | null {
    if (!this.cp.length) return null
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(this.cp, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.cn, 3))
    return g
  }
}

// ---------------------------------------------------------------------------------------------
// Hull
// ---------------------------------------------------------------------------------------------

function ring(s: Section, pressure = false) {
  const [z, w, k, b, rw, roof] = s
  if (pressure) {
    const centre = (roof + k) * .5, height = (roof - k) * .5
    return [72, 36, 0, -36, -72, -108, -144, -180, -216, -252].map(degrees => {
      const a = degrees * Math.PI / 180
      return v(Math.cos(a) * w, centre + Math.sin(a) * height, z)
    })
  }
  return [[rw * .82, roof], [rw, roof - .14], [w, b], [w, k + .3], [w * .74, k],
    [-w * .74, k], [-w, k + .3], [-w, b], [-rw, roof - .14], [-rw * .82, roof]].map(([x, y]) => v(x, y, z))
}

function patch(batch: Batch, surface: Surface, sheet: Sheet, out: T.Vector3, u0 = 0, u1 = 1, t0 = 0, t1 = 1, steps = 1) {
  for (let i = 0; i < steps; i++) {
    const a = t0 + (t1 - t0) * i / steps, b = t0 + (t1 - t0) * (i + 1) / steps
    batch.quad(surface, [sheet(u0, a), sheet(u1, a), sheet(u1, b), sheet(u0, b)], out)
  }
}

interface Opening { round: boolean; steps: number; segments: number; border: Surface; rim: Surface | null; fill: Surface | null; /** The pane fills its panel but for a slim border: for softened hulls, whose corners already frame it. */ tight?: boolean }

/** A framed opening in one hull panel: a border in the panel's own surface, a rim, then the pane. */
function opening(batch: Batch, sheet: Sheet, out: T.Vector3, o: Opening) {
  if (o.round) {
    // No rectangular plate behind a circular port: both the opening and its metal rim are round.
    const point = (angle: number, radius: number) => sheet(.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius)
    const edge = (angle: number) => {
      const x = Math.cos(angle), y = Math.sin(angle), k = .5 / Math.max(Math.abs(x), Math.abs(y))
      return sheet(.5 + x * k, .5 + y * k)
    }
    const hole = o.rim ? .36 : .33, centre = sheet(.5, .5)
    for (let i = 0; i < o.segments; i++) {
      const a = i * Math.PI * 2 / o.segments, b = (i + 1) * Math.PI * 2 / o.segments
      batch.quad(o.border, [edge(a), edge(b), point(b, hole), point(a, hole)], out)
      if (o.rim) batch.quad(o.rim, [point(a, .36), point(b, .36), point(b, .33), point(a, .33)], out)
      if (o.fill) batch.tri(o.fill, centre, point(a, .33), point(b, .33), out)
    }
    return
  }
  const frame = (surface: Surface, u0: number, u1: number, t0: number, t1: number, u: number, t: number) => {
    patch(batch, surface, sheet, out, u0, u, t0, t1, o.steps)
    patch(batch, surface, sheet, out, 1 - u, u1, t0, t1, o.steps)
    patch(batch, surface, sheet, out, u, 1 - u, t0, t)
    patch(batch, surface, sheet, out, u, 1 - u, 1 - t, t1)
  }
  // Border, then rim, then pane: [border u, border t, pane u, pane t].
  const [bu, bt, pu, pt] = o.tight ? [.025, .035, .055, .07] : [.09, .13, .115, .16]
  if (o.rim) { frame(o.border, 0, 1, 0, 1, bu, bt); frame(o.rim, bu, 1 - bu, bt, 1 - bt, pu, pt) }
  else frame(o.border, 0, 1, 0, 1, pu, pt)
  if (o.fill) patch(batch, o.fill, sheet, out, pu, 1 - pu, pt, 1 - pt, o.steps)
}

function cap(batch: Batch, surface: Surface, points: T.Vector3[], out: T.Vector3) {
  const centre = points.reduce((a, p) => a.add(p), v(0, 0, 0)).multiplyScalar(1 / points.length)
  for (let i = 0; i < points.length; i++) batch.tri(surface, centre, points[i], points[(i + 1) % points.length], out)
}

/** Lamps sit on the end bulkheads, with a wear shoe joined to the keel below them. */
function lamps(batch: Batch, s: Section, rear: boolean, level: Level) {
  const [z, w, k, belt] = s, y = (k + belt) * .5 + .12
  for (const sx of [-1, 1]) {
    if (rear) {
      if (level) { batch.quad('tail', [v(sx * w * .24, y - .08, z + .004), v(sx * w * .72, y - .08, z + .004), v(sx * w * .72, y + .08, z + .004), v(sx * w * .24, y + .08, z + .004)], AFT); continue }
      batch.box('frame', [w * .62, .24, .08], [sx * w * .48, y, z + .02])
      for (const dy of [-.055, .055]) batch.box('tail', [w * .48, .045, .025], [sx * w * .48, y + dy, z + .065])
    } else for (const x of [.23, .65, 1.07]) {
      const cx = sx * x * Math.min(1, w / 1.3), r = Math.min(.18, w * .14)
      headlamp(batch, cx, y, z, r, level)
    }
  }
  batch.box('frame', [w * 1.52, .22, .22], [0, k + .1, z + (rear ? -.025 : .025)])
}

/**
 * One headlamp facing forward from a wall at `z`: housing, bezel and lens as three rings and a
 * disc, with no hidden end caps. `depth` is how far the housing stands out of the wall.
 */
export function headlamp(batch: Batch, cx: number, y: number, z: number, r: number, level: 0 | 1 | 2, depth = .09) {
  if (level) { batch.disc('head', v(cx, y, z - depth - .004), 'z', -1, 0, r * 1.05, 8); return }
  batch.rod('frame', v(cx, y, z), v(cx, y, z - depth), r * 1.24, 10, true)
  batch.disc('frame', v(cx, y, z - depth), 'z', -1, r * 1.09, r * 1.24, 10)
  batch.rod('chrome', v(cx, y, z - depth), v(cx, y, z - depth - .02), r * 1.09, 10, true)
  batch.disc('chrome', v(cx, y, z - depth - .02), 'z', -1, r * .85, r * 1.09, 10)
  batch.disc('head', v(cx, y, z - depth - .02), 'z', -1, 0, r * .85, 10)
}

/** One fixed boss per tread on the hull: the only attachment. `inner` is where it leaves the hull. */
export function bosses(batch: Batch, pivotX: number, inner = pivotX - .27) {
  for (const sx of [-1, 1]) for (let axle = 0; axle < 3; axle++) {
    const p = pivot(sx, axle, pivotX)
    batch.rod('frame', v(sx * inner, p.y, p.z), v(sx * (pivotX + .14), p.y, p.z), .19, 10)
    batch.disc('chrome', v(sx * (pivotX + .142), p.y, p.z), 'x', sx, 0, .14, 10)
  }
}

/** The far silhouette's hull: plain panels, dark where the windows are. */
function farHull(batch: Batch, spec: ExpeditionSpec) {
  const rings = spec.sections.map(s => ring(s, spec.pressureShell)), [front, last] = spec.cabin
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < 10; j++) {
    const q: Quad = [rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % 10], rings[i][(j + 1) % 10]]
    const glazed = i === front && [0, 8, 9].includes(j) || i > front && i <= last && [1, 7].includes(j)
    batch.quad(glazed ? 'trim' : j >= 3 && j <= 5 ? 'frame' : 'paint', q, outward(q, spec.sections[i], spec.sections[i + 1]))
  }
  cap(batch, 'paint', rings[0], FORE); cap(batch, 'paint', rings[rings.length - 1], AFT)
}

/** Away from the hull's long axis at a panel's centre. */
function outward(q: Quad, a: Section, b: Section) {
  const c = q[0].clone().add(q[1]).add(q[2]).add(q[3]).multiplyScalar(.25)
  return v(c.x, c.y - (a[2] + a[5] + b[2] + b[5]) * .25, 0)
}

/** A ring with each corner turned into a short arc: three points per corner, the flats between them. */
function rounded(points: T.Vector3[], amount: number) {
  const n = points.length, out: T.Vector3[] = []
  for (let j = 0; j < n; j++) {
    const p = points[j], a = p.clone().lerp(points[(j + n - 1) % n], amount), b = p.clone().lerp(points[(j + 1) % n], amount)
    out.push(a, a.clone().add(b).addScaledVector(p, 2).multiplyScalar(.25), b)
  }
  return out
}

function hull(batch: Batch, spec: ExpeditionSpec, level: 0 | 1): [number, number, number] {
  const [front, last] = spec.cabin, sections = spec.sections
  const steps = spec.pressureShell && !level ? 3 : 1
  // Softened hulls round every corner, round the section and along the length, and keep the
  // panels between as flats: windows, grilles and stripes sit on those exactly as before.
  const soft = spec.round && !level && !spec.pressureShell ? spec.round : 0
  const blend = (a: Section, b: Section, t: number) => a.map((x, k) => x + (b[k] - x) * t) as Section
  const outline = (s: Section) => soft ? rounded(ring(s), soft) : ring(s, spec.pressureShell)
  /** The section where original section `k` was: itself, or the middle of its rounded corner. */
  const at = (k: number): Section => {
    if (!soft || k === 0 || k === sections.length - 1) return sections[k]
    const a = blend(sections[k], sections[k - 1], soft * .7), b = blend(sections[k], sections[k + 1], soft * .7)
    return a.map((x, f) => (x + 2 * sections[k][f] + b[f]) / 4) as Section
  }
  // Rows of the skin: `bay` is the original bay the strip after this row belongs to, -1 for a corner.
  const rows: { section: Section; bay: number }[] = []
  sections.forEach((sec, k) => {
    if (!soft || k === 0 || k === sections.length - 1) { rows.push({ section: sec, bay: k }); return }
    rows.push({ section: blend(sec, sections[k - 1], soft * .7), bay: -1 }, { section: at(k), bay: -1 }, { section: blend(sec, sections[k + 1], soft * .7), bay: k })
  })
  const rings = rows.map(r => outline(r.section)), count = rings[0].length
  // Columns: the panel a column is, or -1 - vertex for a corner column.
  const columns = Array.from({ length: count }, (_, c) => !soft ? c : c % 3 === 2 ? (c - 2) / 3 : -1 - Math.floor(c / 3))
  const cabinZ = [sections[front][0], sections[last + 1][0]]
  // The cabin's inner face is collected apart so its normals are not blended with the outer skin.
  const shell = new Batch(), liner = new Batch()
  for (let r = 0; r < rings.length - 1; r++) for (let c = 0; c < count; c++) {
    const i = rows[r].bay, j = columns[c], feature = i >= 0 && j >= 0
    const q: Quad = [rings[r][c], rings[r + 1][c], rings[r + 1][(c + 1) % count], rings[r][(c + 1) % count]]
    const sheet: Sheet = spec.pressureShell ? (u, t) => {
      const a = spec.sections[i], b = spec.sections[i + 1], s = a.map((x, k) => x + (b[k] - x) * u)
      const angle = (72 - (j + t) * 36) * Math.PI / 180
      return v(Math.cos(angle) * s[1], (s[5] + s[2]) * .5 + Math.sin(angle) * (s[5] - s[2]) * .5, s[0])
    } : (u, t) => q[0].clone().lerp(q[1], u).lerp(q[3].clone().lerp(q[2], u), t)
    const out = outward(q, rows[r].section, rows[r + 1].section), inward = out.clone().negate()
    const middle = (rows[r].section[0] + rows[r + 1].section[0]) / 2
    const occupied = i >= 0 ? i >= front && i <= last : middle > cabinZ[0] && middle < cabinZ[1]
    const windscreen = feature && i === front && [0, 8, 9].includes(j)
    const sideWindow = feature && i > front && i <= last && [1, 7].includes(j)
    if (windscreen || sideWindow) {
      const round = !!spec.portholes && sideWindow, segments = level ? 10 : 24
      opening(shell, sheet, out, { round, steps, segments, border: 'paint', rim: level ? null : 'chrome', fill: 'canopy', tight: !!soft })
      opening(liner, sheet, inward, { round, steps, segments, border: 'trim', rim: null, fill: null, tight: !!soft })
      continue
    }
    if (occupied) patch(liner, 'trim', sheet, inward, 0, 1, 0, 1, steps)
    if (feature && spec.radiator?.includes(i) && [1, 7, 9].includes(j)) {
      // Replace the panel with a framed recess. A decal laid on a curved or twisted quad
      // sinks into it in places and flickers in others.
      opening(shell, sheet, out, { round: false, steps, segments: 0, border: 'paint', rim: level ? null : 'chrome', fill: 'frame' })
      if (level) continue
      const raised: Sheet = (u, t) => {
        const p = sheet(u, t), du = sheet(u + .001, t).sub(p), dt = sheet(u, t + .001).sub(p), normal = du.cross(dt).normalize()
        return p.addScaledVector(normal, normal.dot(out) < 0 ? -.025 : .025)
      }
      for (let k = 1; k < 7; k++) for (let s = 0; s < steps; s++) {
        const u = .115 + .77 * k / 7
        shell.rod('chrome', raised(u, .16 + .68 * s / steps), raised(u, .16 + .68 * (s + 1) / steps), .018, 5, true)
      }
      continue
    }
    // A corner column is dark only between two dark panels, under the hull.
    const under = j >= 0 ? j >= 3 && j <= 5 : j === -5 || j === -6
    const stripe = spec.stripe === 'shoulders' && [0, 8].includes(j) || spec.stripe === 'belt' && [2, 6].includes(j)
    if (spec.stripe === 'centre' && j === 9 && i !== front) {
      // The centre stripe is cut into the roof panel, not laid over it.
      patch(shell, 'paint', sheet, out, 0, 1, 0, .43, steps); patch(shell, 'accent', sheet, out, 0, 1, .43, .57)
      patch(shell, 'paint', sheet, out, 0, 1, .57, 1, steps)
    } else patch(shell, under ? 'frame' : stripe ? 'accent' : 'paint', sheet, out, 0, 1, 0, 1, steps)
  }
  const endRing = (s: Section) => spec.pressureShell && !level ? Array.from({ length: 30 }, (_, i) => {
    const a = (72 - i * 12) * Math.PI / 180
    return v(Math.cos(a) * s[1], (s[5] + s[2]) * .5 + Math.sin(a) * (s[5] - s[2]) * .5, s[0])
  }) : outline(s)
  if (spec.pressureShell) { shell.soften(); liner.soften() }
  if (soft) { shell.soften(.95); liner.soften(.95) }
  batch.append(shell); batch.append(liner)
  cap(batch, 'paint', endRing(spec.sections[0]), FORE); cap(batch, 'paint', endRing(spec.sections.at(-1)!), AFT)
  lamps(batch, spec.sections[0], false, level); lamps(batch, spec.sections.at(-1)!, true, level)
  // Structural bands follow the shell cross-section rather than floating above it.
  for (const i of spec.ribs ?? []) {
    const a = endRing(at(i)), middle = (at(i)[2] + at(i)[5]) * .5
    const lift = (p: T.Vector3, dz: number) => v(p.x + Math.sign(p.x) * .028, p.y + Math.sign(p.y - middle) * .028, p.z + dz)
    for (let j = 0; j < a.length; j++) {
      const p = a[j], q = a[(j + 1) % a.length], out = v((p.x + q.x) * .5, (p.y + q.y) * .5 - middle, 0)
      batch.quad('accent', [lift(p, 0), lift(p, .095), lift(q, .095), lift(q, 0)], out)
      if (level) continue
      batch.quad('accent', [p, lift(p, 0), lift(q, 0), q], FORE)
      batch.quad('accent', [p.clone().setZ(p.z + .095), lift(p, .095), lift(q, .095), q.clone().setZ(q.z + .095)], AFT)
    }
  }
  // The cabin: a floor, a bulkhead at each end and the liner above wall it off from the hull.
  const cabinStart = spec.sections[front + 1], cabinEnd = spec.sections[last + 1]
  const eyeY = cabinStart[5] - .68, eyeZ = cabinStart[0] + .45
  const floorY = Math.min(cabinStart[2] + .32, eyeY - .9)
  const cabinLength = cabinEnd[0] - spec.sections[front][0]
  batch.box('trim', [cabinStart[1] * 1.65, .12, cabinLength], [0, floorY, (cabinEnd[0] + spec.sections[front][0]) / 2])
  cap(batch, 'trim', outline(at(front)), AFT); cap(batch, 'trim', outline(at(last + 1)), FORE)
  if (!level) {
    // Two seats and a low dashboard leave the windscreen clear.
    for (const x of [-.43, .43]) {
      batch.box('trim', [.5, .18, .55], [x, eyeY - .68, eyeZ + .12])
      batch.box('trim', [.48, .65, .12], [x, eyeY - .4, eyeZ + .41])
      batch.box('accent', [.33, .035, .09], [x, eyeY - .13, eyeZ + .335])
    }
    batch.box('trim', [cabinStart[4] * 1.5, .14, .3], [0, eyeY - .35, cabinStart[0] - .3])
    for (const x of [-.4, .4]) batch.box('accent', [.3, .025, .14], [x, eyeY - .267, cabinStart[0] - .3])
    bosses(batch, PANEL_PIVOT)
  }
  return [0, eyeY, eyeZ]
}

// ---------------------------------------------------------------------------------------------
// Running gear. Each tread hangs from one arm that swings about a transverse pivot on the hull.
// The pod turns on the arm's end, so it stays flat on the ground whatever the arm is doing.
// ---------------------------------------------------------------------------------------------

/** Longitudinal spacing of the three axles. */
export const AXLE_SPACING = 2.48
/** The arm's hull pivot, and the pod centre relative to it at rest. */
export const PIVOT_Y = 1.26
/** Distance of the round seven hulls' pivots from the centreline. */
const PANEL_PIVOT = 1.37
export const pivot = (sx: number, axle: number, pivotX: number) => v(sx * pivotX, PIVOT_Y, (axle - 1) * AXLE_SPACING - .55)
/** A pod's centre at rest. */
export const podRest = (sx: number, axle: number, pivotX: number) => v(sx * (pivotX + ARM.x), PIVOT_Y + ARM.y, (axle - 1) * AXLE_SPACING)
const ARM = { x: .74, y: -.5, z: .55 }
const ARM_REACH = Math.hypot(ARM.y, ARM.z), ARM_REST = Math.atan2(ARM.z, -ARM.y)
/** Furthest a pod can drop below and rise above its rest height, in metres. */
export const POD_TRAVEL = { down: ARM_REACH + ARM.y - .003, up: .5 }

/** A rounded triangular belt round three wheels, after the original red study. */
function beltOutline(count: number) {
  const shape = new T.Shape().moveTo(-.76, .055).lineTo(.76, .055)
    .quadraticCurveTo(1.08, .055, 1.03, .37).lineTo(.29, 1.25)
    .quadraticCurveTo(0, 1.53, -.29, 1.25).lineTo(-1.03, .37)
    .quadraticCurveTo(-1.08, .055, -.76, .055)
  return shape.getSpacedPoints(count).slice(0, -1)
}

function track(batch: Batch, width: number, level: 0 | 1) {
  const pts = beltOutline(level ? 14 : 36), n = pts.length, hw = width / 2, centre = v(0, -.15, 0)
  const outer = (i: number, x: number) => v(x, pts[i].y - .76, pts[i].x)
  const inner = (i: number, x: number) => v(x, (pts[i].y - .7) * .82 + .7 - .76, pts[i].x * .88)
  // Belt length along its outside, rounded to whole lugs so the pattern closes on itself.
  const along = [0]
  for (let i = 0; i < n; i++) along.push(along[i] + pts[i].distanceTo(pts[(i + 1) % n]))
  const fit = Math.max(1, Math.round(along[n] / TRACK_LUGS.pitch)) * TRACK_LUGS.pitch / along[n]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = along[i] * fit, b = along[i + 1] * fit
    const mid = outer(i, 0).add(outer(j, 0)).multiplyScalar(.5)
    batch.quad('track', [outer(i, -hw), outer(j, -hw), outer(j, hw), outer(i, hw)], mid.clone().sub(centre), [0, a, 0, b, 1, b, 1, a])
    for (const sx of [-1, 1]) {
      if (level) batch.tri('rubber', v(sx * hw, centre.y, 0), outer(i, sx * hw), outer(j, sx * hw), side(sx))
      else batch.quad('rubber', [outer(i, sx * hw), inner(i, sx * hw), inner(j, sx * hw), outer(j, sx * hw)], side(sx))
    }
    if (!level) batch.quad('frame', [inner(i, -hw), inner(i, hw), inner(j, hw), inner(j, -hw)], centre.clone().sub(mid))
  }
  if (!level) {
    // The three bearings share a solid cast carrier behind the belt, not an empty triangle.
    const plate = (x: number) => [v(x, -.4, -.73), v(x, -.4, .73), v(x, .37, 0)]
    const a = plate(-hw * .72), b = plate(hw * .72), middle = v(0, -.14, 0)
    batch.tri('frame', a[0], a[1], a[2], side(-1)); batch.tri('frame', b[0], b[1], b[2], side(1))
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3
      batch.quad('frame', [a[i], b[i], b[j], a[j]], a[i].clone().add(b[j]).multiplyScalar(.5).sub(middle))
    }
  }
  for (const [z, y, r] of [[-.73, .36, .28], [.73, .36, .28], [0, 1.13, .25]]) {
    const face = hw + .015
    if (!level) batch.rod('frame', v(-face, y - .76, z), v(face, y - .76, z), r, 10, true)
    for (const sx of [-1, 1]) {
      const at = v(sx * face, y - .76, z)
      if (level) { batch.disc('chrome', at, 'x', sx, 0, r * .78, 6); continue }
      // One flat wheel face in zones, so nothing overlaps and nothing is hidden. The top wheel
      // drives the belt: its rim is cut into sprocket teeth, bright against dark.
      if (y > 1) for (let k = 0; k < 20; k++) {
        const a0 = k / 20 * Math.PI * 2, a1 = (k + 1) / 20 * Math.PI * 2
        const p = (angle: number, radius: number) => v(at.x, at.y + Math.sin(angle) * radius, at.z + Math.cos(angle) * radius)
        batch.quad(k % 2 ? 'frame' : 'chrome', [p(a0, r * .78), p(a0, r), p(a1, r), p(a1, r * .78)], side(sx))
      } else batch.disc('frame', at, 'x', sx, r * .78, r, 10)
      batch.disc('chrome', at, 'x', sx, r * .42, r * .78, 10)
      batch.disc('accent', at, 'x', sx, 0, r * .42, 10)
    }
  }
  // Three road wheels carry the ground run between the two idlers.
  if (!level) for (const z of [-.37, 0, .37]) {
    const r = .15, y = .055 + .075 + r - .76, face = hw - .02
    batch.rod('frame', v(-face, y, z), v(face, y, z), r, 8, true)
    for (const sx of [-1, 1]) {
      batch.disc('chrome', v(sx * face, y, z), 'x', sx, r * .45, r, 8)
      batch.disc('accent', v(sx * face, y, z), 'x', sx, 0, r * .45, 8)
    }
  }
}

/**
 * A haunch: the flare as a muscle. A thick, crowned shell wider than the tread, deepest over
 * the drive sprocket and tapering to a lip at each end, with a rolled edge down both sides.
 * Like the slim flare it is the same on both sides of the vehicle and differs by axle.
 */
function haunch(batch: Batch, kind: ExpeditionSpec['fender'], axle: number, width: number) {
  const gap = .12, front = axle === 0, rear = axle === 2
  const reach: Record<ExpeditionSpec['fender'], [number, number, number]> = {
    swept: [front ? .05 : .32, rear ? .12 : .3, rear ? .6 : .12], round: [front ? .08 : .2, rear ? 0 : .2, rear ? .3 : 0],
    short: [front ? .3 : .46, .42, rear ? .45 : .1], deep: [0, 0, rear ? .34 : 0],
    folded: [front ? .1 : .36, rear ? .08 : .22, rear ? .44 : .1],
  }
  const [ahead, behind, kick] = reach[kind]
  const slope = (f: number, sz: number) => [sz * (1.03 - .74 * f) + sz * .765 * gap, .37 + .88 * f + .644 * gap - .76]
  const crest = 1.545 + gap - .76
  const controls = [slope(ahead, -1), slope((ahead + 1) / 2, -1), [-.24, crest - .04], [0, crest], [.24, crest - .04], slope((behind + 1) / 2, 1), slope(behind, 1)]
  if (kick) { const end = controls[controls.length - 1]; controls.push([end[0] + kick * .55, end[1] - kick * .16], [end[0] + kick, end[1] - kick * .1]) }
  const path = new T.CatmullRomCurve3(controls.map(([z, y]) => v(0, y, z)), false, 'centripetal').getPoints(10)
  const half = width / 2 + .2, part = new Batch(), n = path.length - 1
  // Depth along the arch: a lip at each end, full over the sprocket.
  const depth = (i: number) => .06 + .2 * Math.sin(Math.PI * i / n) ** .7
  const cols = 4
  const point = (i: number, k: number, under: boolean) => {
    const u = k / cols * 2 - 1, p = path[i], d = depth(i)
    // Crowned across, with the edges rolled down past the belt.
    const upper = p.y + d * .9 * (1 - u * u) - .1 * u ** 4
    return v(u * half, under ? upper - d * (.35 + .65 * (1 - u * u)) : upper, p.z)
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < cols; k++) {
      part.quad('paint', [point(i, k, false), point(i + 1, k, false), point(i + 1, k + 1, false), point(i, k + 1, false)], UP)
      part.quad('frame', [point(i, k, true), point(i + 1, k, true), point(i + 1, k + 1, true), point(i, k + 1, true)], DOWN)
    }
    for (const k of [0, cols]) part.quad('accent', [point(i, k, false), point(i + 1, k, false), point(i + 1, k, true), point(i, k, true)], side(k ? 1 : -1))
  }
  for (const i of [0, n]) for (let k = 0; k < cols; k++) part.quad('paint', [point(i, k, false), point(i, k + 1, false), point(i, k + 1, true), point(i, k, true)], i ? AFT : FORE)
  part.soften(.9)
  batch.append(part)
  for (const sx of [-1, 1]) batch.box('frame', [.09, .26, .26], [sx * (half - .2), crest - .2, 0])
}

/**
 * A flare: a slim arched guard that follows the belt a hand's width above it, over the drive
 * sprocket and part way down each slope. It is the same on both sides of the vehicle, because
 * one geometry is drawn for both, so its crown is central and both edges turn down. Each axle
 * covers a different stretch: the front reaches down ahead as a mud guard, the rear trails
 * off behind in a kick.
 */
function flare(batch: Batch, kind: ExpeditionSpec['fender'], axle: number, width: number, power = false) {
  if (power) { haunch(batch, kind, axle, width); return }
  const gap = .1, front = axle === 0, rear = axle === 2
  // How far down each slope the guard stops: 1 at the sprocket, 0 at the idler on the ground.
  const reach: Record<ExpeditionSpec['fender'], [number, number, number]> = {
    swept: [front ? .12 : .5, rear ? .3 : .45, rear ? .5 : 0], round: [front ? .2 : .34, rear ? .1 : .34, 0],
    short: [front ? .5 : .66, .6, rear ? .34 : 0], deep: [front ? 0 : .12, rear ? 0 : .12, rear ? .2 : 0],
    folded: [front ? .2 : .5, rear ? .16 : .3, rear ? .28 : 0],
  }
  const [ahead, behind, kick] = reach[kind]
  // Along a belt slope from the idler (0) to the sprocket (1), stood off by the gap.
  const slope = (f: number, sz: number) => [sz * (1.03 - .74 * f) + sz * .765 * gap, .37 + .88 * f + .644 * gap - .76]
  const controls = [slope(ahead, -1), slope((ahead + 1) / 2, -1), [-.2, 1.5 + gap - .76], [0, 1.545 + gap - .76], [.2, 1.5 + gap - .76], slope((behind + 1) / 2, 1), slope(behind, 1)]
  if (kick) { const end = controls[controls.length - 1]; controls.push([end[0] + kick * .6, end[1] - kick * .1], [end[0] + kick, end[1] + kick * .08]) }
  const path = new T.CatmullRomCurve3(controls.map(([z, y]) => v(0, y, z)), false, 'centripetal').getPoints(11)
  const half = width / 2 + .1, thick = kind === 'deep' ? .09 : .055, part = new Batch()
  // Five columns across: edge, shoulder, crown, shoulder, edge.
  const column = (p: T.Vector3, k: number, drop: number) => { const u = k / 2 - 1; return v(u * half, p.y + .05 * (1 - u * u) - .05 * u * u - drop, p.z) }
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      part.quad('paint', [column(path[i], k, 0), column(path[i + 1], k, 0), column(path[i + 1], k + 1, 0), column(path[i], k + 1, 0)], UP)
      part.quad('frame', [column(path[i], k, thick), column(path[i + 1], k, thick), column(path[i + 1], k + 1, thick), column(path[i], k + 1, thick)], DOWN)
    }
    for (const k of [0, 4]) part.quad('accent', [column(path[i], k, 0), column(path[i + 1], k, 0), column(path[i + 1], k, thick), column(path[i], k, thick)], side(k ? 1 : -1))
  }
  for (const i of [0, path.length - 1]) for (let k = 0; k < 4; k++) part.quad('accent', [column(path[i], k, 0), column(path[i], k + 1, 0), column(path[i], k + 1, thick), column(path[i], k, thick)], i ? AFT : FORE)
  part.soften(.7)
  batch.append(part)
  // Two cast stays carry it from the sprocket housing.
  for (const sx of [-1, 1]) batch.box('frame', [.07, .3, .2], [sx * (half - .1), 1.545 + gap - .76 - .2, 0])
}

/** One fender. It belongs to its tread and travels with it. `axle` 0 is the front, 2 the rear. */
function fender(batch: Batch, kind: ExpeditionSpec['fender'], axle: number, width: number, level: 0 | 1, smooth = false, power = false) {
  if (smooth && !level) { flare(batch, kind, axle, width, power); return }
  const deep = kind === 'deep', swept = kind === 'swept', rounded = kind === 'round' && !level
  const rear = axle === 2, front = axle === 0
  const controls = [
    [-1.19, front ? .48 : 1.05], [-.93, kind === 'round' ? 1.26 : 1.4], [-.38, 1.57],
    [.42, rear && swept ? 1.71 : 1.57], [.97, rear ? 1.46 : 1.38],
    [rear ? 1.32 : 1.12, rear ? .64 : 1.05],
  ]
  if (kind === 'short') for (let i = 0; i < controls.length; i++) {
    controls[i][0] *= .84
    if (i === 0 || i === controls.length - 1) controls[i][1] = rear && i > 0 ? .9 : 1.16
  }
  const profile = rounded ? new T.CatmullRomCurve3(controls.map(([z, y]) => v(z, y, 0)), false, 'centripetal')
    .getPoints(18).map(p => [p.x, p.y]) : controls
  const half = width / 2 + .12, thickness = deep ? .22 : .12
  const p = (i: number, x: number, drop = 0) => v(x, profile[i][1] - .76 - drop, profile[i][0])
  const part = new Batch()
  for (let i = 0; i < profile.length - 1; i++) {
    if (rounded) {
      const a = p(i, 0).add(v(0, .09, 0)), b = p(i + 1, 0).add(v(0, .09, 0))
      part.quad('paint', [p(i, -half), p(i + 1, -half), b, a], UP)
      part.quad('paint', [a, b, p(i + 1, half), p(i, half)], UP)
    } else part.quad('paint', [p(i, -half), p(i + 1, -half), p(i + 1, half), p(i, half)], UP)
    part.quad('frame', [p(i, half, thickness), p(i + 1, half, thickness), p(i + 1, -half, thickness), p(i, -half, thickness)], DOWN)
    for (const sx of [-1, 1]) part.quad('accent', [p(i, sx * half), p(i + 1, sx * half), p(i + 1, sx * half, thickness), p(i, sx * half, thickness)], side(sx))
  }
  for (const i of [0, profile.length - 1]) {
    const out = i ? AFT : FORE
    if (rounded) {
      const crest = p(i, 0).add(v(0, .09, 0)), base = p(i, 0, thickness)
      part.quad('paint', [p(i, -half), crest, base, p(i, -half, thickness)], out)
      part.quad('paint', [crest, p(i, half), p(i, half, thickness), base], out)
    } else part.quad('paint', [p(i, -half), p(i, half), p(i, half, thickness), p(i, -half, thickness)], out)
  }
  if (rounded) part.soften()
  batch.append(part)
  // A short cast carrier connects each fender directly to its sprocket housing.
  if (!level) for (const sx of [-1, 1]) batch.box('frame', [.09, .42, .22], [sx * (half - .08), .46, 0])
}

/** The swing arm of one side, from the hull pivot at its origin to the pod's hub. */
function arm(batch: Batch, sx: number) {
  const end = v(sx * ARM.x, ARM.y, ARM.z)
  batch.rod('frame', v(0, 0, 0), end, .15, 10)
  // A bright collar where the pod turns on the arm.
  batch.rod('chrome', end.clone().multiplyScalar(.8), end.clone().multiplyScalar(.93), .172, 10, true)
}

/** The far silhouette's pods: a prism and a fender plate each, fixed at rest. */
function farPods(batch: Batch, width: number, pivotX: number) {
  const outline = [[-1.05, .22], [-.8, .055], [.8, .055], [1.05, .22], [.22, 1.45], [-.22, 1.45]], hw = width / 2
  const top = [[-1.19, 1.05], [-.38, 1.57], [.42, 1.57], [1.12, 1.05]], half = hw + .12
  for (const sx of [-1, 1]) for (let axle = 0; axle < 3; axle++) {
    const c = podRest(sx, axle, pivotX), at = (z: number, y: number, x: number) => v(c.x + x, c.y + y - .76, c.z + z)
    for (let i = 0; i < 6; i++) {
      const a = outline[i], b = outline[(i + 1) % 6]
      batch.quad('rubber', [at(a[0], a[1], -hw), at(b[0], b[1], -hw), at(b[0], b[1], hw), at(a[0], a[1], hw)], v(0, (a[1] + b[1]) * .5 - .6, (a[0] + b[0]) * .5))
      for (const s of [-1, 1]) batch.tri('rubber', at(0, .6, s * hw), at(a[0], a[1], s * hw), at(b[0], b[1], s * hw), side(s))
    }
    for (let i = 0; i < 3; i++) batch.quad('paint', [at(top[i][0], top[i][1], -half), at(top[i + 1][0], top[i + 1][1], -half), at(top[i + 1][0], top[i + 1][1], half), at(top[i][0], top[i][1], half)], UP)
  }
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

// Shader graph nodes: the TSL types are too loose to be worth threading through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

interface Surfaces { by: Record<Solid, T.MeshStandardMaterial>; packed: T.MeshStandardNodeMaterial; canopy: T.MeshStandardMaterial }

function surfaces(color: T.ColorRepresentation, accent: T.ColorRepresentation, trackWidth: number): Surfaces {
  const std = (role: Parameters<typeof setRole>[1], p: T.MeshStandardMaterialParameters) => setRole(new T.MeshStandardMaterial(p), role)
  const by: Record<Solid, T.MeshStandardMaterial> = {
    paint: std('paint', { color, metalness: .8, roughness: .3 }),
    accent: std('accent', { color: accent, metalness: .85, roughness: .26 }),
    chrome: std('chrome', { color: 0xe9edf2, metalness: 1, roughness: .14 }),
    frame: std('frame', { color: 0x1a1c20, metalness: .85, roughness: .38 }),
    // Cabin lining and seats: the one role where a vehicle gives its own numbers.
    trim: std('trim', { color: 0x1b1e24, metalness: .1, roughness: .8 }),
    rubber: std('trim', { color: 0x0b0b0c, metalness: 0, roughness: .86 }),
    track: std('track', { color: 0x0d0d0e, metalness: 0, roughness: .84 }),
    head: std('lamp', { color: 0xd8dde4, emissive: new T.Color(2.447059, 2.858824, 3), metalness: 0, roughness: .15 }),
    tail: std('lamp', { color: 0x400000, emissive: new T.Color(TAIL.idle, 0, 0), metalness: 0, roughness: .15 }),
  }
  by.track.userData.trackWidth = trackWidth
  // The plain tier of the packed material, as mergeStatic builds it: each vertex picks its
  // surface by `surfaceId`. The shared shading reads the same list for the richer tiers.
  const list = SOLIDS.map(k => by[k]), id: N = attribute('surfaceId', 'float').round()
  let colour: N = vec3(0), emission: N = vec3(0), roughness: N = float(0), metalness: N = float(0)
  list.forEach((m, i) => {
    const mask: N = id.equal(i).select(1, 0)
    colour = colour.add(uniform(m.color).mul(mask)); emission = emission.add(uniform(m.emissive).mul(m.emissiveIntensity).mul(mask))
    roughness = roughness.add(mask.mul(m.roughness)); metalness = metalness.add(mask.mul(m.metalness))
  })
  const packed = new T.MeshStandardNodeMaterial(); packed.name = 'Tank surfaces'
  packed.colorNode = colour; packed.emissiveNode = emission; packed.roughnessNode = roughness; packed.metalnessNode = metalness
  mergedSurfaces.set(packed, list)
  // Shown as it is only where the shared force field is not applied (the distance levels).
  const canopy = setRole(new T.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .25, transparent: true, opacity: .16, depthWrite: false, side: T.DoubleSide, metalness: 0, roughness: .2 }), 'canopy')
  canopy.name = 'Tank canopy'
  return { by, packed, canopy }
}

// ---------------------------------------------------------------------------------------------
// The tank
// ---------------------------------------------------------------------------------------------

const matrix = new T.Matrix4(), turn = new T.Quaternion(), place = new T.Vector3(), unit = new T.Vector3(1, 1, 1), X = new T.Vector3(1, 0, 0)
/** Everything a pod can reach, for culling: instance bounds are not recomputed as pods move. */
const REACH = new T.Sphere(new T.Vector3(0, 1.2, 0), 5.6)

interface Built { root: T.Group; arms?: [T.InstancedMesh, T.InstancedMesh]; pods?: T.InstancedMesh[]; triangles: number; draws: number }

/**
 * What a body supplies to become a tank: its hull at each detail level and where the running
 * gear hangs. The treads, arms, materials and detail switching are the same for every body.
 */
export interface TankHull {
  trackWidth: number
  fender: ExpeditionSpec['fender']
  /** Arched fenders with a crown, as the lofted bodies wear, instead of folded plate. */
  smoothFenders?: boolean
  /** Thick sculpted flares, wider than the tread, for the blended bodies. */
  powerFenders?: boolean
  /** Distance of the arm pivots from the centreline. The pods sit 0.74 m further out. */
  pivotX: number
  /** Half the hull's length, for the collision box. */
  halfLength: number
  /** Headlamp centres, for beams and effects. */
  headlamps: T.Vector3[]
  /** Near (0) or mid (1) hull. Returns the driver's eye. */
  near(batch: Batch, level: 0 | 1): [number, number, number]
  /** Far silhouette hull, a few dozen faces. */
  far(batch: Batch): void
}

/** The round seven panel hulls as a tank body. */
export function panelHull(spec: ExpeditionSpec): TankHull {
  const nose = spec.sections[0], y = (nose[2] + nose[3]) * .5 + .12
  return {
    trackWidth: spec.trackWidth ?? .93, fender: spec.fender, pivotX: PANEL_PIVOT,
    halfLength: Math.max(-nose[0], spec.sections.at(-1)![0]),
    headlamps: [-1, 1].flatMap(sx => [.23, .65, 1.07].map(x => v(sx * x * Math.min(1, nose[1] / 1.3), y, nose[0] - .12))),
    near: (batch, level) => hull(batch, spec, level),
    far: batch => farHull(batch, spec),
  }
}

export class ExpeditionTank {
  readonly object = new T.Group()
  /** The driver's eye in the model's frame. */
  readonly eye: [number, number, number]
  /** Headlamp centres in the model's frame, for beams and effects. */
  get headlamps(): T.Vector3[] { return this.hull.headlamps }
  private readonly mats: Surfaces
  private readonly built: (Built | undefined)[] = []
  private readonly geometries: T.BufferGeometry[] = []
  private readonly lift = new Float32Array(6)
  private readonly rock = new Float32Array(6)
  private readonly scroll = new Float32Array(6)
  private current: Level = 0
  private detachShowroom?: () => void

  constructor(readonly hull: TankHull, color: T.ColorRepresentation, accent: T.ColorRepresentation) {
    this.object.name = 'Exploration tank'
    this.mats = surfaces(color, accent, hull.trackWidth)
    const near = this.build(0)
    this.eye = near.root.userData.eye as [number, number, number]
    this.pose()
  }

  private own<G extends T.BufferGeometry>(g: G): G { this.geometries.push(g); return g }
  private mesh(root: T.Object3D, geometry: T.BufferGeometry, name: string) {
    const mesh = new T.Mesh(this.own(geometry), this.mats.packed); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh
  }
  private instanced(root: T.Object3D, batch: Batch, count: number, name: string, scrolls: boolean) {
    const geometry = this.own(batch.solid())
    if (scrolls) geometry.setAttribute('trackScroll', new T.InstancedBufferAttribute(new Float32Array(count), 1))
    const mesh = new T.InstancedMesh(geometry, this.mats.packed, count); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.boundingSphere = REACH
    root.add(mesh); return mesh
  }

  private build(level: Level): Built {
    const done = this.built[level]; if (done) return done
    const root = new T.Group(), spec = this.hull, width = spec.trackWidth
    root.name = ['Near', 'Mid', 'Far'][level]; root.visible = level === this.current
    const result: Built = { root, triangles: 0, draws: 0 }
    const body = new Batch()
    if (level === 2) { spec.far(body); farPods(body, width, spec.pivotX); this.mesh(root, body.solid(), 'Silhouette') }
    else {
      root.userData.eye = spec.near(body, level)
      this.mesh(root, body.solid(), 'Hull and cabin')
      const glass = body.canopy()
      if (glass) { const mesh = new T.Mesh(this.own(glass), this.mats.canopy); mesh.name = 'Cabin windows'; root.add(mesh) }
      if (level === 0) {
        const arms = (sx: number) => { const b = new Batch(); arm(b, sx); return this.instanced(root, b, 3, sx < 0 ? 'Left swing arms' : 'Right swing arms', false) }
        result.arms = [arms(-1), arms(1)]
        result.pods = [0, 1, 2].map(axle => { const b = new Batch(); track(b, width, 0); fender(b, spec.fender, axle, width, 0, spec.smoothFenders, spec.powerFenders); return this.instanced(root, b, 2, `Treads and fenders, axle ${axle + 1}`, true) })
      } else {
        // One draw for all six: at this distance every pod wears the middle axle's fender.
        const b = new Batch(); track(b, width, 1); fender(b, spec.fender, 1, width, 1)
        result.pods = [this.instanced(root, b, 6, 'Treads and fenders', false)]
      }
    }
    root.traverse(o => {
      if (!(o instanceof T.Mesh)) return
      result.draws++
      result.triangles += o.geometry.getAttribute('position').count / 3 * (o instanceof T.InstancedMesh ? o.count : 1)
    })
    this.built[level] = result; this.object.add(root)
    return result
  }

  /** Show one detail level. The mid and far levels are built the first time they are needed. */
  setLevel(level: Level) {
    if (level === this.current && this.built[level]) return
    this.current = level
    const shown = this.build(level)
    for (const b of this.built) if (b) b.root.visible = b === shown
    this.pose()
  }
  get level(): Level { return this.current }

  /**
   * Move one pod. `lift` is how far it has risen above its rest height in metres (negative
   * when it droops), `rock` its pitch in radians to lie along the ground, `scroll` the distance
   * its belt has run in metres. Call `pose` once after setting all six.
   */
  setPod(index: number, lift: number, rock: number, scroll: number) {
    this.lift[index] = Math.min(POD_TRAVEL.up, Math.max(-POD_TRAVEL.down, lift)); this.rock[index] = rock; this.scroll[index] = scroll
  }

  /** Write the pods' current positions to whichever level is showing. Allocates nothing. */
  pose() {
    const b = this.built[this.current]
    if (!b?.pods) return
    for (let i = 0; i < 6; i++) {
      const sx = i % 2 ? 1 : -1, axle = i >> 1
      // Swing angle that raises the arm's end by `lift`: negative swings it up.
      const swing = ARM_REST - Math.acos(Math.min(1, Math.max(-1, (-ARM.y - this.lift[i]) / ARM_REACH)))
      const c = Math.cos(swing), s = Math.sin(swing), px = sx * this.hull.pivotX, py = PIVOT_Y, pz = (axle - 1) * AXLE_SPACING - .55
      if (b.arms) {
        matrix.compose(place.set(px, py, pz), turn.setFromAxisAngle(X, swing), unit)
        b.arms[i % 2].setMatrixAt(axle, matrix)
      }
      place.set(px + sx * ARM.x, py + ARM.y * c - ARM.z * s, pz + ARM.y * s + ARM.z * c)
      matrix.compose(place, turn.setFromAxisAngle(X, this.rock[i]), unit)
      const pods = b.arms ? b.pods[axle] : b.pods[0], slot = b.arms ? i % 2 : i
      pods.setMatrixAt(slot, matrix)
      const belt = pods.geometry.getAttribute('trackScroll') as T.InstancedBufferAttribute | undefined
      if (belt) { belt.setX(slot, wrapTrackScroll(this.scroll[i])); belt.needsUpdate = true }
    }
    for (const m of b.pods) m.instanceMatrix.needsUpdate = true
    if (b.arms) for (const m of b.arms) m.instanceMatrix.needsUpdate = true
  }

  setColors(body: T.ColorRepresentation, accent: T.ColorRepresentation) {
    this.mats.by.paint.color.set(body); this.mats.by.accent.color.set(accent)
    this.mats.canopy.color.set(accent); this.mats.canopy.emissive.set(accent)
  }
  /** Tail lamps brighten under braking; `headlights` false dims the headlamps for a studio. */
  setLights(braking: boolean, headlights = true) {
    this.mats.by.tail.emissive.setRGB(braking ? TAIL.brake : TAIL.idle, 0, 0)
    const k = headlights ? 1 : .08; this.mats.by.head.emissive.setRGB(2.447059 * k, 2.858824 * k, 3 * k)
  }
  setShadows(cast: boolean) {
    for (const b of this.built) b?.root.traverse(o => { if (o instanceof T.Mesh && o.material === this.mats.packed) o.castShadow = cast })
  }

  /** Triangles and draws of one level, building it if it has not been shown yet. */
  stats(level: Level): { triangles: number; draws: number } { const b = this.build(level); return { triangles: Math.round(b.triangles), draws: b.draws } }

  /**
   * Hand the near level to the shared showroom shading. Call once the tank is attached to its
   * vehicle. The distance levels keep the plain tier, which is what the shared shading gives a
   * remote vehicle beyond 30 m anyway.
   */
  showroom(decorate: Decorate) { this.detachShowroom ??= applyShowroom(this.build(0).root, decorate) }

  dispose() {
    this.detachShowroom?.(); this.detachShowroom = undefined
    this.object.removeFromParent()
    // Whatever the showroom left attached is released here, with the sources it was built from.
    const materials = new Set<T.Material>([this.mats.packed, this.mats.canopy, ...Object.values(this.mats.by)])
    this.object.traverse(o => { if (o instanceof T.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m) })
    materials.forEach(m => m.dispose()); this.geometries.forEach(g => g.dispose())
  }
}

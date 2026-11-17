import type * as THREE from 'three/webgpu'
import { Mesh } from './kit'
import { Surface, type V3 } from './surface'

/**
 * Body fittings, after tools/buggy-bodies/build.py `make_sockets` for the shipped body:
 *
 * - the skid plate, one smooth chrome belly under the floor, turned up at the nose and tail
 *   like a sled, its edges tucked up into the body;
 * - a headlight each side: a domed lens in a chrome bezel with a thin chrome halo ring
 *   standing on it;
 * - eight swellings of the body itself, a bell over an ellipse, one where each arm root
 *   enters and one under each shock top, so the linkage reads as carried by the body.
 *
 * The swellings' rims are conformed to the body: give `buildSockets` the body's geometry and
 * every rim point is cast onto it, so they sit on whatever body is plugged in. Without a body
 * the stored centres and directions (found the same way on the shipped body) are used and the
 * rims lie on each swelling's tangent plane, a little under the paint.
 *
 * Frame: the game's (+X right, +Y up, -Z forward).
 */
export const SKID = {
  /** First station (game z), spacing, and per station [half width, keel height]. */
  from: -1.8, step: .24,
  stations: [[.48, .0825], [.628, .0158], [.638, -.025], [.643, -.0465], [.662, -.0584], [.694, -.0614], [.737, -.0586], [.78, -.0568], [.804, -.0572], [.803, -.057], [.769, -.0611], [.707, -.0677], [.649, -.0577], [.624, -.0067], [.504, .0924]],
  /** Belly sag below the keel line, the turn up at the edges, and how far the ends lift. */
  sag: .03, edgeTurn: .05, endLift: .05, under: .012,
}

/** The headlight lens and bezel. Centre and axis fitted to the shipped lens (tools/buggy-fit/parts/fit-lenses.ts). */
export const LAMP = {
  /** Right lamp centre on its seat, and the axis it faces along; the left one is the mirror image. */
  centre: [.6317, .3285, -1.2813] as V3, axis: [.9732, -.1217, -.1952] as V3,
  /** With a body: where to look for the duct (x, height), and how far the lens stands off its seat. */
  seat: [.62, .33] as [number, number], lift: .012,
  /** Half sizes of the lens: across and up. */
  rx: .15, rz: .125,
  /** Rings as [size as a multiple of the lens, height along the axis]: bezel foot, bezel lip, lens edge, shoulder, crown. */
  rings: [[1.22, -.03], [1.2, .012], [1, .018], [.72, .045], [.36, .06]] as [number, number][],
  /** Halo ring standing on the lens: outer foot, crest, inner foot. */
  halo: [[.62, .05], [.56, .062], [.5, .054]] as [number, number][],
}

/**
 * The main headlamp in each nose duct, inboard of the small lens above. On the shipped model it
 * was a disc of the body's own faces; a body built from a coarse cage cannot hold that circle,
 * so it is a fitting here. Fitted to the shipped body's Headlights faces (right side; the left
 * mirrors): centre, the direction it faces, the ellipse's long axis and half sizes, dome height.
 */
export const DUCT_LAMP = {
  centre: [.5986, .3626, -1.6462] as V3, axis: [.7439, .0838, -.663] as V3, major: [.631, .24, .738] as V3,
  a: .1, b: .088, dome: .022,
  /** With a body: the lens base stands this far in front of the body inside its outline. */
  clear: .006,
}

/** Suspension geometry the swellings are placed from (front right corner; the others mirror). */
export const LINK = { mount: [.55, .15, -1.2] as V3, hub: [1.1, -.19, -1.3] as V3, tower: [0, .35, .58] as V3, shockSink: .05 }
/** Swellings: half length, half width, height; rim sinks this far under the paint. */
export const SWELL = { arm: { a: .4, b: .16, h: .11 }, shock: { a: .2, b: .17, h: .085 }, sink: .012 }
/**
 * Fallback with no body: per corner (front, then rear; right side, the left mirrors) the arm
 * root's centre, then the shock swelling's centre and outward normal, as found on the shipped body.
 */
export const SWELL_FALLBACK = {
  arm: [[.632, .099, -1.215], [.628, .102, 1.214]] as V3[],
  shock: [[.76, .452, -1.241], [.759, .45, 1.24]] as V3[], shockNormal: [[.599, -.798, -.062], [.636, -.768, .074]] as V3[],
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** The four corners in the game's wheel order: front left, front right, rear left, rear right. */
function corners(): { sx: number; sz: number; mount: V3; hub: V3 }[] {
  return [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, f]) => {
    const sz = f
    return { sx, sz, mount: [LINK.mount[0] * sx, LINK.mount[1], LINK.mount[2] * sz], hub: [LINK.hub[0] * sx, LINK.hub[1], LINK.hub[2] * sz] }
  })
}

/** Where the strut puts its shock tower (LoadedBuggySkin.strutMatrix's frame, as build.py). */
function towerPoint(hub: V3, mount: V3): V3 {
  const span = unit(sub(mount, hub)), up: V3 = [0, 1, 0]
  const y = unit(add(up, span, -dot(up, span))), x = cross(y, span)
  return add(add(add(hub, x, LINK.tower[0]), y, LINK.tower[1]), span, LINK.tower[2])
}

export interface SocketsBuild {
  pieces: { part: 'sockets'; role: string; geometry: THREE.BufferGeometry }[]
  /** Shock top anchors in wheel order (game frame), as LoadedBuggySkin reads from the model. */
  shockTops: V3[]
}

export function buildSockets(detail: 0 | 1 | 2, body?: THREE.BufferGeometry[]): SocketsBuild {
  const surface = body?.length ? Surface.from(body) : undefined
  const paint = new Mesh(), chrome = new Mesh(), lens = new Mesh()
  skidPlate(chrome, detail)
  for (const side of [1, -1]) lamp(chrome, lens, side, detail, surface)
  for (const side of [1, -1]) ductLamp(lens, side, detail, surface)
  const shockTops: V3[] = []
  const seg = detail === 0 ? 12 : detail === 1 ? 8 : 6, rings = detail === 0 ? 4 : detail === 1 ? 3 : 2
  for (const c of corners()) {
    const d = unit(sub(c.hub, c.mount)), k = c.sz > 0 ? 0 : 1, mirror = (v: V3): V3 => [v[0] * c.sx, v[1], v[2]]
    // Arm root: where a ray from the hub toward the mount meets the body.
    const near = surface?.near(c.mount, .9)
    const armHit = near?.ray(c.hub, [-d[0], -d[1], -d[2]], 2)?.point ?? mirror(SWELL_FALLBACK.arm[k])
    swell(paint, near, armHit, d, [0, 0, 1], SWELL.arm, seg, rings)
    // Shock: the body point nearest the strut's tower, the anchor a little inside it.
    const T = towerPoint(c.hub, c.mount)
    let p: V3, n: V3
    const hit = near?.nearest(T)
    if (hit) { p = hit.point; n = dot(sub(T, p), hit.normal) < 0 ? [-hit.normal[0], -hit.normal[1], -hit.normal[2]] : hit.normal }
    else { p = mirror(SWELL_FALLBACK.shock[k]); n = unit(mirror(SWELL_FALLBACK.shockNormal[k])) }
    shockTops.push(add(p, n, -LINK.shockSink))
    swell(paint, near, p, n, d, SWELL.shock, seg, rings)
  }
  return {
    pieces: [
      { part: 'sockets', role: 'paint', geometry: paint.geometry() },
      { part: 'sockets', role: 'chrome', geometry: chrome.geometry() },
      { part: 'sockets', role: 'lamp', geometry: lens.geometry() },
    ],
    shockTops,
  }
}

/**
 * A bell `h` tall over an ellipse (half sizes `a` along `along`, `b` across) at `centre`, rising
 * along `out`. Its rim lies on the body just under the paint and leaves it at a grazing angle;
 * the crown is a clean dome over the tangent plane.
 */
function swell(m: Mesh, body: Surface | undefined, centre: V3, out: V3, along: V3, s: { a: number; b: number; h: number }, seg: number, rings: number): void {
  const u = unit(add(along, out, -dot(along, out))), w = cross(out, u)
  const at = (r: number, j: number): V3 => {
    const ang = 2 * Math.PI * j / seg
    const flat = add(add(centre, u, s.a * r * Math.cos(ang)), w, s.b * r * Math.sin(ang))
    const ground = body?.ray(add(flat, out, .5), [-out[0], -out[1], -out[2]], 1)?.point ?? body?.nearest(flat)?.point ?? flat
    const f = (1 - r * r) ** 2
    const p: V3 = [ground[0] + (flat[0] - ground[0]) * f, ground[1] + (flat[1] - ground[1]) * f, ground[2] + (flat[2] - ground[2]) * f]
    return add(p, out, -SWELL.sink + (s.h + SWELL.sink) * f)
  }
  m.begin()
  const loops = Array.from({ length: rings }, (_, k) => Array.from({ length: seg }, (_, j) => m.vec(at(1 - k / rings, j))))
  for (let k = 0; k + 1 < rings; k++) m.skin(loops[k], loops[k + 1])
  const top = m.vec(at(0, 0))
  for (let j = 0; j < seg; j++) m.tri(loops[rings - 1][j], loops[rings - 1][(j + 1) % seg], top)
  m.orientAway(add(centre, out, -1))
}

/**
 * Where the lamp sits on a body, as build.py found it: rays from ahead of the car onto the
 * bezel line meet the duct's rim, a plane through those hits is the lens seat, and the lens
 * stands just off it. Returns undefined if the body has no duct there (fewer than six hits).
 */
export function seatLamp(body: Surface, side: number): { centre: V3; axis: V3 } | undefined {
  const L = LAMP, cx = L.seat[0] * side, cy = L.seat[1]
  const hits: V3[] = []
  for (let k = 0; k < 12; k++) {
    const a = 2 * Math.PI * k / 12
    const h = body.ray([cx + L.rx * 1.15 * Math.cos(a), cy + L.rz * 1.15 * Math.sin(a), -4], [0, 0, 1], 8)
    if (h) hits.push(h.point)
  }
  if (hits.length < 6) return undefined
  // Least squares plane z = a x + b y + c through the hits (normal equations, Cramer's rule).
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sxz = 0, syz = 0, sz = 0
  for (const [x, y, z] of hits) { sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; sxz += x * z; syz += y * z; sz += z }
  const n = hits.length, M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], r = [sxz, syz, sz]
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(M)
  if (Math.abs(D) < 1e-12) return undefined
  const [a, b, c] = [0, 1, 2].map(k => det(M.map((row, i) => row.map((v, j) => j === k ? r[i] : v))) / D)
  const axis = unit([a, b, -1])
  return { centre: add([cx, cy, a * cx + b * cy + c], axis, L.lift), axis }
}

function lamp(chrome: Mesh, lens: Mesh, side: number, detail: 0 | 1 | 2, body?: Surface): void {
  const L = LAMP, seat = body && seatLamp(body, side)
  const n: V3 = seat?.axis ?? unit([L.axis[0] * side, L.axis[1], L.axis[2]]), c: V3 = seat?.centre ?? [L.centre[0] * side, L.centre[1], L.centre[2]]
  const right = unit(cross(n, [0, 1, 0])), up = cross(right, n), count = detail === 0 ? 14 : detail === 1 ? 10 : 8
  const ring = (m: Mesh, [r, h]: [number, number]) => Array.from({ length: count }, (_, k) => {
    const t = 2 * Math.PI * k / count
    return m.vec(add(add(add(c, right, L.rx * r * Math.cos(t)), up, L.rz * r * Math.sin(t)), n, h))
  })
  const back = add(c, n, -.3)
  chrome.begin()
  const b = L.rings.slice(0, 3).map(r => ring(chrome, r))
  chrome.skin(b[0], b[1]); chrome.skin(b[1], b[2])
  if (detail < 2) { const h = L.halo.map(r => ring(chrome, r)); chrome.skin(h[0], h[1]); chrome.skin(h[1], h[2]) }
  chrome.orientAway(back)
  lens.begin()
  const l = L.rings.slice(2).map(r => ring(lens, r))
  lens.skin(l[0], l[1]); lens.skin(l[1], l[2]); lens.poly(l[2])
  lens.orientAway(back)
}

/**
 * The duct lamp: a domed elliptical lens. With a body it is moved along its axis until its base
 * clears whatever the body has inside its outline (rays cast back from in front), so a coarser
 * body's own lamp faces never show through it.
 */
function ductLamp(lens: Mesh, side: number, detail: 0 | 1 | 2, body?: Surface): void {
  const L = DUCT_LAMP, n = unit([L.axis[0] * side, L.axis[1], L.axis[2]]), maj = unit([L.major[0] * side, L.major[1], L.major[2]])
  const u = unit(add(maj, n, -dot(maj, n))), w = cross(n, u), count = detail === 0 ? 16 : detail === 1 ? 10 : 8
  let c: V3 = [L.centre[0] * side, L.centre[1], L.centre[2]]
  if (body) {
    let lift = -Infinity
    for (let k = 0; k <= 12; k++) {
      const r = k ? .9 : 0, t = 2 * Math.PI * k / 12
      const p = add(add(c, u, L.a * r * Math.cos(t)), w, L.b * r * Math.sin(t))
      const h = body.ray(add(p, n, .2), [-n[0], -n[1], -n[2]], .3)
      if (h) lift = Math.max(lift, dot(sub(h.point, c), n))
    }
    if (lift > -Infinity) c = add(c, n, lift + L.clear)
  }
  const ring = (r: number, h: number) => Array.from({ length: count }, (_, k) => {
    const t = 2 * Math.PI * k / count
    return lens.vec(add(add(add(c, u, L.a * r * Math.cos(t)), w, L.b * r * Math.sin(t)), n, h))
  })
  lens.begin()
  const rings = (detail === 2 ? [[1, 0], [.5, L.dome * .8]] : [[1, 0], [.75, L.dome * .55], [.4, L.dome * .9]]).map(([r, h]) => ring(r, h))
  for (let k = 0; k + 1 < rings.length; k++) lens.skin(rings[k], rings[k + 1])
  const top = lens.vec(add(c, n, L.dome))
  const last = rings[rings.length - 1]
  for (let k = 0; k < count; k++) lens.tri(last[k], last[(k + 1) % count], top)
  lens.orientAway(add(c, n, -.3))
}

function skidPlate(plate: Mesh, detail: 0 | 1 | 2): void {
  const s = SKID, m = detail === 0 ? 8 : detail === 1 ? 4 : 2
  plate.begin()
  const last = s.stations.length - 1
  const rows = s.stations.map(([w, keel], i) => Array.from({ length: m + 1 }, (_, k) => {
    const t = -1 + 2 * k / m, end = i === 0 || i === last
    return plate.vert(w * t, keel - s.under - s.sag * (1 - t * t) + (end ? s.endLift : s.edgeTurn * t ** 4), s.from + s.step * i)
  }))
  for (let i = 0; i < last; i++) for (let k = 0; k < m; k++) plate.quad(rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1])
  // The plate is an open sheet: it faces down, away from the body.
  plate.orientAway([0, 1, 0])
}

export const SOCKETS_NUMBERS = 13 + 2 + SKID.stations.length * 2 + 4 + 6 + 2 + 5 * 2 + 3 * 2 + 3 * 4 + 7 + 18

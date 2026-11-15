/**
 * Modelling kit for the next-gen tank design studies.
 *
 * Everything is procedural so a chosen design can be refined by editing numbers. The styling
 * follows the owner's Syn3h buggy and jet renders: candy paint over smooth lofted bodies,
 * black glass with a chrome surround, chrome rimmed openings and exposed chrome running gear.
 * Convention: -Z is forward, +Y is up, the ground is y = 0, units are metres.
 */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { abs, float, fract, length, max, min, mix, normalLocal, oneMinus, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl'

export interface Mats { paint: THREE.Material; accent: THREE.Material; chrome: THREE.Material; tail: THREE.Material; glass: THREE.Material; rubber: THREE.Material; dark: THREE.Material; glow: THREE.Material; /** Body colour, shared by every skin() of one design so a swatch can repaint it. */ paintU: { value: THREE.Color } }

export function makeMats(color: number, accent = 0xff5a12): Mats {
  const side = THREE.DoubleSide
  return {
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: .8, roughness: .3, clearcoat: 1, clearcoatRoughness: .03, side }),
    accent: new THREE.MeshPhysicalMaterial({ color: accent, metalness: .6, roughness: .4, clearcoat: 1, clearcoatRoughness: .1, side }),
    // Satin alloy, not mirror chrome: the owner asked for NASA hardware, not jewellery.
    chrome: new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 1, roughness: .3, side }),
    paintU: uniform(new THREE.Color(color)),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x020305, metalness: .3, roughness: .04, clearcoat: 1, clearcoatRoughness: 0, side }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0, roughness: .82, side }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: .8, roughness: .42, side }),
    glow: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  }
}

/** One cross-section of a loft: [z, halfWidth, top, bottom, centreY, exponent = 2.4, centreX = 0]. */
export type Station = number[]

const cr = (a: number, b: number, c: number, d: number, t: number) =>
  .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)

/**
 * A smooth body lofted through superellipse cross-sections along Z. A higher exponent gives a
 * squarer section. Stations are joined with Catmull-Rom curves, so a handful describes a hull.
 */
/** Reshapes a loft point: takes (x, y, z) and returns the moved [x, y]. */
export type Sculpt = (x: number, y: number, z: number) => [number, number]
/** Apply several sculpts in order. */
export const sculpts = (...fs: Sculpt[]): Sculpt => (x, y, z) => { for (const f of fs) [x, y] = f(x, y, z); return [x, y] }
/** Press a scoop into both flanks, like the buggy's side intakes. */
export const scoop = (cz: number, cy: number, rz: number, ry: number, depth: number): Sculpt => (x, y, z) =>
  [x - Math.sign(x) * depth * bell((z - cz) / rz) * bell((y - cy) / ry) * THREE.MathUtils.clamp((Math.abs(x) - .5) / .5, 0, 1), y]
/** Raise a dome on the upper surface: a hood bulge or a roof blister. */
export const dome = (cz: number, rz: number, rx: number, h: number, above: number, cx = 0): Sculpt => (x, y, z) =>
  [x, y > above ? y + h * bell((z - cz) / rz) * bell((x - cx) / rx) : y]
/** Pinch the body in plan, for a waist between the pods. */
export const waist = (cz: number, rz: number, k: number): Sculpt => (x, y, z) => [x * (1 - k * bell((z - cz) / rz)), y]
/** Lean the sides inward above a belt line. */
export const tumble = (belt: number, k: number): Sculpt => (x, y) => [y > belt ? x * (1 - k * Math.min(1, (y - belt) / .4)) : x, y]

export function loftGeometry(stations: Station[], spans = 9, segs = 44, sculpt?: Sculpt): THREE.BufferGeometry {
  const full = stations.map(s => [s[0], s[1], s[2], s[3], s[4] ?? 0, s[5] ?? 2.4, s[6] ?? 0])
  const rings: number[][] = []
  for (let i = 0; i < full.length - 1; i++) {
    const p0 = full[Math.max(0, i - 1)], p1 = full[i], p2 = full[i + 1], p3 = full[Math.min(full.length - 1, i + 2)]
    for (let k = 0; k < spans; k++) rings.push(p1.map((_, f) => cr(p0[f], p1[f], p2[f], p3[f], k / spans)))
  }
  rings.push(full[full.length - 1])
  const pos: number[] = [], idx: number[] = []
  for (const [z, w0, t0, b0, cy, n, cx] of rings) {
    const w = Math.max(w0, .002), top = Math.max(t0, .002), bot = Math.max(b0, 0), e = 2 / Math.max(n, 1.2)
    for (let j = 0; j < segs; j++) {
      const a = j / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
      let x = cx + w * Math.sign(c) * Math.abs(c) ** e, y = cy + (s >= 0 ? top : bot) * Math.sign(s) * Math.abs(s) ** e
      if (sculpt) [x, y] = sculpt(x, y, z)
      pos.push(x, y, z)
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + (j + 1) % segs, c = a + segs, d = b + segs
    idx.push(a, c, b, b, c, d)
  }
  // Close both ends with a fan so a blunt end (an exhaust, a tail) is not open.
  for (const end of [0, rings.length - 1]) {
    const r = rings[end], centre = pos.length / 3
    pos.push(r[6], r[4] + (Math.max(r[2], .002) - Math.max(r[3], 0)) / 2, r[0])
    for (let j = 0; j < segs; j++) idx.push(centre, end * segs + j, end * segs + (j + 1) % segs)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  return g
}

const shadow = <T extends THREE.Object3D>(o: T) => { o.traverse(c => { c.castShadow = true; c.receiveShadow = true }); return o }

export const blob = (mat: THREE.Material, stations: Station[], spans = 9, segs = 44, sculpt?: Sculpt) => shadow(new THREE.Mesh(loftGeometry(stations, spans, segs, sculpt), mat))

/** Rounded block centred on the origin: bumpers, skid plates, racks, crates. */
export const slab = (mat: THREE.Material, w: number, h: number, d: number, n = 6) => blob(mat, [[-d / 2, w / 2, h / 2, h / 2, 0, n], [d / 2, w / 2, h / 2, h / 2, 0, n]], 1, 36)

/** Bent tube through a list of [x, y, z] points: roll bars, bull bars, rails. */
export function tube(mat: THREE.Material, points: number[][], r: number) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', .12)
  return shadow(new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 10, r, 12), mat))
}

/** Black glass canopy with the thin chrome surround both reference vehicles have. */
export function canopy(m: Mats, stations: Station[], rim = .06) {
  const g = new THREE.Group()
  g.add(blob(m.glass, stations))
  g.add(blob(m.chrome, stations.map(s => [s[0], s[1] + rim, Math.max(s[2] * .3, .05), s[3] ?? 0, s[4] ?? 0, s[5] ?? 2.4, s[6] ?? 0])))
  return g
}

/** A chrome ringed opening facing +Z: intake, exhaust or lamp. sides = 3 gives the buggy's triangular vents. */
export function port(m: Mats, rx: number, ry: number, tube = .035, fill: THREE.Material = m.dark, sides = 48) {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, tube / Math.min(rx, ry), 12, sides), m.chrome); ring.scale.set(rx, ry, Math.min(rx, ry)); g.add(ring)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, sides), fill); disc.scale.set(rx, ry, 1); disc.position.z = -.01; g.add(disc)
  return shadow(g)
}

/** Tapered rod between two points: stub axles, suspension arms, struts. */
export function rod(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb = ra) {
  const d = b.clone().sub(a), mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, d.length(), 24), mat)
  mesh.position.copy(a).addScaledVector(d, .5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  return shadow(mesh)
}

/** Vertical fin with a chrome tip, like the jet's winglets. Root at the origin, chord along Z. */
export function fin(m: Mats, height: number, chord: number, sweep: number, thick = .05) {
  const g = new THREE.Group(), c = chord / 2
  // Lofted along its height; the wrapper below stands it up.
  const st = (z: number, k: number): Station => [z, thick * k, c * k, c * k, -sweep * z / height]
  const blade = blob(m.paint, [st(0, 1), st(height * .45, .86), st(height * .86, .62)], 6, 28)
  const tip = blob(m.chrome, [st(height * .86, .64), st(height * .95, .5), st(height, .2)], 5, 28)
  g.add(blade, tip); g.rotation.x = -Math.PI / 2
  const out = new THREE.Group(); out.add(g); return out
}

export interface Circle { z: number; y: number; r: number }

/** Outline of a belt stretched round a set of wheels, resampled to n evenly spaced points. */
function beltOutline(circles: Circle[], n: number) {
  const raw: [number, number][] = []
  for (let k = 0; k < 900; k++) {
    const a = k / 900 * Math.PI * 2, dz = Math.cos(a), dy = Math.sin(a)
    let best = circles[0], score = -Infinity
    for (const c of circles) { const s = c.z * dz + c.y * dy + c.r; if (s > score) { score = s; best = c } }
    raw.push([best.z + best.r * dz, best.y + best.r * dy])
  }
  const len = [0]
  for (let k = 0; k < raw.length; k++) { const a = raw[k], b = raw[(k + 1) % raw.length]; len.push(len[k] + Math.hypot(b[0] - a[0], b[1] - a[1])) }
  const total = len[raw.length], pts: { z: number; y: number; nz: number; ny: number }[] = []
  let k = 0
  for (let i = 0; i < n; i++) {
    const target = i / n * total
    while (len[k + 1] < target) k++
    const a = raw[k], b = raw[(k + 1) % raw.length], t = (target - len[k]) / Math.max(1e-9, len[k + 1] - len[k])
    pts.push({ z: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, nz: 0, ny: 0 })
  }
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], tz = b.z - a.z, ty = b.y - a.y, l = Math.hypot(tz, ty)
    pts[i].nz = ty / l; pts[i].ny = -tz / l
  }
  return pts
}

function strip(a: THREE.Vector3[], b: THREE.Vector3[]) {
  const pos: number[] = [], idx: number[] = [], n = a.length
  for (let i = 0; i < n; i++) pos.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z)
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1) }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  return g
}

/** Dished chrome wheel with the buggy rim's ring of dark holes. Axle along X. */
export function wheel(m: Mats, r: number, hw: number) {
  const g = new THREE.Group(), v = (x: number, y: number) => new THREE.Vector2(x, y)
  const half = [v(0, hw + .04), v(r * .2, hw + .04), v(r * .3, hw - .02), v(r * .7, hw - .07), v(r * .86, hw - .01), v(r, hw - .03)]
  const profile = [...half, ...half.map(p => v(p.x, -p.y)).reverse()]
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 36), m.chrome); body.rotation.z = Math.PI / 2; g.add(body)
  const hole = new THREE.CylinderGeometry(r * .115, r * .115, .02, 16); hole.rotateZ(Math.PI / 2)
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2, mesh = new THREE.Mesh(hole, m.rubber)
    mesh.position.set(side * (hw - .045), Math.sin(a) * r * .5, Math.cos(a) * r * .5); g.add(mesh)
  }
  return g
}

/**
 * One track unit: a rubber belt round chrome wheels, with chevron lugs that echo the buggy's
 * swept tyre tread. Local origin is the ground under the pod centre, X is the axle direction.
 */
export function trackPod(m: Mats, circles: Circle[], width: number, lugEvery = 3) {
  const g = new THREE.Group(), thick = .07, hw = width / 2
  let perimeter = 0
  const probe = beltOutline(circles, 240)
  for (let i = 0; i < probe.length; i++) { const a = probe[i], b = probe[(i + 1) % probe.length]; perimeter += Math.hypot(b.z - a.z, b.y - a.y) }
  const n = Math.max(48, Math.round(perimeter / .07 / lugEvery) * lugEvery), pts = beltOutline(circles, n)
  const P = (x: number, off: number) => pts.map(p => new THREE.Vector3(x, p.y - p.ny * off, p.z - p.nz * off))
  const oL = P(-hw, 0), oR = P(hw, 0), iL = P(-hw, thick), iR = P(hw, thick)
  g.add(new THREE.Mesh(mergeGeometries([strip(oL, oR), strip(iL, iR), strip(oL, iL), strip(oR, iR)])!, m.rubber))
  // Chevron lugs: two half width blocks per station, toed in opposite ways.
  const lugH = .055, count = n / lugEvery, lugs = new THREE.InstancedMesh(new THREE.BoxGeometry(hw * 1.06, lugH, .1), m.rubber, count * 2)
  const X = new THREE.Vector3(1, 0, 0), M = new THREE.Matrix4(), R = new THREE.Matrix4()
  for (let i = 0; i < count; i++) {
    const p = pts[i * lugEvery], Y = new THREE.Vector3(0, p.ny, p.nz), Z = new THREE.Vector3().crossVectors(X, Y)
    for (const side of [-1, 1]) {
      M.makeBasis(X, Y, Z).multiply(R.makeRotationY(side * .42))
      M.setPosition(side * hw * .5, p.y + p.ny * lugH * .45, p.z + p.nz * lugH * .45)
      lugs.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), M)
    }
  }
  lugs.instanceMatrix.needsUpdate = true; g.add(lugs)
  // Dark core so the pod is solid between the wheels.
  const shape = new THREE.Shape(); pts.forEach((p, i) => { const z = p.z - p.nz * (thick + .05), y = p.y - p.ny * (thick + .05); if (i) shape.lineTo(z, y); else shape.moveTo(z, y) })
  const coreDepth = width * .62, core = new THREE.ExtrudeGeometry(shape, { depth: coreDepth, bevelEnabled: false }); core.translate(0, 0, -coreDepth / 2); core.rotateY(-Math.PI / 2)
  g.add(new THREE.Mesh(core, m.dark))
  for (const c of circles) { const w = wheel(m, c.r - thick - .005, hw + .025); w.position.set(0, c.y, c.z); g.add(w) }
  return shadow(g)
}

/** Add a mirrored copy across the centreline. */
export function mirrored(parent: THREE.Object3D, part: THREE.Object3D) {
  const wrap = new THREE.Group(); wrap.add(part.clone()); wrap.scale.x = -1
  parent.add(part, wrap)
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
export const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o }

// ---------------------------------------------------------------------------------------------
// Blended bodies. One closed surface per vehicle, so hull, cabin and fenders are a single
// sculpted shape rather than parts stuck together. The surface is a rim curve in plan (half
// width W at each z) with a top and a bottom skin hung from it:
//   y = C(x, z) + T(x, z) * r     on top        r = (1 - |x / W|^p)^(1/p) rounds the rim
//   y = C(x, z) - B(x, z) * r     underneath
// C lifts the rim (arches over the pods), T and B are thickness above and below it.
// ---------------------------------------------------------------------------------------------

export const bell = (u: number) => Math.exp(-u * u)
/** Smooth step from 0 at a to 1 at b. */
export const sm = (v: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
/** Flat topped bump: 1 at the centre, falling off round |u| = 1. Higher k is boxier. */
export const hump = (u: number, k = 6) => 1 / (1 + Math.abs(u) ** k)
/** Rounded end profile for |u| in 0..1. */
export const plan = (u: number, q = 4) => Math.max(0, 1 - Math.min(1, Math.abs(u)) ** q) ** (1 / q)

export interface BodySpec { z0: number; z1: number; W(z: number): number; C(x: number, z: number): number; T(x: number, z: number): number; B(x: number, z: number): number; rim?: number; rings?: number; segs?: number }

export function bodyGeometry(b: BodySpec): THREE.BufferGeometry {
  const rings = b.rings ?? 120, segs = b.segs ?? 160, p = b.rim ?? 5, pos: number[] = [], idx: number[] = []
  for (let i = 0; i <= rings; i++) {
    // Cosine spacing puts more rings where the nose and tail curve in.
    const z = b.z0 + (b.z1 - b.z0) * (.5 - .5 * Math.cos(Math.PI * i / rings)), W = Math.max(.004, b.W(z))
    for (let j = 0; j < segs; j++) {
      const a = j / segs * Math.PI * 2, u = Math.cos(a), x = W * u, r = Math.max(0, 1 - Math.abs(u) ** p) ** (1 / p)
      pos.push(x, b.C(x, z) + (Math.sin(a) >= 0 ? b.T(x, z) : -b.B(x, z)) * r, z)
    }
  }
  // Wound so normals point outward: skin() tells the underside from the top by normal.
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, c = i * segs + (j + 1) % segs, d = a + segs, e = c + segs
    idx.push(a, c, d, c, e, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  const top = (Math.floor(rings / 2) * segs + Math.floor(segs / 4)) * 3 + 1
  if (g.getAttribute('normal').array[top] < 0) { g.setIndex(idx.map((_, k) => idx[k - k % 3 + [0, 2, 1][k % 3]])); g.computeVertexNormals() }
  return g
}

/** A rectangular region of glazing or solar cells cut into the skin. x is |x|. Omitted bounds are open. */
export interface Pane { kind: 'glass' | 'solar'; z: [number, number]; y: [number, number]; x?: [number, number]; pitchZ?: number; pitchX?: number; gap?: number }
/** A round mark at [|x|, y, z]: porthole, lamp, intake. */
export interface Spot { kind: 'glass' | 'glow' | 'tail' | 'dark'; at: [number, number, number]; r: number }
/** A hoop round the body at z, half width w. */
export interface Stripe { z: number; w: number; color: number }
export interface Livery { lower: number; lowerMetal?: number; lowerRough?: number; glass?: number; panes?: Pane[]; spots?: Spot[]; stripes?: Stripe[] }

/**
 * Material for a blended body. Everything is decided per pixel from position and normal, so
 * windows, stripes and the underside are crisp and flush with no textures and no extra geometry.
 */
export function skin(m: Mats, l: Livery) {
  // Shader graph nodes: the TSL types are too loose to be worth threading through.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type N = any
  const p = positionLocal, ax = abs(p.x), e = .006
  const inside = (v: N, lo: number, hi: number): N => smoothstep(lo - e, lo + e, v).mul(oneMinus(smoothstep(hi - e, hi + e, v)))
  const mullion = (v: N, pitch: number, gap: number): N => smoothstep(gap / 2 - e, gap / 2 + e, abs(fract(v.div(pitch)).sub(.5)).mul(pitch))
  const rgb = (hex: number): N => { const c = new THREE.Color(hex); return vec3(c.r, c.g, c.b) }
  const under: N = oneMinus(smoothstep(-.45, -.2, normalLocal.y))
  let color: N = mix(m.paintU as N, rgb(l.lower), under), rough: N = mix(float(.36), float(l.lowerRough ?? .45), under), metal: N = mix(float(.15), float(l.lowerMetal ?? .2), under)
  let glow: N = vec3(0, 0, 0)
  for (const s of l.stripes ?? []) { const k = oneMinus(smoothstep(s.w - e, s.w + e, abs(p.z.sub(s.z)))).mul(oneMinus(under)); color = mix(color, rgb(s.color), k) }
  const put = (k: N, hex: number, r: number, mt: number) => { color = mix(color, rgb(hex), k); rough = mix(rough, float(r), k); metal = mix(metal, float(mt), k) }
  for (const w of l.panes ?? []) {
    let k: N = inside(p.z, w.z[0], w.z[1]).mul(inside(p.y, w.y[0], w.y[1]))
    if (w.x) k = k.mul(inside(ax, w.x[0], w.x[1]))
    if (w.pitchZ) k = k.mul(mullion(p.z, w.pitchZ, w.gap ?? .06))
    if (w.pitchX) k = k.mul(mullion(p.x, w.pitchX, w.gap ?? .06))
    if (w.kind === 'glass') put(k, l.glass ?? 0x05070a, .05, .6); else put(k, 0x0a1838, .22, .7)
  }
  for (const s of l.spots ?? []) {
    const k: N = oneMinus(smoothstep(s.r - e, s.r + e, length(vec3(ax.sub(s.at[0]), p.y.sub(s.at[1]), p.z.sub(s.at[2])))))
    if (s.kind === 'glass') put(k, l.glass ?? 0x05070a, .05, .6)
    else if (s.kind === 'dark') put(k, 0x0c0d10, .6, .3)
    else { put(k, 0x111111, .3, 0); glow = max(glow, rgb(s.kind === 'glow' ? 0xfff2d2 : 0xff2414).mul(k)) }
  }
  const mat = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, clearcoat: .5, clearcoatRoughness: .15 })
  mat.colorNode = color; mat.roughnessNode = min(rough, float(1)); mat.metalnessNode = metal; mat.emissiveNode = glow
  return mat
}

export const body = (m: Mats, spec: BodySpec, livery: Livery) => shadow(new THREE.Mesh(bodyGeometry(spec), skin(m, livery)))

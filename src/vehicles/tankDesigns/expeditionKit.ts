/**
 * Panel-built exploration hulls. A single longitudinal shell defines the nose, cabin and
 * equipment deck. Windows replace faces in that shell; no second cabin is placed on its roof.
 * Coordinates follow the original tank: metres, Y up, nose at -Z, three pods on each side.
 */
import * as T from 'three/webgpu'
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Mats } from './kit'

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
}

type Quad = [T.Vector3, T.Vector3, T.Vector3, T.Vector3]
type Surface = (u: number, t: number) => T.Vector3
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z)

/** One batch per material and rigid assembly, rather than one draw per small fitting. */
class Batch {
  private readonly parts = new Map<T.Material, T.BufferGeometry[]>()
  geometry(material: T.Material, geometry: T.BufferGeometry) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    if (g !== geometry) geometry.dispose()
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key)
    if (!g.attributes.normal) g.computeVertexNormals()
    const list = this.parts.get(material) ?? []; list.push(g); this.parts.set(material, list)
  }
  quad(material: T.Material, q: Quad) {
    const p = [q[0], q[1], q[2], q[0], q[2], q[3]].flatMap(a => a.toArray())
    const g = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(p, 3))
    g.computeVertexNormals(); this.geometry(material, g)
  }
  box(material: T.Material, size: number[], at: number[]) {
    this.geometry(material, new T.BoxGeometry(size[0], size[1], size[2]).translate(at[0], at[1], at[2]))
  }
  rod(material: T.Material, a: T.Vector3, b: T.Vector3, radius: number, segments = 10) {
    const d = b.clone().sub(a), g = new T.CylinderGeometry(radius, radius, d.length(), segments)
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(v(0, 1, 0), d.normalize()))
    g.translate(...a.clone().add(b).multiplyScalar(.5).toArray()); this.geometry(material, g)
  }
  finish(root: T.Object3D, name: string, soften = false) {
    for (const [material, parts] of this.parts) {
      const merged = mergeGeometries(parts)!
      const geometry = soften ? toCreasedNormals(merged, 1.05) : merged
      if (geometry !== merged) merged.dispose()
      const mesh = new T.Mesh(geometry, material); mesh.name = name
      mesh.castShadow = !material.transparent; mesh.receiveShadow = true; root.add(mesh)
      parts.forEach(g => g.dispose())
    }
  }
}

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

function inset(q: Quad, u: number, t: number): Quad {
  const point = (a: number, b: number) => q[0].clone().lerp(q[1], a).lerp(q[3].clone().lerp(q[2], a), b)
  return [point(u, t), point(1 - u, t), point(1 - u, 1 - t), point(u, 1 - t)]
}

function patch(batch: Batch, material: T.Material, surface: Surface, u0 = 0, u1 = 1, t0 = 0, t1 = 1, steps = 1) {
  for (let i = 0; i < steps; i++) {
    const a = t0 + (t1 - t0) * i / steps, b = t0 + (t1 - t0) * (i + 1) / steps
    batch.quad(material, [surface(u0, a), surface(u1, a), surface(u1, b), surface(u0, b)])
  }
}

function surfaceWindow(batch: Batch, m: Mats, surface: Surface, round: boolean, steps: number) {
  if (round) {
    // No rectangular plate behind a circular port: both the opening and its metal rim are round.
    const point = (angle: number, radius: number) => surface(.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius)
    const edge = (angle: number) => {
      const x = Math.cos(angle), y = Math.sin(angle), k = .5 / Math.max(Math.abs(x), Math.abs(y))
      return surface(.5 + x * k, .5 + y * k)
    }
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12
      batch.quad(m.paint, [edge(a), edge(b), point(b, .36), point(a, .36)])
      batch.quad(m.chrome, [point(a, .36), point(b, .36), point(b, .33), point(a, .33)])
      batch.quad(m.field, [surface(.5, .5), point(a, .33), point(b, .33), surface(.5, .5)])
    }
    return
  }
  const frame = (mat: T.Material, u0: number, u1: number, t0: number, t1: number, u: number, t: number) => {
    patch(batch, mat, surface, u0, u, t0, t1, steps)
    patch(batch, mat, surface, 1 - u, u1, t0, t1, steps)
    patch(batch, mat, surface, u, 1 - u, t0, t)
    patch(batch, mat, surface, u, 1 - u, 1 - t, t1)
  }
  frame(m.paint, 0, 1, 0, 1, .09, .13)
  frame(m.chrome, .09, .91, .13, .87, .115, .16)
  patch(batch, m.field, surface, .115, .885, .16, .84, steps)
}

function cap(batch: Batch, material: T.Material, points: T.Vector3[], rear: boolean) {
  const centre = points.reduce((a, p) => a.add(p), v(0, 0, 0)).multiplyScalar(1 / points.length)
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    batch.quad(material, rear ? [centre, b, a, centre] : [centre, a, b, centre])
  }
}

/** Lamps sit on the nose bulkhead, with their housings penetrating it. */
function lamps(batch: Batch, m: Mats, s: Section, rear = false) {
  const [z, w, k, belt] = s, dir = rear ? 1 : -1, y = (k + belt) * .5 + .12
  for (const side of [-1, 1]) {
    if (rear) {
      batch.box(m.dark, [w * .62, .24, .08], [side * w * .48, y, z + .02])
      for (const dy of [-.055, .055]) batch.box(m.tail, [w * .48, .045, .025], [side * w * .48, y + dy, z + .065])
    } else for (const x of [.23, .65, 1.07]) {
      const cx = side * x * Math.min(1, w / 1.3), radius = Math.min(.18, w * .14)
      batch.rod(m.dark, v(cx, y, z - .01), v(cx, y, z - .09), radius * 1.24)
      batch.rod(m.chrome, v(cx, y, z - .085), v(cx, y, z - .11), radius * 1.09)
      batch.rod(m.glow, v(cx, y, z - .11), v(cx, y, z - .12), radius * .85)
    }
  }
  // A wear shoe joined to the hull's keel, not a beam suspended beyond it.
  batch.box(m.dark, [w * 1.52, .22, .22], [0, k + .1, z - dir * .025])
}

function hull(m: Mats, spec: ExpeditionSpec) {
  const root = new T.Group(); root.name = 'Continuous hull and cabin'
  const batch = new Batch(), rings = spec.sections.map(s => ring(s, spec.pressureShell)), [front, last] = spec.cabin
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < 10; j++) {
    const q: Quad = [rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % 10], rings[i][(j + 1) % 10]]
    const surface: Surface = spec.pressureShell ? (u, t) => {
      const a = spec.sections[i], b = spec.sections[i + 1], s = a.map((x, k) => x + (b[k] - x) * u)
      const angle = (72 - (j + t) * 36) * Math.PI / 180
      return v(Math.cos(angle) * s[1], (s[5] + s[2]) * .5 + Math.sin(angle) * (s[5] - s[2]) * .5, s[0])
    } : (u, t) => q[0].clone().lerp(q[1], u).lerp(q[3].clone().lerp(q[2], u), t)
    const steps = spec.pressureShell ? 3 : 1
    const windscreen = i === front && [0, 8, 9].includes(j)
    const sideWindow = i > front && i <= last && [1, 7].includes(j)
    if (windscreen || sideWindow) { surfaceWindow(batch, m, surface, !!spec.portholes && sideWindow, steps); continue }
    const under = j >= 3 && j <= 5
    const stripe = spec.stripe === 'shoulders' && [0, 8].includes(j) || spec.stripe === 'belt' && [2, 6].includes(j)
    patch(batch, under ? m.dark : stripe ? m.accent : m.paint, surface, 0, 1, 0, 1, steps)
    if (spec.stripe === 'centre' && j === 9 && i !== front) {
      const a = q[0].clone().lerp(q[3], .43), b = q[1].clone().lerp(q[2], .43)
      const c = q[1].clone().lerp(q[2], .57), d = q[0].clone().lerp(q[3], .57)
      for (const p of [a, b, c, d]) p.y += .007
      batch.quad(m.accent, [a, b, c, d])
    }
    if (spec.radiator?.includes(i) && [1, 7, 9].includes(j)) {
      const inner = inset(q, .14, .17)
      const n = q[1].clone().sub(q[0]).cross(q[3].clone().sub(q[0])).normalize().multiplyScalar(.008)
      inner.forEach(p => p.add(n)); batch.quad(m.dark, inner)
      for (let k = 1; k < 7; k++) {
        const a = inner[0].clone().lerp(inner[1], k / 7), b = inner[3].clone().lerp(inner[2], k / 7)
        batch.rod(m.chrome, a, b, .018, 5)
      }
    }
  }
  const endRing = (s: Section) => spec.pressureShell ? Array.from({ length: 30 }, (_, i) => {
    const a = (72 - i * 12) * Math.PI / 180
    return v(Math.cos(a) * s[1], (s[5] + s[2]) * .5 + Math.sin(a) * (s[5] - s[2]) * .5, s[0])
  }) : ring(s)
  cap(batch, m.paint, endRing(spec.sections[0]), false); cap(batch, m.paint, endRing(spec.sections.at(-1)!), true)
  lamps(batch, m, spec.sections[0]); lamps(batch, m, spec.sections.at(-1)!, true)
  // Structural bands follow the shell cross-section rather than floating above it.
  for (const i of spec.ribs ?? []) {
    const a = ring(spec.sections[i], spec.pressureShell), b = a.map(p => p.clone().add(v(0, 0, .095)))
    for (let j = 0; j < 10; j++) {
      const expand = (p: T.Vector3) => p.clone().add(v(Math.sign(p.x) * .025, j <= 1 || j >= 7 ? .025 : 0, 0))
      batch.quad(m.accent, [expand(a[j]), expand(b[j]), expand(b[(j + 1) % 10]), expand(a[(j + 1) % 10])])
    }
  }
  const cabinStart = spec.sections[front + 1], cabinEnd = spec.sections[last + 1]
  const eyeY = cabinStart[5] - .68, eyeZ = cabinStart[0] + .45
  const floorY = Math.min(cabinStart[2] + .32, eyeY - .9)
  const cabinLength = cabinEnd[0] - spec.sections[front][0]
  batch.box(m.dark, [cabinStart[1] * 1.65, .12, cabinLength], [0, floorY, (cabinEnd[0] + spec.sections[front][0]) / 2])
  // Interior scale cues: two seats and a low dashboard leave the windscreen clear.
  for (const x of [-.43, .43]) {
    batch.box(m.dark, [.5, .18, .55], [x, eyeY - .68, eyeZ + .12])
    batch.box(m.dark, [.48, .65, .12], [x, eyeY - .4, eyeZ + .41])
    batch.box(m.accent, [.33, .035, .09], [x, eyeY - .13, eyeZ + .335])
  }
  batch.box(m.dark, [cabinStart[4] * 1.5, .14, .3], [0, eyeY - .35, cabinStart[0] - .3])
  for (const x of [-.4, .4]) batch.box(m.accent, [.3, .025, .14], [x, eyeY - .267, cabinStart[0] - .3])
  batch.finish(root, 'Hull panels', spec.pressureShell)
  root.userData.eye = [0, eyeY, eyeZ]
  return root
}

/** A rounded triangular belt, following the original red study's three-wheel tread. */
function track(m: Mats, width: number, detail: number) {
  const batch = new Batch(), root = new T.Group()
  const shape = new T.Shape().moveTo(-.76, .055).lineTo(.76, .055)
    .quadraticCurveTo(1.08, .055, 1.03, .37).lineTo(.29, 1.25)
    .quadraticCurveTo(0, 1.53, -.29, 1.25).lineTo(-1.03, .37)
    .quadraticCurveTo(-1.08, .055, -.76, .055)
  const pts = shape.getSpacedPoints(detail > .5 ? 54 : 36).slice(0, -1), n = pts.length, hw = width / 2
  const outer = (i: number, x: number) => v(x, pts[i].y - .76, pts[i].x)
  const inner = (i: number, x: number) => v(x, (pts[i].y - .7) * .82 + .7 - .76, pts[i].x * .88)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    batch.quad(m.rubber, [outer(i, -hw), outer(j, -hw), outer(j, hw), outer(i, hw)])
    for (const side of [-1, 1]) batch.quad(m.rubber, [outer(i, side * hw), inner(i, side * hw), inner(j, side * hw), outer(j, side * hw)])
    batch.quad(m.dark, [inner(i, -hw), inner(i, hw), inner(j, hw), inner(j, -hw)])
  }
  // Modest geometric cleats keep the study legible before the shared track role is integrated.
  for (let i = 0; i < n; i += 2) {
    const p = pts[i], next = pts[(i + 1) % n], angle = Math.atan2(next.y - p.y, next.x - p.x)
    const g = new T.BoxGeometry(width * 1.04, .055, .09)
    g.rotateX(-angle); g.translate(0, p.y - .76, p.x); batch.geometry(m.rubber, g)
  }
  for (const [z, y, r] of [[-.73, .36, .28], [.73, .36, .28], [0, 1.13, .25]]) {
    batch.rod(m.dark, v(-hw - .015, y - .76, z), v(hw + .015, y - .76, z), r)
    for (const side of [-1, 1]) {
      // Concentric face rings avoid three hidden cylinder caps at every hub.
      const face = (g: T.BufferGeometry, material: T.Material, depth: number) => {
        g.rotateY(side * Math.PI / 2); g.translate(side * (hw + depth), y - .76, z); batch.geometry(material, g)
      }
      face(new T.RingGeometry(r * .49, r * .74, 12), m.chrome, .035)
      face(new T.RingGeometry(r * .2, r * .49, 12), m.accent, .039)
      face(new T.CircleGeometry(r * .2, 12), m.dark, .043)
    }
  }
  batch.finish(root, 'Track and hubs'); return root
}

function fender(batch: Batch, m: Mats, kind: ExpeditionSpec['fender'], axle: number, width: number) {
  const deep = kind === 'deep', swept = kind === 'swept', rounded = kind === 'round'
  const rear = axle === 2, front = axle === 0
  const controls = [
    [-1.19, front ? .48 : 1.05], [-.93, rounded ? 1.26 : 1.4], [-.38, 1.57],
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
  for (let i = 0; i < profile.length - 1; i++) {
    if (rounded) {
      const a = p(i, 0).add(v(0, .09, 0)), b = p(i + 1, 0).add(v(0, .09, 0))
      batch.quad(m.paint, [p(i, -half), p(i + 1, -half), b, a])
      batch.quad(m.paint, [a, b, p(i + 1, half), p(i, half)])
    } else batch.quad(m.paint, [p(i, -half), p(i + 1, -half), p(i + 1, half), p(i, half)])
    batch.quad(m.dark, [p(i, half, thickness), p(i + 1, half, thickness), p(i + 1, -half, thickness), p(i, -half, thickness)])
    for (const side of [-1, 1]) batch.quad(m.accent, [p(i, side * half), p(i + 1, side * half), p(i + 1, side * half, thickness), p(i, side * half, thickness)])
  }
  for (const i of [0, profile.length - 1]) batch.quad(m.paint, [p(i, -half), p(i, half), p(i, half, thickness), p(i, -half, thickness)])
  // A short cast carrier connects each fender directly to its sprocket housing.
  for (const side of [-1, 1]) batch.box(m.dark, [.09, .42, .22], [side * (half - .08), .46, 0])
}

export function buildExpedition(m: Mats, spec: ExpeditionSpec, detail = 1) {
  const root = new T.Group(), shell = hull(m, spec); root.add(shell)
  root.userData.eye = shell.userData.eye
  root.userData.cockpit = true
  const mounts = new Batch(), width = spec.trackWidth ?? .93
  for (const side of [-1, 1]) for (let axle = 0; axle < 3; axle++) {
    const z = (axle - 1) * 2.48, pivot = v(side * 1.37, 1.26, z - .55)
    mounts.rod(m.dark, v(side * 1.1, pivot.y, pivot.z), v(side * 1.63, pivot.y, pivot.z), .22)
    mounts.rod(m.chrome, v(side * 1.62, pivot.y, pivot.z), v(side * 1.67, pivot.y, pivot.z), .16)
    const arm = new T.Group(); arm.name = `Suspension ${side < 0 ? 'left' : 'right'} ${axle + 1}`
    arm.position.copy(pivot); arm.userData.expeditionArm = true; arm.userData.phase = axle * 1.7 + (side < 0 ? .9 : 0)
    const strut = new Batch(), end = v(side * .74, -.5, .55)
    strut.rod(m.dark, v(0, 0, 0), end, .18, 8)
    strut.rod(m.chrome, v(side * .08, -.03, .1), end.clone().multiplyScalar(.84), .07, 10)
    strut.finish(arm, 'Cast swing arm')
    const pod = track(m, width, detail); pod.name = 'Tread with its own fender'; pod.position.copy(end)
    pod.userData.expeditionPod = true
    const guard = new Batch(); fender(guard, m, spec.fender, axle, width); guard.finish(pod, 'Independent fender', spec.fender === 'round')
    arm.add(pod); root.add(arm)
  }
  mounts.finish(root, 'Fixed suspension bosses')
  return root
}

export function poseExpeditionArm(arm: T.Object3D, angle: number, rock: number) {
  arm.rotation.x = angle
  for (const child of arm.children) if (child.userData.expeditionPod) child.rotation.x = -angle + rock
}

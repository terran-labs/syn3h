import * as THREE from 'three/webgpu'
import { skin, byRole, superSections, featureTagger, featureWarp, weld, type BodyPiece, type Candidate, type Ellipse, type Role, type Tagger } from './loft'
import { hullSections, columns, rings, CREASES, HullQuery, sweep, paramsAt } from './hull'
import { HULL } from './dataHull'
import { FEATURES as F, FEATURE_NUMBERS } from './dataFeatures'

/**
 * Level C: the designed hull (hull.ts) and its features. The lab's Skins group loads this
 * module as the loft body (design=generated-loft).
 *
 * Every opening is cut under a separate piece that overlaps the shell, so no edge shows the
 * grid's staircase or a zero-thickness sheet: the cockpit under a swept chrome lip, each scoop
 * under a body-colour lip with a recessed dark pocket behind it, each headlight under a chrome
 * bezel at the mouth of a short duct with the lamp at its floor. Tail lamps are thin bars
 * proud of the rear panel.
 */

const q = new HullQuery(HULL)
const c = F.cockpit, s = F.scoop, h = F.head

/** Cuts and paint drawn on the hull grid. Cuts sit under their lips; the grid snaps to them. */
const CUTS: Ellipse[] = [
  { role: null, plane: 'xz', c: [0, c.z], r: [c.halfWidth, c.halfLength], band: [.35, 2], facing: .1, snap: .035 },
  { role: null, plane: 'zy', c: [s.z, s.y], r: [s.halfLength, s.halfHeight], band: [.45, 1.2], facing: .35, snap: .06, tilt: s.tilt },
  { role: null, plane: 'xy', c: [h.x, h.y], r: [h.r, h.r], band: [-2.2, -1.2], facing: -.25, snap: .04 },
  { role: 'accent', plane: 'xz', c: [0, 0], r: [F.stripe, 99], band: [.2, 2], facing: .2, snap: .08 },
]
const plain: Tagger = (_x, _y, _z, n) => n[1] < -.7 ? 'chrome' : 'paint'
const hullTag = featureTagger(CUTS, plain)
const ALONG: Record<0 | 1 | 2, number> = { 0: 56, 1: 20, 2: 12 }
/** The middle distance keeps the cockpit cut and lip but paints the scoops and lamps on the grid. */
const MID: Ellipse[] = [CUTS[0], { ...CUTS[1], role: 'frame' }, { ...CUTS[2], role: 'lamp' }, CUTS[3]]
const midTag = featureTagger(MID, plain)
const piece = (role: Role, geometry: THREE.BufferGeometry): BodyPiece => ({ part: 'body', role, geometry })

/** The cockpit lip: an elliptical tube swept round the opening, resting on the deck. */
function cockpitLip(n: number, around: number): BodyPiece {
  const path = Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2, x = c.halfWidth * Math.cos(a), z = c.z + c.halfLength * Math.sin(a)
    return new THREE.Vector3(x, q.top(Math.abs(x), z) + c.lipHeight * .3, z)
  })
  return piece('chrome', sweep(path, () => new THREE.Vector3(0, 1, 0), c.lipWidth, c.lipHeight, around, true))
}

/** Rings to a tube surface whose faces look toward `toward` (the pocket's axis); the last ring capped as a floor. */
function pocket(ringsList: THREE.Vector3[][], wall: Role, floor: Role, look: (p: THREE.Vector3) => THREE.Vector3): BodyPiece[] {
  const n = ringsList[0].length, pos: number[] = [], walls: number[] = []
  ringsList.forEach(r => r.forEach(p => pos.push(p.x, p.y, p.z)))
  for (let j = 0; j < ringsList.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, cc = a + n, d = b + n
    walls.push(a, cc, b, b, cc, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(walls)
  orient(g, look); g.computeVertexNormals()
  const last = ringsList[ringsList.length - 1], centre = last.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(n)
  const fp: number[] = []
  for (let i = 0; i < n; i++) { const a = last[i], b = last[(i + 1) % n]; fp.push(centre.x, centre.y, centre.z, a.x, a.y, a.z, b.x, b.y, b.z) }
  const f = new THREE.BufferGeometry(); f.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3))
  orient(f, look); f.computeVertexNormals()
  return [piece(wall, g), piece(floor, weld(f))]
}

/** Flip faces so each normal points along look(face centre). */
function orient(g: THREE.BufferGeometry, look: (p: THREE.Vector3) => THREE.Vector3): void {
  const p = g.getAttribute('position'), idx = g.getIndex(), count = idx ? idx.count : p.count
  const get = (k: number) => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(k) : k)
  for (let t = 0; t < count; t += 3) {
    const A = get(t), B = get(t + 1), C = get(t + 2), nrm = B.clone().sub(A).cross(C.clone().sub(A)), m = A.clone().add(B).add(C).divideScalar(3)
    if (nrm.dot(look(m)) >= 0) continue
    if (idx) { const x = idx.getX(t + 1); idx.setX(t + 1, idx.getX(t + 2)); idx.setX(t + 2, x) }
    else for (let k = 0; k < 3; k++) { const v = p.getComponent(t + 1, k); p.setComponent(t + 1, k, p.getComponent(t + 2, k)); p.setComponent(t + 2, k, v) }
  }
}

/** A side scoop on the right flank (mirrored by the caller): lip, recessed walls and a dark floor. */
function scoop(n: number): BodyPiece[] {
  const at = (a: number, scale: number, inset: number) => {
    const u = s.halfLength * scale * Math.cos(a), w = s.halfHeight * scale * Math.sin(a), ct = Math.cos(s.tilt), st = Math.sin(s.tilt)
    const z = s.z + u * ct - w * st, y = s.y + u * st + w * ct
    return new THREE.Vector3(q.side(y, z) - inset, y, z)
  }
  const rim = Array.from({ length: n }, (_, i) => at(i / n * Math.PI * 2, 1, 0))
  const lip = piece('paint', sweep(rim.map(p => p.clone().add(new THREE.Vector3(.004, 0, 0))), () => new THREE.Vector3(1, 0, 0), s.lip, s.lip * .7, 6, true))
  const steps = [[1, .006], [.94, s.depth * .45], [.86, s.depth]]
  const axis = (p: THREE.Vector3) => new THREE.Vector3(0, s.y - p.y, s.z - p.z).add(new THREE.Vector3(1, 0, 0).multiplyScalar(.02))
  const walls = pocket(steps.map(([k, d]) => Array.from({ length: n }, (_, i) => at(i / n * Math.PI * 2, k, d))), 'frame', 'frame', p => axis(p))
  // The floor faces out of the pocket (+X); walls face the pocket's axis.
  orient(walls[1].geometry, () => new THREE.Vector3(1, 0, 0)); walls[1].geometry.computeVertexNormals()
  return [lip, ...walls]
}

/** A headlight on the right of the nose: chrome bezel, chrome duct, lamp at the floor. */
function headlight(n: number): BodyPiece[] {
  const at = (a: number, scale: number, back: number) => {
    const x = h.x + h.r * scale * Math.cos(a), y = h.y + h.r * scale * Math.sin(a)
    return new THREE.Vector3(x, y, q.front(x, y) + back)
  }
  const rim = Array.from({ length: n }, (_, i) => at(i / n * Math.PI * 2, 1, 0))
  const bezel = piece('chrome', sweep(rim, () => new THREE.Vector3(0, 0, -1), h.bezel, h.bezel * .8, 6, true))
  const steps = [[1, .004], [.92, h.depth * .5], [.85, h.depth]]
  const [duct, lamp] = pocket(steps.map(([k, d]) => Array.from({ length: n }, (_, i) => at(i / n * Math.PI * 2, k, d))), 'chrome', 'lamp', p => new THREE.Vector3(h.x - p.x, h.y - p.y, -.02))
  orient(lamp.geometry, () => new THREE.Vector3(0, 0, -1)); lamp.geometry.computeVertexNormals()
  return [bezel, duct, lamp]
}

/** A thin tail lamp bar on the rear panel, right side. */
function tailBar(detail: 0 | 1 | 2): BodyPiece {
  const t = F.tail, row = (z: number, k: number) => [z, t.depth * k, t.halfHeight * k, t.halfHeight * k, t.y, 4]
  const pieces = skin(superSections([row(-t.halfLength, .6), row(-t.halfLength + .01, 1), row(t.halfLength - .01, 1), row(t.halfLength, .6)]), detail ? 4 : 6, detail ? 3 : 5, () => 'lamp')
  const g = pieces[0].geometry.rotateY(Math.PI / 2).translate(t.x, 0, HULL.z[HULL.z.length - 1])
  return piece('lamp', g)
}

/** Mirror a right-side piece to the left, keeping faces outward. */
function mirrored(p: BodyPiece): BodyPiece {
  const g = p.geometry.clone().scale(-1, 1, 1), idx = g.getIndex()
  if (idx) for (let i = 0; i < idx.count; i += 3) { const x = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, x) }
  else orient(g, () => new THREE.Vector3(0, 0, 0))
  return piece(p.role, g)
}

const wingTag = featureTagger(CUTS.slice(3), plain)
function smallLoft(r: number[][], along: number, half: number, x: number, tag: Tagger): BodyPiece[] {
  const pieces = skin(superSections(r), along, half, (px, py, pz, n) => tag(px + x, py, pz, n))
  if (x) for (const p of pieces) p.geometry.translate(x, 0, 0)
  return pieces
}

const levelC: Candidate = {
  id: 'sections-C',
  numbers: HULL.z.length * 10 + FEATURE_NUMBERS,
  build: detail => {
    const near = detail < 2
    // The distant build is a silhouette: no cuts or fittings, which its cells are too coarse to carry.
    const tag = detail === 0 ? hullTag : detail === 1 ? midTag : plain
    const pieces = skin(hullSections(HULL), 0, 0, tag, { us: rings(ALONG[detail]), vs: columns(detail), creases: CREASES, warp: near ? featureWarp(detail ? [MID[3], ...MID.slice(0, 3)] : [CUTS[3], ...CUTS.slice(0, 3)]) : undefined })
    if (detail === 0) {
      pieces.push(cockpitLip(56, 8))
      for (const p of [...scoop(24), ...headlight(16), tailBar(0)]) pieces.push(p, mirrored(p))
    } else if (detail === 1) {
      pieces.push(cockpitLip(20, 4))
      for (const p of [tailBar(1)]) pieces.push(p, mirrored(p))
    }
    const small = detail === 2 ? 2 : detail ? 3 : 6
    pieces.push(...smallLoft(F.wing, detail === 2 ? 3 : 5, small * 2, 0, wingTag))
    // End plates ride the fin line: each vertex moves out to the hull's shoulder at its z.
    for (const side of [1, -1]) for (const p of smallLoft(F.plate, detail === 2 ? 3 : 6, small, 0, () => 'paint')) {
      const pos = p.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) pos.setX(i, side * (pos.getX(i) + paramsAt(HULL, pos.getZ(i))[4] - F.plateInset))
      if (side < 0) { const idx = p.geometry.getIndex()!; for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t) } }
      p.geometry.computeVertexNormals(); pieces.push(p)
    }
    return byRole(pieces)
  },
}
export default levelC

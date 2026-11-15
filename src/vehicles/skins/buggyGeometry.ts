import * as THREE from 'three/webgpu'
import { mergeStatic, mergedSurfaces } from './mergeStatic'
import { setRole } from './showroom'

/** The approved smooth tyre profile, generated in the wheel frame with axle along X.
 * Same dimensions and chrome ring as the lab study; the shared tyre role supplies tread.
 */
export function smoothBuggyWheel(segments = 16): THREE.Group {
  const group = new THREE.Group()
  const revolve = (profile: number[][], material: THREE.MeshStandardMaterial) => {
    const positions: number[] = [], indices: number[] = []
    for (let i = 0; i < segments; i++) {
      const angle = i * Math.PI * 2 / segments
      for (const [x, r] of profile) positions.push(x, r * Math.cos(angle), r * Math.sin(angle))
    }
    const n = profile.length
    for (let i = 0; i < segments; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = ((i + 1) % segments) * n + j
      indices.push(a, b + 1, a + 1, a, b, b + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices)
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, material)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  revolve([[-.2, .4], [-.245, .44], [-.235, .5], [-.13, .52], [.13, .52], [.235, .5], [.245, .44], [.2, .4]],
    setRole(new THREE.MeshStandardMaterial({ color: 0x171b20 }), 'tyre'))
  revolve([[.2, .4], [.19, .345], [-.19, .345], [-.2, .4]],
    setRole(new THREE.MeshStandardMaterial({ color: 0xc4ccd6 }), 'chrome'))
  mergeStatic(group, true)
  return group
}

/** Authored silhouette sections: z, half width, bottom and shoulder height.
 * Keeps the Box arm's broad fenders, pinched waist and raised tail at distance.
 */
const BODY_SECTIONS = [
  [-1.95, .38, .18, .4], [-1.65, .83, .02, .48], [-1.25, .94, -.06, .63],
  [-.65, .7, .02, .7], [.35, .7, .02, .76], [1.3, .94, -.06, .66],
  [1.8, .75, .18, .6], [2.05, .43, .35, .56],
]

/** A closed, bevelled loft. Section vertices deliberately describe the silhouette, not a
 * decimation of the close mesh. Broad fenders and lamps retain the defining features at distance.
 */
function hull(sections: number[][]): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = []
  for (const [z, width, bottom, top] of sections) {
    const bevel = Math.min(.1, (top - bottom) * .25)
    for (const [x, y] of [[-width * .72, bottom], [width * .72, bottom], [width, bottom + bevel], [width, top - bevel],
      [width * .72, top], [-width * .72, top], [-width, top - bevel], [-width, bottom + bevel]]) positions.push(x, y, z)
  }
  for (let k = 0; k < sections.length - 1; k++) for (let j = 0; j < 8; j++) {
    const a = k * 8 + j, b = k * 8 + (j + 1) % 8
    indices.push(a, b, b + 8, a, b + 8, a + 8)
  }
  for (let j = 1; j < 7; j++) {
    indices.push(0, j + 1, j)
    const end = (sections.length - 1) * 8
    indices.push(end, end + j, end + j + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

export function distantBuggyBody(body: THREE.Color, accent: THREE.Color, far: boolean): THREE.Group {
  const root = new THREE.Group()
  const paint = setRole(new THREE.MeshStandardMaterial({ color: body }), 'paint')
  const stripe = setRole(new THREE.MeshStandardMaterial({ color: accent }), 'accent')
  // Keep Color identities live through mergeStatic, just like the imported near body.
  paint.color = body; stripe.color = accent
  const add = (geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial) => {
    const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; root.add(m); return m
  }
  add(hull(BODY_SECTIONS), paint)
  // The raised rear wing has daylight under it, rather than filling the gap with bodywork.
  add(new THREE.BoxGeometry(1.5, .06, .38).translate(0, .98, 1.7), paint)
  for (const x of [-.62, .62]) add(new THREE.BoxGeometry(.1, .38, .16).translate(x, .78, 1.78), paint)
  // Centre stripe follows the hood and rear deck without a separate draw.
  add(hull(BODY_SECTIONS.map(([z, width, bottom, top]) => [z, Math.min(.18, width * .35), top - .02, top + .006])), stripe)
  // At distance the energy canopy is a solid accent silhouette, sharing the body's draw.
  add(hull([[-.83, .16, .67, .75], [-.4, .48, .67, 1.03], [.5, .49, .7, 1.05], [.9, .22, .7, .78]]), stripe)
  if (!far) {
    const chrome = setRole(new THREE.MeshStandardMaterial({ color: 0xc4ccd6 }), 'chrome')
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(.22, .18, .1).translate(side * .62, .35, -1.7), chrome)
      add(new THREE.BoxGeometry(.34, .045, .035).translate(side * .48, .53, 1.88),
        setRole(new THREE.MeshStandardMaterial({ color: 0x660000, emissive: 0x990000 }), 'lamp'))
    }
  } else {
    const rubber = setRole(new THREE.MeshStandardMaterial({ color: 0x171b20 }), 'tyre')
    for (const x of [-1.1, 1.1]) for (const z of [-1.3, 1.3]) {
      add(new THREE.CylinderGeometry(.52, .52, .49, 6).rotateZ(Math.PI / 2).translate(x, -.2, z), rubber)
    }
  }
  // Wings share the silhouette draw. Their vertices collapse when flight mode is off.
  const wingMaterial = setRole(new THREE.MeshStandardMaterial({ color: accent }), 'accent')
  wingMaterial.color = accent
  const wing = new THREE.BufferGeometry()
  // Convex outline of the original Wings mesh after the skin's X/Y rotations, metres.
  // Keeping the actual 15.95 m span avoids a silhouette jump at the detail boundaries.
  const outline = [[0, -5.3277035], [3.2587297, -3.3822129], [6.5870457, -1.2646298],
    [7.8030319, .0414629], [7.9728508, 1.4176917], [7.8038759, 2.7654877],
    [6.6181126, 3.6556544], [0, 5.2133784]]
  const vertices: number[] = []
  for (const side of [-1, 1]) for (const top of [false, true]) for (let i = 1; i < outline.length - 1; i++) {
    const order = (side > 0) === top ? [0, i + 1, i] : [0, i, i + 1]
    for (const j of order) vertices.push(side * outline[j][0], top ? .15 : .14, outline[j][1])
  }
  wing.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); wing.computeVertexNormals()
  add(wing, wingMaterial)
  mergeStatic(root, true)
  const mesh = root.children[0] as THREE.Mesh
  const surfaces = mergedSurfaces.get(mesh.material as THREE.Material)!
  const wingId = surfaces.indexOf(wingMaterial)
  const pos = mesh.geometry.getAttribute('position'), ids = mesh.geometry.getAttribute('surfaceId')
  const base = new Float32Array(pos.array)
  let wingAmount = -1
  root.userData.setWings = (amount: number) => {
    if (amount === wingAmount) return
    wingAmount = amount
    for (let i = 0; i < pos.count; i++) if (ids.getX(i) === wingId) {
      pos.setXYZ(i, base[i * 3] * amount, base[i * 3 + 1] * amount, amount > 0 ? base[i * 3 + 2] : 0)
    }
    pos.needsUpdate = true; mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox()
  }
  root.userData.setWings(0)
  root.name = far ? 'Box arm silhouette' : 'Box arm mid body'
  return root
}

/** Low-detail box arm and damper in the same hub-to-mount frame as the close suspension. */
export function distantBuggyArm(): THREE.Mesh {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(.42, .8, .12).translate(0, .4, .02),
    setRole(new THREE.MeshStandardMaterial({ color: 0x23272d }), 'frame')))
  root.add(new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, .54, 6).rotateX(-.45).translate(0, .32, -.12),
    setRole(new THREE.MeshStandardMaterial({ color: 0xc4ccd6 }), 'chrome')))
  mergeStatic(root, true)
  return root.children[0] as THREE.Mesh
}

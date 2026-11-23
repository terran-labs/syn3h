/**
 * Design studies for a next-gen Mira tank, round four. Mira never had one; the only tank is
 * the Mars Explorer port in ../Tank.ts. Appearance only: no physics reads these.
 *
 * Owner's brief so far (14 November):
 * - No visible weapons. This is an exploration vehicle.
 * - Six independent articulated treads, as the Mars Explorer tank had.
 * - Round three was too truck-like. He wants NASA and Soviet aerospace: ekranoplans (the Lun
 *   class) and lunar rover prototypes. Integrated sculpted shapes, not primitives stuck together.
 * - A different fender over each pod; the rear ones curve backwards.
 * - A tread hinge with one fixed attach point on the body that swivels cleanly for shock
 *   absorption, with few visible, fragile or triangle-heavy parts.
 *
 * So each body here is ONE blended surface (kit.ts bodyGeometry): hull, cabin and the shelf that
 * arches over the pods. Windows, stripes and lamps are drawn in the shader, flush with the skin.
 *
 * The tread hinge (tread() below) is a trailing arm, the arrangement tanks use for road wheels:
 *   1. A boss on the underside of the body is the only attach point. It holds a transverse
 *      pivot. The spring is a torsion bar inside that boss, so there are no exposed dampers.
 *   2. One solid arm swings on that pivot, trailing back and down to the pod's top sprocket.
 *      Swinging it up or down is the suspension travel: about 0.25 m each way for a 0.78 m arm.
 *   3. The pod turns freely on the arm's end, about the same sprocket axle, so it rocks to lie
 *      flat on the ground whatever the arm is doing. The drive motor sits in that hub.
 * Two joints, both about the vehicle's sideways axis, and three meshes per corner.
 */
import * as THREE from 'three/webgpu'
import { at, bell, blob, body, hump, mirrored, plan, rod, sm, trackPod, V, type Livery, type Mats } from './kit'

/** One round of studies. The lab shows rounds as groups. */
export interface TankDesign { id: string; name: string; tagline: string; color: number; accent?: number; build(m: Mats): THREE.Group }

export const PODZ = [-2.45, 0, 2.45], PX = 2.05, BASE = 1.34
export const ARM_X = 1.5, ARM = .78, REST = Math.asin(.3 / ARM), ORANGE = 0xff5a12

/** One corner of the running gear: fixed boss, trailing arm, pod. See the file header. */
export function tread(m: Mats, z: number, fender?: THREE.Object3D) {
  const g = new THREE.Group(), pivotY = 1.08 + ARM * Math.sin(REST), pivotZ = z - ARM * Math.cos(REST)
  g.add(rod(m.dark, V(1.18, pivotY, pivotZ), V(1.6, pivotY, pivotZ), .14))
  const arm = new THREE.Group(); arm.userData.arm = REST; arm.userData.phase = z * 1.3
  arm.add(blob(m.chrome, [[-.18, .03, .03, .03, 0, 3], [-.13, .09, .13, .13, 0, 3], [0, .11, .17, .17, 0, 3], [ARM, .1, .14, .14, 0, 3], [ARM + .11, .08, .1, .1, 0, 3], [ARM + .15, .03, .03, .03, 0, 3]], 4, 20))
  arm.add(rod(m.dark, V(0, 0, ARM), V(PX - ARM_X - .4, 0, ARM), .11))
  const pod = new THREE.Group(); pod.userData.pod = true
  pod.add(at(trackPod(m, [{ z: -.7, y: .36, r: .36 }, { z: .7, y: .36, r: .36 }, { z: 0, y: 1.08, r: .34 }], .85), 0, -1.08, 0))
  arm.add(at(pod, PX - ARM_X, 0, ARM, -REST))
  // A fender carried on the arm's end rides up and down with its tread. Unlike the pod it does
  // not turn on the axle, so it tips slightly as the arm swings.
  if (fender) { const carrier = new THREE.Group(); carrier.add(fender); arm.add(at(carrier, PX - ARM_X, 0, ARM, -REST)) }
  g.add(at(arm, ARM_X, pivotY, pivotZ, REST))
  return g
}
export const running = (g: THREE.Group, m: Mats) => { for (const z of PODZ) mirrored(g, tread(m, z)) }

/**
 * Height of the body's rim. Inboard it is flat. Outboard it arches over each pod and dips between
 * them, which is the fender. Behind the rear pod it sweeps back and down; ahead of the front pod
 * it drops less, so the three arches differ.
 */
export function shelf(x: number, z: number, arch = .46, tailDrop = .8, noseDrop = .32) {
  const out = sm(Math.abs(x), 1.25, 1.95)
  let a = 0; for (const p of PODZ) a += bell((z - p) / .95)
  return BASE + out * (arch * Math.min(1.05, a) - tailDrop * sm(z, 3.1, 3.95) - noseDrop * sm(-z, 3.25, 3.95))
}
export const W = (z: number, q = 5, w = 2.56) => w * plan(z / 4, q)
/** The body swells into a knuckle round each arm's boss, so the one attach point reads as structure. */
export function knuckle(x: number, z: number) {
  let k = 0; for (const p of PODZ) k += bell((z - (p - ARM * Math.cos(REST))) / .32)
  return k * bell((Math.abs(x) - 1.45) / .3)
}

/** 1. Ekranoplan: a boat hull with a chined, stepped keel, a flight deck hump and twin intake nacelles. */
function lun(m: Mats) {
  const g = new THREE.Group()
  const H = (z: number) => (.5 + .52 * bell((z + 2.15) / .95) + .14 * sm(z, 1.5, 3.4)) * plan(z / 3.92, 3)
  const nacelle = (ax: number, z: number) => .34 * bell((z + 1.0) / .62) * (bell((ax - 1.02) / .2) + bell((ax - 1.5) / .2))
  const livery: Livery = { lower: 0x3b4048, lowerRough: .5, stripes: [{ z: 1.2, w: .05, color: ORANGE }, { z: 1.4, w: .05, color: ORANGE }],
    panes: [{ kind: 'glass', z: [-3.2, -1.5], y: [BASE + .66, BASE + .9], pitchZ: .34, gap: .05 }],
    spots: [{ kind: 'dark', at: [1.02, BASE + .27, -1.62], r: .15 }, { kind: 'dark', at: [1.5, BASE + .3, -1.62], r: .15 }, { kind: 'glow', at: [.42, BASE + .2, -3.72], r: .11 }, { kind: 'tail', at: [.7, BASE + .3, 3.78], r: .12 }] }
  g.add(body(m, { z0: -4, z1: 4, W: z => W(z, 3.4), C: shelf,
    T: (x, z) => .07 + .13 * knuckle(x, z) + H(z) * hump(x / .9, 6) + nacelle(Math.abs(x), z),
    // V bottom that meets the shelf at a hard chine, with a hydroplane step aft of midships.
    B: (x, z) => .06 + .12 * knuckle(x, z) + .66 * Math.max(0, 1 - Math.abs(x) / 1.3) ** .8 * plan(z / 3.9, 2.4) * (1 - .25 * sm(z, .55, .68)) }, livery))
  running(g, m)
  return g
}

/** 2. Lunokhod: a round tub with solar cells in its lid, two camera eyes and a cone antenna. */
function lunokhod(m: Mats) {
  const g = new THREE.Group(), d = (x: number, z: number) => Math.hypot(x / 1.38, z / 2.35)
  const livery: Livery = { lower: 0xb8892a, lowerMetal: 1, lowerRough: .34,
    panes: [{ kind: 'solar', z: [-1.75, 1.75], y: [BASE + 1.0, 4], x: [0, 1.0], pitchZ: .35, pitchX: .34, gap: .03 }],
    spots: [{ kind: 'glass', at: [.34, BASE + .62, -2.2], r: .17 }, { kind: 'glow', at: [.9, BASE + .3, -2.6], r: .1 }, { kind: 'tail', at: [.6, BASE + .5, 2.3], r: .1 }],
    stripes: [{ z: -2.9, w: .04, color: ORANGE }] }
  g.add(body(m, { z0: -4, z1: 4, W: z => W(z, 6), C: shelf,
    T: (x, z) => .07 + .13 * knuckle(x, z) + (.98 * hump(d(x, z), 8) + .1 * bell(d(x, z) / .7)) + .1 * bell((d(x, z) - 1.02) / .09),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .62 * hump(Math.hypot(x / 1.22, z / 2.7), 4) }, livery))
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.2, .42, 24, 1, true), m.chrome); cone.castShadow = true
  g.add(rod(m.chrome, V(-.85, BASE + .9, 1.75), V(-.85, BASE + 1.55, 1.75), .025), at(cone, -.85, BASE + 1.72, 1.75, Math.PI))
  g.add(rod(m.chrome, V(.8, BASE + .9, 1.9), V(.8, BASE + 1.9, 1.9), .02))
  running(g, m)
  return g
}

/** 3. Pressurised rover: a tall cabin with glazing low round the nose, and a suitport module aft. */
function sev(m: Mats) {
  const g = new THREE.Group()
  const livery: Livery = { lower: 0xb8892a, lowerMetal: 1, lowerRough: .34, glass: 0x241a07,
    panes: [{ kind: 'glass', z: [-3.6, -2.72], y: [BASE + .3, BASE + 1.0], x: [0, 1.02], pitchX: .68, gap: .07 }, { kind: 'glass', z: [-2.6, -.55], y: [BASE + .56, BASE + 1.0], x: [.7, 3], pitchZ: .72, gap: .1 }],
    spots: [{ kind: 'dark', at: [.42, BASE + .46, 3.4], r: .27 }, { kind: 'glow', at: [.95, BASE + .16, -3.45], r: .1 }, { kind: 'tail', at: [.86, BASE + .3, 3.42], r: .09 }],
    stripes: [{ z: .78, w: .05, color: ORANGE }] }
  g.add(body(m, { z0: -4, z1: 4, W: z => W(z, 6), C: shelf,
    T: (x, z) => .07 + .13 * knuckle(x, z) + 1.2 * hump((z + 1.25) / 2.0, 10) * hump(x / 1.08, 8) + .66 * hump((z - 2.3) / 1.05, 8) * hump(x / .95, 8) + .14 * hump(x / 1.3, 8) * hump(z / 3.7, 10),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .5 * hump(x / 1.25, 8) * hump(z / 3.6, 10) }, livery))
  running(g, m)
  return g
}

/** 4. Lifting body: a wedge that thickens and widens aft to a blunt base, white over black like an orbiter. */
function lifter(m: Mats) {
  const g = new THREE.Group(), s = (z: number) => sm(z, -3.8, -.2)
  const livery: Livery = { lower: 0x0e0f12, lowerRough: .7, lowerMetal: 0,
    panes: [{ kind: 'glass', z: [-3.1, -1.6], y: [BASE + .34, BASE + .58], x: [0, 1.05], pitchZ: .42, gap: .05 }],
    spots: [{ kind: 'tail', at: [.75, BASE + .5, 3.72], r: .13 }, { kind: 'dark', at: [.28, BASE + .5, 3.74], r: .2 }, { kind: 'glow', at: [.5, BASE + .1, -3.7], r: .09 }],
    stripes: [{ z: -4, w: .42, color: 0x0e0f12 }, { z: 2.2, w: .05, color: ORANGE }] }
  g.add(body(m, { z0: -4, z1: 4, W: z => W(z, 4.2), C: shelf,
    T: (x, z) => .07 + .13 * knuckle(x, z) + (.3 + .8 * s(z)) * hump(x / (.55 + .85 * s(z)), 4) * sm(z, -3.95, -3.4) * (1 - sm(z, 3.4, 3.8)),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .5 * hump(x / 1.3, 6) * plan(z / 3.9, 6) }, livery))
  running(g, m)
  return g
}

/** 5. Mobile laboratory: a pressure vessel with a capsule nose and portholes, cradled in the chassis. */
function molab(m: Mats) {
  const g = new THREE.Group()
  const R = (z: number) => z < -3.78 || z > 3.72 ? 0 : 1.15 * (z < -2.3 ? .3 + .7 * (z + 3.78) / 1.48 : z > 2.9 ? Math.sqrt(Math.max(0, 1 - ((z - 2.9) / .84) ** 2)) : 1)
  const arc0 = (x: number, z: number) => { const r = R(z); return Math.abs(x) < r ? Math.sqrt(r * r - x * x) : 0 }
  // Averaged over a few centimetres: a wall that meets the deck dead vertical aliases against the mesh.
  const arc = (x: number, z: number) => (arc0(x - .09, z) + 2 * arc0(x, z) + arc0(x + .09, z)) / 4
  const livery: Livery = { lower: 0x6f757d, lowerMetal: .8, lowerRough: .4,
    spots: [...[-1.5, -.5, .5, 1.5].map(z => ({ kind: 'glass' as const, at: [1.03, BASE + .5, z] as [number, number, number], r: .18 })),
      { kind: 'glass', at: [.42, BASE + .46, -3.2], r: .2 }, { kind: 'dark', at: [0, BASE + .3, 3.72], r: .5 }, { kind: 'glow', at: [1.5, BASE + .08, -3.2], r: .1 }, { kind: 'tail', at: [1.5, BASE + .1, 3.3], r: .1 }],
    stripes: [{ z: -2.24, w: .06, color: ORANGE }, { z: 2.3, w: .28, color: 0x0e0f12 }, { z: -1, w: .012, color: 0x555a61 }, { z: 0, w: .012, color: 0x555a61 }, { z: 1, w: .012, color: 0x555a61 }] }
  g.add(body(m, { z0: -4, z1: 4, W: z => W(z, 6), C: (x, z) => shelf(x, z, .46, .8, .5), rings: 150,
    T: (x, z) => .07 + .13 * knuckle(x, z) + arc(x, z) + .1 * hump(x / 1.45, 8) * hump(z / 3.5, 10),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .52 * arc(x, z) / 1.15 + .12 * hump(x / 1.3, 8) * hump(z / 3.6, 10) }, livery))
  const dish = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [.16, .02], [.32, .08], [.46, .2]].map(p => new THREE.Vector2(p[0], p[1])), 32), m.chrome); dish.castShadow = true
  g.add(rod(m.chrome, V(0, BASE + 1.1, 2.3), V(0, BASE + 1.75, 2.3), .03), at(dish, 0, BASE + 1.75, 2.3, -.6))
  running(g, m)
  return g
}

export const designs: TankDesign[] = [
  { id: 'lun', name: 'Lun', tagline: 'Ekranoplan: boat hull, stepped keel, flight deck, twin intakes', color: 0xc3c9cf, build: lun },
  { id: 'lunokhod', name: 'Lunokhod', tagline: 'Round tub with solar cells in the lid, over gold foil', color: 0xe4e6e8, build: lunokhod },
  { id: 'sev', name: 'Pressurised rover', tagline: 'Tall cabin glazed low round the nose, suitport module aft', color: 0xeceef0, build: sev },
  { id: 'lifter', name: 'Lifting body', tagline: 'A wedge that grows to a blunt base, white over black', color: 0xf0f1f2, build: lifter },
  { id: 'molab', name: 'Mobile lab', tagline: 'Pressure vessel with a capsule nose, cradled in the chassis', color: 0xe9ebed, build: molab },
]

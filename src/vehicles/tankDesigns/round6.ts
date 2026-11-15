/**
 * Round six of the next-gen tank studies. Read designs.ts first for the brief and shared helpers.
 *
 * Owner's notes on round five (14 November): the Rover is the best and its proportions are
 * right, but its bumper floats off the body and its styling is plain. Bring in the styling of
 * the approved buggy (round 4 "Box arm" on the Wide body), but massive, ponderous and
 * unstoppable where the buggy is sleek.
 *
 * What the buggy lead reports he singled out there, and where it went here:
 * - a muscular stance with swollen shoulders and haunches and a pinched waist: the hull;
 * - big exposed structural suspension with a visible spring: each tread hangs from one heavy
 *   painted swing arm that is also its fender, with one coilover up to a tower on the hull;
 * - prominent lamps and bold, simple tail lights that cross nothing: six lamps in chrome halo
 *   rings on the nose wall, two stacked bars each side on the tail wall;
 * - the force field cockpit, shiny metal, the accent centre stripe, dark side scoops and the
 *   accent motor ring on every wheel.
 * He disliked thin struts, suspension hidden between body and wheel, and lamps or bumpers that
 * float off the body. So the bumpers here are the lower lip of the body itself.
 */
import * as THREE from 'three/webgpu'
import { at, bell, blob, body, hump, mirrored, port, rod, sm, trackPod, tube, V, type Lamp, type Livery, type Mats, type Station } from './kit'
import { ARM, ARM_X, BASE, PODZ, PX, REST, W, knuckle, type TankDesign } from './designs'

type Kind = 'front' | 'mid' | 'rear'
/** Fender shapes in the tread's frame (origin on the sprocket axle). Squarer and deeper than round five. */
const FENDER: Record<Kind, Station[]> = {
  front: [[-1.5, .05, .03, .03, -.3], [-1.26, .43, .13, .09, .08, 6], [-.8, .47, .17, .1, .54, 6], [0, .48, .18, .1, .66, 6], [.7, .46, .16, .1, .62, 6], [1.05, .4, .12, .08, .52, 6], [1.2, .05, .03, .03, .48]],
  mid: [[-1.2, .05, .03, .03, .46], [-.95, .43, .14, .09, .58, 6], [0, .47, .18, .1, .66, 6], [.95, .43, .14, .09, .58, 6], [1.2, .05, .03, .03, .46]],
  rear: [[-1.1, .05, .03, .03, .46], [-.85, .43, .14, .09, .56, 6], [-.1, .47, .17, .1, .7, 6], [.6, .49, .19, .1, .84, 6], [1.15, .48, .17, .1, .76, 6], [1.54, .43, .13, .09, .38, 6], [1.8, .36, .1, .07, -.12, 6], [1.92, .05, .03, .03, -.34]],
}
/** Where the coilover meets the swing arm, in the arm's frame: [outboard, above the arm, along it]. */
const COIL_ON_ARM = [.06, .3, .3]
/** Half width of the hull between the treads. Narrow enough to leave the arms and springs in the open. */
const HULL = 1.36

/**
 * One corner. The swing arm and the fender are one painted part: a heavy box section that hinges
 * on a boss on the hull, runs back and out over the tread, and carries the pod on its end. One
 * coilover stands between it and a tower on the hull. Three moving parts: arm, pod, coilover.
 */
function tread(m: Mats, kind: Kind, z: number) {
  const g = new THREE.Group(), pivotY = 1.08 + ARM * Math.sin(REST), pivotZ = z - ARM * Math.cos(REST)
  g.add(rod(m.chrome, V(1.0, pivotY, pivotZ), V(1.66, pivotY, pivotZ), .16))
  const arm = new THREE.Group(); arm.userData.arm = REST; arm.userData.phase = z * 1.3
  arm.add(rod(m.dark, V(0, 0, ARM), V(PX - ARM_X - .4, 0, ARM), .11))
  const pod = new THREE.Group(); pod.userData.pod = true
  pod.add(at(trackPod(m, [{ z: -.7, y: .36, r: .36 }, { z: .7, y: .36, r: .36 }, { z: 0, y: 1.08, r: .34 }], .85), 0, -1.08, 0))
  arm.add(at(pod, PX - ARM_X, 0, ARM, -REST))
  // Level at rest: the fender, and the box section root that reaches forward and inboard to the hinge.
  const shell = new THREE.Group(), hx = -(PX - ARM_X)
  shell.add(at(blob(m.paint, FENDER[kind], 8, 36), .15, 0, 0))
  shell.add(blob(m.paint, [[-1.02, .04, .03, .03, .3, 5, hx], [-.86, .24, .19, .17, .3, 5, hx], [-.5, .3, .19, .15, .42, 5, hx + .2], [-.12, .36, .15, .12, .56, 5, hx + .42], [.2, .04, .03, .03, .6, 5, hx + .5]], 6, 28))
  shell.add(blob(m.accent, [[-.9, .02, .02, .02, .5, 3, hx], [-.78, .07, .05, .03, .51, 3, hx], [-.45, .07, .05, .03, .63, 3, hx + .23], [-.1, .07, .05, .03, .73, 3, hx + .43], [.05, .02, .02, .02, .74, 3, hx + .5]], 4, 12))
  arm.add(at(shell, PX - ARM_X, 0, ARM, -REST))
  g.add(at(arm, ARM_X, pivotY, pivotZ, REST))
  // Coilover, modelled one unit long along +Z and stretched between its two mounts each frame.
  const coil = new THREE.Group(), cyl = (mat: THREE.Material, r: number, a: number, b: number) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, b - a, 12).rotateX(Math.PI / 2).translate(0, 0, (a + b) / 2), mat); c.castShadow = true; return c }
  coil.add(cyl(m.dark, .07, 0, 1), cyl(m.chrome, .12, 0, .13), cyl(m.chrome, .12, .87, 1))
  for (let i = 0; i < 5; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.135, .04, 6, 14), m.accent); ring.position.z = .22 + i * .14; ring.castShadow = true; coil.add(ring) }
  coil.position.set(1.04, BASE + .7, pivotZ + .2); g.add(coil)
  // Flags, not references: mirrored() clones this group, and a clone's userData is a JSON copy.
  coil.userData.coil = true; arm.userData.pivot = [ARM_X, pivotY, pivotZ]
  poseArm(arm, REST, 0)
  return g
}

/** Swings one arm to `swing` radians, keeps its pod level plus `rock`, and re-aims its coilover. Allocates nothing. */
export function poseArm(arm: THREE.Object3D, swing: number, rock: number) {
  arm.rotation.x = swing
  for (const c of arm.children) if (c.userData.pod) c.rotation.x = -swing + rock
  const p = arm.userData.pivot as number[] | undefined
  let coil: THREE.Object3D | undefined
  if (arm.parent) for (const c of arm.parent.children) if (c.userData.coil) coil = c
  if (!coil || !p) return
  const [lx, ly, d] = COIL_ON_ARM, sin = Math.sin(swing), cos = Math.cos(swing)
  const dx = p[0] + lx - coil.position.x, dy = p[1] + ly * cos - d * sin - coil.position.y, dz = p[2] + ly * sin + d * cos - coil.position.z
  const len = Math.hypot(dx, dy, dz)
  coil.rotation.set(Math.atan2(-dy, dz), Math.asin(dx / len), 0); coil.scale.z = len
}

interface Shape {
  /** Cockpit: centre, half length, half width, height of the painted cowl, height of the force field above it, squareness of each. */
  cab: { z: number; len: number; wide: number; cowl: number; dome: number; k: number; domeN: number }
  /** Rear module: centre, half length, half width, height. */
  aft: { z: number; len: number; wide: number; h: number }
  deck: number; haunch: number; shoulder: number; waist: number
  stripes: [number, number][]; hoop?: boolean; scoop?: boolean
}

const ends = (z: number) => sm(z, -3.97, -3.72) * (1 - sm(z, 3.72, 3.97))

function heavy(m: Mats, o: Shape) {
  const g = new THREE.Group(), c = o.cab, a = o.aft
  const towers = (x: number, z: number) => { let t = 0; for (const p of PODZ) t += hump((z - (p - ARM * Math.cos(REST) + .2)) / .2, 6); return t * hump((Math.abs(x) - 1.06) / .17, 6) }
  const cowlTop = BASE + .07 + o.deck + c.cowl
  const lamps: Lamp[] = [...[.22, .64, 1.06].map(x => ({ kind: 'head' as const, x, y: BASE + .08 + o.deck * .5, r: .185, z: [-4.1, -3.55] as [number, number] }))]
  const livery: Livery = { lower: 0x14161a, lowerRough: .6, lowerMetal: .3, lamps, bands: o.stripes.map(x => ({ x })),
    panes: [
      // The cockpit opening under the force field.
      { kind: 'dark', z: [c.z - c.len * .8, c.z + c.len * .8], y: [cowlTop - .06, 9], x: [0, c.wide * .76] },
      // Windscreen and side openings cut into the cowl, so the driver sees out under the field.
      { kind: 'dark', z: [c.z - c.len - .3, c.z - c.len * .82], y: [cowlTop - c.cowl * .5, cowlTop - .08], x: [0, c.wide * .74], pitchX: c.wide * .74, gap: .07 },
      { kind: 'dark', z: [c.z - c.len * .74, c.z + c.len * .5], y: [cowlTop - c.cowl * .46, cowlTop - .1], x: [c.wide * .8, 3], pitchZ: c.len * .62, gap: .1 },
      // Bumpers: the body's own lower lip, in dark armour, front and rear.
      { kind: 'dark', z: [3.42, 4.1], y: [0, BASE - .1] }, { kind: 'dark', z: [-4.1, -3.42], y: [0, BASE - .1] },
      // Two stacked tail bars each side, clear of the stripe and the corners.
      { kind: 'tail', z: [3.55, 4.1], y: [BASE + o.deck * .62, BASE + o.deck * .62 + .07], x: [.42, 1.12] },
      { kind: 'tail', z: [3.55, 4.1], y: [BASE + o.deck * .32, BASE + o.deck * .32 + .07], x: [.42, 1.12] },
      { kind: 'tail', z: [3.6, 4.1], y: [BASE - .42, BASE - .34], x: [.4, 1.05] },
    ],
    spots: [-1.22, 1.22].map(z => ({ kind: 'dark' as const, at: [HULL - .05, BASE + o.deck * .5, z] as [number, number, number], r: .2, long: 2.6 })) }
  g.add(body(m, { z0: -4, z1: 4, rim: 6,
    // Shoulders and haunches swell, the waist pinches between the treads.
    W: z => W(z, 8, HULL) * (1 - o.waist * (bell((z + 1.22) / .55) + bell((z - 1.22) / .55))),
    C: () => BASE,
    T: (x, z) => .07 + .05 * knuckle(x, z) + .26 * towers(x, z) + o.deck * hump(x / 1.8, 8) * ends(z)
      + c.cowl * hump((z - c.z) / c.len, c.k) * hump(x / c.wide, c.k) + a.h * hump((z - a.z) / a.len, 8) * hump(x / a.wide, 8)
      + o.haunch * hump((z - 2.5) / .95, 4) * hump((Math.abs(x) - .95) / .36, 4) + o.shoulder * hump((z + 3.2) / .6, 4) * hump((Math.abs(x) - .95) / .36, 4),
    B: (x, z) => .06 + .1 * knuckle(x, z) + .5 * hump(x / 1.15, 8) * hump(z / 3.6, 10) + .34 * hump(x / 1.3, 8) * (sm(z, 3.1, 3.55) + sm(-z, 3.1, 3.55)) }, livery))
  // Force field over the cockpit.
  const y = cowlTop - .1, L = c.len * .98, w = c.wide * .9
  g.add(blob(m.field, [[c.z - L, .04, .03, 0, y, c.domeN], [c.z - L * .9, w * .8, c.dome * .5, 0, y, c.domeN], [c.z - L * .45, w, c.dome * .96, 0, y, c.domeN], [c.z + L * .3, w, c.dome, 0, y, c.domeN], [c.z + L * .9, w * .84, c.dome * .6, 0, y, c.domeN], [c.z + L, .04, .03, 0, y, c.domeN]], 8, 36))
  if (o.hoop) { const z = c.z + c.len + .3, b = BASE + o.deck; g.add(tube(m.paint, [[-1.12, b - .1, z], [-1.08, b + c.cowl + c.dome * .7, z + .12], [-.7, b + c.cowl + c.dome + .12, z + .2], [.7, b + c.cowl + c.dome + .12, z + .2], [1.08, b + c.cowl + c.dome * .7, z + .12], [1.12, b - .1, z]], .13)) }
  if (o.scoop) g.add(at(port(m, .42, .16, .04), 0, BASE + .07 + o.deck + a.h + .04, a.z - a.len * .55, -1.25))
  ;(['front', 'mid', 'rear'] as Kind[]).forEach((k, i) => mirrored(g, tread(m, k, PODZ[i])))
  return g
}

// The Rover's proportions: a cab 2.9 m long and 2.1 m wide at the nose, a lower module behind it.
const ROVER = { z: -1.9, len: 1.45, wide: 1.0 }
const shapes: Record<string, Shape> = {
  // The straight translation: Rover masses, buggy dress.
  juggernaut: { cab: { ...ROVER, cowl: 1.05, dome: .62, k: 8, domeN: 3.4 }, aft: { z: 2.25, len: 1.2, wide: .9, h: .58 }, deck: .5, haunch: .2, shoulder: .12, waist: .06, stripes: [[0, .26]], scoop: true },
  // The buggy's muscle turned up: big haunches and shoulders, deep waist, a roll hoop behind the cab.
  bulwark: { cab: { ...ROVER, len: 1.3, cowl: .95, dome: .7, k: 6, domeN: 2.6 }, aft: { z: 2.2, len: 1.25, wide: .8, h: .42 }, deck: .5, haunch: .42, shoulder: .26, waist: .11, stripes: [[0, .26]], hoop: true },
  // Slab sided and tallest: a deep deck, a square cowl with a low wide field, twin stripes.
  monolith: { cab: { ...ROVER, cowl: 1.25, dome: .42, k: 12, domeN: 5 }, aft: { z: 2.2, len: 1.3, wide: 1.0, h: .8 }, deck: .62, haunch: .06, shoulder: .06, waist: .02, stripes: [[.2, .42]] },
  // Cab forward under a tall bubble, a long low engine deck with a chrome scoop.
  bubble: { cab: { z: -2.2, len: 1.15, wide: 1.0, cowl: .8, dome: 1.1, k: 6, domeN: 2.2 }, aft: { z: 1.6, len: 1.9, wide: .9, h: .4 }, deck: .5, haunch: .26, shoulder: .16, waist: .08, stripes: [[0, .26]], scoop: true },
  // One long cabin from nose to past midships, like a land train, with the hoop at its back.
  longhouse: { cab: { z: -1.2, len: 2.1, wide: 1.0, cowl: 1.0, dome: .6, k: 10, domeN: 3.2 }, aft: { z: 2.75, len: .8, wide: .95, h: .5 }, deck: .52, haunch: .22, shoulder: .1, waist: .05, stripes: [[0, .1], [.2, .3]], hoop: true },
}
const design = (id: string, name: string, tagline: string, color: number, accent: number): TankDesign => ({ id, name, tagline, color, accent, build: m => heavy(m, shapes[id]) })

export const round6: TankDesign[] = [
  design('juggernaut', 'Juggernaut', 'The Rover\'s masses in the buggy\'s dress', 0x0d1cae, 0xf09a1a),
  design('bulwark', 'Bulwark', 'Big haunches and shoulders, deep waist, roll hoop', 0x8a0f14, 0xf0a020),
  design('monolith', 'Monolith', 'Slab sided and tallest, low wide field, twin stripes', 0x2a2d33, 0xff5a12),
  design('bubble', 'Bubble', 'Cab forward under a tall bubble, long engine deck', 0xe9ebed, 0x0d6bd6),
  design('longhouse', 'Longhouse', 'One long cabin, hoop at its back', 0x1f5a3a, 0xe8dcb4),
]

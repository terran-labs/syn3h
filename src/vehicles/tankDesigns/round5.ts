/**
 * Round five of the next-gen tank studies. Read designs.ts first: it has the brief, the tread
 * hinge and the shared body helpers.
 *
 * Owner's notes on round four (14 November): the direction is right. The lifting body's cockpit
 * is the best shape but too small, so give the front a cockpit bulge much higher than the rest of
 * the vehicle, big enough that sitting in it makes sense. Carry all of round four's body ideas
 * forward. Add a bunch of massive headlights and a much more solid rear bumper. A few variants
 * should bring back a separate, independently articulated fender for each tread.
 *
 * So every design here has: a deck about 0.45 m deep with a bluff nose and tail wall, a cockpit
 * bulge 2.2 m long, 1.7 m wide and at least 0.5 m taller than anything behind it, six 0.42 m
 * headlamps across the nose wall, and a bumper beam. Designs 1 and 2 keep the fenders as part
 * of the body. Designs 3 to 5 have a narrower hull and a fender on each tread's arm.
 */
import * as THREE from 'three/webgpu'
import { at, bell, blob, body, hump, mirrored, plan, rod, slab, sm, V, type Lamp, type Livery, type Mats, type Station } from './kit'
import { BASE, ORANGE, PODZ, PX, knuckle, running, shelf, tread, W, type TankDesign } from './designs'

/** Bluff walls at nose and tail, where the lamps go. */
const ends = (z: number) => sm(z, -3.97, -3.72) * (1 - sm(z, 3.72, 3.97))
const deck = (x: number, z: number, h = .4) => h * hump(x / 1.8, 8) * ends(z)
/** The cockpit: a soft dome centred on zc. */
const cab = (x: number, z: number, zc: number, len: number, wide: number, h: number, k = 4) => h * hump((z - zc) / len, k) * hump(x / wide, k)

/** Six big headlamps on the nose wall and four tail lamps on the tail wall. */
const lamps = (r = .21, y = BASE + .28, xs = [.3, .88, 1.46]): Lamp[] => [
  ...xs.map(x => ({ kind: 'head' as const, x, y, r, z: [-4.1, -3.55] as [number, number] })),
  ...[.95, 1.4].map(x => ({ kind: 'tail' as const, x, y, r: .13, z: [3.55, 4.1] as [number, number] })),
]

/** Solid rear bumper: one deep beam wrapped round the tail on two stout posts, with lamp bars let into it. */
function bumper(g: THREE.Group, m: Mats, half: number) {
  const h = half, beam = blob(m.dark, [[-h - .12, .06, .05, .05, 0, 4, .34], [-h, .2, .2, .2, 0, 4, .26], [-h * .72, .23, .22, .22, 0, 4, .04], [0, .23, .22, .22, 0, 4, 0], [h * .72, .23, .22, .22, 0, 4, .04], [h, .2, .2, .2, 0, 4, .26], [h + .12, .06, .05, .05, 0, 4, .34]], 8, 28)
  g.add(at(beam, 0, .84, 4.02, 0, Math.PI / 2))
  mirrored(g, rod(m.dark, V(.7, .84, 3.86), V(.7, 1.3, 3.55), .11))
  mirrored(g, at(slab(m.tail, h * .42, .08, .04, 4), h * .5, .88, 4.25))
  g.add(at(slab(m.chrome, h * 1.3, .03, .3, 4), 0, 1.07, 4.02))
}

type Kind = 'front' | 'mid' | 'rear'
/** Separate fenders, in the tread's own frame (origin on the sprocket axle). The rear one sweeps back and down. */
const FENDER: Record<Kind, Station[]> = {
  front: [[-1.45, .05, .03, .03, -.2], [-1.2, .42, .11, .07, .12, 3], [-.75, .5, .14, .08, .52, 3], [0, .52, .15, .08, .64, 3], [.7, .48, .13, .08, .6, 3], [1.05, .4, .1, .06, .5, 3], [1.2, .05, .03, .03, .46]],
  mid: [[-1.15, .05, .03, .03, .48], [-.9, .42, .11, .07, .58, 3], [0, .48, .14, .08, .64, 3], [.9, .42, .11, .07, .58, 3], [1.15, .05, .03, .03, .48]],
  rear: [[-1.1, .05, .03, .03, .46], [-.85, .42, .11, .07, .56, 3], [-.1, .5, .14, .08, .68, 3], [.6, .54, .16, .08, .8, 3], [1.15, .52, .14, .08, .72, 3], [1.52, .44, .11, .07, .36, 3], [1.76, .36, .08, .05, -.1, 3], [1.86, .05, .03, .03, -.3]],
}
function fender(m: Mats, kind: Kind) {
  const g = new THREE.Group()
  g.add(at(blob(m.paint, FENDER[kind], 8, 36), .06, 0, 0), rod(m.chrome, V(-.5, .02, 0), V(-.32, .54, 0), .08, .06))
  return g
}
/** Six treads, each carrying its own fender. */
const runningFendered = (g: THREE.Group, m: Mats) => (['front', 'mid', 'rear'] as Kind[]).forEach((k, i) => mirrored(g, tread(m, PODZ[i], fender(m, k))))
/** Narrow hull for the designs whose fenders are separate. */
const narrow = (z: number) => W(z, 8, 1.6)
/** Lamp spacing that fits the narrow hull's nose. */
const NARROW_LAMPS = [.26, .76, 1.26]

/** 1. Orbiter: round four's lifting body with the tall cockpit, white over black tiles. */
function orbiter(m: Mats) {
  const g = new THREE.Group(), s = (z: number) => sm(z, -3.8, -.2)
  const livery: Livery = { lower: 0x0e0f12, lowerRough: .7, lowerMetal: 0, lamps: lamps(),
    panes: [{ kind: 'glass', z: [-3.4, -.85], y: [BASE + 1.2, BASE + 1.66], x: [0, 1], pitchZ: .52, gap: .06 }],
    stripes: [{ z: 2.3, w: .05, color: ORANGE }, { z: 2.5, w: .05, color: ORANGE }] }
  g.add(body(m, { z0: -4, z1: 4, W: z => W(z, 8), C: (x, z) => shelf(x, z, .46, .5, .3),
    T: (x, z) => .07 + .13 * knuckle(x, z) + deck(x, z) + (.12 + .55 * s(z)) * hump(x / (.6 + .75 * s(z)), 4) * ends(z) * (1 - sm(z, 3.3, 3.75)) + cab(x, z, -2.05, 1.12, .84, 1.08),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .5 * hump(x / 1.3, 6) * plan(z / 3.9, 6) }, livery))
  bumper(g, m, 1.25); running(g, m)
  return g
}

/** 2. Lun: the ekranoplan's keel and shoulders, its flight deck grown into the cockpit, two more lamps in each nacelle. */
function lun(m: Mats) {
  const g = new THREE.Group()
  const spine = (z: number) => (.3 + .12 * sm(z, 1.2, 3.3)) * ends(z)
  const nacelle = (ax: number, z: number) => .5 * bell((z + 1.2) / .7) * (bell((ax - 1.02) / .23) + bell((ax - 1.54) / .23))
  const livery: Livery = { lower: 0x3b4048, lowerRough: .5,
    lamps: [...lamps(), ...[1.02, 1.54].map(x => ({ kind: 'head' as const, x, y: BASE + .5, r: .19, z: [-2.6, -1.35] as [number, number] }))],
    panes: [{ kind: 'glass', z: [-3.5, -1.2], y: [BASE + 1.22, BASE + 1.62], x: [0, 1], pitchZ: .4, gap: .05 }],
    stripes: [{ z: 1.2, w: .05, color: ORANGE }, { z: 1.4, w: .05, color: ORANGE }] }
  g.add(body(m, { z0: -4, z1: 4, W: z => W(z, 7), C: (x, z) => shelf(x, z, .46, .5, .3),
    T: (x, z) => .07 + .13 * knuckle(x, z) + deck(x, z, .34) + spine(z) * hump(x / .9, 6) + nacelle(Math.abs(x), z) + cab(x, z, -2.3, 1.05, .82, 1.12),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .66 * Math.max(0, 1 - Math.abs(x) / 1.3) ** .8 * plan(z / 3.9, 2.4) * (1 - .25 * sm(z, .55, .68)) }, livery))
  bumper(g, m, 1.25); running(g, m)
  return g
}

/** 3. Lunokhod: the solar lidded tub behind the cockpit, over gold foil, with a fender on every tread. */
function lunokhod(m: Mats) {
  const g = new THREE.Group(), d = (x: number, z: number) => Math.hypot(x / 1.28, (z - 1.05) / 2.0)
  const livery: Livery = { lower: 0xb8892a, lowerMetal: 1, lowerRough: .34, lamps: lamps(.2, BASE + .28, NARROW_LAMPS),
    panes: [{ kind: 'glass', z: [-3.6, -1.35], y: [BASE + 1.0, BASE + 1.46], x: [0, 1], pitchZ: .5, gap: .06 },
      { kind: 'solar', z: [-.45, 2.55], y: [BASE + 1.2, 4], x: [0, .92], pitchZ: .35, pitchX: .34, gap: .03 }],
    stripes: [{ z: -1.02, w: .04, color: ORANGE }] }
  g.add(body(m, { z0: -4, z1: 4, W: narrow, C: () => BASE,
    T: (x, z) => .07 + .13 * knuckle(x, z) + deck(x, z) + .78 * hump(d(x, z), 8) + .08 * bell((d(x, z) - 1.02) / .09) + cab(x, z, -2.35, .95, .84, 1.2),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .6 * hump(Math.hypot(x / 1.22, z / 2.9), 4) }, livery))
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.2, .42, 24, 1, true), m.chrome); cone.castShadow = true
  g.add(rod(m.chrome, V(-.9, BASE + 1.1, 2.6), V(-.9, BASE + 1.75, 2.6), .025), at(cone, -.9, BASE + 1.92, 2.6, Math.PI))
  bumper(g, m, 1.6); runningFendered(g, m)
  return g
}

/** 4. Rover: the pressurised cabin made the cockpit, tall and glazed low, a suitport module aft, a fender on every tread. */
function rover(m: Mats) {
  const g = new THREE.Group()
  const livery: Livery = { lower: 0xb8892a, lowerMetal: 1, lowerRough: .34, glass: 0x241a07, lamps: lamps(.2, BASE + .28, NARROW_LAMPS),
    panes: [{ kind: 'glass', z: [-3.7, -3.0], y: [BASE + .66, BASE + 1.5], x: [0, .98], pitchX: .66, gap: .07 },
      { kind: 'glass', z: [-2.9, -.75], y: [BASE + 1.0, BASE + 1.5], x: [.7, 3], pitchZ: .72, gap: .1 }],
    spots: [{ kind: 'dark', at: [.42, BASE + .72, 3.42], r: .25 }],
    stripes: [{ z: -.28, w: .05, color: ORANGE }] }
  g.add(body(m, { z0: -4, z1: 4, W: narrow, C: () => BASE,
    T: (x, z) => .07 + .13 * knuckle(x, z) + deck(x, z) + cab(x, z, -1.9, 1.45, 1.05, 1.32, 8) + .58 * hump((z - 2.25) / 1.2, 8) * hump(x / .95, 8),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .5 * hump(x / 1.25, 8) * hump(z / 3.6, 10) }, livery))
  bumper(g, m, 1.6); runningFendered(g, m)
  return g
}

/** 5. Lab: the pressure vessel carried aft with its portholes and dish, the cockpit ahead of it, a fender on every tread. */
function lab(m: Mats) {
  const g = new THREE.Group()
  const R = (z: number) => z < -.75 || z > 3.5 ? 0 : 1.05 * Math.sqrt(Math.max(0, 1 - Math.max(0, (Math.abs(z - 1.375) - 1.5) / .63) ** 2))
  const arc0 = (x: number, z: number) => { const r = R(z); return Math.abs(x) < r ? Math.sqrt(r * r - x * x) : 0 }
  // Averaged over a few centimetres: a wall that meets the deck dead vertical aliases against the mesh.
  const arc = (x: number, z: number) => (arc0(x - .09, z) + 2 * arc0(x, z) + arc0(x + .09, z)) / 4
  const livery: Livery = { lower: 0x6f757d, lowerMetal: .8, lowerRough: .4, lamps: lamps(.2, BASE + .28, NARROW_LAMPS),
    panes: [{ kind: 'glass', z: [-3.6, -1.3], y: [BASE + 1.02, BASE + 1.48], x: [0, 1], pitchZ: .5, gap: .06 }],
    spots: [.4, 1.375, 2.35].map(z => ({ kind: 'glass' as const, at: [.93, BASE + .56, z] as [number, number, number], r: .17 })),
    stripes: [{ z: .1, w: .035, color: ORANGE }, { z: 2.75, w: .2, color: 0x0e0f12 }, { z: .9, w: .012, color: 0x555a61 }, { z: 1.85, w: .012, color: 0x555a61 }] }
  g.add(body(m, { z0: -4, z1: 4, W: narrow, C: () => BASE, rings: 150,
    T: (x, z) => .07 + .13 * knuckle(x, z) + Math.max(deck(x, z), arc(x, z) + .02) + cab(x, z, -2.3, 1.0, .84, 1.22),
    B: (x, z) => .06 + .12 * knuckle(x, z) + .5 * hump(x / 1.25, 8) * hump(z / 3.6, 10) }, livery))
  const dish = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [.16, .02], [.32, .08], [.46, .2]].map(p => new THREE.Vector2(p[0], p[1])), 32), m.chrome); dish.castShadow = true
  g.add(rod(m.chrome, V(0, BASE + 1.05, 2.4), V(0, BASE + 1.7, 2.4), .03), at(dish, 0, BASE + 1.7, 2.4, -.6))
  bumper(g, m, 1.6); runningFendered(g, m)
  return g
}

export const round5: TankDesign[] = [
  { id: 'orbiter', name: 'Orbiter', tagline: 'Lifting body with the tall cockpit, fenders part of the body', color: 0xf0f1f2, build: orbiter },
  { id: 'lun5', name: 'Lun', tagline: 'Ekranoplan keel and lamp nacelles, fenders part of the body', color: 0xc3c9cf, build: lun },
  { id: 'lunokhod5', name: 'Lunokhod', tagline: 'Solar tub behind the cockpit, a fender on every tread', color: 0xe4e6e8, build: lunokhod },
  { id: 'rover5', name: 'Rover', tagline: 'Pressurised cabin as the cockpit, a fender on every tread', color: 0xeceef0, build: rover },
  { id: 'lab5', name: 'Lab', tagline: 'Pressure vessel aft of the cockpit, a fender on every tread', color: 0xe9ebed, build: lab },
]

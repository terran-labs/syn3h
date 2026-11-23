// Historical design snapshot. Keep this round unchanged; add later designs separately.
/**
 * Design studies for a next-gen Mira tank, round three. Mira never had one; the only tank is
 * the Mars Explorer port in ../Tank.ts. Appearance only: no physics reads these.
 *
 * Owner's brief so far (14 November):
 * - No visible weapons. This is an exploration vehicle.
 * - Six independent articulated treads, as the Mars Explorer tank had.
 * - Round two's Bastion (heavy purple body) was the favourite. Build on it.
 * - Rugged, not aerodynamic: his reference is a Hummer EV SUV. No spoilers or fins.
 * - A different fender over each pod; the rear ones curve backwards.
 * - A deeper, more irregular body that borrows from the buggy's sculpted shell.
 * Each design keeps the Mars Explorer footprint: about 5 m wide, 7.5 m long, pods 2.45 m apart.
 */
import * as THREE from 'three/webgpu'
import { at, blob, canopy, dome, mirrored, port, rod, scoop, sculpts, slab, trackPod, tube, tumble, V, waist, wheel, type Mats, type Station } from './kit'

export interface TankDesign { id: string; name: string; tagline: string; color: number; build(m: Mats): THREE.Group }

const fwd = Math.PI, side = Math.PI / 2
const ZS = [-2.45, 0, 2.45], PX = 2.05

/** One articulated tread: a triangular pod that rocks about its top sprocket. The viewer animates userData.pod. */
function pod(m: Mats, x: number, z: number, s = 1) {
  const pivot = 1.08 * s, unit = new THREE.Group()
  unit.add(at(trackPod(m, [{ z: -.7 * s, y: .36 * s, r: .36 * s }, { z: .7 * s, y: .36 * s, r: .36 * s }, { z: 0, y: pivot, r: .34 * s }], .85 * s), 0, -pivot, 0))
  unit.userData.pod = true; unit.userData.phase = z * 1.3 + x
  return at(unit, x, pivot, z)
}
/** Six pods and the chrome stub arms that carry them. */
function running(g: THREE.Group, m: Mats, armX = 1.15, armY = 1.1) {
  for (const z of ZS) { mirrored(g, pod(m, PX, z)); mirrored(g, rod(m.chrome, V(armX, armY, z), V(PX - .44, 1.08, z), .2, .13)) }
}

type Kind = 'front' | 'mid' | 'rear'
/** Squared arches, one shape per position. The rear one rises, then curls down behind its pod. */
const FENDER: Record<Kind, Station[]> = {
  // Tall boxed arch that drops in front of the pod like a bumper corner.
  front: [[-1.42, .05, .02, .02, .95], [-1.24, .42, .1, .06, 1.2, 4.5], [-.84, .5, .13, .07, 1.66, 4.5], [0, .52, .13, .07, 1.78, 4.5], [.7, .48, .12, .07, 1.72, 4.5], [1, .4, .1, .06, 1.62, 4.5], [1.14, .05, .02, .02, 1.58]],
  // Slim side step.
  mid: [[-1.08, .05, .02, .02, 1.58], [-.92, .4, .08, .05, 1.62, 5], [0, .43, .09, .05, 1.65, 5], [.92, .4, .08, .05, 1.62, 5], [1.08, .05, .02, .02, 1.58]],
  rear: [[-1.05, .05, .02, .02, 1.58], [-.85, .42, .1, .06, 1.66, 4.5], [-.1, .5, .12, .07, 1.8, 4.5], [.6, .54, .14, .07, 1.94, 4.5], [1.14, .52, .13, .07, 1.86, 4.5], [1.52, .46, .1, .06, 1.48, 4.5], [1.76, .38, .08, .05, 1, 4], [1.86, .05, .02, .02, .8]],
}
/** Painted fender with a dark cladding lip under it, the way truck arches are trimmed. */
function fender(m: Mats, kind: Kind, z: number, s = 1, x = 2.08) {
  const g = new THREE.Group(), st = FENDER[kind].map(t => [t[0] * s, t[1] * s, t[2] * s, t[3] * s, t[4] + (s - 1) * .5, t[5] ?? 2.6])
  g.add(blob(m.paint, st, 8, 36), blob(m.dark, st.map(t => [t[0], t[1] + .05, .04, .1, t[4] - .08, t[5]]), 8, 36))
  return at(g, x, 0, z)
}
function fenders(g: THREE.Group, m: Mats, scale: [number, number, number] = [1, 1, 1]) {
  (['front', 'mid', 'rear'] as Kind[]).forEach((k, i) => mirrored(g, fender(m, k, ZS[i], scale[i])))
}

/** Full width lamp made of separate lit blocks, facing forward. */
function lightBar(m: Mats, w: number, n: number, h = .11) {
  const g = new THREE.Group(); g.add(slab(m.dark, w + .12, h + .08, .1, 5))
  for (let i = 0; i < n; i++) g.add(at(slab(m.glow, w / n - .05, h, .04, 4), (i - (n - 1) / 2) * w / n, 0, -.05))
  return g
}
/** Recovery hook, loop pointing forward. */
const hook = (m: Mats) => { const h = new THREE.Mesh(new THREE.TorusGeometry(.1, .035, 10, 20, Math.PI), m.accent); h.rotation.x = -Math.PI / 2; h.castShadow = true; const g = new THREE.Group(); g.add(h); return g }
/** Front end: lamp bar, grille, bumper, hooks and a skid plate under the nose. */
function face(g: THREE.Group, m: Mats, z: number, barY = 1.5, barW = 2.3) {
  g.add(at(lightBar(m, barW, 6), 0, barY, z), at(slab(m.dark, barW - .1, .28, .1, 5), 0, barY - .3, z + .02))
  g.add(at(slab(m.dark, 2.7, .32, .42, 5), 0, .86, z - .04), at(slab(m.chrome, 1.7, .05, .95, 4), 0, .62, z + .3, .45))
  mirrored(g, at(hook(m), .6, .86, z - .26))
}
function tail(g: THREE.Group, m: Mats, z: number, lampY = 1.5, lampX = 1.12) {
  g.add(at(slab(m.dark, 2.7, .32, .42, 5), 0, .9, z + .02))
  mirrored(g, at(slab(m.tail, .12, .5, .06, 4), lampX, lampY, z + .02))
  mirrored(g, at(hook(m), .6, .9, z + .24, 0, fwd))
}
/** Spare road wheel, facing +Z. */
function spare(m: Mats, r = .46) {
  const g = new THREE.Group(), tyre = new THREE.Mesh(new THREE.TorusGeometry(r - .13, .14, 14, 36), m.rubber); tyre.castShadow = true
  const rim = wheel(m, r - .2, .07); rim.rotation.y = side; g.add(tyre, rim); return g
}
/** Upright truck cabin: glass, a painted roof with two glass panels, and painted pillars. */
function cabin(m: Mats, z0: number, z1: number, w: number, y: number, h: number, rake: number) {
  const g = new THREE.Group(), zr = z0 + rake, len = z1 - zr
  g.add(blob(m.glass, [[z0 - .05, .05, .02, 0, y], [z0, w - .08, h * .35, 0, y, 6], [zr, w, h, 0, y, 6], [z1 - .25, w, h, 0, y, 6], [z1, w - .06, h * .6, 0, y, 6], [z1 + .05, .05, .02, 0, y]]))
  g.add(blob(m.paint, [[zr - .28, .05, .02, .02, y + h], [zr - .12, w + .03, .05, .05, y + h, 5], [z1 - .2, w + .03, .05, .05, y + h, 5], [z1 - .05, .05, .02, .02, y + h]], 4))
  for (const k of [.27, .73]) g.add(at(slab(m.glass, w * 1.6, .04, len * .4, 5), 0, y + h + .05, zr + len * k - .08))
  mirrored(g, rod(m.paint, V(w - .05, y, z0 + .03), V(w - .01, y + h, zr - .04), .07))
  mirrored(g, rod(m.paint, V(w + .01, y, (zr + z1) / 2), V(w + .01, y + h, (zr + z1) / 2), .07))
  mirrored(g, rod(m.paint, V(w - .02, y, z1 - .02), V(w, y + h, z1 - .2), .07))
  return g
}
const sliders = (g: THREE.Group, m: Mats) => mirrored(g, tube(m.dark, [[1.5, .64, -1.95], [1.56, .58, 0], [1.5, .64, 1.95]], .07))
const triVent = (m: Mats, r: number, x: number, y: number, z: number) => at(port(m, r, r, r * .15, m.dark, 3), x, y, z, -Math.PI / 2 + .06, 0, Math.PI / 2)

/** 1. Two box expedition truck: the heavy body squared up, with a full glass cabin. */
function omega(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.72, .05, .05, .05, 1.2], [-3.58, 1.15, .4, .48, 1.2, 5], [-2.6, 1.32, .5, .62, 1.2, 5], [0, 1.36, .55, .68, 1.2, 5], [2.6, 1.32, .55, .62, 1.25, 5], [3.52, 1.2, .5, .5, 1.3, 5], [3.7, .05, .05, .05, 1.3]], 14, 72,
    sculpts(dome(-2.5, .95, .5, .2, 1.3), scoop(-1.22, 1.2, .42, .2, .17), scoop(1.22, 1.2, .42, .2, .17), tumble(1.42, .1))))
  g.add(cabin(m, -1.5, 3.3, 1.12, 1.72, .78, .8))
  mirrored(g, tube(m.chrome, [[.95, 2.6, -.55], [.95, 2.67, 1.2], [.95, 2.6, 3]], .035))
  for (const z of [-1.22, 1.22]) mirrored(g, at(port(m, .34, .15, .03), 1.22, 1.2, z, 0, side))
  mirrored(g, triVent(m, .2, .82, 1.71, -3))
  face(g, m, -3.74); tail(g, m, 3.72); g.add(at(spare(m), 0, 1.6, 3.82)); sliders(g, m)
  running(g, m); fenders(g, m)
  return g
}

/** 2. Pickup: short cabin, open bed with a lamp bar hoop, a spare and crates. */
function hauler(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.72, .05, .05, .05, 1.2], [-3.58, 1.15, .42, .48, 1.2, 5], [-2.6, 1.32, .52, .62, 1.2, 5], [-.2, 1.36, .55, .68, 1.2, 5], [1, 1.36, .5, .68, 1.2, 5], [2.6, 1.34, .45, .62, 1.22, 5], [3.52, 1.25, .45, .5, 1.25, 5], [3.7, .05, .05, .05, 1.25]], 14, 72,
    sculpts(dome(-2.6, 1, .5, .22, 1.3), scoop(-1.22, 1.2, .42, .2, .17), scoop(1.22, 1.15, .5, .18, .14), tumble(1.42, .1))))
  g.add(cabin(m, -1.7, .95, 1.12, 1.72, .74, .75))
  g.add(at(slab(m.dark, 2.3, .06, 2.4, 5), 0, 1.7, 2.25), at(slab(m.paint, 2.6, .34, .14, 4), 0, 1.84, 3.5))
  mirrored(g, at(slab(m.paint, .2, .34, 2.5, 4), 1.2, 1.84, 2.25))
  g.add(tube(m.dark, [[-1.2, 1.75, 1.2], [-1.16, 2.45, 1.34], [-.85, 2.74, 1.4], [.85, 2.74, 1.4], [1.16, 2.45, 1.34], [1.2, 1.75, 1.2]], .07))
  for (const x of [-.72, -.24, .24, .72]) g.add(at(port(m, .13, .13, .028, m.glow), x, 2.9, 1.36, 0, fwd))
  g.add(at(spare(m), .45, 1.88, 2.5, -Math.PI / 2), at(slab(m.accent, .5, .42, .7, 5), -.62, 1.94, 1.95), at(slab(m.dark, .5, .3, .55, 5), -.62, 1.88, 2.9))
  for (const z of [-1.22, 1.22]) mirrored(g, at(port(m, .34, .15, .03), 1.22, 1.18, z, 0, side))
  face(g, m, -3.74); tail(g, m, 3.72, 1.45, 1.16); sliders(g, m)
  running(g, m); fenders(g, m, [1, 1, 1.12])
  return g
}

/** 3. The buggy's shell made deep: big side scoops, hood vents, teardrop glass, under an external cage. */
function brute(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.75, .05, .04, .04, 1.1], [-3.5, .7, .28, .3, 1.1, 3], [-2.6, 1.15, .42, .5, 1.15, 3], [-1.2, 1.35, .55, .62, 1.2, 3], [.4, 1.38, .7, .66, 1.25, 3], [2, 1.3, .72, .6, 1.3, 3], [3.1, 1.05, .55, .45, 1.35, 3], [3.6, .6, .3, .25, 1.38, 3], [3.75, .05, .04, .04, 1.38]], 14, 72,
    sculpts(waist(1.2, .7, .12), scoop(.15, 1.3, .8, .34, .3), dome(-2.3, 1, .6, .1, 1.4))))
  g.add(canopy(m, [[-1.6, .04, .02, 0, 1.72], [-1.25, .55, .26, 0, 1.76], [-.3, .86, .56, 0, 1.84], [.8, .9, .62, 0, 1.9], [1.8, .7, .44, 0, 1.94], [2.4, .04, .02, 0, 1.9]], .07))
  mirrored(g, at(port(m, .62, .26, .045), 1.1, 1.3, .15, 0, side - .1))
  mirrored(g, tube(m.chrome, [[.98, 1.5, -1.9], [.86, 2.2, -1], [.82, 2.56, -.1], [.82, 2.64, 1], [.86, 2.42, 2], [.98, 1.75, 2.9]], .055))
  for (const [z, y] of [[-.1, 2.56], [1, 2.64], [2, 2.42]]) g.add(rod(m.chrome, V(-.82, y, z), V(.82, y, z), .05))
  for (const x of [-.54, -.18, .18, .54]) g.add(at(port(m, .13, .13, .028, m.glow), x, 2.72, -.16, 0, fwd))
  g.add(tube(m.dark, [[-1, .7, -3.4], [-.95, 1.22, -3.86], [-.5, 1.5, -3.94], [.5, 1.5, -3.94], [.95, 1.22, -3.86], [1, .7, -3.4]], .065))
  g.add(at(slab(m.chrome, 1.5, .05, .95, 4), 0, .66, -3.3, .5)); mirrored(g, at(hook(m), .5, .86, -3.72))
  mirrored(g, at(port(m, .2, .2, .04, m.glow), .42, 1.16, -3.62, .12, fwd))
  mirrored(g, triVent(m, .3, .5, 1.63, -2))
  mirrored(g, at(port(m, .14, .14, .03, m.tail), .42, 1.45, 3.72))
  g.add(at(spare(m), 0, 2, 3.05, -Math.PI / 2 + .3))
  running(g, m); fenders(g, m, [1, 1, 1.15])
  return g
}

/** 4. Cab over crawler: cabin right at the nose, a low cargo deck, a raised power unit behind. */
function crawler(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.72, .05, .05, .05, 1.2], [-3.58, 1.2, .5, .5, 1.2, 5], [-2.6, 1.34, .52, .64, 1.2, 5], [0, 1.36, .5, .7, 1.2, 5], [2.6, 1.34, .52, .64, 1.25, 5], [3.52, 1.22, .5, .5, 1.3, 5], [3.7, .05, .05, .05, 1.3]], 14, 72,
    sculpts(scoop(0, 1.15, .55, .2, .17), tumble(1.42, .1))))
  g.add(blob(m.glass, [[-3.6, .05, .02, 0, 1.72], [-3.5, 1.08, .5, 0, 1.72, 5], [-3.1, 1.16, .85, 0, 1.72, 5], [-1.3, 1.14, .85, 0, 1.75, 5], [-1.05, 1.05, .5, 0, 1.75, 5], [-.98, .05, .02, 0, 1.75]]))
  g.add(blob(m.paint, [[-3.8, .05, .02, .02, 2.56], [-3.62, 1.2, .06, .05, 2.58, 5], [-1.2, 1.18, .06, .05, 2.62, 5], [-1, .05, .02, .02, 2.6]], 4))
  for (const [z0, z1] of [[-3.42, -3.2], [-2.2, -2.2], [-1.1, -1.25]]) mirrored(g, rod(m.paint, V(1.14, 1.72, z0), V(1.15, 2.58, z1), .07))
  // Roof rack with a lamp bar and a crate.
  g.add(tube(m.dark, [[-1, 2.76, -3.3], [1, 2.76, -3.3], [1, 2.76, -1.4], [-1, 2.76, -1.4], [-1, 2.76, -3.3]], .04))
  for (const z of [-3.3, -1.4]) mirrored(g, rod(m.dark, V(1, 2.64, z), V(1, 2.76, z), .035))
  g.add(at(lightBar(m, 1.8, 8, .09), 0, 2.84, -3.42), at(slab(m.accent, .9, .3, .7, 5), -.3, 2.93, -2), at(slab(m.dark, .5, .22, .9, 5), .6, 2.89, -2.1))
  // Deck: spare against the cabin, crates, and an intake stack on one side only.
  g.add(at(spare(m), .5, 2.18, -.84), at(slab(m.accent, .6, .4, .5, 5), -.2, 1.92, .1), at(slab(m.dark, .9, .28, .6, 5), .45, 1.86, .45))
  g.add(rod(m.dark, V(-1, 1.7, -.7), V(-1, 3, -.7), .09), at(slab(m.chrome, .34, .14, .34, 3), -1, 3.04, -.7))
  // Power unit with radiator ports and two fans on top.
  g.add(blob(m.paint, [[1, .05, .03, .03, 2], [1.15, 1.15, .34, .3, 2, 5], [2.4, 1.2, .38, .3, 2.02, 5], [3.4, 1.1, .3, .3, 2, 5], [3.55, .05, .03, .03, 2]], 8, 48))
  mirrored(g, at(port(m, .62, .19, .04), 1.2, 2.03, 2.3, 0, side))
  mirrored(g, at(port(m, .32, .32, .04), .5, 2.4, 2.3, -Math.PI / 2))
  for (const z of [2.85, 3.2]) g.add(rod(m.chrome, V(1.34, .95, z), V(1.34, 2.3, z), .03))
  for (const y of [1.15, 1.45, 1.75, 2.05]) g.add(rod(m.chrome, V(1.34, y, 2.85), V(1.34, y, 3.2), .025))
  face(g, m, -3.74, 1.42); tail(g, m, 3.72, 1.55, 1.1); sliders(g, m)
  running(g, m); fenders(g, m, [1.1, 1, 1])
  return g
}

/** 5. Survey rover: glass nose low at the front, a stepped body, solar deck and dish on top. */
function rover(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.75, .05, .04, .04, 1], [-3.6, 1, .2, .34, 1, 4.5], [-2.6, 1.28, .32, .5, 1.08, 4.5], [-1, 1.36, .5, .62, 1.18, 4.5], [.5, 1.36, .72, .68, 1.22, 4.5], [2.6, 1.32, .75, .62, 1.27, 4.5], [3.52, 1.2, .62, .5, 1.32, 4.5], [3.7, .05, .05, .05, 1.32]], 14, 72,
    sculpts(scoop(1.22, 1.35, .5, .28, .22), scoop(-1.22, 1.12, .4, .16, .13), waist(0, .6, .05))))
  g.add(canopy(m, [[-3.3, .04, .02, 0, 1.2], [-3, .6, .26, 0, 1.26, 2.8], [-2.2, .98, .6, 0, 1.4, 2.8], [-1.2, 1.06, .78, 0, 1.56, 2.8], [-.3, .9, .66, 0, 1.7, 2.8], [.3, .04, .02, 0, 1.8]], .08))
  g.add(tube(m.dark, [[-1.2, 1.8, .25], [-1.08, 2.36, .3], [-.5, 2.52, .32], [.5, 2.52, .32], [1.08, 2.36, .3], [1.2, 1.8, .25]], .07))
  for (const x of [-.6, -.2, .2, .6]) g.add(at(port(m, .12, .12, .028, m.glow), x, 2.66, .28, 0, fwd))
  // Solar deck on chrome posts.
  g.add(at(slab(m.dark, 2.5, .05, 2.9, 5), 0, 2.56, 2))
  for (const x of [-.82, 0, .82]) for (const z of [1.3, 2.7]) g.add(at(slab(m.glass, .76, .03, 1.34, 5), x, 2.6, z))
  for (const z of [.8, 3.2]) mirrored(g, rod(m.chrome, V(1.05, 1.95, z), V(1.05, 2.56, z), .04))
  // Dish on a mast, one side only.
  g.add(rod(m.chrome, V(-.95, 2.56, 3.25), V(-.95, 3.45, 3.25), .035))
  const dish = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [.16, .02], [.32, .08], [.46, .2]].map(p => new THREE.Vector2(p[0], p[1])), 32), m.chrome); dish.castShadow = true
  g.add(at(dish, -.95, 3.45, 3.25, -.7, 0, .2))
  for (const z of [1.22]) mirrored(g, at(port(m, .4, .2, .04), 1.2, 1.35, z, 0, side))
  g.add(at(lightBar(m, 1.8, 6, .09), 0, 1, -3.77))
  g.add(tube(m.dark, [[-1.1, .6, -3.5], [-1.05, 1.0, -3.92], [-.5, 1.28, -3.98], [.5, 1.28, -3.98], [1.05, 1.0, -3.92], [1.1, .6, -3.5]], .06))
  g.add(at(slab(m.chrome, 1.6, .05, .9, 4), 0, .58, -3.35, .5)); mirrored(g, at(hook(m), .55, .78, -3.78))
  tail(g, m, 3.72, 1.6, 1.1); g.add(at(spare(m), .2, 1.55, 3.82)); sliders(g, m)
  running(g, m); fenders(g, m, [.95, 1, 1.2])
  return g
}

export const designs: TankDesign[] = [
  { id: 'omega', name: 'Omega', tagline: 'Two box expedition truck with a full glass cabin', color: 0x45209a, build: omega },
  { id: 'hauler', name: 'Hauler', tagline: 'Pickup: short cabin, open bed, lamp hoop', color: 0xd9dde2, build: hauler },
  { id: 'brute', name: 'Brute', tagline: 'The buggy\'s shell made deep, under an external cage', color: 0xc2410c, build: brute },
  { id: 'crawler', name: 'Crawler', tagline: 'Cab over the nose, cargo deck, raised power unit', color: 0x0f5a35, build: crawler },
  { id: 'rover', name: 'Rover', tagline: 'Glass nose, stepped body, solar deck and dish', color: 0x0d2f9e, build: rover },
]

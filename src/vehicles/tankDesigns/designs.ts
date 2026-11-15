/**
 * Five design studies for a next-gen Syn3h tank. Syn3h never had one; the only tank is the
 * Mars Explorer port in ../Tank.ts. These are appearance studies only: no physics reads them.
 *
 * Owner's brief (14 November): no visible weapons, this is an exploration vehicle. Six
 * independent articulated treads, as the Mars Explorer tank had. He liked the triangular track
 * pods with fender flares on chrome arms (first Scarab) and the heavy body (first Bastion).
 * Each design stays inside the Mars Explorer tank's footprint: about 5 m wide, 7.5 m long, with
 * pods 2.45 m apart (the original spaced them 2.5 m, Tank.js 5).
 */
import * as THREE from 'three/webgpu'
import { at, blob, canopy, fin, mirrored, port, rod, trackPod, V, type Mats, type Station } from './kit'

export interface TankDesign { id: string; name: string; tagline: string; color: number; build(m: Mats): THREE.Group }

const lamp = (m: Mats, r = .13) => port(m, r, r, .028, m.glow)
/** Faces a port (built facing +Z) forward. */
const fwd = Math.PI
const ZS = [-2.45, 0, 2.45]

/**
 * One articulated tread: a triangular pod that rocks about its top sprocket, which is where the
 * chrome arm from the hull meets it. The viewer animates anything flagged userData.pod.
 */
function pod(m: Mats, x: number, z: number, s = 1) {
  const pivot = 1.08 * s, unit = new THREE.Group()
  unit.add(at(trackPod(m, [{ z: -.7 * s, y: .36 * s, r: .36 * s }, { z: .7 * s, y: .36 * s, r: .36 * s }, { z: 0, y: pivot, r: .34 * s }], .85 * s), 0, -pivot, 0))
  unit.userData.pod = true; unit.userData.phase = z * 1.3 + x
  return at(unit, x, pivot, z)
}
/** Chrome stub arm from the hull out to a pod's sprocket. */
const arm = (m: Mats, fromX: number, fromY: number, fromZ: number, x: number, z: number, s = 1) =>
  rod(m.chrome, V(fromX, fromY, fromZ), V(x - .44 * s, 1.08 * s, z), .2 * s, .13 * s)
/** The fender flare the owner picked out: a painted teardrop floating over one pod. */
const flare = (m: Mats, x: number, z: number, s = 1) =>
  at(blob(m.paint, ([[-.98, .04, .02, .02, 1.42, 2.6], [-.6, .5, .14, .08, 1.6, 2.8], [0, .57, .17, .08, 1.68, 2.8], [.6, .5, .14, .08, 1.6, 2.8], [.98, .04, .02, .02, 1.42, 2.6]] as Station[]).map(t => [t[0] * s, t[1] * s, t[2] * s, t[3] * s, t[4] * s, t[5]]), 7, 32), x, 0, z)

/** 1. The red tank he liked, stretched to six pods, with the gun gone and a glass crowned cabin. */
function scarab(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.6, .05, .03, .03, 1], [-3.4, .6, .22, .16, 1, 3], [-2.5, 1.05, .42, .26, 1.05], [-.9, 1.3, .62, .32, 1.12], [.9, 1.32, .7, .32, 1.15], [2.5, 1.1, .6, .28, 1.15], [3.3, .75, .38, .2, 1.12, 3], [3.55, .05, .03, .03, 1.1]]))
  g.add(blob(m.paint, [[-1.3, .05, .02, 0, 1.7], [-1.05, .5, .2, .1, 1.72], [-.2, .88, .42, .1, 1.75], [.8, .92, .45, .1, 1.75], [1.6, .6, .3, .1, 1.72], [1.9, .05, .02, 0, 1.7]]))
  g.add(canopy(m, [[-1.1, .04, .02, 0, 1.88], [-.8, .52, .24, 0, 1.9], [0, .74, .4, 0, 1.93], [.9, .64, .32, 0, 1.93], [1.45, .04, .02, 0, 1.9]]))
  const collar = new THREE.Mesh(new THREE.TorusGeometry(1, .05, 12, 56), m.chrome); collar.scale.set(1, 1.62, 1); g.add(at(collar, 0, 1.69, .3, Math.PI / 2))
  for (const z of ZS) { mirrored(g, pod(m, 2.05, z)); mirrored(g, arm(m, .95, 1.08, z * .86, 2.05, z)); mirrored(g, flare(m, 2.05, z)) }
  mirrored(g, at(lamp(m, .15), .62, 1.03, -3.38, .15, fwd))
  mirrored(g, at(port(m, .24, .17, .035), .5, 1.14, 3.44, -.1))
  mirrored(g, at(port(m, .3, .16, .03), 1.28, 1.3, -1.1, 0, Math.PI / 2 - .12))
  return g
}

/** 2. The purple tank he liked: heavy slab hull and big cabin, its fenders now scalloped over six pods. */
function bastion(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.6, .05, .03, .03, 1.05], [-3.4, .9, .3, .25, 1.05, 4], [-2.2, 1.28, .44, .4, 1.1, 4], [0, 1.32, .52, .45, 1.15, 4], [2.2, 1.28, .52, .42, 1.17, 4], [3.3, .95, .36, .3, 1.15, 4], [3.6, .05, .03, .03, 1.12]]))
  g.add(blob(m.paint, [[-2, .05, .03, 0, 1.78], [-1.7, .8, .3, .12, 1.82, 2.6], [-.7, 1.25, .58, .12, 1.88, 2.6], [.5, 1.3, .64, .12, 1.9, 2.6], [1.6, 1, .5, .12, 1.9, 2.6], [2.2, .55, .28, .12, 1.87, 2.6], [2.4, .05, .03, 0, 1.82]]))
  // A broad glass roof where the first version had its gun mantlet.
  g.add(canopy(m, [[-1.75, .03, .02, 0, 2.1], [-1.4, .62, .2, 0, 2.15], [-.6, .98, .36, 0, 2.24], [.5, .95, .36, 0, 2.28], [1.3, .55, .22, 0, 2.27], [1.75, .03, .02, 0, 2.2]], .07))
  const collar = new THREE.Mesh(new THREE.TorusGeometry(1, .055, 12, 56), m.chrome); collar.scale.set(1.36, 2.1, 1); g.add(at(collar, 0, 1.78, .2, Math.PI / 2))
  // One long fender each side, rising over each pod and dipping between them.
  mirrored(g, blob(m.paint, [[-3.95, .05, .02, .02, 1.2, 2.6, 2], [-3.5, .6, .14, .08, 1.5, 2.8, 2], [-2.45, .72, .2, .1, 1.76, 3, 2.02], [-1.22, .6, .15, .09, 1.54, 3, 1.94], [0, .72, .2, .1, 1.76, 3, 2.02], [1.22, .6, .15, .09, 1.54, 3, 1.94], [2.45, .72, .2, .1, 1.76, 3, 2.02], [3.5, .6, .14, .08, 1.5, 2.8, 2], [3.95, .05, .02, .02, 1.2, 2.6, 2]]))
  for (const z of ZS) { mirrored(g, pod(m, 2.05, z)); mirrored(g, arm(m, 1.1, 1.1, z, 2.05, z)) }
  mirrored(g, at(port(m, .46, .22, .04), 1.21, 1.99, .4, 0, Math.PI / 2 - .05))
  mirrored(g, at(lamp(m, .16), .7, 1.12, -3.42, .12, fwd))
  mirrored(g, at(port(m, .26, .15, .035), .55, 1.2, 3.5, -.1))
  return g
}

/** 3. The jet's fuselage and forward swept wings, with a pod under each wingtip. */
function explorer(m: Mats) {
  const g = new THREE.Group(), b = new THREE.Group(); b.position.y = .4; g.add(b)
  b.add(blob(m.paint, [[-3.8, .04, .03, .03, 1.15], [-3.4, .38, .2, .14, 1.15], [-2.2, .6, .34, .22, 1.2], [-.6, .72, .44, .28, 1.25], [1, .8, .5, .3, 1.3], [2.4, .7, .46, .28, 1.32], [3.3, .5, .34, .2, 1.3, 3], [3.6, .04, .03, .03, 1.3]]))
  b.add(canopy(m, [[-3.3, .03, .02, 0, 1.33], [-2.9, .26, .12, 0, 1.36], [-1.6, .42, .22, 0, 1.52], [-.3, .46, .26, 0, 1.64], [.6, .3, .14, 0, 1.7], [1, .03, .02, 0, 1.7]]))
  for (const z of ZS) {
    mirrored(g, pod(m, 2.05, z))
    // Lofted along its span, then turned to lie across the hull; it ends in a flare over the pod.
    const wing = blob(m.paint, [[.3, .62, .15, .12, 0, 2.2, 0], [1, .5, .12, .1, .02, 2.2, .14], [1.6, .46, .11, .08, .03, 2.4, .26], [2.1, .62, .13, .08, .02, 2.6, .3], [2.5, .5, .1, .07, -.04, 2.6, .3], [2.72, .04, .02, .02, -.1, 2.4, .3]], 7, 32)
    mirrored(b, at(wing, 0, 1.2, z + .3, 0, Math.PI / 2))
    mirrored(g, rod(m.chrome, V(1.5, 1.52, z), V(1.61, 1.08, z), .16, .13))
  }
  mirrored(b, at(fin(m, 1.05, 1.1, .5), .42, 1.6, 2.7, 0, 0, -.5))
  mirrored(b, at(fin(m, .45, .7, .25, .04), 2.62, 1.2, 2.85, 0, 0, -.3))
  b.add(at(port(m, .46, .26, .04), 0, 1.3, 3.57))
  mirrored(b, at(lamp(m, .1), .24, 1.2, -3.52, .1, fwd))
  return g
}

/** 4. The buggy's body: long hood, teardrop canopy, rear hoop, and a haunch sweeping out over each pod. */
function manta(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-3.7, .05, .03, .03, 1], [-3.5, .55, .16, .14, 1, 3], [-2.8, .95, .26, .22, 1.03, 3], [-1.6, 1.2, .36, .28, 1.08], [-.3, 1.3, .48, .3, 1.13], [1, 1.3, .55, .3, 1.15], [2.3, 1.15, .5, .28, 1.17], [3.2, .9, .38, .22, 1.2, 3], [3.55, .5, .2, .14, 1.22, 3], [3.65, .05, .03, .03, 1.22]]))
  g.add(canopy(m, [[-1.3, .04, .02, 0, 1.45], [-1, .45, .22, .05, 1.47], [-.2, .72, .46, .05, 1.53], [.7, .74, .5, .05, 1.57], [1.5, .55, .34, .05, 1.57], [2, .04, .02, 0, 1.55]]))
  for (const z of ZS) {
    mirrored(g, pod(m, 2.05, z)); mirrored(g, arm(m, 1, 1.1, z, 2.05, z))
    mirrored(g, at(blob(m.paint, [[-1.2, .04, .03, .03, 1.2, 2.4, 1.05], [-.6, .46, .2, .14, 1.5, 2.6, 1.6], [0, .6, .22, .12, 1.66, 2.8, 1.98], [.65, .52, .18, .1, 1.6, 2.8, 2.02], [1.1, .04, .02, .02, 1.4, 2.6, 1.95]], 8, 36), 0, 0, z))
  }
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(1, .075, 14, 40, Math.PI), m.paint); hoop.castShadow = true
  g.add(at(hoop, 0, 1.47, 3.05, -.45)); hoop.scale.set(1.02, .5, 1)
  mirrored(g, at(port(m, .3, .3, .045, m.dark, 3), .5, 1.39, -1.9, -Math.PI / 2 + .09, 0, Math.PI / 2))
  mirrored(g, at(lamp(m, .14), .55, 1.03, -3.47, .1, fwd))
  mirrored(g, at(port(m, .22, .12, .03), .5, 1.25, 3.52, -.1))
  return g
}

/** 5. Dragster stance: pods grow from nose to tail, with the jet's fins and big rear haunches. */
function raptor(m: Mats) {
  const g = new THREE.Group()
  g.add(blob(m.paint, [[-4, .04, .03, .03, .85], [-3.6, .3, .14, .1, .86], [-2.4, .55, .24, .18, .92], [-1, .8, .36, .24, 1.02], [.4, 1.05, .5, .3, 1.12], [1.6, 1.15, .58, .32, 1.2], [2.6, 1, .52, .3, 1.25], [3.3, .6, .34, .2, 1.27, 3], [3.55, .04, .03, .03, 1.27]]))
  g.add(canopy(m, [[-.2, .03, .02, 0, 1.45], [.1, .4, .2, 0, 1.5], [.9, .66, .42, 0, 1.6], [1.8, .6, .4, 0, 1.68], [2.5, .36, .2, 0, 1.68], [2.8, .03, .02, 0, 1.62]]))
  mirrored(g, pod(m, 1.7, -2.6, .72)); mirrored(g, arm(m, .45, .9, -2.55, 1.7, -2.6, .72)); mirrored(g, flare(m, 1.7, -2.6, .72))
  mirrored(g, pod(m, 1.9, -.35, .9)); mirrored(g, arm(m, .8, 1.02, -.35, 1.9, -.35, .9)); mirrored(g, flare(m, 1.9, -.35, .9))
  mirrored(g, pod(m, 1.95, 2.15, 1.2)); mirrored(g, arm(m, 1, 1.25, 2.15, 1.95, 2.15, 1.2))
  // Rear haunches rise out of the hull and over the drive pods.
  mirrored(g, blob(m.paint, [[.7, .04, .02, .02, 1.45, 3, 1.9], [1.1, .56, .13, .1, 1.88, 3, 1.93], [1.9, .68, .16, .1, 2.1, 3, 1.95], [2.8, .66, .15, .1, 2.04, 3, 1.95], [3.5, .5, .1, .08, 1.62, 3, 1.93], [3.8, .04, .02, .02, 1.3, 3, 1.9]]))
  mirrored(g, blob(m.paint, [[.4, .04, .03, .03, 1.3, 2.4, 1.15], [1.2, .48, .32, .2, 1.55, 2.4, 1.35], [2.2, .52, .36, .2, 1.68, 2.4, 1.42], [3.1, .3, .2, .14, 1.5, 2.4, 1.3], [3.4, .04, .03, .03, 1.38, 2.4, 1.2]]))
  mirrored(g, at(fin(m, 1.1, 1.2, .6), .62, 1.72, 2.75, 0, 0, -.42))
  g.add(at(port(m, .5, .24, .04), 0, 1.27, 3.52))
  mirrored(g, at(port(m, .22, .22, .035, m.dark, 3), .34, 1.31, -1, -Math.PI / 2 + .1, 0, Math.PI / 2))
  mirrored(g, at(lamp(m, .09), .2, .9, -3.72, .1, fwd))
  return g
}

export const designs: TankDesign[] = [
  { id: 'scarab', name: 'Scarab', tagline: 'Six pods with floating fender flares, glass crowned cabin', color: 0x9c0a16, build: scarab },
  { id: 'bastion', name: 'Bastion', tagline: 'The heavy body, with fenders scalloped over six pods', color: 0x45209a, build: bastion },
  { id: 'explorer', name: 'Explorer', tagline: 'The jet\'s fuselage, a pod under each swept wing', color: 0xd4560f, build: explorer },
  { id: 'manta', name: 'Manta', tagline: 'The buggy\'s body, a haunch over every pod', color: 0x0d1cae, build: manta },
  { id: 'raptor', name: 'Raptor', tagline: 'Dragster stance: pods grow from nose to tail', color: 0x08783f, build: raptor },
]

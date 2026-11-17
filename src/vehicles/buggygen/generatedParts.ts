import * as THREE from 'three/webgpu'
import parts from './parts'
import { buggyBody } from './body'

/**
 * Generated stand-ins for the two model files LoadedBuggySkin reads, as plain scene graphs with
 * the node and material names its post-load code looks for, so GeneratedBuggySkin can run that
 * code nearly unchanged. `scene` stands for buggy.glb (RimSimple, Wings), `next` for
 * buggy-boxarm.glb (Body, Sockets, Interior, Canopy, Strut, Shock).
 *
 * Every piece is already in the frame the skin uses it in, except that the wings are both
 * halves in the game frame, so the skin skips the model's quarter turn and mirror for them.
 */

/** A generated piece: a part name, a shading role and its geometry. */
export interface Piece { part: string; role: string; geometry: THREE.BufferGeometry }
/** A body candidate: only `body` pieces are used from it. */
export interface BodyCandidate { id: string; build(detail: 0 | 1 | 2): Piece[] }

/**
 * Shock anchors, formerly the Shock node's extras in buggy-boxarm.glb: the foot in the arm's
 * frame, and the top of each wheel's shock inside the body (front left, front right, rear left,
 * rear right).
 */
export const SHOCK_FOOT: [number, number, number] = [0, .2, -.07]
export const SHOCK_TOPS: number[] = [
  -.7302074432373047, .49191752076148987, -1.2375385761260986, .7302074432373047, .49191752076148987, -1.2375385761260986,
  -.7270978689193726, .48803403973579407, 1.2364318370819092, .7270978689193726, .48803403973579407, 1.2364318370819092,
]

/** Shading role to the material name the skin's name tests map back to that role. */
const MATERIAL: Record<string, string> = { paint: 'Body', accent: 'Accent', glow: 'Glow', chrome: 'Chrome', frame: 'Dark', trim: 'Interior', canopy: 'Glass' }
/**
 * Base colours (linear) the skin keeps from the source material, as buggy-boxarm.glb set them.
 * Only `trim` is drawn in its own colour (PATTERN.md rule 1); paint and accent are repainted.
 */
const COLOUR: Record<string, [number, number, number]> = {
  Body: [.03, .07, .55], Accent: [1, .35, .02], Glow: [1, .35, .02], Chrome: [.9, .92, .95], Dark: [.012, .014, .018],
  Interior: [.035, .038, .045], Glass: [.01, .012, .02], Headlights: [1, .96, .75], TailLights: [.9, .02, .02],
}

/** Split lamp faces into headlights (ahead of the centre, -Z) and tail lamps, keeping any normals. */
function splitLamps(geometry: THREE.BufferGeometry): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = g.attributes.position, nor = g.attributes.normal
  const head = { p: [] as number[], n: [] as number[] }, tail = { p: [] as number[], n: [] as number[] }
  for (let t = 0; t < pos.count; t += 3) {
    const out = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3 < 0 ? head : tail
    for (let k = t; k < t + 3; k++) {
      out.p.push(pos.getX(k), pos.getY(k), pos.getZ(k))
      if (nor) out.n.push(nor.getX(k), nor.getY(k), nor.getZ(k))
    }
  }
  const make = (o: typeof head) => {
    const b = new THREE.BufferGeometry()
    b.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3))
    if (nor) b.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3))
    return b
  }
  return [make(head), make(tail)]
}

function node(name: string, pieces: Piece[]): THREE.Group {
  const group = new THREE.Group()
  group.name = name
  for (const p of pieces) {
    const named = p.role === 'lamp' ? splitLamps(p.geometry).map((g, i) => [g, i ? 'TailLights' : 'Headlights'] as const) : [[p.geometry, MATERIAL[p.role] ?? 'Interior'] as const]
    for (const [geometry, name] of named) {
      if (!geometry.attributes.position.count) continue
      const material = new THREE.MeshStandardMaterial()
      material.name = name
      material.color.setRGB(...COLOUR[name])
      group.add(new THREE.Mesh(geometry, material))
    }
  }
  return group
}

/** The two stand-in scenes, built fresh (the skin disposes what it is given). */
export function generatedScenes(body: BodyCandidate = buggyBody): { scene: THREE.Group; next: THREE.Group } {
  const pieces = parts.build(0) as Piece[]
  const of = (part: string) => pieces.filter(p => p.part === part)
  const scene = new THREE.Group(), next = new THREE.Group()
  scene.add(node('RimSimple', of('stator')), node('Wings', of('wings')))
  next.add(node('Body', body.build(0).filter(p => p.part === 'body')), node('Sockets', of('sockets')), node('Interior', of('interior')),
    node('Canopy', of('canopy')), node('Strut', of('strut')), node('Shock', of('shock')))
  next.getObjectByName('Shock')!.userData = { foot: SHOCK_FOOT, tops: SHOCK_TOPS }
  return { scene, next }
}

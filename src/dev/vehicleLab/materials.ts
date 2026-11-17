/**
 * Standard preview materials for vehicle lab exhibits, and the lamp helpers. The look follows the
 * tank design studies the owner liked: candy paint under a hard clear coat, mirror chrome, near
 * black glass, matte rubber and a dark metal. They need the lab's softbox environment
 * (studio.ts) to read; without an environment map metal renders close to black.
 *
 * These are preview materials only. Game skins keep their own materials so the lab shows them as
 * they ship.
 */
import * as THREE from 'three/webgpu'
import { abs, dot, float, normalView, positionLocal, positionViewDirection, sin, time, uniform } from 'three/tsl'
import type { LabState } from './types'

export interface MaterialOptions {
  /** DoubleSide for open procedural shells (lofted bodies), FrontSide for closed glb meshes. */
  side?: THREE.Side
}

/** Metallic candy paint with a clear coat: the coat carries the long softbox streaks. */
export const carPaint = (color: THREE.ColorRepresentation, o: MaterialOptions = {}) =>
  new THREE.MeshPhysicalMaterial({ name: 'Paint', color, metalness: .8, roughness: .3, clearcoat: 1, clearcoatRoughness: .03, side: o.side ?? THREE.FrontSide })

/** Second paint colour: a little rougher so stripes and trim separate from the body. */
export const accentPaint = (color: THREE.ColorRepresentation, o: MaterialOptions = {}) =>
  new THREE.MeshPhysicalMaterial({ name: 'Accent', color, metalness: .6, roughness: .4, clearcoat: 1, clearcoatRoughness: .1, side: o.side ?? THREE.FrontSide })

export const chrome = (o: MaterialOptions = {}) =>
  new THREE.MeshStandardMaterial({ name: 'Chrome', color: 0xffffff, metalness: 1, roughness: .05, side: o.side ?? THREE.FrontSide })

/**
 * Canopy glass. Opaque by default (dark tinted, mirror like, as the owner's renders); with an
 * opacity below 1 it becomes see through and is drawn after the opaque body.
 */
export function glass(o: MaterialOptions & { color?: THREE.ColorRepresentation; opacity?: number } = {}) {
  const clear = (o.opacity ?? 1) < 1
  return new THREE.MeshPhysicalMaterial({
    name: 'Glass', color: o.color ?? 0x020305, metalness: clear ? .1 : .3, roughness: .04, clearcoat: 1, clearcoatRoughness: 0,
    transparent: clear, opacity: o.opacity ?? 1, depthWrite: !clear, side: o.side ?? (clear ? THREE.DoubleSide : THREE.FrontSide),
  })
}

/**
 * A force field shell, for canopies and shields: no surface of its own, only light. The edges
 * glow where the shell turns away from the eye (a fresnel rim), thin bands of energy drift over
 * it, and a faint honeycomb shimmer shows it is a field and not glass. Additive, so it never
 * darkens what is behind it, and drawn on both sides so it reads from inside the cockpit too.
 * Returns the material and its colour, which the exhibit sets to the vehicle's accent.
 */
export function forceField(color: THREE.ColorRepresentation = 0x49e6ff) {
  const tint = uniform(new THREE.Color(color))
  const m = new THREE.MeshBasicNodeMaterial({ name: 'Force field', transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
  m.fog = false
  const facing = abs(dot(normalView, positionViewDirection))
  const rim = float(1).sub(facing).pow(2.2)
  // Bands drift from nose to tail; the pow keeps them thin and bright.
  const bands = sin(positionLocal.z.mul(9).add(positionLocal.y.mul(4)).sub(time.mul(1.6))).mul(.5).add(.5).pow(10)
  // Three sine sets 60 degrees apart make a honeycomb without a texture.
  const p = positionLocal.mul(26)
  const cell = sin(p.x).mul(sin(p.x.mul(.5).add(p.z.mul(.866)))).mul(sin(p.x.mul(.5).sub(p.z.mul(.866)))).abs().pow(.35)
  const shimmer = float(1).sub(cell).mul(.35)
  // Mostly rim: face on, the field is nearly invisible, so the driver and the body show through.
  const glow = rim.mul(1.1).add(bands.mul(rim.add(.2)).mul(.35)).add(shimmer.mul(rim.add(.08)).mul(.3)).add(.012)
  m.colorNode = tint.mul(glow).mul(.7)
  m.opacityNode = glow.clamp(0, 1)
  return { material: m, color: tint.value as THREE.Color }
}

export const rubber = (o: MaterialOptions = {}) =>
  new THREE.MeshStandardMaterial({ name: 'Rubber', color: 0x0b0b0c, metalness: 0, roughness: .82, side: o.side ?? THREE.FrontSide })

export const darkMetal = (o: MaterialOptions = {}) =>
  new THREE.MeshStandardMaterial({ name: 'Dark metal', color: 0x1a1c20, metalness: .8, roughness: .42, side: o.side ?? THREE.FrontSide })

/** The full preview set, for exhibits that build their own geometry. */
export function previewMaterials(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation = 0x15171a, o: MaterialOptions = {}) {
  return {
    paint: carPaint(body, o), accent: accentPaint(accent, o), chrome: chrome(o), glass: glass(o), rubber: rubber(o), dark: darkMetal(o),
    headlight: lamp('head', o), tail: lamp('tail', o),
  }
}
export type PreviewMaterials = ReturnType<typeof previewMaterials>

/**
 * Lamp intensities. Tail and brake follow the game skin (Syn3hBuggySkin TAIL_LAMP and
 * BRAKE_LAMP): under ACES tone mapping pure red saturates near 1, so 0.6 reads deep red and 1.5
 * a hotter red. Headlights match the Syn3h prefab's emission of about 3.
 */
export const LAMP = { headOn: 3, headOff: 0, tailOn: .6, brake: 1.5, tailOff: .04 }

/**
 * An emissive lamp face. The base colour is the unlit lens (pale for headlights, dark red for
 * tail lights) so a lamp still looks like a lamp when off.
 */
export function lamp(kind: 'head' | 'tail', o: MaterialOptions = {}) {
  const head = kind === 'head'
  return new THREE.MeshStandardMaterial({
    name: head ? 'Headlight' : 'Tail light', color: head ? 0xd8dde4 : 0x400000, emissive: head ? 0xf2f6ff : 0xff0000,
    emissiveIntensity: head ? LAMP.headOff : LAMP.tailOff, metalness: 0, roughness: .15, side: o.side ?? THREE.FrontSide,
  })
}

/** Sets head and tail lamp materials from the lab state: tail lamps glow with the headlights, brighter on braking. */
export function updateLamps(state: LabState, head: readonly THREE.MeshStandardMaterial[], tail: readonly THREE.MeshStandardMaterial[]): void {
  const h = state.headlights ? LAMP.headOn : LAMP.headOff
  const t = state.braking ? LAMP.brake : state.headlights ? LAMP.tailOn : LAMP.tailOff
  for (const m of head) m.emissiveIntensity = h
  for (const m of tail) m.emissiveIntensity = t
}

export interface BeamOptions {
  color?: THREE.ColorRepresentation
  /** Candela, three's physical light unit. */
  intensity?: number
  /** Cone half angle in radians. */
  angle?: number
  /** Where each beam points, relative to its lamp, in the model frame. */
  aim?: THREE.Vector3
  distance?: number
}

/**
 * Headlight beams: one spot light per lamp position (model frame), aimed ahead and slightly down
 * so it lights the studio floor. They shine only at night with the headlights on; by day the
 * studio is too bright for them to show. Intensity goes to zero rather than toggling visibility,
 * because adding or removing a light recompiles every lit material.
 *
 * Stress copies made by the lab are stripped of lights, so beams cost one model's worth only.
 */
export function addHeadlightBeams(parent: THREE.Object3D, lamps: THREE.Vector3[], o: BeamOptions = {}) {
  const intensity = o.intensity ?? 400
  const aim = o.aim ?? new THREE.Vector3(0, -.7, -6)
  const lights = lamps.map(p => {
    const light = new THREE.SpotLight(o.color ?? 0xf2f4ff, 0, o.distance ?? 30, o.angle ?? .45, .6, 1.2)
    light.name = 'Headlight beam'
    light.position.copy(p)
    light.target.position.copy(p).add(aim)
    parent.add(light, light.target)
    return light
  })
  return {
    lights,
    update(state: LabState) { const on = state.night && state.headlights ? intensity : 0; for (const l of lights) l.intensity = on },
    dispose() { for (const l of lights) { l.removeFromParent(); l.target.removeFromParent(); l.dispose() } },
  }
}

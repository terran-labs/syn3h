/**
 * The marker over whoever is "it" in tag: a faceted green gem with a glow in each facet, a soft
 * halo ring around its waist, and a beam of light that rises from it and fades out upward, so
 * "it" can be found from across the map.
 *
 * All generated: one hand built geometry and one TSL material, no textures. The three parts
 * live in one buffer and are told apart by a vertex attribute, so the whole marker is one draw
 * call (the previous marker was three: gem, ring and beam). Every part is convex or flat and
 * drawn front faces only, so nothing overlaps itself and one depth writing material is enough;
 * the gem comes first in the buffer so the halo's far side is hidden behind it.
 *
 * Unlike the previous marker it is also shown over your own vehicle, lifted high enough that
 * the chase camera sees it above the car instead of on whoever is ahead (itMarkerRules.ts).
 */
import * as THREE from 'three/webgpu'
import { attribute, float, min, mix, normalView, positionViewDirection, select, smoothstep, uniform, vec3 } from 'three/tsl'
import type { Game, System } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import { hotExposureDim } from '../vehicles/skins/hotExposure'
import { clearOfCentre, itMarkerVisible, localMarkerLift, MARKER_BOTTOM, ownMarkerClear, REMOTE_LIFT } from './itMarkerRules'

/** Gem: sides round the waist, waist radius, crown and pavilion heights (a long point down). */
const GEM_SIDES = 6
const GEM_RADIUS = 0.72
const GEM_TOP = 0.75
const GEM_BOTTOM = 1.35
/** Halo ring around the waist: inner and outer radius, segments. */
const HALO_INNER = 1.0
const HALO_OUTER = 1.55
const HALO_SEGMENTS = 40
/** Beam: radius, length, sides, and where its foot sits: inside the crown, where the gem hides
 * the foot's fade in, so the light leaves the tip with no gap. */
const BEAM_RADIUS = 0.2
const BEAM_LENGTH = 40
const BEAM_FOOT = GEM_TOP * 0.5
const BEAM_SIDES = 10

/** Part ids in the `itPart` attribute. */
export const PART_GEM = 0
export const PART_HALO = 1
export const PART_BEAM = 2

/** Linear HDR colours at daytime exposure. The core passes the bloom threshold; the edges are
 * dark so the gem keeps a silhouette against a bright sky. */
const GEM_CORE = new THREE.Color(0.9, 4.2, 0.7)
const GEM_EDGE = new THREE.Color(0.01, 0.13, 0.02)
const GEM_RIM = new THREE.Color(0.25, 1.1, 0.2)
const HALO = new THREE.Color(0.35, 2.0, 0.3)
const BEAM = new THREE.Color(0.3, 1.8, 0.25)

/**
 * Builds the marker's one geometry. Attributes: position, normal, `itPart` (which part), and
 * `itMark` (gem: barycentric coordinates and a per-facet shade; halo: position across the band
 * from -1 to 1; beam: 0 at its foot to 1 at its top in y).
 */
export function buildItMarkerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], part: number[] = [], mark: number[] = []
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), face = new THREE.Vector3()
  type Corner = { p: THREE.Vector3; n: THREE.Vector3; m: number[] }
  /** One triangle, wound so its face points along `out` (front faces are the ones drawn). */
  const tri = (id: number, out: THREE.Vector3, ...corners: [Corner, Corner, Corner]) => {
    face.subVectors(corners[1].p, corners[0].p).cross(e2.subVectors(corners[2].p, corners[0].p))
    if (face.dot(out) < 0) corners.reverse()
    for (const c of corners) { pos.push(c.p.x, c.p.y, c.p.z); nor.push(c.n.x, c.n.y, c.n.z); part.push(id); mark.push(...c.m) }
  }
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const around = (i: number, sides: number) => (i / sides) * Math.PI * 2

  // Gem: a bipyramid with flat facets, each facing away from the centre.
  for (let i = 0; i < GEM_SIDES; i++) {
    const a = V(Math.cos(around(i, GEM_SIDES)) * GEM_RADIUS, 0, Math.sin(around(i, GEM_SIDES)) * GEM_RADIUS)
    const b = V(Math.cos(around(i + 1, GEM_SIDES)) * GEM_RADIUS, 0, Math.sin(around(i + 1, GEM_SIDES)) * GEM_RADIUS)
    for (const tipY of [GEM_TOP, -GEM_BOTTOM]) {
      const c = V(0, tipY, 0)
      const n = e1.subVectors(b, a).cross(V(0, 0, 0).subVectors(c, a)).normalize().clone()
      const out = a.clone().add(b).add(c)
      if (n.dot(out) < 0) n.negate()
      // Alternate facets slightly darker so the cut reads as it turns.
      const shade = (i + (tipY > 0 ? 0 : 1)) % 2 ? 0.7 : 1
      tri(PART_GEM, out, { p: a, n, m: [1, 0, 0, shade] }, { p: b, n, m: [0, 1, 0, shade] }, { p: c, n, m: [0, 0, 1, shade] })
    }
  }

  // Halo: a flat annulus, twice (facing up and down) so it shows from above and below.
  for (const up of [1, -1]) {
    const n = V(0, up, 0)
    for (let i = 0; i < HALO_SEGMENTS; i++) {
      const t0 = around(i, HALO_SEGMENTS), t1 = around(i + 1, HALO_SEGMENTS)
      const i0 = { p: V(Math.cos(t0) * HALO_INNER, 0, Math.sin(t0) * HALO_INNER), n, m: [-1, 0, 0, 0] }
      const o0 = { p: V(Math.cos(t0) * HALO_OUTER, 0, Math.sin(t0) * HALO_OUTER), n, m: [1, 0, 0, 0] }
      const i1 = { p: V(Math.cos(t1) * HALO_INNER, 0, Math.sin(t1) * HALO_INNER), n, m: [-1, 0, 0, 0] }
      const o1 = { p: V(Math.cos(t1) * HALO_OUTER, 0, Math.sin(t1) * HALO_OUTER), n, m: [1, 0, 0, 0] }
      tri(PART_HALO, n, i0, o0, o1); tri(PART_HALO, n, i0, o1, i1)
    }
  }

  // Beam: an open tube from inside the gem's crown upward, faces outward. Its soft edge comes from the
  // shader (how squarely each point faces the camera); only the near half of the tube is drawn.
  for (let i = 0; i < BEAM_SIDES; i++) {
    const t0 = around(i, BEAM_SIDES), t1 = around(i + 1, BEAM_SIDES)
    const n0 = V(Math.cos(t0), 0, Math.sin(t0)), n1 = V(Math.cos(t1), 0, Math.sin(t1))
    const at = (n: THREE.Vector3, along: number) => ({ p: V(n.x * BEAM_RADIUS, BEAM_FOOT + along * BEAM_LENGTH, n.z * BEAM_RADIUS), n, m: [0, along, 0, 0] })
    const out = V(0, 0, 0).addVectors(n0, n1)
    tri(PART_BEAM, out, at(n0, 0), at(n1, 0), at(n1, 1)); tri(PART_BEAM, out, at(n0, 0), at(n1, 1), at(n0, 1))
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('itPart', new THREE.Float32BufferAttribute(part, 1))
  g.setAttribute('itMark', new THREE.Float32BufferAttribute(mark, 4))
  g.computeBoundingSphere()
  return g
}

/** The marker's one material, and `scale`, which multiplies every colour so night exposure does not bleach it. */
export function buildItMarkerMaterial() {
  const scale = uniform(1), fade = uniform(1)
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: THREE.FrontSide })
  m.fog = false
  const partId = attribute('itPart', 'float'), mk = attribute('itMark', 'vec4')
  const facing = normalView.dot(positionViewDirection).abs()

  // Gem: brightest in the middle of each facet and where it faces you, dark along the edges.
  const centre = smoothstep(0, 1, min(mk.x, min(mk.y, mk.z)).mul(3))
  const glow = centre.mul(0.55).add(facing.pow(3).mul(0.6)).mul(mk.w).clamp(0, 1)
  const gem = mix(vec3(GEM_EDGE.r, GEM_EDGE.g, GEM_EDGE.b), vec3(GEM_CORE.r, GEM_CORE.g, GEM_CORE.b), glow.mul(glow))
    .add(vec3(GEM_RIM.r, GEM_RIM.g, GEM_RIM.b).mul(float(1).sub(facing).pow(2)))
  // Halo: soft on both edges of the band.
  const across = float(1).sub(mk.x.mul(mk.x))
  const haloAlpha = across.mul(across).mul(0.75)
  // Beam: soft at the sides, a short ramp in at the foot, then a long smooth fade to nothing.
  const along = mk.y
  const beamAlpha = facing.pow(1.5).mul(smoothstep(0, 0.006, along)).mul(float(1).sub(along).pow(2.2)).mul(0.85)

  const isGem = partId.lessThan(0.5), isHalo = partId.lessThan(1.5)
  m.colorNode = select(isGem, gem, select(isHalo, vec3(HALO.r, HALO.g, HALO.b), vec3(BEAM.r, BEAM.g, BEAM.b))).mul(scale)
  m.opacityNode = select(isGem, float(1), select(isHalo, haloAlpha, beamAlpha)).mul(fade)
  return { material: m, scale, fade }
}

export class ItMarker implements System {
  /** The vehicle that is "it", or null. */
  target: Vehicle | null = null
  /** The local vehicle: its marker is lifted into the chase camera's view. */
  local: Vehicle | null = null
  /** Colour scale for the sky's exposure, read by the material. */
  private readonly dim: ReturnType<typeof buildItMarkerMaterial>['scale']
  /** How much of the marker shows: below 1 only for your own, where it cannot clear the centre. */
  private readonly fade: ReturnType<typeof buildItMarkerMaterial>['fade']
  private readonly probe = new THREE.Vector3()
  readonly mesh: THREE.Mesh
  private readonly cam = new THREE.Vector3()
  private t = 0

  constructor(private readonly game: Game) {
    const { material, scale, fade } = buildItMarkerMaterial()
    this.dim = scale; this.fade = fade
    this.mesh = new THREE.Mesh(buildItMarkerGeometry(), material)
    // Drawn after the other see through things, so its depth writes hide nothing of theirs.
    this.mesh.renderOrder = 10
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    game.scene.add(this.mesh)
  }

  update(dt: number): void {
    this.t += dt
    const v = this.target
    const camera = this.game.camera
    let horizontal = Infinity, rise = 0
    if (v) {
      camera.getWorldPosition(this.cam)
      const p = v.object.position
      horizontal = Math.hypot(this.cam.x - p.x, this.cam.z - p.z)
      rise = this.cam.y - p.y
    }
    const distance = Math.hypot(horizontal, rise)
    this.mesh.visible = itMarkerVisible(v, this.local, distance)
    if (!v || !this.mesh.visible) return
    const bob = Math.sin(this.t * 2.2) * 0.18
    let lift = REMOTE_LIFT + bob, opacity = 1
    if (v === this.local) {
      // Your own: high enough to read from the chase camera, and never over the middle of your
      // view, where you aim (clearOfCentre). Measured on this frame's camera.
      camera.updateMatrixWorld()
      const p = v.object.position, h = Math.max(1, this.game.renderer.domElement.clientHeight), w = Math.max(1, this.game.renderer.domElement.clientWidth)
      const clear = clearOfCentre(localMarkerLift(horizontal, rise, camera.fov) + bob, ownMarkerClear.value, l => {
        const q = this.probe.set(p.x, p.y + l - MARKER_BOTTOM, p.z).applyMatrix4(camera.matrixWorldInverse)
        if (q.z > -0.05) return null
        q.applyMatrix4(camera.projectionMatrix)
        return [q.x * w / (2 * h), q.y / 2]
      })
      lift = clear.lift; opacity = clear.opacity
    }
    this.fade.value = opacity
    this.mesh.visible = opacity > 0.01
    this.mesh.position.copy(v.object.position)
    this.mesh.position.y += lift
    // A slow turn: the facets catch the light one after another.
    this.mesh.rotation.y = this.t * 0.9
    this.dim.value = hotExposureDim(this.game.renderer.toneMappingExposure)
  }

  dispose(): void {
    this.game.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

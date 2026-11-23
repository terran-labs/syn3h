import { WingTipAnchors } from './wingTips'
import { smoothBuggyWheel, distantBuggyBody, distantBuggyArm } from './buggyGeometry'
import {hotExposureNode} from './hotExposure'

import {addStatorGlow,applyShowroom,markReducedShowroomDetail,setRole} from './showroom'
import { forceField, type ForceField } from './forceField'
import { graphicsLevel, levelNumber } from '../../core/quality'
import * as THREE from 'three/webgpu'
import { buggyBody } from '../buggygen/body'
import { buggyHeadlights, headlightScale } from '../effects/headlights'
import { params } from '../../../shared/params'
import { buildParts } from '../buggygen/parts'
import { attribute, clamp, dot, float, length, min, normalView, positionViewDirection, sin, smoothstep, time, uniform, vec2 } from 'three/tsl'
import {mergeStatic,registerVehicleDetail,detailLevel} from './mergeStatic'
import type { BuggySkin } from './BuggySkin'
import { MotorSparks } from './motorSparks'
import { motorSparkAmount } from './motorDrive'
import { decorateBuggyDistance } from './buggyDistanceShading'

const up = new THREE.Vector3(0, 1, 0)
/** Axle mounts: Unity `axelPos`/`AxelPos` mirrored per wheel, z flipped to our -Z forward. */
const axleMounts = (x: number, y: number, z: number) =>
  [new THREE.Vector3(-x, y, -z), new THREE.Vector3(x, y, -z), new THREE.Vector3(-x, y, z), new THREE.Vector3(x, y, z)]

/**
 * Mira hub motor geometry, in the stator's own frame (wheel axle along X). The stator is a
 * wing across the hub whose two tips (z = +-STATOR_TIP) nearly touch the inside of the rotor
 * ring (inner radius about 0.344 m). Those tips are the interface points.
 */
const STATOR_TIP = .33
/** Halos sit just inside the open outer face of the hub, where a player can see them. */
const STATOR_FACE = .2
/** Length of the strut along its span (+Y in its own frame, narrow root at the origin). */
const STRUT_SPAN = .828

/**
 * Tail and brake lamps. Under three's ACES tone mapping pure red saturates at about 1.0 and
 * anything brighter only gains green, so the prefab's (2, 0, 0) and brake (5, 0, 0) render
 * orange to salmon (sRGB 255,92,46 and 255,172,101) where the original shows saturated red.
 * Same 2:5 ratio, scaled: 0.6 renders deep red, the brake's 1.5 a hotter red (255,64,33).
 */
const TAIL_LAMP = .6
/** The headlight lenses' glow at the old full brightness (setting 1). */
const HEAD_LAMP = new THREE.Color().setRGB(2.447059, 2.858824, 3)
/** Size of one cell of the wings' lattice (m): twice the canopy's, for a surface seen from further off. */
const WING_CELL = .24
/** Cockpit glow spots: emission as a multiple of the vehicle's accent colour. */
const COCKPIT_GLOW = 1.6
const BRAKE_LAMP = 1.5

/** Small deterministic generator, so sparks do not differ between identical runs. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * terra.buggy.prefab: the buggy at its true size (Lod scale 1). Axle mounts are the
 * prefab's AxelPos (.55, .15, 1.2); `rest` is where a wheel sits before the first frame.
 */
const LAYOUT = { mounts: axleMounts(.55, .15, 1.2), rest: new THREE.Vector3(1.1, -.2, 1.3) }

// A mesh by its flag rather than its constructor, which stays safe if two Three module
// instances meet in a merged preview.
function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}

/** A generated piece as a shadowed mesh. Pieces arrive with their own normals (creases kept). */
function pieceMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

/**
 * The body's lamp faces split into headlights (ahead of the centre, -Z) and tail lamps, which
 * need different emission. Normals are kept.
 */
function splitLamps(geometry: THREE.BufferGeometry): { head: THREE.BufferGeometry; tail: THREE.BufferGeometry } {
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
  return { head: make(head), tail: make(tail) }
}

/**
 * Base colours (linear) of the body's surfaces, as the original model set them. Paint, accent
 * and glow are repainted by setColors; trim is the one role drawn in its own colour.
 */
const SURFACE_COLOUR: Record<string, [number, number, number]> = {
  paint: [.03, .07, .55], accent: [1, .35, .02], glow: [1, .35, .02], chrome: [.9, .92, .95], frame: [.012, .014, .018], trim: [.035, .038, .045],
}

/** Shock foot on the arm, in the arm's frame (from the original Shock node's extras). */
const SHOCK_FOOT: [number, number, number] = [0, .2, -.07]

/** A body source: anything that builds role-tagged `body` pieces (src/vehicles/buggygen/body.ts). */
export interface BuggyBodySource { build(detail: 0 | 1 | 2): { part: string; role: string; geometry: THREE.BufferGeometry }[] }

function release(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
  root.traverse(o => { if (isMesh(o)) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m) } })
  geometries.forEach(g => g.dispose())
  materials.forEach(m => m.dispose())
}

/** Mira VhiclBuggy.cs 112-128: scale during deployment, then flex the original vertices. */
export function wingVertexMira(x: number, y: number, z: number, open: number, steer: number, pitch: number): [number, number, number] {
  open = THREE.MathUtils.clamp(open, 0, 1)
  if (open < 1) return [x * open, y * open, z]
  // Evaluate in Unity components (z forward, x mirrored by our 180 degree turn), as the original.
  const ux = -x, uz = -z
  let t = uz * ((steer * .05) + (pitch * .05 * (ux > 0 ? -1 : 1)))
  t *= Math.abs(ux) / 10
  t += ux * (pitch * .01)
  const nx = y * Math.sin(t) + ux * Math.cos(t)
  return [-nx, y * Math.cos(t) - nx * Math.sin(t), z]
}

/** Convex outline of the wing planform in (|x|, z), so both mirrored halves share it. */
function planformOutline(meshes: THREE.Mesh[]): THREE.Vector2[] {
  const pts: THREE.Vector2[] = []
  for (const o of meshes) {
    const pos = o.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector2(Math.abs(pos.getX(i)), pos.getZ(i)))
  }
  // Andrew's monotone chain.
  pts.sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: THREE.Vector2[] = [], upper: THREE.Vector2[] = []
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p) }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p) }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Reused per frame so setWheel and setDrive allocate nothing. */
const scratch = {
  matrix: new THREE.Matrix4(), shock: new THREE.Matrix4(), foot: new THREE.Vector3(), axis: new THREE.Vector3(), side: new THREE.Vector3(), span: new THREE.Vector3(), thick: new THREE.Vector3(), chord: new THREE.Vector3(),
  point: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color(), white: new THREE.Color(1, 1, 1), dt: 0,
}

/**
 * The Mira buggy: body, fittings, canopy, cockpit tub, suspension, hub stators and flight wings,
 * all generated in code (src/vehicles/buggygen) with no model file. The body comes from
 * buggygen/body.ts (the control cage); the parts are fitted to that body and supply the shock
 * anchors. Built one microtask after construction so the vehicle has attached `object` first:
 * detail switching registers through its parent (registerVehicleDetail).
 */
export class MiraBuggySkin implements BuggySkin {
  readonly object = new THREE.Group()
  readonly ready: Promise<void>
  /** The lamps are emissive faces of the body mesh (see build). */
  readonly ownLamps = true
  private disposed = false
  private detachDetail=()=>{}
  private detachShowroom=()=>{}
  private tyreBatch?: THREE.InstancedMesh
  private midTyres?: THREE.InstancedMesh
  private midArms?: THREE.InstancedMesh
  private readonly distantBodies: THREE.Group[] = []
  /** Spinning part of each wheel (tyre and rotor ring). The wheel group itself only steers. */
  private readonly rollers = Array.from({length: 4}, () => new THREE.Group())
  // Mira hub motors: wing struts, stators (near and far detail), glow and sparks.
  private struts?: THREE.InstancedMesh
  /**
   * Shock absorbers, one per wheel: each runs from its foot on the swinging arm (`shockFoot`,
   * in the arm's frame) to an anchor fixed inside the body (`shockTops`), and is scaled along
   * its length, so the spring closes up as the wheel rises. The parts supply the tops.
   */
  private shocks?: THREE.InstancedMesh
  private readonly shockFoot = new THREE.Vector3()
  private readonly shockTops: THREE.Vector3[] = []
  private stators: THREE.InstancedMesh[] = []
  /** Per wheel emissive colour of the stator tips, premultiplied by effort. */
  private readonly statorGlow = new THREE.InstancedBufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage)
  private sparks?: MotorSparks
  private sparksAllowed = true
  private readonly effort = [0, 0, 0, 0]
  private readonly regen = [false, false, false, false]
  private readonly lastSpin = [0, 0, 0, 0]
  private readonly spinRate = [0, 0, 0, 0]
  private readonly sparkDebt = [0, 0, 0, 0]
  private lastDriveTime = -1
  private readonly start = performance.now()
  private readonly random = mulberry32(0x5e3d)
  private readonly strutRest: number
  /** Emissive colour shared with the merged body (and its far LOD). */
  private tailLamps?: THREE.Color
  /** The headlight lenses' glow: HEAD_LAMP times the headlight setting (effects/headlights.ts), kept current by unlistenLamps. */
  private headLamps?: THREE.Color
  /** Follows the headlight setting while this skin lives; removed in dispose. */
  private readonly unlistenLamps = params.onChange(id => { if (id === buggyHeadlights.def.id) this.headLamps?.copy(HEAD_LAMP).multiplyScalar(headlightScale().lamp) })
  private bodyColor = new THREE.Color(0x1768b4)
  private accentColor = new THREE.Color(0x49e6ff)
  private readonly bodyMaterials: THREE.MeshStandardMaterial[] = []
  private readonly accentMaterials: THREE.MeshStandardMaterial[] = []
  /** Cockpit glow spots: lit in the accent colour (see COCKPIT_GLOW). */
  private readonly glowMaterials: THREE.MeshStandardMaterial[] = []
  private readonly energyColor = uniform(this.accentColor)
  private readonly wheels = Array.from({length: 4}, () => new THREE.Group())
  /** Wheel scale from setTyreScale: width along the axle (x), radius in y and z. */
  private readonly tyreScale = new THREE.Vector3(1, 1, 1)
  private wings: { mesh: THREE.Mesh; base: Float32Array }[] = []
  private wingInput = [0, 0, 0]
  private readonly wingTips: WingTipAnchors[] = []
  private readonly tipPoint = new THREE.Vector3()
  /** The wings' force field (see forceField.ts), once built. */
  private wingField?: ForceField
  private wingMesh?: THREE.Mesh

  constructor(private readonly bodySource: BuggyBodySource = buggyBody) {
    // Scripts find the skin by this name (tools/velocity-isolate.mjs).
    this.object.name = 'mira buggy skin'
    const r0 = LAYOUT.rest, m0 = LAYOUT.mounts[3]
    this.strutRest = Math.hypot(r0.x - m0.x, r0.y - m0.y, r0.z - m0.z)
    this.wheels.forEach((w, i) => {
      this.object.add(w)
      w.add(this.rollers[i])

      const r = LAYOUT.rest
      this.setWheel(i, new THREE.Vector3(i % 2 ? r.x : -r.x, r.y, i < 2 ? -r.z : r.z), 0, 0)
    })
    this.object.visible = false
    this.ready = Promise.resolve().then(() => this.build())
  }

  private build(): void {
    if (this.disposed) return
    // The body once, then the parts fitted to it: swellings conform to it and the shock tops are
    // found on it.
    const bodyPieces = this.bodySource.build(0).filter(p => p.part === 'body')
    const fitted = buildParts(0, bodyPieces.map(p => p.geometry))
    const pieces: { part: string; role: string; geometry: THREE.BufferGeometry }[] = [...bodyPieces, ...fitted.pieces]
    const of = (part: string) => pieces.filter(p => p.part === part)
    // Body, fittings (skid plate, swellings, headlight lenses) and the cockpit tub: one material
    // per surface, each tagged with its role for the shared shading.
    const surfaces = new Map<string, THREE.MeshStandardMaterial>()
    const surface = (key: string): THREE.MeshStandardMaterial => {
      let m = surfaces.get(key)
      if (m) return m
      m = new THREE.MeshStandardMaterial({roughness: .36, metalness: .3})
      m.name = key
      const colour = SURFACE_COLOUR[key]
      if (colour) m.color.setRGB(...colour)
      if (key === 'paint') { this.bodyMaterials.push(m); setRole(m, 'paint') }
      // Cockpit glow spots: lit in the accent colour (see COCKPIT_GLOW and setColors).
      else if (key === 'glow') { this.glowMaterials.push(m); setRole(m, 'accent') }
      else if (key === 'accent') { this.accentMaterials.push(m); setRole(m, 'accent') }
      else if (key === 'chrome') setRole(m, 'chrome')
      // Scoop interiors, socket wells: dark structural metal.
      else if (key === 'frame') setRole(m, 'frame')
      // Emission from terra.buggy.prefab; values above 1 are deliberate (no bloom here, so they
      // survive tone mapping as a hot core). addNightReadability later scales emission by
      // hotExposureNode, as the effects lamps use hotExposureDim, so they do not bleach under the
      // night exposure. mergeStatic reads the emissive Color by reference, so setLights can
      // change it after the merge.
      else if (key === 'headlight') { setRole(m, 'lamp'); m.color.set(0xe8f0ff); m.emissive.copy(HEAD_LAMP).multiplyScalar(headlightScale().lamp); m.metalness = 0; this.headLamps = m.emissive }
      else if (key === 'taillight') { setRole(m, 'lamp'); m.color.set(0x400000); m.emissive.setRGB(TAIL_LAMP, 0, 0); m.metalness = 0; this.tailLamps = m.emissive }
      else setRole(m, 'trim')
      surfaces.set(key, m)
      return m
    }
    const body = new THREE.Group()
    for (const p of [...of('body'), ...of('sockets'), ...of('interior')]) {
      if (p.role === 'lamp') {
        const { head, tail } = splitLamps(p.geometry)
        if (head.attributes.position.count) body.add(pieceMesh(head, surface('headlight')))
        if (tail.attributes.position.count) body.add(pieceMesh(tail, surface('taillight')))
      } else body.add(pieceMesh(p.geometry, surface(p.role)))
    }
    const staticBody=new THREE.Group();this.object.add(staticBody);staticBody.add(body)
    // The canopy is one mesh, both halves, already in place: the shared force field. It stays
    // out of the body merge (one draw of its own), so the showroom tiers can blend it.
    const glass = setRole(new THREE.MeshStandardMaterial({color: 0x192c44, metalness: .65, roughness: .18}), 'canopy'); glass.name = 'Cockpit'; glass.userData.separate = true
    const canopy = new THREE.Group()
    for (const p of of('canopy')) canopy.add(pieceMesh(p.geometry, glass))
    mergeStatic(staticBody, true)
    mergeStatic(canopy, true)
    // The force field stays in view from the seat: MiraBuggy sets userData.cockpit on the
    // vehicle, which tells the ride camera to hide nothing.
    canopy.traverse(o => { if (o instanceof THREE.Mesh) o.name = 'Canopy' })
    canopy.name = 'Canopy'
    this.object.add(canopy)
    const wheel = smoothBuggyWheel()
    mergeStatic(wheel, true)
    const mesh = wheel.children[0] as THREE.Mesh
    this.tyreBatch = new THREE.InstancedMesh(mesh.geometry, mesh.material, 4)
    this.tyreBatch.name = 'Smooth tyres and chrome rings'
    this.tyreBatch.castShadow = this.tyreBatch.receiveShadow = true
    this.tyreBatch.frustumCulled = false
    this.object.add(this.tyreBatch)
    this.buildHubMotors(of, fitted.shockTops)
    const midBody = distantBuggyBody(this.bodyColor, this.accentColor, false)
    const farBody = distantBuggyBody(this.bodyColor, this.accentColor, true)
    this.object.add(midBody, farBody)
    this.distantBodies.push(midBody, farBody)
    const tyre = smoothBuggyWheel(12).children[0] as THREE.Mesh
    this.midTyres = new THREE.InstancedMesh(tyre.geometry, tyre.material, 4)
    this.midTyres.name = 'Mid tyres'; this.midTyres.frustumCulled = false
    const arm = distantBuggyArm()
    this.midArms = new THREE.InstancedMesh(arm.geometry, arm.material, 4)
    this.midArms.name = 'Mid suspension'; this.midArms.frustumCulled = false
    this.object.add(this.midTyres, this.midArms)
    midBody.visible = farBody.visible = this.midTyres.visible = this.midArms.visible = false
    this.wheels.forEach((w, i) => this.setWheel(i, w.position, w.rotation.y, this.rollers[i].rotation.x))
    // Both halves, already in the game frame.
    const wingGroup = new THREE.Group()
    for (const p of of('wings')) wingGroup.add(pieceMesh(p.geometry, new THREE.MeshStandardMaterial()))
    // Both flight wings deform by vertex position, so they can share one geometry and draw.
    mergeStatic(wingGroup, true)
    // Force field material after Mira "Vehicle Wings" (an edge detecting, fresnel, panning
    // texture shader: brightness 7, pan speed -0.5, texture V scale 0.1, solid colour tinted by
    // the vehicle). Our wing meshes are coarse shells with arbitrary UVs, so the edge glow is
    // computed per fragment as the distance to the wing's planform outline, measured on the
    // undeformed wing so it stays on the rim while the wing flexes.
    const meshes: THREE.Mesh[] = []
    wingGroup.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o) })
    const outline = planformOutline(meshes)
    for (const o of meshes) {
      const pos = o.geometry.attributes.position, plan = new Float32Array(pos.count * 2)
      for (let i = 0; i < pos.count; i++) { plan[i * 2] = Math.abs(pos.getX(i)); plan[i * 2 + 1] = pos.getZ(i) }
      o.geometry.setAttribute('wingPlan', new THREE.BufferAttribute(plan, 2))
    }
    const p = attribute<'vec2'>('wingPlan', 'vec2')
    // TSL node types do not compose through a running min, so keep the accumulator loose.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dist: any = float(1e4)
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length]
      // The two halves join on the centre line: no rim there.
      if (a.x < .05 && b.x < .05) continue
      const ab = vec2(b.x - a.x, b.y - a.y), ap = p.sub(vec2(a.x, a.y))
      const t = clamp(dot(ap, ab).div(Math.max(1e-6, (b.x - a.x) ** 2 + (b.y - a.y) ** 2)), 0, 1)
      dist = min(dist, length(ap.sub(ab.mul(t))))
    }
    const edge = float(1).sub(smoothstep(0, .45, dist))
    const rim = float(1).sub(smoothstep(0, .08, dist))
    // The shared force field parts: off-angle opacity, the canopy's lattice at wing scale, a
    // glow where a wing meets the ground, another vehicle or its own hull, and the flash and
    // ring of an absorbed blow. The contact glow reads the frame's depth, so it is for the
    // higher graphics tiers; the level is read once, when the skin builds.
    const field = this.wingField = forceField({ cell: WING_CELL, contact: levelNumber(graphicsLevel.value) >= 2 })
    // Seen edge on, the sheet itself brightens (the original's fresnel term); face on it is
    // nearly clear, so the ground shows through the middle of a wing seen from above.
    const fresnel = field.grazing.pow(2.5)
    // Panning bands across the chord.
    const flow = sin(p.y.mul(2.2).add(p.x.mul(.35)).add(time.mul(3))).mul(.5).add(.5).pow(6)
    // The lattice is faint until a band or an absorbed blow passes over it.
    const lattice = field.lattice.mul(flow.mul(.55).add(field.absorb.mul(2.5)).add(.12))
    const glow = edge.mul(1.2).add(rim.mul(2.2)).add(flow.mul(.3)).add(fresnel.mul(.9)).add(lattice).add(field.contact.mul(2.6)).add(field.absorb.mul(1.6)).add(.02)
    const energy = new THREE.MeshBasicNodeMaterial({transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false})
    energy.fog = false
    energy.forceSinglePass = true
    energy.colorNode = this.energyColor.mul(glow).mul(hotExposureNode())
    energy.opacityNode = clamp(glow, 0, 1)
    // Additive light washes out to white over a sunlit desert, so a normally blended tint layer
    // underneath keeps the accent hue readable at noon; at night the additive glow dominates.
    const tint = new THREE.MeshBasicNodeMaterial({transparent: true, side: THREE.DoubleSide, depthWrite: false})
    tint.fog = false
    tint.forceSinglePass = true
    tint.colorNode = this.energyColor.mul(.55).mul(hotExposureNode())
    tint.opacityNode = clamp(edge.mul(.45).add(rim.mul(.35)).add(flow.mul(.08)).add(fresnel.mul(.3)).add(field.contact.mul(.35)).add(field.absorb.mul(.25)).add(.05), 0, .8)
    for (const o of meshes) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
      o.material = energy; o.castShadow = false; o.receiveShadow = false
      const under = new THREE.Mesh(o.geometry, tint)
      under.renderOrder = -1
      o.add(under)
      this.wings.push({mesh: o, base: new Float32Array(o.geometry.attributes.position.array)})
      this.wingMesh = o
      this.wingTips.push(new WingTipAnchors(o))
    }
    this.object.add(wingGroup)
    this.setColors(this.bodyColor, this.accentColor)
    this.setWings(this.wingInput[0], this.wingInput[1], this.wingInput[2])
    const shadows:THREE.Mesh[]=[];this.object.traverse(o=>{if(o instanceof THREE.Mesh&&o.castShadow)shadows.push(o)})
    let lastDetail: 0 | 1 | 2 = 0
    this.detachDetail=registerVehicleDetail(this.object,(distance,remote,level)=>{
      lastDetail = detailLevel(distance, remote, lastDetail)
      const near = lastDetail === 0, mid = lastDetail === 1
      staticBody.visible = canopy.visible = wingGroup.visible = near
      this.tyreBatch!.visible = near
      this.struts!.visible = near
      if (this.shocks) this.shocks.visible = near
      this.stators.forEach((s, i) => { s.visible = near && i === 0 })
      midBody.visible = this.midTyres!.visible = this.midArms!.visible = mid
      farBody.visible = lastDetail === 2

      // Sparks are a close-up detail; other players' buggies only show them nearby.
      this.sparksAllowed=!remote||distance<(level===2?40:20)
      const cast=!remote||distance<(level===2?20:0)
      shadows.forEach(m=>{m.castShadow=cast})
    })
    const reduced = [midBody, farBody, this.midTyres, this.midArms]
    for (const part of reduced) markReducedShowroomDetail(part)
    this.detachShowroom = applyShowroom(this.object, decorateBuggyDistance(
      reduced, { body: this.bodyColor, accent: this.accentColor },
      [staticBody, this.tyreBatch, this.struts!, this.shocks!],
    ))
    this.object.visible = true
  }

  /**
   * Tyre size: scales each wheel's root, so the tyre, rotor ring, stator, glow and sparks all
   * grow together about the hub. The arm and shock run hub to body and only follow the hub.
   */
  setTyreScale(radius: number, width: number): void {
    this.tyreScale.set(width, radius, radius)
    this.wheels.forEach((w, i) => this.setWheel(i, w.position, w.rotation.y, this.rollers[i].rotation.x))
  }

  setWheel(index: number, localPosition: THREE.Vector3, steerAngle: number, spinAngle: number): void {
    const wheel = this.wheels[index]
    if (!wheel) throw new RangeError('Wheel index must be 0 to 3')
    wheel.position.copy(localPosition)
    wheel.scale.copy(this.tyreScale)
    // Same transform as the former single 'YXZ' Euler (steer, then spin), split so the Mira
    // stator can steer and travel with the wheel without spinning: Unity's prefab spins only
    // the `Roll` child (tyre and rotor ring), while `Rim` (the stator) sits on the steered root.
    wheel.rotation.set(0, steerAngle, 0)
    this.rollers[index].rotation.x = spinAngle
    if (this.tyreBatch) {
      wheel.updateMatrix(); this.rollers[index].updateMatrix()
      scratch.matrix.multiplyMatrices(wheel.matrix, this.rollers[index].matrix)
      this.tyreBatch.setMatrixAt(index, scratch.matrix); this.tyreBatch.instanceMatrix.needsUpdate = true
      if (this.midTyres) { this.midTyres.setMatrixAt(index, scratch.matrix); this.midTyres.instanceMatrix.needsUpdate = true }
    }
    const mount = LAYOUT.mounts[index]
    if (this.struts) {
      wheel.updateMatrix()
      for (const s of this.stators) { s.setMatrixAt(index, wheel.matrix); s.instanceMatrix.needsUpdate = true }
      this.strutMatrix(localPosition, mount, scratch.matrix)
      this.struts.setMatrixAt(index, scratch.matrix); this.struts.instanceMatrix.needsUpdate = true
      if (this.midArms) { this.midArms.setMatrixAt(index, scratch.matrix); this.midArms.instanceMatrix.needsUpdate = true }
      if (this.shocks) {
        // Foot carried by the arm, top fixed in the body; unit length along +Y in between.
        const foot = scratch.foot.copy(this.shockFoot).applyMatrix4(scratch.matrix)
        const axis = scratch.axis.copy(this.shockTops[index]).sub(foot)
        const side = scratch.side.set(0, 0, 1).cross(axis)
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
        side.normalize()
        scratch.shock.makeBasis(side, axis, scratch.span.crossVectors(side, axis).normalize()).setPosition(foot)
        this.shocks.setMatrixAt(index, scratch.shock); this.shocks.instanceMatrix.needsUpdate = true
      }
    }
    // Rotor speed for the spark direction, from successive spin angles.
    this.spinRate[index] = spinAngle - this.lastSpin[index]
    this.lastSpin[index] = spinAngle
  }

  /**
   * VhiclBuggy.cs Update: `axle.rotation = LookRotation(mount - wheel, body.up)`, set in world
   * space every frame, so the strut follows suspension travel but not steering (it overrides
   * the steered wheel root it hangs from). Unity's import of the .blend maps the mesh's Blender
   * Z (glb +Y, the span, narrow root at the origin) to local +Z and Blender Y (glb -Z, the
   * wing's thickness) to local +Y, so: glb +Y points from hub to body mount and glb -Z points
   * as near body up as it can. The chord (glb X) then lies fore and aft. The mesh is mirror
   * symmetric in X and Z, so left and right struts need no reflection, only this rotation.
   * Unity never scaled the strut, whose flared end runs a little into the body at rest; we
   * stretch it along the span only when the wheel droops further, so no gap opens.
   */
  private strutMatrix(hub: THREE.Vector3, mount: THREE.Vector3, out: THREE.Matrix4): void {
    const span = scratch.span.copy(mount).sub(hub), length = span.length()
    if (length < 1e-6) { out.makeTranslation(hub.x, hub.y, hub.z); return }
    span.divideScalar(length)
    const thick = scratch.thick.copy(up).addScaledVector(span, -up.dot(span)).normalize().negate()
    const chord = scratch.chord.crossVectors(span, thick)
    const stretch = Math.max(1, (length + STRUT_SPAN - this.strutRest) / STRUT_SPAN)
    out.makeBasis(chord, span.multiplyScalar(stretch), thick).setPosition(hub)
  }

  /** Mira only: the wing struts, the stators and the motor glow, from the generated parts. */
  private buildHubMotors(of: (part: string) => { role: string; geometry: THREE.BufferGeometry }[], shockTops: [number, number, number][]): void {
    // Chrome is a bright, fairly smooth metal; the game has no environment map, so keep some
    // diffuse colour or it renders near black away from the sun.
    const chrome = () => new THREE.MeshStandardMaterial({color: 0xc4ccd6, metalness: .75, roughness: .22})
    // Accent.001 on the stator and strut is NOT the vehicle accent: VhiclBuggy.cs 76-77 has the
    // Rim's MaterialAccents line commented out, and the owner's screenshots of the original show
    // the hub wing dark with a chrome sheen. A dark metal also lets the accent glow read.
    const wingMetal = () => new THREE.MeshStandardMaterial({color: 0x59616c, roughness: .3, metalness: .55})
    // The stator, built centred on the hub with the wheel axle along X: frame metal and chrome.
    const prepare = () => {
      const part = new THREE.Group()
      for (const p of of('stator')) part.add(pieceMesh(p.geometry, p.role === 'chrome' ? setRole(chrome(), 'chrome') : setRole(wingMetal(), 'frame')))
      return part
    }
    // Rotor/stator interface: the stator's two tips, lit in proportion to motor effort. The
    // glow colour is a per-instance attribute, so four wheels stay one draw call.
    this.stators = [0].map(lod => {
      const part = prepare()
      mergeStatic(part, true)
      const merged = part.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>
      const material = merged.material
      merged.geometry.setAttribute('statorGlow', this.statorGlow)
      addStatorGlow(material, STATOR_TIP)
      const mesh = new THREE.InstancedMesh(merged.geometry, material, 4)
      mesh.name = 'Stators'
      mesh.castShadow = mesh.receiveShadow = true
      mesh.frustumCulled = false
      mesh.visible = !lod
      this.object.add(mesh)
      return mesh
    })
    // The Box arm's suspension member: a heavy box arm with an accent rib and a coilover, modelled
    // in the original Axle's frame (hub at the origin, span along +Y), so strutMatrix places it
    // unchanged. Its three materials merge into one instanced draw for all four corners; the
    // spring and rib keep following the vehicle's accent colour through the merge.
    const arm = new THREE.Group()
    for (const p of of('strut')) {
      const m = p.role === 'chrome' ? setRole(chrome(), 'chrome') : p.role === 'accent' ? setRole(new THREE.MeshStandardMaterial({color: this.accentColor, roughness: .35, metalness: .55}), 'accent') : setRole(new THREE.MeshStandardMaterial({color: 0x23272d, roughness: .34, metalness: .7}), 'frame')
      if (p.role === 'accent') this.accentMaterials.push(m)
      arm.add(pieceMesh(p.geometry, m))
    }
    mergeStatic(arm, true)
    const axle = arm.children[0] as THREE.Mesh
    this.struts = new THREE.InstancedMesh(axle.geometry, axle.material, 4)
    this.struts.name = 'Suspension arms'
    this.struts.castShadow = this.struts.receiveShadow = true
    this.struts.frustumCulled = false
    this.object.add(this.struts)
    // The shock: chrome rod and collar, spring in the accent colour, one instanced draw.
    if (shockTops.length !== 4) throw new Error('Buggy parts gave no shock anchors')
    this.shockFoot.fromArray(SHOCK_FOOT)
    for (const top of shockTops) this.shockTops.push(new THREE.Vector3(...top))
    const shock = new THREE.Group()
    for (const p of of('shock')) {
      const accent = p.role === 'accent'
      const m = accent ? setRole(new THREE.MeshStandardMaterial({color: this.accentColor, roughness: .35, metalness: .55}), 'accent') : setRole(chrome(), 'chrome')
      if (accent) this.accentMaterials.push(m)
      shock.add(pieceMesh(p.geometry, m))
    }
    mergeStatic(shock, true)
    const spring = shock.children[0] as THREE.Mesh
    this.shocks = new THREE.InstancedMesh(spring.geometry, spring.material, 4)
    this.shocks.name = 'Shocks'
    this.shocks.castShadow = this.shocks.receiveShadow = true
    this.shocks.frustumCulled = false
    this.object.add(this.shocks)
    this.sparks = new MotorSparks(8, 48)
    this.object.add(this.sparks.mesh)
    this.wheels.forEach((w, i) => this.setWheel(i, w.position, w.rotation.y, this.rollers[i].rotation.x))
  }

  fieldHit(worldPoint: THREE.Vector3, strength: number): void {
    if (!this.wingField || !this.wingMesh?.visible) return
    this.wingField.hit(this.wingMesh.worldToLocal(scratch.point.copy(worldPoint)), strength)
  }

  setLights(braking: boolean): void {
    this.tailLamps?.setRGB(braking ? BRAKE_LAMP : TAIL_LAMP, 0, 0)
  }

  setDrive(index: number, effort: number, regen = false, sparks = 0): void {
    if (!this.sparks) return
    effort = THREE.MathUtils.clamp(effort, 0, 1)
    this.effort[index] = effort; this.regen[index] = regen
    // Regeneration glows dimmer and cooler: the accent washed toward white.
    const c = scratch.color.copy(this.accentColor)
    if (regen) c.lerp(scratch.white, .5).multiplyScalar(.45)
    const lit = effort * effort
    this.statorGlow.setXYZ(index, c.r * lit, c.g * lit, c.b * lit); this.statorGlow.needsUpdate = true
    const wheel = this.wheels[index], out = index % 2 ? 1 : -1
    wheel.updateMatrix()
    for (let tip = 0; tip < 2; tip++) {
      const p = scratch.point.set(out * STATOR_FACE, 0, tip ? STATOR_TIP : -STATOR_TIP).applyMatrix4(wheel.matrix)
      const on = lit > .004
      this.sparks.setHalo(index * 2 + tip, p.x, p.y, p.z, on ? .08 + .16 * effort : 0, c.r * lit, c.g * lit, c.b * lit)
    }
    // Sparks: only at the motor's peak load (the caller's `sparks`), a few per second rising
    // to a spray, from a random tip.
    const now = (performance.now() - this.start) / 1000
    if (index === 0) { this.lastDriveTime = this.lastDriveTime < 0 ? now : this.lastDriveTime; scratch.dt = Math.min(.1, now - this.lastDriveTime); this.lastDriveTime = now }
    const hard = regen ? 0 : THREE.MathUtils.clamp(sparks, 0, 1)
    this.sparkDebt[index] = Math.min(3, this.sparkDebt[index] + hard * hard * 36 * motorSparkAmount.value * scratch.dt)
    while (this.sparkDebt[index] >= 1) {
      this.sparkDebt[index] -= 1
      const tip = this.random() < .5 ? 1 : -1, rnd = this.random
      const p = scratch.point.set(out * STATOR_FACE * (.6 + .4 * rnd()), (rnd() - .5) * .08, tip * STATOR_TIP).applyMatrix4(wheel.matrix)
      // Thrown along the rotor's surface motion at that tip (spin about the axle: v = w x r has
      // only a vertical part there), then out of the hub face, with some scatter.
      const along = -Math.sign(this.spinRate[index] || -1) * tip
      const v = scratch.velocity.set(out * (1 + rnd() * 1.6), along * (1.2 + rnd() * 1.6), (rnd() - .5) * 1.4).applyQuaternion(wheel.quaternion)
      const heat = .7 + rnd() * .3
      this.sparks.emit(p.x, p.y, p.z, v.x, v.y, v.z, .14 + rnd() * .18, .035 + rnd() * .03,
        1.6 * heat, (1.1 + c.g * .5) * heat, (.45 + c.b * .8) * heat)
    }
    if (index === 3) this.sparks.commit(now, this.sparksAllowed)
  }

  /** Current visible wing tip, in skin-local coordinates, at the active detail level. */
  getWingTip(side: -1 | 1, out: THREE.Vector3): boolean {
    if (this.wingInput[0] <= 0 || !this.object.visible) return false
    let found = false
    for (const tips of this.wingTips) {
      if (tips.get(side, this.object, this.tipPoint) && (!found || side * this.tipPoint.x > side * out.x)) {
        out.copy(this.tipPoint); found = true
      }
    }
    for (const body of this.distantBodies) {
      const tips = body.userData.wingTips as WingTipAnchors | undefined
      if (tips?.get(side, this.object, this.tipPoint) && (!found || side * this.tipPoint.x > side * out.x)) {
        out.copy(this.tipPoint); found = true
      }
    }
    return found
  }

  drawCoveredWings(draw: () => void): void {
    const hidden: THREE.Object3D[] = []
    try {
      for (const { mesh } of this.wings) {
        for (let part: THREE.Object3D | null = mesh; part && part !== this.object; part = part.parent) {
          if (part.visible) continue
          hidden.push(part)
          part.visible = true
        }
      }
      draw()
    } finally {
      for (const part of hidden) part.visible = false
    }
  }

  drawCoveredMotorSparks(draw: () => void): void {
    if (this.sparks) this.sparks.drawCovered(draw)
    else draw()
  }

  setWings(openAmount: number, steer: number, pitch: number): void {
    this.wingInput = [openAmount, steer, pitch]
    for (const body of this.distantBodies) body.userData.setWings(THREE.MathUtils.clamp(openAmount, 0, 1))
    for (const {mesh, base} of this.wings) {
      mesh.visible = openAmount > 0
      const position = mesh.geometry.attributes.position
      for (let i = 0; i < position.count; i++) position.setXYZ(i, ...wingVertexMira(base[i*3], base[i*3+1], base[i*3+2], openAmount, steer, pitch))
      position.needsUpdate = true
      mesh.geometry.computeVertexNormals()
      mesh.geometry.computeBoundingSphere()
    }
  }
  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.bodyColor.set(body); this.accentColor.set(accent)
    this.bodyMaterials.forEach(m => m.color.copy(this.bodyColor))
    this.accentMaterials.forEach(m => m.color.copy(this.accentColor))
    this.glowMaterials.forEach(m => { m.color.copy(this.accentColor); m.emissive.copy(this.accentColor).multiplyScalar(COCKPIT_GLOW) })
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unlistenLamps()
    this.detachDetail()
    this.sparks?.dispose()
    for (const stator of this.stators) stator.dispose()
    this.detachShowroom()
    this.object.removeFromParent()
    release(this.object)
    this.object.clear()
  }
}

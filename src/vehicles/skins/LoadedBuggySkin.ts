import {hotExposureNode} from './hotExposure'
import {addLavaGlow} from './lavaGlow'
import {addNightReadability} from './nightReadability'
import {applyShowroom,setRole} from './showroom'
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { abs, attribute, clamp, dot, float, instancedBufferAttribute, length, min, normalView, positionGeometry, positionViewDirection, sin, smoothstep, time, uniform, vec2 } from 'three/tsl'
import {mergeStatic,registerVehicleDetail,staticLods,reducedGeometry} from './mergeStatic'
import type { BuggySkin } from './BuggySkin'
import { MotorSparks } from './motorSparks'
import type Node from 'three/src/nodes/core/Node.js'

const loader = new GLTFLoader()
const up = new THREE.Vector3(0, 1, 0)
/** Axle mounts: Unity `axelPos`/`AxelPos` mirrored per wheel, z flipped to our -Z forward. */
const axleMounts = (x: number, y: number, z: number) =>
  [new THREE.Vector3(-x, y, -z), new THREE.Vector3(x, y, -z), new THREE.Vector3(-x, y, z), new THREE.Vector3(x, y, z)]

/**
 * Per kind layout. Classic: Mars Explorer Buggy.prefab (Lod scale 2.15, axelPos (.375, -.1, .75),
 * 0.6 m wheels). Syn3h: terra.buggy.prefab (Lod scale 1, so the glb is used at its true size,
 * AxelPos (.55, .15, 1.2), wheel template at its native 1.04 m diameter).
 */
/**
 * Syn3h hub motor geometry, in the stator's own frame (glb axes, wheel axle along X). The `Rim`
 * mesh is the stator: a wing across the hub whose two tips (z = +-STATOR_TIP) nearly touch the
 * inside of the rotor ring (inner radius about 0.344 m). Those tips are the interface points.
 */
const STATOR_TIP = .33
/** Halos sit just inside the open outer face of the hub, where a player can see them. */
const STATOR_FACE = .2
/** Length of the `Axle` strut mesh along its span (glb +Y, narrow root at the origin). */
const STRUT_SPAN = .828

/**
 * Tail and brake lamps. Under three's ACES tone mapping pure red saturates at about 1.0 and
 * anything brighter only gains green, so the prefab's (2, 0, 0) and brake (5, 0, 0) render
 * orange to salmon (sRGB 255,92,46 and 255,172,101) where the original shows saturated red.
 * Same 2:5 ratio, scaled: 0.6 renders deep red, the brake's 1.5 a hotter red (255,64,33).
 */
/** The body the owner chose on 14 November 2026: round 4, Box arm. Built by tools/buggy-bodies. */
const BOX_ARM_BODY = '/models/buggy-boxarm.glb'
const TAIL_LAMP = .6
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

const layouts = {
  classic: { scale: 2.15, mounts: axleMounts(.375, -.1, .75), wheelDiameter: .6 as number | null, wheelWidth: 1.2, rest: new THREE.Vector3(.7, -.3, .8) },
  syn3h: { scale: 1, mounts: axleMounts(.55, .15, 1.2), wheelDiameter: null as number | null, wheelWidth: 1, rest: new THREE.Vector3(1.1, -.2, 1.3) },
}

/** Bake import transforms so suspension and deformation use the vehicle frame. */
function extract(root: THREE.Object3D, transform = new THREE.Matrix4()): THREE.Group {
  const result = new THREE.Group()
  root.updateWorldMatrix(true, true)
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    const geometry = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, o.matrixWorld))
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone())
    mesh.name = o.name
    mesh.castShadow = mesh.receiveShadow = true
    result.add(mesh)
  })
  return result
}
function release(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
  root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m) } })
  geometries.forEach(g => g.dispose())
  materials.forEach(m => m.dispose())
}

/** A node by name, allowing the numeric suffix Blender adds on export ('Body.001' loads as 'Body001'). */
function nodeNamed(root: THREE.Object3D, name: string): THREE.Object3D {
  let found: THREE.Object3D | undefined
  root.traverse(o => { if (!found && new RegExp(`^${name}(\\.?\\d+)?$`).test(o.name)) found = o })
  if (!found) throw new Error(`Buggy model has no ${name} node`)
  return found
}

/** Buggy.js 134-158: scale during deployment, then flex the original vertices. */
export function wingVertex(x: number, y: number, z: number, open: number, steer: number, pitch: number): [number, number, number] {
  open = THREE.MathUtils.clamp(open, 0, 1)
  if (open < 1) return [x * open, y * open, z]
  const unityZ = -z
  const t = (unityZ > .2 ? 0 : unityZ * steer * .14 * Math.abs(x) / 10) + x * pitch * .04
  const nx = y * Math.sin(t) + x * Math.cos(t)
  // Preserve the original sequential x/y update, including its small asymmetry.
  return [nx, y * Math.cos(t) - nx * Math.sin(t), z]
}

/** Syn3h VhiclBuggy.cs 112-128: same deployment scale, different flex and no forward cutoff. */
export function wingVertexSyn3h(x: number, y: number, z: number, open: number, steer: number, pitch: number): [number, number, number] {
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
  matrix: new THREE.Matrix4(), span: new THREE.Vector3(), thick: new THREE.Vector3(), chord: new THREE.Vector3(),
  point: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color(), white: new THREE.Color(1, 1, 1), dt: 0,
}

export class LoadedBuggySkin implements BuggySkin {
  readonly object = new THREE.Group()
  readonly ready: Promise<void>
  /** Syn3h's lamps are emissive faces of its body mesh (see load). */
  readonly ownLamps: boolean
  private disposed = false
  private detachDetail=()=>{}
  private detachShowroom=()=>{}
  private axleBatch?:THREE.InstancedMesh
  private readonly simpleWheels:THREE.Group[]=[]
  private readonly highWheels:THREE.Object3D[]=[]
  /** Spinning part of each wheel (tyre and rotor ring). The wheel group itself only steers. */
  private readonly rollers = Array.from({length: 4}, () => new THREE.Group())
  // Syn3h hub motors: wing struts, stators (near and far detail), glow and sparks.
  private struts?: THREE.InstancedMesh
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
  private bodyColor = new THREE.Color(0x1768b4)
  private accentColor = new THREE.Color(0x49e6ff)
  private readonly bodyMaterials: THREE.MeshStandardMaterial[] = []
  private readonly accentMaterials: THREE.MeshStandardMaterial[] = []
  private readonly energyColor = uniform(this.accentColor)
  private readonly wheels = Array.from({length: 4}, () => new THREE.Group())
  private readonly axles: THREE.Mesh[] = []
  private wings: { mesh: THREE.Mesh; base: Float32Array }[] = []
  private wingInput = [0, 0, 0]
  private readonly layout: (typeof layouts)['classic']
  private readonly wingFn: typeof wingVertex

  constructor(kind: 'classic' | 'syn3h') {
    this.layout = layouts[kind]
    this.wingFn = kind === 'classic' ? wingVertex : wingVertexSyn3h
    this.object.name = `${kind} buggy skin`
    this.ownLamps = kind === 'syn3h'
    const r0 = this.layout.rest, m0 = this.layout.mounts[3]
    this.strutRest = Math.hypot(r0.x - m0.x, r0.y - m0.y, r0.z - m0.z)
    // Classic keeps its thin cylinder axles; Syn3h's wing struts are created on load.
    if (kind === 'classic') {
      const axleGeometry=new THREE.CylinderGeometry(.025,.025,1,8),axleMaterial=new THREE.MeshStandardMaterial({color:0x667788,metalness:.7,roughness:.3})
      this.axleBatch=new THREE.InstancedMesh(axleGeometry,axleMaterial,4);this.axleBatch.castShadow=true;this.axleBatch.frustumCulled=false;this.object.add(this.axleBatch)
      for (let i = 0; i < 4; i++) { const axle = new THREE.Mesh(axleGeometry, axleMaterial); axle.castShadow = true; this.axles.push(axle) }
    }
    this.wheels.forEach((w, i) => {
      this.object.add(w)
      w.add(this.rollers[i])

      const r = this.layout.rest
      this.setWheel(i, new THREE.Vector3(i % 2 ? r.x : -r.x, r.y, i < 2 ? -r.z : r.z), 0, 0)
    })
    this.object.visible = false
    this.ready = this.load(kind)
  }

  private async load(kind: 'classic' | 'syn3h'): Promise<void> {
    const loaded = await Promise.all(kind === 'classic'
      ? [loader.loadAsync('/models/buggy-classic.glb'), loader.loadAsync('/models/buggy-classic-wheel.glb')]
      // Syn3h: wheels, hub wings and flight wings from the original model; the body, canopy,
      // body fittings and suspension arm from the Box arm body (tools/buggy-bodies, variant
      // c2-box), which is the owner's original body reshaped and is already in the game frame.
      : [loader.loadAsync('/models/buggy.glb'), loader.loadAsync(BOX_ARM_BODY)])
    if (this.disposed) { loaded.forEach(g => release(g.scene)); return }
    const scene = loaded[0].scene
    const classic = kind === 'classic'
    const next = classic ? null : loaded[1]!.scene
    const k = this.layout.scale
    const transform = new THREE.Matrix4().makeScale(k, k, k)
    // Both sources put their headlight meshes on +Z; our nose points toward -Z.
    transform.multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    const body = next ? new THREE.Group() : extract(scene.getObjectByName('Body')!, transform)
    // Box arm: the body and its fittings (strut sockets, shock towers, headlight lenses).
    if (next) for (const name of ['Body', 'Sockets']) body.add(...extract(nodeNamed(next, name)).children)
    // The exported paint carries a clear coat, which loads as a physical material and would
    // keep each part out of the body merge. The shared shading supplies every look from the
    // role, so reduce each to a plain material that only carries its name and colour.
    if (next) body.traverse(o => { if (o instanceof THREE.Mesh) {
      const src = o.material as THREE.MeshStandardMaterial
      const plain = new THREE.MeshStandardMaterial({color: src.color}); plain.name = src.name
      src.dispose(); o.material = plain
    } })
    body.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      // Preserve Syn3h's separate trim and light materials; classic has one tinted shell.
      const materials = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of materials) if (m instanceof THREE.MeshStandardMaterial) {
        if (classic || /body|material/i.test(m.name)) { this.bodyMaterials.push(m); setRole(m, 'paint') }
        else if (/accent/i.test(m.name)) { this.accentMaterials.push(m); setRole(m, 'accent') }
        else if (/chrome/i.test(m.name)) setRole(m, 'chrome')
        else if (/light/i.test(m.name)) setRole(m, 'lamp')
        // Scoop interiors, socket wells: dark structural metal.
        else if (/dark/i.test(m.name)) setRole(m, 'frame')
        m.roughness = .36; m.metalness = .3
        // Syn3h lamps are faces of the Body mesh itself. Emission from terra.buggy.prefab; values
        // above 1 are deliberate (no bloom here, so they survive tone mapping as a hot core).
        // addNightReadability later scales emission by hotExposureNode, as the effects lamps use
        // hotExposureDim, so they do not bleach under the night exposure. mergeStatic reads the
        // emissive Color by reference, so setLights can change it after the merge.
        if (!classic && /headlight/i.test(m.name)) { m.color.set(0xe8f0ff); m.emissive.setRGB(2.447059, 2.858824, 3); m.metalness = 0 }
        else if (!classic && /tail ?light/i.test(m.name)) { m.color.set(0x400000); m.emissive.setRGB(TAIL_LAMP, 0, 0); m.metalness = 0; this.tailLamps = m.emissive }
      }
    })
    const staticBody=new THREE.Group();this.object.add(staticBody);staticBody.add(body)
    const cockpitTransform = transform.clone()
    if (!classic) cockpitTransform.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    // The Box arm canopy is one mesh, both halves, already in place.
    const cockpit = next ? extract(nodeNamed(next, 'Canopy')) : extract(scene.getObjectByName('Cockpit')!, cockpitTransform)
    cockpit.traverse(o => { if (o instanceof THREE.Mesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); // Tagged as glass and kept out of the plain body merge, so the showroom tiers can blend it.
      // Syn3h: the shared force field canopy. Classic keeps its glass until its own pass.
      const glass = setRole(new THREE.MeshStandardMaterial({color: classic ? 0xad58ff : 0x192c44, metalness: .65, roughness: .18}), classic ? 'glass' : 'canopy'); glass.name = 'Cockpit'; glass.userData.separate = true; o.material = glass } })
    // Syn3h: the canopy stays its own mesh (both halves merged together, one draw), outside the
    // body merge, tagged so the first person ride camera can hide it and only it.
    const canopy = classic ? staticBody : new THREE.Group()
    canopy.add(cockpit)
    if (!classic && !next) { const mirrored = cockpit.clone(true); mirrored.scale.x = -1; canopy.add(mirrored) }
    const headlights = scene.getObjectByName('Headlights')
    if (headlights) {
      const lights = extract(headlights, transform)
      lights.traverse(o => { if (o instanceof THREE.Mesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); o.material = setRole(new THREE.MeshStandardMaterial({color: 0xfff4bc, emissive: 0xffe899, emissiveIntensity: 2}), 'lamp') } })
      staticBody.add(lights)
    }
    mergeStatic(staticBody,true)
    const bodyLods=staticLods(staticBody)
    if (canopy !== staticBody) {
      mergeStatic(canopy, true)
      // Tagged for the ride camera only so it does not hide the whole vehicle: the camera hides
      // just tagged parts, and this tag is on an empty marker, not on the canopy. The force
      // field stays in view from the seat, nearly clear, as PATTERN.md asks.
      canopy.traverse(o => { if (o instanceof THREE.Mesh) o.name = 'Canopy' })
      const marker = new THREE.Object3D(); marker.name = 'Ride view marker'; marker.userData.hideInRide = true; canopy.add(marker)
      canopy.name = 'Canopy'
      this.object.add(canopy)
    }
    const wheelRoot = classic ? loaded[1]!.scene : scene.getObjectByName('Wheel_Template')!
    const wheel = extract(wheelRoot)
    const bounds = new THREE.Box3().setFromObject(wheel), center = bounds.getCenter(new THREE.Vector3())
    const d = this.layout.wheelDiameter
    const scale = d === null ? 1 : d / (bounds.max.y - bounds.min.y)
    wheel.traverse(o => { if (o instanceof THREE.Mesh) {
      o.geometry.translate(-center.x, -center.y, -center.z).scale(scale * this.layout.wheelWidth, scale, scale)
      const accent = /beadlock|plane_2/i.test(o.name)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); const rubber = /rubber|^plane$/i.test(o.name); o.material = setRole(new THREE.MeshStandardMaterial({color: accent ? this.accentColor : rubber ? 0x171b20 : 0x89949f, roughness: accent ? .35 : .7, metalness: accent ? .55 : .15}), accent ? 'accent' : rubber ? 'tyre' : 'chrome')
      if (accent) this.accentMaterials.push(o.material)
    } })
    mergeStatic(wheel,true)
    this.rollers.forEach((w, i) => { const visual = wheel.clone(true); if (i % 2 === 0) visual.rotation.y = Math.PI; w.add(visual); this.highWheels.push(visual) })
    // Syn3h exported a true simple wheel and rim. Classic has no simple wheel asset here.
    const simpleRoot=scene.getObjectByName('Wheel_Template_Simple')
    if(simpleRoot){
      const simple=extract(simpleRoot),b=new THREE.Box3().setFromObject(simple),c=b.getCenter(new THREE.Vector3())
      simple.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.translate(-c.x,-c.y,-c.z);for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();o.material=new THREE.MeshStandardMaterial({color:0x171b20,roughness:.7,metalness:.15})}})
      mergeStatic(simple,true)
      this.rollers.forEach((w,i)=>{const low=simple.clone(true);low.visible=false;if(i%2===0)low.rotation.y=Math.PI;w.add(low);this.simpleWheels.push(low)})
    }
    if(!simpleRoot){
      // No classic simple wheel was recovered. Generate a distant-only reduction, retaining tint.
      const low=wheel.clone(true);low.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry=reducedGeometry(o.geometry,.06)})
      this.wheels.forEach((w,i)=>{const visual=low.clone(true);visual.visible=false;if(i%2===0)visual.rotation.y=Math.PI;w.add(visual);this.simpleWheels.push(visual)})
    }
    if (!classic) this.buildHubMotors(scene, next!)
    const wingTransform = transform.clone()
    if (!classic) wingTransform.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    const wingGroup = extract(scene.getObjectByName(classic ? 'Wing' : 'Wings')!, wingTransform)
    if (!classic) {
      const originals = [...wingGroup.children]
      for (const o of originals) if (o instanceof THREE.Mesh) {
        const reflected = o.clone(); reflected.geometry = o.geometry.clone().scale(-1, 1, 1)
        wingGroup.add(reflected)
      }
    }
    // Force field material after Syn3h "Vehicle Wings" (an edge detecting, fresnel, panning
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
    // Seen edge on, the sheet itself brightens (the original's fresnel term).
    const fresnel = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(3)
    // Panning bands across the chord.
    const flow = sin(p.y.mul(2.2).add(p.x.mul(.35)).add(time.mul(3))).mul(.5).add(.5).pow(6)
    const glow = edge.mul(1.2).add(rim.mul(2.2)).add(flow.mul(.3)).add(fresnel.mul(.5)).add(.03)
    const energy = new THREE.MeshBasicNodeMaterial({transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false})
    energy.fog = false
    energy.colorNode = this.energyColor.mul(glow).mul(hotExposureNode())
    energy.opacityNode = clamp(glow, 0, 1)
    // Additive light washes out to white over a sunlit desert, so a normally blended tint layer
    // underneath keeps the accent hue readable at noon; at night the additive glow dominates.
    const tint = new THREE.MeshBasicNodeMaterial({transparent: true, side: THREE.DoubleSide, depthWrite: false})
    tint.fog = false
    tint.colorNode = this.energyColor.mul(.55).mul(hotExposureNode())
    tint.opacityNode = clamp(edge.mul(.45).add(rim.mul(.35)).add(flow.mul(.08)).add(.1), 0, .8)
    for (const o of meshes) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
      o.material = energy; o.castShadow = false; o.receiveShadow = false
      const under = new THREE.Mesh(o.geometry, tint)
      under.renderOrder = -1
      o.add(under)
      this.wings.push({mesh: o, base: new Float32Array(o.geometry.attributes.position.array)})
    }
    this.object.add(wingGroup)
    loaded.forEach(g => release(g.scene))
    this.setColors(this.bodyColor, this.accentColor)
    this.setWings(this.wingInput[0], this.wingInput[1], this.wingInput[2])
    const shadows:THREE.Mesh[]=[];this.object.traverse(o=>{if(o instanceof THREE.Mesh&&o.castShadow)shadows.push(o)})
    this.detachDetail=registerVehicleDetail(this.object,(distance,remote,level)=>{
      const low=remote&&distance>(level===2?60:30)
      this.wheels.forEach((_,i)=>{if(this.simpleWheels[i]){this.highWheels[i].visible=!low;this.simpleWheels[i].visible=low}})
      bodyLods.forEach(p=>{p.high.visible=!low;p.low.visible=low})
      if(this.axleBatch)this.axleBatch.visible=!low
      // The wing struts stay at every distance: they are a large part of the silhouette.
      if(this.stators.length===2){this.stators[0].visible=!low;this.stators[1].visible=low}
      // Sparks are a close-up detail; other players' buggies only show them nearby.
      this.sparksAllowed=!remote||distance<(level===2?40:20)
      const cast=!remote||distance<(level===2?20:0)
      shadows.forEach(m=>{m.castShadow=cast})
    })
    this.detachShowroom = applyShowroom(this.object, root => { addNightReadability(root); addLavaGlow(root) })
    this.object.visible = true
  }

  setWheel(index: number, localPosition: THREE.Vector3, steerAngle: number, spinAngle: number): void {
    const wheel = this.wheels[index]
    if (!wheel) throw new RangeError('Wheel index must be 0 to 3')
    wheel.position.copy(localPosition)
    // Same transform as the former single 'YXZ' Euler (steer, then spin), split so the Syn3h
    // stator can steer and travel with the wheel without spinning: Unity's prefab spins only
    // the `Roll` child (tyre and rotor ring), while `Rim` (the stator) sits on the steered root.
    wheel.rotation.set(0, steerAngle, 0)
    this.rollers[index].rotation.x = spinAngle
    const mount = this.layout.mounts[index]
    if (this.axleBatch) {
      const axle = this.axles[index], delta = localPosition.clone().sub(mount)
      axle.position.copy(mount).addScaledVector(delta, .5)
      axle.scale.y = delta.length()
      if (delta.lengthSq() > 1e-10) axle.quaternion.setFromUnitVectors(up, delta.normalize())
      axle.updateMatrix();this.axleBatch.setMatrixAt(index,axle.matrix);this.axleBatch.instanceMatrix.needsUpdate=true
    }
    if (this.struts) {
      wheel.updateMatrix()
      for (const s of this.stators) { s.setMatrixAt(index, wheel.matrix); s.instanceMatrix.needsUpdate = true }
      this.strutMatrix(localPosition, mount, scratch.matrix)
      this.struts.setMatrixAt(index, scratch.matrix); this.struts.instanceMatrix.needsUpdate = true
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

  /** Syn3h only: the wing struts, the stators and the motor glow, from the original glb. */
  private buildHubMotors(scene: THREE.Object3D, next: THREE.Object3D): void {
    // Chrome is a bright, fairly smooth metal; the game has no environment map, so keep some
    // diffuse colour or it renders near black away from the sun.
    const chrome = () => new THREE.MeshStandardMaterial({color: 0xc4ccd6, metalness: .75, roughness: .22})
    // Accent.001 on the stator and strut is NOT the vehicle accent: VhiclBuggy.cs 76-77 has the
    // Rim's MaterialAccents line commented out, and the owner's screenshots of the original show
    // the hub wing dark with a chrome sheen. A dark metal also lets the accent glow read.
    const wingMetal = () => new THREE.MeshStandardMaterial({color: 0x59616c, roughness: .3, metalness: .55})
    const prepare = (name: string) => {
      const part = extract(scene.getObjectByName(name)!)
      const c = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3())
      part.traverse(o => { if (o instanceof THREE.Mesh) {
        o.geometry.translate(-c.x, -c.y, -c.z)
        // Each glTF primitive is its own mesh here: Accent.001 or Chrome, by material name.
        const materials = Array.isArray(o.material) ? o.material : [o.material]
        const isChrome = materials.some(m => /chrome/i.test(m.name))
        for (const m of materials) m.dispose()
        o.material = isChrome ? chrome() : wingMetal()
      } })
      return part
    }
    // Rotor/stator interface: the stator's two tips, lit in proportion to motor effort. The
    // glow colour is a per-instance attribute, so four wheels stay one draw call.
    const glow = instancedBufferAttribute(this.statorGlow, 'vec3')
    const tips = smoothstep(STATOR_TIP - .1, STATOR_TIP, abs(positionGeometry.z))
    this.stators = ['Rim', 'RimSimple'].map((name, lod) => {
      const part = prepare(name)
      mergeStatic(part, true)
      const merged = part.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>
      const material = merged.material
      material.emissiveNode = (material.emissiveNode as Node<'vec3'>).add((glow as Node<'vec3'>).mul(tips).mul(2.5))
      const mesh = new THREE.InstancedMesh(merged.geometry, material, 4)
      mesh.name = lod ? 'Stators (far)' : 'Stators'
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
    const arm = extract(nodeNamed(next, 'Strut'))
    arm.traverse(o => { if (o instanceof THREE.Mesh) {
      const src = o.material as THREE.MeshStandardMaterial
      const m = /chrome/i.test(src.name) ? setRole(chrome(), 'chrome') : /accent/i.test(src.name) ? setRole(new THREE.MeshStandardMaterial({color: this.accentColor, roughness: .35, metalness: .55}), 'accent') : setRole(new THREE.MeshStandardMaterial({color: 0x23272d, roughness: .34, metalness: .7}), 'frame')
      if (/accent/i.test(src.name)) this.accentMaterials.push(m)
      src.dispose(); o.material = m
    } })
    mergeStatic(arm, true)
    const axle = arm.children[0] as THREE.Mesh
    this.struts = new THREE.InstancedMesh(axle.geometry, axle.material, 4)
    this.struts.name = 'Suspension arms'
    this.struts.castShadow = this.struts.receiveShadow = true
    this.struts.frustumCulled = false
    this.object.add(this.struts)
    this.sparks = new MotorSparks(8, 48)
    this.object.add(this.sparks.mesh)
    this.wheels.forEach((w, i) => this.setWheel(i, w.position, w.rotation.y, this.rollers[i].rotation.x))
  }

  setLights(braking: boolean): void {
    this.tailLamps?.setRGB(braking ? BRAKE_LAMP : TAIL_LAMP, 0, 0)
  }

  setDrive(index: number, effort: number, regen = false): void {
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
    // Sparks: only near full effort, a few per second rising to a spray, from a random tip.
    const now = (performance.now() - this.start) / 1000
    if (index === 0) { this.lastDriveTime = this.lastDriveTime < 0 ? now : this.lastDriveTime; scratch.dt = Math.min(.1, now - this.lastDriveTime); this.lastDriveTime = now }
    const hard = regen ? 0 : Math.max(0, (effort - .65) / .35)
    this.sparkDebt[index] = Math.min(3, this.sparkDebt[index] + hard * hard * 36 * scratch.dt)
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

  setWings(openAmount: number, steer: number, pitch: number): void {
    this.wingInput = [openAmount, steer, pitch]
    for (const {mesh, base} of this.wings) {
      mesh.visible = openAmount > 0
      const position = mesh.geometry.attributes.position
      for (let i = 0; i < position.count; i++) position.setXYZ(i, ...this.wingFn(base[i*3], base[i*3+1], base[i*3+2], openAmount, steer, pitch))
      position.needsUpdate = true
      mesh.geometry.computeVertexNormals()
      mesh.geometry.computeBoundingSphere()
    }
  }
  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.bodyColor.set(body); this.accentColor.set(accent)
    this.bodyMaterials.forEach(m => m.color.copy(this.bodyColor))
    this.accentMaterials.forEach(m => m.color.copy(this.accentColor))
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachDetail()
    this.detachShowroom()
    this.object.removeFromParent()
    release(this.object)
    this.object.clear()
  }
}

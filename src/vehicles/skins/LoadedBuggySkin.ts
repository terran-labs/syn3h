import {hotExposureNode} from './hotExposure'
import {addLavaGlow} from './lavaGlow'
import {addNightReadability} from './nightReadability'
import {applyShowroom,setRole} from './showroom'
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { abs, attribute, clamp, dot, float, length, min, normalView, positionViewDirection, sin, smoothstep, time, uniform, vec2 } from 'three/tsl'
import {mergeStatic,registerVehicleDetail,staticLods,reducedGeometry} from './mergeStatic'
import type { BuggySkin } from './BuggySkin'

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

export class LoadedBuggySkin implements BuggySkin {
  readonly object = new THREE.Group()
  readonly ready: Promise<void>
  private disposed = false
  private detachDetail=()=>{}
  private detachShowroom=()=>{}
  private axleBatch!:THREE.InstancedMesh
  private readonly simpleWheels:THREE.Group[]=[]
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
    const axleGeometry=new THREE.CylinderGeometry(.025,.025,1,8),axleMaterial=new THREE.MeshStandardMaterial({color:0x667788,metalness:.7,roughness:.3})
    this.axleBatch=new THREE.InstancedMesh(axleGeometry,axleMaterial,4);this.axleBatch.castShadow=true;this.axleBatch.frustumCulled=false;this.object.add(this.axleBatch)
    this.wheels.forEach((w, i) => {
      this.object.add(w)
      const axle = new THREE.Mesh(axleGeometry, axleMaterial)
      axle.castShadow = true
      this.axles.push(axle)

      const r = this.layout.rest
      this.setWheel(i, new THREE.Vector3(i % 2 ? r.x : -r.x, r.y, i < 2 ? -r.z : r.z), 0, 0)
    })
    this.object.visible = false
    this.ready = this.load(kind)
  }

  private async load(kind: 'classic' | 'syn3h'): Promise<void> {
    const loaded = await Promise.all(kind === 'classic'
      ? [loader.loadAsync('/models/buggy-classic.glb'), loader.loadAsync('/models/buggy-classic-wheel.glb')]
      : [loader.loadAsync('/models/buggy.glb')])
    if (this.disposed) { loaded.forEach(g => release(g.scene)); return }
    const scene = loaded[0].scene
    const classic = kind === 'classic'
    const k = this.layout.scale
    const transform = new THREE.Matrix4().makeScale(k, k, k)
    // Both sources put their headlight meshes on +Z; our nose points toward -Z.
    transform.multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    const body = extract(scene.getObjectByName('Body')!, transform)
    body.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      // Preserve Syn3h's separate trim and light materials; classic has one tinted shell.
      const materials = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of materials) if (m instanceof THREE.MeshStandardMaterial) {
        if (classic || /body|material/i.test(m.name)) { this.bodyMaterials.push(m); setRole(m, 'paint') }
        else if (/accent/i.test(m.name)) { this.accentMaterials.push(m); setRole(m, 'accent') }
        else if (/chrome/i.test(m.name)) setRole(m, 'chrome')
        else if (/light/i.test(m.name)) setRole(m, 'lamp')
        m.roughness = .36; m.metalness = .3
      }
    })
    const staticBody=new THREE.Group();this.object.add(staticBody);staticBody.add(body)
    const cockpitTransform = transform.clone()
    if (!classic) cockpitTransform.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    const cockpit = extract(scene.getObjectByName('Cockpit')!, cockpitTransform)
    cockpit.traverse(o => { if (o instanceof THREE.Mesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); const glass = setRole(new THREE.MeshStandardMaterial({color: classic ? 0xad58ff : 0x192c44, metalness: .65, roughness: .18}), 'glass'); glass.name = 'Cockpit'; glass.userData.separate = true; o.material = glass } })
    staticBody.add(cockpit)
    if (!classic) { const mirrored = cockpit.clone(true); mirrored.scale.x = -1; staticBody.add(mirrored) }
    const headlights = scene.getObjectByName('Headlights')
    if (headlights) {
      const lights = extract(headlights, transform)
      lights.traverse(o => { if (o instanceof THREE.Mesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); o.material = setRole(new THREE.MeshStandardMaterial({color: 0xfff4bc, emissive: 0xffe899, emissiveIntensity: 2}), 'lamp') } })
      staticBody.add(lights)
    }
    mergeStatic(staticBody,true)
    const bodyLods=staticLods(staticBody)
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
    this.wheels.forEach((w, i) => { const visual = wheel.clone(true); if (i % 2 === 0) visual.rotation.y = Math.PI; w.add(visual) })
    // Syn3h exported a true simple wheel and rim. Classic has no simple wheel asset here.
    const simpleRoot=scene.getObjectByName('Wheel_Template_Simple')
    if(simpleRoot){
      const simple=extract(simpleRoot),b=new THREE.Box3().setFromObject(simple),c=b.getCenter(new THREE.Vector3())
      simple.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.translate(-c.x,-c.y,-c.z);for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();o.material=new THREE.MeshStandardMaterial({color:0x171b20,roughness:.7,metalness:.15})}})
      const rimRoot=scene.getObjectByName('RimSimple')
      if(rimRoot){const rim=extract(rimRoot);const rb=new THREE.Box3().setFromObject(rim).getCenter(new THREE.Vector3());rim.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.translate(-rb.x,-rb.y,-rb.z);for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();const mat=new THREE.MeshStandardMaterial({color:this.accentColor,roughness:.35,metalness:.55});o.material=mat;this.accentMaterials.push(mat)}});simple.add(rim)}
      mergeStatic(simple,true)
      this.wheels.forEach((w,i)=>{const low=simple.clone(true);low.visible=false;if(i%2===0)low.rotation.y=Math.PI;w.add(low);this.simpleWheels.push(low)})
    }
    if(!simpleRoot){
      // No classic simple wheel was recovered. Generate a distant-only reduction, retaining tint.
      const low=wheel.clone(true);low.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry=reducedGeometry(o.geometry,.06)})
      this.wheels.forEach((w,i)=>{const visual=low.clone(true);visual.visible=false;if(i%2===0)visual.rotation.y=Math.PI;w.add(visual);this.simpleWheels.push(visual)})
    }
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
      this.wheels.forEach((w,i)=>{if(this.simpleWheels[i]){w.children[0].visible=!low;this.simpleWheels[i].visible=low}})
      bodyLods.forEach(p=>{p.high.visible=!low;p.low.visible=low})
      this.axleBatch.visible=!low
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
    wheel.rotation.set(spinAngle, steerAngle, 0, 'YXZ')
    const mount = this.layout.mounts[index]
    const axle = this.axles[index], delta = localPosition.clone().sub(mount)
    axle.position.copy(mount).addScaledVector(delta, .5)
    axle.scale.y = delta.length()
    if (delta.lengthSq() > 1e-10) axle.quaternion.setFromUnitVectors(up, delta.normalize())
    axle.updateMatrix();this.axleBatch.setMatrixAt(index,axle.matrix);this.axleBatch.instanceMatrix.needsUpdate=true
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

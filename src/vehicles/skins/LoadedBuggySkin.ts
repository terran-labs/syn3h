import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { abs, dot, float, normalView, positionLocal, positionViewDirection, sin, time, uniform } from 'three/tsl'
import type { BuggySkin } from './BuggySkin'

const loader = new GLTFLoader()
const up = new THREE.Vector3(0, 1, 0)
const mounts = [new THREE.Vector3(-.375, -.1, -.75), new THREE.Vector3(.375, -.1, -.75), new THREE.Vector3(-.375, -.1, .75), new THREE.Vector3(.375, -.1, .75)]

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

export class LoadedBuggySkin implements BuggySkin {
  readonly object = new THREE.Group()
  readonly ready: Promise<void>
  private disposed = false
  private bodyColor = new THREE.Color(0x1768b4)
  private accentColor = new THREE.Color(0x49e6ff)
  private readonly bodyMaterials: THREE.MeshStandardMaterial[] = []
  private readonly accentMaterials: THREE.MeshStandardMaterial[] = []
  private readonly energyColor = uniform(this.accentColor)
  private readonly wheels = Array.from({length: 4}, () => new THREE.Group())
  private readonly axles: THREE.Mesh[] = []
  private wings: { mesh: THREE.Mesh; base: Float32Array }[] = []
  private wingInput = [0, 0, 0]

  constructor(kind: 'classic' | 'syn3h') {
    this.object.name = `${kind} buggy skin`
    this.wheels.forEach((w, i) => {
      this.object.add(w)
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1, 8), new THREE.MeshStandardMaterial({color: 0x667788, metalness: .7, roughness: .3}))
      axle.castShadow = true
      this.axles.push(axle)
      this.object.add(axle)
      this.setWheel(i, new THREE.Vector3(i % 2 ? .7 : -.7, -.3, i < 2 ? -.8 : .8), 0, 0)
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
    const transform = new THREE.Matrix4().makeScale(classic ? 2.15 : .5, classic ? 2.15 : .5, classic ? 2.15 : .5)
    // Both sources put their headlight meshes on +Z; our nose points toward -Z.
    transform.multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    const body = extract(scene.getObjectByName('Body')!, transform)
    body.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      // Preserve Syn3h's separate trim and light materials; classic has one tinted shell.
      const materials = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of materials) if (m instanceof THREE.MeshStandardMaterial) {
        if (classic || /body|material/i.test(m.name)) this.bodyMaterials.push(m)
        else if (/accent/i.test(m.name)) this.accentMaterials.push(m)
        m.roughness = .36; m.metalness = .3
      }
    })
    this.object.add(body)
    const cockpitTransform = transform.clone()
    if (!classic) cockpitTransform.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    const cockpit = extract(scene.getObjectByName('Cockpit')!, cockpitTransform)
    cockpit.traverse(o => { if (o instanceof THREE.Mesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); o.material = new THREE.MeshStandardMaterial({color: classic ? 0xad58ff : 0x192c44, metalness: .65, roughness: .18}) } })
    this.object.add(cockpit)
    if (!classic) { const mirrored = cockpit.clone(true); mirrored.scale.x = -1; this.object.add(mirrored) }
    const headlights = scene.getObjectByName('Headlights')
    if (headlights) {
      const lights = extract(headlights, transform)
      lights.traverse(o => { if (o instanceof THREE.Mesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); o.material = new THREE.MeshStandardMaterial({color: 0xfff4bc, emissive: 0xffe899, emissiveIntensity: 2}) } })
      this.object.add(lights)
    }
    const wheelRoot = classic ? loaded[1]!.scene : scene.getObjectByName('Wheel_Template')!
    const wheel = extract(wheelRoot)
    const bounds = new THREE.Box3().setFromObject(wheel), center = bounds.getCenter(new THREE.Vector3())
    const scale = .6 / (bounds.max.y - bounds.min.y)
    wheel.traverse(o => { if (o instanceof THREE.Mesh) {
      o.geometry.translate(-center.x, -center.y, -center.z).scale(scale * (classic ? 1.2 : 1), scale, scale)
      const accent = /beadlock|plane_2/i.test(o.name)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); o.material = new THREE.MeshStandardMaterial({color: accent ? this.accentColor : /rubber|^plane$/i.test(o.name) ? 0x171b20 : 0x89949f, roughness: accent ? .35 : .7, metalness: accent ? .55 : .15})
      if (accent) this.accentMaterials.push(o.material)
    } })
    this.wheels.forEach((w, i) => { const visual = wheel.clone(true); if (i % 2 === 0) visual.rotation.y = Math.PI; w.add(visual) })
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
    const energy = new THREE.MeshBasicNodeMaterial({transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false})
    const fresnel = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2)
    const flow = sin(positionLocal.z.mul(12).sub(time.mul(5))).mul(.5).add(.5).pow(16)
    energy.colorNode = this.energyColor.mul(fresnel.mul(1.8).add(flow.mul(.65)).add(.2))
    energy.opacityNode = fresnel.mul(.55).add(flow.mul(.25)).add(.13)
    wingGroup.traverse(o => { if (o instanceof THREE.Mesh) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
      o.material = energy; o.castShadow = false
      this.wings.push({mesh: o, base: new Float32Array(o.geometry.attributes.position.array)})
    } })
    this.object.add(wingGroup)
    loaded.forEach(g => release(g.scene))
    this.setColors(this.bodyColor, this.accentColor)
    this.setWings(this.wingInput[0], this.wingInput[1], this.wingInput[2])
    this.object.visible = true
  }

  setWheel(index: number, localPosition: THREE.Vector3, steerAngle: number, spinAngle: number): void {
    const wheel = this.wheels[index]
    if (!wheel) throw new RangeError('Wheel index must be 0 to 3')
    wheel.position.copy(localPosition)
    wheel.rotation.set(spinAngle, steerAngle, 0, 'YXZ')
    const axle = this.axles[index], delta = localPosition.clone().sub(mounts[index])
    axle.position.copy(mounts[index]).addScaledVector(delta, .5)
    axle.scale.y = delta.length()
    if (delta.lengthSq() > 1e-10) axle.quaternion.setFromUnitVectors(up, delta.normalize())
  }

  setWings(openAmount: number, steer: number, pitch: number): void {
    this.wingInput = [openAmount, steer, pitch]
    for (const {mesh, base} of this.wings) {
      mesh.visible = openAmount > 0
      const position = mesh.geometry.attributes.position
      for (let i = 0; i < position.count; i++) position.setXYZ(i, ...wingVertex(base[i*3], base[i*3+1], base[i*3+2], openAmount, steer, pitch))
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
    this.object.removeFromParent()
    release(this.object)
    this.object.clear()
  }
}

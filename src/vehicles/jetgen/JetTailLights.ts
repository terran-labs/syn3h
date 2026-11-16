import * as THREE from 'three/webgpu'
import { attribute, mix, renderGroup, uniform } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { defineParam } from '../../../shared/params'
import { hotExposureNode } from '../skins/hotExposure'
import { MK2_FITTINGS } from './shipped'

export const jetHeadBrightness = defineParam<number>({ id: 'jet.headLightBrightness', label: 'Headlight lens brightness', group: 'Jet', scope: 'world', default: 1, min: 0, max: 3, step: .05 })

export const jetTailBrightness = defineParam<number>({ id: 'jet.tailLightBrightness', label: 'Tail light brightness', group: 'Jet', scope: 'world', default: 1, min: 0, max: 3, step: .05 })

/** Fitted nose and tail lenses share one draw at every LOD. */
export class JetTailLights {
  readonly mesh: THREE.Mesh
  private disposed = false
  constructor() {
    const parts: THREE.BufferGeometry[] = []
    const finish = (g: THREE.BufferGeometry, lens: boolean, head = false) => {
      const n = g.attributes.position.count, colors = new Float32Array(n * 3), mask = new Float32Array(n)
      const c = head ? new THREE.Color(...MK2_FITTINGS.headlight.color) : new THREE.Color(lens ? 0xff1808 : 0x141820)
      if (lens) c.multiplyScalar(2.2)
      for (let i = 0; i < n; i++) { c.toArray(colors, i * 3); mask[i] = head ? 2 : lens ? 1 : 0 }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      g.setAttribute('tailLens', new THREE.BufferAttribute(mask, 1)); g.clearGroups(); parts.push(g)
    }
    for (const nozzle of MK2_FITTINGS.nozzles.filter(n => n.x !== 0)) {
      // The forward end is buried in the boom. The rear brow meets the top of the nozzle lip,
      // leaving the throat and its thrust cone clear. The lens sits 2 mm proud of its backing.
      const housing = new THREE.BoxGeometry(.3, .13, .48), p = housing.attributes.position
      for (let i = 0; i < p.count; i++) {
        const front = p.getZ(i) < 0
        p.setXYZ(i, nozzle.x + p.getX(i) * (front ? .73 : 1), nozzle.y + (front ? .13 + p.getY(i) * .46 : .215 + p.getY(i)), nozzle.z - .24 + p.getZ(i))
      }
      finish(housing, false)
      const lens = new THREE.PlaneGeometry(.22, .045)
      lens.translate(nozzle.x, nozzle.y + .22, nozzle.z + .002); finish(lens, true)
    }
    const head = MK2_FITTINGS.headlight
    // The backing overlaps the narrow pod tip; the lens faces forward, not into the hull.
    const backing = new THREE.BoxGeometry(.08, .04, .06)
    backing.translate(head.x, head.y, head.z + .002 + .03); finish(backing, false)
    const noseLens = new THREE.PlaneGeometry(head.width, head.height)
    noseLens.rotateY(Math.PI); noseLens.translate(head.x, head.y, head.z); finish(noseLens, true, true)
    const geometry = mergeGeometries(parts); parts.forEach(p => p.dispose())
    const material = new THREE.MeshBasicNodeMaterial()
    const base = attribute('color', 'vec3'), lens = attribute('tailLens', 'float')
    const headBrightness = uniform(1).setGroup(renderGroup).onRenderUpdate(() => jetHeadBrightness.value)
    const brightness = uniform(1).setGroup(renderGroup).onRenderUpdate(() => jetTailBrightness.value)
    // Fixed lens colours are independent of paint, throttle and bloom. Exposure compensation
    // retains colour at night; dark housings retain normal scene exposure.
    material.colorNode = mix(base, base.mul(mix(brightness, headBrightness, lens.sub(1).clamp(0, 1))).mul(hotExposureNode()), lens.clamp(0, 1))
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = 'jet-tail-lights'
  }
  /** Caller-owned outputs are in the vehicle frame; no near-model construction required. */
  sampleHeadlight(index: number, position: THREE.Vector3, direction: THREE.Vector3, color: THREE.Color): boolean {
    if (index !== 0 || this.disposed || !this.mesh.visible || jetHeadBrightness.value <= 0) return false
    const head = MK2_FITTINGS.headlight
    position.set(head.x, head.y, head.z); direction.set(...head.direction); color.setRGB(...head.color)
    return true
  }
  dispose(): void { this.disposed = true; this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose() }
}

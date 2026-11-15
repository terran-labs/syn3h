import * as THREE from 'three/webgpu'
import { attribute, mix, renderGroup, uniform } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { defineParam } from '../../../shared/params'
import { hotExposureNode } from '../skins/hotExposure'
import { MK2_FITTINGS } from './shipped'

export const jetTailBrightness = defineParam<number>({ id: 'jet.tailLightBrightness', label: 'Tail light brightness', group: 'Jet', scope: 'world', default: 1, min: 0, max: 3, step: .05 })

/** Two red lenses in tapered housings rooted in the outer nozzle lips. One draw at every LOD. */
export class JetTailLights {
  readonly mesh: THREE.Mesh
  constructor() {
    const parts: THREE.BufferGeometry[] = []
    const finish = (g: THREE.BufferGeometry, lens: boolean) => {
      const n = g.attributes.position.count, colors = new Float32Array(n * 3), mask = new Float32Array(n)
      const c = new THREE.Color(lens ? 0xff1808 : 0x141820)
      if (lens) c.multiplyScalar(2.2)
      for (let i = 0; i < n; i++) { c.toArray(colors, i * 3); mask[i] = lens ? 1 : 0 }
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
    const geometry = mergeGeometries(parts); parts.forEach(p => p.dispose())
    const material = new THREE.MeshBasicNodeMaterial()
    const base = attribute('color', 'vec3'), lens = attribute('tailLens', 'float')
    const brightness = uniform(1).setGroup(renderGroup).onRenderUpdate(() => jetTailBrightness.value)
    // Fixed red running lights, independent of paint, throttle and bloom. Exposure compensation
    // keeps them red at night; dark housings retain normal scene exposure.
    material.colorNode = mix(base, base.mul(brightness).mul(hotExposureNode()), lens)
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = 'jet-tail-lights'
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose() }
}

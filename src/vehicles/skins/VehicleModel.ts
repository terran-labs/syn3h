import {addNightReadability} from './nightReadability'
import * as THREE from 'three/webgpu'
import {mergeStatic,registerVehicleDetail,staticLods} from './mergeStatic'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Owns an optional model and its fallback without coupling rendering to the fixed step. */
export class VehicleModel {
  readonly ready: Promise<void>
  private disposed = false
  private detachDetail=()=>{}
  constructor(private readonly root: THREE.Group, url: string, configure: (scene: THREE.Group) => void = () => {}) {
    this.ready = typeof window === 'undefined' ? Promise.resolve() : new GLTFLoader().loadAsync(url).then(gltf => {
      if(this.disposed) {this.release(gltf.scene);return}
      configure(gltf.scene)
      this.release(root)
      root.clear()
      gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true}})
      // Merge direct static siblings, never the named gear/track parents animated by a vehicle.
      mergeStatic(gltf.scene)
      const lods=staticLods(gltf.scene)
      addNightReadability(gltf.scene)
      root.add(gltf.scene)
      const shadows:THREE.Mesh[]=[];gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.castShadow)shadows.push(o)})
      this.detachDetail=registerVehicleDetail(root,(distance,remote,level)=>{const low=remote&&distance>(level===2?60:30);lods.forEach(p=>{p.high.visible=!low;p.low.visible=low});const cast=!remote||distance<(level===2?20:0);shadows.forEach(m=>{m.castShadow=cast})})
    }).catch(error=>{console.warn(`Vehicle model unavailable: ${url}`,error)})
  }
  private release(root:THREE.Object3D) {
    const geometries=new Set<THREE.BufferGeometry>(), materials=new Set<THREE.Material>()
    root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m))}})
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())
  }
  dispose(){this.disposed=true;this.detachDetail();this.release(this.root);this.root.clear()}
}

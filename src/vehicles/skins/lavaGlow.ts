import {hotExposureNode} from './hotExposure'
import * as T from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import {positionWorld,smoothstep,uniform,vec3} from 'three/tsl'
import type {LiquidState} from '../lava'

/** The vehicle (the object carrying userData.vehicleHeat) a mesh belongs to, or null. */
export function heatOwner(object:T.Object3D):T.Object3D|null {
 let owner:T.Object3D|null=object
 while(owner&&!owner.userData.vehicleHeat)owner=owner.parent
 return owner
}

// One heat line and one heat level, read per object as each mesh draws, from the vehicle that
// mesh belongs to. So a material shared between vehicles (skins/showroom.ts) glows only on the
// one in the lava. A mesh with no vehicle (a warm-up proxy, a viewer) reads no heat.
const owners=new WeakMap<T.Object3D,T.Object3D|null>()
const ownerOf=(object:T.Object3D|undefined|null):T.Object3D|null=>{
 if(!object)return null
 let owner=owners.get(object)
 if(owner===undefined){owner=heatOwner(object);if(owner)owners.set(object,owner)}
 return owner
}
const normal=new T.Vector3(),position=new T.Vector3(),rotation=new T.Quaternion()
const planeValue=new T.Vector4()
let shared:{glow:Node<'vec3'>}|null=null
function glowNode():Node<'vec3'> {
 if(shared)return shared.glow
 const plane=uniform(planeValue).onObjectUpdate(({object})=>{
  const vehicle=ownerOf(object)
  if(!vehicle)return planeValue.set(0,1,0,1e9)
  const state=vehicle.userData.vehicleHeat as LiquidState
  vehicle.getWorldPosition(position);vehicle.getWorldQuaternion(rotation)
  normal.copy(state.heatNormal).applyQuaternion(rotation)
  return planeValue.set(normal.x,normal.y,normal.z,-normal.dot(position)-state.heatHeight)
 })
 const heat=uniform(0).onObjectUpdate(({object})=>{const vehicle=ownerOf(object);return vehicle?(vehicle.userData.vehicleHeat as LiquidState).heat:0})
 const wet=smoothstep(.15,-.15,positionWorld.dot(plane.xyz).add(plane.w))
 shared={glow:vec3(.9,.055,.002).mul(heat.mul(heat)).mul(wet).mul(hotExposureNode())}
 return shared.glow
}

/** A coating on existing surfaces, not a light, particle explosion or extra draw. */
export function addLavaGlow(root:T.Object3D):void {
 if(!heatOwner(root))return
 const glow=glowNode()
 const converted=new Map<T.Material,T.Material>()
 const convert=(source:T.Material):T.Material=>{
  const cached=converted.get(source);if(cached)return cached
  if(!(source instanceof T.MeshStandardMaterial)&&!(source instanceof T.MeshStandardNodeMaterial))return source
  // A material shared between vehicles is coated once, by the first of them.
  if(source.userData.lavaGlow)return source
  // Same field-reference transfer used by Three's NodeLibrary.fromMaterial, so paint setters
  // retained by vehicle classes still address the rendered Color and texture objects.
  const material=source instanceof T.MeshStandardNodeMaterial?source:Object.assign(source instanceof T.MeshPhysicalMaterial?new T.MeshPhysicalNodeMaterial():new T.MeshStandardNodeMaterial(),source)
  const original=material.emissiveNode??uniform(material.emissive).mul(material.emissiveIntensity)
  material.emissiveNode=(original as Node<'vec3'>).add(glow)
  // userData may be the source's own object (Object.assign): mark a fresh copy, not the source.
  material.userData={...material.userData,lavaGlow:true}
  converted.set(source,material)
  return material
 }
 root.traverse(o=>{if(o instanceof T.Mesh)o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material)})
}

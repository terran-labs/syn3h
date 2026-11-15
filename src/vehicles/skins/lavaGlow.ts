import * as T from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import {positionWorld,renderGroup,smoothstep,uniform,vec3} from 'three/tsl'
import type {LiquidState} from '../lava'

/** A coating on existing surfaces, not a light, particle explosion or extra draw. */
export function addLavaGlow(root:T.Object3D):void {
 let owner:T.Object3D|null=root
 while(owner&&!owner.userData.vehicleHeat)owner=owner.parent
 if(!owner)return
 const vehicle=owner,state=vehicle.userData.vehicleHeat as LiquidState
 const normal=new T.Vector3(),position=new T.Vector3(),rotation=new T.Quaternion()
 const planeValue=new T.Vector4()
 const plane=uniform(planeValue).setGroup(renderGroup).onRenderUpdate(()=>{
  vehicle.getWorldPosition(position);vehicle.getWorldQuaternion(rotation)
  normal.copy(state.heatNormal).applyQuaternion(rotation)
  return planeValue.set(normal.x,normal.y,normal.z,-normal.dot(position)-state.heatHeight)
 })
 const heat=uniform(0).setGroup(renderGroup).onRenderUpdate(()=>state.heat)
 const wet=smoothstep(.15,-.15,positionWorld.dot(plane.xyz).add(plane.w))
 const glow=vec3(.9,.055,.002).mul(heat.mul(heat)).mul(wet)
 const converted=new Map<T.Material,T.Material>()
 const convert=(source:T.Material):T.Material=>{
  const cached=converted.get(source);if(cached)return cached
  if(!(source instanceof T.MeshStandardMaterial)&&!(source instanceof T.MeshStandardNodeMaterial))return source
  // Same field-reference transfer used by Three's NodeLibrary.fromMaterial, so paint setters
  // retained by vehicle classes still address the rendered Color and texture objects.
  const material=source instanceof T.MeshStandardNodeMaterial?source:Object.assign(source instanceof T.MeshPhysicalMaterial?new T.MeshPhysicalNodeMaterial():new T.MeshStandardNodeMaterial(),source)
  const original=material.emissiveNode??uniform(material.emissive).mul(material.emissiveIntensity)
  material.emissiveNode=(original as Node<'vec3'>).add(glow)
  converted.set(source,material)
  return material
 }
 root.traverse(o=>{if(o instanceof T.Mesh)o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material)})
}

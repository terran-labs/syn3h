import {hotExposureNode} from './hotExposure'
import * as T from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import {positionWorld,renderGroup,smoothstep,uniform,vec3} from 'three/tsl'
import type {LiquidState} from '../lava'

// TSL node types do not compose through arithmetic chains, so shader values stay loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/** The vehicle (the object carrying userData.vehicleHeat) a mesh belongs to, or null. */
export function heatOwner(object:T.Object3D):T.Object3D|null {
 let owner:T.Object3D|null=object
 while(owner&&!owner.userData.vehicleHeat)owner=owner.parent
 return owner
}

/** The glow at a vehicle's heat line, from its heat plane and level as uniforms. */
function glowFrom(plane:N,heat:N):Node<'vec3'> {
 const wet=smoothstep(.15,-.15,positionWorld.dot(plane.xyz).add(plane.w))
 return vec3(.9,.055,.002).mul(heat.mul(heat)).mul(wet).mul(hotExposureNode())
}
const scratch={normal:new T.Vector3(),position:new T.Vector3(),rotation:new T.Quaternion()}
function planeOf(vehicle:T.Object3D,out:T.Vector4):T.Vector4 {
 const state=vehicle.userData.vehicleHeat as LiquidState
 vehicle.getWorldPosition(scratch.position);vehicle.getWorldQuaternion(scratch.rotation)
 scratch.normal.copy(state.heatNormal).applyQuaternion(scratch.rotation)
 return out.set(scratch.normal.x,scratch.normal.y,scratch.normal.z,-scratch.normal.dot(scratch.position)-state.heatHeight)
}

/**
 * A vehicle's own materials: its heat as two uniforms updated once a frame, as it always was.
 * Per-object uniforms here cost every mesh of every vehicle its own uniform binding, and the
 * first frame of a many-meshed vehicle (a jet) then stalled for half a second at Low.
 */
function vehicleGlow(vehicle:T.Object3D):Node<'vec3'> {
 const planeValue=new T.Vector4()
 const plane=uniform(planeValue).setGroup(renderGroup).onRenderUpdate(()=>planeOf(vehicle,planeValue))
 const heat=uniform(0).setGroup(renderGroup).onRenderUpdate(()=>(vehicle.userData.vehicleHeat as LiquidState).heat)
 return glowFrom(plane,heat)
}

// Materials shared between vehicles (skins/showroom.ts, userData.sharedShowroom): one heat line
// and level read per object as each mesh draws, from the vehicle that mesh belongs to, so a shared
// material glows only on the one in the lava. Those materials read their colours per object
// already. A mesh with no vehicle (a warm-up proxy, a viewer) reads no heat.
const owners=new WeakMap<T.Object3D,T.Object3D|null>()
const ownerOf=(object:T.Object3D|undefined|null):T.Object3D|null=>{
 if(!object)return null
 let owner=owners.get(object)
 if(owner===undefined){owner=heatOwner(object);if(owner)owners.set(object,owner)}
 return owner
}
const sharedPlaneValue=new T.Vector4()
let shared:Node<'vec3'>|null=null
function sharedGlow():Node<'vec3'> {
 if(shared)return shared
 const plane=uniform(sharedPlaneValue).onObjectUpdate(({object})=>{const vehicle=ownerOf(object);return vehicle?planeOf(vehicle,sharedPlaneValue):sharedPlaneValue.set(0,1,0,1e9)})
 const heat=uniform(0).onObjectUpdate(({object})=>{const vehicle=ownerOf(object);return vehicle?(vehicle.userData.vehicleHeat as LiquidState).heat:0})
 return shared=glowFrom(plane,heat)
}

/** A coating on existing surfaces, not a light, particle explosion or extra draw. */
export function addLavaGlow(root:T.Object3D):void {
 const vehicle=heatOwner(root)
 if(!vehicle)return
 let own:Node<'vec3'>|null=null
 const converted=new Map<T.Material,T.Material>()
 const convert=(source:T.Material):T.Material=>{
  const cached=converted.get(source);if(cached)return cached
  if(!(source instanceof T.MeshStandardMaterial)&&!(source instanceof T.MeshStandardNodeMaterial))return source
  const isShared=source.userData.sharedShowroom===true
  // A shared material is coated once, by the first vehicle that wears it.
  if(isShared&&source.userData.lavaGlow)return source
  // Same field-reference transfer used by Three's NodeLibrary.fromMaterial, so paint setters
  // retained by vehicle classes still address the rendered Color and texture objects.
  const material=source instanceof T.MeshStandardNodeMaterial?source:Object.assign(source instanceof T.MeshPhysicalMaterial?new T.MeshPhysicalNodeMaterial():new T.MeshStandardNodeMaterial(),source)
  const original=material.emissiveNode??uniform(material.emissive).mul(material.emissiveIntensity)
  material.emissiveNode=(original as Node<'vec3'>).add(isShared?sharedGlow():(own??=vehicleGlow(vehicle)))
  if(isShared)material.userData.lavaGlow=true
  converted.set(source,material)
  return material
 }
 root.traverse(o=>{if(o instanceof T.Mesh)o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material)})
}

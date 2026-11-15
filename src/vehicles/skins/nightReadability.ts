import * as T from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import {dot,float,normalView,positionViewDirection,renderGroup,uniform,vec3} from 'three/tsl'

/** Match the effects' night ramp without changing the world's exposure or lighting. */
export function vehicleNightAmount(scene:T.Scene):number {
 const sky=scene.children.find(o=>'sunDirection' in o) as unknown as {sunDirection?:{value:T.Vector3}}|undefined
 return T.MathUtils.clamp((.08-(sky?.sunDirection?.value.y??1))/.18,0,1)
}

/** Small art-directed fill keeps paint and tyre edges legible against the night ground. */
export function addNightReadability(root:T.Object3D):void {
 const seen=new Set<T.Material>()
 root.traverse(o=>{
  if(!(o instanceof T.Mesh))return
  for(const material of Array.isArray(o.material)?o.material:[o.material]){
   if(seen.has(material)||material.transparent)continue
   if(!(material instanceof T.MeshStandardMaterial)&&!(material instanceof T.MeshStandardNodeMaterial))continue
   seen.add(material)
   if(material instanceof T.MeshStandardNodeMaterial){
    const night=uniform(0).setGroup(renderGroup).onRenderUpdate(frame=>vehicleNightAmount(frame.scene as T.Scene))
    const paint=material.colorNode??uniform(material.color)
    const rim=float(1).sub(dot(normalView,positionViewDirection).abs()).pow(2)
    const original=material.emissiveNode??uniform(material.emissive).mul(material.emissiveIntensity)
    // New demo visibility aid, not a recovered Unity shader. No extra light or draw.
    material.emissiveNode=(original as Node<'vec3'>).add((paint as Node<'vec3'>).mul(.025).add(vec3(.009,.012,.018).mul(rim)).mul(night))
   }else{
    const original=material.emissive.clone(),before=material.onBeforeRender
    material.onBeforeRender=function(renderer,scene,camera,geometry,object,group){
     before.call(this,renderer,scene,camera,geometry,object,group)
     const night=vehicleNightAmount(scene)
     this.emissive.copy(original);this.emissive.r+=this.color.r*.018*night;this.emissive.g+=this.color.g*.018*night;this.emissive.b+=this.color.b*.018*night
    }
   }
  }
 })
}

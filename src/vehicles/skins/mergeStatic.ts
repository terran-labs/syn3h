import * as T from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import {attribute,float,uniform,vec3} from 'three/tsl'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

/** Source materials packed into one merged draw, in `surfaceId` order. Read by the showroom shading. */
export const mergedSurfaces=new WeakMap<T.Material,T.MeshStandardMaterial[]>()

/** Merge only explicitly static leaves. Animated parents and mapped/physical materials stay intact. */
export function mergeStatic(root:T.Object3D,flatten=false):void {
  root.updateWorldMatrix(true,true)
  const leaves:T.Mesh[]=[]
  if(flatten)root.traverse(o=>{if(o instanceof T.Mesh&&o.visible&&!o.children.length)leaves.push(o)})
  else for(const o of [...root.children]){if(o instanceof T.Mesh&&!o.children.length&&o.visible)leaves.push(o);else if(!(o instanceof T.Mesh))mergeStatic(o)}
  const buckets=new Map<string,{material:T.Material;parts:T.BufferGeometry[];sources:T.Mesh[]}>()
  const plain:{material:T.MeshStandardMaterial;geometry:T.BufferGeometry;source:T.Mesh}[]=[]
  const inverse=root.matrixWorld.clone().invert()
  for(const mesh of leaves){
    if(Array.isArray(mesh.material)||mesh.geometry.morphAttributes.position?.length)continue
    const m=mesh.material,g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone()
    const matrix=inverse.clone().multiply(mesh.matrixWorld);g.applyMatrix4(matrix)
    // Baking a reflection removes Three's determinant-based front-face flip.
    if(matrix.determinant()<0)for(const a of Object.values(g.attributes))for(let i=0;i<a.count;i+=3)for(let k=0;k<a.itemSize;k++){
      const a1=a.getComponent(i+1,k),a2=a.getComponent(i+2,k);a.setComponent(i+1,k,a2);a.setComponent(i+2,k,a1)
    }
    g.clearGroups()
    const simple=m instanceof T.MeshStandardMaterial&&!(m instanceof T.MeshPhysicalMaterial)&&!m.transparent&&!m.map&&!m.normalMap&&!m.bumpMap&&!m.roughnessMap&&!m.metalnessMap&&!m.emissiveMap&&!m.alphaMap&&!m.aoMap&&!m.envMap&&!m.lightMap&&!m.displacementMap&&m.envMapIntensity===1&&!m.vertexColors&&m.alphaTest===0&&m.side===T.FrontSide&&!m.userData.separate
    if(simple){plain.push({material:m,geometry:g,source:mesh});continue}
    const key=m.uuid+':'+Object.keys(g.attributes).sort().join(',')
    let bucket=buckets.get(key);if(!bucket){bucket={material:m,parts:[],sources:[]};buckets.set(key,bucket)}bucket.parts.push(g);bucket.sources.push(mesh)
  }
  if(plain.length>1){
    const materials=[...new Set(plain.map(p=>p.material))],idx=attribute('surfaceId','float')
    let color:Node<'vec3'>=vec3(0),emission:Node<'vec3'>=vec3(0),roughness:Node<'float'>=float(0),metalness:Node<'float'>=float(0)
    materials.forEach((m,i)=>{const mask=idx.round().equal(i).select(1,0);color=color.add(uniform(m.color).mul(mask));emission=emission.add(uniform(m.emissive).mul(m.emissiveIntensity).mul(mask));roughness=roughness.add(mask.mul(m.roughness));metalness=metalness.add(mask.mul(m.metalness))})
    const material=new T.MeshStandardNodeMaterial();material.colorNode=color;material.emissiveNode=emission;material.roughnessNode=roughness;material.metalnessNode=metalness;mergedSurfaces.set(material,materials)
    const parts=plain.map(p=>{const g=p.geometry;for(const name of Object.keys(g.attributes))if(!['position','normal','uv'].includes(name))g.deleteAttribute(name);if(!g.attributes.normal)g.computeVertexNormals();if(!g.attributes.uv)g.setAttribute('uv',new T.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));g.setAttribute('surfaceId',new T.BufferAttribute(new Float32Array(g.attributes.position.count).fill(materials.indexOf(p.material)),1));return g})
    const geometry=mergeGeometries(parts);if(geometry){const mesh=new T.Mesh(geometry,material);mesh.name='Merged static surfaces';mesh.castShadow=plain.some(p=>p.source.castShadow);mesh.receiveShadow=plain.some(p=>p.source.receiveShadow);root.add(mesh);plain.forEach(p=>p.source.removeFromParent())}
    else material.dispose()
    parts.forEach(g=>g.dispose())
  }else plain.forEach(p=>p.geometry.dispose())
  for(const b of buckets.values()){
    if(b.parts.length>1){const geometry=mergeGeometries(b.parts);if(geometry){const mesh=new T.Mesh(geometry,b.material);mesh.name='Merged '+b.material.name;mesh.castShadow=b.sources.some(o=>o.castShadow);mesh.receiveShadow=b.sources.some(o=>o.receiveShadow);root.add(mesh);b.sources.forEach(o=>o.removeFromParent())}}
    b.parts.forEach(g=>g.dispose())
  }
  const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>()
  root.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}})
  for(const o of leaves)if(!o.parent){if(!geometries.has(o.geometry))o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])if(!materials.has(m))m.dispose()}
}

export type VehicleDetail=(distance:number,remote:boolean,level:number)=>void
/** Distances at which another player's vehicle steps down a level of detail, in metres (PATTERN.md rule 4). */
export const LOD_NEAR=30,LOD_FAR=120
/** 0 full, 1 reduced, 2 silhouette. The player's own vehicle is always 0. Hysteresis is the caller's, keyed on its last level. */
export function detailLevel(distance:number,remote:boolean,last:0|1|2=0):0|1|2 {
  if(!remote)return 0
  // Five metres of slack on the way back in, so a vehicle pacing the boundary does not flicker.
  const near=LOD_NEAR-(last>0?5:0),far=LOD_FAR-(last>1?5:0)
  return distance>far?2:distance>near?1:0
}
/** Models register after loading, when their parent vehicle already exists. Viewers retain full detail. */
export function registerVehicleDetail(root:T.Object3D,callback:VehicleDetail):()=>void {
  for(let p:T.Object3D|null=root;p;p=p.parent){const register=p.userData.registerVehicleDetail as ((fn:VehicleDetail)=>()=>void)|undefined;if(register)return register(callback)}
  return()=>{}
}

/** Distance-only mesh reduction. Quantize positions, discard collapsed faces, preserve UVs and surface IDs. */
export function reducedGeometry(source:T.BufferGeometry,cell=.08):T.BufferGeometry {
  const g=source.index?source.toNonIndexed():source.clone(),p=g.getAttribute('position'),keep:number[]=[]
  for(let i=0;i<p.count;i++)p.setXYZ(i,Math.round(p.getX(i)/cell)*cell,Math.round(p.getY(i)/cell)*cell,Math.round(p.getZ(i)/cell)*cell)
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3()
  for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1).sub(a);c.fromBufferAttribute(p,i+2).sub(a);if(b.cross(c).lengthSq()>1e-10)keep.push(i,i+1,i+2)}
  const low=new T.BufferGeometry()
  for(const [name,attr] of Object.entries(g.attributes)){
    const values=new Float32Array(keep.length*attr.itemSize)
    keep.forEach((index,j)=>{for(let k=0;k<attr.itemSize;k++)values[j*attr.itemSize+k]=attr.getComponent(index,k)})
    low.setAttribute(name,new T.BufferAttribute(values,attr.itemSize))
  }
  g.dispose();low.computeBoundingSphere();return low
}

/** Independent static leaves only; caller retains any animated parent references. */
export function staticLods(root:T.Object3D):{high:T.Mesh;low:T.Mesh}[]{
  const pairs:{high:T.Mesh;low:T.Mesh}[]=[]
  root.traverse(o=>{if(o instanceof T.Mesh&&o.visible&&!o.children.length&&!/gear|collider/i.test(o.name)&&!Array.isArray(o.material)&&!o.material.transparent&&o.geometry.attributes.position.count>120){
    const low=o.clone();low.geometry=reducedGeometry(o.geometry);low.visible=false;pairs.push({high:o,low})
  }})
  for(const {high,low} of pairs)high.parent!.add(low)
  return pairs
}

import {afterEach,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {uniform} from 'three/tsl'
import {params} from '../../shared/params'
import {vehicleShading} from '../../src/core/quality'
import {LOD_FAR,LOD_NEAR,detailLevel,mergeStatic,mergedSurfaces} from '../../src/vehicles/skins/mergeStatic'
import {TRACK_LUGS,applyShowroom,paintCanopy,paintFlakes,paintScaleDepth,paintScaleSize,paintSeams,roleOf,setRole,wrapTrackScroll} from '../../src/vehicles/skins/showroom'

const box=()=>new T.BoxGeometry(1,1,1)
const std=(name:string,color=0x336699)=>{const m=new T.MeshStandardMaterial({color});m.name=name;return m}
afterEach(()=>{params.set(vehicleShading.def.id,3);params.set(paintCanopy.def.id,paintCanopy.def.default)})

describe('showroom vehicle shading',()=>{
 it('reads a tag first, then names, then an authored clear coat',()=>{
  expect(roleOf(setRole(std('Whatever'),'tyre'))).toBe('tyre')
  expect(roleOf(std('Cockpit'))).toBe('glass')
  expect(roleOf(std(''),'Body_Chrome')).toBe('chrome')
  expect(roleOf(std('Tail Lights'))).toBe('lamp')
  expect(roleOf(new T.MeshPhysicalMaterial({clearcoat:1}))).toBe('paint')
  expect(roleOf(std('Accent'))).toBe('trim')
  expect(roleOf(std('Mystery'))).toBe('trim')
 })
 it('keeps canopy glass out of the merged body draw and records what was merged',()=>{
  const root=new T.Group(),paint=setRole(std('Body'),'paint'),accent=setRole(std('Accent'),'accent'),glass=setRole(std('Cockpit'),'glass');glass.userData.separate=true
  root.add(new T.Mesh(box(),paint),new T.Mesh(box(),accent),new T.Mesh(box(),glass))
  mergeStatic(root,true)
  const meshes=root.children as T.Mesh[]
  expect(meshes.length).toBe(2)
  const merged=meshes.find(m=>m.name==='Merged static surfaces')!
  expect(mergedSurfaces.get(merged.material as T.Material)).toEqual([paint,accent])
  expect(meshes.find(m=>m!==merged)!.material).toBe(glass)
 })
 it('swaps materials by tier, builds each tier once and decorates each tier once',()=>{
  params.set(paintCanopy.def.id,false)
  params.set(vehicleShading.def.id,0)
  const root=new T.Group(),paint=setRole(std('Body'),'paint'),glass=setRole(std('Cockpit'),'glass')
  const body=new T.Mesh(box(),paint),canopy=new T.Mesh(box(),glass),wing=new T.Mesh(box(),new T.MeshBasicMaterial());root.add(body,canopy,wing)
  const decorated:T.Material[][]=[]
  const dispose=applyShowroom(root,r=>{const seen:T.Material[]=[];r.traverse(o=>{if(o instanceof T.Mesh)seen.push(o.material as T.Material)});decorated.push(seen)})
  // Tier 0 is the vehicle exactly as it was built.
  expect(body.material).toBe(paint);expect(canopy.material).toBe(glass);expect(decorated.length).toBe(1)
  params.set(vehicleShading.def.id,1)
  const lit=body.material as T.Material
  expect(lit).toBeInstanceOf(T.MeshStandardNodeMaterial);expect(lit).not.toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  expect((lit as T.MeshStandardNodeMaterial).normalNode).not.toBeNull()
  // A canopy still tagged `glass` stays opaque until the clear coat tier, as before.
  expect((canopy.material as T.Material).transparent).toBe(false)
  params.set(vehicleShading.def.id,2)
  expect(body.material).toBeInstanceOf(T.MeshPhysicalNodeMaterial);expect((canopy.material as T.Material).transparent).toBe(true)
  params.set(vehicleShading.def.id,3)
  const full=body.material
  expect(full).not.toBe(lit);expect(wing.material).toBeInstanceOf(T.MeshBasicMaterial)
  expect(decorated.length).toBe(4)
  // Returning to a tier reuses what was built and does not decorate it again.
  params.set(vehicleShading.def.id,1);expect(body.material).toBe(lit)
  params.set(vehicleShading.def.id,3);expect(body.material).toBe(full)
  params.set(vehicleShading.def.id,0);expect(body.material).toBe(paint)
  expect(decorated.length).toBe(4)
  dispose()
  // After disposal the parameter no longer drives this vehicle.
  params.set(vehicleShading.def.id,2);expect(body.material).toBe(paint)
 })
 it('keeps paint colour live across tiers through the source colour object',()=>{
  params.set(vehicleShading.def.id,3)
  const root=new T.Group(),paint=setRole(std('Body',0xff0000),'paint'),body=new T.Mesh(box(),paint);root.add(body)
  const dispose=applyShowroom(root,()=>{})
  const built=body.material as unknown as T.MeshPhysicalNodeMaterial
  expect(built).not.toBe(paint)
  // The shader holds the source's Color object, so setColors on the source repaints every tier.
  const found:unknown[]=[];built.colorNode!.traverse(n=>{if((n as unknown as {value?:unknown}).value===paint.color)found.push(n)})
  expect(found.length).toBeGreaterThan(0)
  dispose()
 })
 it('drops remote vehicles to plain materials at distance, with hysteresis, and never gives them flakes',()=>{
  params.set(vehicleShading.def.id,3)
  const owner=new T.Group(),root=new T.Group();owner.add(root)
  let detail:(distance:number,remote:boolean,level:number)=>void=()=>{}
  owner.userData.registerVehicleDetail=(fn:typeof detail)=>{detail=fn;return()=>{}}
  const paint=setRole(std('Body'),'paint'),body=new T.Mesh(box(),paint);root.add(body)
  const dispose=applyShowroom(root,()=>{})
  const local=body.material
  detail(10,true,2);const near=body.material
  expect(near).not.toBe(local);expect(near).toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  detail(31,true,2);expect(body.material).toBe(paint)
  detail(27,true,2);expect(body.material).toBe(paint)
  detail(24,true,2);expect(body.material).toBe(near)
  detail(200,false,2);expect(body.material).toBe(local)
  dispose()
 })
 it('keeps emission a skin added to a merged material, at every tier',()=>{
  params.set(vehicleShading.def.id,0)
  const root=new T.Group();root.add(new T.Mesh(box(),std('Body')),new T.Mesh(box(),std('Chrome')))
  mergeStatic(root,true)
  const mesh=root.children[0] as T.Mesh,merged=mesh.material as T.MeshStandardNodeMaterial
  // As the Syn3h stators do: add a glow to the merged material after merging.
  const glow=uniform(new T.Color(1,0,0)),base=merged.emissiveNode!
  merged.emissiveNode=(base as unknown as {add(n:unknown):typeof base}).add(glow)
  // A decorator that wraps emission in place, as the night and lava passes do.
  const dispose=applyShowroom(root,r=>r.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshStandardNodeMaterial;m.emissiveNode=(m.emissiveNode as unknown as {mul(n:number):typeof base}).mul(1)}}))
  const has=(m:T.MeshStandardNodeMaterial)=>{let found=false;m.emissiveNode!.traverse(n=>{if(n===glow)found=true});return found}
  for(const tier of [1,2,3]){params.set(vehicleShading.def.id,tier);expect(mesh.material).not.toBe(merged);expect(has(mesh.material as T.MeshStandardNodeMaterial)).toBe(true)}
  dispose()
 })
 it('drives scale depth, seams, size and flakes from live sliders without rebuilding materials',()=>{
  params.set(vehicleShading.def.id,3)
  const root=new T.Group(),body=new T.Mesh(box(),setRole(std('Body'),'paint'));root.add(body)
  const dispose=applyShowroom(root,()=>{})
  const built=body.material as unknown as T.MeshPhysicalNodeMaterial
  const values=()=>{const seen=new Set<number>();for(const node of [built.normalNode!,built.colorNode!,built.aoNode!])node.traverse(n=>{const v=(n as unknown as {value?:unknown}).value;if(typeof v==='number')seen.add(v)});return seen}
  for(const [param,value] of [[paintScaleDepth,1.37],[paintSeams,.93],[paintScaleSize,2.61],[paintFlakes,1.83]] as const){
   expect(values().has(value)).toBe(false)
   params.set(param.def.id,value)
   expect(values().has(value)).toBe(true)
   params.set(param.def.id,param.def.default)
  }
  expect(body.material).toBe(built)
  dispose()
 })
 it('gives every vehicle the same canopy, glow and frame from a role tag alone',()=>{
  params.set(vehicleShading.def.id,3)
  const owner=new T.Group(),root=new T.Group();owner.add(root)
  const accent=new T.Color(0x000040);owner.userData.vehicleColors={accent}
  const canopy=new T.Mesh(box(),setRole(std('Whatever'),'canopy')),nozzle=new T.Mesh(box(),setRole(std('Nozzle'),'glow')),arm=new T.Mesh(box(),setRole(std('Arm',0x222222),'frame')),fin=new T.Mesh(box(),setRole(std('Fin'),'paint'))
  ;(fin.material as T.MeshStandardMaterial).flatShading=true
  root.add(canopy,nozzle,arm,fin)
  const dispose=applyShowroom(root,()=>{})
  const uses=(m:T.Material,value:unknown)=>{let found=false;for(const node of [(m as T.MeshBasicNodeMaterial).colorNode])node?.traverse(n=>{if((n as unknown as {value?:unknown}).value===value)found=true});return found}
  // Canopy and glow take the owner vehicle's live accent colour, not a colour the vehicle authored.
  expect(uses(canopy.material as T.Material,accent)).toBe(true);expect(uses(nozzle.material as T.Material,accent)).toBe(true)
  expect((nozzle.material as T.Material).blending).toBe(T.AdditiveBlending);expect((nozzle.material as T.Material).depthWrite).toBe(false)
  expect(arm.material).toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  expect((fin.material as T.Material as T.MeshStandardMaterial).flatShading).toBe(true)
  dispose()
 })
 it('picks detail levels at the shared distances, with slack on the way back in',()=>{
  expect(detailLevel(500,false)).toBe(0)
  expect([detailLevel(29,true),detailLevel(31,true),detailLevel(119,true),detailLevel(121,true)]).toEqual([0,1,1,2])
  expect(detailLevel(27,true,1)).toBe(1);expect(detailLevel(24,true,1)).toBe(0)
  expect(detailLevel(117,true,2)).toBe(2);expect(detailLevel(114,true,2)).toBe(1)
  expect([LOD_NEAR,LOD_FAR]).toEqual([30,120])
 })
 it('uses the force field by default, retains the glass toggle and respects the plain tier',()=>{
  params.set(vehicleShading.def.id,2)
  const root=new T.Group(),canopy=new T.Mesh(box(),setRole(std('Cockpit'),'glass'));root.add(canopy)
  const dispose=applyShowroom(root,()=>{})
  const field=canopy.material as T.Material
  expect(field).toBeInstanceOf(T.MeshBasicNodeMaterial);expect(field.side).toBe(T.DoubleSide);expect(field.depthWrite).toBe(false)
  params.set(paintCanopy.def.id,false)
  expect(canopy.material).toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  params.set(paintCanopy.def.id,true)
  expect(canopy.material).toBeInstanceOf(T.MeshBasicNodeMaterial)
  params.set(vehicleShading.def.id,0)
  const plain=canopy.material as unknown as T.MeshBasicMaterial
  expect(plain).toBeInstanceOf(T.MeshBasicMaterial)
  expect(plain.transparent).toBe(true);expect(plain.opacity).toBeLessThan(.1);expect(plain.depthWrite).toBe(false)
  params.set(paintCanopy.def.id,false)
  expect(canopy.material).toBeInstanceOf(T.MeshStandardMaterial)
  params.set(paintCanopy.def.id,true)
  expect(canopy.material).toBe(plain)
  dispose()
 })

 it('guesses tracks from names, ahead of tyres',()=>{
  expect(roleOf(std('Tread'))).toBe('track')
  expect(roleOf(std(''),'Left track')).toBe('track')
  expect(roleOf(std('Rubber belt'))).toBe('track')
  expect(roleOf(std('Rubber'))).toBe('tyre')
  expect(roleOf(setRole(std('Whatever'),'track'))).toBe('track')
 })
 it('shades track lugs from tier 1 up and leaves tier 0 alone',()=>{
  params.set(vehicleShading.def.id,0)
  const root=new T.Group(),rubber=setRole(std('Belt',0x161616),'track'),mesh=new T.Mesh(new T.PlaneGeometry(.6,4),rubber);root.add(mesh)
  const dispose=applyShowroom(root,()=>{})
  expect(mesh.material).toBe(rubber)
  for(const tier of [1,2,3]){
   params.set(vehicleShading.def.id,tier)
   const m=mesh.material as unknown as T.MeshStandardNodeMaterial
   expect(m).not.toBe(rubber);expect(m.normalNode).not.toBeNull()
   expect(m.userData.instancedScroll).toBe(false)
  }
  dispose()
 })
 it('reads the scroll per object, so treads at different speeds share one material',()=>{
  params.set(vehicleShading.def.id,1)
  const root=new T.Group(),rubber=setRole(std('Belt'),'track'),geometry=new T.PlaneGeometry(.6,4)
  const left=new T.Mesh(geometry,rubber),right=new T.Mesh(geometry,rubber);root.add(left,right)
  const dispose=applyShowroom(root,()=>{})
  expect(left.material).toBe(right.material)
  const node=(left.material as T.Material).userData.trackScrollNode as {value:number,update(frame:unknown):void}
  left.userData.trackScroll=1.25;right.userData.trackScroll=-7.3
  node.update({object:left});expect(node.value).toBeCloseTo(wrapTrackScroll(1.25),6)
  node.update({object:right});expect(node.value).toBeCloseTo(wrapTrackScroll(-7.3),6)
  // Wrapped to one lug pitch, which leaves the pattern exactly where it was.
  expect(node.value).toBeGreaterThanOrEqual(0);expect(node.value).toBeLessThan(TRACK_LUGS.pitch)
  expect(wrapTrackScroll(1e6+.05)).toBeCloseTo((1e6+.05)%TRACK_LUGS.pitch,6)
  delete right.userData.trackScroll;node.update({object:right});expect(node.value).toBe(0)
  dispose()
 })
 it('reads the scroll per instance when the geometry carries it or the material asks',()=>{
  params.set(vehicleShading.def.id,1)
  const root=new T.Group(),rubber=setRole(std('Belt'),'track')
  const geometry=new T.PlaneGeometry(.6,4);geometry.setAttribute('trackScroll',new T.InstancedBufferAttribute(new Float32Array(6),1))
  const six=new T.InstancedMesh(geometry,rubber,6),one=new T.Mesh(new T.PlaneGeometry(.6,4),rubber);root.add(six,one)
  const asked=setRole(std('Belt'),'track');asked.userData.instancedScroll=true
  const flagged=new T.InstancedMesh(new T.PlaneGeometry(.6,4),asked,6);root.add(flagged)
  const dispose=applyShowroom(root,()=>{})
  const a=six.material as T.Material,b=one.material as T.Material,c=flagged.material as T.Material
  // The same source gets one material per way of scrolling.
  expect(a).not.toBe(b)
  expect(a.userData.instancedScroll).toBe(true);expect(b.userData.instancedScroll).toBe(false);expect(c.userData.instancedScroll).toBe(true)
  // The instanced path reads the attribute, not a per-object uniform.
  let reads='';(a.userData.trackScrollNode as {traverse(f:(n:{_attributeName?:string})=>void):void}).traverse(n=>{if(n._attributeName)reads=n._attributeName})
  expect(reads).toBe('trackScroll');expect(a.userData.trackScrollNode.isUniformNode).toBeFalsy()
  expect(b.userData.trackScrollNode.isUniformNode).toBe(true)
  dispose()
 })
})

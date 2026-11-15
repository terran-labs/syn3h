import {afterEach,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {params} from '../../shared/params'
import {vehicleShading} from '../../src/core/quality'
import {mergeStatic,mergedSurfaces} from '../../src/vehicles/skins/mergeStatic'
import {applyShowroom,roleOf,setRole} from '../../src/vehicles/skins/showroom'

const box=()=>new T.BoxGeometry(1,1,1)
const std=(name:string,color=0x336699)=>{const m=new T.MeshStandardMaterial({color});m.name=name;return m}
afterEach(()=>params.set(vehicleShading.def.id,3))

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
  // Glass stays opaque until the clear coat tier.
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
})

import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Tank,previewTankBody} from '../../src/vehicles/Tank'
import {ExpeditionTank,SOLIDS} from '../../src/vehicles/tank/kit'
import {sherpa} from '../../src/vehicles/tank/shipped'
import {mergedSurfaces} from '../../src/vehicles/skins/mergeStatic'
import {harness} from './harness'

beforeAll(initPhysics)
describe('Sherpa headlight samples',()=>{
 it('places all six samples on actual near and mid lens geometry with its linear emission',()=>{
  const tank=new ExpeditionTank(sherpa.hull(),sherpa.color,sherpa.accent)
  const p=new T.Vector3(),d=new T.Vector3(),c=new T.Color()
  try {
   for(const level of [0,1] as const){
    tank.setLevel(level)
    const root=tank.object.children.find(o=>o.visible)!
    const hull=root.getObjectByName('Hull and cabin') as T.Mesh
    const source=mergedSurfaces.get(hull.material as T.Material)![SOLIDS.indexOf('head')] as T.MeshStandardMaterial
    const geometry=hull.geometry,positions=geometry.getAttribute('position'),surfaces=geometry.getAttribute('surfaceId'),normals=geometry.getAttribute('normal')
    expect(tank.headlamps).toHaveLength(6);expect(tank.needsHeadlampGlow()).toBe(false)
    const centres=new Set<string>()
    for(let i=0;i<6;i++){
     expect(tank.sampleHeadlamp(i,p,d,c)).toBe(true)
     centres.add(p.toArray().join(','))
     expect(d.toArray()).toEqual([0,0,-1])
     expect(c.equals(source.emissive.clone().multiplyScalar(source.emissiveIntensity))).toBe(true)
     let onLens=false
     for(let v=0;v<positions.count;v++)if(surfaces.getX(v)===SOLIDS.indexOf('head')&&Math.abs(positions.getX(v)-p.x)<1e-6&&Math.abs(positions.getY(v)-p.y)<1e-6&&Math.abs(positions.getZ(v)-p.z)<1e-6){
      onLens=true;expect(normals.getZ(v)).toBeCloseTo(-1)
     }
     expect(onLens,`lamp ${i} at detail ${level}`).toBe(true)
    }
    expect(centres.size).toBe(6)
   }
   tank.setLevel(2);expect(tank.needsHeadlampGlow()).toBe(true)
   tank.sampleHeadlamp(0,p,d,c);const full=c.clone()
   tank.setLights(false,false);tank.sampleHeadlamp(0,p,d,c)
   expect(c.r).toBeCloseTo(full.r*.08);expect(c.g).toBeCloseTo(full.g*.08);expect(c.b).toBeCloseTo(full.b*.08)
  } finally {tank.dispose()}
 })
 it('publishes vehicle-local positions, reuses outputs, and removes stale samples after a rebuild',()=>{
  const h=harness(),v=new Tank(h.game,h.terrain,new T.Vector3(31,17,-23),Math.PI/2)
  const p=new T.Vector3(),d=new T.Vector3(),c=new T.Color()
  const contract=v.object.userData.headlights as {count:number;sample(i:number,p:T.Vector3,d:T.Vector3,c:T.Color):boolean;needsGlow():boolean}
  try {
   expect(contract.count).toBe(6)
   for(let i=0;i<6;i++){
    expect(contract.sample(i,p,d,c)).toBe(true)
    expect(p.x).toBeCloseTo((i<3?-1:1)*[.23,.65,1.07][i%3]*(1.15/1.3))
    expect(p.y).toBeCloseTo(.735);expect(p.z).toBeCloseTo(-3.81)
    expect(d.toArray()).toEqual([0,0,-1])
    expect(c.toArray()).toEqual([2.447059,2.858824,3])
   }
   p.set(9,8,7);d.set(6,5,4);c.setRGB(.1,.2,.3)
   for(const i of [-1,6,.5,NaN])expect(contract.sample(i,p,d,c)).toBe(false)
   expect(p.toArray()).toEqual([9,8,7]);expect(d.toArray()).toEqual([6,5,4]);expect(c.toArray()).toEqual([.1,.2,.3])
   previewTankBody(null)
   expect(contract.count).toBe(0);expect(contract.sample(0,p,d,c)).toBe(false)
   previewTankBody();expect(contract.count).toBe(6);expect(contract.sample(0,p,d,c)).toBe(true)
   expect(v.object.userData.ownLamps).toBe(true)
  } finally {previewTankBody();v.dispose();h.world.free()}
  expect(v.object.userData.headlights).toBeUndefined()
  expect(contract.count).toBe(0);expect(contract.sample(0,p,d,c)).toBe(false)
 })
})

import { describe, it, expect, beforeAll } from 'vitest'
import * as T from 'three/webgpu'
import { GameHover } from '../../src/vehicles/hover/GameHover'
import { LOWWING_SPEC, LOWWING, buildDuctHover } from '../../src/vehicles/hover/lowwing'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { initPhysics } from '../../src/core/physics'
import { harness } from './harness'

beforeAll(initPhysics)
describe('Lowwing headlight origins',()=>{
  it('samples current-detail lamp geometry and retains near origins for the far glow',()=>{
    const model=new GameHover(LOWWING_SPEC),p=new T.Vector3(),d=new T.Vector3(),c=new T.Color()
    const triangle=new T.Triangle(),closest=new T.Vector3(),near:T.Vector3[]=[]
    try {
      for(const level of [0,1] as const){
        model.setLevel(level)
        const build=buildDuctHover(LOWWING,model.levels[level].detail)
        try {
          for(let i=0;i<2;i++){
            expect(model.sampleHeadlight(i,p,d,c)).toBe(true)
            expect(d.toArray()).toEqual([0,0,-1]);expect(c.equals(new T.Color(0xe8f4ff))).toBe(true)
            let distance=Infinity
            for(const g of build.head){
              const a=g.getAttribute('position'),index=g.index,n=index?.count??a.count
              for(let j=0;j<n;j+=3){
                triangle.a.fromBufferAttribute(a,index?index.getX(j):j)
                triangle.b.fromBufferAttribute(a,index?index.getX(j+1):j+1)
                triangle.c.fromBufferAttribute(a,index?index.getX(j+2):j+2)
                triangle.closestPointToPoint(p,closest);distance=Math.min(distance,p.distanceTo(closest))
              }
            }
            expect(distance).toBeLessThan(.05)
            if(level===0)near.push(p.clone())
          }
        } finally {for(const g of [...build.builder.pieces.map(p=>p.geometry),...build.head,...build.tail])g.dispose()}
      }
      model.setLevel(2)
      for(let i=0;i<2;i++){expect(model.sampleHeadlight(i,p,d,c)).toBe(true);expect(p.equals(near[i])).toBe(true)}
      model.object.visible=false;expect(model.sampleHeadlight(0,p,d,c)).toBe(false)
    } finally {model.dispose()}
  })
  it('publishes local coordinates independent of world pose and removes the source on disposal',()=>{
    const h=harness(),vehicle=new Hovercraft(h.game,h.terrain,new T.Vector3(25,12,-31),Math.PI/2)
    const source=vehicle.object.userData.headlights,p=new T.Vector3(),d=new T.Vector3(),c=new T.Color()
    expect(source.count).toBe(2);expect(source.sample(0,p,d,c)).toBe(true)
    expect(Math.abs(p.x)).toBeCloseTo(.6);expect(p.z).toBeLessThan(-1)
    vehicle.dispose();expect(vehicle.object.userData.headlights).toBeUndefined();h.world.free()
  })
})

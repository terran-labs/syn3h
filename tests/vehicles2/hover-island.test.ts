import {beforeAll,it,expect} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {Hovercraft} from '../../src/vehicles/Hovercraft'
import {harness} from './harness'
import {generateTerrain} from '../../src/world/terrain/generate'
import {defaultTerrainSettings} from '../../src/world/terrain/settings'
import {HeightSampler} from '../../src/world/terrain/sampler'
import {createTerrainCollider} from '../../src/world/terrain/collider'
import {lavaSurfaceAt} from '../../src/world/terrain/lava'
import {spawnPointAt} from '../../src/world/terrain/spawn'
beforeAll(initPhysics)
for(const seed of [1,42])it(`keeps the hull clear through the island route on seed ${seed}`,()=>{
 const h=harness(9.81,false),data=generateTerrain(seed,defaultTerrainSettings()),sampler=new HeightSampler(data)
 h.terrain.heightAt=(x,z)=>sampler.heightAt(x,z);h.terrain.normalAt=(x,z,out)=>sampler.normalAt(x,z,out)
 h.terrain.liquidHeightAt=(x,z)=>lavaSurfaceAt(data.lava,x,z,0)
 createTerrainCollider(h.world,data);h.world.step()
 const spawn=spawnPointAt(sampler,0),v=new Hovercraft(h.game,h.terrain,new T.Vector3(spawn.x,spawn.y,spawn.z),spawn.heading)
 v.isLocal=false;v.input.y=1;let min=Infinity
 const point=new T.Vector3()
 for(let i=0;i<1000;i++){
  v.input.x=i>=350&&i<425?-1:i>=600&&i<675?1:0;h.step(v);v.update(.02,.5)
  for(const [p,q] of [[v.body.translation(),v.body.rotation()],[v.object.position,v.object.quaternion]] as const){
   for(let x=-1.259;x<=1.26;x+=.25)for(let z=-1.634;z<=1.52;z+=.25){point.set(x,.0167,z).applyQuaternion(q).add(p);min=Math.min(min,point.y-sampler.heightAt(point.x,point.z))}
  }
 }
 expect(min).toBeGreaterThanOrEqual(0);expect(v.body.translation().y).toBeGreaterThan(-1)
 v.dispose();h.world.free()
},15000)

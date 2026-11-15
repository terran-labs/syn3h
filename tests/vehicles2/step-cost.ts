/**
 * Measures what shared vehicle code costs the CPU, headless, with real Rapier:
 *   - per fixed step: `fixedUpdate` + `postPhysics` for nine vehicles of one kind, with the
 *     Rapier step timed separately so the controller cost is not hidden inside the solver;
 *   - per rendered frame: `update` for the same nine, and the shared effects system;
 *   - bytes of garbage each of those creates, which is what turns into collector pauses.
 *
 * Run through the limiter, with the collector exposed and a young generation large enough
 * that no collection lands inside a measured window:
 *
 *   tools/heavy.sh node --expose-gc --max-semi-space-size=256 --import tsx tests/vehicles2/step-cost.ts
 *
 * It prints one JSON line per vehicle kind. It is a measurement, not a test: nothing here
 * asserts a budget, because desktop Node timings do not transfer to a phone. Compare before
 * and after on the same machine.
 */
import * as T from 'three/webgpu'
import {initPhysics,FIXED_DT,createWorld} from '../../src/core/physics'
import {emptyInput} from '../../src/core/Input'
import {heightfieldDesc} from '../../src/world/terrain/collider'
import type {TerrainData} from '../../src/world/terrain/generate'
import type {Game,System} from '../../src/core/Game'
import type {Terrain} from '../../src/world/Terrain'
import {createVehicle,type VehicleKind} from '../../src/vehicles'
import type {Vehicle} from '../../src/vehicles/Vehicle'
import {attachVehicleEffects} from '../../src/vehicles/effects'
import {setWeatherClock} from '../../src/world/weather/wind'

const N=257,CELL=4,SIZE=(N-1)*CELL,COUNT=9,WARM=600,STEPS=1800
const hill=(x:number,z:number)=>6*Math.sin(x/37)*Math.cos(z/41)+2*Math.sin(x/11+z/13)
const gc=(globalThis as {gc?:()=>void}).gc
const heap=()=>process.memoryUsage().heapUsed

function land(){
 const world=createWorld(9.81),heights=new Float32Array(N*N)
 for(let iz=0;iz<N;iz++)for(let ix=0;ix<N;ix++)heights[iz*N+ix]=hill(-SIZE/2+ix*CELL,-SIZE/2+iz*CELL)
 world.createCollider(heightfieldDesc({resolution:N,cell:CELL,size:SIZE,heights} as unknown as TerrainData,0))
 // Allocation-free, like the game's grid sampler, so the figures below are the vehicles' own.
 const heightAt=(x:number,z:number)=>{const fx=Math.min(N-1.001,Math.max(0,(x+SIZE/2)/CELL)),fz=Math.min(N-1.001,Math.max(0,(z+SIZE/2)/CELL)),ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz,i=iz*N+ix
  return (heights[i]*(1-tx)+heights[i+1]*tx)*(1-tz)+(heights[i+N]*(1-tx)+heights[i+N+1]*tx)*tz}
 const normalAt=(x:number,z:number,out:T.Vector3)=>out.set(heightAt(x-1,z)-heightAt(x+1,z),2,heightAt(x,z-1)-heightAt(x,z+1)).normalize()
 const systems:System[]=[]
 const camera=new T.PerspectiveCamera();camera.position.set(0,12,30)
 const game={world,scene:new T.Scene(),camera,renderer:{toneMappingExposure:1},input:{state:emptyInput()},
  add(s:System){systems.push(s)},remove(s:System){const i=systems.indexOf(s);if(i>=0)systems.splice(i,1);s.dispose?.()}} as unknown as Game
 const terrain={size:SIZE,heightAt,normalAt,spawnPoint:()=>({position:new T.Vector3(0,heightAt(0,0)+2,0),heading:0}),dispose(){}} as unknown as Terrain
 world.step()
 return {world,game,terrain,heightAt,systems}
}

/** Median of per-iteration times is robust to the odd collection or scheduler hiccup. */
const median=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1]}
const round=(n:number,d=4)=>Number(n.toFixed(d))

/**
 * FNV-1a over every effect buffer in the scene (birth records, ribbon quads, lamp matrices).
 * The run is deterministic, so two builds that draw the same effects print the same digest:
 * the evidence that an optimisation changed no output.
 */
function digest(scene:T.Scene){
 let h=0x811c9dc5
 scene.traverse(o=>{const g=(o as T.Mesh).geometry as T.BufferGeometry|undefined;if(!g)return
  for(const name of Object.keys(g.attributes).sort()){if(!name.startsWith('fx')&&name!=='position')continue
   const bytes=new Uint8Array((g.attributes[name].array as Float32Array).buffer);for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)}}
  h^=g.drawRange.count;h=Math.imul(h,0x01000193)})
 return (h>>>0).toString(16)
}

function measure(kind:VehicleKind,special=false){
 const l=land(),vehicles:Vehicle[]=[],detach:(()=>void)[]=[]
 for(let i=0;i<COUNT;i++){
  const x=(i%3-1)*14,z=(Math.floor(i/3)-1)*14
  const v=createVehicle(l.game,l.terrain,kind,new T.Vector3(x,l.heightAt(x,z)+1.5,z),i*.7);v.isLocal=false
  // Driving, turning, and for aircraft thrust: the busy path, not a parked vehicle.
  Object.assign(v.input,{y:1,z:1,x:i%2?.4:-.4,special});vehicles.push(v)
  detach.push(attachVehicleEffects(l.game,l.terrain,v,{local:i===0}))
 }
 const fixed=()=>{for(const v of vehicles)v.fixedUpdate(FIXED_DT)}
 const post=()=>{for(const v of vehicles)v.postPhysics(FIXED_DT);for(const s of l.systems)s.postPhysics?.(FIXED_DT)}
 const frame=()=>{for(const v of vehicles)v.update(FIXED_DT,1)}
 const effects=()=>{for(const s of l.systems)s.update?.(FIXED_DT,1)}
 // Keep them on the map: turn back toward the centre instead of driving off the edge.
 const steer=()=>{for(const v of vehicles){const p=v.body.translation();if(Math.hypot(p.x,p.z)>SIZE*.35)v.teleport(new T.Vector3(0,l.heightAt(0,0)+1.5,0),0)}}
 for(let i=0;i<WARM;i++){fixed();l.world.step();post();frame();effects();if(i%120===0)steer()}
 const ms={fixed:[] as number[],rapier:[] as number[],post:[] as number[],frame:[] as number[],effects:[] as number[]}
 const bytes={fixed:0,post:0,frame:0,effects:0}
 const timed=(key:keyof typeof ms,fn:()=>void,alloc?:keyof typeof bytes)=>{const h=alloc?heap():0,t=performance.now();fn();ms[key].push(performance.now()-t);if(alloc){const d=heap()-h;if(d>0)bytes[alloc]+=d}}
 gc?.()
 for(let i=0;i<STEPS;i++){
  timed('fixed',fixed,'fixed');timed('rapier',()=>l.world.step());timed('post',post,'post');timed('frame',frame,'frame');timed('effects',effects,'effects')
  if(i%120===0)steer()
 }
 const speed=vehicles.reduce((s,v)=>{const q=v.body.linvel();return s+Math.hypot(q.x,q.y,q.z)},0)/COUNT
 const out={kind,special,vehicles:COUNT,meanSpeed:round(speed,1),effectsDigest:digest(l.game.scene),
  msPerStep:{controllers:round(median(ms.fixed)),rapier:round(median(ms.rapier)),postPhysics:round(median(ms.post))},
  msPerFrame:{vehicleUpdate:round(median(ms.frame)),effects:round(median(ms.effects))},
  bytesPerStep:{controllers:Math.round(bytes.fixed/STEPS),postPhysics:Math.round(bytes.post/STEPS)},
  bytesPerFrame:{vehicleUpdate:Math.round(bytes.frame/STEPS),effects:Math.round(bytes.effects/STEPS)}}
 for(const d of detach)d()
 for(const v of vehicles)v.dispose()
 l.world.free()
 return out
}

await initPhysics()
// Wind follows the shared room clock, which is wall time by default. Pin it so every run draws
// the same dust and the digests are comparable.
setWeatherClock(()=>1000)
if(!gc)console.error('Run with --expose-gc for stable allocation figures.')
for(const kind of ['buggy','jet','hovercraft','tank'] as const)console.log(JSON.stringify(measure(kind)))
// Wings open and the jet in forward flight: the wing tip trail path.
for(const kind of ['buggy','jet'] as const)console.log(JSON.stringify(measure(kind,true)))

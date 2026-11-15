import { appendFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { initPhysics, FIXED_DT } from '../../src/core/physics'
import { Jet } from '../../src/vehicles/Jet'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { createPilot } from '../../src/bots/pilot'
import { PilotEvasion } from '../../src/bots/mind/evasion'
import { steer, type V3 } from '../../src/weapons/pester/steer'
import { Mind } from '../../src/bots/mind/Mind'
import { testWorld } from './pilot/world'
import type { DriveGoal } from '../../src/bots/pilot/types'

beforeAll(initPhysics)
function run(kind: 'jet'|'hovercraft', enabled: boolean, receding=false, useMind=false, scenario={angle:0,distance:60,speed:8}) {
  const w=testWorld(()=>0,800,4), C=kind==='jet'?Jet:Hovercraft
  const v=new C(w.game,w.terrain,new Vector3(0,kind==='jet'?14:2,0),0);v.isLocal=false
  Object.assign(v,{id:'evasion-test'})
  const pilot=createPilot(v,w.terrain)!, evasion=new PilotEvasion(v,w.terrain,pilot.profile)
  const target={x:0,z:-300,speed:scenario.speed,altitude:14}
  const mind=useMind?new Mind(v,w.terrain,pilot,{seed:'paired-mind'}):null
  mind?.hold(target,8,120)
  const step=(goal:DriveGoal)=>{
    if(mind){mind.step(FIXED_DT,v.input);v.fixedUpdate(FIXED_DT);w.world.step();v.postPhysics(FIXED_DT)}
    else w.step(v,pilot,goal)
  }
  for(let i=0;i<250;i++)step(target)
  const start={...v.body.translation()}, shot={id:'one',position:{x:start.x+Math.sin(scenario.angle)*scenario.distance,y:start.y,z:start.z-Math.cos(scenario.angle)*scenario.distance},velocity:{x:-Math.sin(scenario.angle)*24,y:0,z:Math.cos(scenario.angle)*(receding?-24:24)}}
  if(enabled){if(mind)mind.setThreats(()=>[shot]);else evasion.setSource(()=>[shot])}
  let miss=Infinity,flipped=0,active=0,minClear=Infinity,firstCatch:number|null=null
  const activation:unknown[]=[]
  const early:number[][]=[]
  try {
    for(let i=0;i<400;i++) {
      const p0=v.body.translation(), velocity:V3=[shot.velocity.x,shot.velocity.y,shot.velocity.z]
      if(!receding)steer(velocity,[p0.x-shot.position.x,p0.y+.4-shot.position.y,p0.z-shot.position.z],24,1.6,FIXED_DT)
      Object.assign(shot.velocity,{x:velocity[0],y:velocity[1],z:velocity[2]})
      shot.position.x+=velocity[0]*FIXED_DT;shot.position.y+=velocity[1]*FIXED_DT;shot.position.z+=velocity[2]*FIXED_DT
      // Match Pesters.step: move, clamp to ground + HOVER, then judge against the
      // current body position before the next physics step. The orb aims 0.4m above it.
      const floor=w.terrain.heightAt(shot.position.x,shot.position.z)+1.4
      if(shot.position.y<floor){shot.position.y=floor;if(shot.velocity.y<0)shot.velocity.y=0}
      miss=Math.min(miss,Math.hypot(p0.x-shot.position.x,p0.y-shot.position.y,p0.z-shot.position.z))
      if(firstCatch===null&&miss<=2.4)firstCatch=i*FIXED_DT
      const goal:DriveGoal={...target}
      if(evasion.apply(FIXED_DT,goal))active+=FIXED_DT
      step(goal)
      const controller=(mind as unknown as {evasion:PilotEvasion}|null)?.evasion??evasion
      const current=controller as unknown as {active:unknown;impactIn:number}
      if(current.active&&activation.length===0)activation.push({time:i*FIXED_DT,impactIn:current.impactIn,requestedSpeed:(current.active as {speed:number}).speed,actualSpeed:Math.hypot(v.body.linvel().x,v.body.linvel().z)})
      const p=v.body.translation(),up=new Vector3(0,1,0).applyQuaternion(v.body.rotation())
      minClear=Math.min(minClear,p.y-w.terrain.heightAt(p.x,p.z))
      if(up.y<.2)flipped+=FIXED_DT
      if(i<20)early.push([p.x,p.y,p.z,v.input.x,v.input.y])
    }
    return {miss,flipped,active,minClear,early,activation,firstCatch,final:{...v.body.translation()}}
  } finally {w.free()}
}
describe('pilot Pester evasion',()=>{
  it.each(['jet','hovercraft'] as const)('%s improves miss distance through its real pilot after reacting',kind=>{
    const baseline=run(kind,false),dodge=run(kind,true),receding=run(kind,true,true)
    console.log(kind,'evasion',JSON.stringify({baseline:baseline.miss,dodge:dodge.miss,active:dodge.active,clear:dodge.minClear,activation:dodge.activation,firstCatch:dodge.firstCatch}))
    expect(dodge.early).toEqual(baseline.early)
    expect(dodge.active).toBeGreaterThan(0)
    expect(dodge.active).toBeLessThanOrEqual(1.52)
    expect(baseline.miss).toBeLessThanOrEqual(2.4)
    expect(dodge.miss).toBeGreaterThan(2.4)
    expect(dodge.miss).toBeGreaterThan(baseline.miss)
    expect(dodge.flipped).toBe(0)
    expect(dodge.minClear).toBeGreaterThan(kind==='jet'?5:.5)
    expect(receding.active).toBe(0)
    expect(receding.early).toEqual(baseline.early)
    expect(receding.final).toEqual(baseline.final)
  },30000)
  it.each(['jet','hovercraft'] as const)('%s evades through the real Mind and pilot for the full Pester lifetime',kind=>{
    const baseline=run(kind,false,false,true),dodge=run(kind,true,false,true)
    console.log(kind,'Mind evasion',JSON.stringify({baseline:baseline.miss,dodge:dodge.miss,clear:dodge.minClear,activation:dodge.activation,firstCatch:dodge.firstCatch}))
    expect(baseline.miss).toBeLessThanOrEqual(2.4)
    expect(dodge.miss).toBeGreaterThan(2.4)
    expect(dodge.early).toEqual(baseline.early)
    expect(dodge.flipped).toBe(0)
    expect(dodge.minClear).toBeGreaterThan(kind==='jet'?5:.5)
  },30000)
  it('leaves the activity intact and clears a pending reaction when hooks are removed',()=>{
    const w=testWorld(()=>0,800,4),v=new Jet(w.game,w.terrain,new Vector3(0,14,0),0);v.isLocal=false
    const pilot=createPilot(v,w.terrain)!, mind=new Mind(v,w.terrain,pilot,{seed:'evasion-route'})
    mind.hold({x:0,z:-250},8,120)
    const activity=mind.activity,destination={...activity.destination}
    mind.setThreats(()=>[{id:'one',position:{x:0,y:14,z:-20},velocity:{x:0,y:0,z:20}}])
    for(let i=0;i<100;i++){mind.step(FIXED_DT,v.input);v.fixedUpdate(FIXED_DT);w.world.step();v.postPhysics(FIXED_DT)}
    expect(mind.activity).toBe(activity);expect(mind.activity.destination).toEqual(destination)
    mind.setThreats(null);mind.reset()
    expect(mind.activity.kind).toBe('pause')
    w.free()
  })
  it.each(['edge','wall','endpoint','liquid'] as const)('declines unsafe %s corridors and revalidates active ones',hazard=>{
    const w=testWorld(()=>0,200,2),v=new Jet(w.game,w.terrain,new Vector3(0,14,0),0);v.isLocal=false
    Object.assign(v,{id:'evasion-test'})
    const pilot=createPilot(v,w.terrain)!,evade=new PilotEvasion(v,w.terrain,pilot.profile)
    const source=()=>[{id:'one',position:{x:0,y:14,z:-20},velocity:{x:0,y:0,z:20}}]
    evade.setSource(source)
    const height=w.terrain.heightAt
    if(hazard==='edge')Object.assign(w.terrain,{size:90})
    if(hazard==='wall')w.terrain.heightAt=x=>Math.abs(x)>3?30:0
    if(hazard==='endpoint')w.terrain.heightAt=x=>Math.abs(Math.abs(x)-8)<.1?30:0
    if(hazard==='liquid')w.terrain.liquidHeightAt=x=>Math.abs(x)>3?30:0
    let active=false
    for(let i=0;i<100;i++)active ||= evade.apply(FIXED_DT,{x:0,z:-80,speed:8})
    expect(active).toBe(false)
    w.terrain.heightAt=height;w.terrain.liquidHeightAt=undefined;Object.assign(w.terrain,{size:200})
    evade.reset()
    for(let i=0;i<50;i++)evade.apply(FIXED_DT,{x:0,z:-80,speed:8})
    w.terrain.heightAt=()=>30
    expect(evade.apply(FIXED_DT,{x:0,z:-80,speed:8})).toBe(false)
    w.free()
  })
  it('restores flight policy, does not ratchet altitude, and does not repeat one shot',()=>{
    const w=testWorld(()=>0,2400,12),v=new Jet(w.game,w.terrain,new Vector3(0,40,0),0);v.isLocal=false
    Object.assign(v,{id:'evasion-test'})
    const actual=createPilot(v,w.terrain)!
    let last:DriveGoal={x:0,z:0,speed:0}
    const mind=new Mind(v,w.terrain,{profile:actual.profile,reset(){},drive(goal){last={...goal};return {stuckFor:0,airborne:true,flipped:false}}},{seed:'restore'})
    mind.hold({x:0,z:-900},8,120)
    mind.step(FIXED_DT,v.input);expect(last.special).toBe(true)
    const baseline=last.altitude
    mind.setThreats(()=>[{id:'one',position:{x:0,y:40,z:-20},velocity:{x:0,y:0,z:24}}])
    let active=0,highest=0
    for(let i=0;i<250;i++){
      mind.step(FIXED_DT,v.input)
      if(!last.special){active++;highest=Math.max(highest,last.altitude??0)}
      // A real ascent must not add another four metres on every frame.
      if(i===55)v.body.setTranslation({x:0,y:42,z:0},true)
    }
    expect(active).toBeGreaterThan(0);expect(active).toBeLessThanOrEqual(76)
    expect(highest).toBeLessThanOrEqual(44)
    expect(last.special).toBe(true);expect(last.altitude).toBe(baseline)
    expect(mind.activity.destination).toEqual({x:0,z:-900,y:undefined})
    w.free()
  })
  it('clears on shot removal, hooks removal, reset and body removal',()=>{
    const w=testWorld(()=>0,800,4),v=new Jet(w.game,w.terrain,new Vector3(0,14,0),0);v.isLocal=false
    const evade=new PilotEvasion(v,w.terrain,createPilot(v,w.terrain)!.profile)
    const shot={id:'one',position:{x:0,y:14,z:-20},velocity:{x:0,y:0,z:24}}
    let shots=[shot];const source=()=>shots
    const goal=()=>({x:0,z:-100,speed:8,altitude:14,special:true})
    evade.setSource(source)
    for(let i=0;i<50;i++)evade.apply(FIXED_DT,goal())
    expect(evade.apply(FIXED_DT,goal())).toBe(true)
    shots=[]
    for(let i=0;i<11;i++)evade.apply(FIXED_DT,goal())
    expect(evade.apply(FIXED_DT,goal())).toBe(false)
    shots=[shot];evade.reset()
    for(let i=0;i<50;i++)evade.apply(FIXED_DT,goal())
    evade.setSource(null);const ordinary=goal();expect(evade.apply(FIXED_DT,ordinary)).toBe(false);expect(ordinary).toEqual(goal())
    evade.setSource(source);evade.reset();expect(evade.apply(FIXED_DT,goal())).toBe(false)
    w.world.removeRigidBody(v.body);expect(evade.apply(FIXED_DT,goal())).toBe(false)
    w.free()
  })
  it('refuses a climb under another vehicle and checks carried momentum',()=>{
    const w=testWorld(()=>0,800,4),v=new Jet(w.game,w.terrain,new Vector3(0,14,0),0);v.isLocal=false
    const above=new Jet(w.game,w.terrain,new Vector3(0,21,0),0);above.isLocal=false
    const evade=new PilotEvasion(v,w.terrain,createPilot(v,w.terrain)!.profile,undefined,()=>[above])
    evade.setSource(()=>[{id:'one',position:{x:0,y:14,z:-20},velocity:{x:0,y:0,z:24}}])
    for(let i=0;i<100;i++)expect(evade.apply(FIXED_DT,{x:0,z:-100,speed:8})).toBe(false)
    above.body.setTranslation({x:100,y:21,z:0},true);evade.reset()
    v.body.setLinvel({x:0,y:0,z:-20},true)
    w.terrain.heightAt=(_x,z)=>z < -20?40:0
    for(let i=0;i<100;i++)expect(evade.apply(FIXED_DT,{x:0,z:-100,speed:8})).toBe(false)
    w.free()
  })

  it('lets hovercraft evade over level water but rejects a sudden liquid rise',()=>{
    const w=testWorld(()=>-20,800,4,()=>2),v=new Hovercraft(w.game,w.terrain,new Vector3(0,4.5,0),0);v.isLocal=false
    const evade=new PilotEvasion(v,w.terrain,createPilot(v,w.terrain)!.profile)
    evade.setSource(()=>[{id:'one',position:{x:0,y:4.5,z:-20},velocity:{x:0,y:0,z:24}}])
    for(let i=0;i<50;i++)evade.apply(FIXED_DT,{x:0,z:-100,speed:8})
    expect(evade.apply(FIXED_DT,{x:0,z:-100,speed:8})).toBe(true)
    w.terrain.liquidHeightAt=x=>Math.abs(x)>3?30:2
    expect(evade.apply(FIXED_DT,{x:0,z:-100,speed:8})).toBe(false)
    w.free()
  })

})

it('reports a fixed spread of full-lifetime approaches',()=>{
 const cases=[[-.8,30,8],[0,30,14],[.8,30,8],[-1.2,60,14],[0,60,8],[1.2,60,14]]
 for(const kind of ['jet','hovercraft'] as const)for(const [angle,distance,speed] of cases){
  const scenario={angle,distance,speed},baseline=run(kind,false,false,false,scenario),dodge=run(kind,true,false,false,scenario)
  appendFileSync('/tmp/syn3h-aerial-outward-spread.jsonl',JSON.stringify({kind,scenario,baseline:baseline.miss,dodge:dodge.miss,firstCatch:dodge.firstCatch,activation:dodge.activation,flipped:dodge.flipped,minClear:dodge.minClear})+'\n')
  expect(dodge.flipped).toBe(0)
  if(baseline.miss>2.4)expect(dodge.miss).toBeGreaterThan(2.4)
 }
},30000)

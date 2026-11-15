/** Measurement only. No runtime evasion policy, trajectory oracle or weapon tuning. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { beforeAll, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three/webgpu'
import { initPhysics, FIXED_DT } from '../../src/core/physics'
import { Jet } from '../../src/vehicles/Jet'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { Mind } from '../../src/bots/mind/Mind'
import { createPilot } from '../../src/bots/pilot'
import type { DriveGoal, Pilot } from '../../src/bots/pilot/types'
import { Pesters } from '../../src/weapons/pester/Pesters'
import { pesterLife, pesterSpeed, pesterTurn, pesterRadius } from '../../src/weapons/pester/params'
import { testWorld } from './pilot/world'

type Kind = 'hover-jet' | 'forward-jet' | 'hovercraft'
type Action = 'none' | 'left' | 'right'
type Case = { id: string; group: 'representative' | 'held-out' | 'safety'; angle: number; distance: number; bold: number; warmFlight: number; terrain?: 'wall' | 'water' | 'edge' }
// Declared before measurement. Held-out cases are not used to choose arc parameters.
const cases: Case[] = [
  { id: 'head-on', group: 'representative', angle: 0, distance: 60, bold: .2, warmFlight: .3 },
  { id: 'crossing-left', group: 'representative', angle: -.8, distance: 60, bold: .9, warmFlight: 2 },
  { id: 'crossing-right', group: 'representative', angle: .8, distance: 30, bold: .2, warmFlight: .3 },
  { id: 'short-warning', group: 'representative', angle: 0, distance: 12, bold: .9, warmFlight: 2 },
  { id: 'oblique-left', group: 'held-out', angle: -.43, distance: 43, bold: .6, warmFlight: 1 },
  { id: 'oblique-right', group: 'held-out', angle: 1.17, distance: 83, bold: .1, warmFlight: .7 },
  { id: 'rear-quarter', group: 'held-out', angle: 2.4, distance: 45, bold: .9, warmFlight: 2 },
  { id: 'short-oblique', group: 'held-out', angle: -.62, distance: 18, bold: .3, warmFlight: .3 },
  { id: 'wall', group: 'safety', angle: 0, distance: 60, bold: .5, warmFlight: 1, terrain: 'wall' },
  { id: 'water', group: 'safety', angle: 0, distance: 60, bold: .5, warmFlight: 1, terrain: 'water' },
  { id: 'edge', group: 'safety', angle: 0, distance: 60, bold: .5, warmFlight: 1, terrain: 'edge' },
]
const REACTION = .6, OBSERVATION = .2, ARC_SECONDS = 4, ARC_ANGLE = 25 * Math.PI / 180
const output = process.env.PESTER_RESPONSE_OUT ?? '/tmp/syn3h-pester-observations-v1'
beforeAll(initPhysics)

function run(kind: Kind, action: Action, scenario: Case) {
  const liquid = scenario.terrain === 'water'
  const world = testWorld((x) => scenario.terrain === 'wall' && x > 25 ? 65 : liquid ? -10 : 0, 6000, 15, liquid ? () => 0 : undefined)
  const x0 = scenario.terrain === 'edge' ? 2940 : 0
  const vehicle = kind === 'hovercraft' ? new Hovercraft(world.game, world.terrain, new Vector3(x0, 2.5, 0), 0) : new Jet(world.game, world.terrain, new Vector3(x0, 30, 0), 0)
  vehicle.isLocal = false
  const pilot = createPilot(vehicle, world.terrain)!
  const surface = (x: number, z: number) => Math.max(world.terrain.heightAt(x,z),world.terrain.liquidHeightAt?.(x,z)??-Infinity)
  let time = -1, seen: number | null = null, nextObservation = 0, activation: number | null = null, refused = 0, applied = 0
  let firstCatch: number | null = null, minimumSeparation = Infinity, caught = false, lastOrdinary: DriveGoal | null = null, lastExecuted: DriveGoal | null = null
  let flipped = 0, minimumClearance = Infinity, flightSeconds = 0, firstTurn: number | null = null
  const trace: unknown[] = [], beforeReaction: unknown[] = []
  const sourceDirection = new Vector3(), position = new Vector3(), up = new Vector3(), rotation = new Quaternion()
  let start = new Vector3(), startVelocity = new Vector3(), startHeading = 0
  let pesters: Pesters
  const safeLeg = (goal: DriveGoal) => {
    const here = vehicle.body.translation(), v = vehicle.body.linvel(), dx=goal.x-here.x,dz=goal.z-here.z,d=Math.hypot(dx,dz)||1
    const travel = Math.max(goal.speed,Math.hypot(v.x,v.z))*1.2
    const ends = [{x:goal.x,z:goal.z},{x:here.x+v.x*1.2,z:here.z+v.z*1.2},{x:goal.x+dx/d*travel,z:goal.z+dz/d*travel}]
    const footprint = kind==='hovercraft'?3:5
    for(const end of ends){
      const n=Math.max(1,Math.ceil(Math.hypot(end.x-here.x,end.z-here.z)/2))
      for(let i=0;i<=n;i++)for(const [ox,oz] of [[0,0],[footprint,0],[-footprint,0],[0,footprint],[0,-footprint]]){
        const x=here.x+(end.x-here.x)*i/n+ox,z=here.z+(end.z-here.z)*i/n+oz,h=surface(x,z)
        if(!Number.isFinite(h)||Math.abs(x)>2960||Math.abs(z)>2960)return false
        if(kind==='hovercraft' ? Math.abs(h-surface(here.x,here.z))>footprint*.45 : h>here.y-5)return false
      }
    }
    return true
  }
  // Read-only instrumentation. Private lifetime fields are inspected only in this test;
  // list() supplies live shot position/velocity, but deliberately exposes no lifetime.
  const observe = (goal: DriveGoal) => {
    const ownPosition = new Vector3().copy(vehicle.body.translation())
    const ownVelocity = new Vector3().copy(vehicle.body.linvel())
    const shot = pesters.list()[0]
    const source = (pesters as unknown as { orbs: { id: number; age: number; life: number; popped: number }[] }).orbs.find(o => o.id === 1)
    const unavailable = shot ? null : caught ? 'caught' : source && source.age > source.life ? 'expired' : 'no-live-shot'
    const relativePosition = shot ? new Vector3(...shot.pos).sub(ownPosition) : null
    const relativeVelocity = shot ? new Vector3(...shot.velocity).sub(ownVelocity) : null
    const range = relativePosition?.length() ?? null
    const speedSquared = relativeVelocity?.lengthSq() ?? 0
    const estimateUnavailable = !shot ? unavailable : speedSquared <= 1e-12 ? 'zero-relative-speed' : null
    // Instantaneous constant-velocity estimate only, not a simulated homing trajectory.
    const closestTime = relativePosition && relativeVelocity && !estimateUnavailable
      ? -relativePosition.dot(relativeVelocity) / speedSquared : null
    const closestOffset = closestTime !== null ? relativePosition!.clone().addScaledVector(relativeVelocity!, closestTime) : null
    const horizontalSpeed = Math.hypot(ownVelocity.x, ownVelocity.z)
    const right = horizontalSpeed > 1e-6 ? new Vector3(-ownVelocity.z, 0, ownVelocity.x).divideScalar(horizontalSpeed) : null
    return {
      time, ownPosition: ownPosition.toArray(), ownVelocity: ownVelocity.toArray(),
      mode: vehicle.input.special ? 'forward' : 'hover', ordinaryGoal: {...goal},
      orb: shot ? { id: shot.id, position: [...shot.pos], velocity: [...shot.velocity], age: source!.age, remainingLife: Math.max(0, source!.life-source!.age) } : null,
      unavailable, relativePosition: relativePosition?.toArray() ?? null, relativeVelocity: relativeVelocity?.toArray() ?? null,
      range, catchClearance: range === null ? null : range-pesterRadius.value,
      terrainClearance: ownPosition.y-surface(ownPosition.x,ownPosition.z),
      closingSpeed: range !== null && range > 1e-6 ? -relativePosition!.dot(relativeVelocity!)/range : null,
      closingUnavailable: range === null ? unavailable : range <= 1e-6 ? 'coincident-positions' : null,
      estimate: { unavailable: estimateUnavailable, closestTime, closestOffset: closestOffset?.toArray() ?? null,
        interpretation: closestTime === null ? 'undefined' : closestTime < 0 ? 'closest-point-in-past' : closestTime > (source!.life-source!.age) ? 'beyond-remaining-life' : 'within-remaining-life' },
      lateralSeparation: relativePosition && right ? relativePosition.dot(right) : null,
      lateralUnavailable: !shot ? unavailable : !right ? 'zero-horizontal-own-speed' : null,
    }
  }
  type Observation = ReturnType<typeof observe>
  const observations: Observation[] = []
  let decision: Observation | null = null
  const measured: Pilot = { profile: pilot.profile, reset: () => pilot.reset(), drive(goal,input,dt) {
    lastOrdinary={...goal};let chosen={...goal}
    // Observation/reaction is shared by both arcs. No shot trajectory is simulated here.
    if(time>=0&&time+1e-8>=nextObservation){
      // Same synchronous boundary for none/left/right, before any altered control.
      const observation = observe(goal)
      observations.push(observation)
      if(decision===null&&time+1e-8>=REACTION)decision=observation
      nextObservation=time+OBSERVATION
      if(pesters.list().length&&seen===null)seen=time
      if(action!=='none'&&seen!==null&&activation===null&&time-seen+1e-8>=REACTION&&pesters.list().length)activation=time
    }
    if(activation!==null&&time<activation+ARC_SECONDS&&pesters.list().length){
      const phase=(time-activation)/ARC_SECONDS, angle=(action==='left'?-1:1)*ARC_ANGLE*Math.sin(Math.PI*phase)
      const here=vehicle.body.translation(),dx=goal.x-here.x,dz=goal.z-here.z,base=Math.atan2(dx,-dz)
      // Keep forward-flight's distance guard and leave its special/turn guards untouched.
      const velocity=vehicle.body.linvel()
      const reach=goal.special?Math.max(260,Math.hypot(velocity.x,velocity.z)*4+20):60
      const candidate={...goal,x:here.x+Math.sin(base+angle)*reach,z:here.z-Math.cos(base+angle)*reach}
      if(safeLeg(candidate)){chosen=candidate;applied++}else refused++
    }
    lastExecuted={...chosen}
    return pilot.drive(chosen,input,dt)
  } }
  const mind = new Mind(vehicle,world.terrain,measured,{seed:'response-envelope',personality:{boldness:scenario.bold,curiosity:.5,sociability:.5,mischief:0,patience:.8,archetype:'cruiser'}})
  const destination={x:x0,z:kind==='hover-jet'?-380:-2500}
  mind.hold(destination,8,120)
  const activity=mind.activity
  const step=()=>{mind.step(FIXED_DT,vehicle.input);vehicle.fixedUpdate(FIXED_DT);world.world.step();vehicle.postPhysics(FIXED_DT)}
  try {
    let stableFlight=0,warmed=false
    for(let i=0;i<1500;i++){
      step()
      if(kind==='forward-jet'){stableFlight=vehicle.input.special?stableFlight+FIXED_DT:0;if(stableFlight>=scenario.warmFlight){warmed=true;break}}
      else if(i===249){warmed=true;break}
    }
    expect(warmed,`${kind} ${scenario.id} ordinary warmup`).toBe(true)
    expect(vehicle.input.special).toBe(kind==='forward-jet')
    start.copy(vehicle.body.translation());startVelocity.copy(vehicle.body.linvel());startHeading=Math.atan2(startVelocity.x,-startVelocity.z)
    const angle=startHeading+scenario.angle
    position.set(start.x+Math.sin(angle)*scenario.distance,start.y+.4,start.z-Math.cos(angle)*scenario.distance)
    sourceDirection.copy(start).add(new Vector3(0,.4,0)).sub(position).normalize()
    pesters=new Pesters(world.game,{self:()=>1,bodyOf:id=>id===1?vehicle.body:undefined,vehicleIds:()=>[1],judges:()=>true,heightAt:world.terrain.heightAt,wrapSize:()=>0,inHand:()=>false,launch(){},onCatch(_shooter,_shot,_victim,at){caught=true;firstCatch=time;minimumSeparation=Math.min(minimumSeparation,at.distanceTo(new Vector3().copy(vehicle.body.translation())))}})
    pesters.spawn(2,{id:1,k:'pester',boost:0,t:0,o:position.toArray() as [number,number,number],d:sourceDirection.toArray() as [number,number,number],to:1})
    for(let i=0;i<800;i++){
      time=i*FIXED_DT
      pesters.fixedUpdate(FIXED_DT)
      for(const shot of pesters.list())minimumSeparation=Math.min(minimumSeparation,new Vector3(...shot.pos).distanceTo(new Vector3().copy(vehicle.body.translation())))
      step()
      const p=vehicle.body.translation(),v=vehicle.body.linvel()
      up.set(0,1,0).applyQuaternion(rotation.copy(vehicle.body.rotation()))
      if(up.y<.2)flipped+=FIXED_DT
      minimumClearance=Math.min(minimumClearance,p.y-surface(p.x,p.z))
      if(time<pesterLife.value&&vehicle.input.special)flightSeconds+=FIXED_DT
      const heading=Math.atan2(v.x,-v.z),turn=Math.atan2(Math.sin(heading-startHeading),Math.cos(heading-startHeading))
      if(activation!==null&&firstTurn===null&&Math.abs(turn)>5*Math.PI/180)firstTurn=time
      if(time<REACTION)beforeReaction.push([p.x,p.y,p.z,vehicle.input.x,vehicle.input.y,vehicle.input.z,vehicle.input.w])
      if(i%10===0)trace.push({time,position:{...p},speed:Math.hypot(v.x,v.z),heading,flight:vehicle.input.special,ordinary:lastOrdinary,executed:lastExecuted})
    }
    expect(pesters.list()).toHaveLength(0)
    expect(mind.activity).toBe(activity)
    expect(mind.activity.destination).toEqual({...destination,y:undefined})
    expect(lastExecuted).toEqual(lastOrdinary)
    expect(activation===null||activation+1e-8>=REACTION).toBe(true)
    const pairedLateralResponse: {time:number; separation:number|null; unavailable:string|null}[]=[]
    const result={kind,action,scenario,caught,firstCatch,minimumSeparation,activation,firstTurn,appliedSeconds:applied*FIXED_DT,refusedSteps:refused,minimumClearance,flipped,flightSeconds,startSpeed:startVelocity.length(),returnCrossTrack:Math.abs(vehicle.body.translation().x-x0),routeRestored:true,decision,observations,pairedLateralResponse,trace,beforeReaction}
    return result
  } finally { pesters!?.dispose();vehicle.dispose();world.free() }
}

it('measures a fixed aircraft and Pester response envelope',()=>{
  expect([pesterSpeed.value,pesterTurn.value,pesterRadius.value,pesterLife.value]).toEqual([24,1.6,2.4,8])
  mkdirSync(output,{recursive:false}) // Refuse to overwrite an earlier measurement directory.
  const results:ReturnType<typeof run>[]=[]
  try {
    for(const kind of ['hover-jet','forward-jet','hovercraft'] as const)for(const scenario of cases){
      const baseline=run(kind,'none',scenario);results.push(baseline)
      for(const action of ['left','right'] as const){
        const result=run(kind,action,scenario);results.push(result)
        expect(result.beforeReaction).toEqual(baseline.beforeReaction)
        expect(result.decision).toEqual(baseline.decision)
        // Retrospective response measurement, never an observation or control input.
        // Fixed baseline travel-right axis at the shared decision, including route return.
        const v=baseline.decision?.ownVelocity
        const h=v?Math.hypot(v[0],v[2]):0
        for(let i=0;i<result.observations.length;i++){
          const sample=result.observations[i], base=baseline.observations[i]
          expect(sample.time).toBe(base.time)
          result.pairedLateralResponse.push({time:sample.time,
            separation:v&&h>1e-6?((sample.ownPosition[0]-base.ownPosition[0])*(-v[2])+(sample.ownPosition[2]-base.ownPosition[2])*v[0])/h:null,
            unavailable:v&&h>1e-6?null:'undefined-decision-travel-axis'})
        }
      }
    }
  } finally {
    writeFileSync(`${output}/results.json`,JSON.stringify({schema:2,wrapSize:0,sampleBoundary:'after Pesters.fixedUpdate, inside Mind pilot drive before altered control and vehicle physics',source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reaction:REACTION,observation:OBSERVATION,arcSeconds:ARC_SECONDS,arcDegrees:ARC_ANGLE*180/Math.PI,weapon:{speed:pesterSpeed.value,turn:pesterTurn.value,radius:pesterRadius.value,life:pesterLife.value},cases,results},null,2))
  }
},120000)

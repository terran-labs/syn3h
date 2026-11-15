/**
 * Materialization hold and release (src/vehicles/effects/Materialize.ts), on every vehicle kind,
 * in a headless physics world stepped the way Game.frame steps it.
 */
import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {FIXED_DT,RAPIER,initPhysics} from '../../src/core/physics'
import {VEHICLE_KINDS,createVehicle} from '../../src/vehicles'
import type {Vehicle} from '../../src/vehicles/Vehicle'
import {Materialize,type MaterializeCue,headingOf,restHeight} from '../../src/vehicles/effects/Materialize'
import {harness} from './harness'
beforeAll(initPhysics)

const KINDS=VEHICLE_KINDS.map(k=>k.kind)
const HOLD=1,HOVER=1.5,HOLD_STEPS=Math.round(HOLD/FIXED_DT)

/** A world with one vehicle and a Materialize system, stepped in either system order. */
function bed(kind:(typeof KINDS)[number],materializeFirst=false){
  const h=harness(),v=createVehicle(h.game,h.terrain,kind,new T.Vector3(3,3,-2),.7);v.isLocal=false
  const cues:{cue:MaterializeCue;y:number;seconds:number}[]=[]
  const m=new Materialize(h.game,h.terrain,{onCue:(cue,p,seconds)=>cues.push({cue,y:p.y,seconds})})
  const systems=materializeFirst?[m,v]:[v,m]
  const step=(n=1,each?:(i:number)=>void)=>{for(let i=0;i<n;i++){for(const s of systems)s.fixedUpdate?.(FIXED_DT);h.world.step();for(const s of systems)s.postPhysics?.(FIXED_DT);each?.(i)}}
  return {h,v,m,cues,step}
}

/** Body properties a hold may touch, to compare before and after. */
function snapshot(v:Vehicle){
  const b=v.body
  return {type:b.bodyType(),mass:b.mass(),gravityScale:b.gravityScale(),linearDamping:b.linearDamping(),angularDamping:b.angularDamping(),ccd:b.isCcdEnabled(),enabled:b.isEnabled(),
    colliders:Array.from({length:b.numColliders()},(_,i)=>{const c=b.collider(i);return {groups:c.collisionGroups(),sensor:c.isSensor(),friction:c.friction()}})}
}

describe.each(KINDS)('%s materializes',kind=>{
  it('ignores local axes, fire, rescue and toggle changes during the hold',()=>{
    const {h,v,m,step}=bed(kind)
    v.isLocal=true
    const before={zorb:v.input.zorb,special:v.input.special}
    Object.assign(h.game.input.state,{x:1,y:1,z:1,w:1,fire:true,zorb:!before.zorb,special:!before.special})
    m.begin(v,{holdSeconds:HOLD})
    step(10)
    expect([v.input.x,v.input.y,v.input.z,v.input.w,v.input.fire]).toEqual([0,0,0,0,false])
    expect({zorb:v.input.zorb,special:v.input.special}).toEqual(before)
    m.cancel(v);m.dispose();v.dispose();h.world.free()
  })

  it('is held level at hover height and at rest, then released on the step the hold ends and drops',async()=>{
    const {h,v,m,cues,step}=bed(kind)
    step(30)
    const before=snapshot(v),heading=headingOf(v.body.rotation()),start=v.body.translation()
    let released=false
    const done=m.begin(v,{holdSeconds:HOLD,hover:HOVER}).then(()=>{released=true})
    const y=restHeight(v)+HOVER
    expect(m.isHeld(v)).toBe(true)
    expect(v.object.userData.materializing).toBe(true)
    let heldSteps=0
    // Push it about and steer it while held: nothing may move it.
    v.input.y=1;v.input.x=1
    step(HOLD_STEPS+5,i=>{
      if(!m.isHeld(v))return
      heldSteps=i+1
      const t=v.body.translation(),r=v.body.rotation(),lv=v.body.linvel(),av=v.body.angvel()
      expect(t.x).toBeCloseTo(start.x,5);expect(t.z).toBeCloseTo(start.z,5);expect(t.y).toBeCloseTo(y,5)
      expect(Math.hypot(lv.x,lv.y,lv.z)).toBeLessThan(1e-4);expect(Math.hypot(av.x,av.y,av.z)).toBeLessThan(1e-4)
      // Level: the up axis is straight up. Heading kept.
      expect(1-2*(r.x*r.x+r.z*r.z)).toBeCloseTo(1,5)
      expect(headingOf(r)).toBeCloseTo(heading,4)
    })
    // Released within one step of the hold time.
    expect(Math.abs(heldSteps-(HOLD_STEPS-1))).toBeLessThanOrEqual(1)
    await done
    expect(released).toBe(true)
    expect(cues.map(c=>c.cue)).toEqual(['materializeStart','materializeRelease'])
    expect(cues[0].seconds).toBe(HOLD)
    expect(snapshot(v)).toEqual(before)
    expect(v.object.userData.materializing).toBeUndefined()
    v.input.y=0;v.input.x=0
    // Under ordinary physics again: it comes down from the hold.
    const top=v.body.translation().y
    step(120)
    // The jet releases automatic altitude hold too, so every kind drops after the cloud.
    expect(v.body.translation().y,'dropped').toBeLessThan(top-.3)
    v.dispose();h.world.free()
  })

  it('holds the same whichever order the systems were added in',()=>{
    const {h,v,m,step}=bed(kind,true)
    step(10)
    m.begin(v,{holdSeconds:HOLD,hover:HOVER})
    const y=restHeight(v)+HOVER
    step(HOLD_STEPS-2,()=>expect(v.body.translation().y).toBeCloseTo(y,5))
    expect(m.isHeld(v)).toBe(true)
    step(3)
    expect(m.isHeld(v)).toBe(false)
    expect(v.body.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic)
    v.dispose();h.world.free()
  })
})

describe('materialize lifecycle',()=>{
  it('a second begin during a hold starts the hold over and keeps the original body type',async()=>{
    const {h,v,m,cues,step}=bed('buggy')
    step(10)
    let first=false,second=false
    m.begin(v,{holdSeconds:HOLD}).then(()=>{first=true})
    step(40)
    m.begin(v,{holdSeconds:HOLD}).then(()=>{second=true})
    step(40)
    expect(m.isHeld(v)).toBe(true)
    step(HOLD_STEPS)
    expect(m.isHeld(v)).toBe(false)
    await Promise.resolve()
    expect(first&&second).toBe(true)
    expect(v.body.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic)
    expect(cues.map(c=>c.cue)).toEqual(['materializeStart','materializeCancel','materializeStart','materializeRelease'])
    v.dispose();h.world.free()
  })

  it('disposing mid hold releases the vehicle and restores its body',async()=>{
    const {h,v,m,cues,step}=bed('tank')
    step(10)
    const before=snapshot(v)
    const done=m.begin(v)
    step(20)
    m.dispose()
    await done
    expect(m.isHeld(v)).toBe(false)
    expect(snapshot(v)).toEqual(before)
    expect(cues.map(c=>c.cue)).toEqual(['materializeStart','materializeCancel'])
    v.dispose();h.world.free()
  })

  it('cancel releases at once; a vehicle removed while held is let go without touching its freed body',async()=>{
    const {h,v,m,cues,step}=bed('jet')
    step(5)
    m.begin(v);step(5);m.cancel(v)
    expect(m.isHeld(v)).toBe(false);expect(v.body.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic)
    const done=m.begin(v);step(5)
    v.dispose()
    m.fixedUpdate(FIXED_DT)
    await done
    expect(m.isMaterializing(v)).toBe(false)
    expect(cues.map(c=>c.cue)).toEqual(['materializeStart','materializeCancel','materializeStart','materializeCancel'])
    expect(cues.at(-1)?.y).toBeCloseTo(cues.at(-2)!.y,5)
    h.world.free()
  })

  it('hold: false plays the cues and leaves the body to whoever owns it',()=>{
    const {h,v,m,cues,step}=bed('hovercraft')
    step(10)
    const type=v.body.bodyType()
    m.begin(v,{hold:false,holdSeconds:.5})
    expect(m.isHeld(v)).toBe(false);expect(m.isMaterializing(v)).toBe(true);expect(v.body.bodyType()).toBe(type)
    step(31)
    expect(m.isMaterializing(v)).toBe(false)
    expect(cues.map(c=>c.cue)).toEqual(['materializeStart','materializeRelease'])
    v.dispose();h.world.free()
  })

  it('holds above liquid when the liquid is higher than the ground',()=>{
    const {h,v,m,step}=bed('buggy')
    ;(h.terrain as {liquidHeightAt?:(x:number,z:number)=>number}).liquidHeightAt=()=>4
    step(2)
    m.begin(v,{hover:1})
    step(5)
    expect(v.body.translation().y).toBeCloseTo(4+restHeight(v)+1,5)
    v.dispose();h.world.free()
  })
})

describe('materialize cloud',()=>{
  it('gathers during the hold, billows out on release, and is hidden once it has thinned away',()=>{
    const {h,v,m,step}=bed('buggy')
    step(5)
    const cloud=m.cloud
    expect(cloud.mesh.parent).toBe(h.game.scene)
    expect(cloud.mesh.visible,'no draw call before').toBe(false)
    m.begin(v,{holdSeconds:HOLD})
    // A frame per step, as at 60 Hz.
    const frame=()=>{step(1);m.update(FIXED_DT)}
    for(let i=0;i<3;i++)frame()
    const early=cloud.emitted
    for(let i=0;i<12;i++)frame()
    const gathered=cloud.emitted
    // Fade in: slower emission over the first 0.2 s than once gathered.
    expect(gathered-early).toBeGreaterThan(early*2)
    expect(cloud.mesh.visible).toBe(true)
    while(m.isHeld(v))frame()
    const atRelease=cloud.emitted
    expect(atRelease-gathered).toBeGreaterThan(0)
    for(let i=0;i<30;i++)frame()
    expect(cloud.emitted,'nothing more after the release burst').toBeLessThanOrEqual(atRelease+Math.ceil(cloud.capacity*.35))
    for(let i=0;i<60;i++)frame()
    expect(cloud.mesh.visible,'hidden again once every particle has died').toBe(false)
    m.dispose()
    expect(cloud.mesh.parent).toBeNull()
    v.dispose();h.world.free()
  })

  it('builds its batch at construction, the same one every frame',()=>{
    const {h,v,m,step}=bed('tank')
    const cloud=m.cloud
    m.begin(v)
    for(let i=0;i<70;i++){step(1);m.update(FIXED_DT)}
    expect(m.cloud).toBe(cloud)
    m.dispose();v.dispose();h.world.free()
  })
})

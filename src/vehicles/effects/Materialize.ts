/**
 * Materialization: a vehicle appears held in the air for a moment, then drops and drives.
 *
 * The owner, 15 November 2026: "switch vehicles in place with a little glowing cloud and it
 * pause in the air for a second as it materializes, then it should drop into the ground and
 * start driving."
 *
 *   const materialize = game.add(new Materialize(game, terrain, { onCue }))
 *   // after a vehicle is created or swapped, and after game.add(vehicle):
 *   materialize.begin(vehicle)
 *   // before game.remove(vehicle), if it might still be held:
 *   materialize.cancel(vehicle)
 *
 * The hold. On `begin` the vehicle is put `hover` metres above where it would rest on the
 * ground or liquid under it, level, with its heading kept, and its body is switched to
 * kinematic until the hold time has passed. Every controller (Jet, Hovercraft, Tank, the
 * liquid pass, wind, buoyancy and the ground guard) already skips a kinematic body: it is how
 * a far remote copy is placed exactly (net/RemotePlayer.ts). Vehicle.fixedUpdate skips player input and controller forces during the hold,
 * so gravity and drive forces cannot act on it. A kinematic body is not
 * shoved by anything. Each step it is put back at the hold point with no velocity, so neither
 * order of this system against the vehicle in `game.add` matters. On release the body type it
 * had is restored with zero velocity, and it drops under ordinary physics. A vehicle switched
 * in while moving passes `carry`: it is held at its own height if that is higher (a switch in
 * mid-air stays there) and released with the velocity and yaw rate it arrived with.
 *
 * Input and tagging. Vehicle.fixedUpdate ignores new controls while the
 * `vehicle.object.userData.materializing` flag is true. Networking uses the same flag to
 * suppress locally judged tags, firing and shoves. Remote authoritative ram reports still
 * need a synchronized signal for complete immunity.
 *
 * The cloud. A soft luminous white cloud with a light blue rim gathers round the vehicle over
 * about 0.2 s, stays through the hold, and on release billows outward and upward and thins
 * away as the vehicle drops. It is one additive ParticleBatch with a shader-generated sprite
 * (no image), built at construction and rebuilt only when the graphics level changes: 32,
 * 96 or 160 slots, one noise octave at the safe level. The mesh is hidden whenever no particle
 * is alive, so it costs no draw call outside a materialization. `materialize.arcs` above 0
 * adds tiny fast sparks for a sizzle; it is off by default. `prewarm()` compiles the shader at
 * world load so the first swap does not hitch. The update allocates nothing.
 *
 * Sound is not made here (src/audio is another lane's): `onCue` fires 'materializeStart' on
 * begin and 'materializeRelease' on release, with the vehicle's position and the hold time.
 * The position is a scratch vector reused for every cue: copy it if you keep it.
 */
import * as T from 'three/webgpu'
import {float,mix,mx_fractal_noise_float,smoothstep,vec3} from 'three/tsl'
import {params} from '../../../shared/params'
import type {Game,System} from '../../core/Game'
import {RAPIER} from '../../core/physics'
import type {Terrain} from '../../world/Terrain'
import {REST_HEIGHT,type Vehicle} from '../Vehicle'
import {graphicsLevel,levelNumber} from '../../core/quality'
import {effectNoise} from './index'
import {ParticleBatch} from './ParticleBatch'
import type {Sprite} from './sprites'
import {materializeArcs,materializeBrightness,materializeCloudSize,materializeHold,materializeHover} from './materializeParams'
import {ArrivalLook} from './arrivalLook'

export type MaterializeCue='materializeStart'|'materializeRelease'|'materializeCancel'
export type MaterializeCueHandler=(cue:MaterializeCue,position:T.Vector3,holdSeconds:number,vehicle:Vehicle)=>void

export interface MaterializeOptions {
  /** Seconds held in the air. Defaults to the 'Materialize hold' slider. */
  holdSeconds?:number
  /** Metres above the resting height. Defaults to the 'Materialize hover height' slider. */
  hover?:number
  /** Where to hold it (x and z; y is worked out from the ground). Defaults to where it is. */
  at?:T.Vector3
  /** Heading in radians, as `teleport` takes it. Defaults to the vehicle's own heading. */
  heading?:number
  /**
   * False plays only the look and the cues and leaves the body alone: for a vehicle this
   * client does not own (a remote copy placed by the network).
   */
  hold?:boolean
  /**
   * Motion to hand back on release, for a vehicle switched in while moving: it is held where
   * it is (never pulled down to the hover height, so a switch in mid-air stays there), then
   * let go with this velocity and yaw rate instead of from rest.
   */
  carry?:{linvel:{x:number;y:number;z:number};angvel:{x:number;y:number;z:number}}
}

interface Hold {
  vehicle:Vehicle
  /** Body type before the hold, put back on release. */
  type:RAPIER.RigidBodyType
  holds:boolean
  point:T.Vector3
  rotation:T.Quaternion
  elapsed:number
  seconds:number
  /** Cloud particles owed but not yet emitted. */
  owed:number
  /** Seconds the cloud has been gathering, for the fade in. */
  shown:number
  /** Velocity and spin restored on release (zero for an ordinary arrival). */
  linvel:T.Vector3
  angvel:T.Vector3
  /** Its volume, ground light, beam and silhouette, while one is free (see LOOKS). */
  look:ArrivalLook|null
  /** A departure (`depart`): the arrival in reverse, look only, ending with the vehicle gone. */
  departing:boolean
  /** performance.now() at `begin`: every hold ends by wall-clock time too (see WALL_SLACK). */
  wallStart:number
  done:(()=>void)[]
}

const UP=new T.Vector3(0,1,0)
const forward=new T.Vector3(),q=new T.Quaternion(),cuePoint=new T.Vector3()
// Scratch for emission; each is written and read inside one emit call.
const at=new T.Vector3(),velocity=new T.Vector3(),tint=new T.Color()

/** Particle slots by graphics level (safe, mobile, desktop). */
export const CLOUD_SLOTS=[32,96,160] as const
/** Seconds a cloud particle lives during the hold, and after release. */
const CLOUD_LIFE=.6,BURST_LIFE=.9
/** Seconds over which the cloud gathers. */
const FADE_IN=.2
/** Luminous white with a light blue tint, linear: the hot part of the cloud. */
const CLOUD_TINT=new T.Color(.82,.92,1),ARC_TINT=new T.Color(.7,.85,1)
/**
 * Seconds of wall-clock time a hold may outlast its own length. A hold counts physics steps,
 * and a slow device runs fewer of them a second than real time (at most five a frame), so at
 * 5 fps a 1 s hold lasted 2 s; under load longer. Every arrival now lets go within its hold plus
 * this, and every departure ends as surely: a 1 s hold releases control within 1.5 s, at any
 * frame rate.
 */
export const WALL_SLACK=.5
const now=()=>typeof performance!=='undefined'?performance.now():Date.now()
/** Seconds a departure takes by default. */
export const DEPART_SECONDS=1
/** Arrivals that get the full look at once; more at the same moment get only particles. */
const LOOKS=4
/**
 * The arrival's point light (graphics level 2 only): peak intensity at intensity 1, and reach in
 * metres at cloud size 1. It lights the ground and any vehicle beside the cloud.
 */
const LIGHT_INTENSITY=60,LIGHT_REACH=16
/**
 * The arrival's own level: the three-step graphics level, but at most the middle one on a touch
 * device (no point light, the lighter volume). A phone at High measured 2.2 ms a frame more with
 * the full arrival under 4x CPU throttling; the owner's budget is about half a millisecond.
 */
const touchDevice=typeof navigator!=='undefined'&&(navigator.maxTouchPoints>0||(typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches))
export function arrivalLevel(touch=touchDevice):number {
  const level=Math.min(2,levelNumber(Number(graphicsLevel.value)))
  return touch?Math.min(1,level):level
}
const reducedMotion=()=>{try{return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches}catch{return false}}
const bodyTint=new T.Color(),accentTint=new T.Color()

// TSL nodes are dynamically typed; sprites.ts uses the same alias.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any
/** A soft round puff, white in its body and pale blue at its frayed rim. */
const cloudSprite:Sprite=(p:N,seed:N,age:N,octaves:number)=>{
  const n=mx_fractal_noise_float(vec3(p.mul(1.6).add(seed.mul(17)),age.mul(1.4)),octaves,2,.5)
  const r=p.length().add(n.mul(.25)).clamp(0,1)
  const body=float(1).sub(r).pow(2),core=float(1).sub(smoothstep(0,.5,r))
  return {rgb:mix(vec3(.55,.75,1),vec3(1,1,1),core),alpha:body.mul(n.mul(.5).add(.8).clamp(.3,1.3)).mul(.45)}
}
/** The hovercraft's cushion slider (defined in Hovercraft.ts), looked up when first needed. */
let hoverClearance:{value:unknown}|null|undefined

/** Height the vehicle's origin rests at above the surface, as Vehicle.heightAboveSurface reads it. */
export function restHeight(vehicle:Vehicle):number {
  if(vehicle.kind==='hovercraft'){
    if(hoverClearance===undefined)hoverClearance=params.get('hover.clearance')??null
    const slider=Number(hoverClearance?.value)
    if(Number.isFinite(slider))return slider
  }
  return vehicle.kind in REST_HEIGHT?vehicle.restHeight():.7
}

/** Heading of a body's nose projected on the ground, in the convention `teleport` takes. */
export function headingOf(rotation:{x:number;y:number;z:number;w:number}):number {
  q.set(rotation.x,rotation.y,rotation.z,rotation.w)
  forward.set(0,0,-1).applyQuaternion(q)
  if(forward.x*forward.x+forward.z*forward.z<1e-4)forward.set(0,1,0).applyQuaternion(q).negate()
  return Math.atan2(-forward.x,-forward.z)
}

export class Materialize implements System {
  private readonly holds:Hold[]=[]
  onCue:MaterializeCueHandler|undefined
  /** The cloud's particles. Rebuilt only when the graphics level changes. */
  cloud!:ParticleBatch
  private level=-1
  private clock=0
  /** Clock time after which no cloud particle is alive. */
  private aliveUntil=0
  private serial=0
  private lastWall=now()
  /** Pooled arrival looks for the current graphics level. */
  private looks:ArrivalLook[]=[]
  /** One light shared by every arrival, given to the brightest; null below level 2. */
  private light:T.PointLight|null=null

  constructor(readonly game:Game,readonly terrain:Terrain,options:{onCue?:MaterializeCueHandler}={}){
    this.onCue=options.onCue
    this.build()
  }

  /** Make the cloud's batch for the current graphics level. */
  private build():void {
    const level=arrivalLevel()
    if(level===this.level)return
    this.cloud?.dispose()
    this.level=level
    this.cloud=new ParticleBatch(CLOUD_SLOTS[level],cloudSprite,true,level===0?1:2)
    this.cloud.clock.value=this.clock
    this.cloud.mesh.visible=this.clock<this.aliveUntil
    this.game.scene.add(this.cloud.mesh)
    for(const look of this.looks)look.dispose()
    this.looks=Array.from({length:LOOKS},()=>new ArrivalLook(level))
    for(const look of this.looks)this.game.scene.add(look.object)
    // Automatic quality can change the level mid-arrival: running arrivals carry on in a new look.
    for(const hold of this.holds){
      hold.look=this.looks.find(l=>!l.active)??null
      if(hold.look){hold.look.centre.copy(hold.holds?hold.point:hold.vehicle.object.position);hold.look.start(hold.vehicle,this.calm)}
    }
    // Only the desktop level pays for a real light: a light in the scene costs every lit pixel.
    if(level===2&&!this.light){
      this.light=new T.PointLight(0xffffff,0,LIGHT_REACH,2)
      this.light.castShadow=false
      this.game.scene.add(this.light)
    }else if(level<2&&this.light){this.light.removeFromParent();this.light.dispose();this.light=null}
  }

  /**
   * Compile the cloud's shader now, at world load, so the first materialization does not
   * hitch. Needs the game's renderer and camera; does nothing without them (headless tests).
   */
  async prewarm():Promise<void> {
    const renderer=this.game.renderer as T.WebGPURenderer|undefined
    if(!renderer||!this.game.camera)return
    const look=this.looks.find(l=>!l.active),meshes=[this.cloud.mesh,...(look?[look.object]:[])]
    const shown=meshes.map(m=>m.visible)
    for(const m of meshes)m.visible=true
    try{for(const m of meshes)await renderer.compileAsync(m,this.game.camera,this.game.scene)}
    finally{meshes.forEach((m,i)=>{m.visible=shown[i]});this.cloud.mesh.visible=this.clock<this.aliveUntil}
  }

  /** True while `vehicle` is held by a materialization. Weapons and tagging should ignore it. */
  isHeld(vehicle:Vehicle):boolean {return this.find(vehicle)?.holds??false}
  /** True while any part of `vehicle`'s materialization is running. */
  isMaterializing(vehicle:Vehicle):boolean {return this.find(vehicle)!==undefined}

  /**
   * Start materializing `vehicle`. Resolves once it has been released (or cancelled). Calling
   * it again during a hold starts the hold over from now, and both promises resolve together.
   */
  begin(vehicle:Vehicle,options:MaterializeOptions={}):Promise<void> {
    const seconds=Math.max(0,options.holdSeconds??materializeHold.value)
    const hover=Math.max(0,options.hover??materializeHover.value)
    const body=vehicle.body
    let hold=this.find(vehicle)
    if(hold)this.cue('materializeCancel',hold)
    if(!hold){
      hold={vehicle,type:body.bodyType(),holds:options.hold??true,point:new T.Vector3(),rotation:new T.Quaternion(),elapsed:0,seconds,done:[],owed:0,shown:0,linvel:new T.Vector3(),angvel:new T.Vector3(),look:null,departing:false,wallStart:0}
      this.holds.push(hold)
    }
    hold.elapsed=0;hold.seconds=seconds;hold.wallStart=now()
    const t=body.translation(),at=options.at??t
    const surface=Math.max(this.terrain.heightAt(at.x,at.z),this.terrain.liquidHeightAt?.(at.x,at.z)??-Infinity)
    hold.point.set(at.x,surface+restHeight(vehicle)+hover,at.z)
    const carry=options.carry
    if(carry){
      if(Number.isFinite(at.y))hold.point.y=Math.max(hold.point.y,at.y)
      hold.linvel.copy(carry.linvel);hold.angvel.copy(carry.angvel)
    }else{hold.linvel.set(0,0,0);hold.angvel.set(0,0,0)}
    const heading=options.heading??headingOf(body.rotation())
    hold.rotation.setFromAxisAngle(UP,heading)
    if(hold.holds){
      vehicle.teleport(hold.point,heading)
      if(!body.isKinematic())body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true)
      this.pin(hold)
      vehicle.object.userData.materializing=true
    }
    this.calm=reducedMotion()
    hold.departing=false
    hold.look??=this.looks.find(l=>!l.active)??null
    if(hold.look){hold.look.centre.copy(hold.holds?hold.point:vehicle.object.position);hold.look.start(vehicle,this.calm)}
    const promise=new Promise<void>(resolve=>hold.done.push(resolve))
    this.cue('materializeStart',hold)
    return promise
  }

  /**
   * Play the arrival in reverse round `vehicle` where it is: the ring and shell close in, then
   * the vehicle turns to light from the top down inside a thinning cloud. Look only: the body is
   * left alone. Resolves when it is over; remove the vehicle then, inside the cloud's last light
   * (the look fades on by itself). For a bot sent away and a player who leaves.
   */
  depart(vehicle:Vehicle,options:{holdSeconds?:number}={}):Promise<void> {
    const promise=this.begin(vehicle,{hold:false,holdSeconds:options.holdSeconds??DEPART_SECONDS})
    const hold=this.find(vehicle)
    if(hold){
      hold.departing=true
      hold.look?.start(vehicle,this.calm,true)
    }
    return promise
  }

  /** End `vehicle`'s materialization now, releasing it if held. Safe if it is not materializing. */
  cancel(vehicle:Vehicle):void {
    const hold=this.find(vehicle)
    if(hold)this.release(hold,false)
  }

  fixedUpdate(dt:number):void {
    for(let i=this.holds.length-1;i>=0;i--){
      const hold=this.holds[i]
      if(!this.alive(hold)){this.finish(hold);continue}
      hold.elapsed+=dt
      // Half a step of tolerance, so a 1 s hold is exactly 50 held steps despite rounding.
      // A departure ends without the release burst: the caller removes the vehicle in its light.
      if(hold.elapsed>=hold.seconds-dt*.5)this.release(hold,!hold.departing)
      else if(hold.holds)this.pin(hold)
    }
  }

  postPhysics():void {
    for(const hold of this.holds)if(hold.holds&&this.alive(hold))this.pin(hold)
  }

  /** Feed the cloud round every vehicle materializing. Allocates nothing. */
  update(dt:number):void {
    if(arrivalLevel()!==this.level)this.build()
    // Wall-clock bounds: a hold that physics has not finished in its time plus WALL_SLACK ends
    // now, and the look runs on real time, so a slow frame rate cannot stretch either.
    const t=now(),wallDt=Math.min(.5,Math.max(0,(t-this.lastWall)/1000));this.lastWall=t
    for(let i=this.holds.length-1;i>=0;i--){
      const hold=this.holds[i]
      if((t-hold.wallStart)/1000>=hold.seconds+WALL_SLACK)this.release(hold,!hold.departing)
    }
    this.clock+=Math.min(.1,Math.max(0,dt))
    const cloud=this.cloud
    cloud.clock.value=this.clock
    // About two thirds of the slots alive at once, shared between holds.
    const rate=cloud.capacity*.65/CLOUD_LIFE/Math.max(1,this.holds.length)
    const arcs=Number(materializeArcs.value)
    for(const hold of this.holds){
      hold.shown+=dt
      hold.owed+=rate*dt*Math.min(1,hold.shown/FADE_IN)
      const centre=hold.holds?hold.point:hold.vehicle.object.position
      this.colorsOf(hold.vehicle)
      // Arriving, the cloud is drawn in; departing, it drifts out, at half the rate.
      if(hold.departing)hold.owed-=rate*dt*.5*Math.min(1,hold.shown/FADE_IN)
      while(hold.owed>=1){hold.owed--;this.puff(centre,hold.departing)}
      if(arcs>0&&this.noise()<arcs*dt*30)this.arc(centre)
      if(hold.look){hold.look.centre.copy(centre);this.progress.set(hold.look,hold.seconds>0?Math.min(1,hold.elapsed/hold.seconds):1)}
    }
    cloud.mesh.visible=this.clock<this.aliveUntil
    this.updateLooks(wallDt)
  }

  /** Hold progress per look, written in update and read by updateLooks. */
  private readonly progress=new Map<ArrivalLook,number>()

  /** Advance every arrival look, holding or releasing, and give the light to the brightest. */
  private updateLooks(dt:number):void {
    const size=Number(materializeCloudSize.value),intensity=Number(materializeBrightness.value)
    let best:ArrivalLook|null=null,bestLight=0
    for(const look of this.looks){
      if(!look.active)continue
      const c=look.centre
      const surface=Math.max(this.terrain.heightAt(c.x,c.z),this.terrain.liquidHeightAt?.(c.x,c.z)??-Infinity)
      const distance=this.game.camera?this.game.camera.position.distanceTo(c):0
      look.update(Math.max(0,dt),this.progress.get(look)??1,surface,size,intensity,distance)
      const light=look.light()
      if(light>bestLight){bestLight=light;best=look}
    }
    const light=this.light
    if(!light)return
    // Dark, never hidden: three gathers only visible lights, so toggling visibility changed every
    // lit material's light set and rebuilt their shaders on each arrival and departure (500 to
    // 975 ms frames at High under load, once per bot when bots arrive one at a time).
    if(!best){light.intensity=0;return}
    light.position.copy(best.centre).y+=.6*size
    light.color.copy(best.accent)
    light.intensity=bestLight*LIGHT_INTENSITY
    light.distance=LIGHT_REACH*size
  }

  /** The vehicle's body and accent colours, linear, into the scratch colours. */
  private colorsOf(vehicle:Vehicle):void {
    bodyTint.set(vehicle.colors.body);accentTint.set(vehicle.colors.accent)
  }

  dispose():void {
    for(let i=this.holds.length-1;i>=0;i--)this.release(this.holds[i],false)
    this.cloud.dispose()
    for(const look of this.looks)look.dispose()
    this.looks=[]
    if(this.light){this.light.removeFromParent();this.light.dispose();this.light=null}
  }

  private noise():number {return effectNoise(this.serial++)}

  /**
   * One cloud particle round `centre`: in an ellipsoid the size of a vehicle while held,
   * drifting slowly; on release, thrown outward and upward to thin away.
   */
  private puff(centre:T.Vector3,burst:boolean):void {
    const size=Number(materializeCloudSize.value),angle=this.noise()*Math.PI*2
    const motion=this.calm?.3:1
    const life=burst?BURST_LIFE*(.7+this.noise()*.6):CLOUD_LIFE*(.8+this.noise()*.4)
    if(burst){
      const radius=1.4*size*Math.sqrt(this.noise())
      at.set(centre.x+Math.cos(angle)*radius,centre.y+(this.noise()-.45)*1.3*size,centre.z+Math.sin(angle)*radius)
      const out=(2.5+this.noise()*3)*motion
      velocity.set(Math.cos(angle)*out,(1.2+this.noise()*1.8)*motion,Math.sin(angle)*out)
    }else{
      // Born on a wide shell and drawn in, swirling, to the centre: the cloud gathers.
      const lift=(this.noise()-.5)*1.2,radius=(2.2+this.noise()*.8)*size
      const cx=Math.cos(angle),cz=Math.sin(angle)
      at.set(centre.x+cx*radius,centre.y+lift*radius*.6,centre.z+cz*radius)
      const pull=radius*.8/life*motion,swirl=1.4*size*motion
      velocity.set(-cx*pull-cz*swirl,-lift*radius*.6*.8/life*motion,-cz*pull+cx*swirl)
    }
    // Fewer, larger puffs at the safe level keep the same coverage.
    const scale=this.level===0?1.6:this.level===1?1.2:1
    const grow=burst?1.6:-.6*size
    // The player's colours: accent glow, body colour depth, and a share of hot white.
    const pick=this.noise(),brightness=Number(materializeBrightness.value)
    tint.copy(pick<.45?accentTint:pick<.7?bodyTint:CLOUD_TINT)
    if(pick<.7)tint.lerp(CLOUD_TINT,.25).multiplyScalar(1.6)
    this.cloud.emit(at,velocity,life,(.8+this.noise()*.7)*size*scale,grow,tint.multiplyScalar(brightness))
    this.aliveUntil=Math.max(this.aliveUntil,this.clock+life)
  }

  /** Reduced motion, read once per arrival. */
  private calm=false

  /** A tiny fast spark for the optional sizzle. */
  private arc(centre:T.Vector3):void {
    const size=Number(materializeCloudSize.value),angle=this.noise()*Math.PI*2,speed=5+this.noise()*5
    at.set(centre.x+Math.cos(angle)*.8*size,centre.y+(this.noise()-.5)*size,centre.z+Math.sin(angle)*.8*size)
    velocity.set(Math.cos(angle+1.4)*speed,(this.noise()-.5)*speed,Math.sin(angle+1.4)*speed)
    this.cloud.emit(at,velocity,.12,.12*size,-.5,tint.copy(ARC_TINT).multiplyScalar(3*Number(materializeBrightness.value)))
    this.aliveUntil=Math.max(this.aliveUntil,this.clock+.12)
  }

  private find(vehicle:Vehicle):Hold|undefined {
    for(const hold of this.holds)if(hold.vehicle===vehicle)return hold
    return undefined
  }

  /** The vehicle's body is still in the world (it may have been removed while held). */
  private alive(hold:Hold):boolean {
    // A detached vehicle (a departure's picture) has no body, and needs none: it is a look only.
    if(hold.vehicle.detached)return !hold.holds
    const body=hold.vehicle.body
    return this.game.world.getRigidBody(body.handle)===body
  }

  /** Put the body exactly at the hold point, level, with no motion. */
  private pin(hold:Hold):void {
    const b=hold.vehicle.body,p=hold.point,r=hold.rotation
    b.setTranslation(p,false);b.setRotation(r,false)
    b.setNextKinematicTranslation(p);b.setNextKinematicRotation(r)
    b.setLinvel({x:0,y:0,z:0},false);b.setAngvel({x:0,y:0,z:0},false)
  }

  private release(hold:Hold,cue:boolean):void {
    if(this.alive(hold)&&hold.holds){
      const b=hold.vehicle.body
      this.pin(hold)
      if(b.bodyType()!==hold.type)b.setBodyType(hold.type,true)
      b.setLinvel(hold.linvel,true);b.setAngvel(hold.angvel,true)
    }
    hold.look?.[cue?'release':'cancel']()
    hold.look=null
    if(cue){
      // The cloud lets go with the vehicle: a last puff thrown outward and upward.
      const n=Math.ceil(this.cloud.capacity*.35/Math.max(1,this.holds.length))
      const centre=hold.holds?hold.point:hold.vehicle.object.position
      this.colorsOf(hold.vehicle)
      for(let i=0;i<n;i++)this.puff(centre,true)
      this.cloud.mesh.visible=true
      this.cue('materializeRelease',hold)
    }
    this.finish(hold,cue)
  }

  private finish(hold:Hold,released=false):void {
    // Every interrupted hold must stop its looping sound, including removed bodies.
    if(!released)this.cue('materializeCancel',hold)
    hold.look?.cancel();hold.look=null
    const i=this.holds.indexOf(hold)
    if(i>=0)this.holds.splice(i,1)
    if(hold.holds)delete hold.vehicle.object.userData.materializing
    const done=hold.done;hold.done=[]
    for(const resolve of done)resolve()
  }

  private cue(kind:MaterializeCue,hold:Hold):void {
    if(!this.onCue)return
    const t=!hold.vehicle.detached&&this.alive(hold)?hold.vehicle.body.translation():hold.point
    this.onCue(kind,cuePoint.set(t.x,t.y,t.z),hold.seconds,hold.vehicle)
  }
}

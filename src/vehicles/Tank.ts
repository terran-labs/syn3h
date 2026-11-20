import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER } from '../core/physics'
import { defineParam } from '../../shared/params'
import { defaultPreset, definePresets } from '../../shared/presets'
import { Vehicle } from './Vehicle'


import { detailLevel, registerVehicleDetail } from './skins/mergeStatic'
import { ExpeditionTank } from './tank/kit'
import { sherpa, type TankBody } from './tank/shipped'
import { vehicleDecoration } from './skins/decoration'

export const tankPower=defineParam({id:'tank.power',label:'Power',group:'Tank',scope:'world',default:2000,min:500,max:3500,step:10})
export const tankSpeed=defineParam({id:'tank.speed',label:'Speed',group:'Tank',scope:'world',default:25,min:10,max:40,step:.1})
export const tankGrip=defineParam({id:'tank.grip',label:'Grip',group:'Tank',scope:'world',default:.1,min:0,max:.2,step:.01})
// Not in the source. TankTrack.js 102-109 pushes along whatever surface the track touches, so six
// tracks at 2000 N carry a 241 kg tank up a near vertical face. The drive now fades out over
// CLIMB_FADE degrees past this slope. At 90 the limit is off and the original behaviour returns.
// A cap tied to the load on each track was tried first: it bogged the tank to 4.5 m/s whenever it
// steered uphill, because the source cuts one side's motor to steer and that side then drags.
const CLIMB_FADE=10
export const tankClimb=defineParam({id:'tank.climb',label:'Steepest climb, degrees (90 = original)',group:'Tank',scope:'world',default:45,min:20,max:90,step:1})
/** Normal play always builds the approved Sherpa. The lab supplies its own study data. */
let body: TankBody = sherpa
const wearers=new Set<()=>void>()
/** Lab hook: replace the body without importing any study into the game's module graph. */
export function previewTankBody(design: TankBody = sherpa):void{
  body=design
  for(const rebuild of wearers)rebuild()
}
export const tankCG=defineParam({id:'tank.cg',label:'Centre of gravity',group:'Tank',scope:'world',default:-.2,min:-1.4,max:1,step:.01})
/** The tank is hidden from the game for now (16 November 2026): only its Default preset. */
export const TANK_PRESETS = definePresets('Tank', [defaultPreset(['tank.power', 'tank.speed', 'tank.grip', 'tank.climb', 'tank.cg'])])

// TankTrack.prefab: the Detailed mesh sits at (0.5,-0.75,-1.05) with X scale 0.82, so a pod is 1.0 wide
// and 2.1 long, centred on the track body. The tread mesh's own proportions make it 1.37 tall.
const POD_HEIGHT=1.37
// The source hangs each track on a soft joint at hull height (Tank.js 20, joint limit 0), and the hull
// weighs 1 kg, so the pods ride level with the hull origin. The cast starts at CAST_Y and the support
// spring is SPRING_LENGTH long, which rests the pod centre at hull-local 0 under the tank's weight.
const CAST_Y=.115,SPRING_LENGTH=.6,SPRING=4000,DAMPER=450,POD_DROOP=.25
// Longest half-length the chassis box takes from a body. Past this a 300 m/s dive needs the
// ground guard (tests/vehicles2/ground-guard.test.ts); a longer nose overhangs the box a little.
const BOX_LONGEST=3.4
// Ground under a resting tank, below the body origin: half a pod. The generated bodies are
// modelled standing on y = 0 and are hung this far down.
const GROUND=POD_HEIGHT/2
// A pod pitches to lie along the ground under it, up to this many radians from the hull's own pitch.
const ROCK_LIMIT=.35

// Scratch for applyForces. One set serves every tank: the step is not re-entrant.
const Q=new THREE.Quaternion(),INV=new THREE.Quaternion()
const POSITION=new THREE.Vector3(),UP=new THREE.Vector3(),RIGHT=new THREE.Vector3(),DOWN=new THREE.Vector3(),VELOCITY=new THREE.Vector3(),ANGULAR=new THREE.Vector3()
const ORIGIN=new THREE.Vector3(),NORMAL=new THREE.Vector3(),LIE=new THREE.Vector3(),POINT=new THREE.Vector3(),POINT_VELOCITY=new THREE.Vector3(),LOCAL=new THREE.Vector3()
const FORCE=new THREE.Vector3(),FORWARD=new THREE.Vector3(),SIDE=new THREE.Vector3(),APPLICATION=new THREE.Vector3(),AXIS=new THREE.Vector3()
const ZERO={x:0,y:0,z:0},RECOVERY_LIFT={x:0,y:5000,z:0},WORLD_UP=new THREE.Vector3(0,1,0)

/**
 * The tank: the Mars Explorer controller (six tracks, each a shape cast with a spring) under a
 * generated exploration body. No tank exists in the supplied Syn3h snapshots.
 */
export class Tank extends Vehicle {
  readonly kind = 'tank' as const
  readonly ridePosition=new THREE.Object3D()
  modelReady:Promise<void>=Promise.resolve()
  private readonly motors=Array.from({length:6},()=>({speed:0,velocity:0}))
  private readonly shape=new RAPIER.Cuboid(.45,.3,1)
  private readonly bellyRay=new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0})
  /** Height of each pod above its rest position, in metres: positive when the ground pushes it up. */
  readonly podLift=new Float32Array(6)
  private readonly podRock=new Float32Array(6)
  /** Distance each belt has run, in metres. Doubles: this only ever grows. */
  private readonly podRun=new Float64Array(6)
  // Last step's values, so the drawn pods move between physics steps as the body does.
  private readonly lastLift=new Float32Array(6)
  private readonly lastRock=new Float32Array(6)
  private readonly lastRun=new Float64Array(6)
  private generated?:ExpeditionTank
  private design:TankBody|null|undefined
  private chassis?:RAPIER.Collider
  private detachDetail=()=>{}
  private readonly wear=()=>this.rebuild()
  private level:0|1|2=0
  private castsShadows=true
  private cg=NaN
  private bellyUp=false
  groundedTracks=0
  constructor(game:Game,terrain:Terrain,position:THREE.Vector3,heading=0){
    super(game,terrain,position,heading)
    this.object.add(this.ridePosition)
    this.rebuild()
    wearers.add(this.wear)
  }
  /** Build the current body, replacing whatever is there. Physics state is kept. */
  private rebuild(){
    if(body===this.design)return
    const design=this.design=body
    this.detachDetail();this.detachDetail=()=>{}
    this.generated?.dispose();this.generated=undefined
    if(this.chassis)this.game.world.removeCollider(this.chassis,true)
    // Tank.prefab Cube: size 2.5x1.5x5, centre Y=1. Track masses are folded into the hull. A
    // generated body longer than that gets a box as long as it is: a nose that passes through
    // a wall would take the driver's eye with it. Width, height and clearance are the original's.
    const hull=design.hull()
    this.chassis=this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(1.25,.75,Math.min(BOX_LONGEST,Math.max(2.5,hull.halfLength))).setTranslation(0,1,0).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    this.setMass()
    const tank=new ExpeditionTank(hull,design.color,design.accent)
    tank.object.position.y=-GROUND;this.object.add(tank.object);this.generated=tank
    // Apply the shared player palette on first construction too, as Jet and Hovercraft do.
    tank.setColors(this.colors.body,this.colors.accent)
    this.ridePosition.position.set(tank.eye[0],tank.eye[1]-GROUND,tank.eye[2])
    // The cabin is modelled to be sat in, and the lamps are faces of the hull.
    this.object.userData.cockpit=true;this.object.userData.ownLamps=true
    this.modelReady=Promise.resolve()
    if(typeof window!=='undefined')tank.showroom(vehicleDecoration)
    this.level=0;this.castsShadows=true
    this.detachDetail=registerVehicleDetail(tank.object,(distance,remote,graphics)=>{
      this.level=detailLevel(distance,remote,this.level);tank.setLevel(this.level)
      const cast=!remote||distance<(graphics===2?20:0)
      if(cast!==this.castsShadows){this.castsShadows=cast;tank.setShadows(cast)}
    })
  }
  protected override applyColors(){this.generated?.setColors(this.colors.body,this.colors.accent)}
  private setMass(){
    this.cg=tankCG.value
    // Vehicle.js 110 adds the default 1 kg Rigidbody; TankTrack.prefab adds six 40 kg bodies.
    // Inertia is the equivalent distributed track mass, replacing their locked joints.
    this.body.setAdditionalMassProperties(241,{x:0,y:this.cg,z:0},{x:1050,y:2000,z:1000},{x:0,y:0,z:0,w:1},true)
    this.body.recomputeMassPropertiesFromColliders()
  }
  private motor(i:number,forwardSpeed:number,dt:number){
    const m=this.motors[i],throttle=Math.sign(this.input.y),right=i%2===1
    if(!throttle)return tankPower.value*this.input.x*-.5*(right?1:-1)
    m.speed=throttle*Math.max(100,Math.abs(m.speed))
    const target=throttle*tankPower.value*Math.max(.1,tankSpeed.value-throttle*forwardSpeed)/tankSpeed.value
    // TankTrack.js 65-84: Unity SmoothDamp with a persistent velocity and 2.5 second time.
    if(Math.abs(target)>Math.abs(m.speed)){
      const omega=2/2.5,x=omega*dt,decay=1/(1+x+.48*x*x+.235*x*x*x),change=m.speed-target,temp=(m.velocity+omega*change)*dt
      m.velocity=(m.velocity-omega*temp)*decay;m.speed=target+(change+temp)*decay
    }else{m.speed=target;m.velocity=0}
    if((right&&this.input.x>0)||(!right&&this.input.x<0))return 0
    return m.speed
  }
  protected applyForces(dt:number){
    // A copy driven by the network is not pushed, but its pods still follow the ground.
    const driven=!this.body.isKinematic()
    if(driven&&this.cg!==tankCG.value)this.setMass()
    this.lastLift.set(this.podLift);this.lastRock.set(this.podRock);this.lastRun.set(this.podRun)
    // Scratch vectors throughout: this runs for every tank every step and creates nothing.
    const q=Q.copy(this.body.rotation()),inv=INV.copy(q).invert(),position=POSITION.copy(this.body.translation())
    const up=UP.set(0,1,0).applyQuaternion(q),right=RIGHT.set(1,0,0).applyQuaternion(q),down=DOWN.copy(up).negate()
    const velocity=VELOCITY.copy(this.body.linvel()),speed=velocity.length()
    const parked=this.input.brakes&&speed<3
    // TankMe.js 7-19: stationary braking differs from the ordinary .01 drag and 2 angular drag.
    if(!driven){}
    else if(parked){this.body.setLinvel(ZERO,true);this.body.setAngvel(ZERO,true)}
    else{this.body.setLinvel(velocity.multiplyScalar(Math.max(0,1-.01*dt)),true);this.body.setAngvel(ANGULAR.copy(this.body.angvel()).multiplyScalar(Math.max(0,1-2*dt)),true)}
    this.groundedTracks=0
    for(let i=0;i<6;i++){
      const origin=ORIGIN.set(i%2?2:-2,CAST_Y,(Math.floor(i/2)-1)*2.5).applyQuaternion(q).add(position)
      const hit=this.game.world.castShape(origin,q,down,this.shape,0,SPRING_LENGTH,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,this.body)
      const normal=hit?NORMAL.copy(hit.normal1).normalize():NORMAL.copy(up)
      const touching=!!hit&&normal.dot(up)>=.1
      // A pod off the ground droops a little and eases there, instead of snapping to a fixed offset.
      const podTarget=hit&&touching?.5-hit.time_of_impact:-POD_DROOP
      this.podLift[i]+=(podTarget-this.podLift[i])*Math.min(1,dt*(podTarget<this.podLift[i]?6:25))
      // The pod turns on its arm to lie along the ground: the ground's slope in the hull's frame.
      let rockTarget=0
      if(touching){const lie=LIE.copy(normal).applyQuaternion(inv);rockTarget=THREE.MathUtils.clamp(Math.atan2(lie.z,lie.y),-ROCK_LIMIT,ROCK_LIMIT)}
      this.podRock[i]+=(rockTarget-this.podRock[i])*Math.min(1,dt*12)
      if(!hit||!touching)continue
      this.groundedTracks++
      const point=POINT.copy(hit.witness1),pointVelocity=POINT_VELOCITY.copy(this.body.velocityAtPoint(point)),v=LOCAL.copy(pointVelocity).applyQuaternion(inv).clampLength(0,1000)
      // The belt runs with the ground under it, as the original scrolled its tread texture.
      this.podRun[i]-=v.z*dt
      if(!driven)continue
      // Replaces joint/contact support with a damped spring. Force formula below stays original.
      const support=Math.max(0,(SPRING_LENGTH-hit.time_of_impact)*SPRING-pointVelocity.dot(normal)*DAMPER)
      this.body.addForceAtPoint(FORCE.copy(normal).multiplyScalar(support),point,true)
      if(parked&&!this.input.y)continue
      const slope=Math.acos(THREE.MathUtils.clamp(normal.y,-1,1))*180/Math.PI
      const climb=tankClimb.value>=90?1:THREE.MathUtils.clamp(1-(slope-tankClimb.value)/CLIMB_FADE,0,1)
      const motor=this.motor(i,-v.z,dt)*climb,forward=FORWARD.copy(normal).cross(right).normalize(),side=SIDE.copy(forward).cross(normal).normalize()
      // TankTrack.js 102-109: sideways150, rolling50, lift10, raised application point.
      const force=side.multiplyScalar(-v.x*150).addScaledVector(normal,10).addScaledVector(forward,Math.abs(motor)>.1?motor:v.z*50)
      this.body.addForceAtPoint(force,APPLICATION.copy(point).addScaledVector(up,tankGrip.value),true)
    }
    this.wheelsGrounded=this.groundedTracks
    if(!driven)return
    // TankMe.js 26-40: recovery only when the overturned hull touches terrain. TankMe.js 27
    // skips it inside a zorb ball.
    if(up.y>Math.cos(35*Math.PI/180)||this.zorbed)this.bellyUp=false
    if(!this.zorbed&&up.y<Math.cos(130*Math.PI/180)&&speed*speed<20&&ANGULAR.copy(this.body.angvel()).lengthSq()<5){
      this.bellyRay.origin=position
      const hit=this.game.world.castRay(this.bellyRay,1.8,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,this.body)
      if(hit)this.bellyUp=true
    }
    if(this.bellyUp){
      this.body.addForce(RECOVERY_LIFT,true)
      const axis=AXIS.copy(up).cross(WORLD_UP);if(axis.lengthSq()<1e-6)axis.set(1,0,0)
      // Bound the original acceleration torque to avoid one-step flips with a single rigid body.
      this.body.addTorque(axis.multiplyScalar(20000),true)
    }
  }
  override update(dt:number,alpha:number){
    super.update(dt,alpha)
    const tank=this.generated
    if(!tank)return
    for(let i=0;i<6;i++)tank.setPod(i,this.lastLift[i]+(this.podLift[i]-this.lastLift[i])*alpha,this.lastRock[i]+(this.podRock[i]-this.lastRock[i])*alpha,this.lastRun[i]+(this.podRun[i]-this.lastRun[i])*alpha)
    tank.setLights(this.input.brakes)
    tank.pose()
  }
  override teleport(position:THREE.Vector3,heading=0){super.teleport(position,heading);this.motors.forEach(m=>{m.speed=m.velocity=0});this.bellyUp=false}
  override dispose(){wearers.delete(this.wear);this.detachDetail();this.generated?.dispose();super.dispose()}
}

import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER, unityTorque } from '../core/physics'
import { defineParam } from '../../shared/params'
import { defaultPreset, definePresets } from '../../shared/presets'
import { atmosphereValue } from '../world/weather/params'
import { Vehicle } from './Vehicle'
import { GameJet } from './jetgen/GameJet'

export const jetHoverDrag = defineParam({id:'jet.hoverDrag',label:'Hover drag',group:'Jet',scope:'world',default:.01,min:.005,max:.015,step:.0001})
/**
 * Flight drag, the original's per-step coefficient (VhiclJet.cs 195: a velocity change of
 * -v * drag * density every physics step). It sets the top speed: at sea level full thrust
 * (2 x weight) balances it at about 19.4 / (drag * 1.225 * 50) m/s, half thrust at half that.
 * Syn3h shipped 0.0001 (about 3 km/s: no practical limit), Mars Explorer 0.001 (about 320 m/s).
 * The default puts full throttle near 110 m/s and hands-off half throttle near 55.
 */
export const jetDrag = defineParam({id:'jet.drag',label:'Flight drag',group:'Jet',scope:'world',default:.0029,min:.0001,max:.01,step:.0001})
export const jetSteer = defineParam({id:'jet.steer',label:'Steering',group:'Jet',scope:'world',default:20,min:5,max:35,step:1})
export const jetLift = defineParam({id:'jet.lift',label:'Lift',group:'Jet',scope:'world',default:.5,min:.1,max:.9,step:.01})
/**
 * Pitch and roll authority of the reaction thrusters in a vacuum, in the units of the control
 * surfaces' authority (which reach about 0.86 at the stall speed at sea level). Scaled by the
 * share of air missing, so they do nothing on an Earthlike world.
 */
const JET_THRUSTER_AUTHORITY=.85
/**
 * The angles of attack (radians) the weathervane leaves alone in pitch: the flow up to this far
 * above the nose (the original's lift coefficient saturates at 0.3) or this far below it.
 */
const JET_LIFT_BAND_ABOVE=.3
const JET_LIFT_BAND_BELOW=.05
export const jetStall = defineParam({id:'jet.stall',label:'Stall speed',group:'Jet',scope:'world',default:20,min:1,max:39,step:1})
// Digital keys otherwise demand a near-loop from a half-second tap in the full-size port.
export const jetControlResponse = defineParam({id:'jet.controlResponse',label:'Control response',group:'Jet',scope:'world',default:.3,min:.1,max:1,step:.05})
// Not in Mira: its Throttle axis was momentary (VhiclMe.cs 16), so keyboard hover was climb or fall.
// 0 is the original; 1 holds altitude when no throttle key is down. On by default: the owner chose it for the demo.
export const jetHoverHold = defineParam<number>({id:'jet.hoverHold',label:'Hover altitude hold',group:'Jet',scope:'world',default:1,min:0,max:1,step:.05})
// terra.jet.prefab flightThrustFactor=2: full throttle pushes at twice the jet's weight, and
// Mira's drag barely opposes it, so speed keeps building. Lower this for a slower jet.
export const jetFlightThrust = defineParam<number>({id:'jet.flightThrust',label:'Flight thrust',group:'Jet',scope:'world',default:2,min:.25,max:3,step:.05})
export const jetNeutralThrottle = defineParam<number>({id:'jet.neutralThrottle',label:'Neutral flight throttle',group:'Jet',scope:'world',default:.5,min:0,max:1,step:.05})
/**
 * Stability (not in the original, whose sideslip block VhiclJet.cs 185-189 is commented out).
 * Each scales with airspeed and air density, like the control surfaces, and each can go to 0
 * for the original's raw behaviour. Units are torque per unit of error per kilogram at full
 * authority.
 *  - weathervane: turns the nose into the airflow (yaw and pitch toward the velocity), so the
 *    jet cannot settle flying tail-first and a stalled jet recovers.
 *  - pitch and roll damping: oppose pitch and roll rates, so a held stick makes a steady loop
 *    or roll rather than a run-away tumble.
 *  - roll level: brings the wings level when no roll is held.
 *  - turn yaw: the rudder A and D add to their roll, for a coordinated turn.
 */
export const jetWeathervane = defineParam<number>({id:'jet.weathervane',label:'Weathervane',group:'Jet',scope:'world',default:6,min:0,max:20,step:.5})
export const jetPitchDamping = defineParam<number>({id:'jet.pitchDamping',label:'Pitch damping',group:'Jet',scope:'world',default:3,min:0,max:10,step:.25})
export const jetRollDamping = defineParam<number>({id:'jet.rollDamping',label:'Roll damping',group:'Jet',scope:'world',default:2,min:0,max:10,step:.25})
export const jetRollLevel = defineParam<number>({id:'jet.rollLevel',label:'Roll levelling',group:'Jet',scope:'world',default:1.5,min:0,max:6,step:.25})
export const jetTurnYaw = defineParam<number>({id:'jet.turnYaw',label:'Coordinated turn yaw',group:'Jet',scope:'world',default:1,min:0,max:4,step:.1})
/**
 * Entering flight below flying speed: the hover lift fades out as airspeed rises to this share
 * of the stall speed, and vertical speed is damped meanwhile, so switching to flight while
 * climbing or hovering does not leave the jet stalled and tumbling. 0 is the original's sudden
 * handover.
 */
export const jetHandover = defineParam<number>({id:'jet.handover',label:'Flight handover lift',group:'Jet',scope:'world',default:1.3,min:0,max:2,step:.05})
/**
 * Q in hover: a controlled descent at up to this sink rate (m/s), never a driven dive. The
 * original's Q set hover lift to zero (VhiclMe.cs 18-21: throttle (axis + 1) / 2), a free fall;
 * this port had made it push down at twice the jet's weight.
 */
export const jetDescentRate = defineParam<number>({id:'jet.descentRate',label:'Hover descent rate',group:'Jet',scope:'world',default:8,min:1,max:30,step:.5})
// How far the main nozzle swivels, as a share of VhiclJet.cs 161-162 (20 degrees of pitch at a
// standstill, easing to 5 at speed). Below stall speed the wings have little authority, so this
// is what steers the jet there. It is separate from jet.controlResponse, which only scales the
// aerodynamic control torques.
export const jetVectorResponse = defineParam<number>({id:'jet.vectorResponse',label:'Thrust vectoring',group:'Jet',scope:'world',default:.3,min:.1,max:1,step:.05})
/** Handling presets for the Jet's Handling dropdown. Default is the settings above. */
const JET_HANDLING = ['jet.steer', 'jet.controlResponse', 'jet.vectorResponse', 'jet.stall', 'jet.lift', 'jet.flightThrust']
export const JET_PRESETS = definePresets('Jet', [
  defaultPreset(JET_HANDLING, 'Default', 'The standard jet.'),
  { name: 'Gentle', description: 'Softer controls and a lower stall speed: easier to fly slowly and to keep level, and slower in a straight line.', values: { 'jet.steer': 14, 'jet.controlResponse': 0.2, 'jet.vectorResponse': 0.2, 'jet.stall': 14, 'jet.lift': 0.6, 'jet.flightThrust': 1.5 } },
  { name: 'Sharp', description: 'Quick controls, strong thrust vectoring and more thrust: it snaps round and climbs hard, and stalls a little sooner.', values: { 'jet.steer': 28, 'jet.controlResponse': 0.5, 'jet.vectorResponse': 0.6, 'jet.stall': 22, 'jet.lift': 0.5, 'jet.flightThrust': 2.5 } },
])
/**
 * Q and E work the jet's lift and thrust axis: lift and lower in hover mode, more and less
 * forward thrust in flight mode, the same axis R and F drive. 1 is E up and Q down, matching the
 * roam camera; -1 swaps them. The owner asked for these keys on 15 November 2026.
 */
export const JET_LIFT_KEYS: 1 | -1 = 1
const clamp = THREE.MathUtils.clamp
const lerp = (a:number,b:number,t:number)=>THREE.MathUtils.lerp(a,b,clamp(t,0,1))
const hullVertices = new Float32Array([-1.086619, -0.316382, -1.978747, 0.0, 0.543169, -2.110775, 0.0, -0.324233, -3.398361, 0.0, 0.482615, 1.50864, -3.851598, 0.125607, 1.143191, 0.0, -0.589476, -2.522558, 0.0, -0.636839, 0.479384, 0.0, -0.166176, 2.98234, -2.551439, 0.855675, 3.431675, 1.086619, -0.316382, -1.978747, 3.851598, 0.125607, 1.143191, 2.551439, 0.855675, 3.431675])
const nozzlePosition = new THREE.Vector3(0,0,2.971839)

/** Mira VhiclJet.cs 84-211, terra.jet.prefab and CoreSettings.cs 52-56. */
export class Jet extends Vehicle {
  readonly kind = 'jet' as const
  readonly camOffset = 5
  readonly ridePosition = new THREE.Object3D()
  private readonly model: GameJet
  private gearAmount = 0
  /** The gear amount the collider was last synchronized to. It starts disabled. */
  private colliderGear = 0
  /** Keep altitude hold off after materialization until gear contact or positive lift input. */
  private holdReleased = false
  private freshHoldRelease = false
  releaseHoverHold():void {this.holdReleased=true;this.freshHoldRelease=true}
  private gearHasContact():boolean {
    let touching=false
    this.game.world.contactPairsWith(this.gearCollider,other=>{
      this.game.world.contactPair(this.gearCollider,other,manifold=>{
        if(Math.abs(manifold.normal().y)<.5)return
        for(let i=0;i<manifold.numSolverContacts();i++){
          if(manifold.solverContactDist(i)<=.02)touching=true
        }
      })
    })
    return touching
  }
  private readonly gearCollider: RAPIER.Collider
  private readonly smoothed = new THREE.Vector4()
  private vectorPitch = 0
  private vectorYaw = 0
  /** Stick deflection shown on the tail ring's control surfaces: pitch, roll, yaw. */
  private readonly controls = new THREE.Vector3()
  readonly modelReady = Promise.resolve()
  /**
   * The thrust the HUD shows, -1 to 1: in flight the throttle actually applied (0 to 1, never
   * reverse; 0 with the brakes on); in hover the lift axis (Q below zero is the descent).
   */
  get thrustReadout(): number {
    return this.hoverMode?clamp(this.input.z,-1,1):this.input.brakes?0:clamp(this.input.z,0,1)
  }
  /** Input defaults false, so false means the original startup hover mode. */
  get hoverMode(): boolean {return !this.input.special}
  atmosDensity = 1.225
  stallFactor = 1

  constructor(game:Game,terrain:Terrain,position:THREE.Vector3,heading=0) {
    super(game,terrain,position,heading)
    this.object.add(this.ridePosition)
    // Prefab MeshCollider uses the original convex Collider mesh at Y=-.1.
    const hull=RAPIER.ColliderDesc.convexHull(hullVertices)
    if(!hull) throw new Error('Invalid Mira jet collider')
    const collider=this.game.world.createCollider(hull.setMass(200).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    this.body.recomputeMassPropertiesFromColliders()
    const inertia=new THREE.Vector3().copy(this.body.principalInertia()).multiplyScalar(.75)
    const inertiaFrame=this.body.principalInertiaLocalFrame()
    collider.setDensity(0)
    this.body.setAdditionalMassProperties(200,{x:0,y:0,z:0},inertia,inertiaFrame,true)
    this.body.recomputeMassPropertiesFromColliders()
    // The prefab's landing-gear cube is 3.5 x 1 x 3.5, under the animated gear transform.
    this.gearCollider=this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(1.75,.5,1.75).setTranslation(0,-.783,-.3).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    this.gearCollider.setEnabled(false)
    this.model = new GameJet()
    this.object.add(this.model.object)
    this.ridePosition.position.copy(this.model.eye)
    this.object.userData.cockpit = true
    // The Mk2 owns its fitted tail lights; the shared lamp positions float beside its cockpit.
    this.object.userData.ownLamps = true
    this.model.attach()
    this.applyColors()
  }

  /**
   * For the player's own jet, Q and E are lift and thrust, not yaw. The shared input puts those
   * keys on the yaw axis (w), which a gamepad's right stick and the bot pilot also use, so the
   * keys are read directly and their yaw is taken back out. The input is rewritten in place:
   * what is sent to other players is then what this jet flew.
   */
  private liftKeys():void {
    const held=(this.game.input as {held?:(code:string)=>boolean}).held
    if(!held) return
    const up=held.call(this.game.input,'KeyE'),down=held.call(this.game.input,'KeyQ')
    if(!up&&!down) return
    // With either key down the shared yaw axis holds only their value, never the gamepad's.
    this.input.w=0
    this.input.z=clamp(this.input.z+JET_LIFT_KEYS*((up?1:0)-(down?1:0)),-1,1)
  }

  /** Resolve the human's neutral command before smoothing and replication. Pilots own theirs. */
  private neutralThrottle():void {
    if(!this.hoverMode&&this.input.z>0&&!this.object.userData.materializing)this.holdReleased=false
    if(!this.isLocal||this.hoverMode||this.zorbed||this.input.z!==0||this.input.brakes||
      this.game.input.suspended||this.object.userData.autopilot||this.object.userData.materializing||
      this.body.isKinematic()||this.holdReleased)return
    // Opposing held throttle keys mean an intentional zero, not hands off.
    if(['KeyQ','KeyE','KeyR','KeyF'].some(code=>this.game.input.held?.(code)))return
    const p=this.body.translation()
    // Keep a newly spawned or just-landed jet planted, including before contact data is ready.
    if(p.y-this.terrain.heightAt(p.x,p.z)<=2.6)return
    let grounded=false
    for(let i=0;i<this.body.numColliders();i++){
      const collider=this.body.collider(i)
      this.game.world.contactPairsWith(collider,other=>{
        this.game.world.contactPair(collider,other,manifold=>{
          if(Math.abs(manifold.normal().y)<.5)return
          for(let j=0;j<manifold.numSolverContacts();j++){
            if(manifold.solverContactDist(j)<=.02)grounded=true
          }
        })
      })
    }
    if(!grounded)this.input.z=jetNeutralThrottle.value
  }

  protected applyForces(dt:number):void {
    if(this.isLocal) this.liftKeys()
    this.neutralThrottle()
    this.wingsOpen=!this.hoverMode
    // Vhicl.cs 269 smooths all four axes at fixedDeltaTime * 10.
    this.smoothed.lerp(new THREE.Vector4(this.input.x,this.input.y,this.input.z,this.input.w),Math.min(1,dt*10))
    const input=this.smoothed.clone()
    const vector=this.smoothed.clone().multiplyScalar(jetVectorResponse.value)
    // Keep source force equations; scale digital control authority for demo keyboard use.
    if(!this.hoverMode){input.x*=jetControlResponse.value;input.y*=jetControlResponse.value;input.w*=jetControlResponse.value}
    this.gearAmount=clamp(this.gearAmount+(this.hoverMode&&!this.zorbed?dt:-dt),0,1)
    // The materializer holds the body kinematically; observe its flag before returning.
    if(this.object.userData.materializing)this.releaseHoverHold()
    if(this.body.isKinematic()) return
    const q=new THREE.Quaternion().copy(this.body.rotation()), inv=q.clone().invert()
    const velocity=new THREE.Vector3().copy(this.body.linvel()), speed=velocity.length()
    const local=velocity.clone().applyQuaternion(inv), up=new THREE.Vector3(0,1,0).applyQuaternion(q)
    const position=new THREE.Vector3().copy(this.body.translation()), mass=this.body.mass()
    const weight=Math.max(0,-this.game.world.gravity.y)*mass
    const torque=(x:number,y:number,z:number)=>this.body.addTorque(new THREE.Vector3().copy(unityTorque(x,y,z)).applyQuaternion(q),true)
    let drag=0,angularDrag=3
    // Reshape the gear collider only while the gear moves. Replacing the shape every step made
    // Rapier rebuild a resting jet's ground contacts sixty times a second.
    if(this.gearAmount!==this.colliderGear){
      this.colliderGear=this.gearAmount
      this.gearCollider.setEnabled(this.gearAmount>0)
      if(this.gearAmount>0){
        this.gearCollider.setShape(new RAPIER.Cuboid(1.75*this.gearAmount,.5*this.gearAmount,1.75))
        this.gearCollider.setTranslationWrtParent({x:0,y:-.083-.7*this.gearAmount,z:-.3})
      }
    }
    if(this.hoverMode){
      this.vectorPitch = this.vectorYaw = 0
      // Not inside a zorb ball: the hold would thrust along the tumbling jet's up axis and carry
      // the ball off sideways or into the air. Manual throttle still works there.
      // Rapier contacts still describe the previous position on the first step after a teleport.
      if(this.holdReleased&&!this.object.userData.materializing&&(this.input.z>0||(!this.freshHoldRelease&&this.gearHasContact())))this.holdReleased=false
      this.freshHoldRelease=false
      if(this.input.z===0&&jetHoverHold.value>0&&!this.zorbed&&!this.holdReleased){
        // Half throttle balances weight (hoverThrustFactor 2); tilt and vertical speed correct it.
        const hold=clamp(.5/Math.max(.3,up.y)-velocity.y*.15,0,1)
        // Fade the hold out near the ground. A jet resting on its gear (hull about 1.3 m up)
        // must keep its weight, or it is frictionless and slides down any slope.
        const nearGround=clamp((position.y-this.terrain.heightAt(position.x,position.z)-1.6)/1,0,1)
        input.z=lerp(input.z,hold,jetHoverHold.value*nearGround);this.smoothed.z=input.z
      }
      // Q (lift below zero): a controlled descent toward jet.descentRate, never a push down.
      // Lift only reduces, from what balances weight toward none; the original's Q was none.
      // It engages on the held key (the raw input), not the smoothed value, which lingers below
      // zero for a moment after Q is released. Hover lift is never negative.
      if(this.input.z<0&&!this.zorbed){
        const sink=Math.max(-1,input.z)*jetDescentRate.value
        input.z=clamp(.5/Math.max(.3,up.y)-(velocity.y-sink)*.15,0,1)
      }
      input.z=Math.max(0,input.z)
      // terra.jet.prefab: hoverThrustFactor=2, hoverSteerFactor=4, hoverAngDrag=2.
      this.body.addForce(up.clone().multiplyScalar(input.z*2*weight),true)
      this.body.addTorque(up.clone().cross(new THREE.Vector3(0,1,0)).multiplyScalar(up.angleTo(new THREE.Vector3(0,1,0))*180/Math.PI*.2*mass),true)
      torque(input.y*mass*4,clamp(input.x+input.w,-1,1)*mass*4,-input.x*mass*4)
      drag=jetHoverDrag.value*speed*(this.input.brakes?7:1)
      angularDrag=this.input.brakes?10:2
    }else{
      // VhiclJet.cs 151-159 preserves the original clamped two-piece atmosphere and stall curves.
      // That curve is Earth's; the planet's own air (world.atmosphere, 0 vacuum to 1 Earthlike)
      // scales it, so lift, drag and control surfaces all fade out on an airless world.
      const air=clamp(atmosphereValue(),0,1)
      this.atmosDensity=(position.y<15240?lerp(1.225,.18756,position.y/15240):lerp(.18756,.017102,position.y/30480))*air
      const aoa=speed>1e-8?local.y/speed:0
      this.stallFactor=speed<jetStall.value?lerp(1,0,((speed-jetStall.value*.8)/jetStall.value)*10):clamp(Math.abs(aoa)-.65,0,.1)*10
      const thrustPitch=-vector.y*lerp(20,5,speed/(jetStall.value*5))*Math.PI/180
      const thrustYaw=(-vector.x+clamp(-local.x*(vector.w===0?1:.5),-10,10)-vector.w*15)*Math.PI/180
      // Mirror Unity's local quaternion: axial X and Y signs reverse in our frame.
      const thrustRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(-thrustPitch,-thrustYaw,0,'YXZ'))
      // Flight throttle is 0 to 1, as in the original (VhiclMe.cs 18-21, InputThrottle on the jet
      // prefab: (axis + 1) / 2). Q is idle, never reverse thrust: reversed, the jet slewed round
      // and flew on tail-first.
      const throttle=this.input.brakes?0:clamp(input.z,0,1)
      const thrust=new THREE.Vector3(0,0,-1).applyQuaternion(thrustRotation).applyQuaternion(q).multiplyScalar(throttle*jetFlightThrust.value*weight*.99)
      // The force equations stay original; only the four nozzle petals move visually.
      this.vectorPitch = thrustPitch; this.vectorYaw = -thrustYaw
      const nozzle=nozzlePosition.clone().applyQuaternion(q).add(position)
      this.body.addForceAtPoint(thrust,nozzle,true)
      // Control surfaces need air; reaction thrusters take over as it thins, so the jet still
      // pitches and rolls in a vacuum. They are off at full atmosphere: Earthlike flight is unchanged.
      // The original reversed the control surfaces when moving backwards (locvel.z > 0 ? 1 : -1);
      // with the jet flying tail-first that turned every input around. They act one way only.
      const airAuthority=lerp(0,1,speed/jetStall.value*.7)*this.atmosDensity
      const authority=airAuthority+(1-air)*JET_THRUSTER_AUTHORITY
      torque(input.y*mass*jetSteer.value*.2*authority,0,-input.x*mass*jetSteer.value*.75*authority)
      this.stabilise(local,speed,airAuthority,input.x,mass,weight,velocity,up,q,inv,throttle)
      if(this.stallFactor<1){
        // VhiclJet.cs 180 has an asymmetric negative-AoA clamp; preserve it for the port.
        const coefficient=aoa>0?-Math.min(.3,aoa):Math.max(-.3,-aoa)
        this.body.addForce(up.clone().multiplyScalar(jetLift.value*this.atmosDensity*local.z*local.z*15*coefficient*(1-this.stallFactor)),true)
      }
      if(this.stallFactor>=.5){
        const forward=new THREE.Vector3(0,0,-1).applyQuaternion(q)
        const angle=speed>1e-8?velocity.angleTo(forward)*180/Math.PI:0
        drag=speed*lerp(jetDrag.value,jetDrag.value*5,angle/90)*this.atmosDensity
      }else{
        // VhiclJet.cs 208 is VelocityChange, so it is deliberately not multiplied by dt.
        const dv=new THREE.Vector3(-local.x*3,-local.y*3,-local.z).multiplyScalar(jetDrag.value*this.atmosDensity*(this.input.brakes?5:1)).applyQuaternion(q)
        this.body.applyImpulse(dv.multiplyScalar(mass),true)
      }
    }
    // Mira VhiclJet.cs 213-232 comments out the old liquid buoyancy block.
    this.body.setLinvel(new THREE.Vector3().copy(this.body.linvel()).multiplyScalar(Math.max(0,1-drag*dt)),true)
    this.body.setAngvel(new THREE.Vector3().copy(this.body.angvel()).multiplyScalar(Math.max(0,1-angularDrag*dt)),true)
  }
  /**
   * Flight stability (see jetWeathervane and the params beside it): torques in the jet's own
   * frame, three.js axes (x right, y up, z back), and the low-speed handover support.
   */
  /**
   * The flight stability torque (see jetWeathervane and the params beside it) for the jet's
   * current state, in its own frame (three.js axes: x right, y up, z back), without the turn
   * yaw that follows a roll input. Public for the bot pilot, which subtracts it from the torque
   * it wants, as it already does for the hover mode's self-righting.
   */
  stabilityTorque(out=new THREE.Vector3()):THREE.Vector3 {
    out.set(0,0,0)
    const q=new THREE.Quaternion().copy(this.body.rotation()),inv=q.clone().invert()
    const local=new THREE.Vector3().copy(this.body.linvel()).applyQuaternion(inv),speed=local.length()
    const mass=this.body.mass(),density=this.atmosDensity/1.225
    const airAuthority=lerp(0,1,speed/jetStall.value*.7)*this.atmosDensity
    const w=new THREE.Vector3().copy(this.body.angvel()).applyQuaternion(inv)
    // Weathervane: nose toward the airflow. Pitch error is the flow's angle above the nose,
    // yaw error its angle to the right; both read the whole circle, so a tail-first jet turns
    // round. Stronger with airspeed (squared up to the stall speed). In pitch it leaves alone
    // the band of angle of attack the wings fly in (VhiclJet.cs 178: lift grows to 0.3), so
    // ordinary flight keeps its lift and only a stall or worse is pulled back.
    if(speed>1){
      const vane=jetWeathervane.value*mass*Math.min(1,(speed/jetStall.value)**2)*density
      const pitchError=Math.atan2(local.y,-local.z)
      out.x+=vane*(pitchError-clamp(pitchError,-JET_LIFT_BAND_BELOW,JET_LIFT_BAND_ABOVE))
      out.y-=vane*Math.atan2(local.x,-local.z)
    }
    // Rate damping, scaled like the control surfaces.
    out.x-=jetPitchDamping.value*mass*w.x*airAuthority
    out.z-=jetRollDamping.value*mass*w.z*airAuthority
    // Wings level when no roll is held: right wing up (right.y > 0) rolls back down.
    if(Math.abs(this.smoothed.x*jetControlResponse.value)<.05){
      const right=new THREE.Vector3(1,0,0).applyQuaternion(q)
      out.z-=jetRollLevel.value*mass*right.y*airAuthority
    }
    return out
  }

  private stabilise(local:THREE.Vector3,speed:number,airAuthority:number,rollInput:number,mass:number,weight:number,
    velocity:THREE.Vector3,up:THREE.Vector3,q:THREE.Quaternion,_inv:THREE.Quaternion,throttle:number):void {
    const t=this.stabilityTorque()
    // Coordinated turn: A and D also yaw the way they roll (rollInput > 0 rolls right).
    t.y-=rollInput*mass*jetSteer.value*.2*jetTurnYaw.value*airAuthority
    this.body.addTorque(t.applyQuaternion(q),true)
    // Handover: below flying speed (forward airspeed against jet.handover x stall speed) hover
    // lift carries the weight, vertical speed is damped and the jet is held level, fading out as
    // the wings take over. Only under power: with the throttle closed (a jet parked in flight
    // mode, or one gliding down) there is no lift to hand over, so it settles or sinks.
    if(jetHandover.value>0){
      const forward=Math.max(0,-local.z)
      const k=clamp(1-forward/(jetStall.value*jetHandover.value),0,1)*clamp(throttle/.5,0,1)
      if(k>0){
        this.body.addForce({x:0,y:k*(weight-velocity.y*mass*1.5),z:0},true)
        const level=new THREE.Vector3(0,1,0)
        this.body.addTorque(up.clone().cross(level).multiplyScalar(up.angleTo(level)*180/Math.PI*.2*mass*k),true)
      }
    }
  }
  override update(dt:number,alpha:number):void {
    super.update(dt,alpha)
    // Visual only: the ring's surfaces follow the smoothed stick in both modes, signed like the
    // nozzle petals. Pulling back (y below 0) is nose up; x is roll right; w is yaw right.
    this.controls.set(-this.smoothed.y, this.smoothed.x, this.smoothed.w)
    this.model.update(this.gearAmount, this.vectorPitch, this.vectorYaw, Math.max(0, this.smoothed.z), this.controls, this.hoverMode)
    // A ball carries its vehicle; even idle thrust must stay dark inside it.
    this.model.plume.mesh.visible = !this.zorbed
  }
  /** The existing gear batch and plume can be submitted even when gameplay hides them. */
  drawCoveredGear(deploy: boolean, draw: () => void): void {
    const near = this.model.near
    const gear = near.gear, plume = this.model.plume.mesh
    const bodyVisible = near.object.visible, gearVisible = gear.visible, plumeVisible = plume.visible
    try {
      if (deploy) near.setGear(1)
      near.object.visible = gear.visible = plume.visible = true
      draw()
    } finally {
      try {
        if (deploy) near.setGear(this.gearAmount)
      } finally {
        near.object.visible = bodyVisible
        gear.visible = gearVisible
        plume.visible = plumeVisible
      }
    }
  }

  protected override applyColors():void {
    this.model?.setColors(this.colors.body, this.colors.accent)
  }
  override teleport(position:THREE.Vector3,heading=0):void {super.teleport(position,heading);this.smoothed.set(0,0,0,0)}
  /** A fresh jet: gear as built and any altitude-hold release from an earlier arrival forgotten. */
  override resetForWorld():void {
    super.resetForWorld()
    this.gearAmount = 0
    this.gearCollider.setEnabled(false)
    this.colliderGear = 0
    this.holdReleased = this.freshHoldRelease = false
    this.smoothed.set(0, 0, 0, 0)
    this.controls.set(0, 0, 0)
    this.vectorPitch = this.vectorYaw = 0
    this.wingsOpen = false
    this.atmosDensity = 1.225
    this.stallFactor = 1
    this.model.resetPose()
  }
  override dispose():void {
    this.model.dispose()
    super.dispose()
  }
}

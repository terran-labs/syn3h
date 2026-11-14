import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER } from '../core/physics'
import { defineParam } from '../../shared/params'
import { Vehicle } from './Vehicle'
import { VehicleModel } from './skins/VehicleModel'

export const tankPower=defineParam({id:'tank.power',label:'Power',group:'Tank',scope:'world',default:2000,min:500,max:3500,step:10})
export const tankSpeed=defineParam({id:'tank.speed',label:'Speed',group:'Tank',scope:'world',default:25,min:10,max:40,step:.1})
export const tankGrip=defineParam({id:'tank.grip',label:'Grip',group:'Tank',scope:'world',default:.1,min:0,max:.2,step:.01})
export const tankCG=defineParam({id:'tank.cg',label:'Centre of gravity',group:'Tank',scope:'world',default:-.2,min:-1.4,max:1,step:.01})

/** Mars Explorer fallback. No tank exists in the supplied Syn3h snapshots. */
export class Tank extends Vehicle {
  readonly kind = 'tank' as const
  private readonly treadMaps:THREE.Texture[]=[]
  private readonly models: VehicleModel[]=[]
  readonly modelReady:Promise<void>
  private readonly motors=Array.from({length:6},()=>({speed:0,velocity:0}))
  private readonly tracks:THREE.Group[]=[]
  private readonly shape=new RAPIER.Cuboid(.45,.3,1)
  private cg=NaN
  private bellyUp=false
  groundedTracks=0
  constructor(game:Game,terrain:Terrain,position:THREE.Vector3,heading=0){
    super(game,terrain,position,heading)
    // Tank.prefab Cube: size 2.5x1.5x5, centre Y=1. Track masses are folded into the hull.
    game.world.createCollider(RAPIER.ColliderDesc.cuboid(1.25,.75,2.5).setTranslation(0,1,0).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    this.setMass()
    const hull=new THREE.Group();this.object.add(hull)
    this.models.push(new VehicleModel(hull,'/models/tank.glb',scene=>{
      scene.rotation.x=Math.PI/2;scene.position.y=.8
      scene.traverse(o=>{if(o instanceof THREE.Mesh){
        if(o.name==='Mesh003'){o.visible=false;return} // Duplicate hull export.
        o.material.dispose();o.material=new THREE.MeshPhysicalMaterial({color:o.name==='Mesh001'?0x613581:0x386789,metalness:.65,roughness:.3,clearcoat:1})
      }})
    }))
    // Tank.js 14-32: three segments per side at X +/-2 and Z +/-2.5,0.
    for(let i=0;i<6;i++){
      const track=new THREE.Group();track.position.set(i%2?2:-2,0,(Math.floor(i/2)-1)*2.5)
      this.object.add(track);this.tracks.push(track)
      this.models.push(new VehicleModel(track,'/models/tanktread.glb',scene=>{
        scene.rotation.x=Math.PI/2;scene.updateMatrixWorld(true)
        const box=new THREE.Box3().setFromObject(scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3())
        const wrapper=new THREE.Group();while(scene.children.length)wrapper.add(scene.children[0])
        wrapper.rotation.copy(scene.rotation);scene.rotation.set(0,0,0);scene.add(wrapper)
        wrapper.scale.set(1/size.x,2.2/size.z,.9/size.y)
        wrapper.position.set(-center.x/size.x,-center.y*.9/size.y,-center.z*2.2/size.z)
        wrapper.traverse(o=>{if(o instanceof THREE.Mesh){o.material.dispose();const mat=new THREE.MeshStandardMaterial({color:0x343940,metalness:.6,roughness:.55});o.material=mat
          if(o.name==='Mesh001'){const map=new THREE.TextureLoader().load('/models/textures/tank-track.png');map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;mat.map=map;this.treadMaps[i]=map}}})
      }))
    }
    this.modelReady=Promise.all(this.models.map(m=>m.ready)).then(()=>{})
  }
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
    if(this.body.isKinematic())return
    if(this.cg!==tankCG.value)this.setMass()
    const q=new THREE.Quaternion().copy(this.body.rotation()),inv=q.clone().invert(),position=new THREE.Vector3().copy(this.body.translation())
    const up=new THREE.Vector3(0,1,0).applyQuaternion(q),right=new THREE.Vector3(1,0,0).applyQuaternion(q),down=up.clone().negate()
    const velocity=new THREE.Vector3().copy(this.body.linvel()),speed=velocity.length()
    const parked=this.input.brakes&&speed<3
    // TankMe.js 7-19: stationary braking differs from the ordinary .01 drag and 2 angular drag.
    if(parked){this.body.setLinvel({x:0,y:0,z:0},true);this.body.setAngvel({x:0,y:0,z:0},true)}
    else{this.body.setLinvel(velocity.multiplyScalar(Math.max(0,1-.01*dt)),true);this.body.setAngvel(new THREE.Vector3().copy(this.body.angvel()).multiplyScalar(Math.max(0,1-2*dt)),true)}
    this.groundedTracks=0
    for(let i=0;i<6;i++){
      const local=new THREE.Vector3(i%2?2:-2,.5,(Math.floor(i/2)-1)*2.5),origin=local.clone().applyQuaternion(q).add(position)
      const hit=this.game.world.castShape(origin,q,down,this.shape,0,1.2,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,this.body)
      if(!hit){this.tracks[i].position.y=-.4;continue}
      const normal=new THREE.Vector3().copy(hit.normal1).normalize()
      if(normal.dot(up)<.1)continue
      this.groundedTracks++
      const point=new THREE.Vector3().copy(hit.witness1),pointVelocity=new THREE.Vector3().copy(this.body.velocityAtPoint(point)),v=pointVelocity.clone().applyQuaternion(inv).clampLength(0,1000)
      this.tracks[i].position.y=.5-hit.time_of_impact
      // TankTrack.js 57-60 scrolls the original tread texture with local ground speed.
      if(this.treadMaps[i])this.treadMaps[i].offset.y=(this.treadMaps[i].offset.y+dt*v.z*1.2)%1
      // Replaces joint/contact support with a damped spring. Force formula below stays original.
      const support=Math.max(0,(1.2-hit.time_of_impact)*4000-pointVelocity.dot(normal)*450)
      this.body.addForceAtPoint(normal.clone().multiplyScalar(support),point,true)
      if(parked&&!this.input.y)continue
      const motor=this.motor(i,-v.z,dt),forward=normal.clone().cross(right).normalize(),side=forward.clone().cross(normal).normalize()
      // TankTrack.js 102-109: sideways150, rolling50, lift10, raised application point.
      const force=side.multiplyScalar(-v.x*150).addScaledVector(normal,10).addScaledVector(forward,Math.abs(motor)>.1?motor:v.z*50)
      const application=point.clone().addScaledVector(up,tankGrip.value)
      this.body.addForceAtPoint(force,application,true)
    }
    this.wheelsGrounded=this.groundedTracks
    // TankMe.js 26-40: recovery only when the overturned hull touches terrain.
    if(up.y>Math.cos(35*Math.PI/180))this.bellyUp=false
    if(up.y<Math.cos(130*Math.PI/180)&&speed*speed<20&&new THREE.Vector3().copy(this.body.angvel()).lengthSq()<5){
      const hit=this.game.world.castRay(new RAPIER.Ray(position,{x:0,y:-1,z:0}),1.8,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,this.body)
      if(hit)this.bellyUp=true
    }
    if(this.bellyUp){
      this.body.addForce({x:0,y:5000,z:0},true)
      const axis=up.clone().cross(new THREE.Vector3(0,1,0));if(axis.lengthSq()<1e-6)axis.set(1,0,0)
      // Bound the original acceleration torque to avoid one-step flips with a single rigid body.
      this.body.addTorque(axis.multiplyScalar(20000),true)
    }
  }
  override teleport(position:THREE.Vector3,heading=0){super.teleport(position,heading);this.motors.forEach(m=>{m.speed=m.velocity=0});this.bellyUp=false}
  override dispose(){this.treadMaps.forEach(t=>t.dispose());this.models.forEach(m=>m.dispose());super.dispose()}
}

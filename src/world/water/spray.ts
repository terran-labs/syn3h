import * as T from 'three/webgpu'
import { defineParam } from '../../../shared/params'
import { ParticleBatch } from '../../vehicles/effects/ParticleBatch'
import { RibbonBatch } from '../../vehicles/effects/RibbonBatch'
import { applyCurve } from '../curve'
import type { Ripples } from './ripples'
import { emission } from './sprayMath'
export const waterSpray=defineParam<boolean>({id:'water.spray',label:'Spray and wakes',group:'Water',scope:'client',default:false})
interface State {submerged:number;carry:number;last:T.Vector3;seen:number}
/** Call update once, then vehicle for each wet or recently wet vehicle each frame. */
export class Spray {
  private particles:ParticleBatch|null=null
  private ribbons:RibbonBatch|null=null
  private map:T.DataTexture|null=null
  private states=new Map<string,State>()
  private time=0
  private white=new T.Color(.75,.94,1)
  constructor(private scene:T.Scene,private ripples:Ripples){}
  private allocate(){
    this.map=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);this.map.needsUpdate=true
    this.particles=new ParticleBatch(2048,this.map);this.ribbons=new RibbonBatch(2048)
    for(const mesh of [this.particles.mesh,this.ribbons.mesh]){applyCurve(mesh.material);this.scene.add(mesh)}
  }
  update(dt:number){
    this.time+=Math.max(0,dt)
    if(!waterSpray.value){this.dispose();return}
    if(!this.particles)this.allocate()
    this.particles!.clock.value=this.ribbons!.clock.value=this.time
    for(const [id,s] of this.states)if(this.time-s.seen>8)this.states.delete(id)
  }
  vehicle(id:string,position:T.Vector3,velocity:T.Vector3,submergedFraction:number,dt:number){
    if(!waterSpray.value)return
    if(!this.particles)this.allocate()
    const sub=Math.max(0,Math.min(1,submergedFraction)), speed=Math.hypot(velocity.x,velocity.z)
    let s=this.states.get(id)
    if(!s){s={submerged:0,carry:0,last:position.clone(),seen:this.time};this.states.set(id,s)}
    const entering=sub-s.submerged>.2
    const e=emission(speed,sub,dt,s.carry);s.carry=e.carry
    const direction=new T.Vector3(velocity.x,0,velocity.z).normalize(),side=new T.Vector3(-direction.z,0,direction.x)
    const n=e.count+(entering?24:0)
    for(let i=0;i<n;i++){
      const sign=i%2?1:-1, spread=.5+Math.random()*1.5
      const p=position.clone().addScaledVector(side,sign).addScaledVector(direction,1)
      const v=side.clone().multiplyScalar(sign*spread).addScaledVector(direction,speed*.15);v.y=entering?2+Math.random()*3:.5+speed*.08
      this.particles!.emit(p,v,.35+Math.random()*.4,.12,.3,this.white)
    }
    if(sub>0&&speed>1){
      this.ripples.disturb(position.x,position.z,1.5,Math.min(.15,speed*.004)*Math.min(.1,Math.max(0,dt))*60)
      if(s.last.distanceToSquared(position)<400){
        const trail=position.clone().addScaledVector(direction,-Math.min(5,speed*.3))
        for(const sign of [-1,1])this.ribbons!.add(position,trail.clone().addScaledVector(side,sign*2),side,.5,3,.35,this.white)
      }
    }
    if(entering)this.ripples.disturb(position.x,position.z,2,Math.min(.5,Math.abs(velocity.y)*.05+.1))
    s.submerged=sub;s.last.copy(position);s.seen=this.time
  }
  dispose(){this.particles?.dispose();this.ribbons?.dispose();this.map?.dispose();this.particles=null;this.ribbons=null;this.map=null;this.states.clear()}
}

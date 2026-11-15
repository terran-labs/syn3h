import {hotExposureNode} from './hotExposure'
import * as T from 'three/webgpu'
import {attribute,float,smoothstep,uniform,uv,vec2,vec3} from 'three/tsl'

/** Vehicle-local gravity for spark arcs, m/s². */
const GRAVITY = 6

/**
 * One additive billboard batch per vehicle for the hub motors: a fixed set of halo slots that
 * sit on the rotor/stator interface points and follow the motor effort every frame, plus a
 * ring of short lived sparks. Everything is generated in the shader (round falloff, ballistic
 * arc, fade), so there is no texture and no per-frame allocation. One draw call, and none at
 * all while the motors are idle because the mesh hides itself.
 */
export class MotorSparks {
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.SpriteNodeMaterial>
  readonly clock=uniform(0)
  private next=0
  private readonly origin:T.InstancedBufferAttribute
  private readonly velocity:T.InstancedBufferAttribute
  /** birth time, life, size, kind (0 spark, 1 halo). */
  private readonly info:T.InstancedBufferAttribute
  private readonly tint:T.InstancedBufferAttribute
  /** Clock time after which no emitted spark is still alive. */
  private sparksUntil=-1
  private halosLit=false

  constructor(readonly halos:number,readonly sparks:number){
    const capacity=halos+sparks
    const plane=new T.PlaneGeometry(1,1),g=new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry);plane.dispose();g.instanceCount=capacity
    const make=(n:number)=>new T.InstancedBufferAttribute(new Float32Array(capacity*n),n).setUsage(T.DynamicDrawUsage)
    this.origin=make(3);this.velocity=make(3);this.info=make(4);this.tint=make(3)
    for(let i=0;i<capacity;i++)this.info.setXYZW(i,-1e4,1,0,i<halos?1:0)
    g.setAttribute('sparkOrigin',this.origin);g.setAttribute('sparkVelocity',this.velocity);g.setAttribute('sparkInfo',this.info);g.setAttribute('sparkTint',this.tint)
    const info=attribute('sparkInfo','vec4'),halo=info.w,spark=float(1).sub(halo)
    const age=this.clock.sub(info.x).max(0),unit=age.div(info.y).clamp(0,1)
    const alive=halo.max(this.clock.sub(info.x).greaterThanEqual(0).and(age.lessThan(info.y)).select(1,0))
    const m=new T.SpriteNodeMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending})
    m.fog=false
    // Halos stay put; sparks fly out along their launch velocity and fall in the vehicle frame.
    m.positionNode=attribute('sparkOrigin','vec3').add(attribute('sparkVelocity','vec3').mul(age).add(vec3(0,-GRAVITY*.5,0).mul(age.mul(age))).mul(spark))
    const size=info.z.mul(float(1).sub(unit.mul(.6).mul(spark)))
    m.scaleNode=vec2(size,size)
    const r=uv().sub(.5).length().mul(2)
    // A hard white core for sparks, a soft wide falloff for the halo.
    const falloff=halo.greaterThan(.5).select(float(1).sub(r).clamp(0,1).pow(2.5),float(1).sub(smoothstep(.2,1,r)).pow(2))
    m.colorNode=attribute('sparkTint','vec3').mul(hotExposureNode())
    m.opacityNode=falloff.mul(alive).mul(float(1).sub(unit.mul(spark)))
    this.mesh=new T.Mesh(g,m);this.mesh.name='Motor sparks';this.mesh.frustumCulled=false;this.mesh.renderOrder=4;this.mesh.visible=false
  }

  /** Place halo `i`; a zero size or black tint turns it off. */
  setHalo(i:number,x:number,y:number,z:number,size:number,r:number,g:number,b:number):void {
    this.origin.setXYZ(i,x,y,z);this.info.setZ(i,size);this.tint.setXYZ(i,r,g,b)
    if(size>0&&r+g+b>0)this.halosLit=true
  }

  emit(x:number,y:number,z:number,vx:number,vy:number,vz:number,life:number,size:number,r:number,g:number,b:number):void {
    const i=this.halos+this.next;this.next=(this.next+1)%this.sparks
    this.origin.setXYZ(i,x,y,z);this.velocity.setXYZ(i,vx,vy,vz)
    this.info.setXYZW(i,this.clock.value,life,size,0);this.tint.setXYZ(i,r,g,b)
    this.sparksUntil=Math.max(this.sparksUntil,this.clock.value+life)
  }

  /** Call once per frame after the halos and emissions. The buffers are small (under 2 KB). */
  commit(time:number,allowed:boolean):void {
    this.clock.value=time
    const active=allowed&&(this.halosLit||time<this.sparksUntil)
    this.mesh.visible=active
    if(active)for(const a of [this.origin,this.velocity,this.info,this.tint])a.needsUpdate=true
    this.halosLit=false
  }
}

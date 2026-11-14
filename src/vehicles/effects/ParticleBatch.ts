import * as T from 'three/webgpu'
import {attribute,float,smoothstep,uniform,uv,vec2,texture} from 'three/tsl'

/** Birth records upload only on emission. Motion and fading run in the billboard shader. */
export class ParticleBatch {
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.SpriteNodeMaterial>
  readonly clock=uniform(0)
  private next=0
  private readonly origin:T.InstancedBufferAttribute
  private readonly velocity:T.InstancedBufferAttribute
  private readonly settings:T.InstancedBufferAttribute
  private readonly tint:T.InstancedBufferAttribute
  emitted=0
  constructor(readonly capacity:number,map:T.Texture,additive=false){
    const plane=new T.PlaneGeometry(1,1),g=new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry);plane.dispose();g.instanceCount=capacity
    this.origin=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage)
    this.velocity=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage)
    this.settings=new T.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(T.DynamicDrawUsage)
    this.tint=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage)
    for(let i=0;i<capacity;i++)this.settings.setXYZW(i,-10000,1,0,0)
    g.setAttribute('fxOrigin',this.origin);g.setAttribute('fxVelocity',this.velocity);g.setAttribute('fxSettings',this.settings);g.setAttribute('fxTint',this.tint)
    const cfg=attribute('fxSettings','vec4'),age=this.clock.sub(cfg.x),unit=age.div(cfg.y).clamp(0,1)
    const m=new T.SpriteNodeMaterial({map,transparent:true,depthWrite:false,blending:additive?T.AdditiveBlending:T.NormalBlending})
    m.positionNode=attribute('fxOrigin','vec3').add(attribute('fxVelocity','vec3').mul(age.max(0)))
    const size=cfg.z.add(cfg.w.mul(age.max(0))).max(0)
    m.scaleNode=vec2(size,size)
    m.colorNode=attribute('fxTint','vec3').mul(texture(map,uv()).rgb)
    // Original particle five-key alpha: near zero, .707, 1, .707, zero.
    m.opacityNode=texture(map,uv()).a.mul(unit.mul(Math.PI).sin().max(0).mul(age.greaterThanEqual(0).select(1,0)).mul(age.lessThan(cfg.y).select(1,0)).mul(additive?.8:.4).mul(float(1).sub(smoothstep(.42,.5,uv().sub(.5).length()))))
    this.mesh=new T.Mesh(g,m);this.mesh.frustumCulled=false;this.mesh.renderOrder=additive?4:3
  }
  emit(position:T.Vector3,velocity:T.Vector3,life:number,size:number,grow:number,color:T.Color){
    const i=this.next;this.next=(i+1)%this.capacity;this.emitted++
    this.origin.setXYZ(i,position.x,position.y,position.z);this.velocity.setXYZ(i,velocity.x,velocity.y,velocity.z)
    this.settings.setXYZW(i,this.clock.value,life,size,grow);this.tint.setXYZ(i,color.r,color.g,color.b)
    for(const [a,n] of [[this.origin,3],[this.velocity,3],[this.settings,4],[this.tint,3]] as const){a.addUpdateRange(i*n,n);a.needsUpdate=true}
  }
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose()}
}

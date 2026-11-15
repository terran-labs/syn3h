import {hotExposureNode} from '../skins/hotExposure'
import * as T from 'three/webgpu'
import {attribute,float,instanceIndex,smoothstep,uniform,uv,vec2} from 'three/tsl'
import {particleSeed,unlitShadeNode,type Sprite} from './sprites'

/**
 * Birth records upload only on emission. Motion, fading and the sprite itself run in the
 * billboard shader: `sprite` generates the look (see sprites.ts), so no image is loaded.
 * `octaves` is the sprite's noise detail; the owner rebuilds batches when graphics level changes.
 */
export class ParticleBatch {
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.SpriteNodeMaterial>
  readonly clock=uniform(0)
  private next=0
  private readonly origin:T.InstancedBufferAttribute
  private readonly velocity:T.InstancedBufferAttribute
  private readonly settings:T.InstancedBufferAttribute
  private readonly tint:T.InstancedBufferAttribute
  emitted=0
  /**
   * Share of the wind a particle is born with: dust takes most of it, exhaust less, sparks
   * none. The wind is sampled once, at the birth position, and added to the birth velocity,
   * so it costs one call per particle and nothing per frame; a particle keeps the wind it was
   * born into for its second or two of life and does not follow a later gust.
   */
  windShare=0
  /** Wind velocity in m/s at a world position (the weather system's `windDrift`). Set by the owner. */
  drift:((x:number,y:number,z:number,out:{x:number;y:number;z:number})=>unknown)|null=null
  private readonly gust={x:0,y:0,z:0}
  constructor(readonly capacity:number,sprite:Sprite,additive=false,octaves=2){
    const plane=new T.PlaneGeometry(1,1),g=new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry);plane.dispose();g.instanceCount=capacity
    this.origin=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage)
    this.velocity=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage)
    this.settings=new T.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(T.DynamicDrawUsage)
    this.tint=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage)
    for(let i=0;i<capacity;i++)this.settings.setXYZW(i,-10000,1,0,0)
    g.setAttribute('fxOrigin',this.origin);g.setAttribute('fxVelocity',this.velocity);g.setAttribute('fxSettings',this.settings);g.setAttribute('fxTint',this.tint)
    const cfg=attribute('fxSettings','vec4'),age=this.clock.sub(cfg.x),unit=age.div(cfg.y).clamp(0,1)
    const m=new T.SpriteNodeMaterial({transparent:true,depthWrite:false,blending:additive?T.AdditiveBlending:T.NormalBlending})
    m.positionNode=attribute('fxOrigin','vec3').add(attribute('fxVelocity','vec3').mul(age.max(0)))
    const size=cfg.z.add(cfg.w.mul(age.max(0))).max(0)
    m.scaleNode=vec2(size,size)
    const look=sprite(uv().mul(2).sub(1),particleSeed(cfg.x,float(instanceIndex)),age.max(0),octaves)
    m.colorNode=attribute('fxTint','vec3').mul(look.rgb)
    m.colorNode=m.colorNode.mul(additive?hotExposureNode():unlitShadeNode())
    // Original particle five-key alpha: near zero, .707, 1, .707, zero.
    m.opacityNode=look.alpha.mul(unit.mul(Math.PI).sin().max(0).mul(age.greaterThanEqual(0).select(1,0)).mul(age.lessThan(cfg.y).select(1,0)).mul(additive?.8:.4).mul(float(1).sub(smoothstep(.42,.5,uv().sub(.5).length()))))
    this.mesh=new T.Mesh(g,m);this.mesh.frustumCulled=false;this.mesh.renderOrder=additive?4:3
  }
  emit(position:T.Vector3,velocity:T.Vector3,life:number,size:number,grow:number,color:T.Color){
    const i=this.next;this.next=(i+1)%this.capacity;this.emitted++
    let vx=velocity.x,vz=velocity.z
    if(this.windShare>0&&this.drift){const g=this.gust;g.x=g.y=g.z=0;this.drift(position.x,position.y,position.z,g);if(Number.isFinite(g.x)&&Number.isFinite(g.z)){vx+=g.x*this.windShare;vz+=g.z*this.windShare}}
    this.origin.setXYZ(i,position.x,position.y,position.z);this.velocity.setXYZ(i,vx,velocity.y,vz)
    this.settings.setXYZW(i,this.clock.value,life,size,grow);this.tint.setXYZ(i,color.r,color.g,color.b)
    // Spelled out: a tuple list here allocated five arrays for every particle born.
    this.origin.addUpdateRange(i*3,3);this.origin.needsUpdate=true;this.velocity.addUpdateRange(i*3,3);this.velocity.needsUpdate=true
    this.settings.addUpdateRange(i*4,4);this.settings.needsUpdate=true;this.tint.addUpdateRange(i*3,3);this.tint.needsUpdate=true
  }
  /**
   * Move every stored birth position by (dx, dz), for a world seam: the world is redrawn one
   * tile over around the player, and particles already in the air must come too. The origins
   * are rewritten in place and the whole buffer uploads once; only the origin moves, since
   * velocities and timings do not depend on where the tile is. This was chosen over a single
   * offset uniform because a uniform would cost a vertex add on every frame forever and every
   * later emit would have to subtract the running offset; a shift is a rare event.
   */
  shift(dx:number,dz:number){
    const a=this.origin.array as Float32Array
    for(let i=0;i<a.length;i+=3){a[i]+=dx;a[i+2]+=dz}
    // One range over the whole buffer. Emits later this frame add their own small ranges, which
    // overlap it harmlessly; replacing it would upload only those and lose the shift.
    this.origin.clearUpdateRanges();this.origin.addUpdateRange(0,a.length);this.origin.needsUpdate=true
  }
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose()}
}

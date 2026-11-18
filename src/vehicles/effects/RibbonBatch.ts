import {hotExposureNode} from '../skins/hotExposure'
import * as T from 'three/webgpu'
import {attribute,float,positionView,smoothstep,uniform,uv,vec3} from 'three/tsl'
import {markEnvelope,markOpacity,nodeOps,unlitShadeNode,type MarkAlpha} from './sprites'

/** Run distance written where a mark has not ended (yet): far beyond any end fade. */
export const OPEN_END=1e4

/**
 * One global capped quad ring, after VhiclSkidmarks.cs 20-24, 96-195. Two uses:
 *
 * - Tyre marks (`mark` given, see `tyreMarkAlpha`): each quad carries its tone relative to the
 *   ground (a per channel ratio, below 1 darker), its tread depth and, per corner, its alpha,
 *   when it was laid and its distance from where the mark began and to where it ended. The
 *   shader turns those into soft edges, soft ends, an ease in behind the tyre (`markEnvelope`)
 *   and a gradual fade over the mark's life, scaled by the `strength`, `softness` and `fadeIn`
 *   uniforms. The result multiplies the lit ground already drawn (see the constructor), so a
 *   mark is always a shade of the ground under it. All per vertex values and arithmetic: one
 *   draw for every mark, no extra pass or target.
 * - Soft additive trails (no `mark`).
 *
 * Quads whose life is over are collapsed to nothing (`expire`), so they cost no fill, and the
 * ring starts again from empty once every quad has expired.
 */
export class RibbonBatch {
  readonly mesh:T.Mesh<T.BufferGeometry,T.MeshBasicNodeMaterial|T.MeshStandardNodeMaterial>
  readonly clock=uniform(0)
  /** Tyre marks: multiplies every alpha (markParams.ts). */
  readonly strength=uniform(1)
  /** Tyre marks: share of each side that fades to nothing. */
  readonly softness=uniform(.4)
  /** Tyre marks: seconds a newly laid stretch takes to ease in to full strength. */
  readonly fadeIn=uniform(.35)
  private cursor=0
  private count=0
  private live=0
  private oldest=0
  private serial=0
  private readonly expiry:Float64Array
  private readonly serials:Float64Array
  private readonly position:T.BufferAttribute
  private readonly data:T.BufferAttribute
  private readonly tint:T.BufferAttribute
  private readonly run:T.BufferAttribute
  private readonly normal:T.BufferAttribute
  /** Quads still visible. */
  get used(){return this.live}
  constructor(readonly capacity:number,mark?:MarkAlpha,additive=false,endFade=1){
    const g=new T.BufferGeometry(),positions=new Float32Array(capacity*12),uvs=new Float32Array(capacity*8),indices=new Uint32Array(capacity*6)
    for(let i=0;i<capacity;i++){uvs.set([0,0,1,0,0,1,1,1],i*8);indices.set([i*4,i*4+2,i*4+1,i*4+1,i*4+2,i*4+3],i*6)}
    this.expiry=new Float64Array(capacity);this.serials=new Float64Array(capacity)
    this.position=new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage)
    this.data=new T.BufferAttribute(new Float32Array(capacity*12),3).setUsage(T.DynamicDrawUsage)
    this.tint=new T.BufferAttribute(new Float32Array(capacity*16),4).setUsage(T.DynamicDrawUsage)
    this.run=new T.BufferAttribute(new Float32Array(capacity*8).fill(OPEN_END),2).setUsage(T.DynamicDrawUsage)
    this.normal=new T.BufferAttribute(new Float32Array(capacity*12),3).setUsage(T.DynamicDrawUsage)
    g.setAttribute('position',this.position);g.setAttribute('uv',new T.BufferAttribute(uvs,2));g.setAttribute('fxAge',this.data);g.setAttribute('fxColor',this.tint);g.setIndex(new T.BufferAttribute(indices,1));g.setDrawRange(0,0)
    if(mark){g.setAttribute('fxRun',this.run);g.setAttribute('normal',this.normal)}
    // Tyre marks multiply the picture already drawn: out = 2 x src x dst, so a shader colour
    // of 0.5 leaves the ground as it is, less darkens it and more lightens it. The ground
    // under a mark is the real, lit, shadowed, patchy terrain pixel, so the mark keeps its
    // light by day and night and its patches, and reads as the same share darker on pale sand
    // and on dark swamp. The colour buffer is linear (three renders to a float frame buffer
    // before its output pass), so 0.5 is exact. Alpha is left as it was. No lighting, fog or
    // tone mapping on the mark itself: it inherits all three from the ground.
    const m=mark?new T.MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.CustomBlending,fog:false,toneMapped:false}):new T.MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,blending:additive?T.AdditiveBlending:T.NormalBlending})
    if(mark){
      m.blendEquation=T.AddEquation;m.blendSrc=T.DstColorFactor;m.blendDst=T.SrcColorFactor
      m.blendEquationAlpha=T.AddEquation;m.blendSrcAlpha=T.ZeroFactor;m.blendDstAlpha=T.OneFactor
      // A mark lies 4 cm above the ground; this keeps it in front where a long quad's chord
      // passes close to the surface, so it does not shimmer against the terrain at a distance.
      m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-4
    }
    const d=attribute('fxAge','vec3'),age=this.clock.sub(d.x).div(d.y)
    // rgb, and in w how deep a print the ground takes (tyre marks only; see treads.ts).
    const tint=attribute('fxColor','vec4')
    if(mark){
      const r=attribute('fxRun','vec2')
      const arrive=this.clock.sub(d.x).div(this.fadeIn.max(1e-3)).clamp(0,1)
      const envelope=markEnvelope(nodeOps,uv().x,r.x,r.y,age,this.softness,endFade,arrive)
      // Far away a mark gives way to the plain ground, as the fog takes it.
      const far=float(1).sub(smoothstep(70,160,positionView.length()))
      const amount=markOpacity(nodeOps,d.z,this.strength).mul(envelope).mul(mark(uv().x,uv().y,tint.w)).mul(far).clamp(0,1)
      m.colorNode=vec3(1).add(tint.xyz.sub(1).mul(amount)).mul(.5)
      m.opacityNode=float(1)
    }else{
      m.colorNode=tint.xyz.mul(additive?hotExposureNode():unlitShadeNode())
      const across=float(1).sub(uv().x.sub(.5).abs().mul(2)).pow(2)
      m.opacityNode=d.z.mul(float(1).sub(smoothstep(additive?0:.65,1,age))).mul(age.lessThan(1).select(1,0)).mul(across)
    }
    this.mesh=new T.Mesh(g,m);this.mesh.frustumCulled=false;this.mesh.renderOrder=additive?2:1
  }
  /** A trail quad: one alpha for the whole quad. */
  add(a:T.Vector3,b:T.Vector3,side:T.Vector3,width:number,life:number,alpha:number,color:T.Color,tread=1){
    return this.mark(a,b,side,width,life,alpha,alpha,color,color,tread)
  }
  /**
   * A tyre mark quad from `a` to `b`. `alphaA` and `alphaB`, and `colorA` and `colorB`, are
   * the alpha and tint at each end, so a mark strengthens, weakens and changes colour smoothly
   * where the ground does; `startA` and `startB` the metres from where this mark began, and
   * `bornA` the clock time end `a` was laid (end `b` is laid now). `into`, an id from an
   * earlier call, rewrites that quad in place instead of taking a new one: the emitter keeps
   * one live quad per wheel from its last committed point to the tyre and stretches it every
   * frame. A quad since reused by the ring is not touched; a new one is taken instead.
   * Returns an id for `endAt` and `into`, or -1 if the quad was refused.
   */
  mark(a:T.Vector3,b:T.Vector3,side:T.Vector3,width:number,life:number,alphaA:number,alphaB:number,colorA:T.Color,colorB:T.Color,tread=1,startA=OPEN_END,startB=OPEN_END,bornA=this.clock.value,into=-1):number{
    const ok=Number.isFinite
    if(!(ok(a.x)&&ok(a.y)&&ok(a.z)&&ok(b.x)&&ok(b.y)&&ok(b.z)&&ok(width)&&ok(life)&&ok(alphaA)&&ok(alphaB)&&ok(bornA))||a.distanceToSquared(b)>900||!(life>0))return -1
    let i=this.slotOf(into),serial=0
    if(i<0){
      i=this.cursor;this.cursor=(i+1)%this.capacity
      if(this.count<this.capacity)this.count++
      // A full ring overwrites its oldest quad, still live or not.
      if(this.live===this.capacity)this.oldest=(this.oldest+1)%this.capacity
      else this.live++
      serial=this.serials[i]=++this.serial
    }else serial=this.serials[i]
    const half=width*.5,now=this.clock.value
    // The ground's normal, from the quad's own sides: side = along x normal.
    const nx=side.y*(b.z-a.z)-side.z*(b.y-a.y),ny=side.z*(b.x-a.x)-side.x*(b.z-a.z),nz=side.x*(b.y-a.y)-side.y*(b.x-a.x),nl=Math.hypot(nx,ny,nz)||1
    for(let j=0;j<4;j++){
      const end=j<2?a:b,s=j%2?-half:half,k=i*4+j
      this.position.setXYZ(k,end.x+side.x*s,end.y+side.y*s,end.z+side.z*s);this.data.setXYZ(k,j<2?bornA:now,life,j<2?alphaA:alphaB);const c=j<2?colorA:colorB;this.tint.setXYZW(k,c.r,c.g,c.b,tread)
      this.run.setXY(k,j<2?startA:startB,OPEN_END);this.normal.setXYZ(k,nx/nl,ny/nl,nz/nl)
    }
    this.expiry[i]=now+life
    this.position.addUpdateRange(i*12,12);this.position.needsUpdate=true;this.data.addUpdateRange(i*12,12);this.data.needsUpdate=true;this.tint.addUpdateRange(i*16,16);this.tint.needsUpdate=true
    this.run.addUpdateRange(i*8,8);this.run.needsUpdate=true;this.normal.addUpdateRange(i*12,12);this.normal.needsUpdate=true
    this.mesh.geometry.setDrawRange(0,this.count*6)
    return i+this.capacity*serial
  }
  /** The ring slot of quad `id`, or -1 if it is none or has since been reused. */
  private slotOf(id:number){
    if(id<0)return -1
    const i=id%this.capacity
    return this.serials[i]===(id-i)/this.capacity&&this.expiry[i]>this.clock.value?i:-1
  }
  /**
   * A mark ended: give quad `id` its distance to the end at each end, `endA` and `endB` metres,
   * so it fades out there. Does nothing if the quad has since been reused.
   */
  endAt(id:number,endA:number,endB:number){
    const i=this.slotOf(id)
    if(i<0)return
    for(let j=0;j<4;j++)this.run.setY(i*4+j,j<2?endA:endB)
    this.run.addUpdateRange(i*8,8);this.run.needsUpdate=true
  }
  /**
   * Collapse quads whose life is over, oldest first, so they draw nothing. A quad that outlives
   * an older one waits for it; lives differ by surface, so a few faded quads may be kept a
   * little longer than they need. Once none is left, the ring starts again from empty.
   */
  expire(){
    const now=this.clock.value,a=this.position.array as Float32Array
    let changed=false
    while(this.live>0&&this.expiry[this.oldest]<=now){
      const i=this.oldest,base=i*12
      for(let k=3;k<12;k++)a[base+k]=a[base+k%3]
      this.position.addUpdateRange(base,12);changed=true
      this.oldest=(i+1)%this.capacity;this.live--
    }
    if(changed)this.position.needsUpdate=true
    if(this.live===0&&this.count>0)this.clear()
  }
  /**
   * Move every stored quad by (dx, dz), for a world seam (see ParticleBatch.shift for why the
   * buffer is rewritten rather than offset by a uniform). Rewrites positions in place and
   * uploads the buffer once.
   */
  shift(dx:number,dz:number){
    const a=this.position.array as Float32Array
    for(let i=0;i<a.length;i+=3){a[i]+=dx;a[i+2]+=dz}
    // One range over the whole buffer. Emits later this frame add their own small ranges, which
    // overlap it harmlessly; replacing it would upload only those and lose the shift.
    this.position.clearUpdateRanges();this.position.addUpdateRange(0,a.length);this.position.needsUpdate=true
  }
  clear(){this.count=this.cursor=this.live=this.oldest=0;this.mesh.geometry.setDrawRange(0,0)}
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose()}
}

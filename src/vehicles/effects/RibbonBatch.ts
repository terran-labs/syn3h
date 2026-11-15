import {hotExposureNode} from '../skins/hotExposure'
import * as T from 'three/webgpu'
import {attribute,float,smoothstep,uniform,uv} from 'three/tsl'
import {unlitShadeNode,type MarkAlpha} from './sprites'

/**
 * One global capped quad ring, after VhiclSkidmarks.cs 20-24, 96-195. `mark` gives the alpha
 * across a quad from its u coordinate (see `tyreMarkAlpha` in sprites.ts); without it the ribbon
 * is a soft trail.
 */
export class RibbonBatch {
  readonly mesh:T.Mesh<T.BufferGeometry,T.MeshBasicNodeMaterial>
  readonly clock=uniform(0)
  private cursor=0
  private count=0
  private readonly position:T.BufferAttribute
  private readonly data:T.BufferAttribute
  private readonly tint:T.BufferAttribute
  get used(){return this.count}
  constructor(readonly capacity:number,mark?:MarkAlpha,additive=false){
    const g=new T.BufferGeometry(),positions=new Float32Array(capacity*12),uvs=new Float32Array(capacity*8),indices=new Uint32Array(capacity*6)
    for(let i=0;i<capacity;i++){uvs.set([0,0,1,0,0,1,1,1],i*8);indices.set([i*4,i*4+2,i*4+1,i*4+1,i*4+2,i*4+3],i*6)}
    this.position=new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage)
    this.data=new T.BufferAttribute(new Float32Array(capacity*12),3).setUsage(T.DynamicDrawUsage)
    this.tint=new T.BufferAttribute(new Float32Array(capacity*12),3).setUsage(T.DynamicDrawUsage)
    g.setAttribute('position',this.position);g.setAttribute('uv',new T.BufferAttribute(uvs,2));g.setAttribute('fxAge',this.data);g.setAttribute('fxColor',this.tint);g.setIndex(new T.BufferAttribute(indices,1));g.setDrawRange(0,0)
    const m=new T.MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,blending:additive?T.AdditiveBlending:T.NormalBlending})
    const d=attribute('fxAge','vec3'),age=this.clock.sub(d.x).div(d.y)
    m.colorNode=attribute('fxColor','vec3')
    // Tyre marks are unlit like dust, so they share its night shading; additive trails glow.
    m.colorNode=m.colorNode.mul(additive?hotExposureNode():unlitShadeNode())
    let opacity=d.z.mul(float(1).sub(smoothstep(additive?0:.65,1,age))).mul(age.lessThan(1).select(1,0))
    const across:typeof opacity=mark?mark(uv().x):float(1).sub(uv().x.sub(.5).abs().mul(2)).pow(2)
    opacity=opacity.mul(across)
    m.opacityNode=opacity
    this.mesh=new T.Mesh(g,m);this.mesh.frustumCulled=false;this.mesh.renderOrder=additive?2:1
  }
  add(a:T.Vector3,b:T.Vector3,side:T.Vector3,width:number,life:number,alpha:number,color:T.Color){
    const ok=Number.isFinite
    if(!(ok(a.x)&&ok(a.y)&&ok(a.z)&&ok(b.x)&&ok(b.y)&&ok(b.z)&&ok(width)&&ok(life))||a.distanceToSquared(b)>900)return
    const i=this.cursor;this.cursor=(i+1)%this.capacity;this.count=Math.min(this.capacity,this.count+1)
    // Corners in the same order and with the same arithmetic as before (end + side * +-half width),
    // written straight into the buffers instead of through four cloned vectors.
    const half=width*.5,now=this.clock.value
    for(let j=0;j<4;j++){
      const end=j<2?a:b,s=j%2?-half:half,k=i*4+j
      this.position.setXYZ(k,end.x+side.x*s,end.y+side.y*s,end.z+side.z*s);this.data.setXYZ(k,now,life,alpha);this.tint.setXYZ(k,color.r,color.g,color.b)
    }
    this.position.addUpdateRange(i*12,12);this.position.needsUpdate=true;this.data.addUpdateRange(i*12,12);this.data.needsUpdate=true;this.tint.addUpdateRange(i*12,12);this.tint.needsUpdate=true
    this.mesh.geometry.setDrawRange(0,this.count*6)
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
  clear(){this.count=this.cursor=0;this.mesh.geometry.setDrawRange(0,0)}
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose()}
}

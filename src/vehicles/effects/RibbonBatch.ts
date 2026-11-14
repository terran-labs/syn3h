import * as T from 'three/webgpu'
import {attribute,float,smoothstep,texture,uniform,uv} from 'three/tsl'

/** One global capped quad ring, after VhiclSkidmarks.cs 20-24, 96-195. */
export class RibbonBatch {
  readonly mesh:T.Mesh<T.BufferGeometry,T.MeshBasicNodeMaterial>
  readonly clock=uniform(0)
  private cursor=0
  private count=0
  private readonly position:T.BufferAttribute
  private readonly data:T.BufferAttribute
  private readonly tint:T.BufferAttribute
  get used(){return this.count}
  constructor(readonly capacity:number,map?:T.Texture,additive=false){
    const g=new T.BufferGeometry(),positions=new Float32Array(capacity*12),uvs=new Float32Array(capacity*8),indices=new Uint32Array(capacity*6)
    for(let i=0;i<capacity;i++){uvs.set([0,0,1,0,0,1,1,1],i*8);indices.set([i*4,i*4+2,i*4+1,i*4+1,i*4+2,i*4+3],i*6)}
    this.position=new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage)
    this.data=new T.BufferAttribute(new Float32Array(capacity*12),3).setUsage(T.DynamicDrawUsage)
    this.tint=new T.BufferAttribute(new Float32Array(capacity*12),3).setUsage(T.DynamicDrawUsage)
    g.setAttribute('position',this.position);g.setAttribute('uv',new T.BufferAttribute(uvs,2));g.setAttribute('fxAge',this.data);g.setAttribute('fxColor',this.tint);g.setIndex(new T.BufferAttribute(indices,1));g.setDrawRange(0,0)
    const m=new T.MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,blending:additive?T.AdditiveBlending:T.NormalBlending})
    const d=attribute('fxAge','vec3'),age=this.clock.sub(d.x).div(d.y)
    m.colorNode=attribute('fxColor','vec3')
    let opacity=d.z.mul(float(1).sub(smoothstep(additive?0:.65,1,age))).mul(age.lessThan(1).select(1,0))
    opacity=opacity.mul(map?texture(map,uv()).a:float(1).sub(uv().x.sub(.5).abs().mul(2)).pow(2))
    m.opacityNode=opacity
    this.mesh=new T.Mesh(g,m);this.mesh.frustumCulled=false;this.mesh.renderOrder=additive?2:1
  }
  add(a:T.Vector3,b:T.Vector3,side:T.Vector3,width:number,life:number,alpha:number,color:T.Color){
    if(![...a.toArray(),...b.toArray(),width,life].every(Number.isFinite)||a.distanceToSquared(b)>900)return
    const i=this.cursor;this.cursor=(i+1)%this.capacity;this.count=Math.min(this.capacity,this.count+1)
    const points=[a.clone().addScaledVector(side,width*.5),a.clone().addScaledVector(side,-width*.5),b.clone().addScaledVector(side,width*.5),b.clone().addScaledVector(side,-width*.5)]
    points.forEach((p,j)=>{this.position.setXYZ(i*4+j,p.x,p.y,p.z);this.data.setXYZ(i*4+j,this.clock.value,life,alpha);this.tint.setXYZ(i*4+j,color.r,color.g,color.b)})
    for(const attr of [this.position,this.data,this.tint]){attr.addUpdateRange(i*12,12);attr.needsUpdate=true}
    this.mesh.geometry.setDrawRange(0,this.count*6)
  }
  clear(){this.count=this.cursor=0;this.mesh.geometry.setDrawRange(0,0)}
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose()}
}

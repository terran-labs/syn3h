import * as T from 'three/webgpu'
import { attribute, float, smoothstep, uv, vec2, vec3 } from 'three/tsl'
import { graphicsLevel } from '../../core/quality'
import type { Terrain } from '../Terrain'

export interface Bubble { x:number; y:number; z:number; radius:number; age:number; life:number; speed:number; phase:number }
type Water = Pick<Terrain, 'heightAt'|'liquidHeightAt'|'liquidKindAt'>
export const bubbleCapacity = (tier:number) => [16,32,64][Math.max(0,Math.min(2,Math.round(tier)))]

/** Bounded CPU lifecycle; water queries pop each bubble at the actual moving surface. */
export class BubbleField {
  readonly particles:Bubble[]=[]
  private carry=0
  private seed=731
  private last={x:Infinity,y:Infinity,z:Infinity}
  private random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296}
  clear(){this.particles.length=0;this.carry=0;this.last={x:Infinity,y:Infinity,z:Infinity}}
  step(dt:number,eye:{x:number;y:number;z:number},water:Water,capacity:number,enabled=true){
    const surface=water.liquidHeightAt?.(eye.x,eye.z)??-Infinity
    if(!enabled||water.liquidKindAt?.(eye.x,eye.z)!=='water'||!(eye.y<surface)){this.clear();return}
    if(Math.hypot(eye.x-this.last.x,eye.y-this.last.y,eye.z-this.last.z)>20)this.clear()
    Object.assign(this.last,eye)
    dt=Math.max(0,Math.min(.1,dt))
    let used=0
    for(const p of this.particles){
      p.age+=dt;p.y+=p.speed*dt;p.x+=Math.sin(p.phase+p.age*2)*dt*.08
      const top=water.liquidHeightAt?.(p.x,p.z)??-Infinity
      if(p.age>=p.life||p.y+p.radius>=top||water.liquidKindAt?.(p.x,p.z)!=='water'||Math.hypot(p.x-eye.x,p.y-eye.y,p.z-eye.z)>12)continue
      if(used<capacity)this.particles[used++]=p
    }
    this.particles.length=used
    this.carry+=dt*capacity/6
    while(this.carry>=1){
      this.carry--
      if(this.particles.length>=capacity)continue
      const x=eye.x+(this.random()-.5)*12,z=eye.z+(this.random()-.5)*12
      const y=eye.y-.3-this.random()*3,radius=.055+this.random()*.075
      if(water.liquidKindAt?.(x,z)!=='water'||y-radius<=water.heightAt(x,z)||y+radius>=(water.liquidHeightAt?.(x,z)??-Infinity))continue
      this.particles.push({x,y,z,radius,age:0,life:3+this.random()*3,speed:.45+this.random()*.55,phase:this.random()*Math.PI*2})
    }
  }
}

/** One generated billboard batch, allocated at the effective quality tier. No textures. */
export class UnderwaterBubbles {
  readonly field=new BubbleField()
  mesh:T.Mesh<T.InstancedBufferGeometry,T.SpriteNodeMaterial>|null=null
  private capacity=0
  private unsubscribe: (()=>void)|undefined
  constructor(private scene:T.Scene,private terrain:Terrain,private camera:T.Camera){
    this.unsubscribe=terrain.onRegenerate?.(()=>this.clear())
  }
  clear(){this.field.clear();if(this.mesh){this.mesh.geometry.instanceCount=0;this.mesh.visible=false}}
  private allocate(capacity:number){
    if(this.mesh){this.scene.remove(this.mesh);this.mesh.geometry.dispose();this.mesh.material.dispose()}
    const plane=new T.PlaneGeometry(1,1),g=new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry);plane.dispose()
    g.setAttribute('bubblePosition',new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage))
    g.setAttribute('bubbleSizeFade',new T.InstancedBufferAttribute(new Float32Array(capacity*2),2).setUsage(T.DynamicDrawUsage))
    const cfg=attribute('bubbleSizeFade','vec2'),p=uv().mul(2).sub(1),r=p.length()
    const ring=smoothstep(.64,.85,r).mul(float(1).sub(smoothstep(.85,1,r)))
    const highlight=float(1).sub(smoothstep(.03,.35,p.sub(vec2(-.32,.38)).length()))
    const material=new T.SpriteNodeMaterial({transparent:true,depthWrite:false})
    material.positionNode=attribute('bubblePosition','vec3')
    material.scaleNode=vec2(cfg.x,cfg.x)
    material.colorNode=vec3(.65,.85,1).add(highlight.mul(.25))
    material.opacityNode=ring.mul(.45).add(highlight.mul(.6)).mul(cfg.y)
    this.mesh=new T.Mesh(g,material);this.mesh.name='underwater-bubbles';this.mesh.frustumCulled=false
    this.scene.add(this.mesh);this.capacity=capacity
  }
  update(dt:number,enabled=true){
    const capacity=bubbleCapacity(graphicsLevel.value)
    this.field.step(dt,this.camera.position,this.terrain,capacity,enabled)
    if(!this.field.particles.length){if(this.mesh){this.mesh.visible=false;this.mesh.geometry.instanceCount=0}return}
    if(capacity!==this.capacity)this.allocate(capacity)
    const mesh=this.mesh!,g=mesh.geometry,pos=g.getAttribute('bubblePosition') as T.InstancedBufferAttribute,cfg=g.getAttribute('bubbleSizeFade') as T.InstancedBufferAttribute
    this.field.particles.forEach((p,i)=>{pos.setXYZ(i,p.x,p.y,p.z);cfg.setXY(i,p.radius*2,Math.min(1,p.age/.25,(p.life-p.age)/.4))})
    g.instanceCount=this.field.particles.length;pos.needsUpdate=true;cfg.needsUpdate=true;mesh.visible=true
  }
  dispose(){this.unsubscribe?.();this.clear();if(this.mesh){this.scene.remove(this.mesh);this.mesh.geometry.dispose();this.mesh.material.dispose();this.mesh=null}this.capacity=0}
}

import * as T from 'three/webgpu'
import { attribute, float, smoothstep, uv, vec2, vec3 } from 'three/tsl'
import { graphicsLevel } from '../../core/quality'
import type { Terrain } from '../Terrain'

export interface Bubble { x:number; y:number; z:number; radius:number; age:number; life:number; speed:number; phase:number; drift:number }
type Water = Pick<Terrain, 'heightAt'|'liquidHeightAt'|'liquidKindAt'>
// A trail of bubbles off a moving vehicle needs a few dozen live at once to read as a stream.
const capacities=[24,80,160]
export const bubbleCapacity = (tier:number) => capacities[Math.max(0,Math.min(2,Math.round(tier)))]
/** The batch is sized once for the largest tier; a tier change only changes how many are live. */
export const bubbleBatchCapacity = capacities[2]
/** Small bubbles rise slower: roughly terminal velocity for millimetre to centimetre bubbles. */
export const bubbleRiseSpeed = (radius:number) => .18+Math.min(.5,radius*9)

/** Bounded CPU lifecycle; water queries pop each bubble at the actual moving surface. */
export class BubbleField {
  readonly particles:Bubble[]=[]
  private carry=0
  private seed=731
  private last={x:Infinity,y:Infinity,z:Infinity}
  private random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296}
  clear(){this.particles.length=0;this.carry=0;this.last={x:Infinity,y:Infinity,z:Infinity}}
  /** Spawn up to `count` bubbles round a point (a submerged, moving vehicle), within capacity. */
  emit(x:number,y:number,z:number,count:number,spread:number,water:Water,capacity:number){
    for(let i=0;i<count&&this.particles.length<capacity;i++){
      const px=x+(this.random()-.5)*spread,pz=z+(this.random()-.5)*spread,py=y+(this.random()-.5)*spread*.5,radius=.012+this.random()*this.random()*.05
      if(water.liquidKindAt?.(px,pz)!=='water'||py-radius<=water.heightAt(px,pz)||py+radius>=(water.liquidHeightAt?.(px,pz)??-Infinity))continue
      this.particles.push({x:px,y:py,z:pz,radius,age:0,life:2+this.random()*3,speed:bubbleRiseSpeed(radius),phase:this.random()*Math.PI*2,drift:.04+this.random()*.08})
    }
  }
  step(dt:number,eye:{x:number;y:number;z:number},water:Water,capacity:number,enabled=true){
    const surface=water.liquidHeightAt?.(eye.x,eye.z)??-Infinity
    if(!enabled||water.liquidKindAt?.(eye.x,eye.z)!=='water'||!(eye.y<surface)){this.clear();return}
    if(Math.hypot(eye.x-this.last.x,eye.y-this.last.y,eye.z-this.last.z)>20)this.clear()
    Object.assign(this.last,eye)
    dt=Math.max(0,Math.min(.1,dt))
    let used=0
    for(const p of this.particles){
      // Rise with a helical wobble: real bubbles of this size zigzag as they climb.
      p.age+=dt;p.y+=p.speed*dt
      const w=p.phase+p.age*(5+p.radius*40)
      p.x+=Math.cos(w)*dt*p.drift*3;p.z+=Math.sin(w)*dt*p.drift*3
      const top=water.liquidHeightAt?.(p.x,p.z)??-Infinity
      if(p.age>=p.life||p.y+p.radius>=top||water.liquidKindAt?.(p.x,p.z)!=='water'||Math.hypot(p.x-eye.x,p.y-eye.y,p.z-eye.z)>12)continue
      if(used<capacity)this.particles[used++]=p
    }
    this.particles.length=used
    // Ambient bubbles are sparse: most of the budget is for trails behind moving vehicles.
    this.carry+=dt*capacity/12
    while(this.carry>=1){
      this.carry--
      if(this.particles.length>=capacity)continue
      const x=eye.x+(this.random()-.5)*12,z=eye.z+(this.random()-.5)*12
      const y=eye.y-.3-this.random()*3,radius=.01+this.random()*this.random()*.035
      if(water.liquidKindAt?.(x,z)!=='water'||y-radius<=water.heightAt(x,z)||y+radius>=(water.liquidHeightAt?.(x,z)??-Infinity))continue
      this.particles.push({x,y,z,radius,age:0,life:3+this.random()*3,speed:bubbleRiseSpeed(radius),phase:this.random()*Math.PI*2,drift:.03+this.random()*.06})
    }
  }
}

/**
 * One generated billboard batch, allocated once at construction at the largest tier's size
 * and kept in the scene with no live instances, so its pipeline compiles with everything
 * else at load (three creates the pipeline even for an instance count of 0) and no dive or
 * tier change ever builds one. No textures.
 */
export class UnderwaterBubbles {
  readonly field=new BubbleField()
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.SpriteNodeMaterial>
  readonly capacity=bubbleBatchCapacity
  private unsubscribe: (()=>void)|undefined
  constructor(private scene:T.Scene,private terrain:Terrain,private camera:T.Camera){
    this.unsubscribe=terrain.onRegenerate?.(()=>this.clear())
    const plane=new T.PlaneGeometry(1,1),g=new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry);plane.dispose()
    g.setAttribute('bubblePosition',new T.InstancedBufferAttribute(new Float32Array(this.capacity*3),3).setUsage(T.DynamicDrawUsage))
    g.setAttribute('bubbleLook',new T.InstancedBufferAttribute(new Float32Array(this.capacity*3),3).setUsage(T.DynamicDrawUsage))
    g.instanceCount=0
    // size, fade, glint. Glint is 1 at the surface and falls with depth: bubbles near the
    // top catch the light through the surface, deep ones are dim rims.
    const look=attribute('bubbleLook','vec3'),p=uv().mul(2).sub(1),r=p.length()
    const ring=smoothstep(.6,.86,r).mul(float(1).sub(smoothstep(.86,1,r)))
    const highlight=float(1).sub(smoothstep(.02,.3,p.sub(vec2(-.3,.36)).length()))
    const glint=look.z
    const material=new T.SpriteNodeMaterial({transparent:true,depthWrite:false})
    material.positionNode=attribute('bubblePosition','vec3')
    material.scaleNode=vec2(look.x,look.x)
    material.colorNode=vec3(.55,.78,.9).mul(glint.mul(.6).add(.4)).add(highlight.mul(glint.mul(.9).add(.15)))
    material.opacityNode=ring.mul(glint.mul(.35).add(.3)).add(highlight.mul(glint.mul(.5).add(.25))).mul(look.y)
    this.mesh=new T.Mesh(g,material);this.mesh.name='underwater-bubbles';this.mesh.frustumCulled=false
    this.scene.add(this.mesh)
  }
  clear(){this.field.clear();this.mesh.geometry.instanceCount=0}
  /** Trail from a submerged vehicle: denser the faster it moves. */
  trail(x:number,y:number,z:number,speed:number,dt:number){
    const capacity=bubbleCapacity(graphicsLevel.value)
    const rate=Math.min(1,speed/8)*capacity*.9
    this.trailCarry+=rate*Math.max(0,Math.min(.1,dt))
    const n=Math.floor(this.trailCarry);this.trailCarry-=n
    if(n>0)this.field.emit(x,y,z,n,1.4,this.terrain,capacity)
  }
  private trailCarry=0
  update(dt:number,enabled=true){
    const capacity=bubbleCapacity(graphicsLevel.value)
    this.field.step(dt,this.camera.position,this.terrain,capacity,enabled)
    const g=this.mesh.geometry,pos=g.getAttribute('bubblePosition') as T.InstancedBufferAttribute,look=g.getAttribute('bubbleLook') as T.InstancedBufferAttribute
    const n=Math.min(this.capacity,this.field.particles.length)
    if(n===0&&g.instanceCount===0)return
    for(let i=0;i<n;i++){
      const p=this.field.particles[i],depth=Math.max(0,(this.terrain.liquidHeightAt?.(p.x,p.z)??p.y)-p.y)
      pos.setXYZ(i,p.x,p.y,p.z);look.setXYZ(i,p.radius*2,Math.min(1,p.age/.25,(p.life-p.age)/.4),Math.exp(-depth/1.5))
    }
    g.instanceCount=n;pos.needsUpdate=true;look.needsUpdate=true
  }
  dispose(){this.unsubscribe?.();this.clear();this.scene.remove(this.mesh);this.mesh.geometry.dispose();this.mesh.material.dispose()}
}

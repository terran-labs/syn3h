import * as T from 'three/webgpu'
import { float, texture, uniform, uv, vec2, vec3, vec4, smoothstep } from 'three/tsl'
import { defineParam } from '../../../shared/params'
import { DisturbanceQueue, RippleSleep, snappedOrigin } from './rippleMath'

export const waterRipples = defineParam<boolean>({id:'water.ripples',label:'Simulated ripples',group:'Water',scope:'client',default:true})
export const waterRippleSize = defineParam({id:'water.rippleSize',label:'Ripple window (m)',group:'Water',scope:'client',default:128,min:32,max:256,step:16})

/** RG stores current and previous height. Fixed 120 Hz, c=12 m/s, CFL <= .5. */
export class Ripples {
  private targets: T.RenderTarget[] = []
  private queue = new DisturbanceQueue()
  private sleep = new RippleSleep()
  /** Simulation passes rendered since creation: evidence that an undisturbed field costs none. */
  readonly stats = { passes: 0 }
  private origin = uniform(new T.Vector2())
  private shift = uniform(new T.Vector2())
  private extent = uniform(128)
  private active = uniform(0)
  private stepWave = uniform(0)
  private events = Array.from({length:32},()=>uniform(new T.Vector4(0,0,1,0)))
  private source = texture(new T.Texture())
  private quad: T.QuadMesh | null = null
  private index = 0
  private accumulator = 0
  private positioned = false
  private tileSize = uniform(0)
  readonly cells = 256
  private renderer!:T.WebGPURenderer
  /** Binding is separate so sea materials can capture nodes before game systems exist. */
  attach(renderer:T.WebGPURenderer):void {
    if(this.renderer!==renderer)this.dispose()
    this.renderer=renderer
  }
  /** Set the wrapping world width; zero is an unbounded flat lab. */
  configure(tileSize:number) { this.resetField();this.tileSize.value=Math.max(0,tileSize) }
  disturb(x:number,z:number,radius:number,strength:number) {
    if(!waterRipples.value)return
    const tile=this.tileSize.value
    if(tile>0&&this.positioned){x+=Math.round((this.origin.value.x+this.extent.value/2-x)/tile)*tile;z+=Math.round((this.origin.value.y+this.extent.value/2-z)/tile)*tile}
    this.queue.push(x,z,radius,strength)
  }
  // TSL node arguments intentionally accept any node shape supplied by the sea material.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rippleHeight(worldXZ:any):any {
    const delta=worldXZ.sub(this.origin).sub(this.extent.mul(.5))
    const tile=this.tileSize.max(1)
    const local: any=this.tileSize.greaterThan(0).select(delta.sub(delta.div(tile).add(.5).floor().mul(tile)),delta)
    const p=local.div(this.extent).add(.5)
    const edge=smoothstep(0,.06,p.x).mul(smoothstep(0,.06,p.y)).mul(smoothstep(0,.06,float(1).sub(p.x))).mul(smoothstep(0,.06,float(1).sub(p.y)))
    return this.source.sample(p).r.mul(edge).mul(this.active)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rippleNormal(worldXZ:any):any {
    const d=this.extent.div(this.cells)
    const dx=this.rippleHeight(worldXZ.add(vec2(d,0))).sub(this.rippleHeight(worldXZ.sub(vec2(d,0)))).div(d.mul(2))
    const dz=this.rippleHeight(worldXZ.add(vec2(0,d))).sub(this.rippleHeight(worldXZ.sub(vec2(0,d)))).div(d.mul(2))
    return vec3(dx.negate(),1,dz.negate()).normalize()
  }
  private allocate() {
    this.targets=Array.from({length:2},()=>new T.RenderTarget(this.cells,this.cells,{type:T.HalfFloatType,format:T.RGBAFormat,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:false}))
    this.flatten()
    // Fresh targets restart the ping-pong. Keeping an old index of 1 made the next step
    // render into targets[0] while sampling it.
    this.source.value=this.targets[0].texture;this.index=0
    const p=uv().add(this.shift), d=1/this.cells
    const sample=(offset:any)=>this.source.sample(p.add(offset)).r
    const h=this.source.sample(p).r, previous=this.source.sample(p).g
    const lap=sample(vec2(d,0)).add(sample(vec2(-d,0))).add(sample(vec2(0,d))).add(sample(vec2(0,-d))).sub(h.mul(4))
    const coefficient=float(12/120).div(this.extent.div(this.cells)).pow(2).min(.5)
    let impulse: any=float(0)
    const world=uv().mul(this.extent).add(this.origin)
    for(const e of this.events) impulse=impulse.add(float(1).sub(world.sub(e.xy).length().div(e.z)).max(0).pow(2).mul(e.w))
    const inside=p.x.greaterThanEqual(0).and(p.x.lessThanEqual(1)).and(p.y.greaterThanEqual(0)).and(p.y.lessThanEqual(1))
    const next=h.mul(2).sub(previous).mul(.992).add(lap.mul(coefficient))
    const edge=smoothstep(0,.03,uv().x).mul(smoothstep(0,.03,uv().y)).mul(smoothstep(0,.03,float(1).sub(uv().x))).mul(smoothstep(0,.03,float(1).sub(uv().y)))
    const material=new T.MeshBasicNodeMaterial()
    material.fragmentNode=vec4(inside.select(this.stepWave.greaterThan(0).select(next,h),0).add(impulse).mul(edge),inside.select(this.stepWave.greaterThan(0).select(h,previous),0).add(impulse).mul(edge),0,1)
    this.quad=new T.QuadMesh(material)
    this.quad.name='water-ripple-simulation'
  }
  /** Zero both height buffers: a fresh field, and one waking after its window moved unseen. */
  private flatten() {
    const saved=this.renderer.getRenderTarget(), clear=this.renderer.getClearColor(new T.Color()), alpha=this.renderer.getClearAlpha()
    this.renderer.setClearColor(0,0)
    for(const target of this.targets){this.renderer.setRenderTarget(target);this.renderer.clear()}
    this.renderer.setRenderTarget(saved);this.renderer.setClearColor(clear,alpha)
  }
  private resetField() {
    this.active.value=0
    this.positioned=false
    this.accumulator=0
    this.queue.drain()
    this.sleep.reset()
  }
  update(dt:number,cameraX:number,cameraZ:number) {
    if(!this.renderer)return
    if(!waterRipples.value){
      if(this.positioned||this.queue.events.length)this.resetField()
      return
    }
    // Asleep until something disturbs the water: no passes, no uploads, and the sea shader
    // reads a flat field through `active`. The targets and pipeline stay, so waking is free.
    if(!this.sleep.step(this.queue.events.length,dt)){
      if(this.active.value){this.active.value=0;this.positioned=false;this.accumulator=0}
      return
    }
    const size=waterRippleSize.value
    if(size!==this.extent.value){
      // Old texels represent different world positions at the new extent. Start flat
      // at the camera, then apply this frame's disturbances in world coordinates.
      this.extent.value=size
      this.positioned=false
      this.accumulator=0
    }
    if(!this.quad)this.allocate()
    else if(!this.positioned)this.flatten()
    const tile=this.tileSize.value
    if(tile>0&&this.positioned){cameraX+=Math.round((this.origin.value.x+size/2-cameraX)/tile)*tile;cameraZ+=Math.round((this.origin.value.y+size/2-cameraZ)/tile)*tile}
    const next=snappedOrigin(cameraX,cameraZ,this.cells,size)
    this.shift.value.set(this.positioned?(next.x-this.origin.value.x)/size:0,this.positioned?(next.z-this.origin.value.y)/size:0)
    this.origin.value.set(next.x,next.z);this.positioned=true;this.active.value=1
    this.accumulator+=Math.max(0,Math.min(.05,dt))
    const count=Math.min(6,Math.floor(this.accumulator*120));this.accumulator-=count/120
    const events=this.queue.drain()
    this.events.forEach((u,i)=>{const e=events[i];u.value.set(e?.x??0,e?.z??0,e?.radius??1,e?.strength??0)})
    const saved=this.renderer.getRenderTarget()
    try {
      for(let i=0;i<Math.max(1,count);i++){
        this.stepWave.value=count>0?1:0
        this.index=1-this.index;this.renderer.setRenderTarget(this.targets[this.index]);this.quad!.render(this.renderer);this.stats.passes++
        this.source.value=this.targets[this.index].texture;this.shift.value.set(0,0)
        for(const e of this.events)e.value.w=0
      }
    } finally {this.renderer.setRenderTarget(saved)}
  }
  dispose(){for(const t of this.targets)t.dispose();this.targets=[];(this.quad?.material as T.Material | undefined)?.dispose();this.quad=null;this.resetField()}
}

/** Shared by the sea shader and the game effects system; no GPU targets until enabled. */
export const rippleField=new Ripples()

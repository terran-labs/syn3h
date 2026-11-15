import * as T from 'three/webgpu'
import type {Game,System} from '../../core/Game'
import {qualityBudget,graphicsLevel} from '../../core/quality'
import type {Terrain} from '../../world/Terrain'
import type {Vehicle} from '../Vehicle'
import {ParticleBatch} from './ParticleBatch'
import {RibbonBatch} from './RibbonBatch'

export interface WheelEffectContact {readonly grounded:boolean;readonly point:T.Vector3;readonly normal:T.Vector3;readonly slip:number}
type EffectsVehicle=Vehicle & {getWheelEffects?():readonly WheelEffectContact[];hoverMode?:boolean}
const worlds=new WeakMap<Game,EffectWorld>()
const clamp=T.MathUtils.clamp
/** Integer hashing keeps cosmetic emission reproducible without touching simulation randomness. */
export function effectNoise(i:number){let n=Math.imul(i+1,0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296}
const dustColor=new T.Color(.48,.27,.12),markColor=new T.Color(.055,.035,.022)
const temp=new T.Vector3(),normal=new T.Vector3(),side=new T.Vector3(),velocity=new T.Vector3()

class EffectWorld implements System {
  readonly vehicles=new Map<Vehicle,VehicleEffects>()
  private references=0
  private level=-1
  private serial=0
  private readonly textures:T.Texture[]=[]
  private readonly dustMap:T.Texture
  private readonly exhaustMap:T.Texture
  private readonly plasmaMap:T.Texture
  private readonly redPlasmaMap:T.Texture
  readonly marks:RibbonBatch
  readonly trails:RibbonBatch
  dust!:ParticleBatch
  energy!:ParticleBatch
  sparks!:ParticleBatch
  redSparks!:ParticleBatch
  readonly lamps=new T.InstancedMesh(new T.SphereGeometry(.09,8,6),new T.MeshBasicMaterial({color:0xffffff}),512)
  clock=0
  readonly stats={vehicles:0,particles:0,marks:0,emitted:0,updateMs:0,peakUpdateMs:0,batches:7}
  constructor(readonly game:Game){
    const load=(url:string)=>{const t=new T.TextureLoader().load(url);t.colorSpace=T.SRGBColorSpace;this.textures.push(t);return t}
    this.dustMap=load('/models/effects/dust.png');this.exhaustMap=load('/models/textures/thruster-glow.png');this.plasmaMap=load('/models/effects/plasma-green.png');this.redPlasmaMap=load('/models/effects/plasma-red.png')
    this.marks=new RibbonBatch(1024,load('/models/effects/skidmark.png'));this.trails=new RibbonBatch(256,undefined,true)
    this.lamps.frustumCulled=false;this.lamps.count=0
    this.lamps.onBeforeRender=()=>{let index=0;for(const e of this.vehicles.values())index=e.writeLamps(this.lamps,index);this.lamps.instanceMatrix.needsUpdate=true;if(this.lamps.instanceColor)this.lamps.instanceColor.needsUpdate=true}
    game.scene.add(this.lamps,this.marks.mesh,this.trails.mesh);this.rebudget();game.scene.userData.vehicleEffects=this.stats
  }
  retain(){this.references++}
  release(){if(--this.references===0){worlds.delete(this.game);this.game.remove(this)}}
  private rebudget(){
    this.level=graphicsLevel.value;this.dust?.dispose();this.energy?.dispose();this.sparks?.dispose();this.redSparks?.dispose()
    const budget=Math.floor(qualityBudget().particles*.25)
    this.dust=new ParticleBatch(Math.floor(budget*.6),this.dustMap)
    this.energy=new ParticleBatch(Math.floor(budget*.3),this.exhaustMap,true)
    this.sparks=new ParticleBatch(Math.max(2,Math.floor(budget*.05)),this.plasmaMap,true)
    this.redSparks=new ParticleBatch(Math.max(2,Math.floor(budget*.05)),this.redPlasmaMap,true)
    this.game.scene.add(this.dust.mesh,this.energy.mesh,this.sparks.mesh,this.redSparks.mesh)
    this.stats.particles=this.dust.capacity+this.energy.capacity+this.sparks.capacity+this.redSparks.capacity
  }
  noise(){return effectNoise(this.serial++)}
  puff(p:T.Vector3,strength=1,color=dustColor){
    const n=Math.round((Number(graphicsLevel.value)===0?3:8)*strength)
    for(let i=0;i<n;i++){const a=this.noise()*Math.PI*2;velocity.set(Math.cos(a)*strength,1+this.noise(),Math.sin(a)*strength);this.dust.emit(p,velocity,1,.4+this.noise()*.4,2,color)}
  }
  postPhysics(){for(const e of this.vehicles.values())e.captureLanding()}
  update(dt:number){
    const start=performance.now();dt=Math.min(.1,dt);this.clock+=dt
    if(this.level!==graphicsLevel.value)this.rebudget()
    for(const b of [this.dust,this.energy,this.sparks,this.redSparks,this.marks,this.trails])b.clock.value=this.clock
    for(const e of this.vehicles.values())e.update(dt)
    this.stats.vehicles=this.vehicles.size;this.stats.marks=this.marks.used
    this.stats.emitted=this.dust.emitted+this.energy.emitted+this.sparks.emitted+this.redSparks.emitted
    this.stats.updateMs=performance.now()-start;this.stats.peakUpdateMs=Math.max(this.stats.peakUpdateMs,this.stats.updateMs)
  }
  dispose(){this.lamps.removeFromParent();this.lamps.geometry.dispose();this.lamps.material.dispose();for(const e of this.vehicles.values())e.dispose();this.vehicles.clear();for(const b of [this.dust,this.energy,this.sparks,this.redSparks,this.marks,this.trails])b.dispose();this.textures.forEach(t=>t.dispose());delete this.game.scene.userData.vehicleEffects}
}
function worldFor(game:Game){let w=worlds.get(game);if(!w){w=new EffectWorld(game);worlds.set(game,w);game.add(w)}return w}

class VehicleEffects {
  private readonly root=new T.Group()
  private readonly headMaterial=new T.MeshBasicMaterial({color:new T.Color(2.447059,2.858824,3)})
  private readonly tailMaterial=new T.MeshBasicMaterial({color:new T.Color(2,0,0)})
  private readonly lampPoints:T.Object3D[]=[]
  private readonly lampMatrix=new T.Matrix4()
  private spot?:T.SpotLight
  private readonly previousMarks:(T.Vector3|null)[]=[null,null,null,null]
  private readonly previousTips:(T.Vector3|null)[]=[null,null]
  private readonly lastPosition=new T.Vector3()
  private readonly localVelocity=new T.Vector3()
  private readonly color=new T.Color()
  private readonly q=new T.Quaternion()
  private dustTimer=0
  private exhaustTimer=0
  private trailTimer=0
  private pendingLanding=0
  private inLiquid=false
  private wasGrounded=false
  private lastVertical=0
  private throttle=0
  private readonly unlisten?:()=>void
  private readonly buggy:boolean
  private readonly classic:boolean
  constructor(private readonly world:EffectWorld,private readonly terrain:Terrain,private readonly vehicle:EffectsVehicle,local:boolean){
    this.buggy=vehicle.kind.startsWith('buggy');this.classic=vehicle.kind==='buggy-classic'
    this.root.name='Vehicle effects';vehicle.object.add(this.root);this.lastPosition.copy(vehicle.object.position)
    const jet=vehicle.kind==='jet',hover=vehicle.kind==='hovercraft',width=jet?1:this.classic?.45:.584,front=jet?3.2756:hover?1.4:this.classic?1.05:1.775
    for(const sign of [-1,1]){
      const head=new T.Object3D();head.position.set(sign*width,jet?-.423:.036,-front);this.root.add(head);this.lampPoints.push(head)
      const tail=new T.Object3D();tail.scale.set(1.7,.6,.5);tail.position.set(sign*width,.12,jet?2.7:hover?1.3:this.classic?1:1.7);this.root.add(tail);this.lampPoints.push(tail)
    }
    if(local){
      // Syn3h prefab range50, cone60 degrees. Unity intensity is not candela.
      // Aim farther down the road and use candela suitable for inverse-square falloff.
      this.spot=new T.SpotLight(new T.Color(1,.9965517,.875),0,50,Math.PI/6,.45,2)
      this.spot.position.set(0,.35,-front);this.spot.target.position.set(0,-.8,-22);this.spot.castShadow=false
      this.root.add(this.spot,this.spot.target)
    }
    this.unlisten=terrain.onRegenerate?.(()=>{this.reset();world.marks.clear();world.trails.clear()})
  }
  writeLamps(batch:T.InstancedMesh,index:number):number {
    this.root.updateWorldMatrix(true,true)
    for(let i=0;i<this.lampPoints.length&&index<512;i++,index++){
      this.lampMatrix.copy(this.lampPoints[i].matrixWorld)
      if(!this.vehicle.object.visible)this.lampMatrix.makeScale(0,0,0)
      batch.setMatrixAt(index,this.lampMatrix);batch.setColorAt(index,i%2?this.tailMaterial.color:this.headMaterial.color)
    }
    return index
  }
  captureLanding(){if(this.vehicle.landedThisStep)this.pendingLanding=Math.max(this.pendingLanding,this.vehicle.landingImpact)}
  private reset(){this.pendingLanding=0;this.previousMarks.fill(null);this.previousTips.fill(null);this.wasGrounded=false}
  private dry(p:T.Vector3){return (this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity)<this.terrain.heightAt(p.x,p.z)-.01}
  private point(x:number,y:number,z:number){return new T.Vector3(x,y,z).applyQuaternion(this.vehicle.object.quaternion).add(this.vehicle.object.position)}
  update(dt:number){
    const v=this.vehicle,w=this.world,p=v.object.position
    if(p.distanceToSquared(this.lastPosition)>900)this.reset()
    this.lastPosition.copy(p);this.q.copy(v.object.quaternion)
    const raw=v.body.linvel(),speed=Math.hypot(raw.x,raw.y,raw.z)
    this.localVelocity.set(raw.x,raw.y,raw.z).applyQuaternion(this.q.clone().invert())
    this.throttle=T.MathUtils.lerp(this.throttle,Math.max(0,v.kind==='hovercraft'?v.input.y:v.input.z),Math.min(1,dt*10))
    this.color.set(v.colors.accent)
    this.tailMaterial.color.setRGB(v.input.brakes?5:2,0,0)
    if(this.spot){
      const sky=w.game.scene.children.find(o=>'sunDirection' in o) as unknown as {sunDirection?:{value:T.Vector3}}|undefined
      const sunY=sky?.sunDirection?.value.y??1
      this.spot.intensity=clamp((.08-sunY)/.18,0,1)*(v.kind==='jet'?1800:1600)
    }
    // Suppress distant emissions. Existing particles continue their bounded shader lifetime.
    if(p.distanceToSquared(w.game.camera.position)>qualityBudget().drawDistance**2)return
    this.dustTimer+=dt;this.exhaustTimer+=dt;this.trailTimer+=dt
    const rateScale=Number(graphicsLevel.value)===0?.25:Number(graphicsLevel.value)===1?.5:1
    const ground=this.terrain.heightAt(p.x,p.z),height=p.y-ground
    const grounded=v.wheelsGrounded>0
    const impact=this.pendingLanding||(!this.buggy&&grounded&&!this.wasGrounded?-this.lastVertical:0)
    if(impact>2&&this.dry(p))w.puff(new T.Vector3(p.x,ground+.15,p.z),Math.min(2,impact/8))
    this.pendingLanding=0
    const liquid=this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity,inside=p.y<liquid+.15
    if(inside&&!this.inLiquid){const kind=(this.terrain as Terrain & {liquidKindAt?(x:number,z:number):string|null}).liquidKindAt?.(p.x,p.z)
      w.puff(new T.Vector3(p.x,liquid+.2,p.z),1.5,new T.Color(kind==='water'?.5:.65,kind==='water'?.7:.6,kind==='water'?.8:.55))}
    this.inLiquid=inside
    this.wasGrounded=grounded;this.lastVertical=raw.y
    if(this.buggy){
      const contacts=v.getWheelEffects?.()
      for(let i=0;i<4;i++){
        const contact=contacts?.[i],wp=contact?.point.clone()??this.point((i%2?1:-1)*(this.classic?.7:1.1),0,(i<2?-1:1)*(this.classic?.8:1.3))
        const y=this.terrain.heightAt(wp.x,wp.z)
        const touching=contact?.grounded??(grounded&&wp.y-y<1.4&&wp.y-y>-.3)
        if(!touching||!this.dry(wp)||speed<.5){this.previousMarks[i]=null;continue}
        normal.copy(contact?.normal??this.terrain.normalAt(wp.x,wp.z,temp));if(!contact)wp.y=y
        wp.addScaledVector(normal,.04)
        const slip=Math.abs(contact?.slip??this.localVelocity.x),intensity=slip>Math.abs(this.localVelocity.z)*.3?Math.abs(v.input.y)*.5+.25:.5
        const prev=this.previousMarks[i]
        if(prev&&prev.distanceToSquared(wp)>=.75*.75){
          side.copy(wp).sub(prev).cross(normal).normalize();w.marks.add(prev,wp,side,this.classic?.3:.5,60,clamp(intensity,0,1)/2,markColor);this.previousMarks[i]=wp
        }else if(!prev)this.previousMarks[i]=wp
        if(this.dustTimer>=1/(25*rateScale)&&speed>2){
          velocity.set(raw.x*-.08+(w.noise()-.5)*slip*.3,.6+w.noise(),raw.z*-.08)
          w.dust.emit(wp,velocity,1,.25+Math.min(1,slip*.08+speed*.008),2,dustColor)
        }
      }
      if(this.dustTimer>=1/(25*rateScale))this.dustTimer=0
    }else if((v.kind==='hovercraft'||v.kind==='jet'&&!v.input.special)&&height<20&&height>0&&this.dry(p)&&this.dustTimer>=1/(50*rateScale)){
      this.dustTimer=0;const strength=clamp(1-height/20,0,1)*(v.kind==='jet'?this.throttle:1)
      if(strength>.02){const a=w.noise()*Math.PI*2,r=(v.kind==='hovercraft'?1.8:2)*w.noise();const at=new T.Vector3(p.x+Math.cos(a)*r,ground+.15,p.z+Math.sin(a)*r)
        velocity.set(Math.cos(a)*strength*3,.5,Math.sin(a)*strength*3);w.dust.emit(at,velocity,1,.3+strength,2,dustColor)}
    }
    if(v.kind==='jet'||v.kind==='hovercraft'){
      const jet=v.kind==='jet',hover=jet&&!v.input.special,rate=100*rateScale
      if(this.exhaustTimer>=1/rate){
        const count=Math.min(12,Math.floor(this.exhaustTimer*rate));this.exhaustTimer=0
        for(let i=0;i<count;i++){
          // terra.jet main: life .3,size1,speed10; Hovercraft: .3,.8,7.
          const at=this.point(jet?0:.00962,jet?0:.672562,jet?2.971839:1.357518)
          const throttle=hover?.1:Math.max(.05,this.throttle)
          velocity.set(0,0,(jet?10:7)*throttle).applyQuaternion(this.q).add(new T.Vector3(raw.x,raw.y,raw.z))
          w.energy.emit(at,velocity,.3,(jet?1:.8)*Math.max(.2,throttle),-.95,this.color)
        }
        if(hover&&this.throttle>.01)for(const [x,z] of [[-1.544781,1.170159],[0,-1.735762],[1.455346,1.153567]]){
          // 25/s per thruster, life1, size max(.1,throttle*.3), lateral spread .4.
          if(w.noise()<.25){velocity.set((w.noise()-.5)*.8,-this.throttle,(w.noise()-.5)*.8).applyQuaternion(this.q).add(new T.Vector3(raw.x,raw.y,raw.z))
            w.energy.emit(this.point(x,-1.256482,z),velocity,1,Math.max(.1,this.throttle*.3),2,this.color)}
        }
      }
    }
    const trails=(this.buggy&&v.wingsOpen)||(v.kind==='jet'&&v.input.special&&speed>20)
    if(trails&&this.trailTimer>=.04/rateScale){
      this.trailTimer=0
      for(let i=0;i<2;i++){
        // These snapshots lack vehicle TrailRenderers. Reconstructed tips, width .1, lifetime .8.
        const tip=this.point((i?1:-1)*(this.buggy?(this.classic?3.6:4.2):3.85),this.buggy?.1:.13,this.buggy?1.2:1.14),prev=this.previousTips[i]
        if(prev){side.copy(tip).sub(prev).cross(w.game.camera.position.clone().sub(tip)).normalize();w.trails.add(prev,tip,side,.1,.8,.22,this.color.clone().multiplyScalar(2))}
        this.previousTips[i]=tip
      }
    }else if(!trails)this.previousTips.fill(null)
  }
  dispose(){this.unlisten?.();this.root.removeFromParent();this.headMaterial.dispose();this.tailMaterial.dispose();this.spot?.dispose()}
}

/** Attach after game.add(vehicle). Call the returned idempotent disposer BEFORE vehicle.dispose(). */
export function attachVehicleEffects(game:Game,terrain:Terrain,vehicle:Vehicle,options:{local:boolean}):()=>void{
  const world=worldFor(game)
  if(world.vehicles.has(vehicle))throw new Error('Vehicle effects already attached')
  const effects=new VehicleEffects(world,terrain,vehicle,options.local);world.vehicles.set(vehicle,effects);world.lamps.count=Math.min(512,world.vehicles.size*4);world.retain()
  let disposed=false
  return()=>{if(disposed)return;disposed=true;effects.dispose();world.vehicles.delete(vehicle);world.lamps.count=Math.min(512,world.vehicles.size*4);world.release()}
}

/** Visual hooks only. Networking retains projectile authority and audio ownership. */
export function createWeaponEffects(game:Game){
  const world=worldFor(game);world.retain();let disposed=false
  const green=new T.Color(.7,3,1),red=new T.Color(3,.15,.1)
  return {
    muzzle(position:T.Vector3,direction:T.Vector3,snipe=false){if(disposed)return;(snipe?world.redSparks:world.sparks).emit(position,direction.clone().multiplyScalar(2),.08,snipe?.7:.35,2,snipe?red:green)},
    impact(position:T.Vector3,hitNormal=new T.Vector3(0,1,0),snipe=false){
      if(disposed)return
      // PlasmaSparks.prefab: four particles,size .4-.7,lifetime .8,rnd velocity3,sizeGrow2.
      for(let i=0;i<4;i++){velocity.set((world.noise()-.5)*6,world.noise()*2,(world.noise()-.5)*6).addScaledVector(hitNormal,1)
        ;(snipe?world.redSparks:world.sparks).emit(position,velocity,.8,.4+world.noise()*.3,2,snipe?red:green)}
    },
    dispose(){if(!disposed){disposed=true;world.release()}},
  }
}

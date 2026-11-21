import {hotExposureDim} from '../skins/hotExposure'
import {headlightScale} from './headlights'
import {type ConeHaze,MAX_CONES,beamFactorFor,coneShapeFor,createConeBatch,createConeHaze,headlightCones,hideUnusedCones,writeVehicleCones} from './cones'
import {hazeNow} from '../../world/weather/fog'
import {activeFogBanks} from '../../world/weather/fogBanks'
/** The beam's colour (the spot lights', effects/index.ts). */
const CONE_COLOUR=new T.Color(1,.9965517,.875)
import * as T from 'three/webgpu'
import type {Game,System} from '../../core/Game'
import {qualityBudget,graphicsLevel} from '../../core/quality'
import type {Terrain} from '../../world/Terrain'
import type {TileShiftEvent,Vehicle,VehicleObjectEvents} from '../Vehicle'
import {ParticleBatch} from './ParticleBatch'
import {RibbonBatch} from './RibbonBatch'
import {dustSprite,glowSprite,plasmaSprite,tyreMarkAlpha} from './sprites'
import {DEFAULT_TREAD,DUSTS,TREADS} from './treads'
import {markRatio,surfaceTone} from './groundTone'
import {MARK_END_FADE,tyreMarkFadeIn,tyreMarkLife,tyreMarkSoftness,tyreMarkStrength} from './markParams'
import type {SurfaceKind} from '../../world/terrain/surface'
import {windDrift} from '../../world/weather'
import {warmGear} from '../../weapons/warm'

const greenPlasma=plasmaSprite(false),redPlasma=plasmaSprite(true)
/** Shares of the wind velocity given to a new dust particle and to exhaust and energy trails. */
export const DUST_WIND=.6,EXHAUST_WIND=.3

/** `width`: tyre width as a multiple of the standard tyre's (the buggy's tyre size); absent means 1. */
export interface WheelEffectContact {readonly grounded:boolean;readonly point:T.Vector3;readonly normal:T.Vector3;readonly slip:number;readonly width?:number}
type EffectsVehicle=Vehicle & {getWheelEffects?():readonly WheelEffectContact[];hoverMode?:boolean}
const worlds=new WeakMap<Game,EffectWorld>()
const clamp=T.MathUtils.clamp
/** Integer hashing keeps cosmetic emission reproducible without touching simulation randomness. */
export function effectNoise(i:number){let n=Math.imul(i+1,0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296}
const dustColor=new T.Color(.48,.27,.12),markColor=new T.Color(),groundDust=new T.Color()
/** Spray, not dust, off wet ground by the water: pale, and very little of it. */
const SPRAY=new T.Color(.72,.78,.84),WET_DUST=.08
/** The tank's two tracks: half the distance between them, metres, and their mark's width. */
const TANK_TRACK_X=1.05,TANK_MARK_WIDTH=.8
/** Quads kept per wheel for fading a mark's end: enough to cover the end fade. */
const RECENT=Math.ceil(MARK_END_FADE/.75)+1
const temp=new T.Vector3(),normal=new T.Vector3(),side=new T.Vector3(),velocity=new T.Vector3()
// Scratch for the per frame path, so a frame with nine vehicles allocates nothing here. Each is
// written and read within one statement or one loop pass; nothing keeps a reference to them.
const wp=new T.Vector3(),at=new T.Vector3(),tip=new T.Vector3(),rawVelocity=new T.Vector3(),toCamera=new T.Vector3(),inverse=new T.Quaternion(),trailColor=new T.Color()
/** terra.jet hover thrusters, local x and z. */
const HOVER_THRUSTERS:readonly (readonly [number,number])[]=[[-1.544781,1.170159],[0,-1.735762],[1.455346,1.153567]]

class EffectWorld implements System {
  readonly vehicles=new Map<Vehicle,VehicleEffects>()
  private references=0
  private level=-1
  private serial=0
  private unwarm?:()=>void
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
    // Every sprite and the tyre mark are generated in the shader (sprites.ts); nothing is loaded.
    this.marks=new RibbonBatch(1024,tyreMarkAlpha,false,MARK_END_FADE);this.trails=new RibbonBatch(256,undefined,true)
    this.lamps.frustumCulled=false;this.lamps.count=0
    this.lamps.setColorAt(0,new T.Color(0,0,0))
    this.lamps.onBeforeRender=()=>{this.lamps.material.color.setScalar(hotExposureDim(game.renderer.toneMappingExposure));let index=0;for(const e of this.vehicles.values())index=e.writeLamps(this.lamps,index);hideUnusedLamps(this.lamps,index);this.lamps.instanceMatrix.needsUpdate=true;if(this.lamps.instanceColor)this.lamps.instanceColor.needsUpdate=true}
    game.scene.add(this.lamps,this.marks.mesh,this.trails.mesh);this.rebudget();game.scene.userData.vehicleEffects=this.stats
    // Headlight cones in mist (cones.ts): every vehicle's front lamps, lit by the haze round them.
    this.coneHaze=createConeHaze()
    this.cones=createConeBatch(this.coneHaze)
    this.cones.onBeforeRender=(_r,_s,camera)=>{
      const eye=this.coneEye.setFromMatrixPosition(camera.matrixWorld)
      const h=hazeNow(this.coneHazeState),c=this.coneHaze
      c.hazeD.value=h.density;c.hazeH.value=h.height;c.sea.value=h.sea
      // The fog banks are looked up each frame: the Environment that owns them may start after this world.
      const banks=activeFogBanks()?.input as unknown as {map:{value:T.Texture},weights:{value:T.Vector2},invSize:{value:number}}|undefined
      if(banks){c.bankMap.value=banks.map.value;c.bankWeights.value.copy(banks.weights.value);c.bankInvSize.value=banks.invSize.value}
      else c.bankWeights.value.set(0,0)
      // The beam's dusk-to-dawn ramp, as the real spot lights use it (VehicleEffects.update).
      const night=clamp((.08-this.sunY())/.18,0,1)*headlightCones.value
      let index=0
      for(const e of this.vehicles.values())index=e.writeCones(this.cones,index,night,eye)
      hideUnusedCones(this.cones,index)
      this.cones.instanceMatrix.needsUpdate=true;if(this.cones.instanceColor)this.cones.instanceColor.needsUpdate=true
    }
    game.scene.add(this.cones)
  }
  readonly cones:T.InstancedMesh
  private readonly coneHaze:ConeHaze
  private readonly coneHazeState={density:0,height:40,sea:0}
  private readonly coneEye=new T.Vector3()
  registerWarm(){
    // Particles, lamps and cones already submit their live meshes. Empty ribbons have
    // no triangles to submit until this covered draw.
    this.unwarm=warmGear(this.game,[],undefined,()=>[this.marks.mesh,this.trails.mesh])
  }
  retain(){this.references++}
  release(){if(--this.references===0){worlds.delete(this.game);this.game.remove(this)}}
  private rebudget(){
    this.level = graphicsLevel.value
    const octaves = this.level === 0 ? 1 : 2
    const budget = Math.floor(qualityBudget().particles * .25)
    const batch = (current: ParticleBatch | undefined, capacity: number, sprite: typeof dustSprite, additive: boolean) => {
      if (current) {
        current.resetCapacity(capacity, octaves)
        return current
      }
      const next = new ParticleBatch(capacity, sprite, additive, octaves)
      this.game.scene.add(next.mesh)
      return next
    }
    this.dust = batch(this.dust, Math.floor(budget * .6), dustSprite, false)
    this.energy = batch(this.energy, Math.floor(budget * .3), glowSprite, true)
    this.sparks = batch(this.sparks, Math.max(2, Math.floor(budget * .05)), greenPlasma, true)
    this.redSparks = batch(this.redSparks, Math.max(2, Math.floor(budget * .05)), redPlasma, true)
    // Dust and exhaust lean downwind with the weather; weapon sparks are too brief to. Tyre
    // marks are on the ground and take none.
    this.dust.windShare=DUST_WIND;this.dust.drift=windDrift;this.energy.windShare=EXHAUST_WIND;this.energy.drift=windDrift
    this.stats.particles=this.dust.capacity+this.energy.capacity+this.sparks.capacity+this.redSparks.capacity
  }
  noise(){return effectNoise(this.serial++)}
  puff(p:T.Vector3,strength=1,color:T.Color=dustColor){
    const n=Math.round((Number(graphicsLevel.value)===0?3:8)*strength)
    for(let i=0;i<n;i++){const a=this.noise()*Math.PI*2;velocity.set(Math.cos(a)*strength,1+this.noise(),Math.sin(a)*strength);this.dust.emit(p,velocity,1,.4+this.noise()*.4,2,color)}
  }
  /** Carry everything already drawn across a world seam with the local player (see VehicleEffects.onTileShift). */
  shift(dx:number,dz:number){this.dust.shift(dx,dz);this.energy.shift(dx,dz);this.sparks.shift(dx,dz);this.redSparks.shift(dx,dz);this.marks.shift(dx,dz);this.trails.shift(dx,dz)}
  private sky:(T.Object3D&{sunDirection?:{value:T.Vector3}})|null=null
  /** Height of the sun, for the headlights. The sky is found once and looked up again only if it leaves the scene. */
  sunY():number {
    if(this.sky?.parent!==this.game.scene)this.sky=(this.game.scene.children.find(o=>'sunDirection' in o)??null) as typeof this.sky
    return this.sky?.sunDirection?.value.y??1
  }
  postPhysics(){for(const e of this.vehicles.values())e.captureLanding()}
  update(dt:number){
    const start=performance.now();dt=Math.min(.1,dt);this.clock+=dt
    if(this.level!==graphicsLevel.value)this.rebudget()
    const clock=this.clock;this.dust.clock.value=clock;this.energy.clock.value=clock;this.sparks.clock.value=clock;this.redSparks.clock.value=clock;this.marks.clock.value=clock;this.trails.clock.value=clock
    this.marks.strength.value=tyreMarkStrength.value;this.marks.softness.value=tyreMarkSoftness.value;this.marks.fadeIn.value=tyreMarkFadeIn.value
    this.marks.expire();this.trails.expire()
    for(const e of this.vehicles.values())e.update(dt)
    this.stats.vehicles=this.vehicles.size;this.stats.marks=this.marks.used
    this.stats.emitted=this.dust.emitted+this.energy.emitted+this.sparks.emitted+this.redSparks.emitted
    this.stats.updateMs=performance.now()-start;this.stats.peakUpdateMs=Math.max(this.stats.peakUpdateMs,this.stats.updateMs)
  }
  dispose(){this.unwarm?.();this.lamps.removeFromParent();this.lamps.geometry.dispose();this.lamps.material.dispose();this.cones.removeFromParent();this.cones.geometry.dispose();(this.cones.material as T.Material).dispose();for(const e of this.vehicles.values())e.dispose();this.vehicles.clear();for(const b of [this.dust,this.energy,this.sparks,this.redSparks,this.marks,this.trails])b.dispose();delete this.game.scene.userData.vehicleEffects}
}
function worldFor(game:Game){let w=worlds.get(game);if(!w){w=new EffectWorld(game);worlds.set(game,w);game.add(w, 'Vehicle effects');w.registerWarm()}return w}

/** Keep the existing road lights in the scene when ride view hides their vehicle.
 * Sample the final drawn pose and visibility after the vehicle and camera have updated. */
class HeadlightRig extends T.Group {
  beamIntensity=0
  constructor(private readonly anchor:T.Object3D){
    super()
    this.matrixWorldAutoUpdate=false
  }
  override updateMatrixWorld(force?:boolean){
    this.anchor.updateWorldMatrix(true,false)
    this.matrixWorld.copy(this.anchor.matrixWorld)
    let parent:T.Object3D|null=this.anchor
    while(parent && parent!==this.parent && parent.visible)parent=parent.parent
    const intensity=parent===this.parent ? this.beamIntensity : 0
    // Swaps move the same emitters to the next rig. Only their current owner writes them.
    for(const child of this.children)if(child instanceof T.SpotLight)child.intensity=intensity
    super.updateMatrixWorld(force)
  }
}

class VehicleEffects {
  private readonly root=new T.Group()
  private readonly headMaterial=new T.MeshBasicMaterial({color:new T.Color(2.447059,2.858824,3)})
  private readonly tailMaterial=new T.MeshBasicMaterial({color:new T.Color(2,0,0)})
  private readonly lampPoints:T.Object3D[]=[]
  private readonly lampMatrix=new T.Matrix4()
  private readonly spots:T.SpotLight[]=[]
  private readonly headlightRig?:HeadlightRig
  private readonly ownsSpots:boolean
  // Last tyre mark and wing tip positions, kept in place; the flags say which are live.
  private readonly previousMarks=[new T.Vector3(),new T.Vector3(),new T.Vector3(),new T.Vector3()]
  private readonly hasMark=[false,false,false,false]
  // Per wheel: metres since its mark began, the alpha, tint and clock time where it last left
  // off, how much it is sliding (smoothed, so a mark strengthens gradually), its live head quad
  // (stretched from the last committed point to the tyre every frame) and its last few quads,
  // so the mark's end can be faded where the wheel lifts or stops.
  private readonly runLength=[0,0,0,0]
  private readonly lastAlpha=[0,0,0,0]
  private readonly lastBorn=[0,0,0,0]
  private readonly head=[-1,-1,-1,-1]
  private readonly lastTint=[new T.Color(),new T.Color(),new T.Color(),new T.Color()]
  private readonly slide=[0,0,0,0]
  private readonly recentId=new Float64Array(4*RECENT)
  private readonly recentStart=new Float32Array(4*RECENT*2)
  private readonly recentCount=[0,0,0,0]
  private readonly previousTips=[new T.Vector3(),new T.Vector3()]
  private readonly hasTip=[false,false]
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
  private readonly onTileShift:(e:TileShiftEvent)=>void
  private readonly buggy:boolean
  constructor(private readonly world:EffectWorld,private readonly terrain:Terrain,private readonly vehicle:EffectsVehicle,private readonly local:boolean,sharedSpots?:T.SpotLight[]){
    this.ownsSpots=!sharedSpots
    this.buggy=vehicle.kind.startsWith('buggy')
    this.root.name='Vehicle effects';vehicle.object.add(this.root);this.lastPosition.copy(vehicle.object.position)
    // Hovercraft points are for the generated Lowwing body (hovergen h4-low), from its lead: lamps
    // on the nose bar at (+/-.6,.215,-2.03) and the stern bars at (+/-.6,.35,1.7).
    const jet=vehicle.kind==='jet',hover=vehicle.kind==='hovercraft',width=jet?1:hover?.6:.584,front=jet?3.2756:hover?2.03:1.775
    for(const sign of [-1,1]){
      const head=new T.Object3D();head.position.set(sign*width,jet?-.423:hover?.215:.036,-front);this.root.add(head);this.lampPoints.push(head)
      const tail=new T.Object3D();tail.scale.set(1.7,.6,.5);tail.position.set(sign*width,hover?.35:.12,jet?2.7:1.7);this.root.add(tail);this.lampPoints.push(tail)
    }
    if(local){
      this.headlightRig=new HeadlightRig(this.root)
      world.game.scene.add(this.headlightRig)
      // Syn3h prefab range50, cone60 degrees. Unity intensity is not candela.
      // Aim farther down the road and use candela suitable for inverse-square falloff.
      // Each buggy lamp casts its own beam. Split the old total intensity between them
      // so the overlap on the road does not double the exposure. Other vehicles keep
      // their existing central beam until their individual lighting is tuned.
      for(const [i,x] of (sharedSpots?[-width,width]:this.buggy?[-width,width]:[0]).entries()){
        const spot=sharedSpots?.[i]??new T.SpotLight(new T.Color(1,.9965517,.875),0,50,Math.PI/6,.45,2)
        spot.name=this.buggy?(x<0?'Left headlight':'Right headlight'):'Headlight'
        spot.position.set(x,hover?.23:this.buggy?.036:.35,hover?-1.85:-front);spot.target.position.set(x,-.8,-22);spot.castShadow=false
        this.spots.push(spot);this.headlightRig.add(spot,spot.target)
      }
    }
    this.unlisten=terrain.onRegenerate?.(()=>{this.reset();world.marks.clear();world.trails.clear()})
    // A world seam. The terrain moves the local player a whole tile and redraws the world around
    // it, so everything already drawn moves the same way, and so does this vehicle's history, so
    // its marks and trails carry on unbroken. Any other vehicle shifted here is being re-imaged
    // near the player: what it left behind stays put and its history resets, as it would after
    // any long move. Nothing runs on frames without a shift.
    this.onTileShift=({dx,dz})=>{
      if(local){
        world.shift(dx,dz)
        for(const q of this.previousMarks){q.x+=dx;q.z+=dz}
        for(const q of this.previousTips){q.x+=dx;q.z+=dz}
        this.lastPosition.x+=dx;this.lastPosition.z+=dz
      }else{this.reset();this.lastPosition.copy(vehicle.object.position)}
    }
    this.events.addEventListener('tileshift',this.onTileShift)
  }
  private get events(){return this.vehicle.object as T.Object3D<VehicleObjectEvents>}
  /** This vehicle's headlight cones (cones.ts) at `night` (the beam ramp times the cone setting). */
  writeCones(batch:T.InstancedMesh,index:number,night:number,camera:T.Vector3):number {
    // Each kind's beam has its own shape (cones.ts CONE_SHAPES). Every buggy draws one; the
    // hovercraft and jet only for the player's own vehicle, since bots' lamps belong to the
    // headlights lane, which can enable them per kind through the same shapes and batch.
    const shape=coneShapeFor(this.vehicle.kind)
    if(!shape||(!this.buggy&&!this.local))return index
    this.root.updateWorldMatrix(true,true)
    // The beam follows its lamp (the buggy's headlight setting; others' lamps are 1) times the
    // kind's beam-only factor (cones.ts beamFactorFor). The lamps themselves are untouched.
    return writeVehicleCones(batch,index,this.vehicle.object,this.lampPoints,CONE_COLOUR,night*(this.buggy?headlightScale().beam:1)*beamFactorFor(this.vehicle.kind),this.lampMatrix,camera,shape)
  }
  writeLamps(batch:T.InstancedMesh,index:number):number {
    this.root.updateWorldMatrix(true,true)
    return writeVehicleLamps(batch,index,this.vehicle.object,this.lampPoints,this.headMaterial.color,this.tailMaterial.color,this.lampMatrix)
  }
  captureLanding(){if(this.vehicle.landedThisStep)this.pendingLanding=Math.max(this.pendingLanding,this.vehicle.landingImpact)}
  private reset(){this.pendingLanding=0;for(let i=0;i<4;i++)this.endMark(i);this.hasTip.fill(false);this.wasGrounded=false}
  /** Wheel `i`'s mark ends here: its last metre fades out instead of stopping square. */
  private endMark(i:number){
    if(!this.hasMark[i])return
    this.hasMark[i]=false
    // The head quad, if one is drawn, is the mark's last stretch.
    if(this.head[i]>=0){this.remember(i,this.head[i],this.runLength[i],this.headEnd[i]);this.head[i]=-1}
    const end=this.headEnd[i]
    for(let k=0;k<this.recentCount[i];k++){
      const r=i*RECENT+k
      this.world.marks.endAt(this.recentId[r],end-this.recentStart[r*2],end-this.recentStart[r*2+1])
    }
    this.recentCount[i]=0
  }
  /** Where wheel `i`'s head quad reaches, metres from where its mark began. */
  private readonly headEnd=[0,0,0,0]
  /** Keep quad `id` (metres `start` to `end` of wheel `i`'s mark) among its last few, newest last. */
  private remember(i:number,id:number,start:number,end:number){
    let n=this.recentCount[i]
    if(n===RECENT){for(let k=1;k<RECENT;k++){const a=i*RECENT+k;this.recentId[a-1]=this.recentId[a];this.recentStart[(a-1)*2]=this.recentStart[a*2];this.recentStart[(a-1)*2+1]=this.recentStart[a*2+1]}n--}
    const r=i*RECENT+n;this.recentId[r]=id;this.recentStart[r*2]=start;this.recentStart[r*2+1]=end;this.recentCount[i]=n+1
  }
  /** Ground within a little of the water's surface: wet. Lava shores are scorched rock instead. */
  private wet(p:T.Vector3,ground:number,kind:SurfaceKind){return kind!=='rock'&&(this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity)>ground-.6}
  /** The dust colour of the ground at `p`, into `out`. */
  private dustAt(p:T.Vector3,out:T.Color):number {
    const kind=(this.terrain.surfaceAt?.(p.x,p.z)??'dust') as SurfaceKind,style=DUSTS[kind]
    if(this.wet(p,this.terrain.heightAt(p.x,p.z),kind)){out.copy(SPRAY);return WET_DUST}
    const c=surfaceTone(this.terrain.lookIndex?.()??0,kind,style,1);out.setRGB(c[0],c[1],c[2])
    return style.amount
  }
  private dry(p:T.Vector3){return (this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity)<this.terrain.heightAt(p.x,p.z)-.01}
  private point(x:number,y:number,z:number,out:T.Vector3){return out.set(x,y,z).applyQuaternion(this.vehicle.object.quaternion).add(this.vehicle.object.position)}
  update(dt:number){
    const v=this.vehicle,w=this.world,p=v.object.position
    if(p.distanceToSquared(this.lastPosition)>900)this.reset()
    this.lastPosition.copy(p);this.q.copy(v.object.quaternion)
    const raw=v.body.linvel(),speed=Math.hypot(raw.x,raw.y,raw.z)
    rawVelocity.set(raw.x,raw.y,raw.z)
    this.localVelocity.copy(rawVelocity).applyQuaternion(inverse.copy(this.q).invert())
    this.throttle=T.MathUtils.lerp(this.throttle,Math.max(0,v.kind==='hovercraft'?v.input.y:v.input.z),Math.min(1,dt*10))
    this.color.set(v.colors.accent)
    this.tailMaterial.color.setRGB(v.input.brakes?5:2,0,0)
    if(this.headlightRig){
      const sunY=w.sunY()
      // The buggy's beam follows the headlight setting (headlights.ts); other kinds are unchanged.
      const intensity=clamp((.08-sunY)/.18,0,1)*(v.kind==='jet'?1800:1600)/this.spots.length*(this.buggy?headlightScale().beam:1)
      this.headlightRig.beamIntensity=intensity
    }
    // A sealed zorb has no running engine plume or tyre contact. Keep lamps current above;
    // particles already in flight finish their bounded lifetime.
    if(v.zorbed){this.reset();return}
    // Suppress distant emissions. Existing particles continue their bounded shader lifetime.
    if(p.distanceToSquared(w.game.camera.position)>qualityBudget().drawDistance**2)return
    this.dustTimer+=dt;this.exhaustTimer+=dt;this.trailTimer+=dt
    const rateScale=Number(graphicsLevel.value)===0?.25:Number(graphicsLevel.value)===1?.5:1
    const ground=this.terrain.heightAt(p.x,p.z),height=p.y-ground
    const grounded=v.wheelsGrounded>0
    const impact=this.pendingLanding||(!this.buggy&&grounded&&!this.wasGrounded?-this.lastVertical:0)
    if(impact>2&&this.dry(p)){const at=new T.Vector3(p.x,ground+.15,p.z),amount=this.dustAt(at,groundDust);w.puff(at,Math.min(2,impact/8)*Math.min(1,.4+amount*.6),groundDust)}
    this.pendingLanding=0
    const liquid=this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity,inside=p.y<liquid+.15
    if(inside&&!this.inLiquid){const kind=(this.terrain as Terrain & {liquidKindAt?(x:number,z:number):string|null}).liquidKindAt?.(p.x,p.z)
      w.puff(new T.Vector3(p.x,liquid+.2,p.z),1.5,new T.Color(kind==='water'?.5:.65,kind==='water'?.7:.6,kind==='water'?.8:.55))}
    this.inLiquid=inside
    this.wasGrounded=grounded;this.lastVertical=raw.y
    const tank=v.kind==='tank'
    if(this.buggy||tank){
      const contacts=this.buggy?v.getWheelEffects?.():undefined
      const wheels=tank?2:4,strength=tyreMarkStrength.value,lifeScale=tyreMarkLife.value
      const look=this.terrain.lookIndex?.()??0,dustDue=this.dustTimer>=1/(25*rateScale)&&speed>2
      for(let i=0;i<wheels;i++){
        const contact=contacts?.[i]
        if(contact)wp.copy(contact.point)
        else if(tank)this.point(i?TANK_TRACK_X:-TANK_TRACK_X,0,0,wp)
        else this.point((i%2?1:-1)*1.1,0,(i<2?-1:1)*1.3,wp)
        const y=this.terrain.heightAt(wp.x,wp.z)
        const touching=contact?.grounded??(grounded&&wp.y-y<1.4&&wp.y-y>-.3)
        if(!touching||!this.dry(wp)||speed<.5){this.endMark(i);continue}
        normal.copy(contact?.normal??this.terrain.normalAt(wp.x,wp.z,temp));if(!contact)wp.y=y
        wp.addScaledVector(normal,.04)
        // One lookup per wheel per frame decides the mark and the dust (treads.ts, groundTone.ts).
        const kind=(this.terrain.surfaceAt?.(wp.x,wp.z)??'dust') as SurfaceKind,wet=this.wet(wp,y,kind)
        const slip=Math.abs(contact?.slip??this.localVelocity.x)
        // Faint rolling, stronger sliding sideways under throttle, or braking; eased, so the
        // mark darkens and fades along its length rather than in steps.
        const sliding=slip>Math.abs(this.localVelocity.z)*.3?clamp(Math.max(Math.abs(v.input.y),v.input.brakes?1:0),0,1):0
        const target=Math.max(sliding,v.input.brakes&&speed>3?.8:0)
        this.slide[i]+=(target-this.slide[i])*Math.min(1,dt*5)
        if(strength>0){
          const style=this.terrain.surfaceAt?TREADS[kind]:DEFAULT_TREAD
          // Wet ground by the water takes a darker, firmer print.
          const alpha=T.MathUtils.lerp(style.roll,style.slip,this.slide[i])*(wet?1.15:1)
          // The mark's tone relative to the ground (groundTone.markRatio): the renderer
          // multiplies the lit ground under it by this. A sliding or braking wheel churns the
          // ground darker still; frost stays pale.
          const c=markRatio(look,kind,style),dim=(wet?.85:1)*(style.frost?1:1-.3*this.slide[i])
          markColor.setRGB(c[0]<1?c[0]*dim:c[0],c[1]<1?c[1]*dim:c[1],c[2]<1?c[2]*dim:c[2])
          const prev=this.previousMarks[i]
          if(!this.hasMark[i]){
            prev.copy(wp);this.hasMark[i]=true;this.runLength[i]=this.headEnd[i]=0;this.recentCount[i]=0;this.head[i]=-1
            this.lastAlpha[i]=alpha;this.lastTint[i].copy(markColor);this.lastBorn[i]=w.clock
          }else{
            const step=prev.distanceTo(wp)
            // Every frame the head quad stretches from the last committed point to the tyre,
            // so the track grows continuously from the contact; its newest end is laid now and
            // eases in over the fade-in time (RibbonBatch, markEnvelope). Once it is a segment
            // long it is committed as it stands and the next head starts from its end: nothing
            // is redrawn, so nothing steps. Longer segments at speed: a straight run at 20 m/s
            // keeps about 500 m of track per wheel in the shared ring instead of 190.
            if(step>=.05){
              side.copy(wp).sub(prev).cross(normal).normalize()
              const start=this.runLength[i],end=start+step
              const id=w.marks.mark(prev,wp,side,.5*style.width*(tank?TANK_MARK_WIDTH/.5:contact?.width??1),style.life*lifeScale,this.lastAlpha[i],alpha,this.lastTint[i],markColor,style.tread,start,end,this.lastBorn[i],this.head[i])
              this.head[i]=id;this.headEnd[i]=end
              if(id>=0&&step>=clamp(speed*.1,.75,2.5)){
                this.remember(i,id,start,end);this.head[i]=-1
                this.runLength[i]=end;this.lastAlpha[i]=alpha;this.lastTint[i].copy(markColor);this.lastBorn[i]=w.clock;prev.copy(wp)
              }
            }
          }
        }else this.endMark(i)
        if(dustDue){
          // Colour, amount, size and how long it hangs come from the ground, set once per particle.
          const ds=DUSTS[kind],amount=wet?WET_DUST:ds.amount
          if(wet)groundDust.copy(SPRAY);else{const c=surfaceTone(look,kind,ds,1);groundDust.setRGB(c[0],c[1],c[2])}
          const n=Math.floor(amount)+(w.noise()<amount%1?1:0),scale=ds.size/.3
          for(let k=0;k<n;k++){
            velocity.set(raw.x*-.08+(w.noise()-.5)*slip*.3,ds.rise+w.noise()*ds.rise*1.6,raw.z*-.08)
            w.dust.emit(wp,velocity,ds.life,(.25+Math.min(1,slip*.08+speed*.008))*scale,2*scale,groundDust)
          }
        }
      }
      if(this.dustTimer>=1/(25*rateScale))this.dustTimer=0
    }else if((v.kind==='hovercraft'||v.kind==='jet'&&!v.input.special)&&height<20&&height>0&&this.dry(p)&&this.dustTimer>=1/(50*rateScale)){
      this.dustTimer=0;const strength=clamp(1-height/20,0,1)*(v.kind==='jet'?this.throttle:1)
      if(strength>.02){const a=w.noise()*Math.PI*2,r=(v.kind==='hovercraft'?1.8:2)*w.noise();const at=new T.Vector3(p.x+Math.cos(a)*r,ground+.15,p.z+Math.sin(a)*r)
        // The ground under the craft colours the dust and says how much of it there is.
        const amount=this.dustAt(at,groundDust)
        if(w.noise()<Math.min(1,amount)){velocity.set(Math.cos(a)*strength*3,.5,Math.sin(a)*strength*3);w.dust.emit(at,velocity,1,.3+strength,2,groundDust)}}
    }
    if(v.kind==='jet'||v.kind==='hovercraft'){
      const jet=v.kind==='jet',hover=jet&&!v.input.special,rate=100*rateScale
      if(this.exhaustTimer>=1/rate){
        const count=Math.min(12,Math.floor(this.exhaustTimer*rate));this.exhaustTimer=0
        for(let i=0;i<count;i++){
          // terra.jet main: life .3,size1,speed10; Hovercraft: .3,.8,7.
          // Hovercraft: the centre of the duct lip on the generated body.
          this.point(0,jet?0:.395,jet?2.971839:2,at)
          const throttle=hover?.1:Math.max(.05,this.throttle)
          velocity.set(0,0,(jet?10:7)*throttle).applyQuaternion(this.q).add(rawVelocity)
          w.energy.emit(at,velocity,.3,(jet?1:.8)*Math.max(.2,throttle),-.95,this.color)
        }
        if(hover&&this.throttle>.01)for(const [x,z] of HOVER_THRUSTERS){
          // 25/s per thruster, life1, size max(.1,throttle*.3), lateral spread .4.
          if(w.noise()<.25){velocity.set((w.noise()-.5)*.8,-this.throttle,(w.noise()-.5)*.8).applyQuaternion(this.q).add(rawVelocity)
            w.energy.emit(this.point(x,-1.256482,z,at),velocity,1,Math.max(.1,this.throttle*.3),2,this.color)}
        }
      }
    }
    const trails=(this.buggy&&v.wingsOpen)||(v.kind==='jet'&&v.input.special&&speed>20)
    if(trails&&this.trailTimer>=.04/rateScale){
      this.trailTimer=0
      for(let i=0;i<2;i++){
        const prev=this.previousTips[i]
        if(this.buggy){
          // Follow the skin's current deformed wing, including its active detail level.
          // Never bridge a missing/closed wing to its next available trail point.
          if(!v.getWingTip(i?1:-1,tip)){this.hasTip[i]=false;continue}
          this.point(tip.x,tip.y,tip.z,tip)
        }else this.point((i?1:-1)*3.85,.13,1.14,tip)
        if(this.hasTip[i]){side.copy(tip).sub(prev).cross(toCamera.copy(w.game.camera.position).sub(tip)).normalize();w.trails.add(prev,tip,side,.1,.8,.22,trailColor.copy(this.color).multiplyScalar(2))}
        prev.copy(tip);this.hasTip[i]=true
      }
    }else if(!trails)this.hasTip.fill(false)
  }
  dispose(){this.unlisten?.();this.events.removeEventListener('tileshift',this.onTileShift);this.root.removeFromParent();this.headlightRig?.removeFromParent();this.headMaterial.dispose();this.tailMaterial.dispose();if(this.ownsSpots)for(const spot of this.spots)spot.dispose()}
}

/**
 * Write one vehicle's lamp blobs into the shared batch and return the next free slot.
 * A skin whose own mesh carries emissive headlight and tail light faces sets
 * `object.userData.ownLamps = true`; such a vehicle writes no blobs. The flag is read every
 * frame because skins set it after their model loads. The road spotlight is separate and stays.
 */
export function writeVehicleLamps(batch:T.InstancedMesh,index:number,object:T.Object3D,points:readonly T.Object3D[],head:T.Color,tail:T.Color,scratch=new T.Matrix4()):number {
  if(object.userData.ownLamps===true)return index
  for(let i=0;i<points.length&&index<512;i++,index++){
    scratch.copy(points[i].matrixWorld)
    if(!object.visible)scratch.makeScale(0,0,0)
    batch.setMatrixAt(index,scratch);batch.setColorAt(index,i%2?tail:head)
  }
  return index
}
const noLamp=new T.Matrix4().makeScale(0,0,0)
/** The batch draws four slots per attached vehicle. Collapse the ones no vehicle wrote this frame. */
export function hideUnusedLamps(batch:T.InstancedMesh,index:number):void {
  for(let i=index;i<batch.count;i++)batch.setMatrixAt(i,noLamp)
}

/** Attach after game.add(vehicle). Call the returned idempotent disposer BEFORE vehicle.dispose(). */
export function attachVehicleEffects(game:Game,terrain:Terrain,vehicle:Vehicle,options:{local:boolean;spots?:T.SpotLight[]}):()=>void{
  const world=worldFor(game)
  if(world.vehicles.has(vehicle))throw new Error('Vehicle effects already attached')
  const effects=new VehicleEffects(world,terrain,vehicle,options.local,options.spots);world.vehicles.set(vehicle,effects);world.lamps.count=Math.min(512,world.vehicles.size*4);world.cones.count=Math.min(MAX_CONES,world.vehicles.size*2);world.retain()
  let disposed=false
  return()=>{if(disposed)return;disposed=true;effects.dispose();world.vehicles.delete(vehicle);world.lamps.count=Math.min(512,world.vehicles.size*4);world.cones.count=Math.min(MAX_CONES,world.vehicles.size*2);world.release()}
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

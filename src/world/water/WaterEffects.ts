import * as THREE from 'three/webgpu'
import { Vector3 } from 'three/webgpu'
import type { Game, System } from '../../core/Game'
import type { Terrain } from '../Terrain'
import { applyWaterQuery } from './params'
import type { Vehicle, VehicleObjectEvents } from '../../vehicles/Vehicle'
import type { PlayerSlot } from '../../vehicles/PlayerSlot'
import { net } from '../../net'
import { nearestImage } from '../../../shared/wrap'
import { Ripples, rippleField, waterRipples } from './ripples'
import { Spray, waterSpray, waterWakeRipple, waterWakeRippleWidth } from './spray'
import { setSplash } from './splash'
import { Underwater, cameraMedium, waterUnderwater } from './underwater'
import { Motes } from './motes'
import { setLavaSunk } from '../../fx/material'
import { Waterline } from './waterline'
import { UnderwaterBubbles } from './bubbles'
import { lensWash, newLensState, stepLens } from './underwaterCamera'
import { camMode } from '../../core/ChaseCamera'
import { easeWake, submergedFraction, verticalHalfExtent, wakePresence } from './waterEffectsMath'
import { AcrossSurface } from './acrossSurface'

/** Heights (m) of a hovercraft's hull and of a jet above the liquid where they stop disturbing it. */
const HOVER_REACH=6,JET_REACH=5
/** Metres from the camera within which transparent vehicle parts are sorted against the water. */
const SORT_REACH=400

/**
 * A collider's shape as a box in its own frame (centre and half extents), measured once: reading
 * a shape back from Rapier builds it anew, so it is never read per frame. Null for shapes with
 * no bounded extent here (a height field, a half space).
 */
type LocalBox={c:{x:number;y:number;z:number};h:{x:number;y:number;z:number}}
const localBoxes=new WeakMap<object,LocalBox|null>()
function localBox(c:{shape:unknown}):LocalBox|null{
  let box=localBoxes.get(c)
  if(box!==undefined)return box
  const s=c.shape as {type:number;radius?:number;halfHeight?:number;halfExtents?:{x:number;y:number;z:number};vertices?:Float32Array;borderRadius?:number}
  const r=s.borderRadius??0,at0={x:0,y:0,z:0}
  box=null
  if(s.halfExtents)box={c:at0,h:{x:s.halfExtents.x+r,y:s.halfExtents.y+r,z:s.halfExtents.z+r}}
  else if(s.vertices&&s.vertices.length>=3){
    const v=s.vertices,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity]
    for(let i=0;i<v.length;i++){const k=i%3;lo[k]=Math.min(lo[k],v[i]);hi[k]=Math.max(hi[k],v[i])}
    box={c:{x:(lo[0]+hi[0])/2,y:(lo[1]+hi[1])/2,z:(lo[2]+hi[2])/2},h:{x:(hi[0]-lo[0])/2+r,y:(hi[1]-lo[1])/2+r,z:(hi[2]-lo[2])/2+r}}
  }else if(s.radius!==undefined){
    // A ball, or a capsule, cylinder or cone along its local y.
    const hh=(s.halfHeight??0)+(s.type===2?s.radius:0)
    box={c:at0,h:{x:s.radius+r,y:(s.halfHeight!==undefined?hh:s.radius)+r,z:s.radius+r}}
  }
  localBoxes.set(c,box)
  return box
}

/** Register after Environment and ChaseCamera. The live net binding includes later joins. */
/** Seconds clear of the water before a skip's touchdown splashes again (src/vehicles/skip.ts). */
const SKIP_TOUCHDOWN_GAP=.15

export class WaterEffects implements System {
  /** When each vehicle last planed on the water, by this system's clock. */
  private readonly planingAt=new WeakMap<object,number>()
  private time=0
  readonly ripples:Ripples
  readonly spray:Spray
  /** Molten spray and glowing wakes for vehicles in lava. */
  readonly lavaSpray:Spray
  readonly underwater:Underwater
  readonly bubbles:UnderwaterBubbles
  readonly motes:Motes
  readonly waterline:Waterline
  private size=-1
  /** Each vehicle's shown wake, 0 to 1 (wakePresence, eased). */
  private readonly wake=new WeakMap<Vehicle,number>()
  private ids=new WeakMap<Vehicle,string>()
  private serial=0
  private point=new Vector3()
  private velocity=new Vector3()
  private readonly shape:{ball:number;air:'cushion'|'downwash'|null;near:number;beam:number;mass:number}={ball:0,air:null,near:0,beam:1,mass:30}
  constructor(private game:Game,private terrain:Terrain,private slot:PlayerSlot,private bots:{readonly vehicles:readonly Vehicle[]}){
    this.ripples=rippleField;this.ripples.attach(game.renderer);this.spray=new Spray(game.scene,this.ripples,terrain);this.lavaSpray=new Spray(game.scene,this.ripples,terrain,'lava');this.underwater=new Underwater(game,terrain);this.bubbles=new UnderwaterBubbles(game.scene,terrain,game.camera)
    this.motes=new Motes(game.scene);this.waterline=new Waterline(game.scene)
    // A world seam moves the player a whole tile and the world is redrawn round it: spray left
    // behind moves the same way. (The ripple field wraps at the tile, so it needs nothing.)
    this.listen(slot.current,true)
    // The player changed vehicle: follow the seam shifts of the new one.
    this.unfollow=slot.onChange((next,previous)=>{this.listen(previous,false);this.listen(next,true)})
    // A shot hitting the surface splashes through the same sprays (splash.ts).
    setSplash(game,(at,kind,speed)=>(kind==='lava'?this.lavaSpray:this.spray).impact(at,speed))
  }
  private onTileShift=({dx,dz}:{dx:number;dz:number})=>{this.spray.shift(dx,dz);this.lavaSpray.shift(dx,dz)}
  /** `?water=1` preview switch: applied once play has begun, after any room state lands. */
  private queryApplied=false
  update(dt:number){
    this.time+=Math.max(0,dt)
    if(!this.queryApplied&&this.game.time>2){this.queryApplied=true;applyWaterQuery()}
    const {game,terrain}=this,size=terrain.wrapSize??terrain.size
    if(size!==this.size){this.size=size;this.ripples.configure(size)}
    this.spray.update(dt);this.lavaSpray.update(dt)
    if(waterSpray.value||waterRipples.value){
      const vehicles=new Set<Vehicle>([this.player,...(net?net.audibleVehicles():this.bots.vehicles)])
      for(const v of vehicles){
        if(!game.world.getRigidBody(v.body.handle))continue
        const p=v.body.translation(),camera=game.camera.position
        const x=nearestImage(p.x,camera.x,size),z=nearestImage(p.z,camera.z,size)
        const kind=terrain.liquidKindAt?.(x,z)
        if(Math.hypot(x-camera.x,z-camera.z)>150||!kind)continue
        const surface=terrain.liquidHeightAt?.(x,z)??-Infinity
        if(!Number.isFinite(surface))continue
        // Use oriented chassis cuboids, excluding wheels and the optional zorb ball.
        let bottom=Infinity,top=-Infinity
        for(let i=0;i<v.body.numColliders();i++){
          const c=v.body.collider(i),h=c.halfExtents()
          if(!h||c.isSensor())continue
          const half=verticalHalfExtent(h,c.rotation()),y=c.translation().y
          bottom=Math.min(bottom,y-half);top=Math.max(top,y+half)
        }
        // How high the craft's own hull rides above the liquid, for a cushion or a downwash.
        const clearance=bottom-surface
        // Its real top and height, the ball's included, before the envelope below: a vehicle
        // whose top has gone under makes no wake, cushion or downwash (wakePresence), eased so
        // bobbing at the surface does not flicker it. Bubbles (trailBubbles) are not touched.
        // Every solid collider counts here, whatever its shape: the buggy's hull is a convex
        // hull (no half extents) standing well above the thin plate the cuboids describe.
        let realTop=top,realBottom=bottom
        for(let i=0;i<v.body.numColliders();i++){
          const c=v.body.collider(i);if(c.isSensor())continue
          const box=localBox(c);if(!box)continue
          const q=c.rotation(),t=c.translation()
          // The box centre's height after the collider's rotation, and its half height.
          const cy=t.y+2*(q.x*q.y+q.w*q.z)*box.c.x+(1-2*(q.x*q.x+q.z*q.z))*box.c.y+2*(q.y*q.z-q.w*q.x)*box.c.z,half=verticalHalfExtent(box.h,q)
          realTop=Math.max(realTop,cy+half);realBottom=Math.min(realBottom,cy-half)
        }
        const presence=easeWake(this.wake.get(v)??1,wakePresence(realTop,realTop-realBottom,surface),dt)
        this.wake.set(v,presence)
        // The shared water model displaces columns from body y-.5 to y+.5. A planing
        // buggy's thin skid plate can already be dry while those columns still lift it.
        // Include that same envelope so a supported skimming hull still makes spray.
        bottom=Math.min(bottom,p.y-.5);top=Math.max(top,p.y+.5)
        // A Zorb's ball is what meets the water: each skip of the ball splashes, sized by its speed.
        const ball=v.zorbed?v.zorb.collider:null
        // Measured over the ball's bottom metre: a floating ball dips only its base, a few per cent
        // of its height, and a skip must still read as an entry.
        if(ball&&v.zorb.radius>0){bottom=ball.translation().y-v.zorb.radius;top=bottom+1}
        // The ball touches the water at one patch: it leaves one soft trail, not a hull's wake.
        this.shape.ball=ball&&v.zorb.radius>0?v.zorb.radius:0
        // A hovercraft's cushion works the water within about 6 m; a jet's downwash within 5 m,
        // and only while the jet itself is clear of it.
        const hover=v.kind==='hovercraft'&&!v.zorbed,jet=v.kind==='jet'&&!v.zorbed
        this.shape.air=hover?'cushion':jet?'downwash':null
        this.shape.near=(hover?1-clearance/HOVER_REACH:jet?1-clearance/JET_REACH:0)*presence
        this.shape.beam=hover?1.6:1.2
        this.shape.mass=v.body.mass()
        const fraction=submergedFraction(bottom,top,surface)*presence
        let id=this.ids.get(v);if(!id){id=`water-${++this.serial}`;this.ids.set(v,id)}
        const velocity=v.body.linvel();this.point.set(x,surface,z);this.velocity.set(velocity.x,velocity.y,velocity.z)
        // Send dry intervals too, so re-entry splashes detect the transition.
        // A skip touching down again (src/vehicles/skip.ts): planing after a moment clear of the water.
        const planing=(v.liquidState?.skipping??0)>0,last=this.planingAt.get(v)??-Infinity
        const touchdown=kind==='water'&&planing&&this.time-last>SKIP_TOUCHDOWN_GAP
        if(planing)this.planingAt.set(v,this.time)
        ;(kind==='lava'?this.lavaSpray:this.spray).vehicle(id,this.point,this.velocity,fraction,dt,this.shape,touchdown)
        if(kind==='water'&&!waterSpray.value&&fraction>0&&Math.hypot(velocity.x,velocity.z)>1)this.ripples.disturb(x,z,waterWakeRippleWidth.value,waterWakeRipple.value*Math.min(.15,Math.hypot(velocity.x,velocity.z)*.004)*Math.min(.1,Math.max(0,dt))*60)
      }
    }
    this.ripples.update(dt,game.camera.position.x,game.camera.position.z)
    this.applyLens(dt)
    this.underwater.update(dt,lensWash(this.lens))
    {
      const c=game.camera.position,kind=waterUnderwater.value?terrain.liquidKindAt?.(c.x,c.z)??null:null
      // The surface at the lens and its slope, from the one surface physics floats on.
      const at=(x:number,z:number)=>kind?terrain.liquidHeightAt?.(x,z)??-Infinity:-Infinity
      const surface=at(c.x,c.z),e=.25,sx=(at(c.x+e,c.z)-at(c.x-e,c.z))/(2*e),sz=(at(c.x,c.z+e)-at(c.x,c.z-e))/(2*e)
      this.waterline.update(game.camera,surface,kind,this.underwater.tintColour,dt,lensWash(this.lens),Number.isFinite(sx)?sx:0,Number.isFinite(sz)?sz:0)
      const medium=cameraMedium();this.motes.update(medium.kind,medium.amount,this.underwater.tintColour)
    }
    this.trailBubbles(dt)
    this.sinkInLava()
    this.bubbles.update(dt,waterUnderwater.value)
    this.sortAcrossSurface()
  }
  /**
   * Transparent parts on the far side of the water from the camera draw before it
   * (acrossSurface.ts): vehicles' canopies, wings and glows, zorb shields, and the
   * underwater bubbles, which are always below it.
   */
  private readonly across=new AcrossSurface()
  private readonly waterAt=(x:number,z:number)=>this.terrain.liquidKindAt?.(x,z)==='water'?this.terrain.liquidHeightAt?.(x,z)??-Infinity:-Infinity
  private sortAcrossSurface(){
    const {game,across}=this,c=game.camera.position
    across.begin(c.y<this.waterAt(c.x,c.z),this.waterAt)
    // Vehicles near enough to see; one further off keeps its last order until it comes back.
    if(this.near(this.player.object))across.tree(this.player.object)
    for(const v of net?net.audibleVehicles():this.bots.vehicles)if(v!==this.player&&this.near(v.object))across.tree(v.object)
    for(const o of game.scene.children)if(o.userData.zorbShield&&this.near(o))across.visit(o)
    // Bubbles live under the surface (a metre under a surface at 0 says so): drawn before it
    // whenever the camera is above it.
    across.place(this.bubbles.mesh,-1,0)
  }
  private near(o:THREE.Object3D){
    const c=this.game.camera.position,size=this.terrain.wrapSize??this.terrain.size
    return Math.hypot(nearestImage(o.position.x,c.x,size)-c.x,nearestImage(o.position.z,c.z,size)-c.z)<SORT_REACH
  }
  /** Water-owned lens rule, applied after the chase camera has placed the lens. */
  readonly lens=newLensState()
  private applyLens(dt:number){
    const {terrain}=this,p=this.game.camera.position
    // Roam mode moves the lens from its own last position, so the rule would trap it at
    // the surface; the free camera crosses as the player flies it.
    const surface=waterUnderwater.value&&Math.round(camMode.value)!==4&&terrain.liquidKindAt?.(p.x,p.z)==='water'
      ?terrain.liquidHeightAt?.(p.x,p.z)??-Infinity:-Infinity
    p.y=stepLens(this.lens,p.y,surface,dt)
  }
  /**
   * The player's vehicle sinking into lava: the lava's top layer thins round it so it glows
   * through (fx/material.ts setLavaSunk). Only once it is properly in, not wading.
   */
  private sinkInLava(){
    const {terrain}=this,body=this.player.body
    if(!this.game.world.getRigidBody(body.handle)){setLavaSunk(null);return}
    const p=body.translation()
    const surface=terrain.liquidKindAt?.(p.x,p.z)==='lava'?terrain.liquidHeightAt?.(p.x,p.z)??-Infinity:-Infinity
    setLavaSunk(surface-p.y>.15?{x:p.x,y:surface,z:p.z}:null)
  }
  /** A moving submerged player vehicle trails bubbles. */
  private trailBubbles(dt:number){
    if(!waterUnderwater.value)return
    const {terrain}=this,body=this.player.body
    if(!this.game.world.getRigidBody(body.handle))return
    const p=body.translation()
    if(terrain.liquidKindAt?.(p.x,p.z)!=='water'||!((terrain.liquidHeightAt?.(p.x,p.z)??-Infinity)>p.y+.4))return
    const v=body.linvel()
    this.bubbles.trail(p.x-v.x*.08,p.y,p.z-v.z*.08,Math.hypot(v.x,v.y,v.z),dt)
  }
  private readonly unfollow:()=>void
  private get player():Vehicle {return this.slot.current}
  private listen(vehicle:Vehicle,on:boolean){
    const object=vehicle.object as THREE.Object3D<VehicleObjectEvents>
    if(on)object.addEventListener('tileshift',this.onTileShift);else object.removeEventListener('tileshift',this.onTileShift)
  }
  async warmCovered(){this.ripples.prepareCovered()}
  /** The meniscus, split view and droplets share this normally hidden lens mesh. */
  /** A climbed level: water and lava spray allocate for it before the preparation draw (spray.ts prepareClimb). */
  prepareClimb(){this.spray.prepareClimb();this.lavaSpray.prepareClimb()}
  *precompileMeshes(){yield this.waterline.mesh}
  precompileQualityMeshes(){return this.precompileMeshes()}
  dispose(){setSplash(this.game,null);this.unfollow();this.listen(this.player,false);this.motes.dispose();this.waterline.dispose();this.underwater.dispose();this.bubbles.dispose();this.spray.dispose();this.lavaSpray.dispose();setLavaSunk(null);this.ripples.dispose()}
}

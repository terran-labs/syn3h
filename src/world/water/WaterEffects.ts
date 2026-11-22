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
import { Spray, waterSpray } from './spray'
import { Underwater, cameraMedium, waterUnderwater } from './underwater'
import { Motes } from './motes'
import { setLavaSunk } from '../../fx/material'
import { Waterline } from './waterline'
import { UnderwaterBubbles } from './bubbles'
import { lensWash, newLensState, stepLens } from './underwaterCamera'
import { camMode } from '../../core/ChaseCamera'
import { submergedFraction, verticalHalfExtent } from './waterEffectsMath'

/** Heights (m) of a hovercraft's hull and of a jet above the liquid where they stop disturbing it. */
const HOVER_REACH=6,JET_REACH=5

/** Register after Environment and ChaseCamera. The live net binding includes later joins. */
export class WaterEffects implements System {
  readonly ripples:Ripples
  readonly spray:Spray
  /** Molten spray and glowing wakes for vehicles in lava. */
  readonly lavaSpray:Spray
  readonly underwater:Underwater
  readonly bubbles:UnderwaterBubbles
  readonly motes:Motes
  readonly waterline:Waterline
  private size=-1
  private ids=new WeakMap<Vehicle,string>()
  private serial=0
  private point=new Vector3()
  private velocity=new Vector3()
  private readonly shape:{ball:number;air:'cushion'|'downwash'|null;near:number;beam:number}={ball:0,air:null,near:0,beam:1}
  constructor(private game:Game,private terrain:Terrain,private slot:PlayerSlot,private bots:{readonly vehicles:readonly Vehicle[]}){
    this.ripples=rippleField;this.ripples.attach(game.renderer);this.spray=new Spray(game.scene,this.ripples,terrain);this.lavaSpray=new Spray(game.scene,this.ripples,terrain,'lava');this.underwater=new Underwater(game,terrain);this.bubbles=new UnderwaterBubbles(game.scene,terrain,game.camera)
    this.motes=new Motes(game.scene);this.waterline=new Waterline(game.scene)
    // A world seam moves the player a whole tile and the world is redrawn round it: spray left
    // behind moves the same way. (The ripple field wraps at the tile, so it needs nothing.)
    this.listen(slot.current,true)
    // The player changed vehicle: follow the seam shifts of the new one.
    this.unfollow=slot.onChange((next,previous)=>{this.listen(previous,false);this.listen(next,true)})
  }
  private onTileShift=({dx,dz}:{dx:number;dz:number})=>{this.spray.shift(dx,dz);this.lavaSpray.shift(dx,dz)}
  /** `?water=1` preview switch: applied once play has begun, after any room state lands. */
  private queryApplied=false
  update(dt:number){
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
        this.shape.near=hover?1-clearance/HOVER_REACH:jet?1-clearance/JET_REACH:0
        this.shape.beam=hover?1.6:1.2
        const fraction=submergedFraction(bottom,top,surface)
        let id=this.ids.get(v);if(!id){id=`water-${++this.serial}`;this.ids.set(v,id)}
        const velocity=v.body.linvel();this.point.set(x,surface,z);this.velocity.set(velocity.x,velocity.y,velocity.z)
        // Send dry intervals too, so re-entry splashes detect the transition.
        ;(kind==='lava'?this.lavaSpray:this.spray).vehicle(id,this.point,this.velocity,fraction,dt,this.shape)
        if(kind==='water'&&!waterSpray.value&&fraction>0&&Math.hypot(velocity.x,velocity.z)>1)this.ripples.disturb(x,z,1.5,Math.min(.15,Math.hypot(velocity.x,velocity.z)*.004)*Math.min(.1,Math.max(0,dt))*60)
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
  dispose(){this.unfollow();this.listen(this.player,false);this.motes.dispose();this.waterline.dispose();this.underwater.dispose();this.bubbles.dispose();this.spray.dispose();this.lavaSpray.dispose();setLavaSunk(null);this.ripples.dispose()}
}

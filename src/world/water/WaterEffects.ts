import * as THREE from 'three/webgpu'
import { Vector3 } from 'three/webgpu'
import type { Game, System } from '../../core/Game'
import type { Terrain } from '../Terrain'
import { applyWaterQuery } from './params'
import type { Vehicle, VehicleObjectEvents } from '../../vehicles/Vehicle'
import { net } from '../../net'
import { nearestImage } from '../../../shared/wrap'
import { Ripples, rippleField, waterRipples } from './ripples'
import { Spray, waterSpray } from './spray'
import { Underwater, waterUnderwater } from './underwater'
import { UnderwaterBubbles } from './bubbles'
import { lensWash, newLensState, stepLens } from './underwaterCamera'
import { camMode } from '../../core/ChaseCamera'
import { submergedFraction, verticalHalfExtent } from './waterEffectsMath'

/** Register after Environment and ChaseCamera. The live net binding includes later joins. */
export class WaterEffects implements System {
  readonly ripples:Ripples
  readonly spray:Spray
  readonly underwater:Underwater
  readonly bubbles:UnderwaterBubbles
  private size=-1
  private ids=new WeakMap<Vehicle,string>()
  private serial=0
  private point=new Vector3()
  private velocity=new Vector3()
  constructor(private game:Game,private terrain:Terrain,private player:Vehicle,private bots:{readonly vehicles:readonly Vehicle[]}){
    this.ripples=rippleField;this.ripples.attach(game.renderer);this.spray=new Spray(game.scene,this.ripples,terrain);this.underwater=new Underwater(game,terrain);this.bubbles=new UnderwaterBubbles(game.scene,terrain,game.camera)
    // A world seam moves the player a whole tile and the world is redrawn round it: spray left
    // behind moves the same way. (The ripple field wraps at the tile, so it needs nothing.)
    ;(player.object as THREE.Object3D<VehicleObjectEvents>).addEventListener('tileshift',this.onTileShift)
  }
  private onTileShift=({dx,dz}:{dx:number;dz:number})=>this.spray.shift(dx,dz)
  /** `?water=1` preview switch: applied once play has begun, after any room state lands. */
  private queryApplied=false
  update(dt:number){
    if(!this.queryApplied&&this.game.time>2){this.queryApplied=true;applyWaterQuery()}
    const {game,terrain}=this,size=terrain.wrapSize??terrain.size
    if(size!==this.size){this.size=size;this.ripples.configure(size)}
    this.spray.update(dt)
    if(waterSpray.value||waterRipples.value){
      const vehicles=new Set<Vehicle>([this.player,...(net?net.audibleVehicles():this.bots.vehicles)])
      for(const v of vehicles){
        if(!game.world.getRigidBody(v.body.handle))continue
        const p=v.body.translation(),camera=game.camera.position
        const x=nearestImage(p.x,camera.x,size),z=nearestImage(p.z,camera.z,size)
        if(Math.hypot(x-camera.x,z-camera.z)>150||terrain.liquidKindAt?.(x,z)!=='water')continue
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
        // The shared water model displaces columns from body y-.5 to y+.5. A planing
        // buggy's thin skid plate can already be dry while those columns still lift it.
        // Include that same envelope so a supported skimming hull still makes spray.
        bottom=Math.min(bottom,p.y-.5);top=Math.max(top,p.y+.5)
        const fraction=submergedFraction(bottom,top,surface)
        let id=this.ids.get(v);if(!id){id=`water-${++this.serial}`;this.ids.set(v,id)}
        const velocity=v.body.linvel();this.point.set(x,surface,z);this.velocity.set(velocity.x,velocity.y,velocity.z)
        // Send dry intervals too, so re-entry splashes detect the transition.
        this.spray.vehicle(id,this.point,this.velocity,fraction,dt)
        if(!waterSpray.value&&fraction>0&&Math.hypot(velocity.x,velocity.z)>1)this.ripples.disturb(x,z,1.5,Math.min(.15,Math.hypot(velocity.x,velocity.z)*.004)*Math.min(.1,Math.max(0,dt))*60)
      }
    }
    this.ripples.update(dt,game.camera.position.x,game.camera.position.z)
    this.applyLens(dt)
    this.underwater.update(dt,lensWash(this.lens))
    this.trailBubbles(dt)
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
  dispose(){(this.player.object as THREE.Object3D<VehicleObjectEvents>).removeEventListener('tileshift',this.onTileShift);this.underwater.dispose();this.bubbles.dispose();this.spray.dispose();this.ripples.dispose()}
}

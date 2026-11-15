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
import { Underwater } from './underwater'
import { submergedFraction, verticalHalfExtent } from './waterEffectsMath'

/** Register after Environment and ChaseCamera. The live net binding includes later joins. */
export class WaterEffects implements System {
  readonly ripples:Ripples
  readonly spray:Spray
  readonly underwater:Underwater
  private size=-1
  private ids=new WeakMap<Vehicle,string>()
  private serial=0
  private point=new Vector3()
  private velocity=new Vector3()
  constructor(private game:Game,private terrain:Terrain,private slot:PlayerSlot,private bots:{readonly vehicles:readonly Vehicle[]}){
    this.ripples=rippleField;this.ripples.attach(game.renderer);this.spray=new Spray(game.scene,this.ripples);this.underwater=new Underwater(game,terrain)
    // A world seam moves the player a whole tile and the world is redrawn round it: spray left
    // behind moves the same way. (The ripple field wraps at the tile, so it needs nothing.)
    this.listen(slot.current,true)
    // The player changed vehicle: follow the seam shifts of the new one.
    this.unfollow=slot.onChange((next,previous)=>{this.listen(previous,false);this.listen(next,true)})
  }
  private readonly unfollow:()=>void
  private get player():Vehicle {return this.slot.current}
  private listen(vehicle:Vehicle,on:boolean){
    const object=vehicle.object as THREE.Object3D<VehicleObjectEvents>
    if(on)object.addEventListener('tileshift',this.onTileShift);else object.removeEventListener('tileshift',this.onTileShift)
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
    this.underwater.update(dt)
  }
  dispose(){this.unfollow();this.listen(this.player,false);this.underwater.dispose();this.spray.dispose();this.ripples.dispose()}
}

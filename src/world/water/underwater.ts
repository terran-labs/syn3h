import * as T from 'three/webgpu'
import { fog, float, positionView, renderGroup, uniform } from 'three/tsl'
import { defineParam } from '../../../shared/params'
import type { Game } from '../../core/Game'
import type { Terrain } from '../Terrain'
import { underwaterLook } from './waterEffectsMath'
export const waterUnderwater=defineParam<boolean>({id:'water.underwater',label:'Underwater camera',group:'Water',scope:'client',default:false})
interface LightState {light:T.Light;before:number;applied:number}
/** Runs after Environment and the chase camera. Never advances or freezes the sky clock. */
export class Underwater {
  private tint=uniform(new T.Color())
  private extinction=uniform(.085)
  private fogNode=fog(this.tint,float(1).sub(positionView.length().mul(this.extinction).negate().exp()))
  private savedFog:T.Scene['fogNode']
  private savedEnvironment=1
  private appliedEnvironment=1
  private lights:LightState[]=[]
  private active=false
  constructor(private game:Game,private terrain:Terrain){
    this.tint.setGroup(renderGroup).onRenderUpdate(()=>this.tint.value)
    this.extinction.setGroup(renderGroup).onRenderUpdate(()=>this.extinction.value)
  }
  /** Restore only fields still carrying our override; preserve newer Environment writes. */
  private restore(){
    if(!this.active)return
    const scene=this.game.scene
    if(scene.fogNode===this.fogNode)scene.fogNode=this.savedFog
    if(scene.environmentIntensity===this.appliedEnvironment)scene.environmentIntensity=this.savedEnvironment
    for(const s of this.lights)if(s.light.intensity===s.applied)s.light.intensity=s.before
    this.lights=[];this.active=false
  }
  update(){
    this.restore()
    if(!waterUnderwater.value)return
    const p=this.game.camera.position
    if(this.terrain.liquidKindAt?.(p.x,p.z)!=='water')return
    const surface=this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity
    const depth=surface-p.y
    if(!(depth>0)||!Number.isFinite(depth))return
    const look=underwaterLook(depth),scene=this.game.scene
    this.savedFog=scene.fogNode;this.savedEnvironment=scene.environmentIntensity
    this.tint.value.setRGB(look.red,look.green,look.blue);this.extinction.value=look.extinction
    scene.fogNode=this.fogNode
    this.appliedEnvironment=this.savedEnvironment*look.transmission;scene.environmentIntensity=this.appliedEnvironment
    // Environment's direct and hemisphere lights are direct children; headlights stay local.
    for(const object of scene.children){
      if(!(object instanceof T.DirectionalLight||object instanceof T.HemisphereLight))continue
      const before=object.intensity,applied=before*look.transmission
      this.lights.push({light:object,before,applied});object.intensity=applied
    }
    this.active=true
  }
  dispose(){this.restore()}
}

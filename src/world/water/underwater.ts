import * as T from 'three/webgpu'
import { fog, float, mix, output, positionView, renderGroup, uniform } from 'three/tsl'
import { defineParam } from '../../../shared/params'
import type { Game } from '../../core/Game'
import type { Terrain } from '../Terrain'
import { underwaterLook } from './waterEffectsMath'
export const waterUnderwater=defineParam<boolean>({id:'water.underwater',label:'Underwater camera',group:'Water',scope:'client',default:true})
interface LightState {light:T.Light;before:number;applied:number}
/** Installed after Environment, before the first frame. Crossings change uniforms only. */
export class Underwater {
  private tint=uniform(new T.Color())
  private extinction=uniform(.085)
  private blend=uniform(0)
  private readonly fogNode:T.Node
  private readonly savedFog:T.Scene['fogNode']
  private savedEnvironment=1
  private appliedEnvironment=1
  private lights:LightState[]=[]
  private active=false
  constructor(private game:Game,private terrain:Terrain){
    this.tint.setGroup(renderGroup).onRenderUpdate(()=>this.tint.value)
    this.extinction.setGroup(renderGroup).onRenderUpdate(()=>this.extinction.value)
    this.blend.setGroup(renderGroup).onRenderUpdate(()=>this.blend.value)
    this.savedFog=game.scene.fogNode
    const water=fog(this.tint,float(1).sub(positionView.length().mul(this.extinction).negate().exp()))
    // Retain Environment's live air graph. Swapping its identity at the surface rebuilds
    // every affected material and GPU pipeline, even on the tenth crossing.
    this.fogNode=mix((this.savedFog??output) as T.Node<'vec4'>,water,this.blend)
    game.scene.fogNode=this.fogNode
  }
  /** Restore light overrides without disturbing newer Environment writes. */
  private restore(){
    if(!this.active)return
    const scene=this.game.scene
    if(scene.environmentIntensity===this.appliedEnvironment)scene.environmentIntensity=this.savedEnvironment
    for(const s of this.lights)if(s.light.intensity===s.applied)s.light.intensity=s.before
    this.lights=[];this.active=false
  }
  update(dt=1/60){
    this.restore()
    const p=this.game.camera.position
    const surface=waterUnderwater.value&&this.terrain.liquidKindAt?.(p.x,p.z)==='water'
      ?this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity:-Infinity
    const depth=surface-p.y,wet=Number.isFinite(depth)&&depth>0
    // A quarter metre transition and a short bounded time ramp soften the surface cut.
    const target=wet?Math.min(1,depth/.25):0
    const step=Math.max(0,Math.min(.25,dt))/.08
    this.blend.value+=Math.max(-step,Math.min(step,target-this.blend.value))
    if(wet){
      const look=underwaterLook(depth)
      this.tint.value.setRGB(look.red,look.green,look.blue);this.extinction.value=look.extinction
    }
    if(this.blend.value===0)return
    const look=underwaterLook(Math.max(0,Number.isFinite(depth)?depth:0)),scene=this.game.scene
    const transmission=1+(look.transmission-1)*this.blend.value
    this.savedEnvironment=scene.environmentIntensity
    this.appliedEnvironment=this.savedEnvironment*transmission;scene.environmentIntensity=this.appliedEnvironment
    for(const object of scene.children){
      if(!(object instanceof T.DirectionalLight||object instanceof T.HemisphereLight))continue
      const before=object.intensity,applied=before*transmission
      this.lights.push({light:object,before,applied});object.intensity=applied
    }
    this.active=true
  }
  dispose(){this.restore();if(this.game.scene.fogNode===this.fogNode)this.game.scene.fogNode=this.savedFog}
}

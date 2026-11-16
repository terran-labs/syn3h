import * as T from 'three/webgpu'
import { fog, float, mix, output, positionView, renderGroup, screenUV, smoothstep, uniform } from 'three/tsl'
import { defineParam } from '../../../shared/params'
import type { Game } from '../../core/Game'
import type { Terrain } from '../Terrain'
import { CameraWater } from './cameraWater'
import { underwaterLook, underwaterRamp } from './waterEffectsMath'
export const waterUnderwater=defineParam<boolean>({id:'water.underwater',label:'Underwater camera',group:'Water',scope:'client',default:true})
// Post effects run after scene fog. Share its eased amount by camera so they can fade
// atmospheric overlays without changing their graph or affecting reflection captures.
const cameraCoverage=new WeakMap<T.Camera,CameraWater>()
/** Near-plane wet fraction from linear corner interpolation, independent of fog easing/toggle. */
export function cameraWaterCoverage(camera:T.Camera):number{return cameraCoverage.get(camera)?.coverage??0}
const cameraAmounts=new WeakMap<T.Camera,number>()
export function underwaterAmountForCamera(camera:T.Camera):number{return cameraAmounts.get(camera)??0}
/** Narrow seam on AlienSkyMesh: see src/world/sky/AlienSkyMesh.ts. */
interface SkySeam {underwaterCamera:T.Camera|null;underwaterAmount:number;underwaterTint:{value:T.Vector3}}
interface LightState {light:T.Light;before:number;applied:number}
/** Installed after Environment, before the first frame. Crossings change uniforms only. */
export class Underwater {
  private readonly cameraWater=new CameraWater()
  private registeredCamera:T.Camera|null=null
  private readonly waterline=uniform(this.cameraWater.depths)
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
    const surfaceLook=underwaterLook(0);this.tint.value.setRGB(surfaceLook.red,surfaceLook.green,surfaceLook.blue)
    this.tint.setGroup(renderGroup).onRenderUpdate(()=>this.tint.value)
    this.extinction.setGroup(renderGroup).onRenderUpdate(()=>this.extinction.value)
    this.blend.setGroup(renderGroup).onRenderUpdate(()=>this.blend.value)
    this.waterline.setGroup(renderGroup).onRenderUpdate(()=>this.waterline.value)
    this.savedFog=game.scene.fogNode
    const water=fog(this.tint,float(1).sub(positionView.length().mul(this.extinction).negate().exp()))
    // Retain Environment's live air graph. Swapping its identity at the surface rebuilds
    // every affected material and GPU pipeline, even on the tenth crossing.
    // Screen UV starts at the top left. Mask only the wet part of the near plane;
    // a two-centimetre transition avoids a hard raster edge without fogging dry pixels.
    const d=this.waterline
    const depth=mix(mix(d.x,d.y,screenUV.x),mix(d.z,d.w,screenUV.x),screenUV.y)
    const wetMask=smoothstep(0,.02,depth)
    this.fogNode=mix((this.savedFog??output) as T.Node<'vec4'>,water,this.blend.mul(wetMask))
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
  /** The sky dome is drawn unfogged; it carries its own camera-only underwater seam. */
  private sky:SkySeam|null=null
  private skySearch=0
  private findSky(){
    if(this.sky||this.skySearch-->0)return this.sky
    this.skySearch=30
    const sky=this.game.scene.children.find(o=>'sunDirection' in o&&'betaR' in o&&'underwaterTint' in o) as unknown as SkySeam|undefined
    if(sky){this.sky=sky;sky.underwaterCamera=this.game.camera}
    return this.sky
  }
  /** Current fog blend, for tests and evidence. */
  get amount(){return this.blend.value}
  /** The legacy wash argument is ignored: lens animation cannot make a dry camera wet. */
  update(dt=1/60,_wash=0){
    this.restore()
    if(this.registeredCamera!==this.game.camera){
      if(this.registeredCamera){cameraCoverage.delete(this.registeredCamera);cameraAmounts.delete(this.registeredCamera)}
      this.registeredCamera=this.game.camera
      this.blend.value=0
    }
    this.cameraWater.update(this.game.camera,this.terrain)
    cameraCoverage.set(this.game.camera,this.cameraWater)
    const p=this.game.camera.position
    const surface=waterUnderwater.value&&this.terrain.liquidKindAt?.(p.x,p.z)==='water'
      ?this.terrain.liquidHeightAt?.(p.x,p.z)??-Infinity:-Infinity
    const depth=surface-p.y
    const d=this.cameraWater.depths,coverage=this.cameraWater.coverage
    const target=waterUnderwater.value&&coverage>0?underwaterRamp(Math.max(0,d.x,d.y,d.z,d.w)):0
    const step=Math.max(0,Math.min(.25,dt))/.25
    // Dry exits clear immediately; easing must never drag the water look above the surface.
    this.blend.value=target===0?0:this.blend.value+Math.max(-step,Math.min(step,target-this.blend.value))
    cameraAmounts.set(this.game.camera,this.blend.value*coverage)
    const look=underwaterLook(Math.max(0,Number.isFinite(depth)?depth:0))
    this.tint.value.setRGB(look.red,look.green,look.blue);this.extinction.value=look.extinction
    const sky=this.findSky()
    if(sky){sky.underwaterCamera=this.game.camera;sky.underwaterAmount=coverage===1?this.blend.value:0;const c=this.tint.value;sky.underwaterTint.value.set(c.r,c.g,c.b)}
    // Global lighting cannot be masked by screen region. Keep air lighting until fully wet.
    if(this.blend.value===0||coverage<1)return
    const scene=this.game.scene
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
  dispose(){this.restore();if(this.registeredCamera){cameraCoverage.delete(this.registeredCamera);cameraAmounts.delete(this.registeredCamera);this.registeredCamera=null}if(this.sky){this.sky.underwaterAmount=0;this.sky.underwaterCamera=null}if(this.game.scene.fogNode===this.fogNode)this.game.scene.fogNode=this.savedFog}
}

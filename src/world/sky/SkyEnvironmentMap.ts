import * as THREE from 'three/webgpu'
import type { AlienSkyMesh } from './AlienSkyMesh'

/** Sky-only PMREM: no terrain, vehicles or shadow passes in the reflection capture. */
export class SkyEnvironmentMap {
  private readonly capture=new THREE.Scene()
  private readonly generator:THREE.PMREMGenerator
  private target:ReturnType<THREE.PMREMGenerator['fromScene']>|null=null
  private dirty=true
  private elapsed=Infinity
  private capturedHour=NaN
  private readonly previous:THREE.Texture|null
  private readonly previousIntensity:number
  readonly stats={captures:0,lastCpuMs:0,totalCpuMs:0,size:64}
  constructor(private readonly scene:THREE.Scene,renderer:THREE.WebGPURenderer,private readonly sky:AlienSkyMesh){
    this.previous=scene.environment
    this.previousIntensity=scene.environmentIntensity
    // The scene already has sky-derived hemisphere lighting; keep this fill subdued.
    scene.environmentIntensity=.15
    this.generator=new THREE.PMREMGenerator(renderer)
    // Sharing the material keeps all live scattering, cloud and night uniforms identical.
    const proxy=new THREE.Mesh(sky.geometry,sky.material);proxy.scale.setScalar(10000)
    this.capture.add(proxy)
    scene.userData.skyEnvironment=this.stats
  }
  invalidate(){this.dirty=true}
  /** Whether the first capture has been made and the scene's environment is the sky map. */
  get ready(){return this.target!==null}
  update(dt:number,hour:number){
    this.elapsed+=dt
    const delta=Math.abs(hour-this.capturedHour),hourDelta=Math.min(delta,24-delta)
    // Debounce slider drags; the running day clock refreshes after six simulated minutes.
    if(this.target&&this.elapsed<.5)return
    if(this.target&&!this.dirty&&hourDelta<.1)return
    const start=performance.now()
    // A camera volume does not appear in the sky-only capture. Keep the existing layer
    // in reflections without changing coverage, drift, or the capture schedule.
    const visible=this.sky.cloudLayerVisible
    this.sky.cloudLayerVisible=true
    try {
      this.target=this.generator.fromScene(this.capture,0,.1,20000,{size:this.stats.size,renderTarget:this.target})
    } finally {
      this.sky.cloudLayerVisible=visible
    }
    this.scene.environment=this.target.texture
    this.stats.lastCpuMs=performance.now()-start;this.stats.totalCpuMs+=this.stats.lastCpuMs;this.stats.captures++
    this.elapsed=0;this.capturedHour=hour;this.dirty=false
  }
  dispose(){
    if(this.scene.environment===this.target?.texture)this.scene.environment=this.previous
    this.scene.environmentIntensity=this.previousIntensity
    this.target?.dispose();this.generator.dispose();this.capture.clear()
    delete this.scene.userData.skyEnvironment
  }
}

import type { Terrain } from '../world/Terrain'
import { unit } from './Engine'
export type AudioTerrain = Terrain & { vents?():readonly {x:number;y:number;z:number}[] }
export function lavaProximity(terrain:AudioTerrain,p:{x:number;y:number;z:number}):number {
  let near=0
  // Sparse rings find nearby rivers and coastlines without scanning the terrain mesh.
  for(const radius of [0,12,32,70])for(let i=0;i<(radius?8:1);i++) {
    const x=p.x+Math.cos(i*Math.PI/4)*radius,z=p.z+Math.sin(i*Math.PI/4)*radius
    const y=terrain.liquidHeightAt?.(x,z)??-Infinity
    if(terrain.liquidKindAt?.(x,z)==='lava'&&Number.isFinite(y))near=Math.max(near,unit(1-Math.hypot(radius,p.y-y)/100))
  }
  for(const v of terrain.vents?.()??[])near=Math.max(near,unit(1-Math.hypot(v.x-p.x,v.y-p.y,v.z-p.z)/70))
  return near
}
export class WorldAudio {
  private readonly source:AudioBufferSourceNode
  private readonly filter:BiquadFilterNode
  private readonly gain:GainNode
  private readonly pulse:OscillatorNode
  private readonly depth:GainNode
  private disposed=false
  constructor(private readonly context:BaseAudioContext,output:AudioNode,noise:AudioBuffer){
    this.source=context.createBufferSource();this.source.buffer=noise;this.source.loop=true
    this.filter=context.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=135;this.filter.Q.value=1.2
    this.gain=context.createGain();this.gain.gain.value=0;this.source.connect(this.filter).connect(this.gain).connect(output)
    this.pulse=context.createOscillator();this.pulse.frequency.value=3.7;this.depth=context.createGain();this.depth.gain.value=0;this.pulse.connect(this.depth).connect(this.gain.gain)
    this.source.start();this.pulse.start()
  }
  update(proximity:number,enabled:boolean):void{const level=enabled?unit(proximity)*.3:0,now=this.context.currentTime;this.gain.gain.setTargetAtTime(level,now,.4);this.depth.gain.setTargetAtTime(level*.55,now,.4);this.filter.frequency.setTargetAtTime(100+unit(proximity)*110,now,.4)}
  dispose():void{if(this.disposed)return;this.disposed=true;this.source.stop();this.pulse.stop();for(const n of [this.source,this.pulse,this.filter,this.gain,this.depth])n.disconnect()}
}

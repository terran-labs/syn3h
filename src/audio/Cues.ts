export type Cue = 'capture'|'contested'|'lost'|'win'|'tick'|'tag'|'join'|'leave'|'click'|'deploy'|'retract'|'lava'|'splash'
const notes:Record<Cue,readonly number[]>={capture:[330,440,660],contested:[220,233,220],lost:[330,220],win:[262,330,392,523],tick:[660],tag:[520,260,780],join:[392,523],leave:[392,294],click:[880],deploy:[110,440],retract:[440,110],lava:[150,64,58,205],splash:[320,170]}
/** A bounded one-shot graph. The returned cleanup also supports immediate shutdown. */
export function synthCue(context:BaseAudioContext,output:AudioNode,cue:Cue,noise:AudioBuffer,onEnd:()=>void=()=>{}):()=>void {
  const now=context.currentTime,sequence=notes[cue],step=cue==='win'?.18:cue==='lava'?.16:cue==='click'?.025:cue==='tick'?.045:.09
  const nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[]
  const gain=context.createGain();gain.gain.value=0;gain.connect(output);nodes.push(gain)
  // Lava is thick and sticky: a low gulp that ends in one rising bubble, not a sizzle.
  const duration=cue==='lava'?.75:cue==='splash'?.42:sequence.length*step+.15
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(cue==='click'?.025:cue==='lava'?.34:cue==='splash'?.2:.12,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+duration)
  const o=context.createOscillator();o.type='sine';o.frequency.value=sequence[0]
  sequence.forEach((frequency,i)=>o.frequency.exponentialRampToValueAtTime(frequency,now+.008+i*step));o.connect(gain);o.start(now);o.stop(now+duration+.02);nodes.push(o);sources.push(o)
  if(cue==='lava'||cue==='splash') {const n=context.createBufferSource(),f=context.createBiquadFilter();n.buffer=noise;f.type=cue==='lava'?'lowpass':'bandpass';f.frequency.value=cue==='lava'?240:1700;f.Q.value=cue==='lava'?1:.7;n.connect(f).connect(gain);n.start(now);n.stop(now+duration+.02);nodes.push(n,f);sources.push(n)}
  let ended=false
  const clean=()=>{if(ended)return;ended=true;for(const node of nodes)node.disconnect();onEnd()}
  o.onended=clean
  return ()=>{for(const source of sources){try{source.stop()}catch{ /* A completed source is already silent. */ }}clean()}
}

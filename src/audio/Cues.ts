export type Cue = 'capture'|'contested'|'lost'|'win'|'tick'|'tag'|'join'|'leave'|'click'|'deploy'|'retract'|'lava'
const notes:Record<Cue,readonly number[]>={capture:[330,440,660],contested:[220,233,220],lost:[330,220],win:[262,330,392,523],tick:[660],tag:[520,260,780],join:[392,523],leave:[392,294],click:[880],deploy:[110,440],retract:[440,110],lava:[90,45]}
/** A bounded one-shot graph. The returned cleanup also supports immediate shutdown. */
export function synthCue(context:BaseAudioContext,output:AudioNode,cue:Cue,noise:AudioBuffer,onEnd:()=>void=()=>{}):()=>void {
  const now=context.currentTime,sequence=notes[cue],step=cue==='win'?.18:cue==='click'?.025:cue==='tick'?.045:.09
  const nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[]
  const gain=context.createGain();gain.gain.value=0;gain.connect(output);nodes.push(gain)
  const duration=cue==='lava'?.8:sequence.length*step+.15
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(cue==='click'?.025:cue==='lava'?.4:.12,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+duration)
  const o=context.createOscillator();o.type=cue==='lava'?'triangle':'sine';o.frequency.value=sequence[0]
  sequence.forEach((frequency,i)=>o.frequency.exponentialRampToValueAtTime(frequency,now+.008+i*step));o.connect(gain);o.start(now);o.stop(now+duration+.02);nodes.push(o);sources.push(o)
  if(cue==='lava') {const n=context.createBufferSource(),f=context.createBiquadFilter();n.buffer=noise;f.type='highpass';f.frequency.value=900;n.connect(f).connect(gain);n.start(now);n.stop(now+duration+.02);nodes.push(n,f);sources.push(n)}
  let ended=false
  const clean=()=>{if(ended)return;ended=true;for(const node of nodes)node.disconnect();onEnd()}
  o.onended=clean
  return ()=>{for(const source of sources){try{source.stop()}catch{ /* A completed source is already silent. */ }}clean()}
}

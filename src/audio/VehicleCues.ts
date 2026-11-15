/** Event-driven vehicle effects. All sources are generated and owned by one voice. */
export interface MaterializeVoice {
  /** Release on the simulation's actual drop, not on an estimated wall-clock deadline. */
  release(): void
  /** Cancel without a drop sound. Safe before or after release. */
  stop(): void
}

export function synthMaterialize(
  context: BaseAudioContext, output: AudioNode, noise: AudioBuffer, onEnd: () => void = () => {},
): MaterializeVoice {
  const start = context.currentTime, gather = .2
  const nodes: AudioNode[] = [], sources: AudioScheduledSourceNode[] = []
  let ended = false, released = false
  const keep = <T extends AudioNode>(node: T): T => { nodes.push(node); return node }
  const stop = () => {
    if (ended) return
    ended = true
    for (const source of sources) { try { source.stop() } catch { /* Already ended. */ } }
    for (const node of nodes) node.disconnect()
    onEnd()
  }
  const gain = (level: number, destination = output) => {
    const node = keep(context.createGain()); node.gain.value = level; node.connect(destination); return node
  }
  const tone = (frequency: number, destination: AudioNode, at: number, end: number) => {
    const osc = keep(context.createOscillator()); osc.frequency.setValueAtTime(frequency, at)
    osc.connect(destination); sources.push(osc); osc.start(at); osc.stop(end); return osc
  }
  const shimmer = gain(0), air = gain(0)
  shimmer.gain.setValueAtTime(0, start); shimmer.gain.linearRampToValueAtTime(.11, start + gather)
  air.gain.setValueAtTime(0, start); air.gain.linearRampToValueAtTime(.13, start + gather * .65)
  air.gain.linearRampToValueAtTime(.055, start + gather)
  // Nearby frequencies beat slowly: a held electric shimmer, without a looping asset.
  const holding: AudioScheduledSourceNode[] = []
  for (const [frequency, level] of [[196, .6], [197.4, .6], [293.66, .38], [392.8, .22]]) {
    const osc = tone(frequency * .6, gain(level, shimmer), start, start + 30)
    osc.frequency.exponentialRampToValueAtTime(frequency, start + gather)
    holding.push(osc)
  }
  // A bounded audio-clock failsafe also works while the context is suspended.
  holding[0].onended = () => { if (!released) stop() }
  const band = keep(context.createBiquadFilter()); band.type = 'bandpass'; band.Q.value = .8
  band.frequency.setValueAtTime(280, start); band.frequency.exponentialRampToValueAtTime(2300, start + gather)
  band.connect(air)
  const hiss = keep(context.createBufferSource()); hiss.buffer = noise; hiss.loop = true; hiss.connect(band)
  sources.push(hiss); holding.push(hiss); hiss.start(start); hiss.stop(start + 30)
  return {
    stop,
    release() {
      if (ended || released) return
      released = true
      const at = context.currentTime, elapsed = Math.max(0, at - start)
      // Cancel future gather ramps as well, so an immediate drop cannot swell afterward.
      const airLevel = elapsed < gather * .65 ? .13 * elapsed / (gather * .65)
        : elapsed < gather ? .13 + (.055 - .13) * (elapsed - gather * .65) / (gather * .35) : .055
      for (const [node, level] of [[shimmer, .11 * Math.min(1, elapsed / gather)], [air, airLevel]] as const) {
        node.gain.cancelScheduledValues(at); node.gain.setValueAtTime(level, at)
        node.gain.linearRampToValueAtTime(0, at + .24)
      }
      for (const source of holding) source.stop(at + .26)
      const lowGain = gain(0)
      lowGain.gain.setValueAtTime(0, at); lowGain.gain.linearRampToValueAtTime(.24, at + .008)
      lowGain.gain.exponentialRampToValueAtTime(.0001, at + .3)
      const low = tone(145, lowGain, at, at + .32)
      low.frequency.exponentialRampToValueAtTime(48, at + .22)
      const bellGain = gain(0)
      bellGain.gain.setValueAtTime(0, at); bellGain.gain.linearRampToValueAtTime(.075, at + .008)
      bellGain.gain.exponentialRampToValueAtTime(.0001, at + .6)
      const bell = tone(784, bellGain, at, at + .65)
      bell.onended = stop
    },
  }
}

/** One elastic pressure pulse for a Zorb hop; no engine or tyre layer accompanies it. */
export function synthZorbPulse(context: BaseAudioContext, output: AudioNode, onEnd: () => void = () => {}): () => void {
  const at = context.currentTime, end = at + .42
  const nodes: AudioNode[] = [], sources: OscillatorNode[] = []
  let ended = false
  const stop = () => {
    if (ended) return
    ended = true
    for (const source of sources) { try { source.stop() } catch { /* Already ended. */ } }
    for (const node of nodes) node.disconnect()
    onEnd()
  }
  // A rising onset gives lift, then a falling body makes the shield feel elastic.
  for (const [frequency, peak, decay] of [[105, .3, .29], [420, .09, .38]]) {
    const osc = context.createOscillator(), gain = context.createGain()
    nodes.push(osc, gain); sources.push(osc)
    osc.frequency.setValueAtTime(frequency * .65, at)
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.7, at + .035)
    osc.frequency.exponentialRampToValueAtTime(frequency * .5, at + decay)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + .012)
    gain.gain.exponentialRampToValueAtTime(.0001, at + decay)
    osc.connect(gain).connect(output); osc.start(at); osc.stop(end)
  }
  sources[sources.length - 1].onended = stop
  return stop
}

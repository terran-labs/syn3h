/**
 * Score lab (score.html): audition the adaptive score without playing the game. Every mood
 * input the game feeds the score has a slider here, and the scene buttons set them all at
 * once. `renderScene` renders a scene offline for the browser check in tests/audio.
 */
import { Score, scoreLite, scoreNetworkHall, type ScoreInput } from './Score'
import { params } from '../../../shared/params'
import type { Role } from './Composer'
import { applySubmerge, LAYERS } from './ScoreSynth'

export interface Scene extends ScoreInput { /** Combat heat held at this level, 0..1. */ heat: number; holding: boolean; contested: boolean; progress: number }
const base: Scene = { playing: true, speed: 0, throttle: 0, airborne: false, clearance: 0, altitude: 20, submerged: 0, lava: 0, heat: 0, holding: false, contested: false, progress: 0 }
export const SCENES: Record<string, Scene> = {
  Lobby: { ...base, playing: false },
  Parked: { ...base },
  Cruise: { ...base, speed: 24, throttle: 0.6 },
  'Flat out': { ...base, speed: 58, throttle: 1 },
  'Tag chase': { ...base, speed: 50, throttle: 1, heat: 0.9 },
  Soaring: { ...base, speed: 45, throttle: 0.7, airborne: true, clearance: 140, altitude: 420 },
  Underwater: { ...base, speed: 12, throttle: 0.5, submerged: 4 },
  'Lava field': { ...base, speed: 20, throttle: 0.6, lava: 1 },
  'Holding the hill': { ...base, speed: 8, throttle: 0.3, holding: true, progress: 0.8 },
  'Contested hill': { ...base, speed: 20, throttle: 0.8, contested: true, heat: 0.5, progress: 0.5 },
}

function drive(score: Score, scene: Scene): void {
  score.setMatch({ holding: scene.holding, contested: scene.contested, progress: scene.progress })
  score.mood.heat = Math.max(score.mood.heat, scene.heat)
  score.update(scene)
}

/** Render a scene offline and measure it. Used by tests/audio/score-render.mjs. */
export async function renderScene(name: string, seconds = 16, seed = 1234, rate = 44100, cue?: Role | 'surge', only?: readonly string[], lite = false, network = false) {
  params.set(scoreLite.def.id, lite); params.set(scoreNetworkHall.def.id, network)
  const context = new OfflineAudioContext(2, rate * seconds, rate), scene = SCENES[name]
  const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000; filter.connect(context.destination)
  const score = new Score(context, filter, seed)
  await score.synth.ready
  // Solo some layers, to measure an instrument on its own.
  if (only) for (const layer of LAYERS) score.synth.trim[layer] = only.includes(layer) ? 1 : 0
  score.setActive(true, 0.3)
  if (cue) score.cue(cue)
  const roles: Role[] = []
  const tick = () => { drive(score, scene); applySubmerge(filter, score.mood.depth, context.currentTime); roles[Math.floor(context.currentTime)] = score.role }
  tick()
  const ticks: Promise<void>[] = []
  // Whole-numbered ticks, stopping short of the end: a pause that lands on the last render
  // quantum never fires and would leave the render waiting for ever.
  for (let n = 1; n * 0.05 < seconds - 0.1; n++) ticks.push(context.suspend(n * 0.05).then(() => { tick(); return context.resume() }))
  const buffer = await context.startRendering(); await Promise.allSettled(ticks)
  // Measure the second half, after the mood has settled.
  const from = Math.floor(buffer.length / 2), left = buffer.getChannelData(0), right = buffer.getChannelData(1)
  let peak = 0, square = 0, bad = 0, slope = 0, side = 0
  for (let i = from; i < buffer.length; i++) {
    const l = left[i], r = right[i], mono = (l + r) / 2
    if (!Number.isFinite(l) || !Number.isFinite(r)) bad++
    peak = Math.max(peak, Math.abs(l), Math.abs(r)); square += mono * mono; side += ((l - r) / 2) ** 2
    if (i > from) slope += (mono - (left[i - 1] + right[i - 1]) / 2) ** 2
  }
  const count = buffer.length - from
  // Loudness second by second, to see a build, a breath and a release.
  const envelope = Array.from({ length: seconds }, (_, second) => { let sum = 0; for (let i = second * rate; i < (second + 1) * rate; i++) sum += ((left[i] + right[i]) / 2) ** 2; return Math.sqrt(sum / rate) })
  return { name, envelope, roles, peak, rms: Math.sqrt(square / count), width: Math.sqrt(side / count), bad, /** Hz. RMS of the slope over RMS of the signal: where the energy sits in the spectrum. */ brightness: Math.sqrt(slope / square) * rate / (2 * Math.PI), mode: score.mode, tempo: score.tempo, mood: { ...score.mood }, nodes: score.synth.nodeCount, left, right, rate }
}

/** Pluck one modelled string offline and measure the pitch it actually sounds, in Hz. */
export async function pluckPitch(hz: number, rate = 44100): Promise<{ hz: number; level: number }> {
  const context = new OfflineAudioContext(2, rate, rate)
  await context.audioWorklet.addModule(new URL('./pluck.worklet.js', import.meta.url))
  const node = new AudioWorkletNode(context, 'pluck', { numberOfInputs: 0, outputChannelCount: [2] }); node.connect(context.destination)
  node.port.postMessage({ t: 0, hz, velocity: 1, sustain: 4 })
  // Let the message reach the audio thread before rendering starts.
  await new Promise(resolve => setTimeout(resolve, 50))
  const buffer = await context.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1)
  const x = Float32Array.from(left, (v, i) => v + right[i]).subarray(rate / 4, rate / 4 + 16384)
  // Autocorrelation peak near the expected period, refined between samples with a parabola.
  const lag = (k: number) => { let sum = 0; for (let i = 0; i + k < x.length; i++) sum += x[i] * x[i + k]; return sum }
  const expected = rate / hz
  let best = Math.round(expected), top = -Infinity
  for (let k = Math.floor(expected * 0.9); k <= Math.ceil(expected * 1.1); k++) { const v = lag(k); if (v > top) { top = v; best = k } }
  const a = lag(best - 1), b = lag(best), c = lag(best + 1)
  return { hz: rate / (best + 0.5 * (a - c) / (a - 2 * b + c)), level: Math.sqrt(lag(0) / x.length) }
}

/** 16-bit stereo WAV, for saving a render to listen to. */
export function wav(left: Float32Array, right: Float32Array, rate: number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + left.length * 4), view = new DataView(bytes)
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + left.length * 4, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, left.length * 4, true)
  for (let i = 0; i < left.length; i++) { view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true); view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true) }
  return bytes
}

function mount(): void {
  const root = document.querySelector<HTMLElement>('#lab')!
  const state: Scene = { ...SCENES.Cruise }
  let context: AudioContext | undefined, score: Score | undefined, filter: BiquadFilterNode | undefined, analyser: AnalyserNode | undefined
  const sliders: [keyof Scene, string, number, number, number][] = [
    ['speed', 'Speed (m/s)', 0, 60, 1], ['heat', 'Tag beams nearby', 0, 1, 0.01], ['clearance', 'Height above ground (m)', 0, 200, 1], ['altitude', 'Altitude (m)', 0, 600, 5],
    ['submerged', 'Depth under water (m)', 0, 5, 0.1], ['lava', 'Lava nearby', 0, 1, 0.01], ['progress', 'Your share of the winning score', 0, 1, 0.01],
  ]
  const toggles: [keyof Scene, string][] = [['playing', 'In play (off is the lobby)'], ['airborne', 'Airborne'], ['holding', 'Holding the hill'], ['contested', 'Hill contested']]
  root.innerHTML = `<h1>SYN3H / ADAPTIVE SCORE</h1><p>Everything you hear is synthesised live from a seed. Nothing is a recording.</p>
    <button id="power">Start the score</button> <label>Theme seed <input id="seed" type="number" value="1234" min="1" max="999999"></label> <button id="reseed">New theme</button> <button id="shot">Tag beam nearby</button> <button id="accent">Capture</button> <button id="climax">Play the climb and release</button> <button id="surge">Surge (as on take-off)</button> <button id="win">Release now (as on a win)</button>
    <div id="scenes">${Object.keys(SCENES).map(name => `<button data-scene="${name}">${name}</button>`).join('')}</div>
    ${sliders.map(([key, label, min, max, step]) => `<label>${label} <output data-out="${key}"></output><input data-key="${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`).join('')}
    <div id="toggles">${toggles.map(([key, label]) => `<label><input data-toggle="${key}" type="checkbox"> ${label}</label>`).join('')}</div>
    <div id="layers"><strong>Layers</strong> ${LAYERS.map(name => `<label><input data-layer="${name}" type="checkbox" checked> ${name}</label>`).join('')}</div>
    <label style="display:inline-block"><input id="lite" type="checkbox"> Lighter score (for phones)</label> <label style="display:inline-block"><input id="network" type="checkbox"> Algorithmic hall (cheaper)</label>
    <label>Volume <input id="volume" type="range" min="0" max="1" step="0.01" value="0.6"></label>
    <pre id="readout">Stopped</pre><canvas id="scope" width="640" height="120"></canvas>`
  const sync = () => {
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-key]')) { const key = input.dataset.key as keyof Scene; input.value = String(state[key]); root.querySelector(`[data-out="${key}"]`)!.textContent = String(state[key]) }
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-toggle]')) input.checked = Boolean(state[input.dataset.toggle as keyof Scene])
  }
  sync()
  const seed = root.querySelector<HTMLInputElement>('#seed')!, volume = root.querySelector<HTMLInputElement>('#volume')!, power = root.querySelector<HTMLButtonElement>('#power')!
  let out: GainNode | undefined
  power.addEventListener('click', async () => {
    if (!context) {
      context = new AudioContext()
      const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.15
      analyser = context.createAnalyser(); analyser.fftSize = 2048
      out = context.createGain(); out.gain.value = Number(volume.value)
      filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000
      filter.connect(out).connect(limiter).connect(analyser).connect(context.destination)
      score = new Score(context, filter, Number(seed.value))
      Object.assign(window, { scoreLab: { score, context } })
    }
    await context.resume()
    score!.setActive(!score!.playing, 1)
    power.textContent = score!.playing ? 'Stop the score' : 'Start the score'
  })
  volume.addEventListener('input', () => { if (out) out.gain.value = Number(volume.value) })
  root.addEventListener('input', event => {
    const input = event.target as HTMLInputElement
    if (input.dataset.key) (state as unknown as Record<string, number>)[input.dataset.key] = Number(input.value)
    if (input.dataset.layer && score) score.synth.trim[input.dataset.layer as (typeof LAYERS)[number]] = input.checked ? 1 : 0
    if (input.dataset.toggle) (state as unknown as Record<string, boolean>)[input.dataset.toggle] = input.checked
    sync()
  })
  root.addEventListener('click', event => {
    const name = (event.target as HTMLElement).dataset?.scene
    if (name) { Object.assign(state, SCENES[name]); if (score) score.mood.heat = Math.min(score.mood.heat, state.heat); sync() }
  })
  root.querySelector('#reseed')!.addEventListener('click', () => { seed.value = String(1 + Math.floor(Math.random() * 999998)); score?.setSeed(Number(seed.value)) })
  seed.addEventListener('change', () => score?.setSeed(Number(seed.value)))
  root.querySelector('#shot')!.addEventListener('click', () => score?.combat(0.2))
  root.querySelector<HTMLInputElement>('#lite')!.addEventListener('change', event => { params.set(scoreLite.def.id, (event.target as HTMLInputElement).checked); for (const box of root.querySelectorAll<HTMLInputElement>('[data-layer]')) box.checked = true })
  root.querySelector<HTMLInputElement>('#network')!.addEventListener('change', event => { params.set(scoreNetworkHall.def.id, (event.target as HTMLInputElement).checked); for (const box of root.querySelectorAll<HTMLInputElement>('[data-layer]')) box.checked = true })
  root.querySelector('#accent')!.addEventListener('click', () => score?.accent())
  root.querySelector('#climax')!.addEventListener('click', () => score?.cue('climb'))
  root.querySelector('#surge')!.addEventListener('click', () => score?.cue('surge'))
  root.querySelector('#win')!.addEventListener('click', () => score?.accent(1))
  const readout = root.querySelector('#readout')!, canvas = root.querySelector<HTMLCanvasElement>('#scope')!, g = canvas.getContext('2d')!, bins = new Uint8Array(1024)
  const frame = () => {
    requestAnimationFrame(frame)
    if (!score || !context || !filter) return
    drive(score, state); applySubmerge(filter, score.mood.depth, context.currentTime)
    const m = score.mood, pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4)
    const load = score.load ? `\naudio thread ${Math.round(score.load.average * 100)}% busy, ${(score.load.underruns * 100).toFixed(1)}% underruns${score.synth.lite ? '  (lighter score)' : ''}` : ''
    readout.textContent = `mode ${score.mode.padEnd(8)}  section ${score.role.padEnd(7)}  tempo ${Math.round(score.tempo)} bpm\nintensity ${pct(m.intensity)}  heat ${pct(m.heat)}  lift ${pct(m.lift)}  darkness ${pct(m.darkness)}  triumph ${pct(m.triumph)}  submerged ${pct(m.depth)}${load}`
    analyser!.getByteFrequencyData(bins)
    g.fillStyle = '#0b0d14'; g.fillRect(0, 0, canvas.width, canvas.height); g.fillStyle = '#5fd4ff'
    // Log frequency axis, so bass and treble each get room.
    for (let x = 0; x < canvas.width; x++) { const bin = Math.floor(2 * (512 ** (x / canvas.width))), h = bins[Math.min(1023, bin)] / 255 * canvas.height; g.fillRect(x, canvas.height - h, 1, h) }
  }
  frame()
}
if (typeof document !== 'undefined' && document.querySelector('#lab')) mount()

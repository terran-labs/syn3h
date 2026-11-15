/**
 * The sound of a vehicle running into something. Every impact is synthesised when it happens,
 * from a thud, some shaped noise and a few ringing tones; nothing is a recording.
 *
 * What it ran into decides the sound:
 *   vehicle  a metal clang: inharmonic partials tuned to the hull, a crunch and a thud
 *   rock     a sharp crack, a low knock, then a few pebbles
 *   sand     a soft whump and a hiss of grains
 *   snow     a muffled crunch
 *   ice      a bright crack with a short glassy ring
 *   glass    obsidian: a chime of high partials and tinkling shards
 *   dust     the Moon: a dull, airless thump
 *   mud      a wet slap, a downward squelch and one bubble
 *   soil     meadow and turf: a plain earthy thud
 *
 * Strength (0 a touch, 1 a wreck) sets loudness, length and brightness together, the way a
 * harder blow does. `CrashWatcher` finds the blows the game does not already report: any
 * sudden loss of speed that is not a landing or a respawn.
 */

export const SURFACES = ['rock', 'sand', 'snow', 'ice', 'glass', 'dust', 'mud', 'soil'] as const
export type Surface = (typeof SURFACES)[number]
export type ImpactKind = Surface | 'vehicle'

export interface Impact {
  kind: ImpactKind
  /** 0 a touch to 1 a wreck. See `impactStrength`. */
  strength: number
  /** The vehicle making the sound ('buggy', 'jet', 'tank', ...). Sets how a hull rings. */
  hull?: string
  /** Any integer: two impacts with different seeds differ slightly in pitch and timing. */
  seed?: number
}

const unit = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))

/** Speed lost in the blow, in metres per second, as a strength from 0 to 1. Under 2 m/s is a nudge, 20 m/s is everything. */
export const impactStrength = (speedLost: number) => unit((speedLost - 2) / 18)

/** What the ground of each world is made of. Keyed by planet recipe id (src/world/planets.ts). */
const GROUND: Record<string, Surface> = {
  volcanic: 'rock', desert: 'sand', alpine: 'soil', archipelago: 'sand', ice: 'ice',
  obsidian: 'glass', badlands: 'rock', moon: 'dust', swamp: 'mud',
}
/**
 * The surface under a point. `snowAbove` is the height in metres where an alpine world turns
 * to snow, if the caller knows it. An unknown world is rock.
 */
export function surfaceOf(planetId: string, height = 0, snowAbove = Infinity): Surface {
  if (planetId === 'alpine' && height > snowAbove) return 'snow'
  return GROUND[planetId] ?? 'rock'
}

/** How each hull rings: the pitch of its lowest partial, how long it rings, and how much body thump it has. */
const HULLS: Record<string, { hz: number; ring: number; thump: number }> = {
  buggy: { hz: 250, ring: 1, thump: 1 },
  'buggy-syn3h': { hz: 250, ring: 1, thump: 1 },
  'buggy-classic': { hz: 300, ring: 0.9, thump: 0.9 },
  jet: { hz: 390, ring: 1.3, thump: 0.7 },
  // A hovercraft is a skirt and a shell: more thump, little ring.
  hovercraft: { hz: 180, ring: 0.45, thump: 1.25 },
  tank: { hz: 135, ring: 1.5, thump: 1.35 },
}
/** Partials of a struck plate, as ratios of the lowest. Not a harmonic series, which is why it sounds like metal. */
const PLATE = [1, 1.47, 2.09, 2.56, 3.71, 5.13]

const noises = new WeakMap<BaseAudioContext, AudioBuffer>()
/** One second of white noise per context, generated once. */
function whiteNoise(context: BaseAudioContext): AudioBuffer {
  let buffer = noises.get(context)
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 48271
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1 }
    noises.set(context, buffer)
  }
  return buffer
}

/**
 * Play one impact into `output`. A bounded one-shot: every node is stopped and disconnected
 * when it ends, and `onEnd` is called. The returned function ends it at once.
 */
export function synthImpact(context: BaseAudioContext, output: AudioNode, impact: Impact, onEnd: () => void = () => {}): () => void {
  const now = context.currentTime, s = unit(impact.strength), level = 0.22 + 0.78 * s
  const nodes: AudioNode[] = [], sources: AudioScheduledSourceNode[] = []
  let seed = (impact.seed ?? 1) * 2654435761 >>> 0, end = now, lastSource: AudioScheduledSourceNode | undefined
  /** Remember which source stops last: when it ends, the whole impact has. */
  const until = (time: number, source: AudioScheduledSourceNode) => { if (time >= end) { end = time; lastSource = source } }
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const master = context.createGain(); master.gain.value = level; master.connect(output); nodes.push(master)

  /** A sine (or other wave) that starts at `hz`, optionally glides to `to`, and dies away over `decay` seconds. */
  const tone = (hz: number, peak: number, decay: number, o: { to?: number; delay?: number; type?: OscillatorType } = {}) => {
    const at = now + (o.delay ?? 0), osc = context.createOscillator(), gain = context.createGain()
    osc.type = o.type ?? 'sine'; osc.frequency.setValueAtTime(hz, at)
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + decay)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    osc.connect(gain).connect(master); osc.start(at); osc.stop(at + decay + 0.02)
    nodes.push(osc, gain); sources.push(osc); until(at + decay + 0.02, osc)
  }
  /** Noise through one filter with its own envelope. `sweep` moves the filter to that frequency as it decays. */
  const burst = (type: BiquadFilterType, hz: number, q: number, peak: number, attack: number, decay: number, o: { delay?: number; sweep?: number } = {}) => {
    const at = now + (o.delay ?? 0), source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain()
    source.buffer = whiteNoise(context); source.loop = true
    filter.type = type; filter.Q.value = q; filter.frequency.setValueAtTime(hz, at)
    if (o.sweep) filter.frequency.exponentialRampToValueAtTime(o.sweep, at + attack + decay)
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + attack); gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
    source.connect(filter).connect(gain).connect(master); source.start(at, random()); source.stop(at + attack + decay + 0.02)
    nodes.push(source, filter, gain); sources.push(source); until(at + attack + decay + 0.02, source)
  }
  // A harder blow is longer as well as louder.
  const long = 0.6 + 0.8 * s, tune = 0.94 + 0.12 * random()

  switch (impact.kind) {
    case 'vehicle': {
      const hull = HULLS[impact.hull ?? 'buggy'] ?? HULLS.buggy
      tone(95, 0.42 * hull.thump, 0.3 * long, { to: 42 })
      burst('bandpass', 2600, 1, 0.45, 0.001, 0.07 * long)
      // A soft touch barely excites the upper partials; a hard one rings the whole plate.
      const partials = 2 + Math.round(4 * s)
      for (let i = 0; i < partials; i++) tone(hull.hz * PLATE[i] * tune * (1 + (random() - 0.5) * 0.02), 0.13 / (1 + i * 0.45), 1.1 * hull.ring * long / (1 + i * 0.5))
      // Something loose rattles a moment later.
      if (s > 0.35) burst('bandpass', 3400, 4, 0.14, 0.001, 0.03, { delay: 0.07 + random() * 0.05 })
      break
    }
    case 'rock':
      tone(80, 0.35, 0.2 * long, { to: 40 })
      // The crack is the point of rock: two hard, bright knocks a few milliseconds apart.
      burst('bandpass', 1900 * tune, 1.2, 0.75, 0.001, 0.07)
      burst('bandpass', 950 * tune, 1.5, 0.5, 0.001, 0.09, { delay: 0.012 })
      burst('lowpass', 300, 0.7, 0.35, 0.002, 0.2 * long)
      for (let i = 0; i < 2 + Math.round(3 * s); i++) burst('bandpass', 2400 + random() * 1800, 3, 0.16, 0.001, 0.03, { delay: 0.07 + random() * 0.3 })
      break
    case 'sand':
      tone(70, 0.4, 0.25 * long, { to: 38 })
      burst('lowpass', 480, 0.7, 0.6, 0.012, 0.35 * long)
      burst('bandpass', 1800, 0.5, 0.06, 0.03, 0.5 * long)
      break
    case 'snow':
      tone(65, 0.35, 0.2 * long, { to: 40 })
      burst('bandpass', 900 * tune, 0.8, 0.5, 0.006, 0.26 * long)
      // The crunch: grains of noise packed close together.
      for (let i = 0; i < 8; i++) burst('bandpass', 1300 + random() * 500, 2, 0.18, 0.002, 0.035, { delay: 0.008 + i * 0.028 + random() * 0.012 })
      break
    case 'ice':
      tone(85, 0.3, 0.16 * long, { to: 50 })
      burst('bandpass', 3800 * tune, 2, 0.5, 0.001, 0.04)
      for (const [ratio, decay] of [[1, 0.55], [1.55, 0.4], [2.26, 0.3]] as const) tone(1900 * ratio * tune, 0.11, decay * long)
      break
    case 'glass':
      tone(90, 0.25, 0.1 * long, { to: 55 })
      burst('highpass', 5000, 0.7, 0.3, 0.001, 0.03)
      for (const hz of [2300, 3650, 5100, 6900]) tone(hz * tune * (1 + (random() - 0.5) * 0.06), 0.09, (0.25 + random() * 0.25) * long)
      // Shards, falling after.
      for (let i = 0; i < 2 + Math.round(4 * s); i++) tone(3000 + random() * 5000, 0.05, 0.06 + random() * 0.08, { delay: 0.06 + random() * 0.4 })
      break
    case 'dust':
      tone(58, 0.6, 0.4 * long, { to: 30 })
      burst('lowpass', 160, 0.7, 0.5, 0.01, 0.45 * long)
      break
    case 'mud':
      tone(75, 0.4, 0.22 * long, { to: 38 })
      burst('lowpass', 600, 0.7, 0.5, 0.008, 0.28 * long)
      burst('bandpass', 700, 4, 0.45, 0.01, 0.4 * long, { sweep: 160 })
      tone(180, 0.14, 0.09, { to: 420, delay: 0.2 + random() * 0.08 })
      break
    case 'soil':
      tone(75, 0.5, 0.26 * long, { to: 38 })
      burst('lowpass', 380, 0.7, 0.55, 0.006, 0.3 * long)
      burst('bandpass', 2200, 0.7, 0.08, 0.004, 0.09)
      break
  }

  let ended = false
  const clean = () => { if (ended) return; ended = true; for (const node of nodes) node.disconnect(); onEnd() }
  if (lastSource) lastSource.onended = clean
  return () => { for (const source of sources) { try { source.stop() } catch { /* already stopped */ } } clean() }
}

/**
 * Finds crashes from a vehicle's motion alone. Feed it the position and velocity once per
 * physics step; it returns the speed lost when that step was a blow, otherwise 0.
 *
 * A blow is a change of velocity too large for an engine, a brake or gravity to make in one
 * step. A jump in position means a respawn or a wrap of the world, not a crash. Blows closer
 * together than `gap` seconds are one event, and `suppress` lets the caller say another
 * system has already made a sound for this one (a vehicle against a vehicle).
 */
export class CrashWatcher {
  private last: { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null = null
  private quietUntil = -Infinity
  constructor(private readonly threshold = 3.5, private readonly gap = 0.18) {}
  suppress(time: number): void { this.quietUntil = Math.max(this.quietUntil, time + this.gap) }
  reset(): void { this.last = null }
  step(p: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, time: number): number {
    const last = this.last
    this.last = { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z }
    if (!last) return 0
    if (Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 6) return 0
    const lost = Math.hypot(v.x - last.vx, v.y - last.vy, v.z - last.vz)
    if (lost < this.threshold || time < this.quietUntil || !Number.isFinite(lost)) return 0
    this.quietUntil = time + this.gap
    return lost
  }
}

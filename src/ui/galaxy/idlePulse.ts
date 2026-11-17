/**
 * The lobby at rest (the owner, 16 November 2026): once nobody has touched it for a while,
 * the planets breathe. Each swells its own hover glow (hoverGlow.ts) slowly in and out on its
 * own slow, wandering period, at its own random phase, with long quiet stretches between, so
 * the system never blinks in step and is never a field of lights. Any input fades it all out.
 *
 * Pure numbers, seeded, so checks can reproduce it. Galaxy.ts asks for each world's pulse each
 * frame and draws it with the hover glow's own effect and colours; its caption brightens with it.
 */
import { defineParam } from '../../../shared/params'

const P = { group: 'Graphics', scope: 'client' } as const
/** Seconds without input before the planets start to breathe. */
export const idleAfter = defineParam({ ...P, id: 'lobby.idleAfter', label: 'Lobby at rest: seconds before planets pulse (0 never)', default: 8, min: 0, max: 60, step: 1 })
/** The range each planet's period is drawn from, in seconds. */
export const idlePeriodMin = defineParam({ ...P, id: 'lobby.idlePeriodMin', label: 'Lobby at rest: shortest pulse period (s)', default: 6, min: 2, max: 30, step: 0.5 })
export const idlePeriodMax = defineParam({ ...P, id: 'lobby.idlePeriodMax', label: 'Lobby at rest: longest pulse period (s)', default: 14, min: 2, max: 40, step: 0.5 })
/** A pulse's peak against a real hover's full glow: a little under, so hovering still reads stronger. */
export const idlePeak = defineParam({ ...P, id: 'lobby.idlePeak', label: 'Lobby at rest: pulse peak (share of hover)', default: 0.8, min: 0, max: 1, step: 0.05 })

/** Share of each period the swell lasts; the rest is quiet. */
export const SWELL = 0.36
/** Seconds for the whole rest state to come in once idle, and to go on input. */
const FADE_IN = 2.5, FADE_OUT = 0.45

/** A small seeded generator (mulberry32): the same sequence for the same seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The swell inside one period, 0 to 1: a smooth hump over the first SWELL of it, then quiet. */
export function swell(u: number): number {
  if (u <= 0 || u >= SWELL) return 0
  const s = Math.sin(Math.PI * u / SWELL)
  return s * s
}

interface Breath { start: number; period: number }

export class IdlePulse {
  /** 0 to 1: how far the whole rest state is in. */
  envelope = 0
  private readonly breaths: Breath[] = []
  private readonly random: () => number
  private base: number[] = []
  constructor(seed: number, private readonly count: number) {
    this.random = seeded(seed)
    const low = idlePeriodMin.value, high = Math.max(low, idlePeriodMax.value)
    for (let i = 0; i < count; i++) {
      // Its own period, and a random phase: it may start anywhere in its first breath.
      const period = low + (high - low) * this.random()
      this.base.push(period)
      this.breaths.push({ start: -this.random() * period, period })
    }
  }
  /** Fade the whole state toward `on` over `dt` seconds. Returns true while it is changing. */
  fade(on: boolean, dt: number): boolean {
    const before = this.envelope
    this.envelope = on ? Math.min(1, this.envelope + dt / FADE_IN) : Math.max(0, this.envelope - dt / FADE_OUT)
    return this.envelope !== before
  }
  /** Each world's pulse at time `t` seconds (rest clock), 0 to 1, before the envelope and peak. */
  at(t: number): number[] {
    const out: number[] = []
    for (let i = 0; i < this.count; i++) {
      const b = this.breaths[i]
      // A new breath each period, its length wandering 20% either way round the planet's own,
      // so no two planets fall into step and no pattern repeats.
      while (t >= b.start + b.period) { b.start += b.period; b.period = this.base[i] * (0.8 + 0.4 * this.random()) }
      out.push(swell((t - b.start) / b.period))
    }
    return out
  }
}

export const restFade = { in: FADE_IN, out: FADE_OUT }

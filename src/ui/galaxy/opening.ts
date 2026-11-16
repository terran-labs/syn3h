/**
 * The continuous opening (a prototype behind ?intro=, lobby.intro): the loading veil is black
 * space with one point of light where the galaxy's sun will be (index.html), and when loading
 * ends the point becomes the sun. It flares, its shafts burst outward, the stars come up, the
 * orbits draw round, the worlds arrive from the innermost out, and the wordmark comes last.
 * The camera either pulls back from the sun to the lobby's framing or pushes in to it.
 *
 * This module is the timeline only: what each part shows at a time since loading ended. The
 * galaxy reads it each frame; nothing waits on it. A tap, click or key skips to the end.
 */
import { defineParam } from '../../../shared/params'

/** 0: today's veil and fade. 1 to 3: the continuous opening (OPENING_NAMES). Set by ?intro=. */
export const introMode = defineParam({ id: 'lobby.intro', label: 'Lobby opening: 0 off, 1 pull back, 2 push in, 3 pull back with the name on the veil', group: 'Graphics', scope: 'client', default: 0, min: 0, max: 3, step: 1 })

export const OPENING_SECONDS = 2.8

export type OpeningMode = 1 | 2 | 3
/** 1: pull back from the sun; 2: push in through the rays; 3: as 1, the veil keeps its wordmark. */
export const OPENING_NAMES = ['Off', 'Pull back', 'Push in', 'Pull back, name on veil'] as const

export interface OpeningState {
  /** The sun: 0 a point, 1 itself; a little over 1 while it flares. */
  sun: number
  /** How far the shafts have burst out from the sun, in the shader's sun-distance units. */
  front: number
  stars: number
  /** The share of each orbit line drawn, round from the far side. */
  orbits: number
  /** Each world's size, 0 to 1, by lane (innermost first). */
  arrive: number[]
  /** The wordmark: how far its reveal has swept out from the sun, and its opacity. */
  markFront: number
  mark: number
  /** The camera's distance as a multiple of where it will settle. */
  reach: number
  done: boolean
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from))
const ease = (x: number) => x * x * (3 - 2 * x)
const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10)
const out = (x: number) => 1 - (1 - x) ** 3

/** The opening at `t` seconds after loading ended (negative: still loading, the point alone). */
export function openingState(t: number, mode: OpeningMode, lanes: number): OpeningState {
  // A quick flare past full, settling back.
  const sun = t <= 0 ? 0 : t < 0.28 ? 1.55 * out(t / 0.28) : 1 + 0.55 * (1 - ease(span(t, 0.28, 0.75)))
  const arrive = Array.from({ length: lanes }, (_, lane) => {
    const start = 0.95 + 1.0 * lane / Math.max(1, lanes)
    return out(span(t, start, start + 0.5))
  })
  const travel = smoother(span(t, 0, 2.4)), from = mode === 2 ? 2.6 : 0.42
  return {
    sun,
    front: 2.6 * out(span(t, 0.18, 1.45)),
    stars: ease(span(t, 0.45, 1.5)),
    orbits: ease(span(t, 0.8, 1.85)),
    arrive,
    markFront: 2.6 * ease(span(t, 1.9, 2.75)),
    mark: ease(span(t, 1.9, 2.5)),
    reach: from + (1 - from) * travel,
    done: t >= OPENING_SECONDS,
  }
}

/** Everything in place: the settled lobby. */
export const SETTLED: OpeningState = openingState(OPENING_SECONDS, 1, 0)

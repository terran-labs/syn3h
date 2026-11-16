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

/** The lobby's opening: 2, push in, for everyone. 0 (the old veil and fade) and 1 (pull back) are previews, by ?intro=. */
export const introMode = defineParam({ id: 'lobby.intro', label: 'Lobby opening: 2 push in (the lobby); 0 off, 1 pull back', group: 'Graphics', scope: 'client', default: 2, min: 0, max: 2, step: 1 })

export const OPENING_SECONDS = 2.95
/** The point holds this long after loading ends, full size, before it flares: the moment registers. */
const BEAT = 0.25

export type OpeningMode = 1 | 2
/** 1: pull back from the sun; 2: push in through the rays. */
export const OPENING_NAMES = ['Off', 'Pull back', 'Push in'] as const

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
  /** Whether each world's label shows yet, by lane: only once the camera has settled, outermost last. */
  labels: boolean[]
  /** The wordmark: how far the shafts' sweep that reveals it has reached from the sun, and its opacity. */
  markFront: number
  mark: number
  /** The camera's distance as a multiple of where it will settle. */
  reach: number
  /** The lobby's own controls (hint, links, preview menu): 0 held back, 1 shown. */
  chrome: number
  done: boolean
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from))
const ease = (x: number) => x * x * (3 - 2 * x)
const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10)
const out = (x: number) => 1 - (1 - x) ** 3

/** The opening at `t` seconds after loading ended (negative: still loading, the point alone). */
export function openingState(time: number, mode: OpeningMode, lanes: number): OpeningState {
  // After the beat, everything runs on its own clock, t.
  const t = time - BEAT
  // A quick flare past full, settling back.
  const sun = t <= 0 ? 0 : t < 0.26 ? 1.55 * out(t / 0.26) : 1 + 0.55 * (1 - ease(span(t, 0.26, 0.7)))
  const arrive = Array.from({ length: lanes }, (_, lane) => {
    const start = 0.85 + 0.9 * lane / Math.max(1, lanes)
    return out(span(t, start, start + 0.45))
  })
  // The camera has arrived by 2.2 s; the labels follow from the innermost out, the outermost last.
  const labels = Array.from({ length: lanes }, (_, lane) => t >= 2.15 + 0.3 * lane / Math.max(1, lanes))
  const travel = smoother(span(t, 0, 2.2)), from = mode === 2 ? 2.6 : 0.42
  return {
    sun,
    front: 2.6 * out(span(t, 0.15, 1.35)),
    stars: ease(span(t, 0.4, 1.4)),
    orbits: ease(span(t, 0.75, 1.7)),
    arrive,
    labels,
    // The shafts sweep out across the name, slowly enough to see.
    markFront: 0.15 + 1.6 * ease(span(t, 1.6, 2.6)),
    mark: span(t, 1.6, 1.7),
    reach: from + (1 - from) * travel,
    chrome: ease(span(t, 2.2, 2.7)),
    done: time >= OPENING_SECONDS,
  }
}

/** Seconds the name takes to go when a world is chosen: well inside the flight to it. */
export const LEAVING_SECONDS = 0.5
/**
 * Leaving for a world: the reveal run backwards. The front of light runs back across the
 * letters toward the sun, and they go dark behind it. `t` is seconds since the world was chosen.
 */
export function leavingMark(t: number): { markFront: number; mark: number } {
  const x = span(t, 0, LEAVING_SECONDS)
  return { markFront: 0.15 + 1.6 * (1 - ease(x)), mark: 1 - span(t, LEAVING_SECONDS * 0.85, LEAVING_SECONDS) }
}

/** Everything in place: the settled lobby. */
export const SETTLED: OpeningState = openingState(OPENING_SECONDS, 1, 0)

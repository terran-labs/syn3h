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

/** The full opening, the first load of a browser session. Later loads play it SHORT_PACE times faster. */
export const OPENING_SECONDS = 8.8
export const SHORT_PACE = 3.1

export type OpeningMode = 1 | 2
/** 1: pull back from the sun; 2: push in through the rays. */
export const OPENING_NAMES = ['Off', 'Pull back', 'Push in'] as const

export interface OpeningState {
  /** Before ignition, how far the point of light has gathered and swollen: 0 to 1. */
  swell: number
  /** The sun: 0 a point, 1 itself; over 1 while it flares. */
  sun: number
  /** How far the shafts have unfurled from the sun, in the shader's sun-distance units. */
  front: number
  stars: number
  /** Each world's orbit line, drawn round from the far side ahead of it, by lane (innermost first). */
  orbits: number[]
  /** Each world's arrival, 0 to 1, by lane. */
  arrive: number[]
  /** Whether each world's label shows yet, by lane: only once the camera has settled, outermost last. */
  labels: boolean[]
  /** The wordmark: how far the light front kindling it has reached from the sun, and its opacity. */
  markFront: number
  mark: number
  /** The camera's distance as a multiple of where it will settle. */
  reach: number
  /** The lobby's own controls (hint, links, gear, banner): 0 held back, 1 shown. */
  chrome: number
  done: boolean
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from))
const ease = (x: number) => x * x * (3 - 2 * x)
const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10)
const out = (x: number) => 1 - (1 - x) ** 3
const inOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2

/**
 * The wordmark's fade in, the same everywhere it arrives (the opening, a return from a world,
 * the flat logo): it starts the moment the lobby is first drawn and takes this long, on a
 * smootherstep (no slope, and no change of slope, at either end, so neither end pops).
 */
export const WORDMARK_FADE_SECONDS = 4.2
export const wordmarkFade = (seconds: number) => smoother(span(seconds, 0, WORDMARK_FADE_SECONDS))

/**
 * The beats, in seconds of the full opening after loading ends:
 *   0.0 to 1.6  gather: the point swells and brightens slowly, then holds its breath;
 *   1.6 to 3.2  ignition: a flare blooms past full and settles; the rays unfurl over 1.7 s and
 *               the stars come up;
 *   1.6 to 6.4  the camera travels (push in, or pull back);
 *   3.2 to 7.1  the worlds, innermost first, 0.38 s apart: each one's orbit line draws ahead of
 *               it, then it resolves;
 *   6.5 to 6.9  their labels, once the camera has settled, the outermost last;
 *   7.0 to 8.4  the name: the light front crosses the letters along the orbit, each kindling as
 *               it is reached, then settling;
 *   8.2 to 8.7  the lobby's controls.
 * `pace` above 1 plays it that much faster (SHORT_PACE for later loads in a session).
 */
export function openingState(time: number, mode: OpeningMode, lanes: number, pace = 1): OpeningState {
  const t = time * pace
  const swell = t <= 0 ? 0 : ease(span(t, 0, 1.25)) * (1 - 0.15 * ease(span(t, 1.25, 1.6)))
  // Ignition: an accelerating bloom past full, then a slow settle.
  const sun = t < 1.6 ? 0 : t < 2.15 ? 1.8 * inOut(span(t, 1.6, 2.15)) : 1 + 0.8 * (1 - smoother(span(t, 2.15, 3.2)))
  const gap = 0.38, first = 3.2
  const orbits = Array.from({ length: lanes }, (_, lane) => ease(span(t, first + gap * lane, first + gap * lane + 0.7)))
  const arrive = Array.from({ length: lanes }, (_, lane) => { const start = first + gap * lane + 0.35; return out(span(t, start, start + 0.6)) })
  const labels = Array.from({ length: lanes }, (_, lane) => t >= Math.max(6.5 + 0.4 * lane / Math.max(1, lanes), first + gap * lane + 0.95))
  const travel = smoother(span(t, 1.6, 6.4)), from = mode === 2 ? 2.6 : 0.42
  return {
    swell,
    sun,
    front: 2.6 * inOut(span(t, 1.75, 3.45)),
    stars: ease(span(t, 2.2, 3.6)),
    orbits,
    arrive,
    labels,
    // The name fades in from the first frame, its light front crossing the letters as it does.
    markFront: 0.15 + 1.6 * wordmarkFade(t),
    mark: wordmarkFade(t),
    reach: from + (1 - from) * travel,
    chrome: ease(span(t, 8.2, 8.7)),
    done: t >= OPENING_SECONDS,
  }
}

/**
 * Coming back from a world: the name alone fades in again, on the same curve as at the
 * opening, from the moment the lobby is back.
 */
export const RETURN_SECONDS = WORDMARK_FADE_SECONDS
export function returningMark(t: number): { markFront: number; mark: number } {
  return { markFront: 0.15 + 1.6 * wordmarkFade(t), mark: wordmarkFade(t) }
}

/** Whether this browser session has seen the full opening (and so gets the short one). */
const SEEN_KEY = 'syn3h.openingSeen'
export function openingPace(): number {
  try { if (sessionStorage.getItem(SEEN_KEY)) return SHORT_PACE; sessionStorage.setItem(SEEN_KEY, '1') } catch { /* No storage: always the full one. */ }
  return 1
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

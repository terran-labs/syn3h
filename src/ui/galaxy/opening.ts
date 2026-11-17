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

/**
 * The opening, every load: a cartoon Big Bang (the owner's direction, 16 November 2026). It
 * lasts as long as the name's fade; everything else has settled by SETTLED_SECONDS.
 */
export const OPENING_SECONDS = 4.2
export const SETTLED_SECONDS = 3.0

export type OpeningMode = 1 | 2
/** 1: pull back from the sun; 2: push in through the rays. */
export const OPENING_NAMES = ['Off', 'Pull back', 'Push in'] as const

export interface OpeningState {
  /** The point of light before the pop: above 0 swollen, below 0 squeezed (the anticipation). */
  swell: number
  /** The soft round burst: its radius in the shader's sun-distance units, and its strength (0 none). */
  burst: [number, number]
  /** The stars streaming out from the centre: 0 all at the centre, 1 where they rest. */
  spread: number
  /** Each world's fling out along a spiral, 0 at the sun, 1 in place (may pass 1 a little, then settle), by lane. */
  fling: number[]
  /** The same a moment earlier (TRAIL_SECONDS): where each world's trail starts. */
  flingBehind: number[]
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

const back = (x: number) => { const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2 }

/**
 * The Big Bang, in seconds after loading ends (first rough version, for the owner's preview):
 *   0.00 to 0.30  anticipation: the point squeezes small and bright;
 *   0.30 to 0.65  the pop: the sun swells past itself (1.35) and settles by 1.3 s; a soft warm
 *                 burst ring rolls out past the screen's edge by 1.5 s, thick and bright at
 *                 first, thinning and fading as it grows (no full-screen flash, no strobe);
 *   0.35 to 1.60  the stars stream out from the centre to where they rest;
 *   0.40 to 2.05  the rays unfurl, growing to their settled strength;
 *   0.45 to 2.79  the worlds are flung out on spirals, innermost first, 0.13 s apart, each in
 *                 1.3 s: a small bright mote with a fading trail, fast out and slow in, passing
 *                 its orbit a little and settling back, growing to itself as it lands; each
 *                 orbit line draws round just ahead of its world's flight;
 *   0.30 to 2.60  the view eases out a little, as the universe expands;
 *   2.35 to 2.75  the labels, outermost last; 2.45 to 2.95 the lobby's controls;
 *   0.00 to 4.20  the name fades in (wordmarkFade), the one beat that runs on past the bang.
 */
/** How far behind a flung world its fading trail reaches, in seconds of its flight. */
export const TRAIL_SECONDS = 0.14
const GAP = 0.13, FIRST = 0.45, FLIGHT = 1.3
/** A world's flight, 0 to 1 (raw), by lane. */
const flight = (t: number, lane: number) => span(t, FIRST + GAP * lane, FIRST + GAP * lane + FLIGHT)
/** Fast out, slow in, past the orbit a little and back: the cartoon fling. */
const flingOf = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : back(x)

export function openingState(time: number, _mode: OpeningMode, lanes: number): OpeningState {
  const t = time
  const swell = t <= 0 ? 0 : t < 0.3 ? -0.55 * ease(span(t, 0, 0.3)) : -0.55 * (1 - span(t, 0.3, 0.4))
  const sun = t < 0.3 ? 0 : t < 0.65 ? 1.35 * out(span(t, 0.3, 0.65)) : 1 + 0.35 * (1 - smoother(span(t, 0.65, 1.3)))
  // The burst: thick and bright as it leaves the sun, thinner and fainter as it rolls out
  // past the screen's edge.
  const burstAt = span(t, 0.3, 1.5)
  const lane = Array.from({ length: lanes }, (_, i) => i)
  const fling = lane.map(i => flingOf(flight(t, i)))
  const flingBehind = lane.map(i => flingOf(flight(t - TRAIL_SECONDS, i)))
  // Each orbit line draws round just ahead of its world's flight: the track it lands on.
  const orbits = lane.map(i => ease(span(t, FIRST + GAP * i - 0.1, FIRST + GAP * i + FLIGHT * 0.7)))
  // A flung world is a small bright mote on its way, growing to itself as it lands.
  const arrive = lane.map(i => { const x = flight(t, i); return x <= 0 ? 0 : 0.32 * out(span(x, 0, 0.12)) + 0.68 * smoother(span(x, 0.62, 0.95)) })
  const labels = lane.map(i => t >= 2.35 + 0.4 * i / Math.max(1, lanes))
  return {
    swell,
    // Out to 1.4 sun-distance units, past the far corner of any screen (a phone's long edge is
    // about 1.1), slowing as it goes, so it is seen crossing the screen.
    burst: [1.4 * (1 - (1 - burstAt) ** 2), burstAt > 0 && burstAt < 1 ? 0.7 * (1 - burstAt) ** 1.5 : 0],
    spread: t <= 0.35 ? 0 : out(span(t, 0.35, 1.6)),
    fling,
    flingBehind,
    sun,
    front: 2.6 * inOut(span(t, 0.4, 2.05)),
    stars: ease(span(t, 0.35, 0.9)),
    orbits,
    arrive,
    labels,
    // The name fades in from the first frame, its light front crossing the letters as it does.
    markFront: 0.15 + 1.6 * wordmarkFade(t),
    mark: wordmarkFade(t),
    reach: 0.8 + 0.2 * smoother(span(t, 0.3, 2.6)),
    chrome: ease(span(t, 2.45, 2.95)),
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

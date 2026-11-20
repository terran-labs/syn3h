/**
 * The continuous opening (a prototype behind ?intro=, lobby.intro): the loading veil is black
 * space with one point of light where the galaxy's sun will be (index.html), and when loading
 * ends the point becomes the sun. It flares, its shafts burst outward, the stars come up, the
 * orbits draw round, and the worlds arrive from the innermost out with the wordmark fading in
 * as they come.
 * The camera either pulls back from the sun to the lobby's framing or pushes in to it.
 *
 * This module is the timeline only: what each part shows at a time since loading ended. The
 * galaxy reads it each frame; nothing waits on it. A tap, click or key skips to the end.
 */
import { defineParam } from '../../../shared/params'

/** The lobby's opening: 2, push in, for everyone. 0 (the old veil and fade) and 1 (pull back) are previews, by ?intro=. */
export const introMode = defineParam({ id: 'lobby.intro', label: 'Lobby opening: 2 push in (the lobby); 0 off, 1 pull back', group: 'Graphics', scope: 'client', default: 2, min: 0, max: 2, step: 1 })

/**
 * The opening, every load: a cartoon Big Bang (the owner's direction, 16 November 2026), made
 * slower and more dramatic on 17 November ("the lobby animation should be slower and more
 * dramatic"): a held breath, a harder bang, longer arcs, the camera pulling back with weight,
 * and (19 November 2026, the owner: "it should be fading in while the planets are spinning
 * in") the name arriving with the worlds, no longer after them. 8.6 s, from 4.6. Everything has
 * settled by SETTLED_SECONDS.
 */
export const OPENING_SECONDS = 8.6
/** Seconds from the opening's first frame to the pop (openingState below): where the score's drop lands when a tap began it. */
export const POP_SECONDS = 1.2
/**
 * When a tap began the opening (src/ui/TapToBegin.ts): the performance.now() at which its sound
 * is heard. The galaxy starts the opening there, not on whatever frame comes next, so a slow
 * frame cannot pull the picture and the sound apart.
 */
export const openingCue: { at: number | null } = { at: null }
export const SETTLED_SECONDS = 7.8

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

/**
 * A flung world's way out, 0 to 1 of its flight: fast at the start and slowing the whole way,
 * its speed falling to nothing at the end (quartic ease out), so it glides onto its orbit and
 * carries on with the orbit's own slow drift. `overshoot` adds a slight, slow pass beyond the
 * orbit and back (0 none; the owner's preview chose none, see FLING_OVERSHOOT).
 */
export function flingOf(x: number, overshoot = FLING_OVERSHOOT): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return 1 - (1 - x) ** 4 + overshoot * Math.sin(Math.PI * x) * x * x
}
/** The slight overshoot of a landing world, as a share of its orbit: 0, a pure glide. */
export const FLING_OVERSHOOT = 0

/** How far behind a flung world its fading trail reaches, in seconds of its flight. */
export const TRAIL_SECONDS = 0.2
/** Departures: the first world, the gap between worlds, and each world's flight, in seconds. */
export const FIRST = POP_SECONDS + 0.25, GAP = 0.25, FLIGHT = 3.8
/** How far (radians) a world's way out turns back along its orbit: a longer arc than the 2.4 before. */
export const SPIRAL_TURN = 3.4
/**
 * The name arrives with the worlds (the owner, 19 November 2026): its fade starts as the first
 * world is thrown out and ends as the last one lands, on the same smootherstep as everywhere.
 */
export const MARK_FROM = FIRST
/** Seconds the name takes to arrive in the opening, with `lanes` worlds: until the last has landed. */
export const markSeconds = (lanes: number) => GAP * Math.max(0, lanes - 1) + FLIGHT
/** A world's flight, 0 to 1 (raw), by lane. */
export const flight = (t: number, lane: number) => span(t, FIRST + GAP * lane, FIRST + GAP * lane + FLIGHT)

/**
 * The Big Bang, in seconds from its first frame (the end of loading, or the tap that begins it).
 * P is POP_SECONDS, 1.2:
 *   0 to P        the held breath: the point draws in, brightening and trembling a little more
 *                 as the pop nears; the score's swell rises over the same span;
 *   P to P+0.5    the pop: the sun flares well past itself (1.6), settling by P+2;
 *   P to P+3      a warm burst ring rolls out past every screen edge, brighter than before,
 *                 slowing and thinning as it goes (still no full-screen flash);
 *   P to P+3.2    the stars drift out to where they rest, their light building over P to P+2.4;
 *   P to P+4      the rays grow to their settled strength;
 *   P+0.25 on     the worlds are thrown out, innermost first, 0.25 s apart, each decelerating
 *                 along a longer spiral (SPIRAL_TURN) for 3.8 s onto its orbit; the last lands
 *                 by 7.3 s with nine worlds; each orbit line draws round just ahead of its world;
 *   P+0.25 to 7.25  the name arrives with the worlds: its light front sweeps the letters
 *                 from the first world's throw to the last one's landing (nine worlds);
 *   P to 7.4      the view pulls back from close in, slow to start and slow to settle;
 *   7.3 to 7.75   the labels, each once its world has landed, outermost last; 7.3 to 7.8 the
 *                 lobby's controls.
 */
export function openingState(time: number, _mode: OpeningMode, lanes: number): OpeningState {
  const t = time, P = POP_SECONDS
  // The held breath: drawn in slowly, then a fine tremble grows as the pop nears.
  const held = span(t, 0, P), tremble = t > 0 && t < P ? 0.08 * held * held * Math.sin(t * 46) : 0
  const swell = t <= 0 ? 0 : t < P ? -0.7 * smoother(held) + tremble : -0.7 * (1 - span(t, P, P + 0.12))
  const sun = t < P ? 0 : t < P + 0.5 ? 1.6 * out(span(t, P, P + 0.5)) : 1 + 0.6 * (1 - smoother(span(t, P + 0.5, P + 2)))
  const burstAt = span(t, P, P + 3)
  const lane = Array.from({ length: lanes }, (_, i) => i)
  const fling = lane.map(i => flingOf(flight(t, i)))
  const flingBehind = lane.map(i => flingOf(flight(t - TRAIL_SECONDS, i)))
  // Each orbit line draws round just ahead of its world's flight: the track it lands on.
  const orbits = lane.map(i => ease(span(t, FIRST + GAP * i - 0.1, FIRST + GAP * i + FLIGHT * 0.6)))
  // A small bright mote at once, growing to itself over its whole glide.
  const arrive = lane.map(i => { const x = flight(t, i); return x <= 0 ? 0 : Math.min(1, 0.32 * out(span(x, 0, 0.05)) + 0.68 * smoother(x)) })
  // Each label once its world has landed, and not before 7.3 s: the outermost last.
  const labels = lane.map(i => t >= Math.max(7.3 + 0.45 * i / Math.max(1, lanes), FIRST + GAP * i + FLIGHT))
  const mark = smoother(span(t, MARK_FROM, MARK_FROM + markSeconds(lanes)))
  return {
    swell,
    burst: [1.6 * (1 - (1 - burstAt) ** 2), burstAt > 0 && burstAt < 1 ? 0.95 * (1 - burstAt) ** 1.5 : 0],
    spread: t <= P ? 0 : smoother(span(t, P + 0.05, P + 3.2)),
    fling,
    flingBehind,
    sun,
    front: 2.6 * inOut(span(t, P + 0.1, P + 4)),
    stars: smoother(span(t, P + 0.05, P + 2.4)),
    orbits,
    arrive,
    labels,
    // The name arrives with the worlds, its light front crossing the letters as it does.
    markFront: 0.15 + 1.6 * mark,
    mark,
    reach: 0.62 + 0.38 * smoother(span(t, P, 7.4)),
    chrome: ease(span(t, 7.3, 7.8)),
    done: t >= OPENING_SECONDS,
  }
}

/** Seconds the view takes to swing back to the lobby's resting view after a world (Galaxy.returnHome). */
export const RETURN_VIEW_SECONDS = 1.6
/**
 * Coming back from a world: the name fades in again while the lobby swings back into view and
 * is in full as it settles (the owner, 19 November 2026: with the planets, not after them), on
 * the same smootherstep. `t` is seconds since the return began.
 */
export const RETURN_SECONDS = RETURN_VIEW_SECONDS
export function returningMark(t: number): { markFront: number; mark: number } {
  const mark = smoother(span(t, 0, RETURN_SECONDS))
  return { markFront: 0.15 + 1.6 * mark, mark }
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

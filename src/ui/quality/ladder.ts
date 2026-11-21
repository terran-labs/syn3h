/**
 * The quality ladder: one idea of "struggling" for everything that draws.
 *
 * Brought over from terranlabs.com (src/concepts/descent/quality.ts there) at the owner's
 * request, logic unchanged. Every canvas loop calls `qualityFrame(now)` once per animation
 * frame. From the gaps between frames this picks a level, and each renderer reads it and
 * sheds work, cheapest visual loss first. For Syn3h's lobby:
 *
 *   0  Full: everything.
 *   1  Ambience goes: star twinkle, the far cloud band, drifting cloud on the worlds.
 *   2  Then post effects: lens flare and ghosts, film grain, the worlds' shadows through
 *      the sun's shafts, and frost (backdrop blur) on glass.
 *   3  Then shader cost: the finest noise octaves, and the render scale drops to 0.86.
 *   4  Render scale 0.73.
 *   5  Render scale 0.6.
 *
 * A frame slower than 20.5 ms missed a beat at 60 Hz. A one-second window with more than
 * 15 percent slow frames steps down a level at once. Stepping back up waits for a calm
 * stretch, which doubles each time a step up turns out too much, so a device on the edge
 * settles instead of flickering. A step down that does not make frames faster is undone and
 * the downward steps rest for a while: when the limit is elsewhere (a display capped at 30
 * frames a second, a busy main thread), shedding detail would cost the look for nothing.
 *
 * Level changes are eased: `qualityShed(step)` rises from 0 to 1 over about half a second,
 * so renderers fade things out instead of popping them. Only the render scale changes in
 * whole steps.
 *
 * This is separate from `gfx.level` (src/core/quality.ts), which is the device class chosen
 * at load. The ladder reacts during a session. It has no imports, so the game's own
 * renderer can call the same functions and share the one state.
 */
export type QualityChoice = "auto" | "full" | "reduced" | "minimal";

const TOP = 5;
const SCALES = [1, 1, 1, 0.86, 0.73, 0.6];
const FORCED: Record<Exclude<QualityChoice, "auto">, number> = { full: 0, reduced: 2, minimal: 3 };

/** A frame slower than this missed a beat at 60 Hz. */
const SLOW_MS = 20.5;
const WINDOW_MS = 1000;
const MIN_FRAMES = 20;
/** Share of slow frames in a window that steps down. */
const STEP_DOWN = 0.15;
/** Share below which a window counts as calm. */
const CALM = 0.02;
const FIRST_HOLD_MS = 5000;
const LONGEST_HOLD_MS = 120000;
const FIRST_REST_MS = 30000;
const LONGEST_REST_MS = 300000;
/** How long an eased change takes, per level. */
const EASE_MS = 500;
/**
 * Frames in the first moments after load are not judged: the page is
 * still hydrating and fetching, which is jank on any device and says
 * nothing about how well it draws.
 */
const WARM_UP_MS = 2500;

export interface QualityState {
  choice: QualityChoice;
  /** Level chosen by measurement (used when the choice is "auto"). */
  auto: number;
  /** Eased level, for fades. */
  smooth: number;
  smoothAt: number;
  lastFrame: number;
  /** The first frame counted, for the warm-up. */
  firstFrame: number;
  windowStart: number;
  frames: number;
  slow: number;
  /** Sum of frame intervals in the window. */
  total: number;
  calmSince: number;
  /** Set after a step up, until the next window has judged it. hold[k] is
   * how long frames must stay calm before stepping up into level k. */
  tryingUp: boolean;
  /** Set after a step down, until the next window has judged it. */
  tryingDown: { from: number; mean: number } | null;
  hold: number[];
  rest: number;
  restUntil: number;
}

export function createQualityState(start: number): QualityState {
  return {
    choice: "auto",
    auto: start,
    smooth: start,
    smoothAt: -1,
    lastFrame: -1,
    firstFrame: -1,
    windowStart: -1,
    frames: 0,
    slow: 0,
    total: 0,
    calmSince: -1,
    tryingUp: false,
    tryingDown: null,
    hold: Array.from({ length: TOP + 1 }, () => FIRST_HOLD_MS),
    rest: FIRST_REST_MS,
    restUntil: -Infinity,
  };
}

export function levelOf(state: QualityState): number {
  return state.choice === "auto" ? state.auto : FORCED[state.choice];
}

/**
 * Counts one animation frame at time `now`. Returns true when the level
 * changed. Exported with the state as an argument so it can be tested with
 * made-up frame times; the page uses `qualityFrame`.
 */
export function countFrame(state: QualityState, now: number): boolean {
  if (now === state.lastFrame) return false;
  const interval = state.lastFrame < 0 ? -1 : now - state.lastFrame;
  state.lastFrame = now;
  if (state.firstFrame < 0) state.firstFrame = now;
  // A long gap is a pause (hidden tab, a loop that stopped), not a slow
  // frame; and the first moments after load are not judged at all.
  if (interval < 0 || interval > 250 || state.windowStart < 0 || now - state.firstFrame < WARM_UP_MS) {
    state.windowStart = now;
    state.frames = 0;
    state.slow = 0;
    state.total = 0;
    return false;
  }
  state.frames++;
  state.total += interval;
  if (interval > SLOW_MS) state.slow++;
  if (now - state.windowStart < WINDOW_MS || state.frames < MIN_FRAMES) return false;

  const share = state.slow / state.frames;
  const mean = state.total / state.frames;
  const start = state.windowStart;
  state.windowStart = now;
  state.frames = 0;
  state.slow = 0;
  state.total = 0;
  const level = state.auto;

  // Judge a step down made one window ago: still slow, and frames no
  // faster on average (by 8 percent or more).
  const down = state.tryingDown;
  state.tryingDown = null;
  if (down && share > STEP_DOWN && mean > down.mean * 0.92) {
    // No better: the limit is elsewhere. Put the detail back and rest.
    state.auto = down.from;
    state.restUntil = now + state.rest;
    state.rest = Math.min(state.rest * 2, LONGEST_REST_MS);
    state.calmSince = -1;
    return true;
  }

  // Judge a step up made one window ago.
  const wasTryingUp = state.tryingUp;
  state.tryingUp = false;

  if (share > STEP_DOWN) {
    state.calmSince = -1;
    // A step up into this level was too much: wait longer next time.
    if (wasTryingUp) state.hold[level] = Math.min(state.hold[level] * 2, LONGEST_HOLD_MS);
    if (level >= TOP || now < state.restUntil) return false;
    state.auto = level + 1;
    // A failed step up goes straight back without a trial.
    if (!wasTryingUp) state.tryingDown = { from: level, mean };
    return true;
  }
  if (share >= CALM) {
    state.calmSince = -1;
    return false;
  }
  if (state.calmSince < 0) state.calmSince = start;
  if (level > 0 && now - state.calmSince >= state.hold[level - 1]) {
    state.auto = level - 1;
    state.tryingUp = true;
    state.calmSince = -1;
    return true;
  }
  return false;
}

/** Moves the eased level towards the level in effect, by elapsed time. */
export function easeTo(state: QualityState, now: number) {
  const target = levelOf(state);
  if (state.smoothAt < 0) {
    state.smooth = target;
  } else {
    const step = Math.max(0, now - state.smoothAt) / EASE_MS;
    state.smooth = state.smooth < target ? Math.min(target, state.smooth + step) : Math.max(target, state.smooth - step);
  }
  state.smoothAt = now;
}

/* ---------- The page's one state ---------- */

/**
 * Where to start before anything is measured: a step down on devices that
 * say they are small (two cores or two gigabytes or less). Everything else
 * starts at full and the measurement decides.
 */
function startingLevel() {
  if (typeof navigator === "undefined") return 0;
  const hints = navigator as Navigator & { deviceMemory?: number };
  const memory = hints.deviceMemory ?? 8;
  const cores = hints.hardwareConcurrency ?? 8;
  return memory <= 2 || cores <= 2 ? 1 : 0;
}

const state = createQualityState(startingLevel());

/** Call once per animation frame from any canvas loop, with its timestamp. */
export function qualityFrame(now: number) {
  countFrame(state, now);
}

/** Sets the Lab's choice: "auto", "full", "reduced" or "minimal". */
export function setQualityChoice(choice: string) {
  state.choice = choice === "full" || choice === "reduced" || choice === "minimal" ? choice : "auto";
}

/** An explicit reduced interface applies in play. Automatic lobby history stays in the lobby. */
export function allowsDriveFrost(): boolean {
  return state.choice === "auto" || state.choice === "full";
}

/** The level in effect, 0 (full) to 5. */
export function qualityLevel(): number {
  return levelOf(state);
}

/**
 * How far the shedding for `step` (1, 2 or 3; see the table above) has gone:
 * 0 keeps everything, 1 has shed it, eased over about half a second.
 */
export function qualityShed(step: number): number {
  easeTo(state, performance.now());
  return Math.min(1, Math.max(0, state.smooth - (step - 1)));
}

/** The render scale for the level in effect: 1 down to 0.6. */
export function qualityScale(): number {
  return SCALES[levelOf(state)];
}

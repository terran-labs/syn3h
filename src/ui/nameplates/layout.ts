/**
 * Pure screen-space rules for vehicle labels.
 *
 * A label belongs to its vehicle by sitting right above it: centred on the point just over the
 * vehicle's roof, a small gap below the plate, nothing drawn between them. It never moves to a
 * side or far away. When two labels would collide the lower-priority one may step up by at most
 * NUDGE pixels; if that is not enough it fades out, and returns when there is room. People
 * outrank bots, then nearer outranks farther.
 *
 * Every decision that could flicker has hysteresis: enter and exit thresholds differ, and a
 * decision holds for HOLD_MS before it may reverse (see Hold).
 */
export interface Rect { left: number; top: number; right: number; bottom: number }
export const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/** Pixels between the anchor over the roof and the plate's lower edge. */
export const GAP = 4
/** The one alternative to sitting right above: this many pixels higher. */
export const NUDGE = 12
/** A decision (shown or hidden, nudged or not, full or compact) holds this long before reversing. */
export const HOLD_MS = 400
/** Fade in and out. No other animation: labels never slide or wipe. */
export const FADE_MS = 150
/** A label already placed keeps its place until another plate is this many pixels inside it. */
export const HOLD_SLACK = 3

/**
 * Size and range by distance, for people and bots.
 *
 * Up close the full plate: name, and a line saying Player or Bot and any status. Past
 * `compactAt` (back again inside `fullAt`) a single line, the name, with the paint-coloured
 * bar. The name shrinks smoothly on a log scale of distance from `largeAt` to `smallAt`, from
 * the plate's own size to MIN_TEXT_PX, never below. Opacity is full to `fadeAt`, then falls
 * to nothing at `range`.
 *
 * People are named out to 1500 m: past that a buggy is under 2 px on a 900 px desktop and
 * under 1 px on a phone, and the label is the only way to find them; it is also about as far
 * as the terrain ray budget allows (one ray per 32 m). Bots are named to 300 m, where a bot is
 * a 7 px speck on a desktop; farther bots are background. At most FAR_BOTS compact bot labels
 * show at once, nearest first.
 */
export const MIN_TEXT_PX = 10
export const DISTANCE = {
  person: { namePx: 14, largeAt: 25, smallAt: 220, fullAt: 45, compactAt: 55, fadeAt: 1200, range: 1500 },
  bot: { namePx: 12, largeAt: 15, smallAt: 120, fullAt: 25, compactAt: 32, fadeAt: 240, range: 300 },
} as const
export const FAR_BOTS = 6

/** The name's ideal size in CSS pixels at `distance` (not yet snapped). */
export function namePx(distance: number, bot: boolean): number {
  const d = bot ? DISTANCE.bot : DISTANCE.person
  const t = Math.max(0, Math.min(1, Math.log(Math.max(distance, 1) / d.largeAt) / Math.log(d.smallAt / d.largeAt)))
  return d.namePx + (MIN_TEXT_PX - d.namePx) * t
}
/**
 * Snap to whole CSS pixels so text renders sharp, keeping the current size until the ideal is
 * more than 0.65 px away (a distance hovering on a boundary must not toggle the size).
 */
export function snapPx(ideal: number, current: number): number {
  if (Number.isFinite(current) && Math.abs(ideal - current) < .65) return current
  return Math.max(MIN_TEXT_PX, Math.round(ideal))
}
/** Compact (one line) or full, with hysteresis between fullAt and compactAt. */
export function compactAt(distance: number, bot: boolean, wasCompact: boolean): boolean {
  const d = bot ? DISTANCE.bot : DISTANCE.person
  return wasCompact ? distance > d.fullAt : distance > d.compactAt
}
/** Opacity from distance alone: 1 to fadeAt, 0 at range. */
export function distanceOpacity(distance: number, bot: boolean): number {
  const d = bot ? DISTANCE.bot : DISTANCE.person
  if (!(distance >= 0)) return 0
  return Math.max(0, Math.min(1, (d.range - distance) / (d.range - d.fadeAt)))
}

/**
 * A boolean decision that may only reverse after it has held for `HOLD_MS`. The first decision
 * is taken at once, so a label appears as soon as its vehicle does.
 */
export interface Hold { value: boolean; since: number }
export function hold(state: Hold, want: boolean, now: number, ms = HOLD_MS): boolean {
  if (want !== state.value && now - state.since >= ms) { state.value = want; state.since = now }
  return state.value
}

/**
 * Critically damped spring towards `target`, frame-rate independent (no overshoot). Used only
 * for the nudge offset; positions themselves are never smoothed, so a label cannot lag its car.
 */
export interface Spring { x: number; v: number }
export function spring(s: Spring, target: number, dt: number, omega = 22): number {
  const x = s.x - target, e = Math.exp(-omega * dt), t = (s.v + omega * x) * dt
  s.x = target + (x + t) * e
  s.v = (s.v - omega * t) * e
  if (Math.abs(s.x - target) < .05 && Math.abs(s.v) < .5) { s.x = target; s.v = 0 }
  return s.x
}

/** A HUD area. Soft areas are passive readouts a label may cover when nothing else is free. */
export interface Exclusion extends Rect { soft?: boolean }

export interface Candidate {
  id: string; bot: boolean
  /** The anchor: just above the roof, this frame. */
  x: number; y: number
  distance: number
  /** Drawn plate size in pixels, after scaling. */
  width: number; height: number
  compact: boolean
  /** Placed at the last allocation, and at which nudge (0 or 1). */
  held: boolean; nudged: boolean
}
export interface Placement { id: string; nudged: boolean; overSoft: boolean }

/** Pixels a plate keeps from the screen's sides. */
export const EDGE = 4
/**
 * Where a plate of `width` starts for an anchor at `x`: centred over the anchor, but kept on
 * screen (a name half off the edge cannot be read), and always with the anchor under the plate,
 * so near an edge the plate slides along it and then leaves with its vehicle. Both limits are
 * continuous in x: nothing jumps.
 */
export function plateLeft(x: number, width: number, screenWidth: number): number {
  const onScreen = Math.max(EDGE, Math.min(screenWidth - EDGE - width, x - width / 2))
  return Math.max(x - width + EDGE * 3, Math.min(x - EDGE * 3, onScreen))
}

/** The plate's box for a candidate at a nudge. `x` is the plate's centre. */
export function plateRect(c: Pick<Candidate, 'x' | 'y' | 'width' | 'height'>, nudged: boolean, out: Rect = { left: 0, top: 0, right: 0, bottom: 0 }): Rect {
  out.bottom = c.y - GAP - (nudged ? NUDGE : 0); out.top = out.bottom - c.height
  out.left = c.x - c.width / 2; out.right = c.x + c.width / 2
  return out
}
const inset = (r: Rect, by: number): Rect => ({ left: r.left + by, top: r.top + by, right: r.right - by, bottom: r.bottom - by })
/** Priority: people, then nearer, then id for a stable order. */
export const priority = (a: Candidate, b: Candidate) => Number(a.bot) - Number(b.bot) || a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Decide which labels show and which step up. A label is tried where it sat last (its held
 * nudge) and then at the other; it is placed if it overlaps no higher-priority plate and no
 * hard HUD area, and covers a soft one only when both nudges are otherwise blocked by soft
 * areas alone. Beyond FAR_BOTS compact bot labels, the farther ones are left out. Returns the
 * placed labels in priority order; the caller fades out the rest.
 */
export function placeLabels(candidates: readonly Candidate[], exclusions: readonly Exclusion[], width: number, height: number): Placement[] {
  const result: Placement[] = [], taken: Rect[] = []
  let farBots = 0
  for (const c of [...candidates].sort(priority)) {
    if (!Number.isFinite(c.x + c.y + c.width + c.height)) continue
    if (c.bot && c.compact && ++farBots > FAR_BOTS) continue
    let placed: Placement | undefined, soft: Placement | undefined
    for (const nudged of c.held ? [c.nudged, !c.nudged] : [false, true]) {
      const rect = plateRect(c, nudged)
      if (rect.right < 0 || rect.left > width || rect.bottom < 0 || rect.top > height) continue
      const test = c.held && nudged === c.nudged ? inset(rect, HOLD_SLACK) : rect
      if (taken.some(t => overlaps(test, t))) continue
      if (exclusions.some(b => !b.soft && overlaps(test, b))) continue
      if (exclusions.some(b => b.soft && overlaps(test, b))) { soft ??= { id: c.id, nudged, overSoft: true }; continue }
      placed = { id: c.id, nudged, overSoft: false }; break
    }
    placed ??= soft
    if (!placed) continue
    taken.push(plateRect(c, placed.nudged))
    result.push(placed)
  }
  return result
}

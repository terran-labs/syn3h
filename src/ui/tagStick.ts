/**
 * The touch Tag button as an aim stick, and the free right side's look drag and pinch zoom.
 * Pure state machines with no DOM: src/ui/TouchControls.ts feeds them pointer positions and
 * carries out what they decide, and tests/ui/tag-stick.test.ts drives them with synthetic
 * touch sequences.
 *
 * Tag, as built:
 *
 * - The press anchors a stick where the thumb went down. The thumb may leave the button: the
 *   button holds pointer capture, so only lifting ends it.
 * - Once the thumb has moved 8 px, the offset from the anchor turns the camera at a rate, like a
 *   gamepad stick: a radial dead zone, then a response curve up to full tilt at
 *   `touch.aimRadius` px, scaled by `touch.aimSpeed` and then by the look sensitivity.
 * - What the press does to the gear depends on its mode, read from the gear in hand at the press:
 *     stream   (Plasma Tag, the quick-fire tag beam) holds the tag control from the first touch
 *              to the lift, so it fires all the time Tag is down, dragging or not.
 *     hold     (Plasma Thunder's charge, Yoink's grab, the Grapple's reel) also holds the tag
 *              control while down: the gear's own action is the hold, and it sends on the lift
 *              (Thunder sends its charge, Yoink flings what it carries) where the reticle points.
 *     release  (Chaser, Grapple launch, Grapple let go) does nothing while held and presses
 *              the tag control once, for one physics step, on the lift. A tap is a press and a
 *              lift, so it still fires at once.
 * - Cancel: while dragging with any gear but the quick-fire one, a Cancel ring shows diagonally
 *   above Tag, one slot up and one slot toward the middle of the screen. Lifting on it sends nothing: a held charge or carry is dropped through
 *   the same cancellation the in-play guide uses, and a release shot is never pressed. While the
 *   thumb is on the ring the view stops turning. A system pointercancel cancels the same way.
 */

/** How far a touch moves, in CSS px, before it is a drag rather than a tap (the drive stick's value too). */
export const TAG_DRAG_THRESHOLD = 8
/** Share of full tilt, measured radially, that turns nothing. */
export const TAG_DEAD_ZONE = 0.1

export type TagMode = 'stream' | 'hold' | 'release'
export interface Point { x: number; y: number }
export interface Zone extends Point { r: number }
export interface TagTuning { speed: number; radius: number; curve: number }

/** What the Tag stick asks the game to do. */
export interface TagEffects {
  /** Hold (true) or let go of (false) the tag control, as the old TAG button did. */
  fire(on: boolean): void
  /** Press the tag control for exactly one physics step. */
  tap(): void
  /** Drop a held charge or carry without sending it, and let go of the tag control. */
  cancel(): void
  /** Turn the view by this much finger travel, CSS px, as a mouse or finger drag would. */
  look(dx: number, dy: number): void
}

/**
 * The stick's output from the thumb's offset: a vector of length 0 to 1 on a radial dead zone and
 * a power curve, written into `out`. Zero radius or a non-finite offset gives no output.
 */
export function aimRate(dx: number, dy: number, radius: number, curve: number, out: Point): Point {
  out.x = 0; out.y = 0
  const length = Math.hypot(dx, dy)
  if (!(radius > 0) || !Number.isFinite(length) || length === 0) return out
  const tilt = Math.min(1, length / radius)
  if (tilt <= TAG_DEAD_ZONE) return out
  const magnitude = Math.pow((tilt - TAG_DEAD_ZONE) / (1 - TAG_DEAD_ZONE), Math.max(1, curve))
  out.x = dx / length * magnitude; out.y = dy / length * magnitude
  return out
}

/**
 * The mode for the gear in hand, from its first action (the one Tag performs, see
 * GearRack.controls). Plasma Tag streams; an action held to act holds; a one press action
 * waits for the lift. Before the gear is bound, Thunder and Yoink still charge or grab on the hold.
 */
export function tagModeFor(gear: string, first?: { readonly hold: boolean }): TagMode {
  if (gear === 'beam') return 'stream'
  if (first) return first.hold ? 'hold' : 'release'
  return gear === 'red' || gear === 'yoink' ? 'hold' : 'release'
}

export type TagEnd = 'fired' | 'stopped' | 'cancelled' | null

export class TagStick {
  /** The pointer holding Tag, or null. One Tag at a time; a second finger on Tag is ignored. */
  pointer: number | null = null
  mode: TagMode = 'stream'
  dragged = false
  /** True while the thumb is on the Cancel ring. */
  overCancel = false
  private readonly origin: Point = { x: 0, y: 0 }
  private readonly finger: Point = { x: 0, y: 0 }
  private readonly rate: Point = { x: 0, y: 0 }
  private zone: Zone | null = null

  constructor(private readonly effects: TagEffects, private readonly tuning: () => TagTuning) {}

  get held(): boolean { return this.pointer !== null }
  /** The Cancel ring shows while dragging with any gear but the quick-fire one. */
  get cancellable(): boolean { return this.held && this.dragged && this.mode !== 'stream' }

  /** A touch went down on Tag. `zone` is the Cancel ring, in the same coordinates. */
  down(id: number, x: number, y: number, mode: TagMode, zone: Zone | null): boolean {
    if (this.pointer !== null) return false
    this.pointer = id; this.mode = mode; this.dragged = false; this.overCancel = false; this.zone = zone
    this.origin.x = this.finger.x = x; this.origin.y = this.finger.y = y
    if (mode !== 'release') this.effects.fire(true)
    return true
  }

  move(id: number, x: number, y: number): void {
    if (id !== this.pointer) return
    this.finger.x = x; this.finger.y = y
    if (!this.dragged && Math.hypot(x - this.origin.x, y - this.origin.y) >= TAG_DRAG_THRESHOLD) this.dragged = true
    const z = this.zone
    this.overCancel = this.cancellable && z !== null && Math.hypot(x - z.x, y - z.y) <= z.r
  }

  /** Once per rendered frame: turn the view by the stick's rate for `dt` seconds. */
  frame(dt: number): void {
    if (this.pointer === null) return
    const t = this.tuning()
    if (!this.dragged || this.overCancel || !(dt > 0)) { this.effects.look(0, 0); return }
    aimRate(this.finger.x - this.origin.x, this.finger.y - this.origin.y, t.radius, t.curve, this.rate)
    const step = t.speed * Math.min(dt, 0.1)
    this.effects.look(this.rate.x * step, this.rate.y * step)
  }

  /** The touch lifted (`up`) or the system took it (`cancel`). */
  up(id: number, how: 'up' | 'cancel' = 'up'): TagEnd {
    if (id !== this.pointer) return null
    const cancelled = how === 'cancel' || this.overCancel
    const mode = this.mode
    this.pointer = null; this.dragged = false; this.overCancel = false; this.zone = null
    if (cancelled) {
      if (mode === 'hold') this.effects.cancel()
      else if (mode === 'stream') this.effects.fire(false)
      return 'cancelled'
    }
    if (mode === 'release') { this.effects.tap(); return 'fired' }
    this.effects.fire(false)
    return mode === 'hold' ? 'fired' : 'stopped'
  }

  /** Rotation, blur, leaving play: let go without sending anything. */
  reset(): void { if (this.pointer !== null) this.up(this.pointer, 'cancel') }
}

/** What the free right side asks the game to do. */
export interface AimEffects {
  look(dx: number, dy: number): void
  /** Zoom as a mouse wheel would: positive is out. */
  zoom(wheelDeltaY: number): void
}

/**
 * Touches that went down on the free game view on the aiming side (see touchRole). One finger
 * dragging looks, as before. In the orbit camera, a second such finger while the first is
 * still down turns the pair into a pinch: spreading zooms in, pinching zooms out, by the
 * change in distance between them times `touch.pinchSpeed`, as wheel pixels. The look stops
 * and does not resume until both lift, so letting go of one finger never jerks the view. A
 * touch that began on a button never gets here, so it is never part of a pinch.
 */
export class AimTouches {
  private readonly points = new Map<number, Point & { from: Point }>()
  private pending: number | null = null
  private pointer: number | null = null
  private pinch: [number, number] | null = null
  private spread = 0

  constructor(private readonly effects: AimEffects, private readonly pinchSpeed: () => number) {}

  get pinching(): boolean { return this.pinch !== null }
  get looking(): boolean { return this.pointer !== null }

  /** A free aiming-side touch went down. `zoomable` is whether the camera in use has a distance to pinch (chase or orbit). */
  down(id: number, x: number, y: number, zoomable: boolean): 'look' | 'pinch' | null {
    if (this.pinch || this.points.has(id)) return null
    if (this.points.size === 1 && zoomable) {
      const [[first, p]] = this.points
      this.points.set(id, { x, y, from: { x, y } })
      this.pinch = [first, id]; this.pending = null; this.pointer = null
      this.spread = Math.hypot(x - p.x, y - p.y)
      return 'pinch'
    }
    this.points.set(id, { x, y, from: { x, y } })
    if (this.points.size > 1) return null
    this.pending = id
    return 'look'
  }

  /** Returns true when the move belongs to a look or pinch, so the caller can prevent its default. */
  move(id: number, x: number, y: number): boolean {
    const p = this.points.get(id)
    if (!p) return false
    const lastX = p.x, lastY = p.y
    p.x = x; p.y = y
    if (this.pinch) {
      if (!this.pinch.includes(id)) return false
      const [a, b] = this.pinch, pa = this.points.get(a)!, pb = this.points.get(b)!
      const spread = Math.hypot(pa.x - pb.x, pa.y - pb.y)
      const change = spread - this.spread
      this.spread = spread
      if (change !== 0) this.effects.zoom(-change * this.pinchSpeed())
      return true
    }
    if (id === this.pending) {
      if (Math.hypot(x - p.from.x, y - p.from.y) < TAG_DRAG_THRESHOLD) return false
      this.pending = null; this.pointer = id
      this.effects.look(x - p.from.x, y - p.from.y)
      return true
    }
    if (id !== this.pointer) return false
    this.effects.look(x - lastX, y - lastY)
    return true
  }

  up(id: number): void {
    if (!this.points.delete(id)) return
    if (id === this.pending) this.pending = null
    if (id === this.pointer) this.pointer = null
    if (this.pinch?.includes(id)) this.pinch = null
  }

  reset(): void { this.points.clear(); this.pending = null; this.pointer = null; this.pinch = null }
}

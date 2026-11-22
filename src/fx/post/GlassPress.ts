import type { Vector4 } from 'three/webgpu'

// Time in milliseconds, outline displacement and face lift. Separate fits to
// the native circle use linear interpolation between phases. Press can overshoot.
// The native release has one shallow rebound, reaching its minimum near 200 ms.
const pressCurve = [
  [0, 0, 0], [20, 0, .49], [45, .16, .86], [80, .38, .98],
  [105, 1.06, .99], [160, 1.24, .95], [230, 1.29, 1], [320, 1, 1],
]
const releaseCurve = [
  [0, 1, 1], [35, .88, .89], [80, .36, .72], [113, .04, .61], [130, -.10, .56],
  [146, -.19, .51], [165, -.286, .47], [182, -.295, .43], [205, -.30, .38],
  [245, -.26, .33], [273, -.18, .30], [280, -.10, .29], [312, 0, .25], [345, 0, .236],
  [410, 0, .204], [550, 0, .192], [580, 0, 0],
]

/** The face lift a switched-on button keeps (aria-pressed): the pale, white-grey face a press shows, a shade under it. */
export const ON_LIFT = .8
/** The native press grows a 35-point circle to 43.5 points across. */
export const PRESS_GROWTH = 43.5 / 35 - 1
/** Round labels are rasterised this much larger and scaled down at rest, so they stay crisp as they grow (shader-surface.css). */
const ROUND_LABEL_RASTER = 47 / 35

/** A button's rest outline: centre x, y and half size z, w, CSS px. Equal halves are a circle. */
export interface RestBox { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
const isRound = (b: RestBox) => Math.abs(b.z - b.w) < .5

/**
 * The free space between two outlines at rest, CSS px: centre distance less both radii for two
 * circles, the larger axis gap between the two boxes when either is a pill.
 */
export function restSeparation(a: RestBox, b: RestBox): number {
  if (isRound(a) && isRound(b)) return Math.hypot(a.x - b.x, a.y - b.y) - a.z - b.z
  return Math.max(Math.abs(a.x - b.x) - a.z - b.z, Math.abs(a.y - b.y) - a.w - b.w)
}

/**
 * How far each swelling button may grow, written into `out`: what it wants, capped so two
 * outlines never overlap and keep `air` px between them. A swelling button therefore never
 * covers or bends a neighbour's label and never fuses with it. Alone, a button may grow across
 * the whole gap less `air`; with a neighbour swelling too, the gap is shared in proportion to
 * what each wants.
 */
export function pressAllowances(boxes: readonly RestBox[], wants: readonly number[], air: number, out: number[]): number[] {
  out.length = boxes.length
  for (let i = 0; i < boxes.length; i++) {
    let allowed = Math.max(0, wants[i])
    if (allowed > 0) for (let j = 0; j < boxes.length; j++) {
      if (j === i) continue
      const budget = restSeparation(boxes[i], boxes[j]) - air
      const a = allowed, b = Math.max(0, wants[j])
      if (wants[i] + b <= budget) continue
      allowed = Math.min(a, budget <= 0 ? 0 : b > 0 ? budget * wants[i] / (wants[i] + b) : budget)
    }
    out[i] = allowed
  }
  return out
}

/**
 * One Liquid Glass button's press: on a finger down the drawn outline swells past its native
 * box with a slight overshoot, the face lifts toward white, and on release it settles back
 * through one shallow rebound. The input box never moves (the button keeps its layout and hit
 * area); only the painted outline, the face lift and the label's scale change.
 *
 * Shared by every expanding glass button (GlassButton.pressable): the thumb grid, the gear's
 * thumb buttons and the touch Panels control. GlassButton reads `growth` each frame, may cap it
 * so neighbours never overlap, and calls `apply` with what is allowed.
 */
export class GlassPress {
  private label: HTMLElement | null = null
  private readonly rest = { x: 0, y: 0, z: 0, w: 0 }
  private readonly corners = { x: 0, y: 0, z: 0, w: 0 }
  private box: Vector4 | null = null
  private radius: Vector4 | null = null
  private face: Vector4 | null = null
  private start = 0
  private sizeProgress = 0
  private lift = 0
  private initialSize = 0
  private initialLift = 0
  private target = 0
  private moving = false
  private extra = 0
  private labelScale = 0
  /** Switched on (Wings open, Zorb on): the face holds most of the press's lift. */
  on = false
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)')

  constructor(readonly button: HTMLElement) {
    button.dataset.glassPress = 'expand'
    this.wrapLabel()
  }

  /** The press growth offset from the glass settings (regularSettings pressGrowth). */
  setExtra(value: number) { this.extra = value }

  /**
   * Point at this frame's slot: `box` is centre and half size, `radius` the four corners,
   * `face` the slot's presentation vector, whose w is the face lift.
   */
  bind(box: Vector4, radius: Vector4, face: Vector4) {
    this.box = box; this.radius = radius; this.face = face
    this.rest.x = box.x; this.rest.y = box.y; this.rest.z = box.z; this.rest.w = box.w
    this.corners.x = radius.x; this.corners.y = radius.y; this.corners.z = radius.z; this.corners.w = radius.w
  }

  /** The button's rest half size along its short side, CSS px. */
  get restRadius(): number { return Math.min(this.rest.z, this.rest.w) }
  /** The rest box: centre x, y and half size z, w, CSS px. */
  get centre(): Readonly<{ x: number; y: number; z: number; w: number }> { return this.rest }
  get round(): boolean { return isRound(this.rest) }
  /** True while animating or held: the frame loop must keep calling advance. */
  get active(): boolean { return this.moving || this.target === 1 }

  /** Start pressing (true) or releasing (false). Idempotent. */
  sync(pressed: boolean) {
    const target = Number(pressed)
    if (target === this.target) return
    this.initialSize = this.sizeProgress
    this.initialLift = this.lift
    this.target = target
    this.start = performance.now()
    this.moving = true
  }

  /** Step the curve. Returns the outline growth wanted now, in CSS px on the short half size. */
  advance(now = performance.now()): number {
    if (this.moving) {
      const elapsed = now - this.start
      const curve = this.target ? pressCurve : releaseCurve
      if (elapsed >= curve[curve.length - 1][0] || this.reduced.matches) {
        this.sizeProgress = this.lift = this.target
        this.moving = false
      } else {
        let index = 1
        while (elapsed > curve[index][0]) index++
        const [t0, s0, l0] = curve[index - 1]
        const [t1, s1, l1] = curve[index]
        const u = Math.max(0, (elapsed - t0) / (t1 - t0))
        const size = s0 + u * (s1 - s0)
        const lift = l0 + u * (l1 - l0)
        if (this.target) {
          this.sizeProgress = this.initialSize + (1 - this.initialSize) * size
          this.lift = this.initialLift + (1 - this.initialLift) * lift
        } else {
          this.sizeProgress = this.initialSize * size
          this.lift = this.initialLift * lift
        }
      }
    }
    return this.growth
  }

  /** The outline growth the curve wants, CSS px added to each half size. */
  get growth(): number { return this.restRadius * this.sizeProgress * (PRESS_GROWTH + this.extra) }
  /** 0 at rest to 1 fully pressed; for the pair pilot's strength. */
  get expansion(): number { return Math.max(0, Math.min(1, this.sizeProgress)) }

  /**
   * Write `growth` CSS px onto each half size (a pill grows by the same distance all round as a
   * circle of its height would), the corners with it, the face lift and the label's scale.
   */
  apply(growth: number) {
    const { box, radius, face } = this
    if (!box || !radius || !face) return
    const r = this.restRadius
    const scale = r > 0 ? (r + growth) / r : 1
    box.z = this.rest.z + growth
    box.w = this.rest.w + growth
    radius.set(this.corners.x * scale, this.corners.y * scale, this.corners.z * scale, this.corners.w * scale)
    face.w = Math.max(this.lift, this.on ? ON_LIFT : 0)
    if (this.label?.parentNode !== this.button) this.wrapLabel()
    const labelScale = this.round ? scale / ROUND_LABEL_RASTER : scale
    if (this.label && this.labelScale !== labelScale) {
      this.labelScale = labelScale
      this.label.style.transform = labelScale === 1 ? '' : 'scale(' + labelScale + ')'
    }
  }

  /** Gather the button's contents into one label element that scales as one, keeping its text and icons. */
  private wrapLabel() {
    this.labelScale = 0
    const found = this.button.querySelector<HTMLElement>(':scope > .glass-press-label')
    if (found) { this.label = found; return }
    const label = document.createElement('span')
    label.className = 'glass-press-label'
    label.append(...this.button.childNodes)
    this.button.append(label)
    this.label = label
  }

  /** Stop drawing this press; the button's label goes back to plain CSS. */
  clear() {
    delete this.button.dataset.glassPress
    this.label?.style.removeProperty('transform')
    this.box = this.radius = this.face = null
    this.target = this.initialSize = this.initialLift = this.sizeProgress = this.lift = 0
    this.moving = false
  }
}

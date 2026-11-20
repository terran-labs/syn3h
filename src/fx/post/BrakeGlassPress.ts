import { Vector2, Vector4 } from 'three/webgpu'
import { uniform } from 'three/tsl'

// Time in milliseconds, outline displacement and face lift. Separate fits to
// the native circle use linear interpolation between measured phases. Size can
// overshoot or undershoot; the optical lift stays between zero and one.
const pressCurve = [
  [0, 0, 0], [20, 0, .49], [45, .16, .86], [80, .38, .98],
  [105, 1.06, .99], [160, 1.24, .95], [230, 1.29, 1], [320, 1, 1],
]
const releaseCurve = [
  [0, 1, 1], [35, .93, .89], [90, .37, .68], [155, -.36, .49],
  [210, -.25, .38], [320, -.415, .243], [345, -.013, .236], [410, 0, .204],
  [550, 0, .192], [580, 0, 0],
]

/** Brake input owns .held. Only its painted dimensions change. */
export class BrakeGlassPress {
  readonly state = uniform(new Vector2(-1, 0))
  private button: HTMLElement | null = null
  private label: HTMLElement | null = null
  private readonly rest = new Vector4()
  private readonly corners = new Vector4()
  private box: Vector4 | null = null
  private radius: Vector4 | null = null
  private start = 0
  private sizeProgress = 0
  private initialSize = 0
  private initialLift = 0
  private target = 0
  private moving = false
  private labelScale = 0
  private reduced = matchMedia('(prefers-reduced-motion: reduce)')

  bind(button: HTMLElement, slot: number, box: Vector4, radius: Vector4) {
    if (this.button !== button) {
      this.clear()
      this.button = button
      this.label = button.querySelector('.brake-glass-label')
      button.dataset.glassPress = 'brake'
    }
    this.state.value.x = slot
    this.box = box
    this.radius = radius
    this.rest.copy(box)
    this.corners.copy(radius)
    this.write(this.sizeProgress, this.state.value.y)
    this.sync()
  }

  sync() {
    const target = Number(this.button?.classList.contains('held') ?? false)
    if (target === this.target) return
    this.initialSize = this.sizeProgress
    this.initialLift = this.state.value.y
    this.target = target
    this.start = performance.now()
    this.moving = true
  }

  advance(now?: number) {
    if (!this.moving) return
    const elapsed = (now ?? performance.now()) - this.start
    const curve = this.target ? pressCurve : releaseCurve
    if (elapsed >= curve[curve.length - 1][0] || this.reduced.matches) {
      this.write(this.target, this.target)
      this.moving = false
      return
    }
    let index = 1
    while (elapsed > curve[index][0]) index++
    const [t0, s0, l0] = curve[index - 1]
    const [t1, s1, l1] = curve[index]
    const u = Math.max(0, (elapsed - t0) / (t1 - t0))
    const size = s0 + u * (s1 - s0)
    const lift = l0 + u * (l1 - l0)
    if (this.target) {
      this.write(this.initialSize + (1 - this.initialSize) * size, this.initialLift + (1 - this.initialLift) * lift)
    } else this.write(this.initialSize * size, this.initialLift * lift)
  }

  private write(sizeProgress: number, lift: number) {
    this.sizeProgress = sizeProgress
    const scale = 1 + sizeProgress * (43.5 / 35 - 1)
    this.state.value.y = lift
    if (this.box && this.radius) {
      this.box.z = this.rest.z * scale
      this.box.w = this.rest.w * scale
      this.radius.copy(this.corners).multiplyScalar(scale)
    }
    if (this.label && this.labelScale !== scale) {
      this.labelScale = scale
      this.label.style.transform = 'scale(' + scale * 35 / 47 + ')'
    }
  }

  clear() {
    if (!this.button) return
    delete this.button.dataset.glassPress
    this.labelScale = 0
    this.label?.style.removeProperty('transform')
    this.button = this.label = null
    this.box = this.radius = null
    this.state.value.set(-1, 0)
    this.target = this.initialSize = this.initialLift = this.sizeProgress = 0
    this.moving = false
  }
}

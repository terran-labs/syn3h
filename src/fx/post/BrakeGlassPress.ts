import { Vector2, Vector4 } from 'three/webgpu'
import { uniform } from 'three/tsl'

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

  advance() {
    if (!this.moving) return
    const elapsed = (performance.now() - this.start) / 1000
    const duration = this.target ? .09 : .65
    if (elapsed >= duration || this.reduced.matches) {
      this.write(this.target, this.target)
      this.moving = false
      return
    }
    if (this.target) {
      const remaining = (1 - elapsed / duration) ** 4
      this.write(1 - (1 - this.initialSize) * remaining, 1 - (1 - this.initialLift) * remaining)
    } else {
      // Native release briefly passes below resting size around 200 ms.
      // Its face stays bright after the outline has returned to rest.
      const angle = 14 * elapsed
      const spring = Math.exp(-5.8 * elapsed) * (Math.cos(angle) + 5.8 / 14 * Math.sin(angle))
      const floor = Math.exp(-duration / .25)
      const lift = (Math.exp(-elapsed / .25) - floor) / (1 - floor)
      this.write(this.initialSize * spring, this.initialLift * lift)
    }
  }

  private write(sizeProgress: number, lift: number) {
    this.sizeProgress = sizeProgress
    const scale = 1 + sizeProgress * (44 / 35 - 1)
    this.state.value.y = lift
    if (this.box && this.radius) {
      this.box.z = this.rest.z * scale
      this.box.w = this.rest.w * scale
      this.radius.copy(this.corners).multiplyScalar(scale)
    }
    if (this.label && this.labelScale !== scale) {
      this.labelScale = scale
      this.label.style.transform = 'scale(' + scale * 35 / 44 + ')'
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

import { Vector4 } from 'three/webgpu'
import { uniform, uniformArray } from 'three/tsl'

const panel = '.hud-navigation .inspector-toggle.liquid-glass'
const round = '.touch-actions .liquid-glass.glass-round'
const vectors = (count: number) => Array.from({ length: count }, () => new Vector4())

/** The opt-in uses one fixed buffer layout from covered entry to exit. Spare
 * slots cost a box test, but showing a control never changes the shader graph. */
export class GlassButton {
  readonly boxes = uniformArray(vectors(6), 'vec4')
  readonly radii = uniformArray(vectors(6), 'vec4')
  readonly bodies = uniformArray(vectors(6), 'vec4')
  readonly filters = uniformArray(vectors(6), 'vec4')
  readonly viewport = uniform(new Vector4())
  private readonly events = new AbortController()
  private dirty = true
  private readonly invalidate = () => { this.dirty = true }
  private readonly resize = new ResizeObserver(this.invalidate)
  private readonly changes = new MutationObserver(this.invalidate)
  private readonly reduced = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)')
  private controls: HTMLElement[] = []
  private readonly drawn = new Set<HTMLElement>()
  private pressed: Element | null = null
  lastLayoutMs = 0

  constructor(private canvas: HTMLCanvasElement, readonly capacity: number) {
    const options = { signal: this.events.signal, capture: true }
    this.resize.observe(canvas)
    for (const event of ['scroll', 'resize', 'orientationchange']) window.addEventListener(event, this.invalidate, options)
    for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel', 'pointerover', 'pointerout']) {
      window.addEventListener(event, e => {
        const target = e.target
        if (target instanceof Element && this.controls.some(b => b.contains(target) || target.contains(b))) this.invalidate()
      }, options)
    }
    window.addEventListener('pointerdown', e => { this.pressed = e.target instanceof Element ? e.target.closest('button') : null; this.invalidate() }, options)
    const release = () => { this.pressed = null; this.invalidate() }
    for (const event of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(event, release, options)
    visualViewport?.addEventListener('resize', this.invalidate, options)
    visualViewport?.addEventListener('scroll', this.invalidate, options)
    this.reduced.addEventListener('change', this.invalidate, options)
  }

  update(): void {
    if (!this.controls.length || !this.controls[0].isConnected) {
      this.controls = Array.from(document.querySelectorAll<HTMLElement>(this.capacity === 1 ? panel : panel + ',' + round))
      for (const b of this.controls) {
        this.resize.observe(b)
        for (let el: HTMLElement | null = b; el; el = el.parentElement) {
          this.changes.observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'style', 'data-ui-frost', 'data-gfx', 'aria-pressed'] })
        }
      }
      this.dirty = true
    }
    if (!this.dirty) return
    const start = performance.now()
    this.dirty = false
    this.drawn.clear()
    const c = this.canvas.getBoundingClientRect()
    this.viewport.value.set(c.width, c.height, 0, 0)
    const boxes = this.boxes.array as Vector4[]
    for (const v of boxes) v.z = 0
    for (const b of this.controls) {
      if (this.drawn.size === this.capacity || this.reduced.matches || document.documentElement.dataset.gfx === '0') break
      const rect = b.getBoundingClientRect()
      if (!rect.width || !rect.height || rect.left < c.left || rect.right > c.right || rect.top < c.top || rect.bottom > c.bottom) continue
      const style = getComputedStyle(b)
      if (style.visibility !== 'visible' || b.closest('[data-ui-frost="off"]')) continue
      // Independent compositor motion can lead a layout measurement by a frame.
      let moving = false
      for (let el: HTMLElement | null = b; !moving && el; el = el.parentElement) {
        moving = el.getAnimations().some(a => a.playState === 'running' && (!(a instanceof CSSTransition) || ['transform', 'translate', 'scale', 'opacity', 'left', 'right', 'top', 'bottom'].includes(a.transitionProperty)))
      }
      if (moving) { this.dirty = true; continue }
      const token = b.matches('[aria-pressed="true"], .is-current') ? '--glass-body-on' : b.matches(':hover') ? '--glass-body-hover' : '--glass-body'
      const rgba = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)$/.exec(style.getPropertyValue(token).trim())
      const filter = /^blur\(([\d.]+)px\)\s+saturate\(([\d.]+)\)\s+brightness\(([\d.]+)\)$/.exec(style.getPropertyValue('--glass-frost').trim())
      if (!rgba || !filter) continue
      const i = this.drawn.size
      const half = Math.min(rect.width, rect.height) / 2
      const radius = (s: string) => Math.min(half, s.endsWith('%') ? parseFloat(s) * half / 50 : parseFloat(s))
      boxes[i].set(rect.left - c.left + rect.width / 2, rect.top - c.top + rect.height / 2, rect.width / 2, rect.height / 2)
      ;(this.radii.array[i] as Vector4).set(radius(style.borderTopLeftRadius), radius(style.borderTopRightRadius), radius(style.borderBottomLeftRadius), radius(style.borderBottomRightRadius))
      ;(this.bodies.array[i] as Vector4).set(+rgba[1] / 255, +rgba[2] / 255, +rgba[3] / 255, Math.min(+rgba[4], 0.065))
      ;(this.filters.array[i] as Vector4).set(+filter[1], +filter[2], +filter[3], Number(this.pressed === b || b.matches(':active, .held')))
      this.drawn.add(b)
    }
    this.lastLayoutMs = performance.now() - start
  }

  present(): void {
    for (const b of this.controls) {
      if (this.drawn.has(b)) { if (b.dataset.glassSurface !== 'shader') b.dataset.glassSurface = 'shader' }
      else if (b.dataset.glassSurface === 'shader') delete b.dataset.glassSurface
    }
  }

  hide(): void { this.drawn.clear(); this.present(); this.dirty = true }
  dispose(): void { this.hide(); this.events.abort(); this.resize.disconnect(); this.changes.disconnect() }
}

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
  private readonly changes = new MutationObserver(records => {
    // TouchControls writes aria-pressed each tick, including when its value stays
    // the same. Those notifications must never trigger a layout read.
    if (records.some(r => r.oldValue !== (r.target as Element).getAttribute(r.attributeName!))) this.invalidate()
  })
  private readonly dark = matchMedia('(prefers-color-scheme: dark)')
  private readonly clear = new URLSearchParams(location.search).get('glassMaterial') === 'clear'
  private readonly hover = matchMedia('(hover: hover)')
  private readonly reduced = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)')
  private controls: HTMLElement[] = []
  private readonly drawn = new Set<HTMLElement>()
  private readonly motion = new Map<Element, Set<string>>()
  private pressed: Element | null = null
  lastBoundsMs = 0
  lastLayoutMs = 0

  constructor(private canvas: HTMLCanvasElement, readonly capacity: number) {
    const options = { signal: this.events.signal, capture: true }
    this.resize.observe(canvas)
    for (const event of ['scroll', 'resize', 'orientationchange']) window.addEventListener(event, this.invalidate, options)
    // Compositor geometry can move independently of the render callback. Keep
    // CSS in charge until every moving property on the control or its ancestor
    // settles. Tracking lifecycle events avoids querying animations during draw.
    for (const type of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) {
      window.addEventListener(type, event => {
        const target = event.target
        if (!(target instanceof Element) || !this.controls.some(b => target.contains(b))) return
        const e = event as TransitionEvent | AnimationEvent
        if (e.pseudoElement) return
        const transition = 'propertyName' in e
        if (transition && !/^(transform|translate|scale|rotate|opacity|top|right|bottom|left|inset|width|height|margin|padding|border-radius|clip-path)/.test(e.propertyName)) return
        const name = transition ? e.propertyName : e.animationName
        let active = this.motion.get(target)
        if (type === 'transitionrun' || type === 'animationstart') {
          if (!active) this.motion.set(target, active = new Set())
          active.add(name)
        } else {
          active?.delete(name)
          if (!active?.size) this.motion.delete(target)
        }
        this.invalidate()
      }, options)
    }
    for (const event of ['pointerover', 'pointerout']) {
      window.addEventListener(event, e => {
        if (this.hover.matches && e.target instanceof Element && e.target.closest('.liquid-glass')) this.invalidate()
      }, options)
    }
    window.addEventListener('pointerdown', e => { this.pressed = e.target instanceof Element ? e.target.closest('button') : null; this.invalidate() }, options)
    const release = () => { this.pressed = null; this.invalidate() }
    for (const event of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(event, release, options)
    visualViewport?.addEventListener('resize', this.invalidate, options)
    visualViewport?.addEventListener('scroll', this.invalidate, options)
    this.dark.addEventListener('change', this.invalidate, options)
    this.reduced.addEventListener('change', this.invalidate, options)
  }

  update(): void {
    if (!this.controls.length || !this.controls[0].isConnected) {
      this.controls = Array.from(document.querySelectorAll<HTMLElement>(this.capacity === 1 ? panel : panel + ',' + round))
      for (const b of this.controls) {
        this.resize.observe(b)
        for (let el: HTMLElement | null = b; el; el = el.parentElement) {
          this.changes.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'style', 'data-ui-frost', 'data-gfx', 'aria-pressed'] })
        }
      }
      this.dirty = true
    }
    if (!this.dirty) return
    const start = performance.now()
    this.dirty = false
    this.drawn.clear()
    const c = this.canvas.getBoundingClientRect()
    const rects = this.controls.map(b => b.hidden ? null : b.getBoundingClientRect())
    this.lastBoundsMs = performance.now() - start
    this.viewport.value.set(c.width, c.height, Number(this.dark.matches), Number(this.clear))
    const boxes = this.boxes.array as Vector4[]
    for (const v of boxes) v.z = 0
    for (const [index, b] of this.controls.entries()) {
      if (this.drawn.size === this.capacity || this.reduced.matches || document.documentElement.dataset.gfx === '0') break
      const rect = rects[index]
      if (!rect || !rect.width || !rect.height || rect.left < c.left || rect.right > c.right || rect.top < c.top || rect.bottom > c.bottom) continue
      const style = getComputedStyle(b)
      if (style.visibility !== 'visible' || b.closest('[data-ui-frost="off"]')) continue
      if (this.motion.size && Array.from(this.motion.keys()).some(el => el.contains(b))) continue
      const token = b.matches('[aria-pressed="true"], .is-current, :active, .held') ? '--glass-body-on' : b.matches(':hover') ? '--glass-body-hover' : '--glass-body'
      const rgba = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)$/.exec(style.getPropertyValue(token).trim())
      const filter = /^blur\(([\d.]+)px\)\s+saturate\(([\d.]+)\)\s+brightness\(([\d.]+)\)$/.exec(style.getPropertyValue('--glass-frost').trim())
      if (!rgba || !filter) continue
      const i = this.drawn.size
      const half = Math.min(rect.width, rect.height) / 2
      const radius = (s: string) => Math.min(half, s.endsWith('%') ? parseFloat(s) * half / 50 : parseFloat(s))
      boxes[i].set(rect.left - c.left + rect.width / 2, rect.top - c.top + rect.height / 2, rect.width / 2, rect.height / 2)
      ;(this.radii.array[i] as Vector4).set(radius(style.borderTopLeftRadius), radius(style.borderTopRightRadius), radius(style.borderBottomLeftRadius), radius(style.borderBottomRightRadius))
      ;(this.bodies.array[i] as Vector4).set(+rgba[1] / 255, +rgba[2] / 255, +rgba[3] / 255, Math.min(+rgba[4], 0.065))
      ;(this.filters.array[i] as Vector4).set(+filter[1], +filter[2], Number(this.hover.matches && b.matches(':hover')), Number(this.pressed === b || b.matches(':active, .held')))
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

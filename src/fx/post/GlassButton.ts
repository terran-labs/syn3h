import { BrakeGlassPress } from './BrakeGlassPress'
import { longFrames } from '../../core/longFrames'
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
  private readonly query = new URLSearchParams(location.search)
  private readonly brake = this.query.get('glass') === 'inline' && this.query.get('glassPress') === 'brake'
    && this.query.get('glassMaterial') !== 'clear' ? new BrakeGlassPress() : null
  readonly pressOnly = this.query.get('glassMerge') === 'zorb-brake-pressed'
  readonly pairSlots = this.brake && (this.pressOnly || this.query.get('glassMerge') === 'zorb-brake')
    && !['direct', 'mip'].includes(this.query.get('glassBlur') ?? '')
    ? uniform(new Vector4(-1, -1, 0, 0)) : undefined
  private pairBrake?: HTMLElement
  private pairZorb?: HTMLElement
  private zorbScaling = false
  private zorbDiameter = 0
  private zorbStrength = 0
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

  readonly pressState = this.brake?.state
  private readonly events = new AbortController()
  private dirty = true
  private readonly invalidate = () => { this.dirty = true }
  private readonly resize = new ResizeObserver(this.invalidate)
  private readonly changes = new MutationObserver(records => {
    // TouchControls writes aria-pressed each tick, including when its value stays
    // the same. Those notifications must never trigger a layout read.
    for (const record of records) {
      const el = record.target as Element
      if (record.oldValue === el.getAttribute(record.attributeName!)) continue
      if (el.matches('[data-glass-press="brake"]') && record.attributeName === 'class') {
        this.brake?.sync()
        const prior = (record.oldValue ?? '').split(/\s+/).filter(c => c && c !== 'held')
        const next = Array.from(el.classList).filter(c => c !== 'held')
        if (prior.length === next.length && prior.every(c => next.includes(c))) continue
      }
      this.invalidate()
    }
  })
  private readonly dark = matchMedia('(prefers-color-scheme: dark)')
  readonly clearMaterial = this.query.get('glassMaterial') === 'clear'
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
        if (transition && target === this.pairZorb && name === 'transform') {
          this.zorbScaling = type === 'transitionrun'
          this.invalidate()
          return
        }
        // The cue only paints outline, colour and shadow. Its DOM animation
        // can keep running over the glass without invalidating its geometry.
        if (this.pairSlots && !transition && name === 'zorb-cue' && target.matches('[data-action="zorb"]')) return
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
    window.addEventListener('pointerdown', e => {
      const button = e.target instanceof Element ? e.target.closest('button') : null
      if (button?.dataset.glassPress === 'brake') return
      this.pressed = button
      this.invalidate()
    }, options)
    const release = () => { if (this.pressed) { this.pressed = null; this.invalidate() } }
    for (const event of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(event, release, options)
    visualViewport?.addEventListener('resize', this.invalidate, options)
    visualViewport?.addEventListener('scroll', this.invalidate, options)
    this.dark.addEventListener('change', this.invalidate, options)
    this.reduced.addEventListener('change', this.invalidate, options)
  }

  // Only the centred, uniform CSS press scale changes during this transition.
  // Read the compositor's transform during its 120 ms lifetime, never a
  // border rectangle. The steady drive and held states take no style reads.
  private followZorbScale(): void {
    if (!this.zorbScaling || !this.pairZorb || !this.pairSlots) return
    const slot = this.pairSlots.value.x
    if (slot < 0) return
    const transform = getComputedStyle(this.pairZorb).transform
    const scale = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a
    const box = this.boxes.array[slot] as Vector4
    box.z = box.w = this.zorbDiameter * scale / 2
    this.zorbStrength = Math.max(0, Math.min(1, (1 - scale) / .03))
  }

  private updatePairStrength(): void {
    const slots = this.pairSlots?.value
    if (slots && slots.x >= 0) {
      slots.z = this.pressOnly ? Math.max(this.brake!.expansion, this.zorbStrength) : 1
    }
  }

  update(): void {
    if (!this.controls.length || !this.controls[0].isConnected) {
      this.controls = Array.from(document.querySelectorAll<HTMLElement>(this.capacity === 1 ? panel : panel + ',' + round))
      for (const b of this.controls) {
        this.resize.observe(b)
        for (let el: HTMLElement | null = b; el; el = el.parentElement) {
          this.changes.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'style', 'data-hand', 'data-ui-frost', 'data-gfx', 'aria-pressed'] })
        }
      }
      this.dirty = true
    }
    if (this.pairBrake?.hidden || this.pairZorb?.hidden) this.dirty = true
    if (!this.dirty) { this.brake?.advance(); this.followZorbScale(); this.updatePairStrength(); return }
    const start = performance.now()
    this.dirty = false
    this.drawn.clear()
    const c = this.canvas.getBoundingClientRect()
    const rects = this.controls.map(b => b.hidden ? null : b.getBoundingClientRect())
    this.lastBoundsMs = performance.now() - start
    longFrames.end('Glass DOM bounds', start)
    this.viewport.value.set(c.width, c.height, Number(this.dark.matches), Number(this.clearMaterial))
    const boxes = this.boxes.array as Vector4[]
    for (const v of boxes) v.z = 0
    let brakeVisible = false
    let zorbSlot = -1, brakeSlot = -1
    let zorbGroup: Element | null = null, brakeGroup: Element | null = null
    this.pairBrake = this.pairZorb = undefined
    if (this.pairSlots) this.pairSlots.value.set(-1, -1, 0, 0)
    for (const [index, b] of this.controls.entries()) {
      if (this.drawn.size === this.capacity || this.reduced.matches || document.documentElement.dataset.gfx === '0') break
      const rect = rects[index]
      if (!rect || !rect.width || !rect.height || rect.left < c.left || rect.right > c.right || rect.top < c.top || rect.bottom > c.bottom) continue
      const style = getComputedStyle(b)
      if (!b.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || b.closest('[data-ui-frost="off"]')) continue
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
      if (this.pairSlots && b.dataset.action === 'zorb') {
        this.pairZorb = b
        const scale = style.transform === 'none' ? 1 : new DOMMatrixReadOnly(style.transform).a
        this.zorbDiameter = rect.width / scale
        this.zorbStrength = this.reducedMotion.matches ? Number(b.matches(':active, .held')) : Math.max(0, Math.min(1, (1 - scale) / .03))
        zorbSlot = i
        zorbGroup = b.closest('[data-glass-container]')
      }
      if (this.brake && b.dataset.action === 'brakes') {
        this.brake.bind(b, i, boxes[i], this.radii.array[i] as Vector4)
        brakeVisible = true
        if (this.pairSlots) {
          brakeSlot = i
          brakeGroup = b.closest('[data-glass-container]')
          this.pairBrake = b
        }
      }
    }
    if (this.pairSlots && zorbGroup && zorbGroup === brakeGroup && Math.abs(boxes[zorbSlot].y - boxes[brakeSlot].y) < .5) {
      this.pairSlots.value.set(zorbSlot, brakeSlot, 0, 0)
    }
    if (!this.pairZorb) this.zorbScaling = false
    if (brakeVisible) this.brake?.advance()
    else this.brake?.clear()
    this.updatePairStrength()
    this.lastLayoutMs = performance.now() - start
  }

  get hasSurface(): boolean { return this.drawn.size > 0 }

  present(): void {
    for (const b of this.controls) {
      if (this.pairSlots && b.dataset.action === 'zorb') {
        b.toggleAttribute('data-glass-paired', this.pairSlots.value.x >= 0)
      }
      if (this.drawn.has(b)) { if (b.dataset.glassSurface !== 'shader') b.dataset.glassSurface = 'shader' }
      else if (b.dataset.glassSurface === 'shader') delete b.dataset.glassSurface
    }
  }

  hide(): void {
    this.pairSlots?.value.set(-1, -1, 0, 0)
    this.pairBrake = this.pairZorb = undefined
    this.zorbScaling = false
    this.brake?.clear()
    this.drawn.clear()
    this.present()
    this.dirty = true
  }
  dispose(): void { this.hide(); this.events.abort(); this.resize.disconnect(); this.changes.disconnect() }
}

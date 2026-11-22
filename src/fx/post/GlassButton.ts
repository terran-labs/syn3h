import { respectReducedTransparency } from '../../ui/glassMaterial'
import { paintedInset, GlassMotionClock } from '../../liquid-glass/paintedSurface'
import { GlassPress, pressAllowances } from './GlassPress'
import { longFrames } from '../../core/longFrames'
import { Vector4 } from 'three/webgpu'
import { uniform, uniformArray } from 'three/tsl'

const panel = '.hud-navigation .inspector-toggle.liquid-glass'
const round = '.touch-actions .liquid-glass.glass-round'
const inspector = '.syn3h-shell > .world-inspector:not(.lobby-settings)'
const card = inspector + ' > .wi-cards > .wi-card, ' + inspector + ' > .wi-ghosts > .wi-ghost.wi-glass, .drive-notices > .performance-recommendation'
const buttons = [panel, round, '.pause-actions > button', '.rail-command > button', '.rail-command > input.wi-search',
  '.world-inspector > .panels-close', '.gear-actions > button', '.rail-foot > button'].join(',')
/** Buttons that swell when pressed (GlassPress): every thumb button, the gear's thumb buttons and
 * the touch Panels control (the owner, 22 November 2026: "we should make this a consistent
 * behavior everywhere"). Panel interiors, the rail and cards keep their CSS press. */
const pressable = '.touch-actions .liquid-glass.glass-round, .gear-actions > button, .syn3h-shell.has-touch ' + panel
/** CSS px of air kept between two swelling neighbours' outlines. */
const PRESS_AIR = 1
// The gear drum and the desktop left column (Wings, Zorb, Chat...) are floating text, not glass
// (the owner, 21 November 2026), so they are not registered here at any material stop.
export const gameplayGlassSlots = 32
const vectors = (count: number) => Array.from({ length: count }, () => new Vector4())

/** The authored RGB token and its production CSS equivalent use display RGB. */
export function readGlassTint(value: string): [number, number, number, number] | null {
  const hex = /^#([a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(value)
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16) / 255
    return [channel(0), channel(2), channel(4), digits.length === 8 ? channel(6) : 1]
  }
  const rgb = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)$/.exec(value)
  return rgb ? [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255, +rgb[4]] : null
}

/** The opt-in uses one fixed buffer layout from covered entry to exit. Spare
 * slots cost a box test, but showing a control never changes the shader graph. */
export class GlassButton {
  readonly boxes = uniformArray(vectors(gameplayGlassSlots), 'vec4')
  readonly radii = uniformArray(vectors(gameplayGlassSlots), 'vec4')
  readonly bodies = uniformArray(vectors(gameplayGlassSlots), 'vec4')
  readonly filters = uniformArray(vectors(gameplayGlassSlots), 'vec4')
  readonly clips = uniformArray(vectors(gameplayGlassSlots), 'vec4')
  readonly presentation = uniformArray(vectors(gameplayGlassSlots), 'vec4')
  readonly surfaceCount = uniform(0, 'int')
  readonly viewport = uniform(new Vector4())
  private readonly query = new URLSearchParams(location.search)
  /** Press expansion is on unless the address turns it off (?glassPress=off) or the material cannot draw it. */
  private readonly pressEnabled = this.query.get('glass') !== 'target' && this.query.get('glassPress') !== 'off'
    && this.query.get('glassMaterial') !== 'clear'
  private readonly presses = new Map<HTMLElement, GlassPress>()
  readonly pressOnly = this.query.get('glassMerge') === 'zorb-brake-pressed'
  // Thumb buttons never fuse (the owner, 22 November 2026: Zorb and Brake "distorting towards
  // each other"). Each keeps its own outline at rest and pressed. The smooth-union pilot stays
  // reachable for the glass lab only, through ?glassMerge=zorb-brake or zorb-brake-pressed.
  readonly pairSlots = this.pressEnabled && (this.pressOnly || this.query.get('glassMerge') === 'zorb-brake')
    && !['direct', 'mip'].includes(this.query.get('glassBlur') ?? '')
    ? uniform(new Vector4(-1, -1, 0, 0)) : undefined
  private pairBrake?: HTMLElement
  private pairZorb?: HTMLElement
  private zorbScaling = false
  private zorbDiameter = 0
  private zorbStrength = 0
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

  private readonly events = new AbortController()
  private dirty = true
  readonly invalidate = () => { this.dirty = true; this.requestDraw() }
  private readonly resize = new ResizeObserver(this.invalidate)
  private readonly changes = new MutationObserver(records => {
    // TouchControls writes aria-pressed each tick, including when its value stays
    // the same. Those notifications must never trigger a layout read.
    for (const record of records) {
      const el = record.target as Element
      if (record.oldValue === el.getAttribute(record.attributeName!)) continue
      const press = this.presses.get(el as HTMLElement)
      if (press && record.attributeName === 'class') {
        this.syncPress(press)
        const prior = (record.oldValue ?? '').split(/\s+/).filter(c => c && c !== 'held')
        const next = Array.from(el.classList).filter(c => c !== 'held')
        if (prior.length === next.length && prior.every(c => next.includes(c))) continue
      }
      this.invalidate()
    }
  })
  readonly clearMaterial = this.query.get('glassMaterial') === 'clear'
  private readonly hover = matchMedia('(hover: hover)')
  private readonly reduced = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)')
  private controls: HTMLElement[] = []
  private registryDirty = true
  private readonly membership = new MutationObserver(() => { this.registryDirty = true; this.invalidate() })
  private tuningVisible = false
  private readonly drawn = new Set<HTMLElement>()
  private readonly clock = new GlassMotionClock()
  private readonly pressed = new Map<number, Element>()
  lastBoundsMs = 0
  lastLayoutMs = 0

  constructor(private canvas: HTMLCanvasElement, readonly capacity: number, private requestDraw = () => {}) {
    const options = { signal: this.events.signal, capture: true }
    this.resize.observe(canvas)
    for (const event of ['scroll', 'resize', 'orientationchange', 'glassgeometrychange']) window.addEventListener(event, this.invalidate, options)
    // A newly started transition may have no accompanying resize or mutation.
    // Wake the registry so the next draw adopts its timeline.
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
      if (button) this.pressed.set(e.pointerId, button)
      // A swelling button needs no layout read: its press only moves its painted outline.
      const press = button && this.presses.get(button)
      if (press) { this.syncPress(press); this.requestDraw(); return }
      this.invalidate()
    }, options)
    const release = (event: PointerEvent) => {
      const button = this.pressed.get(event.pointerId)
      if (!this.pressed.delete(event.pointerId)) return
      const press = button && this.presses.get(button as HTMLElement)
      if (press) { this.syncPress(press); this.requestDraw() } else this.invalidate()
    }
    window.addEventListener('pointerup', release, options)
    window.addEventListener('pointercancel', release, options)
    window.addEventListener('blur', () => { this.pressed.clear(); this.invalidate() }, options)
    visualViewport?.addEventListener('resize', this.invalidate, options)
    visualViewport?.addEventListener('scroll', this.invalidate, options)
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
      slots.z = this.pressOnly ? Math.max(this.pairBrake ? this.presses.get(this.pairBrake)?.expansion ?? 0 : 0, this.zorbStrength) : 1
    }
  }

  update(): void {
    if (this.registryDirty || !this.controls.length || !this.controls[0].isConnected) {
      this.registryDirty = false
      const next = Array.from(document.querySelectorAll<HTMLElement>(this.capacity === 1 ? panel : [buttons, card].join(',')))
      for (const old of this.controls) if (!next.includes(old)) {
        delete old.dataset.glassSurface
      }
      this.resize.disconnect()
      this.resize.observe(this.canvas)
      this.changes.disconnect()
      this.membership.disconnect()
      const stack = document.querySelector(inspector + ' > .wi-cards')
      for (const host of [stack, stack?.parentElement, ...document.querySelectorAll('.gear-actions, .rail-foot')]) {
        if (host) this.membership.observe(host, { childList: true })
      }
      this.controls = next
      for (const b of this.controls) {
        const actions = b.closest<HTMLElement>('.touch-actions')
        if (this.pairSlots && actions) actions.dataset.glassContainer = 'thumb-actions'
        this.resize.observe(b)
        for (let el: HTMLElement | null = b; el; el = el.parentElement) {
          this.changes.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'style', 'data-hand', 'data-ui-frost', 'data-gfx', 'aria-pressed'] })
        }
      }
      this.dirty = true
    }
    if (this.pairBrake?.hidden || this.pairZorb?.hidden) this.dirty = true
    const poseTime = performance.now()
    if (this.clock.advance(poseTime)) this.dirty = true
    if (!this.dirty) { this.advancePresses(); this.followZorbScale(); this.updatePairStrength(); return }
    const start = performance.now()
    this.dirty = false
    this.drawn.clear()
    const available = this.available
    this.showTuning(available && !this.clearMaterial)
    const c = this.canvas.getBoundingClientRect()
    const rects = this.controls.map(b => b.hidden ? null : b.getBoundingClientRect())
    this.lastBoundsMs = performance.now() - start
    longFrames.end('Glass DOM bounds', start)
    this.viewport.value.set(c.width, c.height, 1, Number(this.clearMaterial))
    const boxes = this.boxes.array as Vector4[]
    for (const v of boxes) v.z = 0
    let zorbSlot = -1, brakeSlot = -1
    let zorbGroup: Element | null = null, brakeGroup: Element | null = null
    this.pairBrake = this.pairZorb = undefined
    if (this.pairSlots) this.pairSlots.value.set(-1, -1, 0, 0)
    const visited = new Set<Element>()
    const styles = new Map<Element, CSSStyleDeclaration>()
    const styleFor = (el: Element) => {
      let style = styles.get(el)
      if (!style) { style = getComputedStyle(el); styles.set(el, style) }
      return style
    }
    for (const [index, b] of this.controls.entries()) {
      if (this.drawn.size === this.capacity || !available) break
      let rect = rects[index]
      if (!rect || !rect.width || !rect.height) continue
      const style = styleFor(b)
      if (!b.checkVisibility({ visibilityProperty: true }) || (document.documentElement.dataset.driveGlass !== 'on' && b.closest('[data-ui-frost="off"]'))) continue
      let alpha = 1
      for (let el: Element | null = b; el; el = el.parentElement) {
        if (!visited.has(el)) { this.clock.follow(el, poseTime); visited.add(el) }
        alpha *= Number(styleFor(el).opacity)
      }
      const isCard = b.matches(card)
      const sx = isCard && parseFloat(style.width) ? rect.width / parseFloat(style.width) : 1
      const sy = isCard && parseFloat(style.height) ? rect.height / parseFloat(style.height) : sx
      rect = paintedInset(rect, style.clipPath, sx, sy)
      const drum = b.parentElement?.classList.contains('gs-drum')
      const scrollport = (isCard ? b.closest('.wi-cards') : drum ? b.parentElement : null)?.getBoundingClientRect()
      const clip = scrollport ?? c
      if (!rect.width || !rect.height || rect.bottom <= clip.top || rect.top >= clip.bottom ||
        rect.right <= clip.left || rect.left >= clip.right) continue
      const token = b.matches('[aria-pressed="true"], .is-current, :active, .held') ? '--glass-body-on' : b.matches(':hover') ? '--glass-body-hover' : '--glass-body'
      const rgba = isCard ? [1, 1, 1, .06] : readGlassTint(style.getPropertyValue(token).trim())
      const useDefaults = isCard || (!respectReducedTransparency && this.reduced.matches)
      const filter = useDefaults ? ['', '3', '1.2'] : /^blur\(([\d.]+)px\)\s+saturate\(([\d.]+)\)\s+brightness\(([\d.]+)\)$/.exec(style.getPropertyValue('--glass-frost').trim())
      if (!rgba || !filter) continue
      const pressed = [...this.pressed.values()].includes(b) || b.matches(':active, .held')
      const i = this.drawn.size
      // Keep the bevel local to the corners as the card opens. Its face transfer stays the same.
      const panelWeight = isCard ? Math.max(0, Math.min(1, (rect.height - 52) / 64)) : 0
      const press = this.pressEnabled && b.matches(pressable) ? this.pressFor(b) : undefined
      ;(this.presentation.array[i] as Vector4).set(alpha, panelWeight, Number(!isCard), press ? 0 : Number(!isCard && pressed))
      ;(this.clips.array[i] as Vector4).set(clip.left - c.left, clip.top - c.top, clip.right - c.left, clip.bottom - c.top)
      const half = Math.min(rect.width, rect.height) / 2
      const radius = (s: string) => Math.min(half, s.endsWith('%') ? parseFloat(s) * half / 50 : parseFloat(s) * sx)
      boxes[i].set(rect.left - c.left + rect.width / 2, rect.top - c.top + rect.height / 2, rect.width / 2, rect.height / 2)
      ;(this.radii.array[i] as Vector4).set(radius(style.borderTopLeftRadius), radius(style.borderTopRightRadius), radius(style.borderBottomLeftRadius), radius(style.borderBottomRightRadius))
      ;(this.bodies.array[i] as Vector4).set(rgba[0], rgba[1], rgba[2], Math.min(rgba[3], 0.065))
      ;(this.filters.array[i] as Vector4).set(+filter[1], +filter[2], Number(this.hover.matches && b.matches(':hover')), Number(pressed))
      if (press) {
        press.bind(boxes[i], this.radii.array[i] as Vector4, this.presentation.array[i] as Vector4)
        press.on = b.getAttribute('aria-pressed') === 'true'
        this.syncPress(press)
      }
      this.drawn.add(b)
      if (this.pairSlots && b.dataset.action === 'zorb') {
        this.pairZorb = b
        const scale = style.transform === 'none' ? 1 : new DOMMatrixReadOnly(style.transform).a
        this.zorbDiameter = rect.width / scale
        this.zorbStrength = this.reducedMotion.matches ? Number(b.matches(':active, .held')) : Math.max(0, Math.min(1, (1 - scale) / .03))
        zorbSlot = i
        zorbGroup = b.closest('[data-glass-container]')
      }
      if (b.dataset.action === 'brakes') {
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
    for (const [b, press] of this.presses) if (!this.drawn.has(b)) { press.clear(); this.presses.delete(b) }
    this.advancePresses(true)
    this.updatePairStrength()
    this.surfaceCount.value = this.drawn.size
    this.lastLayoutMs = performance.now() - start
  }

  private pressGrowth = 0
  tune(growth: number) {
    if (growth === this.pressGrowth) return
    this.pressGrowth = growth
    for (const press of this.presses.values()) press.setExtra(growth)
    this.invalidate()
  }

  private pressFor(b: HTMLElement): GlassPress {
    let press = this.presses.get(b)
    if (!press) { press = new GlassPress(b); press.setExtra(this.pressGrowth); this.presses.set(b, press) }
    return press
  }

  /** Pressed is the touch controls' finger-down class, or a pointer that went down on it (Panels). */
  private syncPress(press: GlassPress) {
    const b = press.button
    press.sync(b.classList.contains('held') || [...this.pressed.values()].includes(b))
  }

  private readonly wants: number[] = []
  private readonly allowed: number[] = []
  /** Step every press, then let neighbours share the space between them (pressAllowances). */
  private pressesSettled = false
  private advancePresses(rebound = false) {
    if (!this.presses.size) return
    // At rest nothing moves: skip the per-frame work until a press starts (or layout rebinds).
    if (rebound) this.pressesSettled = false
    let moving = false
    for (const press of this.presses.values()) if (press.active) { moving = true; break }
    if (!moving && this.pressesSettled) return
    this.pressesSettled = !moving
    const now = performance.now()
    const list = [...this.presses.values()]
    this.wants.length = list.length
    for (let i = 0; i < list.length; i++) this.wants[i] = list[i].advance(now)
    pressAllowances(list.map(p => p.centre), this.wants, PRESS_AIR, this.allowed)
    for (let i = 0; i < list.length; i++) list[i].apply(this.allowed[i])
  }

  get animating(): boolean { return this.clock.active || [...this.presses.values()].some(p => p.active) }
  get reducedTransparency(): boolean { return respectReducedTransparency && this.reduced.matches }
  get available(): boolean {
    const { driveGlass, gfx } = document.documentElement.dataset
    return !this.reducedTransparency && (driveGlass ? driveGlass === 'on' : gfx !== '0' && !this.canvas.closest('[data-ui-frost="off"]'))
  }
  get visibleCount(): number {
    let count = 0
    for (let i = 0; i < this.drawn.size; i++) if ((this.presentation.array[i] as Vector4).x > 0) count++
    return count
  }

  get hasSurface(): boolean { return this.drawn.size > 0 }

  present(): void {
    for (const b of this.controls) {
      if (this.pairSlots && b.dataset.action === 'zorb') {
        b.toggleAttribute('data-glass-paired', this.pairSlots.value.x >= 0)
      }
      if (this.drawn.has(b)) { if (b.dataset.glassSurface !== 'shader') b.dataset.glassSurface = 'shader' }
      else if (b.dataset.glassSurface === 'shader') {
        delete b.dataset.glassSurface
      }
    }
  }

  private showTuning(enabled: boolean) {
    if (enabled === this.tuningVisible) return
    this.tuningVisible = enabled
    document.documentElement.toggleAttribute('data-game-glass', enabled)
  }

  hide(): void {
    this.showTuning(false)
    this.clock.release()
    this.pairSlots?.value.set(-1, -1, 0, 0)
    this.pairBrake = this.pairZorb = undefined
    this.zorbScaling = false
    for (const press of this.presses.values()) press.clear()
    this.presses.clear()
    this.drawn.clear()
    this.surfaceCount.value = 0
    this.present()
    this.dirty = true
  }
  dispose(): void { this.hide(); this.events.abort(); this.resize.disconnect(); this.changes.disconnect(); this.membership.disconnect() }
}

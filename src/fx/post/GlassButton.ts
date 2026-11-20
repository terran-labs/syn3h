import { Vector4 } from 'three/webgpu'
import { uniform } from 'three/tsl'

/** One pill for the opt-in alignment trial. Keep geometry in CSS pixels so render
 * scale, pixel ratio and safe-area insets need no independent estimates. */
export class GlassButton {
  readonly box = uniform(new Vector4())
  readonly viewport = uniform(new Vector4())
  readonly body = uniform(new Vector4())
  readonly frost = uniform(new Vector4())
  private materialDirty = true
  private readonly invalidateMaterial = () => { this.materialDirty = true; this.dirty = true }
  readonly pressed = uniform(0)
  private dirty = true
  private button: HTMLElement | null = null
  private readonly events = new AbortController()
  private readonly invalidate = () => { this.dirty = true }
  private readonly resize = new ResizeObserver(this.invalidate)
  private readonly changes = new MutationObserver(this.invalidateMaterial)
  private readonly reduced = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)')
  private visible = false
  lastLayoutMs = 0

  constructor(private canvas: HTMLCanvasElement) {
    const options = { signal: this.events.signal, capture: true }
    this.resize.observe(canvas)
    for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) {
      window.addEventListener(event, e => {
        if (e.target instanceof Element && this.button && e.target.contains(this.button)) this.invalidate()
      }, options)
    }
    for (const event of ['scroll', 'resize', 'orientationchange']) {
      window.addEventListener(event, this.invalidate, options)
    }
    visualViewport?.addEventListener('resize', this.invalidate, options)
    visualViewport?.addEventListener('scroll', this.invalidate, options)
    this.reduced.addEventListener('change', this.invalidateMaterial, options)
  }

  update(): void {
    if (!this.button?.isConnected) {
      const button = document.querySelector<HTMLElement>('.hud-navigation .inspector-toggle.liquid-glass')
      if (!button) { this.hide(); return }
      this.button = button
      this.resize.observe(button)
      for (let el: HTMLElement | null = button; el; el = el.parentElement) {
        this.changes.observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'style', 'data-ui-frost', 'data-gfx', 'aria-pressed'] })
      }
      const options = { signal: this.events.signal }
      this.materialDirty = true
      button.addEventListener('pointerenter', this.invalidateMaterial, options)
      button.addEventListener('pointerleave', this.invalidateMaterial, options)
      button.addEventListener('pointerdown', () => { this.pressed.value = 1 }, options)
      const release = () => { this.pressed.value = 0 }
      window.addEventListener('pointerup', release, options)
      window.addEventListener('pointercancel', release, options)
      window.addEventListener('blur', release, options)
      this.dirty = true
    }
    if (!this.dirty) return
    this.dirty = false
    const start = performance.now()
    const b = this.button.getBoundingClientRect()
    const c = this.canvas.getBoundingClientRect()
    const root = document.documentElement
    const style = getComputedStyle(this.button)
    if (this.materialDirty) {
      this.materialDirty = false
      const token = this.button.matches('[aria-pressed="true"], .is-current') ? '--glass-body-on'
        : this.button.matches(':hover') ? '--glass-body-hover' : '--glass-body'
      // The CSS builder's tokens use display-space RGB and a pixel blur radius.
      // An unfamiliar theme or a panel with frost disabled retains its CSS surface.
      const rgba = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)$/.exec(style.getPropertyValue(token).trim())
      const filter = /^blur\(([\d.]+)px\)\s+saturate\(([\d.]+)\)\s+brightness\(([\d.]+)\)$/.exec(style.getPropertyValue('--glass-frost').trim())
      if (rgba && filter) {
        this.body.value.set(+rgba[1] / 255, +rgba[2] / 255, +rgba[3] / 255, +rgba[4])
        this.frost.value.set(+filter[1], +filter[2], +filter[3], 1)
      } else this.frost.value.w = 0
    }
    this.visible = this.frost.value.w > 0 && !this.reduced.matches && !this.button.closest('[data-ui-frost="off"]') && root.dataset.gfx !== '0'
      && b.width > 0 && b.height > 0 && b.left >= c.left && b.right <= c.right && b.top >= c.top && b.bottom <= c.bottom
      && style.visibility === 'visible'
    // Compositor animations can advance independently of this frame's layout read.
    for (let el: HTMLElement | null = this.button; this.visible && el; el = el.parentElement) {
      if (el.getAnimations().some(a => a.playState === 'running' && (!(a instanceof CSSTransition) || ['transform', 'translate', 'scale', 'opacity', 'left', 'right', 'top', 'bottom'].includes(a.transitionProperty)))) { this.visible = false; this.dirty = true }
    }
    this.box.value.set(b.left - c.left + b.width / 2, b.top - c.top + b.height / 2, this.visible ? b.width / 2 : 0, b.height / 2)
    this.viewport.value.set(c.width, c.height, Math.min(parseFloat(style.borderTopLeftRadius) || 0, b.height / 2, b.width / 2), 0)
    this.lastLayoutMs = performance.now() - start
  }

  present(): void {
    if (!this.button || (this.button.dataset.glassSurface === 'shader') === this.visible) return
    if (this.visible) this.button.dataset.glassSurface = 'shader'
    else delete this.button.dataset.glassSurface
  }

  hide(): void {
    this.visible = false
    this.box.value.z = 0
    this.present()
    this.dirty = true
  }

  dispose(): void {
    this.hide()
    this.events.abort()
    this.resize.disconnect()
    this.changes.disconnect()
  }
}

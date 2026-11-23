/**
 * The animated Mira logo on its own canvas, for the lab page, for screens that have no GPU
 * picture of their own to share, and for rendering stills (share card, app icons). Inside
 * a screen that already runs a WebGL 2 picture, use LogoRenderer in that context instead:
 * phones allow only a few live contexts.
 *
 * It never throws. Without WebGL 2, or if a shader fails, `generated` is false, the canvas
 * is hidden and whatever the caller put underneath (the SVG wordmark) stays in view. For
 * people who prefer reduced motion, or with `still` set, it draws one settled frame.
 *
 * Box: by default the wordmark is fitted in the middle of the canvas with room for its
 * plasma. Call `setBox` with a rectangle in CSS pixels, relative to the canvas, to put the
 * flat wordmark exactly over an element; the SVG wordmark's own bounding box is the one to
 * use, since both are 962 by 226.
 */
import { ASPECT } from './wordmarkMesh'
import { DEFAULT_LOGO_LOOK, INTRO_SECONDS, type LogoLook, LogoRenderer, type PixelRect } from './logoRenderer'
import { WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from './activeWordmark'
import { ICON_HEIGHT, ICON_PATH, ICON_WIDTH } from './wordmarkPath'

export { DEFAULT_LOGO_LOOK, INTRO_SECONDS, LogoRenderer, type LogoLook, type PixelRect } from './logoRenderer'

export interface LogoOptions extends LogoLook {
  /** Animation speed; 1 is normal. */
  timeScale: number
  /** Draw one settled frame and never animate. */
  still: boolean
  /** Fade in when first shown: the silhouette, then the glow (see LogoLook markFade, glowGap, glowFade). */
  intro: boolean
  /** Frames per second at most. 30 is plenty for a menu; 60 is smoother. */
  fps: number
  /** Most device pixels per CSS pixel. */
  maxPixelRatio: number
  /** Keep the drawing buffer for reading back (stills); slower. */
  preserve: boolean
}
export const DEFAULT_LOGO_OPTIONS: LogoOptions = {
  ...DEFAULT_LOGO_LOOK, timeScale: 1, still: false, intro: true, fps: 60, maxPixelRatio: 2, preserve: false,
}
/** The moment drawn as the still frame: well after both stages of the fade in. */
export const STILL_SECONDS = 7.3

/**
 * Budgets by graphics level (src/core/quality.ts graphicsLevel): 0 safe, 1 mobile, 2 desktop.
 * The plasma's body is a field whose cost does not depend on the level; the particles over
 * it are large, so fill, not count, is their cost: fewer of them, each brighter, give the
 * same light for less.
 */
export function logoBudget(level: number): Pick<LogoOptions, 'particles' | 'still' | 'fps' | 'maxPixelRatio'> {
  if (level <= 0) return { particles: 80, still: true, fps: 0, maxPixelRatio: 1 }
  if (level < 2) return { particles: 110, still: false, fps: 30, maxPixelRatio: 1.5 }
  return { particles: 160, still: false, fps: 60, maxPixelRatio: 2 }
}

export type LogoLayout = 'fit' | 'icon' | 'card'
/**
 * Where the 962 by 226 wordmark box goes in a picture of the given size. `fit` leaves room
 * for the plasma all round; `icon` is the square app icon (as public/brand/icon-512.png);
 * `card` is the 1200 by 630 share card, with the logo high and room below for a tagline.
 */
export function logoBox(width: number, height: number, layout: LogoLayout = 'fit'): PixelRect {
  let w: number, cy: number
  if (layout === 'icon') { w = width * 0.84; cy = height * 0.5 }
  else if (layout === 'card') { w = Math.min(width * 0.7, height * 0.42 * ASPECT); cy = height * 0.36 }
  else { w = Math.min(width * 0.8, height * 0.42 * ASPECT); cy = height * 0.5 }
  const h = w / ASPECT
  return { x: (width - w) / 2, y: cy - h / 2, width: w, height: h }
}

const reducedMotion = (): boolean => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

export class LogoMark {
  readonly canvas: HTMLCanvasElement
  options: LogoOptions
  /** Frames drawn, for checks. */
  frames = 0
  private gl: WebGL2RenderingContext | null = null
  private renderer: LogoRenderer | null = null
  private readonly ownsCanvas: boolean
  private frame = 0
  private running = false
  private lastDraw = 0
  private clock = 0
  private lastNow: number | null = null
  private box: PixelRect | null = null
  private observer: ResizeObserver | null = null
  private disposed = false

  /** Mounts on a canvas, or makes one and appends it to an element. */
  constructor(target: HTMLCanvasElement | HTMLElement, options: Partial<LogoOptions> = {}) {
    this.options = { ...DEFAULT_LOGO_OPTIONS, ...options }
    const isCanvas = typeof HTMLCanvasElement !== 'undefined' ? target instanceof HTMLCanvasElement : 'getContext' in target
    this.ownsCanvas = !isCanvas
    if (isCanvas) this.canvas = target as HTMLCanvasElement
    else {
      this.canvas = document.createElement('canvas')
      this.canvas.className = 'logo-mark'; this.canvas.setAttribute('aria-hidden', 'true')
      this.canvas.style.cssText = 'display:block;width:100%;height:100%'
      target.append(this.canvas)
    }
    try {
      this.acquire()
      if (typeof ResizeObserver === 'function') { this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.canvas) }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
      this.resize()
    } catch (error) {
      console.warn('Mira logo could not start; the SVG wordmark stays.', error)
      this.fail()
    }
  }

  /** True when the logo is being drawn; false means show the SVG wordmark instead. */
  get generated(): boolean { return this.renderer !== null }
  get stats() { return this.renderer?.stats ?? { drawCalls: 0, particles: 0, triangles: 0 } }
  private get motionless(): boolean { return this.options.still || this.options.fps <= 0 || reducedMotion() }

  private acquire(): void {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: this.options.preserve, powerPreference: 'low-power' }) as WebGL2RenderingContext | null
    if (!gl) { this.fail(); return }
    this.canvas.addEventListener('webglcontextlost', this.onLost)
    this.canvas.addEventListener('webglcontextrestored', this.onRestored)
    const renderer = new LogoRenderer(gl, this.options)
    if (!renderer.ok) { renderer.dispose(); gl.getExtension('WEBGL_lose_context')?.loseContext(); this.fail(); return }
    if (!this.options.intro) renderer.skipIntro()
    this.gl = gl; this.renderer = renderer
  }
  private fail(): void { this.renderer = null; this.gl = null; this.canvas.hidden = true }
  private readonly onLost = (event: Event): void => { event.preventDefault(); this.renderer = null; cancelAnimationFrame(this.frame) }
  private readonly onRestored = (): void => {
    if (this.disposed || !this.gl) return
    const renderer = new LogoRenderer(this.gl, this.options); renderer.skipIntro()
    if (renderer.ok) { this.renderer = renderer; this.draw(); if (this.running) this.start() }
  }
  private readonly onVisibility = (): void => { cancelAnimationFrame(this.frame); this.lastNow = null; if (this.running && !document.hidden) this.frame = requestAnimationFrame(this.loop) }

  /** Changes the look or behaviour; takes effect at the next frame. */
  setOptions(options: Partial<LogoOptions>): void {
    this.options = { ...this.options, ...options }
    this.renderer?.setLook(this.options)
    if (this.motionless) this.renderStill(); else if (this.running) this.start()
  }
  /** Puts the flat wordmark over a rectangle in CSS pixels relative to the canvas; null refits. */
  setBox(box: PixelRect | null): void { this.box = box; this.draw() }
  replayIntro(): void { this.clock = 0; this.renderer?.replayIntro(0); if (!this.motionless) this.start() }

  resize(): void {
    if (!this.gl) return
    const scale = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, this.options.maxPixelRatio)
    const width = Math.max(1, Math.round((this.canvas.clientWidth || this.canvas.width) * scale)), height = Math.max(1, Math.round((this.canvas.clientHeight || this.canvas.height) * scale))
    if (this.canvas.clientWidth && (this.canvas.width !== width || this.canvas.height !== height)) { this.canvas.width = width; this.canvas.height = height }
    this.draw()
  }

  start(): void {
    if (!this.renderer || this.disposed) return
    if (this.motionless) { this.running = false; this.renderStill(); return }
    this.running = true; cancelAnimationFrame(this.frame); this.lastNow = null
    this.frame = requestAnimationFrame(this.loop)
  }
  stop(): void { this.running = false; cancelAnimationFrame(this.frame) }

  private readonly loop = (now: number): void => {
    if (!this.running || (typeof document !== 'undefined' && document.hidden)) return
    this.frame = requestAnimationFrame(this.loop)
    if (this.motionless) { this.stop(); this.renderStill(); return }
    if (now - this.lastDraw < 1000 / this.options.fps - 2) return
    // The clock only runs while drawn, so a hidden tab does not skip the fade in.
    if (this.lastNow !== null) this.clock += Math.min(0.1, (now - this.lastNow) / 1000) * this.options.timeScale
    this.lastNow = now; this.lastDraw = now
    this.draw()
  }

  /** The box in drawing-buffer pixels. */
  private pixelBox(): PixelRect {
    const ratio = this.canvas.width / Math.max(1, this.canvas.clientWidth || this.canvas.width)
    if (this.box) return { x: this.box.x * ratio, y: this.box.y * ratio, width: this.box.width * ratio, height: this.box.height * ratio }
    return logoBox(this.canvas.width, this.canvas.height, 'fit')
  }
  private draw(seconds = this.motionless ? STILL_SECONDS : this.clock): void {
    const gl = this.gl, renderer = this.renderer
    if (!gl || !renderer) return
    if (this.motionless) renderer.skipIntro()
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    renderer.draw(seconds, this.pixelBox())
    this.frames++
  }
  /** Draws one representative settled frame (or the frame at `seconds`) and stops. */
  renderStill(seconds = STILL_SECONDS): void {
    cancelAnimationFrame(this.frame)
    this.renderer?.skipIntro()
    this.draw(seconds)
  }

  /**
   * Stops the animation and draws the frame at `seconds` on the logo's clock, with the fade
   * in started at zero (or skipped when `intro` is false). For captures and tests.
   */
  drawFrame(seconds: number, intro = true): void {
    this.stop()
    if (intro) this.renderer?.replayIntro(0); else this.renderer?.skipIntro()
    this.clock = seconds; this.draw(seconds)
  }

  /**
   * Seconds of GPU time per frame, measured by drawing `frames` frames back to back and
   * waiting for each to finish. Rough: it includes the wait for the pipeline to drain.
   */
  measure(frames = 60): number {
    const gl = this.gl
    if (!gl || !this.renderer) return Number.NaN
    const pixel = new Uint8Array(4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const begin = performance.now()
    for (let i = 0; i < frames; i++) { this.draw(STILL_SECONDS + i / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel) }
    return (performance.now() - begin) / frames
  }

  /** Stops, frees the GL objects, gives the context back and removes a canvas it made. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.stop()
    this.observer?.disconnect()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    this.canvas.removeEventListener('webglcontextlost', this.onLost); this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.renderer?.dispose(); this.renderer = null
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); this.gl = null
    if (this.ownsCanvas) this.canvas.remove()
  }
}

/** Sizes the platforms ask for: the share card and the square icons. */
export const LOGO_STILLS = [
  { name: 'share.png', width: 1200, height: 630, layout: 'card' },
  { name: 'icon-512.png', width: 512, height: 512, layout: 'icon' },
  { name: 'icon-192.png', width: 192, height: 192, layout: 'icon' },
  { name: 'apple-touch-icon.png', width: 180, height: 180, layout: 'icon' },
  { name: 'favicon-32.png', width: 32, height: 32, layout: 'icon' },
] as const

/**
 * Renders the settled logo on deep space (by default) into a plain 2D canvas of exactly
 * `width` by `height` pixels, from no source image, and gives its GL context straight
 * back. Returns null without WebGL 2. The caller can draw text over the result.
 */
export function renderLogoCanvas(width: number, height: number, options: Partial<LogoOptions> & { layout?: LogoLayout } = {}): HTMLCanvasElement | null {
  const source = document.createElement('canvas'); source.width = width; source.height = height
  const mark = new LogoMark(source, { space: true, ...options, still: true, intro: false, preserve: true, maxPixelRatio: 1 })
  try {
    if (!mark.generated) return null
    mark.setBox(logoBox(width, height, options.layout ?? 'fit'))
    mark.renderStill()
    const out = document.createElement('canvas'); out.width = width; out.height = height
    out.getContext('2d')?.drawImage(source, 0, 0)
    return out
  } finally { mark.dispose() }
}
/** As renderLogoCanvas, encoded as a PNG. */
export function renderLogoPng(width: number, height: number, options: Partial<LogoOptions> & { layout?: LogoLayout } = {}): Promise<Blob | null> {
  const canvas = renderLogoCanvas(width, height, options)
  return canvas ? new Promise(resolve => canvas.toBlob(resolve, 'image/png')) : Promise.resolve(null)
}

const hex = (c: readonly number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
/**
 * The logo as one self-contained SVG document: the flat wordmark path, a soft glow made by
 * an SVG filter from the path itself and, with `space`, the sky and a few seeded stars. No
 * images, no fonts. Static: the plasma is the GPU version's; this is for places that take
 * only a file. The `icon` layout draws the icon mark (the M on its plate, wordmarkPath.ts)
 * in place of the whole word, which would be unreadable in a small square.
 */
export function logoSvg(options: Partial<LogoLook> & { width?: number; height?: number; layout?: LogoLayout } = {}): string {
  const look = { ...DEFAULT_LOGO_LOOK, ...options }, width = options.width ?? 1200, height = options.height ?? 630
  const icon = options.layout === 'icon'
  const mark = icon ? { d: ICON_PATH, width: ICON_WIDTH, height: ICON_HEIGHT } : { d: WORDMARK_PATH, width: WORDMARK_WIDTH, height: WORDMARK_HEIGHT }
  // The icon mark fills most of its square; the wordmark goes where its layout puts it.
  const iconWidth = width * 0.74, iconHeight = iconWidth * mark.height / mark.width
  const box = icon ? { x: (width - iconWidth) / 2, y: (height - iconHeight) / 2, width: iconWidth, height: iconHeight } : logoBox(width, height, options.layout ?? 'fit')
  const unit = box.height / mark.height
  let stars = ''
  if (look.space) {
    let s = (Math.floor(look.seed * 7919) >>> 0) || 1
    const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
    for (let i = 0; i < Math.round(width * height / 9000); i++) stars += `<circle cx="${(rand() * width).toFixed(1)}" cy="${(rand() * height).toFixed(1)}" r="${(0.4 + rand() * Math.max(0.6, width / 900)).toFixed(2)}" fill="#c6d6ff" opacity="${(0.2 + rand() * 0.6).toFixed(2)}"/>`
  }
  const blur = box.height * 0.06
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mira">
<defs>
<radialGradient id="space" cx="50%" cy="${(100 * (box.y + box.height / 2) / height).toFixed(1)}%" r="75%"><stop offset="0" stop-color="#131f38"/><stop offset="1" stop-color="#03060b"/></radialGradient>
<filter id="glow" x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB">
<feMorphology in="SourceAlpha" operator="dilate" radius="${(box.height * 0.012 / unit).toFixed(2)}" result="grown"/>
<feGaussianBlur in="grown" stdDeviation="${(blur / unit / 3).toFixed(2)}" result="near"/>
<feGaussianBlur in="grown" stdDeviation="${(blur / unit).toFixed(2)}" result="far"/>
<feFlood flood-color="${hex(look.glow.map(v => v * 0.6 + 0.4))}"/><feComposite in2="near" operator="in" result="nearLit"/>
<feFlood flood-color="${hex(look.glowEdge)}"/><feComposite in2="far" operator="in" result="farLit"/>
<feMerge><feMergeNode in="farLit"/><feMergeNode in="farLit"/><feMergeNode in="nearLit"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
</defs>
${look.space ? `<rect width="${width}" height="${height}" fill="url(#space)"/>${stars}` : ''}
<g transform="translate(${box.x.toFixed(2)} ${box.y.toFixed(2)}) scale(${unit.toFixed(5)})" filter="url(#glow)"><path fill-rule="evenodd" fill="${hex(look.face)}" stroke="${hex(look.glow.map(v => v * 0.5 + 0.5))}" stroke-opacity="0.55" stroke-width="${(1 / unit).toFixed(2)}" d="${mark.d}"/></g>
</svg>`
}
export { WORDMARK_WIDTH, WORDMARK_HEIGHT }

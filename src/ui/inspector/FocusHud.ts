/**
 * The display shown while the cursor is captured and the player is driving: almost nothing.
 * A reticle at the centre of the view and a few readings drawn as thin lines and small
 * capitals, in the manner of a flight instrument. Three looks, chosen with the Focus
 * display setting, and three reticles:
 *
 *   Arc        speed and altitude as two arcs either side of the view, heading above.
 *   Horizon    a compass tape across the top that slides as you turn, readings beneath it.
 *   Telemetry  four corner brackets holding the readings, as on a mission display.
 *
 * It is all SVG and text. Nothing here draws unless the display is visible.
 */
import { focusStyle, reticleStyle } from './params'

export interface Telemetry {
  /** Metres per second. */
  speed: number
  /** Metres above the ground under the vehicle. */
  altitude: number
  /** Radians; 0 faces -Z (north on the minimap). */
  heading: number
  /** The world's name, for example "Alpine · Harimos". */
  world: string
  /** The hour on this world, 0 to 24. */
  hour: number
}
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
/** Compass bearing in degrees, 0 north, clockwise, from the game's heading. */
export const bearing = (heading: number) => ((-(heading * 180) / Math.PI) % 360 + 360) % 360
export const compassPoint = (degrees: number) => POINTS[Math.round(degrees / 45) % 8]
const pad = (value: number, width: number) => String(Math.max(0, Math.round(value))).padStart(width, '0')
const clock = (hour: number) => `${pad(Math.floor(hour) % 24, 2)}:${pad(Math.floor((hour % 1) * 60), 2)}`
// An arc of radius 210 from 150 to 210 degrees (left) or -30 to 30 (right), as an SVG path.
const arc = (from: number, to: number) => { const p = (a: number) => `${(Math.cos(a * Math.PI / 180) * 210).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * 210).toFixed(1)}`; return `M${p(from)}A210 210 0 0 ${to > from ? 1 : 0} ${p(to)}` }

export class FocusHud {
  readonly element = document.createElement('div')
  private readonly started = performance.now()
  private readonly text = new Map<string, HTMLElement[]>()
  // update() runs every frame. Everything below remembers what was last written, as plain
  // numbers and strings, so a frame in which nothing changed builds no strings and neither
  // reads nor writes the page.
  private readonly written = new Map<string, string>()
  private speedArc!: SVGPathElement
  private altitudeArc!: SVGPathElement
  private tape!: SVGGElement
  private styleShown = -1
  private reticleShown = -1
  private mphShown = -1
  private altitudeShown = -1
  private degreesShown = -1
  private minuteShown = -1
  private elapsedShown = -1
  private worldShown: string | undefined
  private speedArcShown = -1
  private altitudeArcShown = -1
  private tapeShown = NaN
  constructor(parent: HTMLElement) {
    this.element.className = 'focus-hud'; this.element.setAttribute('aria-hidden', 'true')
    const ticks = Array.from({ length: 49 }, (_, i) => `<path class="${i % 3 ? 'fh-faint' : 'fh-line'}" d="M${(i - 24) * 30} ${i % 3 ? -6 : -11}V0"/>`).join('')
    this.element.innerHTML = `<svg viewBox="-800 -450 1600 900" preserveAspectRatio="xMidYMid slice">
      <g data-reticle="0 1 2"><circle class="fh-dot" r="2.6"/></g>
      <g data-reticle="1"><circle class="fh-line" r="13"/></g>
      <g data-reticle="2"><path class="fh-line" d="M-20 -9V-17H-12M12 -17H20V-9M20 9V17H12M-12 17H-20V9"/></g>
      <g data-style="0"><path class="fh-faint" d="${arc(150, 210)}"/><path class="fh-faint" d="${arc(30, -30)}"/><path class="fh-accent" data-arc="speed" pathLength="100" stroke-dasharray="100" d="${arc(150, 210)}"/><path class="fh-accent" data-arc="altitude" pathLength="100" stroke-dasharray="100" d="${arc(30, -30)}"/></g>
      <g data-style="1" transform="translate(0 -372)"><path class="fh-faint" d="M-420 0H420"/><g data-tape>${ticks}</g><path class="fh-accent" d="M0 6V18"/></g>
    </svg>
    <div class="fh-read fh-left" data-style="0"><b data-t="speed"></b><small>MPH</small></div>
    <div class="fh-read fh-right" data-style="0"><b data-t="altitude"></b><small>M ABOVE GROUND</small></div>
    <div class="fh-read fh-top" data-style="0"><small data-t="world"></small><span data-t="heading"></span></div>
    <div class="fh-read fh-top" data-style="1" style="top:104px"><b data-t="heading"></b><small><span data-t="speed"></span> MPH · <span data-t="altitude"></span> M · <span data-t="clock"></span></small></div>
    <div class="fh-read fh-corner fh-tl" data-style="2"><small>SYN3H // SURVEY</small><span data-t="world"></span></div>
    <div class="fh-read fh-corner fh-tr" data-style="2"><small>LOCAL TIME</small><span data-t="clock"></span><small>ELAPSED <span data-t="elapsed"></span></small></div>
    <div class="fh-read fh-corner fh-bl" data-style="2"><small>VELOCITY</small><b data-t="speed3"></b><small>MPH</small></div>
    <div class="fh-read fh-corner fh-br" data-style="2"><small>HEADING</small><b data-t="heading"></b><small>ALT <span data-t="altitude4"></span> M</small></div>`
    for (const node of this.element.querySelectorAll<HTMLElement>('[data-t]')) { const key = node.dataset.t!; this.text.set(key, [...(this.text.get(key) ?? []), node]) }
    this.speedArc = this.element.querySelector<SVGPathElement>('[data-arc=speed]')!
    this.altitudeArc = this.element.querySelector<SVGPathElement>('[data-arc=altitude]')!
    this.tape = this.element.querySelector<SVGGElement>('[data-tape]')!
    parent.append(this.element)
  }
  private set(key: string, value: string): void {
    if (this.written.get(key) === value) return
    this.written.set(key, value)
    for (const node of this.text.get(key) ?? []) node.textContent = value
  }
  /** Call every frame; it does nothing unless the display is on screen. */
  update(visible: boolean, t: Telemetry): void {
    const style = Math.round(focusStyle.value), reticle = Math.round(reticleStyle.value)
    if (style !== this.styleShown) { this.styleShown = style; this.element.dataset.showStyle = String(style) }
    if (reticle !== this.reticleShown) { this.reticleShown = reticle; this.element.dataset.showReticle = String(reticle) }
    if (!visible) return
    const mph = Math.abs(t.speed) * 2.23694, degrees = bearing(t.heading)
    // Each readout is keyed on the whole number it shows, so its text is built only when that changes.
    const mphWhole = Math.round(mph)
    if (mphWhole !== this.mphShown) { this.mphShown = mphWhole; this.set('speed', String(mphWhole)); this.set('speed3', pad(mph, 3)) }
    const altitudeWhole = Math.max(0, Math.round(t.altitude))
    if (altitudeWhole !== this.altitudeShown) { this.altitudeShown = altitudeWhole; this.set('altitude', String(altitudeWhole)); this.set('altitude4', pad(t.altitude, 4)) }
    // The compass point changes only at half-degree boundaries, so the whole degree decides both.
    const degreesWhole = Math.round(degrees)
    if (degreesWhole !== this.degreesShown) { this.degreesShown = degreesWhole; this.set('heading', `${pad(degrees, 3)}° ${compassPoint(degrees)}`) }
    if (t.world !== this.worldShown) { this.worldShown = t.world; this.set('world', t.world) }
    const minute = Math.floor(t.hour) * 60 + Math.floor((t.hour % 1) * 60)
    if (minute !== this.minuteShown) { this.minuteShown = minute; this.set('clock', clock(t.hour)) }
    const seconds = (performance.now() - this.started) / 1000, elapsed = Math.floor(seconds / 60) * 100 + Math.round(seconds % 60)
    if (elapsed !== this.elapsedShown) { this.elapsedShown = elapsed; this.set('elapsed', `${pad(Math.floor(seconds / 60), 2)}:${pad(seconds % 60, 2)}`) }
    if (style === 0) {
      // A tenth of a percent of the arc is under a quarter of a pixel: finer steps are not drawn.
      const speedArc = Math.round((100 - Math.min(100, (mph / 140) * 100)) * 10) / 10
      if (speedArc !== this.speedArcShown) { this.speedArcShown = speedArc; this.speedArc.style.strokeDashoffset = String(speedArc) }
      const altitudeArc = Math.round((100 - Math.min(100, (Math.max(0, t.altitude) / 600) * 100)) * 10) / 10
      if (altitudeArc !== this.altitudeArcShown) { this.altitudeArcShown = altitudeArc; this.altitudeArc.style.strokeDashoffset = String(altitudeArc) }
    } else if (style === 1) {
      // The tape is marked every 5 degrees (30 units); slide it so the bearing sits at the pointer.
      const shift = -(degrees % 15) * 6, tenths = Math.round(shift * 10)
      if (tenths !== this.tapeShown) { this.tapeShown = tenths; this.tape.setAttribute('transform', `translate(${shift.toFixed(1)} 0)`) }
    }
  }
  dispose(): void { this.element.remove() }
}

/**
 * The display shown while the cursor is captured and the player is driving: almost nothing.
 * A reticle at the centre of the view and a few readings drawn as thin lines and small
 * capitals, in the manner of a flight instrument. Three looks, chosen with the Focus
 * display setting, and three reticles:
 *
 *   Arc        speed and altitude as two arcs either side of the view, the planet and biome
 *              above. No heading: the minimap shows direction (the owner, 22 November 2026).
 *   Horizon    a compass tape across the top that slides as you turn, readings beneath it.
 *   Telemetry  four corner brackets holding the readings, as on a mission display.
 *
 * It is all SVG and text. Nothing here draws unless the display is visible.
 */
import { focusStyle, reticleStyle } from './params'
import { FALLBACK_TOP_SPEED, HEIGHT_FULL_SCALE } from './instrumentScales'
import './focus-readouts.css'
import { displayUnits, heightUnit, heightValue, speedUnit, speedValue, wholeNumber } from '../units'

export interface Telemetry {
  /** The speed, in m/s, at which the speed crescent reads full: the vehicle's own (instrumentScales.ts). */
  speedScale?: number
  /** The height, in m, at which the altitude crescent reads full (instrumentScales.ts). */
  heightScale?: number
  /** Metres per second. */
  speed: number
  /** Resolved Jet thrust, -1 to 1; absent for other vehicles. */
  thrust?: number
  /** Metres above sea level, from the vehicle's lowest contact surface; negative below it. */
  altitude: number
  /** Radians; 0 faces -Z (north on the minimap). */
  heading: number
  /** The world's name, for example "Alpine · Harimos". */
  world: string
  /** The hour on this world, 0 to 24. */
  hour: number
}
export const thrustPercent = (value: number) => `${Math.round(Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)) * 100)}%`
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
/** Compass bearing in degrees, 0 north, clockwise, from the game's heading. */
export const bearing = (heading: number) => ((-(heading * 180) / Math.PI) % 360 + 360) % 360
export const compassPoint = (degrees: number) => POINTS[Math.round(degrees / 45) % 8]
const pad = (value: number, width: number) => String(Math.max(0, Math.round(value))).padStart(width, '0')
/** Zero padded like pad, keeping a minus sign in front: "−012". */
const signedPad = (value: number, width: number) => { const n = Math.round(value); return n < 0 ? `\u2212${pad(-n, width - 1)}` : pad(n, width) }
const clock = (hour: number) => `${pad(Math.floor(hour) % 24, 2)}:${pad(Math.floor((hour % 1) * 60), 2)}`
// An arc of radius 210 from 150 to 210 degrees (left) or -30 to 30 (right), as an SVG path.
const arc = (from: number, to: number) => { const p = (a: number) => `${(Math.cos(a * Math.PI / 180) * 210).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * 210).toFixed(1)}`; return `M${p(from)}A210 210 0 0 ${to > from ? 1 : 0} ${p(to)}` }

/**
 * The bold part of a crescent: one arc from its bottom end, `fraction` of the way to its top
 * (clamped 0 to 1), drawn as its own path. It used to be the whole arc with a dash (pathLength 100
 * and a dash offset), but the accent's non-scaling stroke makes browsers measure dashes in screen
 * pixels, not path units, so the dash repeated and a bold run showed at the top even at zero (the
 * owner, 25 November 2026). `start` is the bottom end's angle and `turn` +1 (left crescent, which
 * climbs clockwise) or -1 (right). Nothing is drawn at zero. Returns the fill in 1/400ths, written
 * only when it changes.
 */
function fillArc(path: SVGPathElement, last: number, start: number, turn: 1 | -1, fraction: number): number {
  const steps = Math.round(Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 400)
  if (steps !== last) path.setAttribute('d', steps === 0 ? '' : arc(start, start + turn * 60 * steps / 400))
  return steps
}

export class FocusHud {
  readonly element = document.createElement('div')
  private readonly started = performance.now()
  private readonly text = new Map<string, HTMLElement[]>()
  /** The THRUST lines, cached so the per-frame update neither queries nor allocates. */
  private thrustRows: HTMLElement[] = []
  private speedArc!: SVGPathElement
  private altitudeArc!: SVGPathElement
  /** The fill last drawn on each crescent, in 1/400ths, so a path is rewritten only when it changes. */
  private speedFill = -1
  private altitudeFill = -1
  private tape!: SVGGElement
  private thrustShown = false
  constructor(parent: HTMLElement) {
    this.element.className = 'focus-hud'; this.element.setAttribute('aria-hidden', 'true')
    const ticks = Array.from({ length: 49 }, (_, i) => `<path class="${i % 3 ? 'fh-faint' : 'fh-line'}" d="M${(i - 24) * 30} ${i % 3 ? -6 : -11}V0"/>`).join('')
    this.element.innerHTML = `<svg viewBox="-800 -450 1600 900" preserveAspectRatio="xMidYMid slice">
      <g data-reticle="0 1 2"><circle class="fh-dot" r="2.6"/></g>
      <g data-reticle="1"><circle class="fh-line" r="13"/></g>
      <g data-reticle="2"><path class="fh-line" d="M-20 -9V-17H-12M12 -17H20V-9M20 9V17H12M-12 17H-20V9"/></g>
      <g data-style="0"><path class="fh-faint" d="${arc(150, 210)}"/><path class="fh-faint" d="${arc(30, -30)}"/><path class="fh-accent" data-arc="speed" d=""/><path class="fh-accent" data-arc="altitude" d=""/></g>
      <g data-style="1" transform="translate(0 -372)"><path class="fh-faint" d="M-420 0H420"/><g data-tape>${ticks}</g><path class="fh-accent" d="M0 6V18"/></g>
    </svg>
    <div class="fh-read fh-left" data-style="0"><b><span data-t="speed"></span><i data-t="speedUnit"></i></b><small>SPEED</small></div>
    <div class="fh-read fh-right" data-style="0"><b><span data-t="altitude"></span><i data-t="heightUnit"></i></b><small>ALT</small><small data-thrust hidden>THRUST <span data-t="thrust"></span></small></div>
    <div class="fh-read fh-top" data-style="0"><small data-t="world"></small></div>
    <div class="fh-read fh-top" data-style="1" style="top:104px"><b data-t="heading"></b><small><span data-t="speed"></span> <span data-t="speedUnit"></span> · ALT <span data-t="altitude"></span> <span data-t="heightUnit"></span> · <span data-t="clock"></span></small><small data-thrust hidden>THRUST <span data-t="thrust"></span></small></div>
    <div class="fh-read fh-corner fh-tl" data-style="2"><small>MIRA // SURVEY</small><span data-t="world"></span></div>
    <div class="fh-read fh-corner fh-tr" data-style="2"><small>LOCAL TIME</small><span data-t="clock"></span><small>ELAPSED <span data-t="elapsed"></span></small></div>
    <div class="fh-read fh-corner fh-bl" data-style="2"><small>VELOCITY</small><b data-t="speed3"></b><small data-t="speedUnit"></small></div>
    <div class="fh-read fh-corner fh-br" data-style="2"><small>HEADING</small><b data-t="heading"></b><small>ALT <span data-t="altitude4"></span> <span data-t="heightUnit"></span></small><small data-thrust hidden>THRUST <span data-t="thrust"></span></small></div>`
    for (const node of this.element.querySelectorAll<HTMLElement>('[data-t]')) { const key = node.dataset.t!; this.text.set(key, [...(this.text.get(key) ?? []), node]) }
    this.thrustRows = [...this.element.querySelectorAll<HTMLElement>('[data-thrust]')]
    // Drawn every frame: held once, as the markup above is built once.
    this.speedArc = this.element.querySelector<SVGPathElement>('[data-arc=speed]')!
    this.altitudeArc = this.element.querySelector<SVGPathElement>('[data-arc=altitude]')!
    this.tape = this.element.querySelector<SVGGElement>('[data-tape]')!
    parent.append(this.element)
  }
  private set(key: string, value: string): void { for (const node of this.text.get(key) ?? []) if (node.textContent !== value) node.textContent = value }
  /** Call every frame; it does nothing unless the display is on screen. */
  update(visible: boolean, t: Telemetry): void {
    const style = String(Math.round(focusStyle.value)), reticle = String(Math.round(reticleStyle.value))
    if (this.element.dataset.showStyle !== style) this.element.dataset.showStyle = style
    if (this.element.dataset.showReticle !== reticle) this.element.dataset.showReticle = reticle
    if (!visible) return
    // Only the Jet reports thrust; every other vehicle leaves it undefined and the line hides.
    const thrust = t.thrust !== undefined
    if (thrust !== this.thrustShown) { this.thrustShown = thrust; for (const node of this.thrustRows) node.hidden = !thrust }
    if (thrust) this.set('thrust', thrustPercent(t.thrust!))
    const units = displayUnits.value, speed = speedValue(t.speed, units), height = heightValue(t.altitude, units)
    // The arcs keep one physical scale whatever the units: speed full at the vehicle's own scale
    // (instrumentScales.ts; the old 140 mph when none is given), height at its scale (600 m today).
    const degrees = bearing(t.heading), seconds = (performance.now() - this.started) / 1000
    this.set('speed', wholeNumber(speed)); this.set('speed3', pad(speed, 3)); this.set('altitude', wholeNumber(height)); this.set('altitude4', signedPad(height, 4))
    this.set('speedUnit', speedUnit(units)); this.set('heightUnit', heightUnit(units))
    this.set('heading', `${pad(Math.round(degrees) % 360, 3)}° ${compassPoint(degrees)}`); this.set('world', t.world); this.set('clock', clock(t.hour))
    this.set('elapsed', `${pad(Math.floor(seconds / 60), 2)}:${pad(seconds % 60, 2)}`)
    if (style === '0') {
      this.speedFill = fillArc(this.speedArc, this.speedFill, 150, 1, Math.abs(t.speed) / (t.speedScale ?? FALLBACK_TOP_SPEED))
      this.altitudeFill = fillArc(this.altitudeArc, this.altitudeFill, 30, -1, Math.max(0, t.altitude) / (t.heightScale ?? HEIGHT_FULL_SCALE))
    } else if (style === '1') {
      // The tape is marked every 5 degrees (30 units); slide it so the bearing sits at the pointer.
      this.tape.setAttribute('transform', `translate(${(-(degrees % 15) * 6).toFixed(1)} 0)`)
    }
  }
  dispose(): void { this.element.remove() }
}

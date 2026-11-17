import * as THREE from 'three/webgpu'
import { params } from '../../../shared/params'
import type { Vehicle } from '../../vehicles/Vehicle'
import { compactAt, distanceOpacity, DISTANCE, FADE_MS, GAP, hold, HOLD_MS, namePx, NUDGE, overlaps, placeLabels, plateLeft, plateRect, snapPx, spring, type Candidate, type Hold, type Spring } from './layout'
import type { Point } from './occlusion'
import { copyCurveState, overHorizon } from '../../world/curve'
import { bendPoint, CurvedProjection, curvedTerrainOccluded } from './curvature'
import { nameplateMode, restoreNameplatePreference } from './preferences'
import { HudExclusions } from './HudExclusions'
import { renderedEnvelope, type Envelope } from './anchors'
import { afterCameraFrame } from './renderHook'
import '../label-plate.css'
import './nameplates.css'

/** Metres above the top of a vehicle's body where its label's anchor sits. */
const ANCHOR_RISE = .15
/** Milliseconds between allocations (terrain sight lines, collisions, HUD). Every frame, each
 *  shown label is drawn at its vehicle's position from that frame's camera. */
const ALLOCATE_MS = 100
/** A bot drawn smaller than this many pixels across is not labelled. People always are. */
const BOT_MIN_PIXELS = 3
/** A person whose vehicle is behind terrain keeps a dimmed label. */
const BEHIND_OPACITY = .5
/** Plate size limits in pixels at full size. Past the widest, the name is cut with an ellipsis. */
const PLATE_MIN = 56, PLATE_MAX = 220
/** Plate heights at full size, two lines and one, for a person and a bot. Must match label-plate.css. */
const HEIGHT = { person: [42, 29], bot: [38, 25] } as const
/** Must match label-plate.css: name and tag fonts, letter spacing in em, and padding plus border. */
const PERSON_NAME = '600 14px Barlow', BOT_NAME = '500 12px Barlow', NAME_SPACING = .08, PERSON_TAG = '500 10px Barlow', BOT_TAG = '500 9px Barlow', TAG_SPACING = .16
const PLATE_INSET = 30 // padding, border and 4 px for kerning
/** The stacked count ("+2"): its font (must match nameplates.css) and its gap from the name. */
const MORE_FONT = '500 10px Barlow', MORE_GAP = 6
/**
 * Size follows how large a vehicle looks, not raw metres: plates are in CSS pixels, so on a
 * smaller screen the same car at the same distance is drawn smaller while its plate is not.
 * The distance used for size and form is divided by the screen's size relative to a
 * 1440 x 900 desktop (no less than SMALLEST_SCREEN), so a phone gets its compact labels
 * sooner. Range and fading still use real distance.
 */
const REFERENCE_SCREEN = [1440, 900] as const, SMALLEST_SCREEN = .4
/** A label fades out once the point over its vehicle's roof is this many pixels off screen. */
const OFF_SCREEN = 24

/**
 * A vehicle's tint as a label accent: its own hue, lifted to at least 58% lightness so a dark
 * paint still reads on the dark plate. Invalid input falls back to the theme accent.
 */
export function liftTint(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'var(--s3-accent, #8fe3ff)'
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const hue = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return `hsl(${Math.round((hue + 360) % 360)} ${Math.round(sat * 100)}% ${Math.round(Math.max(l, .58) * 100)}%)`
}

let measure: CanvasRenderingContext2D | null | undefined
const widths = new Map<string, number>()
/** Text width without a layout read: plates are written after every read in a frame. */
function textWidth(text: string, font: string, spacing: number, px: number): number {
  const key = font + text, known = widths.get(key)
  if (known !== undefined) return known
  measure ??= document.createElement('canvas').getContext?.('2d') ?? null
  if (!measure) return text.length * px * (.62 + spacing)
  measure.font = `${font}, sans-serif`
  const width = measure.measureText(text.toUpperCase()).width + text.length * px * spacing
  // Until Barlow has loaded the fallback face is measured; do not keep that.
  if (document.fonts?.status === 'loaded' && document.fonts.check(font)) { if (widths.size > 512) widths.clear(); widths.set(key, width) }
  return width
}

export interface NameplateInfo {
  id: string
  vehicle: Vehicle
  name: string
  note: string
  bot: boolean
  color: string
}
export interface NameplateOptions {
  /** The shell supplies playing/menu state; labels never leak through a full-screen overlay. */
  visible(): boolean
  presentation(): boolean
  wrapSize(): number
  /** Flat physics terrain query; the module inverse-maps curved visual rays before using it. */
  terrainHit(from: Point, to: Point): boolean
  shell: HTMLElement
  scene: THREE.Scene
  /**
   * The player's own vehicle. Not used for hiding: a label is a HUD overlay, so neither your
   * own body nor its wings, ball, or skirt ever hides one (owner direction, 16 November 2026).
   */
  localVehicle(): Vehicle
}
interface Plate {
  el: HTMLDivElement; name: HTMLElement; note: HTMLElement
  /** "+2": how many labels are stacked behind this one, unshown (see placeLabels). */
  more: HTMLElement; moreCount: number; moreWant: number; moreSince: number
  candidate: Candidate
  vehicle?: Vehicle; stamp: number
  /** Placed by the last allocation, held against flicker. */
  shown: Hold
  /** Behind terrain, held against flicker. */
  behind: Hold
  /** Stepped up by NUDGE, held against flicker; the spring eases the step. */
  lifted: Hold
  /** Offered to the last allocation. */
  offered: boolean
  nudge: Spring
  compact: boolean; px: number; scale: number
  /** Current faded opacity, and its target. */
  alpha: number; target: number
  /** Last written values, so unchanged frames write nothing. */
  color: string; text: string; tag: string; transform: string; width: number; height: number; opacity: number; displayed: boolean
}
/** One pooled overlay, drawn once per frame after the camera has moved (see renderHook.ts). */
export class VehicleNameplates {
  private readonly root = document.createElement('div')
  private readonly plates = new Map<string, Plate>()
  private readonly free: Plate[] = []
  private readonly hud: HudExclusions
  private readonly unsubscribe: () => void
  private readonly modeUnsubscribe: () => void
  private readonly visibilityObserver: MutationObserver
  private readonly reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  private readonly eye = new THREE.Vector3()
  private readonly center = new THREE.Vector3() // Flat, already-reimaged vehicle coordinates.
  private readonly bend = new THREE.Vector3()
  private readonly bent = new THREE.Vector3()
  private readonly screenCenter = new THREE.Vector3()
  private readonly projection = new CurvedProjection()
  private readonly body: Envelope = { radius: 0, rise: 0, reach: 0, top: 0 }
  private readonly anchor = new THREE.Vector3()
  private readonly projected = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private readonly renderHook: { queue(): void; dispose(): void }
  private entries: readonly NameplateInfo[] = []
  /** Diagnostics for the browser check, not a gameplay or network setting. */
  readonly stats = { terrainQueries: 0, visible: 0, drawMs: 0 }
  private terrainBudget = 0
  private readonly hitTerrain = (from: Point, to: Point): boolean => {
    // A crowded distant view must not monopolise a frame: an unresolved sight line counts as blocked.
    if (this.terrainBudget-- <= 0) return true
    this.stats.terrainQueries++
    return this.options.terrainHit(from, to)
  }
  private stamp = 0
  private last = 0
  private nextAllocation = 0
  private readonly candidates: Candidate[] = []
  private readonly stackedBehind = new Map<string, string>()
  private readonly stacked = new Map<string, number>()

  constructor(private readonly currentCamera: () => THREE.PerspectiveCamera, private readonly options: NameplateOptions) {
    this.root.className = 'vehicle-nameplates syn3h-nametags'
    this.root.setAttribute('aria-hidden', 'true')
    options.shell.appendChild(this.root)
    this.hud = new HudExclusions(options.shell)
    this.unsubscribe = restoreNameplatePreference()
    this.renderHook = afterCameraFrame(options.scene, currentCamera, args => args[2], () => this.draw(this.entries))
    const syncVisibility = () => { const hidden = !options.visible() || nameplateMode.value === 2; if (this.root.hidden !== hidden) this.root.hidden = hidden }
    this.modeUnsubscribe = params.onChange(id => { if (id === nameplateMode.def.id) syncVisibility() })
    this.visibilityObserver = new MutationObserver(records => {
      if (records.some(r => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.vehicle-nameplates'))) syncVisibility()
    })
    this.visibilityObserver.observe(options.shell, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'inert'] })
    syncVisibility()
  }
  private get camera(): THREE.PerspectiveCamera { return this.currentCamera() }
  private acquire(id: string): Plate {
    let p = this.free.pop()
    if (!p) {
      const el = document.createElement('div'), name = document.createElement('strong'), note = document.createElement('small'), more = document.createElement('span')
      el.className = 'vehicle-nameplate s3-plate'; el.hidden = true; more.className = 'vehicle-nameplate-more'
      el.append(name, note, more); this.root.append(el)
      p = { el, name, note, more, moreCount: 0, moreWant: 0, moreSince: -Infinity, candidate: { id, bot: false, x: 0, y: 0, distance: 0, width: 0, height: 0, compact: false, held: false, nudged: false },
        stamp: 0, shown: { value: false, since: -Infinity }, behind: { value: false, since: -Infinity }, lifted: { value: false, since: -Infinity }, offered: false, nudge: { x: 0, v: 0 }, compact: false, px: NaN, scale: 1,
        alpha: 0, target: 0, color: '', text: '', tag: '', transform: '', width: 0, height: 0, opacity: -1, displayed: false }
    }
    this.reset(p)
    p.candidate.id = id; p.el.dataset.vehicle = id
    this.plates.set(id, p)
    return p
  }
  /** Forget a plate's history: a new vehicle in it starts hidden, unheld, at no nudge. */
  private reset(p: Plate): void {
    p.shown.value = false; p.shown.since = -Infinity; p.behind.value = false; p.behind.since = -Infinity; p.lifted.value = false; p.lifted.since = -Infinity; p.offered = false
    p.nudge.x = p.nudge.v = 0; p.candidate.held = p.candidate.nudged = false; p.compact = false; p.px = NaN
    p.alpha = p.target = 0; this.paint(p)
    p.moreWant = 0; p.moreSince = -Infinity; this.showMore(p, 0)
  }
  /** Write the stacked count, and the padding that keeps the name clear of it. */
  private showMore(p: Plate, count: number): void {
    if (count === p.moreCount && (count || !p.more.textContent)) return
    p.moreCount = count; p.more.textContent = count ? `+${count}` : ''
  }
  update(list: readonly NameplateInfo[]): void {
    this.entries = list
    // Suppress immediately while paused, even if the game does not draw another frame.
    this.root.hidden = !this.options.visible() || nameplateMode.value === 2
    this.renderHook.queue()
  }
  private draw(list: readonly NameplateInfo[], now = performance.now()): void {
    this.stamp++
    const drawStarted = performance.now()
    this.stats.terrainQueries = this.stats.visible = 0
    const dt = this.last ? Math.min(.1, Math.max(0, (now - this.last) / 1000)) : 1 / 60
    this.last = now
    const mode = nameplateMode.value, visible = this.options.visible() && mode !== 2
    this.root.hidden = !visible
    if (!visible) { for (const p of this.plates.values()) this.reset(p); this.stats.drawMs = performance.now() - drawStarted; return }
    const w = innerWidth, h = innerHeight, presentation = this.options.presentation(), size = this.options.wrapSize()
    const dpr = globalThis.devicePixelRatio || 1
    const screenSize = Math.max(SMALLEST_SCREEN, Math.min(1, w / REFERENCE_SCREEN[0], h / REFERENCE_SCREEN[1]))
    // The camera this frame, after every system has moved it: labels cannot lag their vehicles.
    this.camera.updateMatrixWorld()
    this.camera.getWorldPosition(this.eye)
    copyCurveState(this.bend) // Snapshot the same state uploaded to applyCurve this render.
    const focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
    const allocate = now >= this.nextAllocation
    if (allocate) { this.nextAllocation = now + ALLOCATE_MS; this.terrainBudget = 512; this.candidates.length = 0 }
    const fade = this.reducedMotion?.matches ? Infinity : dt * 1000 / FADE_MS
    const body = this.body
    let shownCount = 0
    for (const t of list) {
      const p = this.plates.get(t.id) ?? this.acquire(t.id)
      p.stamp = this.stamp
      if (p.vehicle !== t.vehicle) { p.vehicle = t.vehicle; this.reset(p) }
      const object = t.vehicle.object
      // Network/vehicle interpolation already chose the rendered tile relative to the player.
      renderedEnvelope(t.vehicle, this.center, this.rotation, this.anchor, body)
      const distance = this.center.distanceTo(this.eye)
      this.anchor.set(this.center.x, body.top + ANCHOR_RISE, this.center.z)
      this.projection.project(this.anchor, this.bend, this.camera, w, h, this.projected)
      const x = this.projected.x, y = this.projected.y, depth = this.projected.z
      // Hard limits, decided every frame without hold: these are facts, not judgements.
      const usable = Number.isFinite(x + y + depth + distance) && depth > this.camera.near && depth < this.camera.far &&
        x > -OFF_SCREEN && x < w + OFF_SCREEN && y > -OFF_SCREEN && y < h + OFF_SCREEN &&
        // Never a name in empty sky: nothing beyond the far plane, hidden, or over the planet's curve.
        object.visible && !overHorizon(this.center.x, this.center.z, Math.max(body.radius, body.reach), this.center.y + body.rise) && !(mode === 1 && t.bot) && distance < (t.bot ? DISTANCE.bot.range : DISTANCE.person.range) &&
        !(t.bot && 2 * Math.max(body.radius, body.reach) * focal < BOT_MIN_PIXELS * depth)
      // The hold restarts from nothing, so the label returns at once when the vehicle does.
      if (!usable) {
        p.shown.value = false; p.shown.since = -Infinity; p.candidate.held = p.offered = false; p.target = 0
        // While it fades, a label still follows its vehicle when there is a place to follow.
        if (p.displayed && Number.isFinite(x + y) && depth > 0) this.place(p, x, y, dpr, dt, p.candidate.width, p.candidate.height, p.scale)
        this.step(p, fade); continue
      }
      // Size: snapped whole-pixel name size; one line past the compact distance.
      const apparent = distance / screenSize
      p.compact = compactAt(apparent, t.bot, p.compact)
      p.px = snapPx(namePx(apparent, t.bot), p.px)
      const base = t.bot ? DISTANCE.bot.namePx : DISTANCE.person.namePx
      const scale = Math.round(p.px * (presentation ? 1.25 : 1)) / base
      // Text is untrusted replicated data: use textContent and a bounded display length.
      const name = t.name.slice(0, 48), tag = p.compact ? '' : [t.bot ? 'Bot' : 'Player', t.note].filter(Boolean).join(' · ')
      // Room on the name line for the stacked count, if any: the plate grows by it.
      const moreWidth = p.moreCount ? Math.ceil(textWidth(`+${p.moreCount}`, MORE_FONT, NAME_SPACING, 10)) + MORE_GAP : 0
      const width = Math.round(Math.min(PLATE_MAX, Math.max(PLATE_MIN, PLATE_INSET + moreWidth + Math.max(
        textWidth(name, t.bot ? BOT_NAME : PERSON_NAME, NAME_SPACING, base), tag ? textWidth(tag, t.bot ? BOT_TAG : PERSON_TAG, TAG_SPACING, t.bot ? 9 : 10) : 0))))
      const padding = moreWidth ? `${(t.bot ? 9 : 10) + moreWidth}px` : ''
      if (p.el.style.paddingRight !== padding) p.el.style.paddingRight = padding
      const height = HEIGHT[t.bot ? 'bot' : 'person'][p.compact ? 1 : 0]
      const c = p.candidate
      // The layout tests the plate where it is drawn: its centre, after keeping it on screen.
      c.bot = t.bot; c.x = plateLeft(x, width * scale, w) + width * scale / 2; c.y = y; c.distance = distance; c.width = width * scale; c.height = height * scale; c.compact = p.compact
      if (allocate) {
        // Sight: terrain between the eye and the point just above the roof (a line to the body's
        // middle grazed the slope a car was parked on). Held, so a vehicle running along a ridge
        // line does not blink. Your own vehicle never counts.
        bendPoint(this.anchor, this.bend, this.bent)
        hold(p.behind, curvedTerrainOccluded(this.eye, this.bent, this.bend, size, this.hitTerrain), now)
        // A bot behind terrain is not named; a person is, dimmed, so they can be found.
        p.offered = !(t.bot && p.behind.value)
        if (p.offered) this.candidates.push(c)
      }
      // Words and styles: written only when they change.
      if (p.text !== name) { p.text = name; p.name.textContent = name }
      if (p.tag !== tag) { p.tag = tag; p.note.textContent = tag }
      p.el.classList.toggle('is-bot', t.bot); p.el.classList.toggle('is-person', !t.bot); p.el.classList.toggle('is-compact', p.compact)
      // --vehicle-tint is the same colour under the name chat's speaker mark reads (src/ui/chat).
      if (t.color !== p.color) { p.color = t.color; const tint = liftTint(t.color); p.el.style.setProperty('--plate-tint', tint); p.el.style.setProperty('--vehicle-tint', tint) }
      if (width !== p.width) { p.width = width; p.el.style.width = `${width}px` }
      if (height !== p.height) { p.height = height; p.el.style.height = `${height}px` }
      p.scale = scale
      this.place(p, x, y, dpr, dt, c.width, c.height, scale)
      p.target = p.shown.value ? distanceOpacity(distance, t.bot) * (p.behind.value ? BEHIND_OPACITY : 1) * (t.bot ? .92 : 1) : 0
      this.step(p, fade)
      if (p.alpha > 0) shownCount++
    }
    if (allocate) {
      const hud = this.hud.read(w, h)
      const placed = placeLabels(this.candidates, hud, w, h, this.stackedBehind)
      const ids = new Map(placed.map(at => [at.id, at]))
      for (const c of this.candidates) {
        const p = this.plates.get(c.id)!, at = ids.get(c.id)
        // A label may hold its place against a neighbour, never over a HUD control: it leaves at once.
        if (!at && p.shown.value && hud.some(b => !b.soft && overlaps(plateRect(c, c.nudged), b))) { p.shown.value = false; p.shown.since = now }
        c.held = hold(p.shown, Boolean(at), now)
        // A label that just appeared takes its place at once; a shown one keeps its step until held.
        if (at) { if (!p.displayed) { p.lifted.value = at.nudged; p.lifted.since = now; p.nudge.x = at.nudged ? NUDGE : 0 } else hold(p.lifted, at.nudged, now) }
        c.nudged = p.lifted.value
        if (at) p.el.classList.toggle('is-over-hud', at.overSoft)
      }
      // "+N": labels left out because this plate holds their spot, and not showing. The count
      // changes only after the new value has held for HOLD_MS, so a passing overlap never flashes.
      this.stacked.clear()
      for (const [id, front] of this.stackedBehind) if (!this.plates.get(id)?.shown.value) this.stacked.set(front, (this.stacked.get(front) ?? 0) + 1)
      for (const at of placed) {
        const p = this.plates.get(at.id)!, want = this.stacked.get(at.id) ?? 0
        if (want !== p.moreWant) { p.moreWant = want; p.moreSince = now }
        if (want !== p.moreCount && now - p.moreSince >= HOLD_MS) this.showMore(p, want)
      }
      // Labels not offered this time (a bot gone behind terrain): hide, through the hold.
      for (const p of this.plates.values()) if (p.stamp === this.stamp && !p.offered) p.candidate.held = hold(p.shown, false, now)
    }
    for (const [id, p] of this.plates) if (p.stamp !== this.stamp) { this.reset(p); this.plates.delete(id); this.free.push(p) }
    this.stats.visible = shownCount
    this.stats.drawMs = performance.now() - drawStarted
  }
  /** Put a plate over its anchor this frame, exactly; only the nudge eases. Whole device pixels. */
  private place(p: Plate, x: number, y: number, dpr: number, dt: number, width: number, height: number, scale: number): void {
    const lift = spring(p.nudge, p.candidate.nudged ? NUDGE : 0, dt)
    const tx = Math.round(plateLeft(x, width, innerWidth) * dpr) / dpr, ty = Math.round((y - GAP - height - lift) * dpr) / dpr
    const transform = `translate(${tx}px,${ty}px) scale(${scale})`
    if (transform !== p.transform) { p.transform = transform; p.el.style.transform = transform }
  }
  /** Move a plate's opacity towards its target: a fade, never a slide. */
  private step(p: Plate, fade: number): void {
    p.alpha = p.target > p.alpha ? Math.min(p.target, p.alpha + fade) : Math.max(p.target, p.alpha - fade)
    this.paint(p)
  }
  private paint(p: Plate): void {
    const on = p.alpha > .005
    if (on !== p.displayed) { p.displayed = on; p.el.hidden = !on; p.el.style.display = on ? 'block' : 'none' }
    if (on && Math.abs(p.alpha - p.opacity) > .004) { p.opacity = p.alpha; p.el.style.opacity = p.alpha.toFixed(3) }
    if (!on) p.opacity = -1
  }
  dispose(): void { this.visibilityObserver.disconnect(); this.modeUnsubscribe(); this.renderHook.dispose(); this.unsubscribe(); this.hud.dispose(); this.root.remove(); this.plates.clear(); this.free.length = 0 }
}

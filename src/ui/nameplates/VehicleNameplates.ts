import * as THREE from 'three/webgpu'
import { params } from '../../../shared/params'
import type { Vehicle } from '../../vehicles/Vehicle'
import { appearance, insideDisc, placeNameplates, slotAt, type Candidate, type Disc, type Rect, type Slot } from './layout'
import type { Point } from './occlusion'
import { copyCurveState, overHorizon } from '../../world/curve'
import { bendPoint, CurvedProjection, curvedTerrainOccluded } from './curvature'
import { nameplateMode, restoreNameplatePreference } from './preferences'
import { HudExclusions } from './HudExclusions'
import { renderedEnvelope, type Envelope } from './anchors'
import { afterCameraFrame } from './renderHook'
import './nameplates.css'

/** Metres between the top of a vehicle's body and the end of its leader. */
const ANCHOR_GAP = .2
/** Milliseconds between full label allocations (occlusion, terrain, text, slots). Between them,
 *  shown labels only follow their vehicles. */
const ALLOCATE_MS = 100
/** Slack in metres round the player's own car when it hides labels behind it. */
const LOCAL_MARGIN = .05
/** A vehicle drawn smaller than this many pixels across is too small to label. */
const MIN_PIXELS = 6
/** Plate size limits in pixels. Past the widest, the name is cut with an ellipsis. */
const PLATE_MIN = 72, PLATE_MAX = 220
/** Plate heights for a person and a bot. Must match nameplates.css. */
const PERSON_HEIGHT = 42, BOT_HEIGHT = 38
/** Must match nameplates.css: name and tag fonts, letter spacing in em, and padding plus border. */
const PERSON_NAME = '600 14px Barlow', BOT_NAME = '500 12px Barlow', NAME_SPACING = .08, PERSON_TAG = '500 10px Barlow', BOT_TAG = '500 9px Barlow', TAG_SPACING = .16
const PLATE_INSET = 30 // padding, border and 4 px for kerning

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
  localVehicle(): Vehicle
}
interface Plate {
  el: HTMLDivElement; name: HTMLElement; note: HTMLElement; leader: HTMLDivElement
  candidate: Candidate; disc: Disc
  bentCenter: THREE.Vector3; sightStamp: number; sightBlocked: boolean
  vehicle?: Vehicle; stamp: number; scanUntil: number; shown: boolean; materializing: boolean; lastX: number; lastY: number
  /** Last written values, so unchanged frames write nothing. */
  color: string; scale: number; width: number; height: number; tx: number; ty: number; lx: number; ly: number; ex: number; ey: number; opacity: number
}
/** One pooled overlay, updated by the caller once after vehicle interpolation and camera update. */
export class VehicleNameplates {
  private readonly root = document.createElement('div')
  private readonly plates = new Map<string, Plate>()
  private readonly free: Plate[] = []
  private readonly hud: HudExclusions
  private readonly unsubscribe: () => void
  private readonly modeUnsubscribe: () => void
  private readonly visibilityObserver: MutationObserver
  private readonly eye = new THREE.Vector3()
  private readonly center = new THREE.Vector3() // Flat, already-reimaged vehicle coordinates.
  private readonly bend = new THREE.Vector3()
  private readonly screenCenter = new THREE.Vector3()
  private readonly projection = new CurvedProjection()
  private readonly localDisc: Disc = { id: '@local', x: 0, y: 0, radius: 0, depth: 0, plateOnly: true }
  private readonly body: Envelope = { radius: 0, rise: 0, reach: 0, top: 0 }
  private readonly anchor = new THREE.Vector3()
  private readonly projected = new THREE.Vector3()
  private readonly view = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private readonly renderHook: { queue(): void; dispose(): void }
  private entries: readonly NameplateInfo[] = []
  /** Diagnostics for the allocated browser gate, not a gameplay or network setting. */
  readonly stats = { terrainQueries: 0, visible: 0, drawMs: 0 }
  private terrainBudget = 0
  private readonly hitTerrain = (from: Point, to: Point): boolean => {
    // A crowded distant view must hide unresolved labels instead of monopolizing a frame.
    if (this.terrainBudget-- <= 0) return true
    this.stats.terrainQueries++
    return this.options.terrainHit(from, to)
  }
  private stamp = 0
  private last = 0
  private nextAllocation = 0
  private readonly slot: Slot = { x: 0, y: 0, leadX: 0, leadY: 0 }
  private readonly candidates: Candidate[] = []
  private readonly discs: Disc[] = []
  private readonly placed = new Set<string>()

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
      const el = document.createElement('div'), name = document.createElement('strong'), note = document.createElement('small'), leader = document.createElement('div')
      el.className = 'vehicle-nameplate'; leader.className = 'vehicle-nameplate-leader'
      el.append(name, note); this.root.append(leader, el)
      p = { el, name, note, leader, bentCenter: new THREE.Vector3(), sightStamp: 0, sightBlocked: false, candidate: { id, bot: false, x: 0, y: 0, depth: 0, width: 0, height: 0, opacity: 0, tick: false }, disc: { id, x: 0, y: 0, radius: 0, depth: 0 }, stamp: 0, scanUntil: 0, shown: false, materializing: false, lastX: NaN, lastY: NaN, color: '', scale: 1, width: 0, height: 0, tx: NaN, ty: NaN, lx: NaN, ly: NaN, ex: NaN, ey: NaN, opacity: -1 }
    }
    p.candidate.id = p.disc.id = id; p.candidate.previous = undefined; p.shown = false; p.materializing = false; p.lastX = p.lastY = NaN
    p.el.dataset.vehicle = id
    this.plates.set(id, p)
    return p
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
    this.stats.terrainQueries = this.stats.visible = this.stats.drawMs = 0
    this.terrainBudget = 512
    const dt = this.last ? Math.min(.1, Math.max(0, (now - this.last) / 1000)) : 1 / 60
    this.last = now
    const mode = nameplateMode.value, visible = this.options.visible() && mode !== 2
    this.root.hidden = !visible
    if (!visible) { for (const p of this.plates.values()) { p.shown = false; p.lastX = p.lastY = NaN }; return }
    const w = innerWidth, h = innerHeight, presentation = this.options.presentation(), size = this.options.wrapSize()
    this.camera.updateMatrixWorld()
    this.camera.getWorldPosition(this.eye)
    copyCurveState(this.bend) // Snapshot the same state uploaded to applyCurve this render.
    const focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
    if (now < this.nextAllocation) { this.follow(list, dt, w, h, focal, presentation, mode); this.stats.drawMs = performance.now() - drawStarted; return }
    this.nextAllocation = now + ALLOCATE_MS
    // HUD rectangles are a cached read (HudExclusions); no layout is forced here.
    const exclusions = this.hud.read(w, h)
    const candidates = this.candidates, discs = this.discs
    candidates.length = discs.length = 0
    // The local vehicle gets no nameplate, but its hull still occludes labels behind it.
    const local = this.options.localVehicle()
    // Bodies are boxes fitted to each kind's meshes. A cube as tall as the car is long covered
    // most of a phone screen above the player's roof and rejected every label behind it.
    // The player's own car hides a label only where the other vehicle is behind its body: no
    // slack margin. From the chase camera the usual 0.3 m margin is a band of empty sky over the
    // roof, and a car 14 m ahead whose roof shows above yours lost its label to it.
    const body = renderedEnvelope(local, this.center, this.rotation, this.anchor, this.body, LOCAL_MARGIN)
    this.projection.envelope(this.center, body.radius, this.bend, this.camera, w, h, this.localDisc, body.rise, body.reach)
    discs.push(this.localDisc)
    for (const t of list) {
      const p = this.plates.get(t.id) ?? this.acquire(t.id)
      p.stamp = this.stamp
      if (p.vehicle !== t.vehicle) { p.vehicle = t.vehicle; p.shown = false; p.lastX = p.lastY = NaN }
      const object = t.vehicle.object
      renderedEnvelope(t.vehicle, this.center, this.rotation, this.anchor, body)
      // Network/vehicle interpolation already chose the rendered tile relative to the player.
      // Rewrapping relative to a free camera would detach the label by a whole world.
      this.projection.project(this.center, this.bend, this.camera, w, h, this.screenCenter)
      const depth = this.screenCenter.z, distance = this.center.distanceTo(this.eye)
      const horizonHidden = overHorizon(this.center.x, this.center.z, Math.max(body.radius, body.reach), this.center.y + body.rise)
      if (object.visible && !horizonHidden) {
        this.projection.envelope(this.center, body.radius, this.bend, this.camera, w, h, p.disc, body.rise, body.reach)
        discs.push(p.disc)
      }
      const style = appearance(distance, t.bot, presentation)
      const materializing = object.userData.materializing === true
      if (materializing && !p.materializing || !p.shown) p.scanUntil = now + 220
      p.el.classList.toggle('is-scanning', now < p.scanUntil)
      p.materializing = materializing
      // Never label what cannot be seen: off screen, too small, hidden or filtered out.
      const sx = this.screenCenter.x, sy = this.screenCenter.y
      const offScreen = !(sx >= 0 && sx <= w && sy >= 0 && sy <= h), tiny = 2 * Math.max(body.radius, body.reach) * focal < MIN_PIXELS * depth
      if (!Number.isFinite(distance + depth) || depth <= this.camera.near || offScreen || tiny || horizonHidden || !object.visible || !style.visible || mode === 1 && t.bot) { this.hide(p); continue }
      // The leader ends just above the roof, so it touches the vehicle it names.
      this.anchor.set(this.center.x, body.top + ANCHOR_GAP, this.center.z)
      // Curved visual sight maps to a path in flat physics space, not one straight flat ray.
      bendPoint(this.center, this.bend, p.bentCenter)
      this.projection.project(this.anchor, this.bend, this.camera, w, h, this.projected)
      if (this.projected.z < this.camera.near || this.projected.z > this.camera.far) { this.hide(p); continue }
      // Behind the player's own car only if even the point just above its roof (the anchor) is
      // inside that car's outline: a car ahead level with your roof is named, one wholly hidden
      // by your car is not.
      if (this.localDisc.depth < this.projected.z && insideDisc(this.projected.x, this.projected.y, this.localDisc)) { this.hide(p); continue }
      const x = this.projected.x, y = this.projected.y
      // Light screen filtering removes subpixel shimmer. Large camera/wrap moves snap rather
      // than dragging a stale label across the HUD; collision tests use the filtered anchor.
      const snap = !Number.isFinite(p.lastX) || Math.hypot(x - p.lastX, y - p.lastY) > 60
      const blend = 1 - Math.exp(-dt * 28)
      p.lastX = snap ? x : p.lastX + (x - p.lastX) * blend
      p.lastY = snap ? y : p.lastY + (y - p.lastY) * blend
      // Text is untrusted replicated data: use textContent and a bounded display length.
      const name = t.name.slice(0, 48), far = !t.bot && distance > 140 ? `${Math.round(distance / 10) * 10} m` : ''
      const note = [t.bot ? 'Bot' : 'Player', t.note, far].filter(Boolean).join(' · ')
      // Sized to the name (or a longer tag) up to PLATE_MAX, where the name is cut short.
      const plateWidth = Math.round(Math.min(PLATE_MAX, Math.max(PLATE_MIN, PLATE_INSET + Math.max(
        textWidth(name, t.bot ? BOT_NAME : PERSON_NAME, NAME_SPACING, t.bot ? 12 : 14), textWidth(note, t.bot ? BOT_TAG : PERSON_TAG, TAG_SPACING, t.bot ? 9 : 10)))))
      const plateHeight = t.bot ? BOT_HEIGHT : PERSON_HEIGHT
      Object.assign(p.candidate, { held: p.shown, bot: t.bot, x: p.lastX, y: p.lastY, depth: this.projected.z, width: style.tick ? 8 : plateWidth * style.scale, height: style.tick ? 5 : plateHeight * style.scale, opacity: style.opacity, tick: style.tick })
      candidates.push(p.candidate)
      if (p.name.textContent !== name) p.name.textContent = name
      if (p.note.textContent !== note) p.note.textContent = note
      p.el.classList.toggle('is-bot', t.bot); p.leader.classList.toggle('is-bot', t.bot); p.el.classList.toggle('is-tick', style.tick)
      if (t.color !== p.color) { p.color = t.color; const tint = liftTint(t.color); p.el.style.setProperty('--vehicle-tint', tint); p.leader.style.setProperty('--vehicle-tint', tint) }
      const cssWidth = style.tick ? 8 : plateWidth, cssHeight = style.tick ? 5 : plateHeight
      if (cssWidth !== p.width) { p.width = cssWidth; p.el.style.width = `${cssWidth}px` }
      if (cssHeight !== p.height) { p.height = cssHeight; p.el.style.height = `${cssHeight}px` }
      p.scale = style.tick ? 1 : style.scale
    }
    const placements = placeNameplates(candidates, discs, exclusions, w, h, (box, depth, candidate) => {
      const p = this.plates.get(candidate.id)!
      // Visibility work follows the allocator's people-first order, including its ray budget.
      if (p.sightStamp !== this.stamp) {
        p.sightStamp = this.stamp
        p.sightBlocked = curvedTerrainOccluded(this.eye, p.bentCenter, this.bend, size, this.hitTerrain)
      }
      return !p.sightBlocked && this.clearBox(box, depth, size, w, h)
    })
    const placed = this.placed
    placed.clear()
    for (const at of placements) {
      const p = this.plates.get(at.id)!
      placed.add(at.id); p.candidate.previous = at.spot
      p.el.classList.toggle('is-over-hud', at.overSoft)
      this.write(p, at, at.opacity)
    }
    this.stats.visible = placements.length
    for (const [id, p] of this.plates) {
      if (!placed.has(id)) this.hide(p)
      if (p.stamp !== this.stamp) { this.plates.delete(id); this.free.push(p) }
    }
    this.stats.drawMs = performance.now() - drawStarted
  }
  /**
   * Between allocations: each shown label follows its vehicle in the slot it was given, and is
   * hidden at once if the vehicle leaves the screen or view. Occlusion waits for the next allocation.
   */
  private follow(list: readonly NameplateInfo[], dt: number, w: number, h: number, focal: number, presentation: boolean, mode: number): void {
    const body = this.body
    let visible = 0
    for (const t of list) {
      const p = this.plates.get(t.id)
      if (!p || !p.shown) continue
      if (p.vehicle !== t.vehicle) { this.hide(p); continue }
      const object = t.vehicle.object, c = p.candidate
      renderedEnvelope(t.vehicle, this.center, this.rotation, this.anchor, body)
      this.projection.project(this.center, this.bend, this.camera, w, h, this.screenCenter)
      const depth = this.screenCenter.z, distance = this.center.distanceTo(this.eye), sx = this.screenCenter.x, sy = this.screenCenter.y
      const style = appearance(distance, t.bot, presentation)
      if (!Number.isFinite(distance + depth) || depth <= this.camera.near || !(sx >= 0 && sx <= w && sy >= 0 && sy <= h) ||
        2 * Math.max(body.radius, body.reach) * focal < MIN_PIXELS * depth || !object.visible || !style.visible || mode === 1 && t.bot ||
        overHorizon(this.center.x, this.center.z, Math.max(body.radius, body.reach), this.center.y + body.rise)) { this.hide(p); continue }
      this.anchor.set(this.center.x, body.top + ANCHOR_GAP, this.center.z)
      this.projection.project(this.anchor, this.bend, this.camera, w, h, this.projected)
      if (this.projected.z < this.camera.near || this.projected.z > this.camera.far) { this.hide(p); continue }
      const x = this.projected.x, y = this.projected.y
      const snap = Math.hypot(x - p.lastX, y - p.lastY) > 60, blend = 1 - Math.exp(-dt * 28)
      p.lastX = snap ? x : p.lastX + (x - p.lastX) * blend
      p.lastY = snap ? y : p.lastY + (y - p.lastY) * blend
      c.x = p.lastX; c.y = p.lastY; c.depth = this.projected.z
      this.write(p, slotAt(c, c.previous ?? 0, this.slot), c.opacity)
      visible++
    }
    this.stats.visible = visible
  }
  /** Show a plate in a slot. Writes only what changed by more than half a pixel. */
  private write(p: Plate, at: Slot, opacity: number): void {
    const c = p.candidate
    if (!p.shown) { p.el.hidden = p.leader.hidden = false; p.el.style.display = p.leader.style.display = 'block'; p.shown = true; p.tx = p.lx = NaN }
    if (Math.abs(opacity - p.opacity) > .01) { p.opacity = opacity; p.el.style.opacity = String(opacity); p.leader.style.opacity = String(opacity * .65) }
    const tx = at.x - c.width / 2, ty = at.y
    if (!(Math.abs(tx - p.tx) <= .5 && Math.abs(ty - p.ty) <= .5)) {
      p.tx = tx; p.ty = ty
      p.el.style.transform = `translate(${tx}px,${ty}px) scale(${p.scale})`
    }
    if (!(Math.abs(at.leadX - p.lx) <= .5 && Math.abs(at.leadY - p.ly) <= .5 && Math.abs(c.x - p.ex) <= .5 && Math.abs(c.y - p.ey) <= .5)) {
      p.lx = at.leadX; p.ly = at.leadY; p.ex = c.x; p.ey = c.y
      const dx = c.x - at.leadX, dy = c.y - at.leadY
      p.leader.style.width = `${Math.hypot(dx, dy)}px`
      p.leader.style.transform = `translate(${at.leadX}px,${at.leadY}px) rotate(${Math.atan2(dy, dx)}rad)`
    }
  }
  private hide(p: Plate): void {
    if (!p.shown && p.el.hidden) return
    p.el.hidden = p.leader.hidden = true; p.el.style.display = p.leader.style.display = 'none'; p.shown = false
  }
  /** Sample plate screen rays against curved terrain. This is not a per-pixel depth mask. */
  private clearBox(box: Rect, depth: number, size: number, w: number, h: number): boolean {
    for (const x of [box.left, (box.left + box.right) / 2, box.right]) for (const y of [box.top, box.bottom]) {
      this.target.set(x / w * 2 - 1, 1 - y / h * 2, .5).unproject(this.camera).sub(this.eye)
      this.view.copy(this.target).transformDirection(this.camera.matrixWorldInverse)
      this.target.normalize().multiplyScalar(depth / Math.max(.01, -this.view.z)).add(this.eye)
      if (curvedTerrainOccluded(this.eye, this.target, this.bend, size, this.hitTerrain)) return false
    }
    return true
  }
  dispose(): void { this.visibilityObserver.disconnect(); this.modeUnsubscribe(); this.renderHook.dispose(); this.unsubscribe(); this.hud.dispose(); this.root.remove(); this.plates.clear(); this.free.length = 0 }
}

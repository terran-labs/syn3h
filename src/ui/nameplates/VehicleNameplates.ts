import * as THREE from 'three/webgpu'
import { params } from '../../../shared/params'
import type { Vehicle } from '../../vehicles/Vehicle'
import { appearance, placeNameplates, type Candidate, type Disc, type Rect } from './layout'
import type { Point } from './occlusion'
import { copyCurveState, overHorizon } from '../../world/curve'
import { bendPoint, CurvedProjection, curvedTerrainOccluded } from './curvature'
import { nameplateMode, restoreNameplatePreference } from './preferences'
import { HudExclusions } from './HudExclusions'
import { renderedEnvelope } from './anchors'
import { afterCameraFrame } from './renderHook'
import './nameplates.css'

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
  private readonly localDisc: Disc = { id: '@local', x: 0, y: 0, radius: 0, depth: 0 }
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
      p = { el, name, note, leader, bentCenter: new THREE.Vector3(), sightStamp: 0, sightBlocked: false, candidate: { id, bot: false, x: 0, y: 0, depth: 0, width: 0, height: 0, opacity: 0, tick: false }, disc: { id, x: 0, y: 0, radius: 0, depth: 0 }, stamp: 0, scanUntil: 0, shown: false, materializing: false, lastX: NaN, lastY: NaN }
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
    // All HUD layout reads happen before any nameplate writes. Plate dimensions are fixed.
    const exclusions = this.hud.read(w, h)
    this.camera.updateMatrixWorld()
    this.camera.getWorldPosition(this.eye)
    copyCurveState(this.bend) // Snapshot the same state uploaded to applyCurve this render.
    const candidates: Candidate[] = [], discs: Disc[] = []
    // The local vehicle gets no nameplate, but its hull still occludes labels behind it.
    const local = this.options.localVehicle()
    const localRadius = renderedEnvelope(local, this.center, this.rotation, this.anchor)
    this.projection.project(this.center, this.bend, this.camera, w, h, this.screenCenter)
    if (this.screenCenter.z > localRadius) {
      this.projection.envelope(this.center, localRadius, this.bend, this.camera, w, h, this.localDisc)
      discs.push(this.localDisc)
    }
    for (const t of list) {
      const p = this.plates.get(t.id) ?? this.acquire(t.id)
      p.stamp = this.stamp
      if (p.vehicle !== t.vehicle) { p.vehicle = t.vehicle; p.shown = false; p.lastX = p.lastY = NaN }
      const object = t.vehicle.object
      const radius = renderedEnvelope(t.vehicle, this.center, this.rotation, this.anchor)
      // Network/vehicle interpolation already chose the rendered tile relative to the player.
      // Rewrapping relative to a free camera would detach the label by a whole world.
      this.projection.project(this.center, this.bend, this.camera, w, h, this.screenCenter)
      const depth = this.screenCenter.z, distance = this.center.distanceTo(this.eye)
      const horizonHidden = overHorizon(this.center.x, this.center.z, radius, this.center.y + radius)
      if (depth > this.camera.near && object.visible && !horizonHidden) {
        this.projection.envelope(this.center, radius, this.bend, this.camera, w, h, p.disc)
        discs.push(p.disc)
      }
      const style = appearance(distance, t.bot, presentation)
      const materializing = object.userData.materializing === true
      if (materializing && !p.materializing || !p.shown) p.scanUntil = now + 220
      p.el.classList.toggle('is-scanning', now < p.scanUntil)
      p.materializing = materializing
      if (!Number.isFinite(distance + depth) || depth <= this.camera.near || horizonHidden || !object.visible || !style.visible || mode === 1 && t.bot) { this.hide(p); continue }
      this.anchor.copy(this.center); this.anchor.y += radius + .65
      // Curved visual sight maps to a path in flat physics space, not one straight flat ray.
      bendPoint(this.center, this.bend, p.bentCenter)
      this.projection.project(this.anchor, this.bend, this.camera, w, h, this.projected)
      if (this.projected.z < this.camera.near || this.projected.z > this.camera.far) { this.hide(p); continue }
      const x = this.projected.x, y = this.projected.y
      // Light screen filtering removes subpixel shimmer. Large camera/wrap moves snap rather
      // than dragging a stale label across the HUD; collision tests use the filtered anchor.
      const snap = !Number.isFinite(p.lastX) || Math.hypot(x - p.lastX, y - p.lastY) > 60
      const blend = 1 - Math.exp(-dt * 28)
      p.lastX = snap ? x : p.lastX + (x - p.lastX) * blend
      p.lastY = snap ? y : p.lastY + (y - p.lastY) * blend
      const baseWidth = Math.min(184, Math.max(116, w * .32)), baseHeight = 40
      Object.assign(p.candidate, { bot: t.bot, x: p.lastX, y: p.lastY, depth: this.projected.z, width: style.tick ? 8 : baseWidth * style.scale, height: style.tick ? 5 : baseHeight * style.scale, opacity: style.opacity, tick: style.tick })
      candidates.push(p.candidate)
      // Text is untrusted replicated data: use textContent and a bounded display length.
      const name = t.name.slice(0, 48), far = !t.bot && distance > 140 ? `${Math.round(distance / 10) * 10} m` : ''
      const note = [t.bot ? 'BOT' : '', t.note, far].filter(Boolean).join(' · ')
      if (p.name.textContent !== name) p.name.textContent = name
      if (p.note.textContent !== note) p.note.textContent = note
      p.el.classList.toggle('is-bot', t.bot); p.el.classList.toggle('is-tick', style.tick)
      p.el.style.setProperty('--vehicle-color', /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#8fe3ff')
      p.el.style.width = `${style.tick ? 8 : baseWidth}px`; p.el.style.height = `${style.tick ? 5 : baseHeight}px`
      p.el.dataset.scale = String(style.tick ? 1 : style.scale)
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
    const placed = new Set<string>()
    for (const at of placements) {
      const p = this.plates.get(at.id)!, c = p.candidate
      placed.add(at.id); c.previous = at.spot
      p.el.hidden = p.leader.hidden = false
      p.el.style.display = p.leader.style.display = 'block'
      p.el.style.opacity = String(at.opacity)
      p.el.style.transform = `translate(${at.x - c.width / 2}px,${at.y}px) scale(${p.el.dataset.scale})`
      const startX = at.x, startY = at.y + c.height, dx = c.x - startX, dy = c.y - startY
      p.leader.style.width = `${Math.hypot(dx, dy)}px`
      p.leader.style.opacity = String(at.opacity * .65)
      p.leader.style.transform = `translate(${startX}px,${startY}px) rotate(${Math.atan2(dy, dx)}rad)`
      p.shown = true
    }
    this.stats.visible = placements.length
    for (const [id, p] of this.plates) {
      if (!placed.has(id)) this.hide(p)
      if (p.stamp !== this.stamp) { this.plates.delete(id); this.free.push(p) }
    }
    this.stats.drawMs = performance.now() - drawStarted
  }
  private hide(p: Plate): void { p.el.hidden = p.leader.hidden = true; p.el.style.display = p.leader.style.display = 'none'; p.shown = false }
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

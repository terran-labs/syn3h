import * as THREE from 'three/webgpu'
import { params } from '../../../shared/params'
import type { Vehicle } from '../../vehicles/Vehicle'
import { appearance, placeNameplates, type Candidate, type Disc, type Rect } from './layout'
import { wrappedOccluded, type Point } from './occlusion'
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
  /** Exact terrain-only segment query. Vehicle occlusion uses rendered screen bounds below. */
  terrainHit(from: Point, to: Point): boolean
  shell: HTMLElement
  scene: THREE.Scene
  localVehicle(): Vehicle
}
interface Plate {
  el: HTMLDivElement; name: HTMLElement; note: HTMLElement; leader: HTMLDivElement
  candidate: Candidate; disc: Disc
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
  private readonly center = new THREE.Vector3()
  private readonly anchor = new THREE.Vector3()
  private readonly projected = new THREE.Vector3()
  private readonly view = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private readonly renderHook: { queue(): void; dispose(): void }
  private entries: readonly NameplateInfo[] = []
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
      p = { el, name, note, leader, candidate: { id, bot: false, x: 0, y: 0, depth: 0, width: 0, height: 0, opacity: 0, tick: false }, disc: { id, x: 0, y: 0, radius: 0, depth: 0 }, stamp: 0, scanUntil: 0, shown: false, materializing: false, lastX: NaN, lastY: NaN }
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
    const focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
    const candidates: Candidate[] = [], discs: Disc[] = []
    // The local vehicle gets no nameplate, but its hull still occludes labels behind it.
    const local = this.options.localVehicle()
    const localRadius = renderedEnvelope(local, this.center, this.rotation, this.anchor)
    this.view.copy(this.center).applyMatrix4(this.camera.matrixWorldInverse)
    const localDepth = -this.view.z
    if (localDepth > localRadius) {
      this.projected.copy(this.center).project(this.camera)
      discs.push({ id: '@local', x: (this.projected.x + 1) * w / 2, y: (1 - this.projected.y) * h / 2,
        radius: localRadius * focal / localDepth, depth: localDepth - localRadius })
    }
    for (const t of list) {
      const p = this.plates.get(t.id) ?? this.acquire(t.id)
      p.stamp = this.stamp
      if (p.vehicle !== t.vehicle) { p.vehicle = t.vehicle; p.shown = false; p.lastX = p.lastY = NaN }
      const object = t.vehicle.object
      const radius = renderedEnvelope(t.vehicle, this.center, this.rotation, this.anchor)
      // Network/vehicle interpolation already chose the rendered tile relative to the player.
      // Rewrapping relative to a free camera would detach the label by a whole world.
      this.view.copy(this.center).applyMatrix4(this.camera.matrixWorldInverse)
      const depth = -this.view.z, distance = this.center.distanceTo(this.eye)
      this.projected.copy(this.center).project(this.camera)
      Object.assign(p.disc, { x: (this.projected.x + 1) * w / 2, y: (1 - this.projected.y) * h / 2, radius: radius * focal / Math.max(.01, depth), depth: depth - radius })
      if (depth > this.camera.near && object.visible) discs.push(p.disc)
      const style = appearance(distance, t.bot, presentation)
      const materializing = object.userData.materializing === true
      if (materializing && !p.materializing || !p.shown) p.scanUntil = now + 220
      p.el.classList.toggle('is-scanning', now < p.scanUntil)
      p.materializing = materializing
      if (!Number.isFinite(distance + depth) || depth <= this.camera.near || !object.visible || !style.visible || mode === 1 && t.bot) { this.hide(p); continue }
      this.anchor.copy(this.center); this.anchor.y += radius + .65
      // Entirely hide terrain-occluded vehicles, including people. No accidental wall hacks.
      if (wrappedOccluded(this.eye, this.center, size, this.options.terrainHit)) { this.hide(p); continue }
      this.projected.copy(this.anchor).project(this.camera)
      if (this.projected.z < -1 || this.projected.z > 1) { this.hide(p); continue }
      const x = (this.projected.x + 1) * w / 2, y = (1 - this.projected.y) * h / 2
      // Light screen filtering removes subpixel shimmer. Large camera/wrap moves snap rather
      // than dragging a stale label across the HUD; collision tests use the filtered anchor.
      const snap = !Number.isFinite(p.lastX) || Math.hypot(x - p.lastX, y - p.lastY) > 60
      const blend = 1 - Math.exp(-dt * 28)
      p.lastX = snap ? x : p.lastX + (x - p.lastX) * blend
      p.lastY = snap ? y : p.lastY + (y - p.lastY) * blend
      const baseWidth = Math.min(184, Math.max(116, w * .32)), baseHeight = 40
      Object.assign(p.candidate, { bot: t.bot, x: p.lastX, y: p.lastY, depth, width: style.tick ? 8 : baseWidth * style.scale, height: style.tick ? 5 : baseHeight * style.scale, opacity: style.opacity, tick: style.tick })
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
    const placements = placeNameplates(candidates, discs, exclusions, w, h, (box, depth) => this.clearBox(box, depth, size, w, h))
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
    for (const [id, p] of this.plates) {
      if (!placed.has(id)) this.hide(p)
      if (p.stamp !== this.stamp) { this.plates.delete(id); this.free.push(p) }
    }
  }
  private hide(p: Plate): void { p.el.hidden = p.leader.hidden = true; p.el.style.display = p.leader.style.display = 'none'; p.shown = false }
  /** Reject a plate whose screen rays meet terrain before reaching its vehicle's depth. */
  private clearBox(box: Rect, depth: number, size: number, w: number, h: number): boolean {
    for (const x of [box.left, (box.left + box.right) / 2, box.right]) for (const y of [box.top, box.bottom]) {
      this.target.set(x / w * 2 - 1, 1 - y / h * 2, .5).unproject(this.camera).sub(this.eye)
      this.view.copy(this.target).transformDirection(this.camera.matrixWorldInverse)
      this.target.normalize().multiplyScalar(depth / Math.max(.01, -this.view.z)).add(this.eye)
      if (wrappedOccluded(this.eye, this.target, size, this.options.terrainHit)) return false
    }
    return true
  }
  dispose(): void { this.visibilityObserver.disconnect(); this.modeUnsubscribe(); this.renderHook.dispose(); this.unsubscribe(); this.hud.dispose(); this.root.remove(); this.plates.clear(); this.free.length = 0 }
}

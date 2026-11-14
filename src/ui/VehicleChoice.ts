import * as THREE from 'three/webgpu'
import { ClassicBuggySkin, Syn3hBuggySkin } from '../vehicles/skins'
import type { BuggySkin } from '../vehicles/skins/BuggySkin'
import type { VehicleKind } from '../vehicles'

export interface VehicleChoice {
  vehicleKind: Extract<VehicleKind, 'buggy-classic' | 'buggy-syn3h'>
  bodyColor: string
  accentColor: string
}
const defaults: VehicleChoice = { vehicleKind: 'buggy-classic', bodyColor: '#1768b4', accentColor: '#49e6ff' }
export function sanitizeVehicleChoice(value: Partial<VehicleChoice> | null): VehicleChoice {
  const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
  return { vehicleKind: value?.vehicleKind === 'buggy-syn3h' ? 'buggy-syn3h' : 'buggy-classic', bodyColor: color(value?.bodyColor, defaults.bodyColor), accentColor: color(value?.accentColor, defaults.accentColor) }
}
export function readVehicleChoice(): VehicleChoice {
  try { return sanitizeVehicleChoice(JSON.parse(localStorage.getItem('syn3h.vehicle') || 'null')) } catch { return { ...defaults } }
}
export function saveVehicleChoice(choice: VehicleChoice): void {
  try { localStorage.setItem('syn3h.vehicle', JSON.stringify(choice)) } catch { /* Storage is optional. */ }
}

/** Render on changes only, so the chooser does not keep a second game loop running. */
export class VehiclePreview {
  private readonly renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(38, 2, 0.1, 100)
  private readonly observer: ResizeObserver
  private skin?: BuggySkin
  private kind?: VehicleChoice['vehicleKind']
  private choice: VehicleChoice = readVehicleChoice()
  private initialized = false
  private disposed = false
  private drawing = false
  private dirty = false
  constructor(private readonly host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.domElement.setAttribute('aria-label', 'Selected buggy colour preview')
    this.renderer.domElement.setAttribute('role', 'img')
    this.host.append(this.renderer.domElement)
    this.scene.add(new THREE.HemisphereLight(0xb8dcff, 0x6f3321, 2.2))
    const sun = new THREE.DirectionalLight(0xffdfbc, 4); sun.position.set(-4, 10, -6); this.scene.add(sun)
    this.camera.position.set(3.5, 2.5, -5); this.camera.lookAt(0, 0.1, 0)
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host)
    void this.renderer.init().then(() => {
      if (this.disposed) { this.renderer.dispose(); return }
      this.initialized = true; this.resize(); this.setChoice(this.choice)
    }).catch(() => { if (!this.disposed) host.dataset.error = 'Preview unavailable. Your selection is saved.' })
  }
  setChoice(choice: VehicleChoice): void {
    this.choice = { ...choice }
    if (!this.initialized || this.disposed) return
    if (choice.vehicleKind !== this.kind) {
      if (this.skin) { this.scene.remove(this.skin.object); this.skin.dispose() }
      this.kind = choice.vehicleKind
      const skin = this.skin = choice.vehicleKind === 'buggy-classic' ? new ClassicBuggySkin() : new Syn3hBuggySkin()
      this.scene.add(skin.object)
      this.host.dataset.ready = 'false'
      void skin.ready.then(() => {
        if (this.disposed || this.skin !== skin) return
        skin.setColors(this.choice.bodyColor, this.choice.accentColor); skin.setWings(0.35, 0, 0)
        this.host.dataset.ready = 'true'; delete this.host.dataset.error; void this.draw()
      }).catch(() => { if (!this.disposed && this.skin === skin) this.host.dataset.error = 'Preview unavailable. Your selection is saved.' })
    }
    this.skin?.setColors(choice.bodyColor, choice.accentColor)
    void this.draw()
  }
  private resize(): void {
    if (!this.initialized || this.disposed) return
    const width = this.host.clientWidth || 320, height = this.host.clientHeight || 150
    this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix()
    void this.draw()
  }
  private async draw(): Promise<void> {
    this.dirty = true
    if (!this.initialized || this.disposed || this.drawing) return
    this.drawing = true
    try {
      while (this.dirty && !this.disposed) { this.dirty = false; await this.renderer.renderAsync(this.scene, this.camera) }
    } catch { if (!this.disposed) this.host.dataset.error = 'Preview unavailable. Your selection is saved.' }
    finally { this.drawing = false; if (this.disposed && this.initialized) this.renderer.dispose() }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.observer.disconnect(); this.skin?.dispose()
    if (this.initialized && !this.drawing) this.renderer.dispose()
  }
}

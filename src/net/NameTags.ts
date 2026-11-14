/**
 * Name tags over remote vehicles, as the original's `player_nametag` GUI labels.
 * A DOM overlay: one absolutely positioned div per vehicle, moved with a CSS transform each
 * frame. Cheaper than sprites (no texture per name) and crisp at any resolution.
 */
import * as THREE from 'three/webgpu'
import type { Vehicle } from '../vehicles/Vehicle'

export interface TagInfo {
  vehicle: Vehicle
  name: string
  /** Short state after the name, e.g. "IT" or "paused". */
  note: string
  it: boolean
}

/** Fully visible within this distance, gone beyond FAR. */
const NEAR = 40
const FAR = 220
const HEIGHT = 2.6

export class NameTags {
  private readonly root = document.createElement('div')
  private readonly tags = new Map<Vehicle, HTMLDivElement>()
  private readonly v = new THREE.Vector3()
  private readonly cam = new THREE.Vector3()

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    Object.assign(this.root.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '5',
    })
    this.root.className = 'syn3h-nametags'
    document.body.appendChild(this.root)
  }

  update(list: TagInfo[]): void {
    const seen = new Set<Vehicle>()
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.getWorldPosition(this.cam)
    for (const t of list) {
      seen.add(t.vehicle)
      let el = this.tags.get(t.vehicle)
      if (!el) {
        el = document.createElement('div')
        Object.assign(el.style, {
          position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap',
          font: '600 12px ui-monospace, SFMono-Regular, Menlo, monospace',
          padding: '1px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.35)',
          textShadow: '0 1px 2px #000', willChange: 'transform, opacity',
        })
        this.root.appendChild(el)
        this.tags.set(t.vehicle, el)
      }
      this.v.copy(t.vehicle.object.position)
      this.v.y += HEIGHT
      const dist = this.v.distanceTo(this.cam)
      this.v.project(this.camera)
      const visible = this.v.z < 1 && dist < FAR && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2
      if (!visible) {
        el.style.display = 'none'
        continue
      }
      const text = t.note ? `${t.name}  ${t.note}` : t.name
      if (el.textContent !== text) el.textContent = text
      el.style.display = 'block'
      el.style.color = t.it ? '#9dff8a' : '#f2efe9'
      el.style.opacity = String(Math.max(0, Math.min(1, (FAR - dist) / (FAR - NEAR))))
      const x = (this.v.x * 0.5 + 0.5) * w
      const y = (-this.v.y * 0.5 + 0.5) * h
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
    }
    for (const [vehicle, el] of this.tags) {
      if (seen.has(vehicle)) continue
      el.remove()
      this.tags.delete(vehicle)
    }
  }

  dispose(): void {
    this.root.remove()
    this.tags.clear()
  }
}

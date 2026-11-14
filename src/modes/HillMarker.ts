/**
 * The hill, drawn as two walls of light along the zone's inner and outer edges, fading
 * upward. Unlit, unfogged, two draw calls: visible from across the map for almost nothing.
 * Tinted by state so you can tell from far away whether to go. Plain basic materials with
 * uniform opacity, in stacked bands: an additive TSL version, and versions with an alpha map,
 * vertex alpha, or fog and tone mapping switched off, all came out invisible or white in this
 * renderer setup. Uniform opacity is what reliably draws.
 */
import * as THREE from 'three/webgpu'
import type { HillZone } from '../../shared/protocol'
import type { Game, System } from '../core/Game'

export type HillTint = 'free' | 'mine' | 'theirs' | 'contested'

const TINTS: Record<HillTint, THREE.Color> = {
  free: new THREE.Color(1.0, 0.72, 0.08),
  mine: new THREE.Color(0.1, 1.0, 0.25),
  theirs: new THREE.Color(1.0, 0.12, 0.05),
  contested: new THREE.Color(0.75, 0.15, 1.0),
}
const HEIGHT = 70

/** Stacked bands of falling opacity stand in for a smooth fade upward: [bottom, top, alpha]. */
const BANDS: [number, number, number][] = [[0, 25, 0.8], [25, 50, 0.6], [50, HEIGHT, 0.35]]

export class HillMarker implements System {
  tint: HillTint = 'free'
  private readonly group = new THREE.Group()
  private readonly materials: THREE.MeshBasicMaterial[] = []
  /** Inner and outer walls, each a group of bands. */
  private readonly walls: THREE.Group[] = []
  private time = 0
  private zone: HillZone | null = null

  constructor(private readonly game: Game) {
    for (const [, , alpha] of BANDS) {
      this.materials.push(new THREE.MeshBasicMaterial({
        color: TINTS.free.clone(), transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide,
      }))
    }
    for (let w = 0; w < 2; w++) {
      const wall = new THREE.Group()
      BANDS.forEach(([lo, hi], i) => {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, hi - lo, 96, 1, true), this.materials[i])
        band.position.y = (lo + hi) / 2
        band.frustumCulled = false
        band.renderOrder = 10 + i
        wall.add(band)
      })
      this.walls.push(wall)
      this.group.add(wall)
    }
    this.group.visible = false
    game.scene.add(this.group)
  }

  setZone(zone: HillZone | null): void {
    this.zone = zone
    this.group.visible = Boolean(zone)
    if (!zone) return
    this.group.position.set(zone.x, zone.yMin, zone.z)
    const [inner, outer] = this.walls
    // A disc zone has no inner wall.
    inner.visible = zone.inner > 1
    inner.scale.set(Math.max(zone.inner, 0.01), 1, Math.max(zone.inner, 0.01))
    outer.scale.set(zone.outer, 1, zone.outer)
  }

  get visible(): boolean {
    return this.group.visible
  }

  update(dt: number): void {
    if (!this.zone) return
    this.time += dt
    // Ease between tints so a capture reads as a change, not a flicker; breathe gently.
    const k = Math.min(1, dt * 4)
    const breathe = 0.88 + Math.sin(this.time * 2.2) * 0.12
    this.materials.forEach((m, i) => {
      m.color.lerp(TINTS[this.tint], k)
      m.opacity = BANDS[i][2] * breathe
    })
  }

  dispose(): void {
    this.game.scene.remove(this.group)
  }
}

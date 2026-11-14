/**
 * The hill, drawn as two walls of light along the zone's inner and outer edges, fading
 * upward. Additive, unlit, unfogged, two draw calls: visible from across the map for
 * almost nothing. Tinted by state so you can tell from far away whether to go.
 */
import * as THREE from 'three/webgpu'
import { float, pow, sin, uniform, uv } from 'three/tsl'
import type { HillZone } from '../../shared/protocol'
import type { Game, System } from '../core/Game'

export type HillTint = 'free' | 'mine' | 'theirs' | 'contested'

const TINTS: Record<HillTint, THREE.Color> = {
  free: new THREE.Color(1.0, 0.82, 0.45),
  mine: new THREE.Color(0.35, 1.0, 0.4),
  theirs: new THREE.Color(1.0, 0.28, 0.2),
  contested: new THREE.Color(0.85, 0.35, 1.0),
}
const HEIGHT = 70

export class HillMarker implements System {
  tint: HillTint = 'free'
  private readonly group = new THREE.Group()
  private readonly color = uniform(new THREE.Color().copy(TINTS.free))
  private readonly time = uniform(0)
  private zone: HillZone | null = null
  private readonly target = new THREE.Color()

  constructor(private readonly game: Game) {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    })
    const v = uv().y
    // Bright at the ground, gone at the top, with slow bands rising so it reads as alive.
    const bands = sin(v.mul(18).sub(this.time.mul(1.6))).mul(0.15).add(0.85)
    material.colorNode = this.color
    material.opacityNode = pow(float(1).sub(v), float(2.2)).mul(bands).mul(0.55)
    for (let i = 0; i < 2; i++) {
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, HEIGHT, 96, 1, true), material)
      wall.position.y = HEIGHT / 2
      wall.frustumCulled = false
      wall.renderOrder = 10
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
    const [inner, outer] = this.group.children as THREE.Mesh[]
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
    this.time.value += dt
    // Ease between tints so a capture reads as a change, not a flicker.
    this.target.copy(TINTS[this.tint])
    ;(this.color.value as THREE.Color).lerp(this.target, Math.min(1, dt * 4))
  }

  dispose(): void {
    this.game.scene.remove(this.group)
  }
}

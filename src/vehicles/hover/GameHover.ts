import * as THREE from 'three/webgpu'
import { detailLevel, registerVehicleDetail } from '../skins/mergeStatic'
import { markReducedShowroomDetail } from '../skins/showroom'
import { HoverBody, type HoverSpec } from './HoverBody'
import { HOVER_EYE } from './kit'

/**
 * A generated hovercraft body as the game drives it: the close model with its cockpit, a
 * reduced one from 30 m and a one-draw silhouette from 120 m (PATTERN.md rule 4).
 *
 * All three are built up front. They are generated in a few milliseconds and share nothing
 * with the network, so there is no loading state and no fallback hull. Only one is visible.
 */
export class GameHover {
  readonly object = new THREE.Group()
  readonly levels: [HoverBody, HoverBody, HoverBody]
  /** The driver's eye in the craft's frame. */
  readonly eye = new THREE.Vector3(...HOVER_EYE)
  /** Bounds of the close model in the craft's frame, for the collision hull and clearance guard. */
  readonly bounds = new THREE.Box3()
  private level: 0 | 1 | 2 = 0
  private detachDetail = () => {}
  private attached = false

  constructor(readonly design: HoverSpec) {
    this.levels = [new HoverBody(design, 0, true), new HoverBody(design, 1, true), new HoverBody(design, 2, true)]
    markReducedShowroomDetail(this.levels[1].object)
    this.object.add(...this.levels.map(h => h.object))
    this.object.updateMatrixWorld(true)
    this.bounds.setFromObject(this.levels[0].object)
    this.setLevel(0)
  }

  /** Call after adding `object` to the vehicle, so shading and detail callbacks find their owner. */
  attach(): void {
    if (this.attached) return
    this.attached = true
    this.levels[0].showroom(); this.levels[1].showroom()
    this.detachDetail = registerVehicleDetail(this.object, (distance, remote) => this.setLevel(detailLevel(distance, remote, this.level)))
  }

  setLevel(level: 0 | 1 | 2): void {
    this.level = level
    this.levels.forEach((h, i) => { h.object.visible = i === level })
  }
  get detail(): 0 | 1 | 2 { return this.level }

  /** Steering in -1..1, throttle in 0..1. Only the visible level is touched. */
  update(steer: number, throttle: number, braking: boolean, running = true, dt = 0): void {
    const h = this.levels[this.level]
    if (this.level === 0) { h.setVector(steer * .35); h.fan?.update(dt, throttle, running) }
    if (this.level < 2) { h.setThrottle(throttle, running); h.setLights(true, braking) }
  }

  resetMotion(): void {
    // Geometry and showroom shading share distance hysteresis. Keep their last
    // selections together when this parked model returns near the boundary.
    for (const h of this.levels) {
      h.setVector(0)
      h.setThrottle(0, true)
      h.setLights(true, false)
      h.fan?.reset()
    }
  }

  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    for (const h of this.levels) h.setColors(body, accent)
  }

  dispose(): void {
    this.detachDetail(); this.object.removeFromParent()
    for (const h of this.levels) h.dispose()
  }
}

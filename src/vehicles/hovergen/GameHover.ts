import * as THREE from 'three/webgpu'
import { detailLevel, registerVehicleDetail } from '../skins/mergeStatic'
import { HeritageHover } from './HeritageHover'
import { HERITAGE_EYE, type HeritageDesign } from './heritage'

/**
 * A round two hovercraft study as the game drives it: the close model with its cockpit, a
 * reduced one from 30 m and a one-draw silhouette from 120 m (PATTERN.md rule 4).
 *
 * All three are built up front. They are generated in a few milliseconds and share nothing
 * with the network, so there is no loading state and no fallback hull. Only one is visible.
 */
export class GameHover {
  readonly object = new THREE.Group()
  readonly levels: [HeritageHover, HeritageHover, HeritageHover]
  /** The driver's eye in the craft's frame. */
  readonly eye = new THREE.Vector3(...HERITAGE_EYE)
  /** Bounds of the close model in the craft's frame, for the collision hull and clearance guard. */
  readonly bounds = new THREE.Box3()
  private level: 0 | 1 | 2 = 0
  private detachDetail = () => {}
  private attached = false

  constructor(readonly design: HeritageDesign) {
    this.levels = [new HeritageHover(design, 0, true), new HeritageHover(design, 1, true), new HeritageHover(design, 2, true)]
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
  update(steer: number, throttle: number, braking: boolean): void {
    const h = this.levels[this.level]
    if (this.level === 0) h.setVector(steer * .35)
    if (this.level < 2) { h.setThrottle(throttle); h.setLights(true, braking) }
  }

  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    for (const h of this.levels) h.setColors(body, accent)
  }

  dispose(): void {
    this.detachDetail(); this.object.removeFromParent()
    for (const h of this.levels) h.dispose()
  }
}

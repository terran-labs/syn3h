import * as THREE from 'three/webgpu'
import { JET_DESIGNS } from './designs'
import { NextJet } from './NextJet'
import { buildJetSilhouette } from './JetSilhouette'
import { detailLevel, mergeStatic, registerVehicleDetail } from '../skins/mergeStatic'

/** The approved Mk2: close cockpit model, two gear poses at medium distance, one far outline. */
export class GameJet {
  readonly object = new THREE.Group()
  readonly design = JET_DESIGNS.find(d => d.id === 'hex-mk2')!
  readonly near = new NextJet(this.design, .6)
  readonly medium = [new NextJet(this.design, .1), new NextJet(this.design, .1)]
  readonly far = buildJetSilhouette(this.design)
  private level: 0 | 1 | 2 = 0
  private gear = 0
  private detachDetail = () => {}
  private attached = false

  constructor() {
    this.near.optimize()
    this.object.add(this.near.object, ...this.medium.map(j => j.object), this.far)
    this.medium.forEach((j, i) => {
      j.setGear(i)
      // At 30 m the fixed nozzle lip carries the silhouette; omit its four tiny moving petals.
      j.thruster.removeFromParent()
      if (i === 0) j.gear.removeFromParent()
      mergeStatic(j.object, true)
    })
    this.setLevel(0)
  }

  /** Call after attaching to the vehicle so shading and detail callbacks find their owner. */
  attach(): void {
    if (this.attached) return
    this.attached = true
    this.near.showroom(); this.medium.forEach(j => j.showroom())
    this.detachDetail = registerVehicleDetail(this.object, (distance, remote) => this.setLevel(detailLevel(distance, remote, this.level)))
  }

  setLevel(level: 0 | 1 | 2): void {
    this.level = level
    this.near.object.visible = level === 0
    this.medium.forEach((j, i) => { j.object.visible = level === 1 && i === (this.gear >= .5 ? 1 : 0) })
    this.far.visible = level === 2
  }

  update(gear: number, pitch: number, yaw: number, throttle: number): void {
    this.gear = gear
    this.near.setGear(gear); this.near.setVector(pitch, yaw); this.near.setThrottle(throttle)
    this.medium.forEach(j => j.setThrottle(throttle))
    this.setLevel(this.level)
  }

  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.near.setColors(body, accent); this.medium.forEach(j => j.setColors(body, accent))
    const paint = this.far.material as THREE.MeshStandardMaterial
    paint.color.set(body)
  }

  dispose(): void {
    this.detachDetail(); this.near.dispose(); this.medium.forEach(j => j.dispose())
    this.far.geometry.dispose(); (this.far.material as THREE.Material).dispose()
  }
}

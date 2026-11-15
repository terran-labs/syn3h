import * as THREE from 'three/webgpu'
import { SHIPPED_JET, VANGUARD_EYE } from './shipped'
import { NextJet } from './NextJet'
import { buildJetSilhouette } from './JetSilhouette'
import { detailLevel, mergeStatic, registerVehicleDetail } from '../skins/mergeStatic'

type Level = 0 | 1 | 2

/**
 * The approved Mk2: close cockpit model, two gear poses at medium distance, one far outline.
 *
 * Each level is generated the first time it is shown, not when the jet is created. The player's
 * own jet only ever shows the close model, and a jet that spawns far away may never need it, so
 * building all three up front doubled the spawn cost (about 10 ms against 5 ms, measured warm
 * in Node) and held geometry on the GPU that was never drawn. Hidden levels also do no per-frame
 * work: the close model's gear vertices are only moved while it is the level on screen.
 */
export class GameJet {
  readonly object = new THREE.Group()
  readonly design = SHIPPED_JET
  /** The pilot's eye in the jet's frame. Known without building the close model. */
  readonly eye = new THREE.Vector3(...VANGUARD_EYE)
  private nearModel?: NextJet
  private readonly mediumModels: [NextJet | undefined, NextJet | undefined] = [undefined, undefined]
  private farModel?: THREE.Mesh
  private level: Level = 0
  private gear = 0
  private pitch = 0
  private yaw = 0
  private throttle = 0
  private readonly controls = new THREE.Vector3()
  private body: THREE.ColorRepresentation = this.design.paint
  private accent: THREE.ColorRepresentation = this.design.accent
  private detachDetail = () => {}
  private attached = false

  /** Close model: full cockpit, animated gear and vectoring petals. Built on first use. */
  get near(): NextJet {
    if (!this.nearModel) {
      const jet = this.nearModel = new NextJet(this.design, .6)
      jet.optimize()
      this.adopt(jet)
    }
    return this.nearModel
  }

  /** Medium model in one of two fixed gear poses: 0 is gear up, 1 is gear down. Built on first use. */
  medium(pose: 0 | 1): NextJet {
    let jet = this.mediumModels[pose]
    if (!jet) {
      jet = this.mediumModels[pose] = new NextJet(this.design, .1)
      jet.setGear(pose)
      // At 30 m the fixed nozzle lip carries the silhouette; omit its four tiny moving petals.
      jet.thruster.removeFromParent()
      if (pose === 0) jet.gear.removeFromParent()
      mergeStatic(jet.object, true)
      this.adopt(jet)
    }
    return jet
  }

  /** Far outline: one opaque draw. Built on first use. */
  get far(): THREE.Mesh {
    if (!this.farModel) {
      this.farModel = buildJetSilhouette(this.design)
      ;(this.farModel.material as THREE.MeshStandardMaterial).color.set(this.body)
      this.farModel.visible = false
      this.object.add(this.farModel)
    }
    return this.farModel
  }

  /** Which levels exist so far: close, medium gear up, medium gear down, far. For tests. */
  built(): [boolean, boolean, boolean, boolean] {
    return [!!this.nearModel, !!this.mediumModels[0], !!this.mediumModels[1], !!this.farModel]
  }

  private adopt(jet: NextJet): void {
    jet.object.visible = false
    jet.setColors(this.body, this.accent)
    this.object.add(jet.object)
    if (this.attached) jet.showroom()
  }

  /** Call after attaching to the vehicle so shading and detail callbacks find their owner. */
  attach(): void {
    if (this.attached) return
    this.attached = true
    this.nearModel?.showroom(); this.mediumModels.forEach(j => j?.showroom())
    this.detachDetail = registerVehicleDetail(this.object, (distance, remote) => this.setLevel(detailLevel(distance, remote, this.level)))
  }

  setLevel(level: Level): void {
    this.level = level
    this.show()
  }

  /**
   * @param pitch, yaw nozzle deflection in radians (NextJet.setVector).
   * @param controls stick deflection -1..1 for the tail ring's control surfaces: x pitch (nose up
   *   positive), y roll (right wing down positive), z yaw (nose right positive).
   */
  update(gear: number, pitch: number, yaw: number, throttle: number, controls?: THREE.Vector3): void {
    this.gear = gear; this.pitch = pitch; this.yaw = yaw; this.throttle = throttle
    if (controls) this.controls.copy(controls)
    this.show()
  }

  /** Build the level on screen if needed, bring it up to date and hide the others. */
  private show(): void {
    const pose = this.gear >= .5 ? 1 : 0
    if (this.level === 0) {
      const jet = this.near
      jet.setGear(this.gear); jet.setVector(this.pitch, this.yaw); jet.setThrottle(this.throttle)
      jet.setControls(this.controls.x, this.controls.y, this.controls.z)
    } else if (this.level === 1) this.medium(pose).setThrottle(this.throttle)
    else void this.far
    if (this.nearModel) this.nearModel.object.visible = this.level === 0
    this.mediumModels.forEach((j, i) => { if (j) j.object.visible = this.level === 1 && i === pose })
    if (this.farModel) this.farModel.visible = this.level === 2
  }

  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.body = body; this.accent = accent
    this.nearModel?.setColors(body, accent); this.mediumModels.forEach(j => j?.setColors(body, accent))
    if (this.farModel) (this.farModel.material as THREE.MeshStandardMaterial).color.set(body)
  }

  dispose(): void {
    this.detachDetail(); this.nearModel?.dispose(); this.mediumModels.forEach(j => j?.dispose())
    if (this.farModel) { this.farModel.geometry.dispose(); (this.farModel.material as THREE.Material).dispose() }
  }
}

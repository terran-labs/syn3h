import * as THREE from 'three/webgpu'
import { MK2_FITTINGS, SHIPPED_JET, VANGUARD_EYE } from './shipped'
import { JetPlume } from './JetPlume'
import { JetTailLights } from './JetTailLights'
import { NextJet } from './NextJet'
import { buildJetSilhouette } from './JetSilhouette'
import { detailLevel, registerVehicleDetail } from '../skins/mergeStatic'
import { markReducedShowroomDetail } from '../skins/showroom'
import { jetScale } from './size'
import { defineParam } from '../../../shared/params'

/**
 * How far the moving parts swing at full stick, as a multiple of the original's 20 degrees
 * (VhiclJet.cs 161): the tail ring's control surfaces, the main thruster's petals and the boom
 * thrusters' collars. Visual only; the forces are the original's whatever this is. Above 1 the
 * look exceeds the physical vector, so it reads at chase-camera distance.
 */
export const jetArticulation = defineParam<number>({ id: 'jet.articulation', label: 'Thruster and vane movement (look)', group: 'Jet', scope: 'client', default: 1.5, min: 0, max: 2, step: .05 })
/** 20 degrees, the original's nozzle limit, in radians. */
const FULL_TRAVEL = .35

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
  /** Uniform scale from the design to jet.length (./size.ts), applied to the whole model. */
  readonly size = jetScale()
  /** The pilot's eye in the jet's frame, at this size. Known without building the close model. */
  readonly eye = new THREE.Vector3(...VANGUARD_EYE).multiplyScalar(this.size)
  /** Thrust cones behind the nozzles and under the hover ports: one draw, shown at every level. */
  readonly plume = new JetPlume(MK2_FITTINGS)
  readonly tailLights = new JetTailLights()
  private nearModel?: NextJet
  private readonly mediumModels: [NextJet | undefined, NextJet | undefined] = [undefined, undefined]
  private farModel?: ReturnType<typeof buildJetSilhouette>
  private level: Level = 0
  private gear = 0
  private throttle = 0
  private readonly controls = new THREE.Vector3()
  private body: THREE.ColorRepresentation = this.design.paint
  private accent: THREE.ColorRepresentation = this.design.accent
  private detachDetail = () => {}
  private attached = false

  constructor() { this.object.scale.setScalar(this.size); this.plume.setColor(this.accent); this.object.add(this.plume.mesh, this.tailLights.mesh) }

  /** Close model: full cockpit, animated gear and vectoring petals. Built on first use. */
  get near(): NextJet {
    if (!this.nearModel) {
      const jet = this.nearModel = new NextJet(this.design, .6, { glow: false })
      jet.optimize()
      this.adopt(jet)
    }
    return this.nearModel
  }

  /** Medium model in one of two fixed gear poses: 0 is gear up, 1 is gear down. Built on first use. */
  medium(pose: 0 | 1): NextJet {
    let jet = this.mediumModels[pose]
    if (!jet) {
      // The control surfaces, petals and boom collars still move at this distance (the owner: they
      // must show at normal play distance, which is often this level for other players' jets).
      // They cost two draws: the surfaces in one, the petals and collars in another. Neither
      // casts a shadow: the body's shadow carries the shape at 30 m and beyond, and the parts'
      // own would be two more draws per jet in the shadow pass.
      jet = this.mediumModels[pose] = new NextJet(this.design, .1, { flaps: true, glow: false })
      jet.setGear(pose)
      if (pose === 0) jet.gear.removeFromParent()
      jet.optimize({ staticGear: true })
      for (const mesh of jet.movingParts()) mesh.castShadow = false
      markReducedShowroomDetail(jet.object)
      this.adopt(jet)
    }
    return jet
  }

  /** Far outline: one opaque draw. Built on first use. */
  get far(): ReturnType<typeof buildJetSilhouette> {
    if (!this.farModel) {
      this.farModel = buildJetSilhouette()
      this.farModel.material.color.set(this.body)
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
   * @param controls stick deflection -1..1 that every moving part follows: x pitch (nose up
   *   positive), y roll (right wing down positive), z yaw (nose right positive).
   * @param hover whether the belly ports carry the jet (their plumes show) or the rear nozzles do.
   */
  update(gear: number, throttle: number, controls?: THREE.Vector3, hover = gear >= .5): void {
    this.gear = gear; this.throttle = throttle
    if (controls) this.controls.copy(controls)
    this.plume.set(throttle, hover)
    this.show()
  }

  /** Reset the parked model before its next arrival, including an already built hidden close model. */
  resetPose(): void {
    this.gear = this.throttle = 0
    this.controls.set(0, 0, 0)
    this.plume.set(0, true)
    this.plume.mesh.visible = true
    if (this.nearModel && this.level !== 0) this.poseNear(this.nearModel)
    if (this.level !== 0 || this.nearModel) this.show()
  }

  private poseNear(jet: NextJet): void {
    jet.setGear(this.gear); jet.setThrottle(this.throttle)
    this.articulate(jet)
  }

  /**
   * Every moving part from the stick: nose up turns the exhausts up and the ring's trailing
   * edges up, a roll to the right tips the right collar's exhaust up and the left one's down,
   * nose right turns the exhausts to the right. Signed as NextJet.setVector and setControls.
   */
  private articulate(jet: NextJet): void {
    const travel = FULL_TRAVEL * jetArticulation.value, c = this.controls
    jet.setVector(c.x * travel, c.z * travel, c.y * travel, travel)
    this.plume.setVector(jet.vector.x, jet.vector.y, c.y * travel)
    jet.setControls(c.x, c.y, c.z, travel)
  }

  /** Build the level on screen if needed, bring it up to date and hide the others. */
  private show(): void {
    const pose = this.gear >= .5 ? 1 : 0
    if (this.level === 0) this.poseNear(this.near)
    else if (this.level === 1) { const jet = this.medium(pose); jet.setThrottle(this.throttle); this.articulate(jet) }
    else void this.far
    if (this.nearModel) this.nearModel.object.visible = this.level === 0
    this.mediumModels.forEach((j, i) => { if (j) j.object.visible = this.level === 1 && i === pose })
    if (this.farModel) this.farModel.visible = this.level === 2
  }

  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.body = body; this.accent = accent
    this.plume.setColor(accent)
    this.nearModel?.setColors(body, accent); this.mediumModels.forEach(j => j?.setColors(body, accent))
    if (this.farModel) this.farModel.material.color.set(body)
  }

  dispose(): void {
    this.tailLights.dispose(); this.plume.dispose(); this.detachDetail(); this.nearModel?.dispose(); this.mediumModels.forEach(j => j?.dispose())
    this.farModel?.material.dispose()
  }
}

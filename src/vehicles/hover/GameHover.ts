import * as THREE from 'three/webgpu'
import { detailLevel, registerVehicleDetail } from '../skins/mergeStatic'
import { markReducedShowroomDetail } from '../skins/showroom'
import { HoverBody, type HoverSpec } from './HoverBody'
import { HOVER_EYE } from './kit'
import { JetPlume, createPlumeGeometry, shareable } from '../jetgen/JetPlume'
import { defineParam } from '../../../shared/params'

/**
 * The hovercraft's exhaust, on the one thruster shader every vehicle shares (jetgen/JetPlume.ts):
 * its own look through parameters, no second program. The lift is a ringed maglev glow under
 * each port, rings of light travelling down toward the ground and fading, cool and steady,
 * brighter with lift effort and closer to the ground. The rear thrust is a soft short plume.
 */
export const hoverGlowHue = defineParam<number>({ id: 'hover.glowHue', label: 'Lift and thrust glow colour (hue)', group: 'Hovercraft', scope: 'world', default: 190, min: 0, max: 360, step: 1 })
export const hoverGlowStrength = defineParam<number>({ id: 'hover.glowStrength', label: 'Lift and thrust glow strength', group: 'Hovercraft', scope: 'world', default: 1, min: 0, max: 3, step: .05 })
export const hoverRingSpeed = defineParam<number>({ id: 'hover.ringSpeed', label: 'Lift rings travelling down (per second)', group: 'Hovercraft', scope: 'world', default: 1.2, min: 0, max: 4, step: .05 })
/** Shape of the lift glow: in port radii long (scaled by clearance each frame), and the rear plume. */
const HOVER_SHAPE = { main: 4, port: 7, ports: 'frustum' as const }
/** Length of a lift glow at length 1, metres (HOVER_SHAPE.port lift-port radii of .15 m). */
const RING_REACH = HOVER_SHAPE.port * .15
const plumeGeometry = new Map<string, THREE.BufferGeometry>()

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
  /** The exhaust: one draw on the shared thruster program, shown at every level. */
  readonly plume: JetPlume

  constructor(readonly design: HoverSpec) {
    this.levels = [new HoverBody(design, 0, true), new HoverBody(design, 1, true), new HoverBody(design, 2, true)]
    markReducedShowroomDetail(this.levels[1].object)
    this.object.add(...this.levels.map(h => h.object))
    // Cones from the close model's own rear duct and lift ports, made once per design.
    const close = this.levels[0], t = close.thruster.position
    const fittings = { nozzles: [{ x: 0, y: t.y, z: t.z + .1, r: .37, ry: .12 }], ports: close.ports.map(([x, y, z]) => ({ x, y, z, r: .15 })) }
    let geometry = plumeGeometry.get(design.id)
    if (!geometry) { geometry = createPlumeGeometry(fittings, HOVER_SHAPE); shareable.add(geometry); plumeGeometry.set(design.id, geometry) }
    this.plume = new JetPlume(fittings, geometry)
    this.plume.mesh.name = 'hover-thrust'
    this.object.add(this.plume.mesh)
    this.exhaust(0, 0, RING_REACH)
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

  /**
   * The exhaust's look and levels. Lift effort grows with throttle; the rings reach the ground
   * (`ground`, metres below the hull) and brighten as it comes closer. A craft that is not
   * running shows nothing.
   */
  private exhaust(throttle: number, running: number, ground: number): void {
    const strength = hoverGlowStrength.value * running
    this.plume.setLook({ hue: hoverGlowHue.value, length: 1, brightness: 1, heat: .08, diamonds: 0, pinch: 0, sheath: .6, flicker: .15, portRings: 3.5, portSpeed: hoverRingSpeed.value, portSolid: .12, portSharp: 10 })
    // The rings run down to the ground, and brighten as it comes within a metre or two.
    const near = Math.max(0, Math.min(1, 1 - (ground - 1) / 3))
    const reach = Math.max(.35, Math.min(3, ground / RING_REACH))
    this.plume.setLevels(.35 + .55 * throttle, (.25 + .9 * throttle) * strength, reach, (.35 + .35 * throttle) * (.5 + .5 * near) * strength)
  }

  /**
   * Steering in -1..1, throttle in 0..1, and the hull's height above the ground in metres.
   * Only the visible level is touched.
   */
  update(steer: number, throttle: number, braking: boolean, running = true, dt = 0, ground = RING_REACH): void {
    this.exhaust(throttle, running ? 1 : 0, ground)
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
    this.plume.dispose()
  }
}

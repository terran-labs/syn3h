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
/**
 * Lift glow layouts, while the owner chooses (hover.liftLayout): 0 a column of bands at each
 * port; 1 thin separate rings at each port, spreading like ripples to about three times the
 * port's width and fading out before the ground; 2 one ring set under the whole hull. Each is
 * a mesh and a set of parameters on the same thruster program.
 */
export const hoverLiftLayout = defineParam<number>({ id: 'hover.liftLayout', label: 'Lift glow layout (0 columns, 1 ripples, 2 one under the hull)', group: 'Hovercraft', scope: 'world', default: 1, min: 0, max: 2, step: 1 })
const LAYOUTS = [
  { shape: { main: 4, port: 7, ports: 'frustum' as const, portWidth: [.7, 1.6] as const }, rings: 3.5, solid: .12, sharp: 10, reach: 1, hull: false },
  { shape: { main: 4, port: 7, ports: 'frustum' as const, portWidth: [1.1, 3] as const }, rings: 3, solid: 0, sharp: 30, reach: .85, hull: false },
  { shape: { main: 4, port: 2.2, ports: 'frustum' as const, portWidth: [.85, 1.9] as const }, rings: 3.5, solid: 0, sharp: 30, reach: .85, hull: true },
]
/** Lift-port radius on the Lowwing, metres; the hull-wide set's radius. */
const PORT_R = .15, HULL_R = .95
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
  private readonly rear: { x: number; y: number; z: number; r: number; ry: number }
  private readonly liftPorts: { x: number; y: number; z: number; r: number }[]
  private shownLayout = -1

  private layout(): number { return Math.max(0, Math.min(LAYOUTS.length - 1, Math.round(hoverLiftLayout.value))) }

  /** The cones for a lift layout: the four ports, or one set centred under the hull. */
  private geometry(layout: number): THREE.BufferGeometry {
    const key = `${this.design.id}:${layout}`
    let geometry = plumeGeometry.get(key)
    if (!geometry) {
      const l = LAYOUTS[layout], p = this.liftPorts
      const ports = l.hull ? [{ x: 0, y: Math.min(...p.map(q => q.y)), z: p.reduce((a, q) => a + q.z, 0) / p.length, r: HULL_R }] : p
      geometry = createPlumeGeometry({ nozzles: [this.rear], ports }, l.shape); shareable.add(geometry); plumeGeometry.set(key, geometry)
    }
    this.shownLayout = layout
    return geometry
  }

  constructor(readonly design: HoverSpec) {
    this.levels = [new HoverBody(design, 0, true), new HoverBody(design, 1, true), new HoverBody(design, 2, true)]
    markReducedShowroomDetail(this.levels[1].object)
    this.object.add(...this.levels.map(h => h.object))
    // Cones from the close model's own rear duct and lift ports, made once per design and layout.
    const close = this.levels[0], t = close.thruster.position
    this.rear = { x: 0, y: t.y, z: t.z + .1, r: .37, ry: .12 }
    this.liftPorts = close.ports.map(([x, y, z]) => ({ x, y, z, r: PORT_R }))
    this.plume = new JetPlume({ nozzles: [this.rear], ports: this.liftPorts }, this.geometry(this.layout()))
    this.plume.mesh.name = 'hover-thrust'
    this.object.add(this.plume.mesh)
    this.exhaust(0, 0, 2.5)
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
    const layout = this.layout(), l = LAYOUTS[layout]
    if (layout !== this.shownLayout) this.plume.mesh.geometry = this.geometry(layout)
    const strength = hoverGlowStrength.value * running
    this.plume.setLook({ hue: hoverGlowHue.value, length: 1, brightness: 1, heat: .08, diamonds: 0, pinch: 0, sheath: .6, flicker: .15, portRings: l.rings, portSpeed: hoverRingSpeed.value, portSolid: l.solid, portSharp: l.sharp })
    // The rings run down toward the ground (all the way, or fading out short of it), and
    // brighten as it comes within a metre or two.
    const near = Math.max(0, Math.min(1, 1 - (ground - 1) / 3))
    const designed = l.shape.port * (l.hull ? HULL_R : PORT_R)
    const reach = Math.max(.35, Math.min(3, ground * l.reach / designed))
    this.plume.setLevels(.35 + .55 * throttle, (.25 + .9 * throttle) * strength, reach, (.35 + .35 * throttle) * (.5 + .5 * near) * strength)
  }

  /**
   * Steering in -1..1, throttle in 0..1, and the hull's height above the ground in metres.
   * Only the visible level is touched.
   */
  update(steer: number, throttle: number, braking: boolean, running = true, dt = 0, ground = 2.5): void {
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

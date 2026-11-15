import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Builder, GROUND_Y, type Leg, type Mat } from './shapes'
import type { JetDesign } from './designs'
import { applyShowroom, setRole } from '../skins/showroom'
import { addNightReadability } from '../skins/nightReadability'
import { addLavaGlow } from '../skins/lavaGlow'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const ease = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t) }

interface BuiltLeg { spec: Leg; pivot: THREE.Group; piston: THREE.Group; foot: THREE.Group; doors: { group: THREE.Group; axis: 'x' | 'z'; sign: number }[]; upper: number; travel: number }

/**
 * One generated jet: five merged meshes (paint, chrome, glass, dark, glow) plus three
 * landing gear legs that fold out of the hull behind doors.
 */
export class NextJet {
  readonly object = new THREE.Group()
  /** Rear nozzle positions and hover port positions, for exhaust and dust effects. */
  readonly nozzles: Builder['nozzles']
  readonly hover: Builder['hover']
  readonly gear = new THREE.Group()
  readonly materials: Record<Mat, THREE.Material>
  private readonly paint: THREE.MeshStandardMaterial
  private readonly canopy: THREE.MeshStandardMaterial
  private readonly accent: THREE.MeshStandardMaterial
  private detachShowroom?: () => void
  private readonly glow: THREE.MeshBasicMaterial
  private readonly legs: BuiltLeg[] = []
  private readonly geometries: THREE.BufferGeometry[] = []
  gearAmount = 0
  /** The pilot's eye, for the ride camera. Present when the design has a real cockpit. */
  ridePosition?: THREE.Object3D
  /** Metres from the eye to the nearest canopy or tub surface. */
  clearance = Infinity
  /** Sits at the main thruster's exit and holds its four vectoring vanes. */
  readonly thruster = new THREE.Group()
  /** Current deflection: x is pitch, y is yaw, in radians. */
  readonly vector = new THREE.Vector2()
  private petal?: THREE.MeshStandardMaterial
  private readonly vanes: { group: THREE.Group; axis: 'x' | 'y'; sign: number }[] = []

  /** @param detail 1 is full detail, lower values cut the triangle count (see Builder). */
  constructor(readonly design: JetDesign, readonly detail = 1) {
    // The vehicle pattern (src/vehicles/PATTERN.md): no look is authored here. Each surface is
    // tagged with a role and the shared showroom shading builds the scales, clear coat, flakes,
    // canopy, night fill and lava glow, the same as on every other vehicle. The plain numbers
    // below are only what shading tier 0 shows.
    this.paint = setRole(new THREE.MeshStandardMaterial({ color: design.paint, metalness: .8, roughness: .3 }), 'paint')
    this.accent = setRole(new THREE.MeshStandardMaterial({ color: design.accent, metalness: .85, roughness: .26 }), 'accent')
    // 'glass' until the shared 'canopy' role reaches trunk; the force field takes the accent colour.
    this.canopy = setRole(new THREE.MeshStandardMaterial({ color: design.accent, metalness: .65, roughness: .18 }), 'glass')
    this.canopy.name = 'Cockpit'; this.canopy.userData.separate = true
    // Additive glow for the nozzle throats and hover ports; becomes the shared 'glow' role when it lands.
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(design.accent).multiplyScalar(1.3), transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })
    this.materials = {
      paint: this.paint,
      // Faceted wings and fins carry flat normals in their geometry, so they share the paint.
      panel: this.paint,
      accent: this.accent,
      chrome: setRole(new THREE.MeshStandardMaterial({ color: 0xe9edf2, metalness: 1, roughness: .14 }), 'chrome'),
      glass: this.canopy,
      // Matte dark surfaces: intake mouths, nozzle walls, gear skids. Trim keeps its own numbers.
      dark: setRole(new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: .4, roughness: .55 }), 'trim'),
      glow: this.glow,
      // Cockpit interior: matte, dark, its own numbers as the trim role allows.
      trim: setRole(new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: .15, roughness: .8 }), 'trim'),
    }
    const b = new Builder(detail, design.hard ?? false); design.build(b)
    const pieces = b.pieces
    this.nozzles = b.nozzles; this.hover = b.hover
    if (b.eye) { this.ridePosition = new THREE.Object3D(); this.ridePosition.position.set(...b.eye); this.object.add(this.ridePosition); this.clearance = b.cockpitClearance() }
    for (const mat of Object.keys(this.materials) as Mat[]) {
      const parts = pieces.filter(p => p.mat === mat).map(p => p.geometry); if (!parts.length) continue
      const merged = this.merge(parts)
      const mesh = new THREE.Mesh(merged, this.materials[mat]); mesh.name = `jet-${mat}`; mesh.castShadow = mat !== 'glow'; mesh.receiveShadow = mat !== 'glow'
      this.object.add(mesh)
    }
    if (b.gimbal) {
      // Thrust vectoring: the barrel is fixed. Four curved petals continue its lip and narrow
      // toward the exit; the top and bottom pair hinge for pitch, the side pair for yaw.
      const { y, z, halfWidth, halfHeight } = b.gimbal, length = .34, arc = 82 * Math.PI / 180
      this.thruster.position.set(0, y, z); this.object.add(this.thruster)
      this.petal = (this.materials.chrome as THREE.MeshStandardMaterial).clone(); this.petal.side = THREE.DoubleSide
      const petal = (centre: number, px: number, py: number, axis: 'x' | 'y') => {
        const group = new THREE.Group(); group.position.set(px, py, 0); this.thruster.add(group)
        // A slice of a cone, opened out along +Z from the lip and shaped to the nozzle's outline.
        const g = this.own(new THREE.CylinderGeometry(.78, 1, length, Math.max(4, Math.round(10 * this.detail)), 1, true, centre - arc / 2, arc))
        g.rotateX(Math.PI / 2); g.translate(0, 0, length / 2); g.scale(halfWidth, halfHeight, 1); g.translate(-px, -py, 0)
        const mesh = new THREE.Mesh(g, this.petal); mesh.castShadow = true; group.add(mesh)
        this.vanes.push({ group, axis, sign: 0 })
      }
      petal(Math.PI, 0, halfHeight, 'x'); petal(0, 0, -halfHeight, 'x'); petal(Math.PI / 2, halfWidth, 0, 'y'); petal(Math.PI * 1.5, -halfWidth, 0, 'y')
      this.setVector(0, 0)
    }
    this.object.add(this.gear)
    b.legs.forEach(l => this.legs.push(this.buildLeg(l)))
    this.setGear(0)
  }

  private own<T extends THREE.BufferGeometry>(g: T): T { this.geometries.push(g); return g }

  /** One geometry per material. Faceted parts are unindexed, so a mixed set is unindexed whole. */
  private merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const mixed = parts.some(g => !g.index) && parts.some(g => g.index)
    const list = mixed ? parts.map(g => g.index ? g.toNonIndexed() : g) : parts
    const merged = mergeGeometries(list); new Set([...parts, ...list]).forEach(g => g.dispose())
    return this.own(merged)
  }

  /**
   * Hand the materials to the shared showroom shading. Call once the jet is in a scene. Until
   * then, and at shading tier 0, the plain tagged materials show.
   */
  showroom(): void {
    this.detachShowroom ??= applyShowroom(this.object, root => { addNightReadability(root); addLavaGlow(root) })
  }

  private buildLeg(spec: Leg): BuiltLeg {
    const [hx, hy, hz] = spec.hinge, total = hy - (GROUND_Y + .042), upper = total * .62, travel = total - upper
    const { paint, chrome, dark } = this.materials
    const pivot = new THREE.Group(); pivot.position.set(hx, hy, hz); this.gear.add(pivot)
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => { const o = new THREE.Mesh(this.own(g), m); o.castShadow = true; parent.add(o); return o }
    // Faired upper strut, a knuckle at the hinge and a drag brace.
    mesh(new THREE.CylinderGeometry(.07, .055, upper, 14).translate(0, -upper / 2, 0), paint, pivot).scale.set(1, 1, 1.5)
    mesh(new THREE.SphereGeometry(.085, 14, 10), chrome, pivot)
    const brace = mesh(new THREE.CylinderGeometry(.018, .018, upper * .8, 8).translate(0, -upper * .4, 0), chrome, pivot)
    const along = spec.fold === 'in' ? 'x' : 'z', back = spec.fold === 'fore' ? -1 : spec.fold === 'aft' ? 1 : -Math.sign(hx)
    brace.position[along] = back * upper * .42; brace.rotation[along === 'x' ? 'z' : 'x'] = (along === 'x' ? -1 : 1) * back * .55
    // Chrome oleo that telescopes out of the strut, carrying a skid that stays level.
    const piston = new THREE.Group(); pivot.add(piston)
    mesh(new THREE.CylinderGeometry(.03, .03, travel + .06, 12).translate(0, -(travel - .06) / 2, 0), chrome, piston)
    const foot = new THREE.Group(); foot.position.y = -travel; piston.add(foot)
    const skid = mesh(new THREE.CapsuleGeometry(.06, .34, 6, 14).rotateX(Math.PI / 2), dark, foot); skid.scale.set(1.7, .7, 1)
    mesh(new THREE.SphereGeometry(.05, 12, 8), chrome, foot).position.y = .03
    // Two doors that open like a clamshell along the stowed strut.
    const doors: BuiltLeg['doors'] = [], length = upper + .3, half = .15
    for (const side of [1, -1]) {
      const group = new THREE.Group(); this.gear.add(group)
      if (along === 'z') {
        group.position.set(hx + side * half, hy - .1, hz + back * (length / 2 - .12))
        mesh(new THREE.BoxGeometry(half, .016, length).translate(-side * half / 2, 0, 0), paint, group)
        doors.push({ group, axis: 'z', sign: side })
      } else {
        group.position.set(hx + back * (length / 2 - .12), hy - .1, hz + side * half)
        mesh(new THREE.BoxGeometry(length, .016, half).translate(0, 0, -side * half / 2), paint, group)
        doors.push({ group, axis: 'x', sign: -side })
      }
    }
    return { spec, pivot, piston, foot, doors, upper, travel }
  }

  /** 0 is stowed and hidden, 1 is down and locked: doors open, strut swings, oleo extends. */
  setGear(amount: number): void {
    const g = this.gearAmount = clamp01(amount)
    this.gear.visible = g > .001
    const open = ease(g / .3), swing = ease((g - .12) / .6), extend = ease((g - .6) / .4)
    for (const l of this.legs) {
      const axis = l.spec.fold === 'in' ? 'z' : 'x'
      const stowed = l.spec.fold === 'aft' ? -1.62 : l.spec.fold === 'fore' ? 1.62 : -Math.sign(l.spec.hinge[0]) * 1.62
      const angle = stowed * (1 - swing)
      l.pivot.rotation[axis] = angle; l.foot.rotation[axis] = -angle
      l.piston.position.y = -l.upper + (1 - extend) * l.travel
      for (const d of l.doors) d.group.rotation[d.axis] = d.sign * 1.5 * open
    }
  }

  /** Lowest point of each foot in the jet's frame, for tests and for placing a collider. */
  footHeights(): number[] {
    this.object.updateMatrixWorld(true)
    const inverse = new THREE.Matrix4().copy(this.object.matrixWorld).invert()
    return this.legs.map(l => l.foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).y - .042)
  }

  /**
   * Vector the main thruster, in radians, limited to 20 degrees as in VhiclJet.cs 161.
   * Positive pitch turns the exhaust up, positive yaw turns it to the right seen from behind.
   * The top and bottom petals move together for pitch and the side petals for yaw.
   */
  setVector(pitch: number, yaw: number): void {
    const limit = .35, toe = 0
    this.vector.x = Math.min(limit, Math.max(-limit, pitch)); this.vector.y = Math.min(limit, Math.max(-limit, yaw))
    for (const v of this.vanes) {
      if (v.axis === 'x') v.group.rotation.x = -this.vector.x + v.sign * toe
      else v.group.rotation.y = this.vector.y + v.sign * toe
    }
  }

  /** Triangles in the whole model, landing gear included. */
  triangles(): number {
    let count = 0
    this.object.traverse(o => { if (o instanceof THREE.Mesh) { const g = o.geometry as THREE.BufferGeometry; count += (g.index ? g.index.count : g.getAttribute('position').count) / 3 } })
    return Math.round(count)
  }

  /** Glow strength for the nozzles and hover ports, 0..1. */
  setThrottle(amount: number): void { this.glow.opacity = .2 + .6 * clamp01(amount) }

  setColors(paint: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.paint.color.set(paint); this.accent.color.set(accent); this.canopy.color.set(accent); this.glow.color.set(accent).multiplyScalar(1.3)
  }

  dispose(): void {
    this.detachShowroom?.()
    this.geometries.forEach(g => g.dispose())
    new Set(Object.values(this.materials)).forEach(m => m.dispose()); this.petal?.dispose()
  }
}

import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Builder, GROUND_Y, type Leg, type Mat } from './shapes'
import type { JetDesign } from './designs'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const ease = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t) }

/** Metal flake for the candy paint: a tiny generated noise tile, no image file. */
function flakeTexture(seed: number): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4); let s = seed >>> 0 || 1
  for (let i = 0; i < size * size; i++) { s = (s * 1664525 + 1013904223) >>> 0; const v = 96 + (s >>> 24) * .6; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255 }
  const t = new THREE.DataTexture(data, size, size); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(48, 110)
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true
  return t
}

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
  private readonly flake: THREE.DataTexture
  readonly materials: Record<Mat, THREE.Material>
  private readonly paint: THREE.MeshPhysicalMaterial
  private readonly glow: THREE.MeshBasicMaterial
  private readonly legs: BuiltLeg[] = []
  private readonly geometries: THREE.BufferGeometry[] = []
  gearAmount = 0
  /** The main nozzle. It swivels about its pivot to vector the thrust. */
  readonly thruster = new THREE.Group()

  /** @param detail 1 is full detail, lower values cut the triangle count (see Builder). */
  constructor(readonly design: JetDesign, readonly detail = 1) {
    const military = design.finish === 'military'
    this.flake = flakeTexture(design.paint)
    this.paint = military
      ? new THREE.MeshPhysicalMaterial({ color: design.paint, metalness: .55, roughness: .5, clearcoat: .25, clearcoatRoughness: .4, flatShading: true })
      : new THREE.MeshPhysicalMaterial({ color: design.paint, metalness: .78, roughness: .28, clearcoat: 1, clearcoatRoughness: .04, bumpMap: this.flake, bumpScale: .35 })
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(design.accent).multiplyScalar(1.3), transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })
    this.materials = {
      paint: this.paint,
      chrome: military ? new THREE.MeshPhysicalMaterial({ color: 0x7d858f, metalness: 1, roughness: .32, flatShading: true }) : new THREE.MeshPhysicalMaterial({ color: 0xe9edf2, metalness: 1, roughness: .07 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: .7, roughness: .04, clearcoat: 1, clearcoatRoughness: .02 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: .4, roughness: .55 }),
      glow: this.glow,
      // Squadron colour on tips and fins, where the candy designs carry chrome.
      accent: new THREE.MeshStandardMaterial({ color: design.accent, metalness: .2, roughness: .55, flatShading: military }),
    }
    const b = new Builder(detail, design.hard ?? false); design.build(b)
    this.nozzles = b.nozzles; this.hover = b.hover
    for (const mat of Object.keys(this.materials) as Mat[]) {
      const parts = b.pieces.filter(p => p.mat === mat).map(p => p.geometry); if (!parts.length) continue
      const merged = mergeGeometries(parts); parts.forEach(g => g.dispose()); this.geometries.push(merged)
      const mesh = new THREE.Mesh(merged, this.materials[mat]); mesh.name = `jet-${mat}`; mesh.castShadow = mat !== 'glow'; mesh.receiveShadow = mat !== 'glow'
      this.object.add(mesh)
    }
    if (b.gimbal) {
      this.thruster.position.set(0, b.gimbal.y, b.gimbal.z); this.object.add(this.thruster)
      for (const mat of Object.keys(this.materials) as Mat[]) {
        const parts = b.gimbalPieces.filter(p => p.mat === mat).map(p => p.geometry); if (!parts.length) continue
        const merged = mergeGeometries(parts); parts.forEach(g => g.dispose()); this.geometries.push(merged)
        const mesh = new THREE.Mesh(merged, this.materials[mat]); mesh.name = `jet-thruster-${mat}`; mesh.castShadow = mat !== 'glow'; this.thruster.add(mesh)
      }
    }
    this.object.add(this.gear)
    b.legs.forEach(l => this.legs.push(this.buildLeg(l)))
    this.setGear(0)
  }

  private own<T extends THREE.BufferGeometry>(g: T): T { this.geometries.push(g); return g }

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
   * Swivel the main nozzle, in radians. Positive pitch turns the exhaust up and positive yaw
   * turns it to the right, as seen from behind. Jet.ts can instead copy its thrust rotation
   * straight onto `thruster.quaternion`.
   */
  setVector(pitch: number, yaw: number): void { this.thruster.rotation.set(pitch, -yaw, 0, 'YXZ') }

  /** Triangles in the whole model, landing gear included. */
  triangles(): number {
    let count = 0
    this.object.traverse(o => { if (o instanceof THREE.Mesh) { const g = o.geometry as THREE.BufferGeometry; count += (g.index ? g.index.count : g.getAttribute('position').count) / 3 } })
    return Math.round(count)
  }

  /** Glow strength for the nozzles and hover ports, 0..1. */
  setThrottle(amount: number): void { this.glow.opacity = .2 + .6 * clamp01(amount) }

  setColors(paint: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.paint.color.set(paint); this.glow.color.set(accent).multiplyScalar(1.3)
  }

  dispose(): void {
    this.geometries.forEach(g => g.dispose()); this.flake.dispose()
    Object.values(this.materials).forEach(m => m.dispose())
  }
}

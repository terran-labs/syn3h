import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Builder, type Mat } from '../jetgen/shapes'
import type { HoverDesign } from './designs'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Lamp emissive strengths, matching the vehicle lab's (and the buggy skin's) under ACES. */
const LAMP = { headOn: 3, headOff: 0, tailOn: .6, brake: 1.5, tailOff: .04 }

/**
 * One generated hovercraft: a merged mesh per material (paint, chrome, glass, dark, glow,
 * accent), the swivelling main thruster as its own group, and lamps. Built from a HoverDesign
 * with the jet lane's Builder, as NextJet is, without the landing gear.
 */
export class NextHover {
  readonly object = new THREE.Group()
  /** Rear nozzle positions and lift port positions, for exhaust and dust effects. */
  readonly nozzles: Builder['nozzles']
  readonly ports: Builder['hover']
  /** The main thruster. It swivels about its pivot to steer. */
  readonly thruster = new THREE.Group()
  readonly materials: Record<Mat, THREE.Material>
  private readonly paint: THREE.MeshPhysicalMaterial
  private readonly accent: THREE.MeshStandardMaterial
  private readonly glow: THREE.MeshBasicMaterial
  private readonly head: THREE.MeshStandardMaterial
  private readonly tail: THREE.MeshStandardMaterial
  private readonly geometries: THREE.BufferGeometry[] = []

  /** @param detail 1 is full detail, lower values cut the triangle count (see Builder). */
  constructor(readonly design: HoverDesign, readonly detail = 1) {
    const finish = design.finish ?? 'candy', military = finish === 'military', aerospace = finish === 'aerospace'
    this.paint = military
      ? new THREE.MeshPhysicalMaterial({ color: design.paint, metalness: .55, roughness: .5, clearcoat: .25, clearcoatRoughness: .4, flatShading: true })
      : new THREE.MeshPhysicalMaterial({ color: design.paint, metalness: aerospace ? .25 : .78, roughness: aerospace ? .34 : .28, clearcoat: 1, clearcoatRoughness: .04 })
    // Squadron colour (military), foil or stripe (aerospace), trim (candy).
    this.accent = new THREE.MeshStandardMaterial({ color: design.accent, metalness: aerospace ? .9 : .2, roughness: aerospace ? .36 : .55, flatShading: military })
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(design.accent).multiplyScalar(1.3), transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })
    this.materials = {
      paint: this.paint,
      chrome: military ? new THREE.MeshPhysicalMaterial({ color: 0x7d858f, metalness: 1, roughness: .32, flatShading: true })
        // Satin alloy for the aerospace finish, as the tank studies: NASA hardware, not jewellery.
        : aerospace ? new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 1, roughness: .3 })
        : new THREE.MeshPhysicalMaterial({ color: 0xe9edf2, metalness: 1, roughness: .07 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: .7, roughness: .04, clearcoat: 1, clearcoatRoughness: .02 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: .4, roughness: .55, flatShading: military }),
      glow: this.glow,
      accent: this.accent,
    }
    this.head = new THREE.MeshStandardMaterial({ color: 0xd8dde4, emissive: 0xf2f6ff, emissiveIntensity: LAMP.headOff, metalness: 0, roughness: .15 })
    this.tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0000, emissiveIntensity: LAMP.tailOff, metalness: 0, roughness: .15 })

    const b = new Builder(detail, design.hard ?? false); design.build(b)
    this.nozzles = b.nozzles; this.ports = b.hover
    const merge = (pieces: Builder['pieces'], parent: THREE.Object3D, prefix: string) => {
      for (const mat of Object.keys(this.materials) as Mat[]) {
        const parts = pieces.filter(p => p.mat === mat).map(p => p.geometry); if (!parts.length) continue
        const merged = mergeGeometries(parts); parts.forEach(g => g.dispose()); this.geometries.push(merged)
        const mesh = new THREE.Mesh(merged, this.materials[mat]); mesh.name = `${prefix}-${mat}`; mesh.castShadow = mesh.receiveShadow = mat !== 'glow'
        parent.add(mesh)
      }
    }
    merge(b.pieces, this.object, 'hover')
    if (b.gimbal) { this.thruster.position.set(0, b.gimbal.y, b.gimbal.z); this.object.add(this.thruster); merge(b.gimbalPieces, this.thruster, 'hover-thruster') }

    // Lamps: flattened spheres set into the skin, one merged mesh for each kind.
    const lamps = (at: [number, number, number][], material: THREE.Material, name: string) => {
      const parts = at.flatMap(([x, y, z]) => [x, -x].map(sx => new THREE.SphereGeometry(design.lamps.r, Math.max(8, Math.round(16 * detail)), Math.max(6, Math.round(10 * detail))).scale(1, .6, .32).translate(sx, y, z)))
      const merged = mergeGeometries(parts); parts.forEach(g => g.dispose()); this.geometries.push(merged)
      const mesh = new THREE.Mesh(merged, material); mesh.name = name; this.object.add(mesh)
    }
    lamps(design.lamps.head, this.head, 'hover-headlights'); lamps(design.lamps.tail, this.tail, 'hover-taillights')
  }

  /** Swivel the main thruster to steer, in radians: positive turns the exhaust to the right, seen from behind. */
  setVector(yaw: number): void { this.thruster.rotation.y = -yaw }

  /** Glow strength for the thruster and lift ports, 0..1. */
  setThrottle(amount: number): void { this.glow.opacity = .25 + .6 * clamp01(amount) }

  /** Tail lamps glow with the headlights and brighten on braking. */
  setLights(headlights: boolean, braking: boolean): void {
    this.head.emissiveIntensity = headlights ? LAMP.headOn : LAMP.headOff
    this.tail.emissiveIntensity = braking ? LAMP.brake : headlights ? LAMP.tailOn : LAMP.tailOff
  }

  setColors(paint: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    this.paint.color.set(paint); this.accent.color.set(accent); this.glow.color.set(accent).multiplyScalar(1.3)
  }

  /** Bounds of everything in the model's frame, thruster included, with the thruster straight. */
  bounds(): THREE.Box3 {
    this.object.updateMatrixWorld(true)
    const inverse = new THREE.Matrix4().copy(this.object.matrixWorld).invert(), box = new THREE.Box3(), part = new THREE.Box3()
    this.object.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const g = o.geometry as THREE.BufferGeometry; if (!g.boundingBox) g.computeBoundingBox()
      box.union(part.copy(g.boundingBox!).applyMatrix4(o.matrixWorld).applyMatrix4(inverse))
    })
    return box
  }

  triangles(): number {
    let count = 0
    this.object.traverse(o => { if (o instanceof THREE.Mesh) { const g = o.geometry as THREE.BufferGeometry; count += (g.index ? g.index.count : g.getAttribute('position').count) / 3 } })
    return Math.round(count)
  }

  dispose(): void {
    this.geometries.forEach(g => g.dispose())
    Object.values(this.materials).forEach(m => m.dispose()); this.head.dispose(); this.tail.dispose()
  }
}

/**
 * Triangle budgets from the vehicle pattern (PATTERN.md rule 4, the Vehicles lane's proposal):
 * the player's own vehicle and others within 30 m, then 30 to 120 m. The pattern's third level
 * (400 triangles in one draw beyond 120 m) needs a single-material silhouette this generator
 * does not make yet.
 */
export const BUDGET = { near: 12000, mid: 2500 }

/** The most detailed build of a design that fits a triangle budget, generated, not decimated. */
export function atBudget(design: HoverDesign, triangles: number, details: number[]): NextHover {
  for (const detail of details) {
    const craft = new NextHover(design, detail)
    if (craft.triangles() <= triangles || detail === details[details.length - 1]) return craft
    craft.dispose()
  }
  throw new Error('No detail levels given')
}

/** The two authored detail levels of a design: near and mid. */
export const hoverLevels = (design: HoverDesign): NextHover[] =>
  [atBudget(design, BUDGET.near, [1, .8, .7, .6, .5]), atBudget(design, BUDGET.mid, [.35, .3, .25, .2, .15, .1])]

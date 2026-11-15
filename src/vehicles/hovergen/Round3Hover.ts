import * as T from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Mat } from '../jetgen/shapes'
import { mergeStatic } from '../skins/mergeStatic'
import { applyShowroom, setRole } from '../skins/showroom'
import { buildRound3, round3Far, type Round3Build, type Round3Design } from './round3'

/** Triangle budgets per detail level (PATTERN.md rule 4). */
export const R3_BUDGET = [12000, 2500, 500] as const
const DETAILS = [[.55, .5, .45, .4], [.16, .13, .1]]
const count = (g: T.BufferGeometry) => (g.index?.count ?? g.attributes.position.count) / 3

/** Anything that can be built at a detail setting and outlined for the far level. Round four provides this directly. */
export interface HoverSpec { id: string; paint: number; accent: number; build(detail: number): Round3Build; far(): T.BufferGeometry[] }
const specOf = (d: Round3Design | HoverSpec): HoverSpec => 'build' in d ? d : { id: d.id, paint: d.paint, accent: d.accent, build: detail => buildRound3(d, detail), far: () => round3Far(d) }

/** A round three or four study at one detail level, on the shared vehicle materials. */
export class Round3Hover {
  readonly object = new T.Group()
  readonly thruster = new T.Group()
  readonly ports: [number, number, number][] = []
  readonly beams: [number, number, number][] = []
  readonly cockpitClearance: number = Infinity
  /** The generator's detail setting this level settled on to meet its budget. */
  readonly detail: number = 0
  private readonly paint: T.MeshStandardMaterial
  private readonly accent: T.MeshStandardMaterial
  private readonly head = setRole(new T.MeshStandardMaterial({ color: 0xd8e4ff, emissive: 0xe8f4ff }), 'lamp')
  private readonly tail = setRole(new T.MeshStandardMaterial({ color: 0x400808, emissive: 0xff1605 }), 'lamp')
  private readonly glow: T.MeshStandardMaterial
  private readonly sources: T.Material[] = []
  private readonly glowMeshes: T.Mesh[] = []
  private detach = () => {}

  constructor(readonly design: Round3Design | HoverSpec, readonly level: 0 | 1 | 2) {
    const spec = specOf(design)
    this.paint = setRole(new T.MeshStandardMaterial({ color: design.paint, metalness: .8, roughness: .24 }), 'paint')
    this.accent = setRole(new T.MeshStandardMaterial({ color: design.accent, roughness: .4 }), 'accent')
    this.glow = setRole(new T.MeshStandardMaterial({ color: design.accent, emissive: design.accent, emissiveIntensity: 2, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }), 'glow')
    this.glow.forceSinglePass = true
    this.sources.push(this.paint, this.accent, this.glow, this.head, this.tail)
    this.object.userData.vehicleColors = { body: this.paint.color, accent: this.accent.color }
    if (level === 2) {
      const pieces = spec.far(), merged = mergeGeometries(pieces.map(g => { const n = g.toNonIndexed(); n.deleteAttribute('uv'); g.dispose(); return n }))
      this.object.add(new T.Mesh(merged, this.paint))
      return
    }
    // Step the generator's detail down until the level fits its budget, fittings included.
    let built!: Round3Build
    for (const detail of DETAILS[level]) {
      built = spec.build(detail); this.detail = detail
      const total = [...built.builder.pieces.map(p => p.geometry), ...built.head, ...built.tail].reduce((n, g) => n + count(g), 0)
      if (total + 80 <= R3_BUDGET[level]) break
      for (const g of [...built.builder.pieces.map(p => p.geometry), ...built.head, ...built.tail]) g.dispose()
    }
    const b = built.builder
    this.ports = b.hover; this.beams = built.beams; this.cockpitClearance = b.cockpitClearance()
    const canopy = setRole(new T.MeshStandardMaterial({ color: design.accent, transparent: true, opacity: .18, depthWrite: false, side: T.DoubleSide }), 'canopy')
    canopy.forceSinglePass = true
    const chrome = setRole(new T.MeshStandardMaterial({ color: 0xd5dce2, metalness: 1, roughness: .18 }), 'chrome')
    const frame = setRole(new T.MeshStandardMaterial({ color: 0x171c24, metalness: .3, roughness: .6 }), 'frame')
    const trim = setRole(new T.MeshStandardMaterial({ color: 0x161c22, roughness: .8 }), 'trim')
    this.sources.push(canopy, chrome, frame, trim)
    const materials: Record<Mat, T.MeshStandardMaterial> = { paint: this.paint, panel: this.paint, accent: this.accent, chrome, dark: frame, glass: canopy, trim, glow: this.glow }
    const add = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
      const mesh = new T.Mesh(geometry, material)
      mesh.name = name; mesh.castShadow = mesh.receiveShadow = material !== this.glow && material !== canopy
      this.object.add(mesh)
    }
    if (level === 0) {
      // Seat and low dashboard stay below the forward sightline. The kit owns the tub.
      for (const [size, at] of [[[.48, .06, .43], [0, .17, -.51]], [[.48, .42, .07], [0, .37, -.20]], [[.64, .07, .15], [0, .36, -1.07]]]) b.add('trim', new T.BoxGeometry(...size as [number, number, number]).translate(...at as [number, number, number]))
    }
    for (const part of b.pieces) add(part.geometry, materials[part.mat], `round3-${part.mat}`)
    for (const g of built.head) add(g, this.head, 'round3-headlamp')
    for (const g of built.tail) add(g, this.tail, 'round3-taillamp')
    if (level === 0 && b.gimbal) {
      // Two rudder vanes in the exhaust of a central thruster.
      this.thruster.position.set(0, b.gimbal.y, b.gimbal.z)
      for (const x of [-.08, .08]) {
        const vane = new T.Mesh(new T.BoxGeometry(.018, Math.min(.25, b.gimbal.halfHeight * 1.7), .09), chrome)
        // Inside the lip, so they read as part of the nozzle and not as blocks behind it.
        vane.position.set(x, 0, -.045); this.thruster.add(vane)
      }
      this.object.add(this.thruster)
    }
    mergeStatic(this.object)
    this.object.traverse(o => { if (o instanceof T.Mesh && o.material === this.glow) this.glowMeshes.push(o) })
    this.detach = applyShowroom(this.object, () => {})
    this.setLights(false, false)
  }

  setColors(body: T.ColorRepresentation, accent: T.ColorRepresentation): void {
    this.paint.color.set(body); this.accent.color.set(accent)
    this.glow.color.set(accent); this.glow.emissive.set(accent)
  }
  setVector(yaw: number): void { this.thruster.rotation.y = -yaw }
  setThrottle(amount: number): void {
    const value = .3 + Math.max(0, Math.min(1, amount)) * .7
    this.glow.emissiveIntensity = value * 2
    for (const mesh of this.glowMeshes) mesh.userData.glow = value
  }
  setLights(on: boolean, braking: boolean): void {
    // mergeStatic keeps references to emissive colours, so update colours, not copied scalars.
    this.head.emissive.set(0xe8f4ff).multiplyScalar(on ? 3 : .15)
    this.tail.emissive.set(0xff1605).multiplyScalar(braking ? 1.5 : on ? .6 : .08)
  }
  triangles(): number {
    let n = 0
    this.object.traverse(o => { if (o instanceof T.Mesh) n += count(o.geometry) })
    return n
  }
  dispose(): void {
    this.detach()
    const geometries = new Set<T.BufferGeometry>(), materials = new Set(this.sources)
    this.object.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m) } })
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
  }
}

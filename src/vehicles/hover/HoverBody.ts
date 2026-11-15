import * as T from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import { attribute, float, uniform, vec3 } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Mat } from '../jetgen/shapes'
import { mergeStatic, mergedSurfaces } from '../skins/mergeStatic'
import { applyShowroom, setRole } from '../skins/showroom'
import { addLavaGlow } from '../skins/lavaGlow'
import { addNightReadability } from '../skins/nightReadability'
import type { HoverBuild } from './kit'

/** Triangle budgets per detail level (PATTERN.md rule 4). */
export const R3_BUDGET = [12000, 2500, 500] as const
const DETAILS = [[.55, .5, .45, .4], [.16, .13, .1]]
const count = (g: T.BufferGeometry) => (g.index?.count ?? g.attributes.position.count) / 3

/** Anything that can be built at a detail setting and outlined for the far level. */
export interface HoverSpec { id: string; paint: number; accent: number; build(detail: number): HoverBuild; far(): T.BufferGeometry[] }

/**
 * Shared geometry for the game. Generating a craft's three levels costs 15 to 40 ms in Node on
 * a desktop, and every hovercraft, bots included, used to generate its own when it spawned.
 * In game use the first craft of a design builds each level and later ones reuse its geometry,
 * with their own materials so colours stay per vehicle. The cache keeps the geometry for the
 * session. The lab does not use it: it rebuilds on demand and disposes what it built.
 */
type Key = 'paint' | 'accent' | 'chrome' | 'frame' | 'trim' | 'canopy' | 'glow' | 'head' | 'tail'
interface CachedMesh { geometry: T.BufferGeometry; name: string; cast: boolean; receive: boolean; inThruster: boolean; position: T.Vector3; merged?: Key[]; key?: Key }
interface CachedLevel { meshes: CachedMesh[]; ports: [number, number, number][]; beams: [number, number, number][]; clearance: number; detail: number; thruster: T.Vector3 }
const levelCache = new Map<string, CachedLevel>(), farCache = new Map<string, T.BufferGeometry>()
/** Geometry builds since load, for tests and for measuring spawn cost. */
export const hoverBuilds = { count: 0 }

/** The one-draw material mergeStatic makes for packed surfaces, made again over another craft's own materials. */
function mergedMaterial(materials: T.MeshStandardMaterial[]): T.MeshStandardNodeMaterial {
  const idx = attribute('surfaceId', 'float')
  let color: Node<'vec3'> = vec3(0), emission: Node<'vec3'> = vec3(0), roughness: Node<'float'> = float(0), metalness: Node<'float'> = float(0)
  materials.forEach((m, i) => {
    const mask = idx.round().equal(i).select(1, 0)
    color = color.add(uniform(m.color).mul(mask)); emission = emission.add(uniform(m.emissive).mul(m.emissiveIntensity).mul(mask))
    roughness = roughness.add(mask.mul(m.roughness)); metalness = metalness.add(mask.mul(m.metalness))
  })
  const material = new T.MeshStandardNodeMaterial()
  material.colorNode = color; material.emissiveNode = emission; material.roughnessNode = roughness; material.metalnessNode = metalness
  mergedSurfaces.set(material, materials)
  return material
}

/** A generated hovercraft body at one detail level, on the shared vehicle materials. */
export class HoverBody {
  readonly object = new T.Group()
  readonly thruster = new T.Group()
  ports: [number, number, number][] = []
  beams: [number, number, number][] = []
  cockpitClearance = Infinity
  /** The generator's detail setting this level settled on to meet its budget. */
  detail = 0
  private readonly paint: T.MeshStandardMaterial
  private readonly accent: T.MeshStandardMaterial
  private readonly head = setRole(new T.MeshStandardMaterial({ color: 0xd8e4ff, emissive: 0xe8f4ff }), 'lamp')
  private readonly tail = setRole(new T.MeshStandardMaterial({ color: 0x400808, emissive: 0xff1605 }), 'lamp')
  private readonly glow: T.MeshStandardMaterial
  private readonly sources: T.Material[] = []
  private readonly glowMeshes: T.Mesh[] = []
  private detach = () => {}
  private shaded = false

  /**
   * `game` defers the shared shading until `showroom()`: the tiers and the night and lava
   * passes register with the owning vehicle, which only exists once the craft is attached.
   * It also shares generated geometry between craft of the same design (see `levelCache`).
   */
  constructor(readonly design: HoverSpec, readonly level: 0 | 1 | 2, private readonly game = false) {
    const spec = design
    this.paint = setRole(new T.MeshStandardMaterial({ color: design.paint, metalness: .8, roughness: .24 }), 'paint')
    this.accent = setRole(new T.MeshStandardMaterial({ color: design.accent, roughness: .4 }), 'accent')
    this.glow = setRole(new T.MeshStandardMaterial({ color: design.accent, emissive: design.accent, emissiveIntensity: 2, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }), 'glow')
    this.glow.forceSinglePass = true
    this.sources.push(this.paint, this.accent, this.glow, this.head, this.tail)
    this.object.userData.vehicleColors = { body: this.paint.color, accent: this.accent.color }
    if (level === 2) {
      let far = game ? farCache.get(spec.id) : undefined
      if (!far) {
        const pieces = spec.far()
        far = mergeGeometries(pieces.map(g => { const n = g.toNonIndexed(); n.deleteAttribute('uv'); g.dispose(); return n }))
        hoverBuilds.count++
        if (game) farCache.set(spec.id, far)
      }
      this.object.add(new T.Mesh(far, this.paint))
      return
    }
    const canopy = setRole(new T.MeshStandardMaterial({ color: design.accent, transparent: true, opacity: .18, depthWrite: false, side: T.DoubleSide }), 'canopy')
    canopy.forceSinglePass = true
    const chrome = setRole(new T.MeshStandardMaterial({ color: 0xd5dce2, metalness: 1, roughness: .18 }), 'chrome')
    const frame = setRole(new T.MeshStandardMaterial({ color: 0x171c24, metalness: .3, roughness: .6 }), 'frame')
    const trim = setRole(new T.MeshStandardMaterial({ color: 0x161c22, roughness: .8 }), 'trim')
    this.sources.push(canopy, chrome, frame, trim)
    const table: Record<Key, T.MeshStandardMaterial> = { paint: this.paint, accent: this.accent, chrome, frame, trim, canopy, glow: this.glow, head: this.head, tail: this.tail }
    const cacheKey = `${spec.id}:${level}`, hit = game ? levelCache.get(cacheKey) : undefined
    if (hit) {
      this.ports = hit.ports; this.beams = hit.beams; this.cockpitClearance = hit.clearance; this.detail = hit.detail
      this.thruster.position.copy(hit.thruster)
      for (const c of hit.meshes) {
        const mesh = new T.Mesh(c.geometry, c.merged ? mergedMaterial(c.merged.map(k => table[k])) : table[c.key!])
        mesh.name = c.name; mesh.castShadow = c.cast; mesh.receiveShadow = c.receive; mesh.position.copy(c.position)
        ;(c.inThruster ? this.thruster : this.object).add(mesh)
      }
      if (this.thruster.children.length) this.object.add(this.thruster)
    } else {
      this.build(spec, level, table)
      if (game) {
        // Remember what the merge produced, by material role, so later craft can make it again over their own materials.
        const keyOf = (m: T.Material) => (Object.keys(table) as Key[]).find(k => table[k] === m)
        const meshes: CachedMesh[] = []
        let complete = true
        this.object.traverse(o => {
          if (!(o instanceof T.Mesh)) return
          const packed = mergedSurfaces.get(o.material as T.Material), merged = packed?.map(keyOf), key = packed ? undefined : keyOf(o.material as T.Material)
          if (packed ? merged!.some(k => !k) : !key) { complete = false; return }
          meshes.push({ geometry: o.geometry, name: o.name, cast: o.castShadow, receive: o.receiveShadow, inThruster: o.parent === this.thruster, position: o.position.clone(), merged: merged as Key[] | undefined, key })
        })
        if (complete) levelCache.set(cacheKey, { meshes, ports: this.ports, beams: this.beams, clearance: this.cockpitClearance, detail: this.detail, thruster: this.thruster.position.clone() })
      }
    }
    this.object.traverse(o => { if (o instanceof T.Mesh && o.material === this.glow) this.glowMeshes.push(o) })
    if (!game) this.detach = applyShowroom(this.object, () => {})
    this.setLights(false, false)
  }

  /** Generate one level and merge its static parts into as few draws as the roles allow. */
  private build(spec: HoverSpec, level: 0 | 1, table: Record<Key, T.MeshStandardMaterial>): void {
    hoverBuilds.count++
    // Step the generator's detail down until the level fits its budget, fittings included.
    let built!: HoverBuild
    for (const detail of DETAILS[level]) {
      built = spec.build(detail); this.detail = detail
      const total = [...built.builder.pieces.map(p => p.geometry), ...built.head, ...built.tail].reduce((n, g) => n + count(g), 0)
      if (total + 80 <= R3_BUDGET[level]) break
      for (const g of [...built.builder.pieces.map(p => p.geometry), ...built.head, ...built.tail]) g.dispose()
    }
    const b = built.builder
    this.ports = b.hover; this.beams = built.beams; this.cockpitClearance = b.cockpitClearance()
    const materials: Record<Mat, T.MeshStandardMaterial> = { paint: table.paint, panel: table.paint, accent: table.accent, chrome: table.chrome, dark: table.frame, glass: table.canopy, trim: table.trim, glow: table.glow }
    const add = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
      const mesh = new T.Mesh(geometry, material)
      mesh.name = name; mesh.castShadow = mesh.receiveShadow = material !== table.glow && material !== table.canopy
      this.object.add(mesh)
    }
    if (level === 0) {
      // Seat and low dashboard stay below the forward sightline. The kit owns the tub.
      for (const [size, at] of [[[.48, .06, .43], [0, .17, -.51]], [[.48, .42, .07], [0, .37, -.20]], [[.64, .07, .15], [0, .36, -1.07]]]) b.add('trim', new T.BoxGeometry(...size as [number, number, number]).translate(...at as [number, number, number]))
    }
    for (const part of b.pieces) add(part.geometry, materials[part.mat], `round3-${part.mat}`)
    for (const g of built.head) add(g, table.head, 'round3-headlamp')
    for (const g of built.tail) add(g, table.tail, 'round3-taillamp')
    if (level === 0 && b.gimbal) {
      // Two rudder vanes in the exhaust of a central thruster.
      this.thruster.position.set(0, b.gimbal.y, b.gimbal.z)
      for (const x of [-.08, .08]) {
        const vane = new T.Mesh(new T.BoxGeometry(.018, Math.min(.25, b.gimbal.halfHeight * 1.7), .09), table.chrome)
        // Inside the lip, so they read as part of the nozzle and not as blocks behind it.
        vane.position.set(x, 0, -.045); this.thruster.add(vane)
      }
      this.object.add(this.thruster)
    }
    mergeStatic(this.object)
  }

  /** Game use: call once the craft is attached to its vehicle. The far silhouette has no tiers. */
  showroom(): void {
    if (!this.game || this.level === 2 || this.shaded) return
    this.shaded = true
    this.detach = applyShowroom(this.object, root => { addNightReadability(root); addLavaGlow(root) })
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
    // In game use the geometry belongs to the shared cache and outlives this craft.
    if (!this.game) geometries.forEach(g => g.dispose())
    materials.forEach(m => m.dispose())
  }
}

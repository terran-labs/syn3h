/**
 * Pure parts of the vehicle lab: stats counting, the design and group filter, URL parameters,
 * Auto detail selection and the frame time meter. Kept out of lab.ts so they run in vitest
 * without a renderer or a DOM.
 */
import * as THREE from 'three/webgpu'
import type { LabDesignInfo, LabStats } from './types'

/**
 * Triangles and draw calls for the visible meshes under `root`. An InstancedMesh counts as one
 * draw and its triangles once per instance. A mesh with material groups draws once per group.
 * Transparent double sided materials draw twice (back faces, then front), as three renders them
 * unless `forceSinglePass` is set. Lines, points and sprites are ignored. Counts what is
 * submitted, before frustum culling, and ignores the shadow and floor reflection passes.
 */
export function countStats(root: THREE.Object3D, out: LabStats = { triangles: 0, drawCalls: 0 }): LabStats {
  out.triangles = 0
  out.drawCalls = 0
  accumulate(root, out)
  return out
}

function accumulate(object: THREE.Object3D, out: LabStats): void {
  if (!object.visible) return
  if ((object as THREE.Mesh).isMesh) {
    // Written without array helpers or closures: the lab calls this from its frame loop.
    const mesh = object as THREE.Mesh
    const geometry = mesh.geometry
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1
    if (Array.isArray(mesh.material)) {
      if (geometry.groups.length) {
        for (const g of geometry.groups) {
          const m = mesh.material[g.materialIndex ?? 0]
          if (!m?.visible) continue
          out.triangles += Math.floor(Math.min(g.count, vertexCount(geometry)) / 3) * instances
          out.drawCalls += passes(m)
        }
      } else if (mesh.material[0]?.visible) {
        out.triangles += Math.floor(vertexCount(geometry) / 3) * instances
        out.drawCalls += passes(mesh.material[0])
      }
    } else if (mesh.material.visible) {
      out.triangles += Math.floor(vertexCount(geometry) / 3) * instances
      out.drawCalls += passes(mesh.material)
    }
  }
  for (const child of object.children) accumulate(child, out)
}

function vertexCount(geometry: THREE.BufferGeometry): number {
  const n = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0)
  return Math.min(n, geometry.drawRange.count)
}

function passes(material: THREE.Material): number {
  return material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1
}

/** Groups in first appearance order, ignoring designs without one. */
export function groupsOf(designs: LabDesignInfo[]): string[] {
  const seen: string[] = []
  for (const d of designs) if (d.group !== undefined && !seen.includes(d.group)) seen.push(d.group)
  return seen
}

/**
 * The designs shown for `group`: its own designs plus those that list it in `alsoIn`. With no
 * group (or a design list without groups) every design is shown. An unknown group falls back to
 * the last one, which is the default.
 */
export function filterDesigns(designs: LabDesignInfo[], group?: string | null): { group: string | undefined; designs: LabDesignInfo[] } {
  const groups = groupsOf(designs)
  if (!groups.length) return { group: undefined, designs: designs.slice() }
  const picked = group != null && groups.includes(group) ? group : groups[groups.length - 1]
  return { group: picked, designs: designs.filter(d => d.group === picked || d.alsoIn?.includes(picked)) }
}

/** Auto detail: level i + 1 begins at distances[i]. Missing distances default to 30 m steps. */
/**
 * Which of the game's engine voices (voiceProfile in src/audio/Engine.ts) an exhibit plays for
 * the lab's Motor sound switch. Takes the exhibit's family or id: 'game-jet', 'hover',
 * 'tank-archive', 'buggy' and so on.
 */
export function motorKind(family: string): string {
  const name = family.replace(/^game-/, '')
  if (name.startsWith('tank')) return 'tank'
  if (name.startsWith('hover')) return 'hovercraft'
  if (name.startsWith('jet')) return 'jet'
  if (name === 'buggy-classic') return 'buggy-classic'
  return 'buggy'
}

export function pickAutoLod(distance: number, levels: number, distances?: number[]): number {
  let level = 0
  for (let i = 0; i < levels - 1; i++) if (distance >= (distances?.[i] ?? 30 * (i + 1))) level = i + 1
  return level
}

export type ViewName = 'Front' | 'Rear' | 'Side' | 'Top' | 'Low' | 'Under'
export const VIEW_NAMES: ViewName[] = ['Front', 'Rear', 'Side', 'Top', 'Low', 'Under']

/** Camera heights (m above the floor) between which the floor fades in; see floorOpacity(). */
export const FLOOR_FADE = { clear: .2, solid: 1.4 }
/**
 * How solid the floor is drawn for a camera at this height above it. Opaque from a normal
 * viewing height, fading as the camera comes down to it, and gone at and below floor level,
 * so the camera can pass under the floor and look up at a vehicle's underside.
 */
export function floorOpacity(cameraHeight: number): number {
  const t = Math.min(1, Math.max(0, (cameraHeight - FLOOR_FADE.clear) / (FLOOR_FADE.solid - FLOOR_FADE.clear)))
  return t * t * (3 - 2 * t)
}
export type FloorName = 'Gloss' | 'Shadow'
export const FLOOR_NAMES: FloorName[] = ['Gloss', 'Shadow']
export const STRESS_COUNTS = [1, 10, 25, 50]

/** Every URL parameter the lab reads. Missing or malformed values are undefined. */
export interface LabParams {
  vehicle: string
  /** A design id, a 1 based position, or 'all' for side by side. */
  design?: string
  group?: string
  view?: ViewName
  /** Camera azimuth and elevation in degrees, distance in metres; override the view. */
  az?: number
  el?: number
  dist?: number
  /** 'auto', a level name or a 0 based level index. */
  lod?: string
  night: boolean
  still: boolean
  floor?: FloorName
  /** Body colour and optional accent, as numbers. */
  color?: { body: number; accent?: number }
  headlights?: boolean
  brake: boolean
  motion?: boolean
  /** Seconds without input before the lab runs by itself. 0 turns that off. */
  idle?: number
  cockpit: boolean
  stress?: number
  webgl: boolean
}

const number = (v: string | null) => v === null || v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v)
const hex = (v: string | undefined) => v && /^#?[0-9a-f]{6}$/i.test(v) ? parseInt(v.replace('#', ''), 16) : undefined
const flag = (q: URLSearchParams, name: string) => q.has(name) ? q.get(name) !== '0' : undefined
const pick = <T extends string>(names: readonly T[], v: string | null) => names.find(n => n.toLowerCase() === v?.toLowerCase())

export function parseLabParams(search: string, fallbackVehicle = 'buggy'): LabParams {
  const q = new URLSearchParams(search)
  const [body, accent] = (q.get('color') ?? '').split(',')
  const b = hex(body)
  const stress = number(q.get('stress'))
  return {
    vehicle: q.get('vehicle') || fallbackVehicle,
    design: q.get('design') ?? undefined,
    group: q.get('group') ?? undefined,
    view: pick(VIEW_NAMES, q.get('view')),
    az: number(q.get('az')), el: number(q.get('el')), dist: number(q.get('dist')),
    lod: q.get('lod') ?? undefined,
    night: flag(q, 'night') ?? false,
    still: flag(q, 'still') ?? false,
    floor: pick(FLOOR_NAMES, q.get('floor')),
    color: b === undefined ? undefined : { body: b, accent: hex(accent) },
    headlights: flag(q, 'headlights'),
    brake: flag(q, 'brake') ?? false,
    motion: flag(q, 'motion'),
    idle: number(q.get('idle')),
    cockpit: flag(q, 'cockpit') ?? false,
    stress: stress === undefined ? undefined : STRESS_COUNTS.reduce((a, c) => Math.abs(c - stress) < Math.abs(a - stress) ? c : a),
    webgl: q.has('webgl'),
  }
}

/** Resolves the `lod` parameter against a model's levels: -1 for Auto, else a level index. */
export function resolveLod(value: string | undefined, levels: string[]): number {
  if (value === undefined || value.toLowerCase() === 'auto') return -1
  const byName = levels.findIndex(l => l.toLowerCase() === value.toLowerCase())
  if (byName >= 0) return byName
  const i = Number(value)
  return Number.isInteger(i) && i >= 0 && i < levels.length ? i : -1
}

/** Resolves the `design` parameter: an index into `designs`, or -1 for side by side. */
export function resolveDesign(value: string | undefined, designs: LabDesignInfo[], fallback = 0): number {
  if (value === undefined) return fallback
  if (value === 'all') return -1
  const byId = designs.findIndex(d => d.id === value)
  if (byId >= 0) return byId
  const i = Number(value)
  return Number.isInteger(i) && i >= 1 && i <= designs.length ? i - 1 : fallback
}

/** Average of the last `size` samples in a fixed ring, so the frame loop allocates nothing. */
export class RollingAverage {
  private readonly samples: Float64Array
  private next = 0
  private filled = 0
  private sum = 0
  constructor(size = 60) { this.samples = new Float64Array(size) }
  push(value: number): void {
    this.sum += value - this.samples[this.next]
    this.samples[this.next] = value
    this.next = (this.next + 1) % this.samples.length
    this.filled = Math.min(this.filled + 1, this.samples.length)
  }
  get average(): number { return this.filled ? this.sum / this.filled : 0 }
  reset(): void { this.samples.fill(0); this.next = this.filled = 0; this.sum = 0 }
}

/** Grid slots for `count` stress copies, centred on the origin, row by row along X. */
export function stressGrid(count: number, spacingX: number, spacingZ: number): [number, number][] {
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  const slots: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const c = i % columns, r = Math.floor(i / columns)
    slots.push([(c - (columns - 1) / 2) * spacingX, (r - (rows - 1) / 2) * spacingZ])
  }
  return slots
}

/** Bounds of the visible meshes only: hidden detail levels and idle effects do not count. */
export function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3(), part = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverseVisible(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).computeBoundingBox()
    else mesh.geometry.computeBoundingBox()
    const local = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).boundingBox! : mesh.geometry.boundingBox!
    box.union(part.copy(local).applyMatrix4(mesh.matrixWorld))
  })
  // Into the root's parent frame, where the lab places it.
  if (root.parent) box.applyMatrix4(root.parent.matrixWorld.clone().invert())
  return box
}

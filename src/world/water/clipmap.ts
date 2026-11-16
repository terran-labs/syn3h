/**
 * A geometry clipmap for liquid that stretches to the horizon: nested square rings round the
 * camera, each with cells twice the size of the ring inside it.
 *
 * Why: waves only look like waves if the mesh under them is fine enough to carry them, four
 * cells to a wavelength at least. A grid over the whole tile has the same cell everywhere, so
 * on a 4 km planet it cannot draw a 36 m swell, while the water at your wheels and the water
 * at the horizon are drawn at the same density. Here resolution follows distance instead: at
 * High a wave of length L is geometry out to about 8 L from the camera, on any size of planet,
 * for about a third of the vertices the tile grid used.
 *
 * Layout. Every level is the same (N + 1)^2 grid of vertices, stored as integer cell indices
 * -N/2..N/2 in x and z, so one vertex buffer serves every level. Level l has cell `base * 2^l`
 * and its centre snaps to two of its own cells, so a vertex only ever moves by whole wave
 * samples (no swimming). The finer level's square then always lies on the coarser level's grid
 * lines, offset from its centre by -1, 0 or 1 coarse cells per axis; the coarser level leaves
 * that square out with one of nine prebuilt index buffers.
 *
 * Seams. Over the outer quarter of each level its odd vertices slide onto their even
 * neighbours (`morph`), so at the edge it has exactly the coarser level's vertices and the two
 * meet without cracks. The same morph widens the cell used to fade out waves too short for the
 * mesh, so both sides of a seam keep the same components.
 */
import * as THREE from 'three/webgpu'
import { float, fract, positionGeometry, smoothstep, uniform, vec2 } from 'three/tsl'

/** Cells per side of every level. A multiple of 8 keeps the hole and the morph on even cells. */
export interface ClipmapLayout { cells: number; base: number; levels: number }

/**
 * Clipmap per quality level (0 Minimal .. 5 Cinematic): cell at the camera and ring count.
 * The outermost ring reaches `cells / 2 * base * 2^(levels - 1)` from the camera; every layout
 * reaches at least 8 km, past the fog and over the horizon of every planet.
 */
export const CLIPMAP_LAYOUTS: readonly ClipmapLayout[] = [
  { cells: 32, base: 2, levels: 9 },
  { cells: 48, base: 1, levels: 9 },
  { cells: 64, base: 1, levels: 9 },
  { cells: 64, base: 0.5, levels: 10 },
  { cells: 64, base: 0.5, levels: 10 },
  { cells: 64, base: 0.25, levels: 11 },
]

/** Distance from the camera to the outer edge of the outermost ring, metres. */
export const clipmapReach = (l: ClipmapLayout) => (l.cells / 2) * l.base * 2 ** (l.levels - 1)

/** Vertices drawn for a layout: the full inner level and every ring. */
export function clipmapVertices(l: ClipmapLayout): number {
  return (l.cells + 1) ** 2 * l.levels
}

/**
 * Shortest wave the clipmap draws as geometry at distance `d` from the camera, metres: four
 * cells of the level that covers that distance.
 */
export function shortestGeometricWave(l: ClipmapLayout, d: number): number {
  let cell = l.base
  for (let i = 0; i < l.levels - 1 && Math.abs(d) > (l.cells / 2) * cell * 0.75; i++) cell *= 2
  return 4 * cell
}

/** Snap a coordinate to a multiple of `step`. */
const snap = (v: number, step: number) => Math.round(v / step) * step

/**
 * Index buffer for a level: every cell of the (cells x cells) grid except the square
 * [ox - cells/4, ox + cells/4] x [oz - cells/4, oz + cells/4] (in this level's cells), which
 * the finer level covers. `hole` false keeps every cell (the innermost level).
 */
export function clipmapIndices(cells: number, ox: number, oz: number, hole: boolean): number[] {
  const index: number[] = []
  const h = cells / 2
  const q = cells / 4
  const row = cells + 1
  for (let iz = -h; iz < h; iz++) {
    for (let ix = -h; ix < h; ix++) {
      if (hole && ix >= ox - q && ix + 1 <= ox + q && iz >= oz - q && iz + 1 <= oz + q) continue
      const a = (iz + h) * row + (ix + h)
      // Alternate the diagonal so long rows do not all lean one way.
      if ((ix + iz) & 1) index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
      else index.push(a, a + row, a + row + 1, a, a + row + 1, a + 1)
    }
  }
  return index
}

/** The shared vertex buffer: integer cell indices in x and z, y zero. */
function gridPositions(cells: number): THREE.Float32BufferAttribute {
  const h = cells / 2
  const out: number[] = []
  for (let iz = -h; iz <= h; iz++) for (let ix = -h; ix <= h; ix++) out.push(ix, 0, iz)
  return new THREE.Float32BufferAttribute(out, 3)
}

/** Per-object data the vertex stage reads: this level's cell size and half its cell count. */
interface LevelData { cell: number; half: number }
const levelData = (object: THREE.Object3D | undefined | null): LevelData | undefined => (object?.userData as { clipmap?: LevelData } | undefined)?.clipmap

/**
 * Node helpers for a material drawn on clipmap levels. Nothing is baked into the graph, so a
 * quality change that swaps the layout reuses the same material. `cell` is the drawn level's cell size,
 * set per object as it renders; `grid` the morphed cell index; `world` the morphed world xz.
 * `fadeCell` is the cell size to judge drawable wavelengths by (it doubles across the morph).
 */
export function clipmapNodes() {
  const cell = uniform(1).onObjectUpdate(({ object }) => levelData(object)?.cell ?? 1)
  const half = uniform(32).onObjectUpdate(({ object }) => levelData(object)?.half ?? 32)
  const at = new THREE.Vector2()
  const centre = uniform(at).onObjectUpdate(({ object }) => at.set(object?.position.x ?? 0, object?.position.z ?? 0))
  const g = positionGeometry.xz
  const edge = g.x.abs().max(g.y.abs()).div(half)
  const morph = smoothstep(0.75, 0.97, edge)
  // Odd indices slide toward the even neighbour below (fract(g/2) is 0.5 for odd, 0 for even).
  const grid = g.sub(fract(g.mul(0.5)).mul(2).mul(morph))
  const local = grid.mul(cell)
  const world = vec2(centre.x, centre.y).add(local)
  const fadeCell = cell.mul(float(1).add(morph))
  return { cell, local, world, fadeCell, morph }
}

/**
 * The meshes. One per level, sharing a vertex buffer, each swapping between nine index
 * buffers as the finer level's square moves inside it. `update` re-centres on the camera.
 */
export class Clipmap {
  readonly group = new THREE.Group()
  readonly layout: ClipmapLayout
  private readonly meshes: THREE.Mesh[] = []
  /** [level][variant]: variant = (ox + 1) * 3 + (oz + 1). Level 0 has one. */
  private readonly geometries: THREE.BufferGeometry[][] = []

  constructor(layout: ClipmapLayout, material: THREE.Material) {
    this.layout = layout
    this.group.name = 'liquid-clipmap'
    const positions = gridPositions(layout.cells)
    const reach = clipmapReach(layout)
    for (let l = 0; l < layout.levels; l++) {
      const variants: THREE.BufferGeometry[] = []
      for (let v = 0; v < (l === 0 ? 1 : 9); v++) {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', positions)
        geometry.setIndex(clipmapIndices(layout.cells, Math.floor(v / 3) - 1, (v % 3) - 1, l > 0))
        // Displacement is in the vertex shader: give culling a sphere round the whole level.
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), (layout.cells / 2) * layout.base * 2 ** l * 1.5 + 10)
        variants.push(geometry)
      }
      this.geometries.push(variants)
      const mesh = new THREE.Mesh(variants[0], material)
      mesh.userData.clipmap = { cell: layout.base * 2 ** l, half: layout.cells / 2 } satisfies LevelData
      // Outer levels are as big as the world: never culled.
      mesh.frustumCulled = (layout.cells / 2) * layout.base * 2 ** l < reach / 8
      mesh.name = `liquid-clipmap-${l}`
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
  }

  set material(m: THREE.Material) {
    for (const mesh of this.meshes) if (mesh.material !== m) mesh.material = m
  }

  /** Centre every level on (x, z) at height `y`. Returns the outermost level's centre. */
  update(x: number, z: number, y: number): { x: number; z: number; half: number } {
    const { base, levels, cells } = this.layout
    let fx = 0
    let fz = 0
    for (let l = 0; l < levels; l++) {
      const cell = base * 2 ** l
      const cx = snap(x, 2 * cell)
      const cz = snap(z, 2 * cell)
      const mesh = this.meshes[l]
      mesh.position.set(cx, y, cz)
      if (l > 0) {
        // Where the finer level sits inside this one, in this level's cells.
        const ox = Math.round((fx - cx) / cell)
        const oz = Math.round((fz - cz) / cell)
        const geometry = this.geometries[l][(ox + 1) * 3 + (oz + 1)]
        if (mesh.geometry !== geometry) mesh.geometry = geometry
      }
      fx = cx
      fz = cz
    }
    return { x: fx, z: fz, half: (cells / 2) * base * 2 ** (levels - 1) }
  }

  get vertexCount(): number { return clipmapVertices(this.layout) }

  dispose(): void {
    for (const variants of this.geometries) for (const g of variants) g.dispose()
    this.group.removeFromParent()
  }
}

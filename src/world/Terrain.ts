/**
 * Terrain contract, plus a placeholder implementation.
 *
 * Vehicles, spawning, the camera and game modes depend only on the `Terrain` interface.
 * The real procedural world replaces `createPlaceholderTerrain` without touching them.
 *
 * Determinism rule: a terrain must be a pure function of its seed and its world parameters,
 * so every player in a room generates the identical world locally and nothing is downloaded.
 */
import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../core/physics'
import type { SurfaceKind } from './terrain/surface'

export interface SpawnPoint {
  position: THREE.Vector3
  /** Radians about +Y. 0 faces -Z. */
  heading: number
}

/** One road centreline. Points are about 4 m apart; y is the road surface height. */
export interface TerrainRoadPath {
  /** 'volcano' climbs to the rim, 'rim' circles the caldera, 'plain' crosses open ground. */
  kind: string
  /** True when the last point connects back to the first. */
  closed: boolean
  /** Paved width in metres. */
  width: number
  points: readonly { x: number; y: number; z: number }[]
  /**
   * Stretches of this road under shallow water where a river fords it: `start` and `end` are
   * indices into `points`, `depth` the deepest water over the road in metres (built to
   * 0.35). Drivable. Empty or absent unless the world has fords.
   */
  fords?: readonly { start: number; end: number; depth: number }[]
}

/** A place where fire, embers or smoke rise: for effects and for sound. */
export interface TerrainVent {
  x: number
  y: number
  z: number
  kind: 'flame' | 'embers' | 'smoke'
  size: number
}

/** The top of the main volcano: where King of the Hill is fought. */
export interface TerrainSummit {
  /** Centre of the caldera. */
  x: number
  z: number
  /** Radius and mean height of the ring road around the caldera rim. */
  rimRadius: number
  rimHeight: number
  /** The lava lake inside the caldera, if there is one. */
  lake: { radius: number; surface: number } | null
}

/** Render detail request from the graphics level system. Never changes heights or physics. */
export interface TerrainRenderQuality {
  /** 0 weakest phone, 1 mobile, 2 desktop. */
  level: number
  /** Metres the level wants drawn at all. */
  drawDistance: number
  /** 0..1 share of full detail. */
  detail: number
}

export interface Terrain {
  /** Side length in metres. The terrain is centred on the origin. */
  readonly size: number
  /**
   * Ground height in metres at a world position. Must match the physics collider. On a
   * wrapping terrain any x and z are accepted and the result repeats every `wrapSize`.
   */
  heightAt(x: number, z: number): number
  /** Visible mesh height before the common planet bend; respects the current render LOD. */
  renderHeightAt?(x: number, z: number): number
  /** Base grid spacing for exact visual segment/triangle intersection samples. */
  readonly renderCellSize?: number
  /** Unit ground normal at a world position. */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3
  /** A safe place to spawn player `index`. Deterministic for a given seed. */
  spawnPoint(index: number): SpawnPoint
  /**
   * Height of the lava (or sea) surface at a world position, or -Infinity where there is
   * none. Vehicles use it for buoyancy.
   */
  liquidHeightAt?(x: number, z: number): number
  /**
   * The world's colour seen from straight above at (x, z), as 0xRRGGBB, for maps: its own
   * ground palette by height and slope, snow above its snow line, its sea, lake and rivers as
   * water or lava, and ice where the sea is frozen. O(1) per call after a one-off bake.
   */
  mapColourAt?(x: number, z: number): number
  /**
   * What mapColourAt's picture depends on, as a string: it changes exactly when that picture
   * would (a new world or seed, the sea level, the sea's kind, a freeze). Cheap, never bakes.
   */
  mapColourKey?(): string
  /** Horizontal water velocity in metres per second; writes into out. */
  liquidFlowAt?(x: number, z: number, out: { x: number; z: number }): { x: number; z: number }
  /**
   * What the liquid at a world position is: 'lava' is thick and sticky, 'water' floats a
   * vehicle. Null where the
   * ground stands above the liquid.
   */
  liquidKindAt?(x: number, z: number): 'lava' | 'water' | null
  /**
   * What the ground is made of at a world position (see terrain/surface.ts): mud, sand, snow,
   * rock, a road and so on. Tyre marks choose their look from it. Cheap enough to call per
   * wheel per mark; a stand-in terrain may leave it undefined.
   */
  surfaceAt?(x: number, z: number): SurfaceKind
  /**
   * Index of this world's look into the ground palettes (terrain/palettes.ts), so wheel
   * effects can colour marks and dust like the ground. A stand-in terrain may leave it out.
   */
  lookIndex?(): number
  /**
   * Called after the terrain regenerated in place (seed or a terrain parameter changed),
   * once the new mesh and collider exist. Use it to re-seat vehicles. Returns unsubscribe.
   */
  onRegenerate?(listener: () => void): () => void
  /**
   * Road centrelines of the current world, identical on every client. The arrays are
   * replaced on regeneration, so read them again in an `onRegenerate` listener.
   */
  roadPaths?(): readonly TerrainRoadPath[]
  /**
   * Flame, ember and smoke emitter anchors on the lava and the ground, identical on every
   * client. `size` is a rough emitter radius in metres. Replaced on regeneration.
   */
  vents?(): readonly TerrainVent[]
  /** The main volcano's summit, identical on every client. Null if the world has none. */
  summit?(): TerrainSummit | null
  /** Reduce or restore render detail (level of detail distances). Visual only. */
  setRenderQuality?(quality: TerrainRenderQuality): void
  /**
   * Side of the wrapping tile in metres: leaving by one edge arrives at the opposite one.
   * Every procedural world wraps; there is no switch. Only a stand-in terrain (tests, demo
   * pages) leaves this undefined. Positions are canonical in
   * [-wrapSize / 2, wrapSize / 2); compare positions with shared/wrap.ts.
   */
  readonly wrapSize?: number
  /** Bring p into the canonical range in place. Returns true if it moved (by whole tiles). */
  wrapPosition?(p: { x: number; z: number }): boolean
  /** The image of (x, z) nearest to (refX, refZ), written to `out`. */
  nearestTo?(x: number, z: number, refX: number, refZ: number, out: { x: number; z: number }): { x: number; z: number }
  dispose(): void
}

/** Rolling hills from a few sines. Deterministic, cheap, and obviously temporary. */
export function createPlaceholderTerrain(game: Game, seed: number): Terrain {
  const size = 600
  const segments = 128
  const s = seed * 0.37
  const height = (x: number, z: number) =>
    Math.sin(x * 0.02 + s) * 6 + Math.cos(z * 0.025 - s) * 5 + Math.sin((x + z) * 0.07) * 1.2

  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)))
  geometry.computeVertexNormals()

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9a4b2b, roughness: 1 }))
  mesh.receiveShadow = true
  game.scene.add(mesh)

  const collider = game.world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      new Float32Array(pos.array as ArrayLike<number>),
      new Uint32Array(geometry.index!.array as ArrayLike<number>),
    )
      .setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL))
      .setFriction(1),
  )

  return {
    size,
    heightAt: height,
    normalAt(x, z, out) {
      const e = 0.5
      return out
        .set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e))
        .normalize()
    },
    spawnPoint(index) {
      const a = index * 2.399963 // golden angle, so spawns spread without overlapping
      const r = 12 + index * 3
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      return { position: new THREE.Vector3(x, height(x, z) + 2, z), heading: 0 }
    },
    dispose() {
      game.scene.remove(mesh)
      geometry.dispose()
      game.world.removeCollider(collider, false)
    },
  }
}

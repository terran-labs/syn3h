/**
 * No hitch on the first shot.
 *
 * The renderer builds a material's shader and pipeline the first time something using it is
 * drawn. For gear that used to be the moment a player first fired, or first saw a bot fire:
 * a stall of tens of milliseconds in the middle of play, once for each gear item and again
 * for every bot, because each bot's gear had its own copies of the materials.
 *
 * Two helpers fix that:
 *
 * - `sharedLook` gives every user of a gear item in one game the same materials and
 *   geometry, so a bot's Bungee costs nothing the player's has not already paid for.
 * - `warmGear` draws each geometry and material pair for a few frames while the world is
 *   still appearing, too small and too close to the camera to cover a pixel. The pipelines
 *   are then built along with the rest of the scene. It does so again after a graphics level
 *   change or a change to the post effects, either of which replaces the render targets and
 *   with them every pipeline.
 *
 * Measured by tests/weapons/browser-gear-hitch.mjs.
 */
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game, System } from '../core/Game'
import { graphicsLevel } from '../core/quality'

/** Drawn frames to stay visible at the start: the first frames compile everything in view. */
const START_FRAMES = 12
/** After a graphics level change the new render chain can arrive some frames later. */
const CHANGE_FRAMES = 90
/** Proxies sit at the camera, this small: inside the near plane, so nothing is rasterised. */
const SCALE = 1e-3

export type WarmPair = readonly [THREE.BufferGeometry, THREE.Material]

class GearWarm implements System {
  readonly group = new THREE.Group()
  readonly each = new Set<() => void>()
  /** Drawn frames still to go; 0 when the proxies are out of the scene. */
  left = 0
  private drawn = false
  private level = graphicsLevel.value
  private readonly unlisten: () => void
  /** Counts for automated checks. */
  stats = { armed: 0, frames: 0 }

  constructor(private readonly game: Game) {
    this.group.scale.setScalar(SCALE)
    this.arm(START_FRAMES)
    // Graphics and post effect settings rebuild the render chain. Arming costs a few
    // zero-pixel draws for a second or so, so any of them is reason enough.
    this.unlisten = params.onChange((id) => { if (id.startsWith('post.') || id.startsWith('gfx.')) this.arm(CHANGE_FRAMES) })
  }

  add(pairs: readonly WarmPair[]): THREE.Mesh[] {
    const meshes = pairs.map(([geometry, material]) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      // Only frames that really draw count: the world is not rendered behind the lobby.
      mesh.onBeforeRender = () => { this.drawn = true }
      return mesh
    })
    if (meshes.length) this.group.add(...meshes)
    this.arm(START_FRAMES)
    return meshes
  }

  arm(frames: number): void {
    if (this.left === 0) { this.game.scene.add(this.group); this.stats.armed++ }
    this.left = Math.max(this.left, frames)
  }

  update(): void {
    if (this.level !== graphicsLevel.value) {
      this.level = graphicsLevel.value
      this.arm(CHANGE_FRAMES)
    }
    if (this.left === 0) return
    if (this.drawn) {
      this.drawn = false
      this.stats.frames++
      if (--this.left === 0) { this.game.scene.remove(this.group); return }
    }
    this.game.camera.getWorldPosition(this.group.position)
    for (const f of this.each) f()
  }

  dispose(): void {
    this.unlisten()
    this.game.scene.remove(this.group)
    this.group.clear()
    this.each.clear()
    this.left = 0
  }
}

const warms = new WeakMap<Game, { system: GearWarm; users: number }>()

/**
 * Compile these geometry and material pairs before they are needed. `each` runs on every
 * frame the proxies are out, for effects that can only be warmed by using them. Returns a
 * function that takes the proxies away again; it does not dispose what was passed in.
 */
export function warmGear(game: Game, pairs: readonly WarmPair[], each?: () => void): () => void {
  // Unit tests build gear on a bare object with no systems and no renderer: nothing to warm.
  if (typeof game.add !== 'function' || !game.camera) return () => {}
  let entry = warms.get(game)
  if (!entry) {
    entry = { system: new GearWarm(game), users: 0 }
    warms.set(game, entry)
    game.add(entry.system)
  }
  const { system } = entry
  entry.users++
  const meshes = system.add(pairs)
  if (each) system.each.add(each)
  let done = false
  return () => {
    if (done) return
    done = true
    if (meshes.length) system.group.remove(...meshes)
    if (each) system.each.delete(each)
    if (--entry.users === 0) { warms.delete(game); game.remove(system) }
  }
}

/** The warm-up's counters for this game, for automated checks; null if nothing was warmed. */
export function warmStats(game: Game): { armed: number; frames: number; left: number; proxies: number } | null {
  const s = warms.get(game)?.system
  return s ? { ...s.stats, left: s.left, proxies: s.group.children.length } : null
}

const looks = new WeakMap<Game, Map<string, { look: { dispose(): void }; users: number }>>()

/**
 * One look per game for each gear item, built by the first user and disposed with the last.
 * `release` must be called once by each caller.
 */
export function sharedLook<T extends { dispose(): void }>(game: Game, key: string, make: () => T): { look: T; release(): void } {
  let byKey = looks.get(game)
  if (!byKey) looks.set(game, byKey = new Map())
  let entry = byKey.get(key)
  if (!entry) byKey.set(key, entry = { look: make(), users: 0 })
  entry.users++
  const held = entry
  let done = false
  return {
    look: held.look as T,
    release: () => {
      if (done) return
      done = true
      if (--held.users > 0) return
      byKey.delete(key)
      held.look.dispose()
    },
  }
}

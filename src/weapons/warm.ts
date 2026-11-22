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
 * - `warmGear` draws the gear's geometry and material pairs and exposes its empty batches
 *   during covered entry. A short run of proxy draws also handles graphics and post effects
 *   changes during play, when the render chain and its pipelines can change.
 *
 * Measured by tests/weapons/browser-gear-hitch.mjs.
 */
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { CoveredWarm, Game, System } from '../core/Game'
import { graphicsLevel } from '../core/quality'

/** Drawn frames to stay visible at the start: the first frames compile everything in view. */
const START_FRAMES = 12
/** After a graphics level change the new render chain can arrive some frames later. */
const CHANGE_FRAMES = 90
/** Proxies sit at the camera, this small: inside the near plane, so nothing is rasterised. */
const SCALE = 1e-3

export type WarmPair = readonly [THREE.BufferGeometry, THREE.Material]
type WarmBatches = () => Iterable<THREE.Mesh>

/** Submit the live buffer layout even when its pool is empty. Only draw metadata changes. */
function exposeBatch(mesh: THREE.Mesh): () => void {
  const visible = mesh.visible
  const geometry = mesh.geometry
  const { start, count } = geometry.drawRange
  const instanced = geometry instanceof THREE.InstancedBufferGeometry ? geometry : null
  const empty = instanced?.instanceCount === 0
  mesh.visible = true
  if (count === 0) geometry.setDrawRange(0, 3)
  if (instanced && empty) instanced.instanceCount = 1
  return () => {
    mesh.visible = visible
    if (count === 0) geometry.setDrawRange(start, count)
    if (instanced && empty) instanced.instanceCount = 0
  }
}

class GearWarm implements System {
  readonly group = new THREE.Group()
  readonly each = new Set<() => void>()
  readonly batches = new Set<WarmBatches>()
  /** Drawn frames still to go; 0 when the proxies are out of the scene. */
  left = 0
  private drawn = false
  private level = graphicsLevel.value
  private readonly unlisten: () => void
  /** Counts for automated checks. */
  stats = { armed: 0, frames: 0 }
  /** Undo for the batches exposed this frame (exposeBatches), run at the next update. */
  private exposed: (() => void)[] = []

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
    this.restoreBatches()
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

  /**
   * While armed after a change, the live batches draw too, not only the proxy pairs: a level
   * change can move the scene to another render target (Minimal draws straight to the canvas,
   * Low into the post chain's multisampled scene pass), and a batch with nothing in it (no
   * firework alive, no Chaser out) would otherwise build its pipeline for it on first use.
   * Here, after every system's update and just before the draw, so no owner's own update (the
   * ground glow hiding its idle slots) can hide them again first.
   */
  prepareWorldDraw(): void {
    if (this.left > 0) this.exposeBatches()
  }

  /** Expose every registered batch for this frame's draw; undone at the next update. */
  private exposeBatches(): void {
    this.restoreBatches()
    for (const batches of this.batches) for (const mesh of batches()) this.exposed.push(exposeBatch(mesh))
  }

  private restoreBatches(): void {
    for (let i = this.exposed.length - 1; i >= 0; i--) this.exposed[i]()
    this.exposed = []
  }

  /**
   * A player's change of level, under its veil (Game's quality warm-up draws these hidden meshes
   * once for the new level): every registered batch, exposed so an empty one still draws.
   * Undone at the next update.
   */
  *precompileQualityMeshes(): Iterable<THREE.Mesh> {
    this.exposeBatches()
    this.level = graphicsLevel.value
    this.arm(CHANGE_FRAMES)
    for (const batches of this.batches) yield* batches()
    yield* this.group.children as THREE.Mesh[]
  }

  /**
   * The governor has just climbed, outside play, and the scene is about to be drawn once at the
   * new level (Game.prepareClimbedLevel): the batches and the proxies draw in it.
   */
  prepareClimb(): void {
    this.level = graphicsLevel.value
    this.arm(CHANGE_FRAMES)
    this.exposeBatches()
    this.game.camera.getWorldPosition(this.group.position)
    for (const f of this.each) f()
  }

  async warmCovered(warm: CoveredWarm): Promise<void> {
    if (!this.batches.size) return
    await warm.yieldFrame('Preparing gear effects')
    this.drawCoveredMinimal(warm.draw)
    this.level = graphicsLevel.value
    this.drawn = false
    this.left = 0
    this.group.removeFromParent()
    this.stats.frames++
  }

  drawCoveredMinimal(draw: () => void): void {
    const restore: (() => void)[] = []
    const wasAttached = this.group.parent === this.game.scene
    const position = this.group.position.clone()
    try {
      if (!wasAttached) this.game.scene.add(this.group)
      this.game.camera.getWorldPosition(this.group.position)
      for (const batches of this.batches) {
        for (const mesh of batches()) restore.push(exposeBatch(mesh))
      }
      draw()
    } finally {
      for (let i = restore.length - 1; i >= 0; i--) restore[i]()
      this.group.position.copy(position)
      if (!wasAttached) this.group.removeFromParent()
    }
  }

  dispose(): void {
    this.restoreBatches()
    this.unlisten()
    this.game.scene.remove(this.group)
    this.group.clear()
    this.each.clear()
    this.batches.clear()
    this.left = 0
  }
}

const warms = new WeakMap<Game, { system: GearWarm; users: number }>()

/**
 * Register gear pairs for proxy draws and live batches for covered entry. `each` runs with
 * the proxy draws during play. The returned cleanup releases the registration.
 */
export function warmGear(game: Game, pairs: readonly WarmPair[], each?: () => void, batches?: WarmBatches): () => void {
  // Unit tests build gear on a bare object with no systems and no renderer: nothing to warm.
  if (typeof game.add !== 'function' || !game.camera) return () => {}
  let entry = warms.get(game)
  if (!entry) {
    entry = { system: new GearWarm(game), users: 0 }
    warms.set(game, entry)
    game.add(entry.system, 'Gear warm-up')
  }
  const { system } = entry
  entry.users++
  const meshes = system.add(pairs)
  if (each) system.each.add(each)
  if (batches) system.batches.add(batches)
  let done = false
  return () => {
    if (done) return
    done = true
    if (meshes.length) system.group.remove(...meshes)
    if (each) system.each.delete(each)
    if (batches) system.batches.delete(batches)
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

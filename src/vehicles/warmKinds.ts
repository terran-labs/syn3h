/**
 * No hitch on the first switch to a vehicle kind.
 *
 * The renderer builds a material's node program, shaders and render pipeline the first time
 * something using it is drawn. Switching vehicles in place would pay that in the middle of
 * play, tens of milliseconds for a kind not yet seen.
 *
 * Why the warm copies are parked, not disposed: in three 0.187 every node builder state,
 * shader program and render pipeline is reference counted by the render objects using it
 * (NodeManager and Pipelines, `usedTimes`). Disposing a material or geometry disposes its
 * render objects, and the last one out releases the pipeline and its programs. So "build,
 * compile, dispose" undoes itself: the next vehicle of that kind compiles from scratch. The
 * warm copy must stay alive for the pipelines to stay cached. Each kind's copy is therefore
 * kept, out of the scene and with its physics body disabled, until `dispose()`.
 *
 * That includes the kind the player drives at load. While the player drives it, the player
 * holds its pipelines; the moment a switch disposes the player's vehicle they are released,
 * and switching back would compile again. Warm every kind, the current one too: it compiles
 * nothing new and only costs the build.
 *
 * How a kind is warmed, the same way as the gear (src/weapons/warm.ts): the real vehicle is
 * built with `createVehicle`, so its materials are exactly the ones a switch would build, and
 * drawn for a few frames at the camera, a thousandth of its size, inside the near plane, so
 * no pixel is covered. Drawing it in the real frame compiles it under the exact scene state
 * the game renders with: the lights, environment, fog node, shadow pass and the post chain's
 * render target format, all of which are part of the program or pipeline key. compileAsync
 * alone would miss the render target.
 *
 * Detail covered: the local, close range level (what a switch shows), with every part made
 * visible while it is drawn, so wing fields, lamps, gear and both stator levels of the buggy
 * compile even if they are hidden at that moment. Remote mid and far levels built lazily (the
 * jet's medium and far models) are not built and so not warmed: a switch does not show them.
 *
 * After a graphics level change every kind is built and drawn again: the render chain is new,
 * and some materials are chosen by level when they are built (the buggy's wing field). The
 * old copy is disposed only after its replacement has been drawn.
 *
 * It does not stall the load: one kind at a time, at least one frame between kinds, and a
 * model loading from a file is awaited, not blocked on. Start it after the first frame.
 */
import * as THREE from 'three/webgpu'
import type { Game, System } from '../core/Game'
import { graphicsLevel } from '../core/quality'
import type { Terrain } from '../world/Terrain'
import { type VehicleKind, VEHICLE_KINDS, createVehicle } from './index'
import type { Vehicle } from './Vehicle'

/** Drawn frames per kind. The first compiles; the rest catch passes that run every few frames. */
const DRAW_FRAMES = 3
/** Updates to wait after a graphics level change: the new render chain can arrive later. */
const LEVEL_CHANGE_DELAY = 60
/** Longest wait for a model file before the kind is drawn as it is. */
const READY_TIMEOUT_MS = 10_000
/** The proxy's scale: at the camera, this small, it is inside the near plane. */
const SCALE = 1e-3
/**
 * Updates to wait for a kind's draws before parking it anyway. Behind the lobby the world is
 * drawn twice a second, so this is about 15 s of lobby at 60 Hz; in play it is never reached.
 */
const MAX_WAIT_UPDATES = 900

export interface WarmKindsOptions {
  /** Kinds to warm, in order. Default: every kind in VEHICLE_KINDS, the current one included. */
  kinds?: readonly VehicleKind[]
  /** Drawn frames per kind. Default 3. */
  frames?: number
  /** Longest wait for a kind's model files. Default 10 s. */
  readyTimeoutMs?: number
}

export interface WarmKindsStats {
  /** Vehicles built for warming, over all rounds. */
  built: number
  /** Kinds whose copy has been drawn and parked in the current round. */
  parked: VehicleKind[]
  /** Drawn frames for each kind in the latest round. */
  frames: Partial<Record<VehicleKind, number>>
  /** Kinds whose model files did not arrive in time or failed; they were drawn as they were. */
  notReady: VehicleKind[]
  /** Kinds parked without the full number of drawn frames: no mesh to draw, or no frames came. */
  undrawn: VehicleKind[]
  /** 1 for the warm at load, plus one for each graphics level change. */
  rounds: number
  /** The kind being warmed, or null. */
  current: VehicleKind | null
}

export interface WarmKinds {
  /** Resolves when every kind of the current round is parked. Replaced by a new round. */
  readonly done: Promise<void>
  stats(): WarmKindsStats
  /** The parked copy of a kind, for checks. Do not drive or dispose it. */
  parked(kind: VehicleKind): Vehicle | undefined
  /** Dispose every copy and stop. Pipelines nothing else uses are released with them. */
  dispose(): void
}

interface Current {
  kind: VehicleKind
  vehicle: Vehicle
  ready: boolean
  drawn: number
  waited: number
  meshes: number
  hooked: WeakSet<THREE.Object3D>
  restore: (() => void)[]
}

class KindWarm implements System, WarmKinds {
  done!: Promise<void>
  private resolveDone: () => void = () => {}
  private readonly queue: VehicleKind[] = []
  private readonly copies = new Map<VehicleKind, Vehicle>()
  private current: Current | null = null
  /** Set by a hooked mesh's onBeforeRender; read and cleared on the next update. */
  private drew = false
  private gap = 0
  private level = graphicsLevel.value
  private levelDelay = -1
  private disposed = false
  private readonly s: WarmKindsStats = { built: 0, parked: [], frames: {}, notReady: [], undrawn: [], rounds: 0, current: null }
  private readonly camPos = new THREE.Vector3()

  constructor(
    private readonly game: Game,
    private readonly terrain: Terrain,
    private readonly kinds: readonly VehicleKind[],
    private readonly frames: number,
    private readonly readyTimeoutMs: number,
  ) {
    this.startRound()
  }

  private startRound(): void {
    this.s.rounds++
    this.s.parked = []
    this.s.frames = {}
    this.queue.length = 0
    this.queue.push(...this.kinds)
    this.done = new Promise(resolve => { this.resolveDone = resolve })
    if (!this.queue.length) this.resolveDone()
  }

  update(dt: number): void {
    if (this.disposed) return
    if (graphicsLevel.value !== this.level) {
      this.level = graphicsLevel.value
      this.levelDelay = LEVEL_CHANGE_DELAY
    }
    if (this.levelDelay >= 0 && this.levelDelay-- === 0) {
      // Finish nothing half drawn under the old chain: drop it, the new round builds it again.
      if (this.current) this.drop(this.current)
      this.startRound()
    }
    if (this.current) { this.step(this.current, dt); return }
    if (this.gap > 0) { this.gap--; return }
    const kind = this.queue.shift()
    if (kind) this.build(kind)
  }

  private build(kind: VehicleKind): void {
    // Built where the player spawns, high above it; the body is disabled before any step.
    const at = this.terrain.spawnPoint(0).position.clone()
    at.y += 500
    const vehicle = createVehicle(this.game, this.terrain, kind, at, 0)
    vehicle.isLocal = true
    vehicle.body.setEnabled(false)
    // Hidden until its model files are in, so the primitive stand-ins are not drawn alone.
    vehicle.object.visible = false
    this.s.built++
    this.s.current = kind
    const current: Current = { kind, vehicle, ready: false, drawn: 0, waited: 0, meshes: 0, hooked: new WeakSet(), restore: [] }
    this.current = current
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), this.readyTimeoutMs) })
    Promise.race([Promise.all(readyPromises(vehicle)).then(() => 'ok' as const), timeout])
      .catch(() => 'failed' as const)
      .then(result => {
        clearTimeout(timer)
        if (result !== 'ok') this.s.notReady.push(kind)
        current.ready = true
      })
  }

  private step(current: Current, dt: number): void {
    if (!current.ready) return
    if (this.drew) { this.drew = false; current.drawn++ }
    if (current.drawn >= this.frames) { this.park(current); return }
    // A model that failed to load leaves nothing to compile; a world never drawn, no frames.
    if ((current.waited > 0 && current.meshes === 0) || current.waited++ > MAX_WAIT_UPDATES) {
      this.s.undrawn.push(current.kind)
      this.park(current)
      return
    }
    const { vehicle } = current
    // The vehicle's own update builds lazily made parts (the jet's close model) and applies
    // its detail level; then it is moved onto the camera and shrunk.
    vehicle.update(dt, 1)
    vehicle.object.visible = true
    vehicle.object.traverse(o => {
      o.visible = true
      if (!(o as THREE.Mesh).isMesh || current.hooked.has(o)) return
      current.hooked.add(o)
      current.meshes++
      o.frustumCulled = false
      const before = o.onBeforeRender
      // Only frames that really draw count: the world is drawn twice a second behind the lobby.
      o.onBeforeRender = (...args) => { this.drew = true; before.apply(o, args) }
      current.restore.push(() => { o.onBeforeRender = before })
    })
    this.game.camera.getWorldPosition(this.camPos)
    vehicle.object.position.copy(this.camPos)
    vehicle.object.scale.setScalar(SCALE)
  }

  private park(current: Current): void {
    const { kind, vehicle } = current
    this.game.scene.remove(vehicle.object)
    for (const r of current.restore) r()
    this.s.frames[kind] = current.drawn
    // The previous round's copy goes only now, after its replacement holds the pipelines.
    const old = this.copies.get(kind)
    if (old && old !== vehicle) old.dispose()
    this.copies.set(kind, vehicle)
    this.s.parked.push(kind)
    this.current = null
    this.s.current = null
    this.gap = 1
    if (!this.queue.length) this.resolveDone()
  }

  private drop(current: Current): void {
    for (const r of current.restore) r()
    current.vehicle.dispose()
    this.current = null
    this.s.current = null
  }

  stats(): WarmKindsStats {
    return { ...this.s, parked: [...this.s.parked], frames: { ...this.s.frames }, notReady: [...this.s.notReady], undrawn: [...this.s.undrawn] }
  }

  parked(kind: VehicleKind): Vehicle | undefined { return this.copies.get(kind) }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.current) this.drop(this.current)
    for (const v of this.copies.values()) v.dispose()
    this.copies.clear()
    this.queue.length = 0
    this.resolveDone()
    // Game.remove disposes the system again, which returns at once; either path ends here.
    this.game.remove?.(this)
  }
}

/**
 * Promises a vehicle exposes for its model files: a field that is a promise, or holds one as
 * `ready` (a skin, a VehicleModel), or an array of those. The buggy's skin and the tank's
 * models are found this way; generated vehicles have none and are ready at once.
 */
function readyPromises(vehicle: Vehicle): Promise<unknown>[] {
  const out: Promise<unknown>[] = []
  const look = (value: unknown) => {
    if (value instanceof Promise) out.push(value)
    else if (value && typeof value === 'object' && (value as { ready?: unknown }).ready instanceof Promise) out.push((value as { ready: Promise<unknown> }).ready)
  }
  for (const value of Object.values(vehicle)) {
    if (Array.isArray(value)) value.forEach(look)
    else look(value)
  }
  return out
}

/**
 * Warm every vehicle kind so a switch compiles nothing. Registers a system on `game`; call
 * after the first frame is on screen. Keep the handle and call `dispose()` with the world.
 */
export function warmVehicleKinds(game: Game, terrain: Terrain, options: WarmKindsOptions = {}): WarmKinds {
  const warm = new KindWarm(game, terrain, options.kinds ?? VEHICLE_KINDS.map(k => k.kind), options.frames ?? DRAW_FRAMES, options.readyTimeoutMs ?? READY_TIMEOUT_MS)
  game.add(warm)
  return warm
}

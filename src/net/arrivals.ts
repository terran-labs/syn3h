/**
 * Remote vehicles appear one at a time, compiled before they are shown.
 *
 * A guest joining a room full of bots used to meet every one of them in one frame: each a
 * vehicle whose shaders compiled the first time it was drawn. Here a new remote's vehicle is
 * parked (no body in the world, nothing drawn) while its shaders compile a slice per frame,
 * and only then revealed. Network state is still received and applied from the first message:
 * only the showing waits, so a vehicle appears where it is now, never where it was.
 *
 * While compiling ahead is off, people are shown at once and bots compile in the frame they are
 * shown, still one per interval, so their compiles are spread over separate frames.
 *
 * People are never queued behind bots: a person is shown as soon as their vehicle is compiled.
 * Bots follow, one per interval (`bots.arrivalInterval`, as on the host). A remote that leaves
 * while waiting is simply dropped. Presentation only: nothing here touches the protocol.
 */
import type { Object3D } from 'three/webgpu'
import { canCompileAhead, compileVehicleAhead, hasGame } from '../core/compileAhead'
import { graphicsLevel } from '../core/quality'
import { arrivalInterval } from '../bots/pacing'

export interface ParkableVehicle {
  readonly object: Object3D
  readonly isLocal?: boolean
  setParked(parked: boolean): void
  update?(dt: number, alpha: number): void
}

interface Waiting { id: number; vehicle: ParkableVehicle; person: boolean; ready: boolean }

export class RemoteArrivals {
  private readonly waiting: Waiting[] = []
  private last = -Infinity

  constructor(
    /** Shown: the arrival cloud's look, for a vehicle placed by the network. */
    private readonly reveal: (vehicle: ParkableVehicle) => void = () => {},
    private readonly interval: () => number = () => arrivalInterval.value,
    /**
     * Compile a vehicle in every look it may wear first; null with no running game. While
     * compiling ahead is off (Game.compilesAhead) a person is shown at once, as before, and a
     * bot is ready at once and compiles on first sight, but bots are still shown one per
     * interval, so their compiles fall in separate frames instead of all in one.
     */
    private readonly compile: (vehicle: ParkableVehicle, person: boolean) => Promise<void> | null = (vehicle, person) => canCompileAhead() ? compileVehicleAhead(vehicle, graphicsLevel.value) : hasGame() && !person ? Promise.resolve() : null,
  ) {}

  /** Remotes still waiting to be shown. */
  get pending(): number { return this.waiting.length }
  isWaiting(id: number): boolean { return this.waiting.some(w => w.id === id) }

  /** A new remote: park its vehicle and compile it; it is shown by `update` when its turn comes. */
  admit(id: number, vehicle: ParkableVehicle, person: boolean): void {
    const ahead = (() => { try { return this.compile(vehicle, person) } catch { return null } })()
    // No running game to compile in (tests, a lost renderer): show it at once, as before.
    if (!ahead) return
    vehicle.setParked(true)
    const entry: Waiting = { id, vehicle, person, ready: !ahead }
    this.waiting.push(entry)
    ahead?.then(() => { entry.ready = true }, () => { entry.ready = true })
  }

  /** The remote left. If it was still waiting it is forgotten; the caller disposes its vehicle. */
  drop(id: number): void {
    const at = this.waiting.findIndex(w => w.id === id)
    if (at >= 0) this.waiting.splice(at, 1)
  }

  /** Each frame: show every ready person, and at most one ready bot per interval. */
  update(now = performance.now()): void {
    for (let i = 0; i < this.waiting.length; i++) {
      const w = this.waiting[i]
      if (!w.person || !w.ready) continue
      this.waiting.splice(i--, 1); this.show(w)
    }
    if (now - this.last < Math.max(0, this.interval()) * 1000) return
    const bot = this.waiting.find(w => w.ready)
    if (!bot) return
    this.waiting.splice(this.waiting.indexOf(bot), 1); this.last = now; this.show(bot)
  }

  private show(w: Waiting): void {
    w.vehicle.setParked(false)
    try { this.reveal(w.vehicle) } catch (error) { console.warn('Remote arrival effect failed', error) }
  }

  /** Everything still waiting is shown now (leaving the room, a world change). */
  flush(): void { for (const w of this.waiting.splice(0)) this.show(w) }
}

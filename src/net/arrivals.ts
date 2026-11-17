/**
 * Remote bots appear one at a time; people at once.
 *
 * A guest joining a room full of bots used to meet every one of them in one frame: each a
 * vehicle whose shaders compiled the first time it was drawn, all in that frame. Here a new
 * remote bot's vehicle is parked (no body in the world, nothing drawn) and revealed one per
 * interval (`bots.arrivalInterval`, as on the host), so those first-sight compiles fall in
 * separate frames. Network state is still received and applied from the first message: only
 * the showing waits, so a vehicle appears where it is now, never where it was.
 *
 * People are never queued behind bots: a person is shown at once. A remote that leaves while
 * waiting is simply dropped. Presentation only: nothing here touches the protocol.
 */
import type { Object3D } from 'three/webgpu'
import { arrivalInterval } from '../bots/pacing'

export interface ParkableVehicle {
  readonly object: Object3D
  readonly isLocal?: boolean
  setParked(parked: boolean): void
  update?(dt: number, alpha: number): void
}

interface Waiting { id: number; vehicle: ParkableVehicle; person: boolean; ready: boolean }

/** True when the vehicle belongs to a running game (one that draws), not a test or headless one. */
function runningGame(vehicle: ParkableVehicle): boolean {
  return typeof (vehicle as { game?: { precompile?: unknown } }).game?.precompile === 'function'
}

export class RemoteArrivals {
  private readonly waiting: Waiting[] = []
  private last = -Infinity

  constructor(
    /** Shown: the arrival cloud's look, for a vehicle placed by the network. */
    private readonly reveal: (vehicle: ParkableVehicle) => void = () => {},
    private readonly interval: () => number = () => arrivalInterval.value,
    /**
     * When a new remote may be shown: null to show it at once, or a promise that settles when it
     * may take its turn. In a running game a person is shown at once and a bot waits its turn,
     * so bots' first-sight shader compiles fall in separate frames instead of all in one.
     * Without a running game (tests, headless simulations) everything is shown at once.
     */
    private readonly compile: (vehicle: ParkableVehicle, person: boolean) => Promise<void> | null = (vehicle, person) => !person && runningGame(vehicle) ? Promise.resolve() : null,
  ) {}

  /** Remotes still waiting to be shown. */
  get pending(): number { return this.waiting.length }
  isWaiting(id: number): boolean { return this.waiting.some(w => w.id === id) }

  /** A new remote: park its vehicle; it is shown by `update` when its turn comes. */
  admit(id: number, vehicle: ParkableVehicle, person: boolean): void {
    const ahead = (() => { try { return this.compile(vehicle, person) } catch { return null } })()
    // A person, or no running game: show it at once.
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

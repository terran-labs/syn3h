/** Pure window and bounded disturbance bookkeeping, shared with tests. */
export function snappedOrigin(x: number, z: number, cells = 256, metres = 128) {
  const cell = metres / cells
  return { x: Math.floor(x / cell) * cell - metres / 2, z: Math.floor(z / cell) * cell - metres / 2 }
}
export function windowShift(old: {x:number;z:number}, next: {x:number;z:number}, cell: number) {
  return { x: Math.round((next.x-old.x)/cell), z: Math.round((next.z-old.z)/cell) }
}
export interface Disturbance { x:number; z:number; radius:number; strength:number }
export class DisturbanceQueue {
  readonly events: Disturbance[] = []
  push(x:number,z:number,radius:number,strength:number) {
    if (![x,z,radius,strength].every(Number.isFinite) || radius <= 0) return
    if (this.events.length >= 32) this.events.shift()
    this.events.push({x,z,radius,strength:Math.max(-2,Math.min(2,strength))})
  }
  drain() { return this.events.splice(0) }
}
/**
 * When the ripple field needs simulating. Nothing moves it but disturbances (hulls, splashes),
 * and each step damps it by 0.8 per cent, so `settle` seconds after the last one it is flat
 * to well under a millimetre. Until the next disturbance there is nothing to compute: a dry
 * world, lava, the lobby and a parked vehicle all cost no passes at all.
 */
export class RippleSleep {
  private quiet = Infinity
  constructor(readonly settle = 10) {}
  /** Call once a frame with the disturbances waiting. True while the field must run. */
  step(pending: number, dt: number): boolean {
    if (pending > 0) this.quiet = 0
    else this.quiet += Math.max(0, dt)
    return this.quiet < this.settle
  }
  reset(): void { this.quiet = Infinity }
}

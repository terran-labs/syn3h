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

/**
 * Pester steering, free of Three.js so it can be tested alone. A Pester flies at a set speed
 * and turns its velocity toward its target at a limited rate, so it swings wide on a hard
 * turn and a driver who jinks at the last moment can make it overshoot. It never dives
 * under `floor`. Every client steers every Pester toward its own view of the target; only the
 * target's own client, where the target is exact, decides whether it was caught.
 */
export type V3 = [number, number, number]

/** One step: new velocity, in place, toward `to` (target minus Pester position). */
export function steer(vel: V3, to: V3, speed: number, turn: number, dt: number): void {
  const d = Math.hypot(to[0], to[1], to[2])
  if (d > 1e-6) {
    const k = Math.min(1, turn * dt)
    for (let i = 0; i < 3; i++) vel[i] += ((to[i] / d) * speed - vel[i]) * k
  }
  const v = Math.hypot(vel[0], vel[1], vel[2])
  if (v > 1e-6) for (let i = 0; i < 3; i++) vel[i] *= speed / v
}

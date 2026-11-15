/**
 * Clouds drift with the wind.
 *
 * The sky shader used to slide its cloud pattern along a fixed diagonal by time * cloudSpeed.
 * Now Environment advances `sky.cloudOffset` here each frame: the same speed at storminess 0
 * (cloudSpeed per second on each axis, so sqrt(2) cloudSpeed along the diagonal), pointed
 * downwind, and faster as the weather turns stormy. Accumulated rather than computed from
 * time, so a drifting wind heading turns the clouds smoothly instead of jumping them.
 *
 * On an airless world the clouds move exactly as before (the Moon has none anyway).
 */
import type { Terrain } from '../Terrain'
import { type WindFrame, currentWindFrame, weatherTime, windHeading } from './wind'

/** How much faster the clouds move in a gale than in calm air. */
export const CLOUD_STORM_SPEEDUP = 2

const frame = {} as WindFrame

/** Advance a cloud UV offset by one frame. `speed` is the `weather.cloudSpeed` slider. */
export function advanceCloudDrift(offset: { x: number; y: number }, speed: number, dt: number, terrain?: Partial<Terrain> | null): void {
  const f = currentWindFrame(terrain, frame)
  if (!(f.atmosphere > 0)) {
    // Today's motion: the shader's old `+ time * cloudSpeed` on both axes.
    offset.x += speed * dt
    offset.y += speed * dt
    return
  }
  const a = windHeading(f, weatherTime())
  const s = Math.SQRT2 * speed * (1 + CLOUD_STORM_SPEEDUP * f.storminess) * dt
  // Moving the lookup against the wind carries the pattern downwind.
  offset.x -= Math.cos(a) * s
  offset.y -= Math.sin(a) * s
}

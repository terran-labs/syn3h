/**
 * How much daylight falls on liquids, 1 at noon down to 0.3 at night: one render-group uniform
 * that water surfaces seen from below and splashes multiply their self-lit colours by, since
 * those are unlit and would otherwise glow at night. Set once a frame by `Underwater.update`.
 */
import { renderGroup, uniform } from 'three/tsl'

export const liquidDaylight = { value: 1 }
export const liquidDaylightNode = uniform(1).setGroup(renderGroup).onRenderUpdate(() => liquidDaylight.value)

/**
 * 1 while the camera is in water, else 0. Seen from above, the only underside of a water
 * surface in view is the far sea curving away past the planet's horizon, which must not draw;
 * from below the underside is the surface itself. Set by `Underwater.update`.
 */
export const cameraInWater = { value: 0 }
export const cameraInWaterNode = uniform(0).setGroup(renderGroup).onRenderUpdate(() => cameraInWater.value)

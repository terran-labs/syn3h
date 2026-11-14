/**
 * Network tuning. Personal ('client' scope): each player picks what suits their connection.
 * Defaults follow the original VehicleNet.js.
 */
import { defineParam } from '../../shared/params'

/** States sent per second. The original sent 15 (Settings.js 1589); the proposal asks for 20. */
export const netSendRate = defineParam({
  id: 'net.sendRate', label: 'Send rate', group: 'Network', scope: 'client',
  default: 20, min: 5, max: 60, step: 1,
})

/** Seconds remote vehicles are shown in the past. 0 means automatic, as in the original. */
export const netInterpDelay = defineParam({
  id: 'net.interpDelay', label: 'Interp delay (0 auto)', group: 'Network', scope: 'client',
  default: 0, min: 0, max: 1, step: 0.01,
})

/** Remote vehicles closer than this stay physical so ramming works (VehicleNet.js 59). */
export const netProxyRadius = defineParam({
  id: 'net.proxyRadius', label: 'Physical radius', group: 'Network', scope: 'client',
  default: 40, min: 0, max: 200, step: 1,
})

/** Fraction of the way a physical proxy moves toward its snapshot each step (VehicleNet.js 4). */
export const netProxyBlend = defineParam({
  id: 'net.proxyBlend', label: 'Physical blend', group: 'Network', scope: 'client',
  default: 0.1, min: 0.01, max: 1, step: 0.01,
})

/** Seconds to extrapolate past the newest snapshot before "not responding" (VehicleNet.js 114). */
export const netExtrapolate = defineParam({
  id: 'net.extrapolate', label: 'Max extrapolation', group: 'Network', scope: 'client',
  default: 1, min: 0, max: 3, step: 0.05,
})

/**
 * Network tuning. Personal ('client' scope): each player picks what suits their connection.
 * Defaults follow the original VehicleNet.js.
 */
import { defineParam, params } from '../../shared/params'

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

/**
 * The most the automatic delay may grow to, seconds. Past this, remote vehicles are carried
 * forward along their last known velocity instead of being shown later still. See
 * SnapshotBuffer.delay for the measurements behind the default.
 */
export const netMaxDelay = defineParam({
  id: 'net.maxDelay', label: 'Max auto delay', group: 'Network', scope: 'client',
  default: 0.15, min: 0.1, max: 1, step: 0.01,
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

/**
 * Take on a room's whole world. A room's stored values may lack a world parameter: one added
 * to the game after the room was stored, or one the server never registered. Applying only
 * what the room has would leave such a parameter at whatever this client happened to hold (a
 * `?planet=` or `?seed=` from the URL, a slider moved offline), and two clients would then
 * build different islands from "the same" room. So every world parameter the room does not
 * mention goes back to its registered default first; everyone ends on the same values.
 * Personal (client scope) parameters are never touched.
 */
export function applyRoomWorld(values: Record<string, unknown>): void {
  for (const p of params.all()) {
    if (p.def.scope !== 'world' || p.def.id in values) continue
    if (p.value !== p.def.default) params.set(p.def.id, p.def.default, 'remote')
  }
  params.applySnapshot(values, 'remote')
}

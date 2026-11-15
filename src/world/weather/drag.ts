/**
 * Wind on a body: aerodynamic drag on the air moving past it.
 *
 * Drag is 0.5 * rho * CdA * |r| r, where r is the air velocity relative to the body. Every
 * vehicle already has its own still-air handling (its original port's drag and damping), so
 * what the wind adds is the difference between drag in this wind and drag in still air:
 *
 *   F = 0.5 * rho * CdA * (|w - v| (w - v) - |v| (-v))
 *
 * With no wind that is exactly zero, so physics is unchanged. It is also why a headwind
 * matters more the faster you go, as it does on a real bicycle.
 *
 * Exposure is CdA, in square metres, per vehicle kind, so vehicles differ without special
 * cases. A zorb ball uses its real current radius.
 */
import type { Vec3Like } from './wind'

/**
 * Air density used for game forces, kg/m^3, at atmosphere 1. Lower than Earth's 1.2 because
 * the vehicles keep the light masses of their Unity originals (a buggy is 30 kg): with real
 * air a breeze would throw them like leaves. Tuned so a zorb ball on the summit at the
 * recommended storminess feels about a third of g in a gust.
 */
export const GAME_AIR_DENSITY = 0.015

/** Drag coefficient of a sphere. */
export const SPHERE_CD = 0.47

/**
 * CdA in square metres by vehicle kind, closed and with wings or flight surfaces out. The
 * tank is heavy (about 250 kg) and low, so it barely notices; the hovercraft floats on a
 * cushion with little grip, so the same push makes it drift.
 */
export const EXPOSURE: Record<string, { closed: number; open: number }> = {
  buggy: { closed: 1.5, open: 8 },
  'buggy-syn3h': { closed: 1.5, open: 8 },
  'buggy-classic': { closed: 1.5, open: 7 },
  hovercraft: { closed: 4, open: 4 },
  jet: { closed: 4, open: 8 },
  tank: { closed: 6, open: 6 },
}
const FALLBACK = { closed: 2, open: 4 }

/** What the drag needs to know about a vehicle. */
export interface Exposed {
  kind: string
  wingsOpen: boolean
  zorbed: boolean
  zorb: { radius: number }
}

/** CdA of a vehicle as it is right now, m^2. */
export function exposureOf(v: Exposed): number {
  if (v.zorbed && v.zorb.radius > 0) return SPHERE_CD * Math.PI * v.zorb.radius * v.zorb.radius
  const e = EXPOSURE[v.kind] ?? FALLBACK
  return v.wingsOpen ? e.open : e.closed
}

/**
 * Acceleration from wind `w` on a body moving at `v`, m/s^2, written into `out`.
 * `cda` in m^2, `mass` in kg, `air` the atmosphere 0..1.
 */
export function windAcceleration<T extends Vec3Like>(
  w: Vec3Like, v: Vec3Like, cda: number, mass: number, air: number, out: T,
): T {
  out.x = 0; out.y = 0; out.z = 0
  if (mass <= 0 || cda <= 0 || air <= 0 || (w.x === 0 && w.y === 0 && w.z === 0)) return out
  const rx = w.x - v.x, ry = w.y - v.y, rz = w.z - v.z
  const r = Math.hypot(rx, ry, rz)
  const s = Math.hypot(v.x, v.y, v.z)
  const k = 0.5 * GAME_AIR_DENSITY * air * cda / mass
  out.x = k * (r * rx + s * v.x)
  out.y = k * (r * ry + s * v.y)
  out.z = k * (r * rz + s * v.z)
  return out
}

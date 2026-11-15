/**
 * Shared road dimensions, independent of generation passes. Keep this module free of
 * imports: roads, rivers and forests must be able to initialize in any entry order.
 */

/** Water depth over the road that a ford is built to. */
export const FORD_DEPTH = 0.35
/** Painted width. */
export const ROAD_WIDTH = 11
/**
 * Half width of the perfectly level strip. Wider than the paint because the collider is
 * a 4 m triangle grid: a point 3.5 m off centre interpolates samples up to ~9 m out.
 */
export const ROAD_FLAT_HALF = 9.5
/** Blend from the level strip back to natural ground. */
export const ROAD_SHOULDER = 12
/** Longitudinal grade cap of the road profile: 0.2 is about 11.3 degrees. */
export const MAX_GRADE = 0.2

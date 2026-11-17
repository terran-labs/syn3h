/** Fraction of a vertical body interval below the liquid surface. */
export function submergedFraction(bottom:number,top:number,surface:number):number {
  if(![bottom,top,surface].every(Number.isFinite)||top<=bottom)return 0
  return Math.max(0,Math.min(1,(surface-bottom)/(top-bottom)))
}
/** Beer-Lambert transmittance at depth or along a viewing ray, in metres. */
export function waterTransmission(distance:number,extinction=.085):number {
  return Math.exp(-Math.max(0,extinction)*Math.max(0,distance))
}
/**
 * Least light reaching any depth a vehicle can be at, as a fraction of the light just under the
 * surface. Real water goes dark; this is a game, and the bed must stay drivable, so the falloff
 * is physical near the top and levels out here.
 */
export const UNDERWATER_LIGHT_FLOOR = .5

export interface UnderwaterSettings {
  /** water.underBrightness: scales the light in the water (1 ships). */
  brightness: number
  /** water.underVisibility: metres at which a tenth of an object's own colour survives. */
  visibility: number
  /** 1 at noon, lower at night: the light that falls on the surface. */
  daylight: number
  /** The planet's shallow and deep water colours, linear. */
  shallow: readonly [number, number, number]
  deep: readonly [number, number, number]
}
export const UNDERWATER_DEFAULTS: UnderwaterSettings = { brightness: 1, visibility: 38, daylight: 1, shallow: [.028, .55, .51], deep: [.003, .035, .12] }

/**
 * What the water looks like at a depth below its surface. `transmission` is the share of the
 * sun and sky reaching that depth (scales the lights), `extinction` the fog's per-metre loss
 * along a sight line, and red, green and blue the colour the water itself glows with: the
 * planet's shallow colour near the top, leaning to its deep colour lower down, lit by however
 * much light gets there.
 */
export function underwaterLook(depth: number, s: UnderwaterSettings = UNDERWATER_DEFAULTS) {
  const d = Math.max(0, depth)
  // Light comes down roughly along the vertical: lose it at a third of the sight-line rate.
  const extinction = 2.3 / Math.max(1, s.visibility)
  const transmission = UNDERWATER_LIGHT_FLOOR + (1 - UNDERWATER_LIGHT_FLOOR) * Math.exp(-extinction * d / 3)
  const deepness = 1 - Math.exp(-d / 30)
  // Scattered light is a fraction of what arrives: 0.6 of it reads as bright, clear water.
  const gain = .6 * Math.max(0, s.brightness) * Math.max(0, s.daylight) * transmission
  const mixc = (i: 0 | 1 | 2) => (s.shallow[i] + (s.deep[i] * 3 - s.shallow[i]) * deepness * .5) * gain
  return { transmission, extinction, red: mixc(0), green: mixc(1), blue: mixc(2) }
}

/** Relative luminance of a linear colour. */
export const luminance = (r: number, g: number, b: number) => .2126 * r + .7152 * g + .0722 * b

/** Vertical half extent of an oriented box. Quaternion is a unit world rotation. */
export function verticalHalfExtent(h:{x:number;y:number;z:number},q:{x:number;y:number;z:number;w:number}):number {
  return Math.abs(2*(q.x*q.y+q.w*q.z))*h.x+Math.abs(1-2*(q.x*q.x+q.z*q.z))*h.y+Math.abs(2*(q.y*q.z-q.w*q.x))*h.z
}
/** Underwater look against lens depth: eased over the first 0.45 m so it arrives with the camera. */
export function underwaterRamp(depth:number):number {
  const t=Math.max(0,Math.min(1,depth/.45))
  return t*t*(3-2*t)
}

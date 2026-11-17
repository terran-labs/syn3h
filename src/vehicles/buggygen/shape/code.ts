import { HANDLES, clampShape, defaultShape, type Shape } from './handles'

/**
 * Share codes: one URL-safe base64 character for the version, then one per handle holding its
 * step count from the handle's minimum. Every handle has at most 63 steps, so 15 handles make
 * a 16 character code. A new handle or a changed range needs a new version.
 */
export const CODE_VERSION = 1
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function encodeShape(s: Shape): string {
  return B64[CODE_VERSION] + HANDLES.map(h => B64[Math.round((Math.min(h.max, Math.max(h.min, s[h.id])) - h.min) / h.step)]).join('')
}

/** Back to a shape; anything unreadable or of another version is the default shape. */
export function decodeShape(code: string): Shape {
  const d = [...code].map(ch => B64.indexOf(ch))
  if (d[0] !== CODE_VERSION || d.length !== HANDLES.length + 1 || d.some(v => v < 0)) return defaultShape()
  const s: Partial<Shape> = {}
  HANDLES.forEach((h, i) => { s[h.id] = h.min + d[i + 1] * h.step })
  return clampShape(s)
}

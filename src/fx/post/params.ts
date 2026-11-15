/**
 * Post effect sliders. All client scope, one group, so they appear together under
 * Settings > Advanced > Post and are never shared with the room.
 *
 * Every strength is a uniform: dragging a slider costs nothing. Taking a strength to 0
 * removes that effect from the pipeline at the next frame (one shader rebuild), so an
 * effect that is off costs nothing either.
 */
import { defineParam, params } from '../../../shared/params'

const g = 'Post'
const c = 'client' as const

export const postOn = defineParam({ id: 'post.on', label: 'Post effects on', group: g, scope: c, default: false })
export const postTablets = defineParam({ id: 'post.tablets', label: 'Post effects on phones and tablets (unmeasured)', group: g, scope: c, default: false })

export const postBloom = defineParam({ id: 'post.bloom', label: 'Glow strength', group: g, scope: c, default: 0.5, min: 0, max: 1.5, step: 0.05 })
export const postBloomThreshold = defineParam({ id: 'post.bloomThreshold', label: 'Glow threshold (on-screen brightness)', group: g, scope: c, default: 3, min: 0.5, max: 6, step: 0.05 })
export const postBloomRadius = defineParam({ id: 'post.bloomRadius', label: 'Glow radius', group: g, scope: c, default: 0.4, min: 0, max: 1, step: 0.05 })

export const postShafts = defineParam({ id: 'post.shafts', label: 'Sun shafts', group: g, scope: c, default: 0.7, min: 0, max: 2, step: 0.05 })
export const postShaftLength = defineParam({ id: 'post.shaftLength', label: 'Sun shaft length', group: g, scope: c, default: 0.9, min: 0.2, max: 1, step: 0.05 })
export const postShaftReach = defineParam({ id: 'post.shaftReach', label: 'Sun shaft source size', group: g, scope: c, default: 0.12, min: 0.03, max: 0.5, step: 0.01 })
export const postLowSun = defineParam({ id: 'post.lowSun', label: 'Extra shafts at low sun', group: g, scope: c, default: 0.6, min: 0, max: 3, step: 0.05 })
export const postFlare = defineParam({ id: 'post.flare', label: 'Lens streak and ghosts', group: g, scope: c, default: 0.5, min: 0, max: 2, step: 0.05 })

export const postStreaks = defineParam({ id: 'post.streaks', label: 'Speed streaks', group: g, scope: c, default: 0.6, min: 0, max: 2, step: 0.05 })
export const postStreakSpeed = defineParam({ id: 'post.streakSpeed', label: 'Speed streaks start at (m/s)', group: g, scope: c, default: 45, min: 10, max: 200, step: 5 })

export const postLook = defineParam({ id: 'post.look', label: 'Planet colour look', group: g, scope: c, default: 1, min: 0, max: 2, step: 0.05 })
export const postContrast = defineParam({ id: 'post.contrast', label: 'Contrast', group: g, scope: c, default: 0, min: -0.5, max: 0.5, step: 0.01 })
export const postSaturation = defineParam({ id: 'post.saturation', label: 'Saturation', group: g, scope: c, default: 1, min: 0, max: 2, step: 0.01 })
export const postWarmth = defineParam({ id: 'post.warmth', label: 'Warmth', group: g, scope: c, default: 0, min: -1, max: 1, step: 0.01 })
export const postVignette = defineParam({ id: 'post.vignette', label: 'Vignette', group: g, scope: c, default: 0.3, min: 0, max: 1, step: 0.01 })
export const postGrain = defineParam({ id: 'post.grain', label: 'Film grain', group: g, scope: c, default: 0.35, min: 0, max: 2, step: 0.05 })

/** `?post=1` turns post effects on for this page load and `?post=0` off, for checks and comparisons. */
export function postOverride(search: string): boolean | undefined {
  const value = new URLSearchParams(search).get('post')
  if (value === null) return undefined
  return value !== '0' && value !== 'false' && value !== 'off'
}
if (typeof location !== 'undefined') {
  const on = postOverride(location.search)
  if (on !== undefined) params.set(postOn.def.id, on)
}

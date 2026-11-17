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

export const postOn = defineParam({ id: 'post.on', label: 'Post effects on', group: g, scope: c, default: true })
export const postTemporal = defineParam({ id: 'post.temporal', label: 'Temporal antialiasing', group: g, scope: c, default: true })

export const postBloom = defineParam({ id: 'post.bloom', label: 'Glow strength', group: g, scope: c, default: 0.5, min: 0, max: 1.5, step: 0.05 })
export const postBloomThreshold = defineParam({ id: 'post.bloomThreshold', label: 'Glow threshold (on-screen brightness)', group: g, scope: c, default: 3, min: 0.5, max: 6, step: 0.05 })
export const postBloomRadius = defineParam({ id: 'post.bloomRadius', label: 'Glow radius', group: g, scope: c, default: 0.4, min: 0, max: 1, step: 0.05 })

export const postShafts = defineParam({ id: 'post.shafts', label: 'Sun shafts', group: g, scope: c, default: 1, min: 0, max: 2, step: 0.05 })
export const postShaftLength = defineParam({ id: 'post.shaftLength', label: 'Sun shaft length', group: g, scope: c, default: 0.9, min: 0.2, max: 1, step: 0.05 })
/**
 * Share of the low sun's glow the shafts add in front of what blocks it (cloud, and terrain
 * by its distance), as lit haze. 0 leaves occluders dark; open sky always gets it all back.
 */
export const postShaftHaze = defineParam({ id: 'post.shaftHaze', label: 'Sun shaft haze', group: g, scope: c, default: 0.35, min: 0, max: 1, step: 0.05 })
/** How far from the sun (screen heights) the gaps and clouds that shape the beams are weighed. */
export const postShaftReach = defineParam({ id: 'post.shaftReach', label: 'Sun shaft source size', group: g, scope: c, default: 0.05, min: 0.02, max: 0.5, step: 0.01 })
export const postLowSun = defineParam({ id: 'post.lowSun', label: 'Extra shafts at low sun', group: g, scope: c, default: 0.6, min: 0, max: 3, step: 0.05 })
export const postFlare = defineParam({ id: 'post.flare', label: 'Lens streak and ghosts', group: g, scope: c, default: 0.5, min: 0, max: 2, step: 0.05 })

export const postMotionBlur = defineParam({ id: 'post.motionBlur', label: 'Motion blur (shutter)', group: g, scope: c, default: 0.5, min: 0, max: 1.5, step: 0.05 })
export const postMotionNear = defineParam({ id: 'post.motionNear', label: 'Motion blur starts past (m)', group: g, scope: c, default: 14, min: 2, max: 60, step: 1 })

export const postAO = defineParam({ id: 'post.ao', label: 'Ambient occlusion', group: g, scope: c, default: 1, min: 0, max: 2, step: 0.05 })
export const postGI = defineParam({ id: 'post.gi', label: 'Indirect light from visible surfaces', group: g, scope: c, default: 1, min: 0, max: 4, step: 0.1 })
export const postGIRadius = defineParam({ id: 'post.giRadius', label: 'Indirect light reach (m)', group: g, scope: c, default: 6, min: 1, max: 20, step: 0.5 })
export const postClouds = defineParam({ id: 'post.clouds', label: 'Volumetric clouds', group: g, scope: c, default: 1, min: 0, max: 2, step: 0.1 })
export const postCloudBase = defineParam({ id: 'post.cloudBase', label: 'Cloud base height (m)', group: g, scope: c, default: 300, min: 50, max: 1500, step: 10 })
export const postCloudDepth = defineParam({ id: 'post.cloudDepth', label: 'Cloud layer thickness (m)', group: g, scope: c, default: 160, min: 20, max: 500, step: 10 })
export const postAORadius = defineParam({ id: 'post.aoRadius', label: 'Ambient occlusion radius (m)', group: g, scope: c, default: 1.5, min: 0.2, max: 6, step: 0.1 })
export const postContact = defineParam({ id: 'post.contact', label: 'Contact shadows', group: g, scope: c, default: 1, min: 0, max: 1, step: 0.05 })

export const postDebug = defineParam({ id: 'post.debug', label: 'Debug view: 0 off, 1 occlusion, 2 contact shadows, 3 sun shaft openness', group: g, scope: c, default: 0, min: 0, max: 3, step: 1 })
export const postToneMap = defineParam({ id: 'post.toneMap', label: 'Tone mapping: 0 ACES, 1 AgX, 2 Neutral', group: g, scope: c, default: 0, min: 0, max: 2, step: 1 })


export const postHeat = defineParam({ id: 'post.heat', label: 'Heat shimmer over lava', group: g, scope: c, default: 0.6, min: 0, max: 2, step: 0.05 })

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
/**
 * The cinematic look in one switch, for the owner to compare: the post chain plus the
 * light rig's ground bounce, the Weather Lab's aerial perspective and the Terrain Lab's
 * material sliders. Normal entry uses these defaults too; this remains a comparison preset.
 */
export const CINEMATIC: Readonly<Record<string, number | boolean>> = {
  'post.on': true, 'light.bounce': 1, 'weather.aerial': 1,
  'terrain.detailNormal': 1, 'terrain.surfaceResponse': 1, 'terrain.macroColour': 1, 'terrain.accent': 1,
}

if (typeof location !== 'undefined') {
  const on = postOverride(location.search)
  if (on !== undefined) params.set(postOn.def.id, on)
  // ?cinematic=1. Applied after every module has registered its sliders (unknown ids are
  // ignored by params.set, so the order of imports cannot drop one silently: retry once).
  if (new URLSearchParams(location.search).has('cinematic')) {
    const apply = () => { for (const [id, v] of Object.entries(CINEMATIC)) params.set(id, v) }
    apply()
    setTimeout(apply, 0)
  }
}

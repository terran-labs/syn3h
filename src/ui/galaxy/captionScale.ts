/**
 * How large a lobby planet caption is drawn: by how large its planet looks (the owner, 17
 * November 2026: "planets up near the camera should have substantially larger label text").
 * The farthest, smallest planets keep the captions' original size; from there the size rises
 * smoothly with the planet's apparent radius to a ceiling for the nearest. Shell writes the
 * result as --caption-scale on each caption, in steps of STEP, and the stylesheet eases
 * font-size between steps, so nothing pops as planets orbit or the view zooms.
 */
import { defineParam } from '../../../shared/params'

/** The largest caption, for the nearest planets, as a multiple of the original size. 1 keeps every caption at the original size. */
export const captionCeiling = defineParam({
  id: 'lobby.captionScale', lobbyGroup: 'Planets', label: 'Lobby planet captions: size for the nearest planets (times the smallest)', group: 'Graphics', scope: 'client',
  default: 1.9, min: 1, max: 3, step: 0.05,
})

/**
 * A planet's apparent radius as a share of the screen's short side: at or under SMALL its
 * caption keeps the original size, at or over LARGE it reaches the ceiling. Measured in the
 * lobby at rest (17 November 2026): the moon and the ice world sit at 0.010 to 0.013 at
 * 402x874, 844x390 and 1440x900; the nearest world at 0.034 in portrait, 0.048 on a desktop
 * and 0.056 in landscape, so at rest it reaches about 1.67 times in portrait and the ceiling
 * elsewhere, and any planet reaches the ceiling as the view zooms in to it.
 */
export const CAPTION_SMALL = 0.013, CAPTION_LARGE = 0.045
/** The step --caption-scale moves in, so a caption's style is written only now and then. */
export const CAPTION_STEP = 0.02

/** The caption scale for a planet of `radius` CSS pixels on a screen whose short side is `short` pixels. */
export function captionScale(radius: number, short: number, ceiling: number = captionCeiling.value): number {
  const share = radius / Math.max(1, short)
  const t = Math.min(1, Math.max(0, (share - CAPTION_SMALL) / (CAPTION_LARGE - CAPTION_SMALL)))
  const eased = t * t * (3 - 2 * t)
  const top = Math.max(1, Number.isFinite(ceiling) ? ceiling : 1)
  return Math.round((1 + (top - 1) * eased) / CAPTION_STEP) * CAPTION_STEP
}

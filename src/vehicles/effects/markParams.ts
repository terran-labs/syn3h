/**
 * Tyre mark settings, for the player and the quality levels (core/quality.ts sets them per
 * level: Minimal draws no marks, Low keeps them for a shorter time). Client only: how marks
 * look is each player's own choice and never changes the shared world.
 */
import { defineParam } from '../../../shared/params'

/** Multiplies every mark's alpha. 0 draws no marks at all and stops laying them. */
export const tyreMarkStrength = defineParam({
  id: 'gfx.tyreMarks.strength', label: 'Tyre mark strength', group: 'Graphics', scope: 'client',
  default: 1, min: 0, max: 2, step: 0.05,
})

/** Share of each side of a mark that fades to nothing; 0.5 is a soft bell with no flat middle. */
export const tyreMarkSoftness = defineParam({
  id: 'gfx.tyreMarks.softness', label: 'Tyre mark edge softness', group: 'Graphics', scope: 'client',
  default: 0.3, min: 0.05, max: 0.5, step: 0.01,
})

/** Multiplies how long marks take to fade away. */
export const tyreMarkLife = defineParam({
  id: 'gfx.tyreMarks.life', label: 'Tyre mark lifetime', group: 'Graphics', scope: 'client',
  default: 1, min: 0.1, max: 3, step: 0.05,
})

/** Metres over which a mark fades in where it starts and out where it ends. */
export const MARK_END_FADE = 1.2

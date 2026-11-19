/**
 * How bright the buggy's headlights are, as one setting. The owner, 18 November 2026: "The
 * buggy's headlights are too bright by default. I think they should be about 50% of this bright."
 *
 * Two things make up what a player sees, and both follow this setting:
 *   - the beam: the two real spot lights a local buggy casts on the road (effects/index.ts),
 *     on from dusk to dawn;
 *   - the lamps: the glowing lens faces on the buggy's body (skins/Syn3hBuggySkin.ts), which
 *     everyone sees, day and night, and which bloom picks up.
 * 1 is the brightness before 18 November. The default, 0.4, halves what a player sees: measured
 * as the light the headlights add over the same frame with them off, at dusk and at night, from
 * the chase camera (the glow round the buggy) and from in front (the lamps and the lit ground).
 * Tone mapping and bloom compress the brightest parts, so halving the strength alone left about
 * 65 percent showing; 0.35 left 47 percent, 0.4 about half. At midday the lamps add nothing
 * measurable. One factor serves both parts. (/tmp/headlights, 18 November 2026.)
 */
import { defineParam } from '../../../shared/params'

export const buggyHeadlights = defineParam({
  id: 'light.buggyHeadlights', label: 'Buggy headlights (1 is the old brightness)', group: 'Light', scope: 'client',
  default: 0.4, min: 0, max: 2, step: 0.05,
})

/** The factor the beam's and the lamps' old strengths are multiplied by, for a setting `s`. */
export function headlightScale(s: number = Number(buggyHeadlights.value)): { beam: number; lamp: number } {
  const v = Math.max(0, Number.isFinite(s) ? s : buggyHeadlights.def.default)
  return { beam: v, lamp: v }
}

import { HoverBody, type HoverSpec } from '../hover/HoverBody'
import { buildRound3, round3Far, type Round3Design } from './round3'

export { R3_BUDGET, hoverBuilds, type HoverSpec } from '../hover/HoverBody'

const specOf = (d: Round3Design | HoverSpec): HoverSpec => 'build' in d ? d : { id: d.id, paint: d.paint, accent: d.accent, build: detail => buildRound3(d, detail), far: () => round3Far(d) }

/** A round three or four study at one detail level. The body class itself is the game's (src/vehicles/hover). */
export class Round3Hover extends HoverBody {
  constructor(design: Round3Design | HoverSpec, level: 0 | 1 | 2, game = false) { super(specOf(design), level, game) }
}

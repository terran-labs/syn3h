/**
 * A driver's character: five traits in 0..1, generated from a seed like everything else in
 * Syn3h. The same seed always gives the same character, so a bot keeps its nature across
 * clients and reloads, and a player can be handed a seed to share.
 */
import { hashString, seededRandom } from '../random'

export interface Personality {
  /** Speed, late braking, steep ground, the summit. */
  boldness: number
  /** Unvisited places over familiar ones. */
  curiosity: number
  /** Seeks other vehicles: convoys, tailing, pestering. */
  sociability: number
  /** Donuts, weaving, showing off. */
  mischief: number
  /** Sticks with a plan and with roads. */
  patience: number
  /** The dominant trait as a word, for labels and debugging. */
  archetype: 'daredevil' | 'explorer' | 'shadow' | 'trickster' | 'cruiser'
}

const ARCHETYPES = [
  ['boldness', 'daredevil'], ['curiosity', 'explorer'], ['sociability', 'shadow'],
  ['mischief', 'trickster'], ['patience', 'cruiser'],
] as const

export function personalityFor(seed: string): Personality {
  const random = seededRandom(hashString(`personality:${seed}`))
  // Two samples averaged, then stretched: most traits moderate, one or two pronounced.
  const trait = () => Math.min(1, Math.max(0, ((random() + random()) / 2 - 0.5) * 1.8 + 0.5))
  const p = { boldness: trait(), curiosity: trait(), sociability: trait(), mischief: trait(), patience: trait(), archetype: 'explorer' as Personality['archetype'] }
  let best = -1
  for (const [key, name] of ARCHETYPES) if (p[key] > best) { best = p[key]; p.archetype = name }
  return p
}

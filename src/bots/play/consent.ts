/**
 * Whether a person's chat line asks the bots to stop playing with them. The owner, 18 November
 * 2026: "if I say stop it or similar, then they should not do it anymore. I want them to tease
 * and delight human players, not frustrate or intimidate them."
 *
 * Matched on meaning, not one phrase, and biased toward stopping: a missed "stop" is the worse
 * mistake (someone keeps being grabbed after asking not to be), a false one only ends the games
 * for that person, who can turn them back on in settings.
 *
 * Two levels:
 *  - Always: a clear request anywhere in a line ("stop", "quit it", "leave me alone", "let me
 *    go", "get off me", "enough", "don't", "no more", a bare "no"), unless negated ("don't
 *    stop", "never stop", "no problem").
 *  - In a play window (during a playful grab or within a minute of one): anything that sounds
 *    unhappy too: "no", "nope", "ugh", "ow", "hey", "stahp", "argh", "why", a frowning face.
 */

/** Phrases that are a stop request wherever they appear. Word boundaries apply. */
export const STOP_PHRASES: readonly string[] = [
  'stop', 'stop it', 'stop that', 'stop this', 'stop grabbing', 'stop pulling', 'pls stop', 'please stop',
  'quit', 'quit it', 'quit that', 'cut it out', 'cut that out', 'knock it off', 'knock that off',
  'leave me alone', 'leave me be', 'go away', 'back off', 'buzz off', 'get off', 'get off me', 'get away',
  'let go', 'let me go', 'let go of me', 'unhook me', 'put me down', 'drop me',
  'enough', 'thats enough', "that's enough", 'no more', 'not now', 'not funny', 'dont', "don't", 'please dont', "please don't",
  'stahp', 'stawp', 'halt', 'cease',
]

/** Lines that are only a refusal: "no", "nope", "nah", "no!!", "no thanks", with any punctuation or emoji. */
const BARE_REFUSAL = /^(no+|nope|nah|no thanks|no thank you|noo+pe)$/

/** Unhappy words that count as stop only in a play window. */
const UNHAPPY = /\b(no+|nope|nah|ugh+|ow+|ouch|hey+|argh+|why+|wtf|annoying|stahp|rude)\b|[:;]-?\(|☹|😠|😡|😤|🙁|😣|😖|😫/

/** Negated or friendly uses that are not a request to stop. */
const NOT_A_STOP = /\b(don'?t|do not|never|can'?t|cannot|won'?t|wouldn'?t|didn'?t|no need to|not gonna)\s+(stop|quit|let go)\b|\bno (way|problem|worries|prob|biggie)\b|\b(stop ?watch|bus stop|full stop|pit stop|non[- ]?stop)\b|\bdon'?t worry\b/

function normalize(text: string): string {
  return text.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PHRASES = new RegExp(`(^|[^a-z'])(${[...STOP_PHRASES].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![a-z])`)

/**
 * True when `text` asks the bots to stop playing with whoever wrote it. `inPlayWindow`: a bot
 * is grabbing them or did within the last minute, so unhappy words count too.
 */
export function isStopRequest(text: string, inPlayWindow = false): boolean {
  const t = normalize(text)
  if (!t) return false
  const bare = t.replace(/[^a-z' ]/g, '').trim()
  if (BARE_REFUSAL.test(bare)) return true
  // A negation that makes the whole line friendly ("don't stop!", "no problem") is not a stop;
  // a line that also asks plainly ("no problem, but stop") still is.
  const friendly = NOT_A_STOP.test(t)
  const cleaned = friendly ? t.replace(new RegExp(NOT_A_STOP.source, 'g'), ' ') : t
  if (PHRASES.test(cleaned)) return true
  if (inPlayWindow && UNHAPPY.test(cleaned)) return true
  return false
}

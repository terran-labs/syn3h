/**
 * Whether a person's chat line asks the bots to stop playing with them. The owner, 18 November
 * 2026: "if I say stop it or similar, then they should not do it anymore. I want them to tease
 * and delight human players, not frustrate or intimidate them."
 *
 * Matched on meaning, not one phrase, and biased toward stopping: a missed "stop" is the worse
 * mistake (someone keeps being grabbed after asking not to be), a false one only ends the games
 * for that person, who can turn them back on in settings.
 *
 * Two levels (the Foreman, 19 November 2026: outside a play, people say "no" and "don't" to the
 * bots' banter all day):
 *  - Always: only phrases that can only be about being grabbed or bothered ("leave me alone",
 *    "let me go", "get off me", "stop grabbing", "unhook me", "go away").
 *  - In a play window (during a playful grab or within a minute of one): any request to stop
 *    ("stop", "quit it", "enough", "don't", a bare "no"), unless negated ("don't stop", "no
 *    problem"), and anything that sounds unhappy ("ugh", "ow", "hey", "argh", a frowning face).
 * A stopped person comes back with `isPlayAgain` or by toggling "Bots may play with me".
 */

/**
 * Phrases that can only be about being grabbed or bothered: a stop request at any time, even with
 * no play under way. Word boundaries apply.
 */
export const STOP_ANYWHERE: readonly string[] = [
  'stop grabbing', 'stop grabbing me', 'stop pulling', 'stop pulling me', 'quit grabbing', 'quit pulling',
  'leave me alone', 'leave me be', 'let me go', 'let go of me', 'unhook me', 'get off me', 'put me down',
  'back off', 'go away', 'stop hooking me', 'stop roping me', 'no grabbing', 'dont grab me', "don't grab me",
]

/**
 * Phrases that are a stop request during a play or within a minute of one (the window). Outside
 * it these are left to the banter's own rules (a "stop" to a following bot, a "no" to a joke).
 */
export const STOP_IN_WINDOW: readonly string[] = [
  ...STOP_ANYWHERE,
  'stop', 'stop it', 'stop that', 'stop this', 'pls stop', 'please stop',
  'quit', 'quit it', 'quit that', 'cut it out', 'cut that out', 'knock it off', 'knock that off',
  'buzz off', 'get off', 'get away', 'let go', 'drop me',
  'enough', 'thats enough', "that's enough", 'no more', 'not now', 'not funny', 'dont', "don't", 'please dont', "please don't",
  'stahp', 'stawp', 'halt', 'cease',
]

/** Lines that are only a refusal: "no", "nope", "nah", "no!!", "no thanks", with any punctuation or emoji. In a window only. */
const BARE_REFUSAL = /^(no+|nope|nah|no thanks|no thank you|noo+pe)$/

/** Unhappy words that count as stop only in a play window. */
const UNHAPPY = /\b(no+|nope|nah|ugh+|ow+|ouch|hey+|argh+|why+|wtf|annoying|stahp|rude)\b|[:;]-?\(|☹|😠|😡|😤|🙁|😣|😖|😫/

/** Negated or friendly uses that are not a request to stop. */
const NOT_A_STOP = /\b(don'?t|do not|never|can'?t|cannot|won'?t|wouldn'?t|didn'?t|no need to|not gonna)\s+(stop|quit|let go)\b|\bno (way|problem|worries|prob|biggie)\b|\b(stop ?watch|bus stop|full stop|pit stop|non[- ]?stop)\b|\bdon'?t worry\b/

function normalize(text: string): string {
  return text.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phrases = (list: readonly string[]) => new RegExp(`(^|[^a-z'])(${[...list].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![a-z])`)
const ANYWHERE = phrases(STOP_ANYWHERE), IN_WINDOW = phrases(STOP_IN_WINDOW)

/**
 * True when `text` asks the bots to stop playing with whoever wrote it. `inPlayWindow`: a bot
 * is grabbing them or did within the last minute, so unhappy words count too.
 */
export function isStopRequest(text: string, inPlayWindow = false): boolean {
  const t = normalize(text)
  if (!t) return false
  const bare = t.replace(/[^a-z' ]/g, '').trim()
  if (inPlayWindow && BARE_REFUSAL.test(bare)) return true
  // A negation that makes the whole line friendly ("don't stop!", "no problem") is not a stop;
  // a line that also asks plainly ("no problem, but stop") still is.
  const friendly = NOT_A_STOP.test(t)
  const cleaned = friendly ? t.replace(new RegExp(NOT_A_STOP.source, 'g'), ' ') : t
  if (ANYWHERE.test(cleaned)) return true
  if (inPlayWindow && (IN_WINDOW.test(cleaned) || UNHAPPY.test(cleaned))) return true
  return false
}

/** Asking the bots to play again after a stop: "you can play again", "ok you can grab me", "grab me". */
const PLAY_AGAIN = /\b(you can (play|grab me|grab|hook me)( with me)?( again)?|ok(ay)? (you can )?grab me|grab me( again)?|play with me( again)?|you can play again|i'?m ok with it|it'?s ok,? (you can )?(play|grab))\b/

/** True when `text` invites the bots back after a stop. */
export function isPlayAgain(text: string): boolean {
  const t = normalize(text)
  return PLAY_AGAIN.test(t) && !/\b(don'?t|do not|never|stop)\b/.test(t)
}

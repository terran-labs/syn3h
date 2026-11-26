// Words we never put in front of players (Orchestrator, 25 Nov 2026), in one place for the notes
// check (tools/release-notes.mjs) and the in-game Updates feed (tools/release-feed.mjs).
//
// PLAYER_WORDS is the notes wording rule. HIDDEN_WORDS name the creator's hidden sign-in
// (src/ui/creatorReveal.ts): the game never advertises it. On 25 Nov the Updates "Changes" list,
// built from commit subjects, showed players "Dimensional portal: the creator's sign-in, revealed
// by five taps on the version label"; the notes check never saw it.

export const PLAYER_WORDS = String.raw`lasers?|fire[sd]?|firing|shoot\w*|shot|weapons?|hit|hits|kill\w*|destroy\w*|death|dies?|died`
export const HIDDEN_WORDS = String.raw`portal\w*|creator[ -]key\w*|sign-in|five taps|reveal\w*|secret\w*|CREATOR_\w*|hidden gesture`

/** Every banned word in `text`, lower-cased and once each; [] when it is clean. */
export function bannedWords(text, words = `${PLAYER_WORDS}|${HIDDEN_WORDS}`) {
  const found = String(text).match(new RegExp(String.raw`\b(?:${words})\b`, 'gi')) ?? []
  return [...new Set(found.map(w => w.toLowerCase()))]
}

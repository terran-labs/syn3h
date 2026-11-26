/**
 * What a typed name may not contain: anything that could pass for the creator mark (a star,
 * sparkle, check, crown, medal or seal) and invisible characters that hide or reorder text.
 * The room applies it to every name (server/room.ts cleanName); the client applies it too
 * (src/ui/playerName.ts) so your own name reads as the room will show it. Shared, no deps.
 */
/** Emoji in general stay; these ranges and code points go. */
const BADGE_LOOKALIKES = new RegExp([
  '[\\u2600-\\u27bf]', // Miscellaneous Symbols and Dingbats: ★ ☆ ✓ ✔ ✦ ✧ ✨ ❇ ❋ ✪ …
  '[\\u2b50-\\u2b55]', // ⭐ and stars
  '[\\u2605\\u2606\\u221a\\u2713\\u2714\\u2611\\u2705\\u274e\\u2716]',
  '[\\u066d\\u204e\\u2051\\u2055\\u22c6\\u235f\\u29bf\\u2731-\\u274b\\u2042\\u203b]', // ٭ ⁎ ⁑ ⁕ ⋆ ⍟ …
  '\\u{1F31F}|\\u{1F320}|\\u{1F4AB}|\\u{1F396}|\\u{1F397}|\\u{1F3C5}|\\u{1F3C6}|\\u{1F947}|\\u{1F948}|\\u{1F949}',
  '\\u{1F451}|\\u{1F48E}|\\u{1F6E1}|\\u{1F530}|\\u{1F5F8}|\\u{1F52F}|\\u{1F4AF}|\\u{1F3F5}|\\u{1F4DB}',
  '[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff\\ufe00-\\ufe0f\\u180e\\u00ad\\u034f\\u061c]',
  '[\\u{E0000}-\\u{E007F}]|[\\u{E0100}-\\u{E01EF}]',
].join('|'), 'gu')

/** Remove from a typed name every character that could imitate the badge or hide text. */
export function stripBadgeLookalikes(s: string): string {
  return s.replace(BADGE_LOOKALIKES, '')
}


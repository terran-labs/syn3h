/**
 * The creator role: proof that a player holds the creator key, and protection for the names
 * people would use to impersonate the creator.
 *
 * The key is a random secret (tools/creator-key.mjs, at least 192 bits). The Worker holds only
 * its SHA-256, the CREATOR_KEY_SHA256 secret. A client proves the role by sending the key in
 * hello (`creator`); the room hashes it and compares in constant time. Nothing here stores,
 * logs or echoes the key.
 *
 * Synchronous on purpose, with the plain JavaScript SHA-256 in server/log.ts: Room.receive is
 * synchronous and Web Crypto's digest is not. Waiting on it in the Durable Object would let a
 * player's next messages overtake its hello (the input gate does not hold across a crypto
 * await), and the Worker has no nodejs_compat for node:crypto.
 */

import type { PlayerRole } from '../shared/protocol'
import { sha256Hex } from './log'

/** Roles the room asserts about a player (PlayerInfo.role). A client can never set its own. */
const ROLES: readonly PlayerRole[] = ['creator']

/** A role read back from the room's own storage, or undefined. */
export function cleanRole(raw: unknown): PlayerRole | undefined {
  return typeof raw === 'string' && (ROLES as readonly string[]).includes(raw) ? (raw as PlayerRole) : undefined
}

/** Shape of a key as tools/creator-key.mjs makes it: base64url, 32 characters (192 bits) or more. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/

/** The configured hash, lower case, or null when unset or malformed (the role is then off). */
export function cleanKeyHash(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  return HASH_PATTERN.test(s) ? s : null
}

/** True when `key` hashes to `hash`. Compares the whole digest whatever it holds. */
export function keyMatches(key: unknown, hash: string): boolean {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return false
  const got = sha256Hex(key)
  let diff = got.length ^ hash.length
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i % hash.length)
  return diff === 0
}

/**
 * Wrong keys one room object tolerates per minute before it logs a flood. Only FAILED keys
 * count, so the right key always verifies and a stranger cannot deny the creator the badge
 * in a room by burning a budget. That also means this does not slow guessing: every keyed
 * hello is hashed (microseconds) and answered as usual. The protection is the key's 192 bits,
 * not this counter; a wrong key is treated as no key and the join reveals nothing more.
 */
export const KEY_FAILURES_PER_MINUTE = 20

export class KeyFailures {
  private windowStart = -Infinity
  private count = 0
  /** Count one wrong key at server ms `now`; true exactly when this minute's budget is first exceeded. */
  fail(now: number): boolean {
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now
      this.count = 0
    }
    return ++this.count === KEY_FAILURES_PER_MINUTE + 1
  }
}

// ---------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------

/**
 * Characters a name may not contain anywhere: anything that could pass for the badge (stars,
 * sparkles, checks, crowns, medals, seals) and invisible characters that hide or reorder text
 * (zero width, direction controls, variation selectors, tag characters). Emoji in general stay.
 */
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

/** Letters from other scripts that look like Latin ones. Lower case keys, after NFKC. */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  а: 'a', б: 'b', в: 'b', г: 'r', д: 'd', е: 'e', ё: 'e', з: 'e', и: 'u', к: 'k', л: 'n', м: 'm', н: 'h', о: 'o', п: 'n', р: 'p', с: 'c',
  т: 't', у: 'y', х: 'x', ь: 'b', ъ: 'b', і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', ү: 'y', һ: 'h', ӏ: 'l', ɡ: 'g',
  // Greek
  α: 'a', β: 'b', γ: 'y', δ: 'd', ε: 'e', ζ: 'z', η: 'n', ι: 'i', κ: 'k', μ: 'u', ν: 'v', ο: 'o', ρ: 'p', σ: 'o', ς: 's', τ: 't',
  υ: 'u', χ: 'x', ω: 'w',
  // Armenian and others that pass for Latin
  ո: 'n', ս: 'u', օ: 'o', ց: 'g', հ: 'h', ı: 'i', ȷ: 'j', ℓ: 'l', ł: 'l', ø: 'o', đ: 'd', ð: 'd', ħ: 'h', ŧ: 't', ß: 'ss', æ: 'ae', œ: 'oe',
  // Digits and signs that stand in for letters
  '0': 'o', '1': 'l', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', $: 's', '!': 'l', '|': 'l', '€': 'e', '£': 'l', '¡': 'l',
}

/** Trailing numbers, spaces, punctuation and symbols: "Aubrey 2", "Aubrey!!", "Aubrey ~*~". */
const TRAILING_DECORATION = /[\s\p{N}\p{P}\p{S}]+$/u

/**
 * A name's skeleton: what is left when everything that only changes its look is folded away.
 * Case, accents, width and font variants (NFKC), invisible characters, lookalike letters from
 * other scripts, digit and sign swaps (0/O, 1/l/I, 3/E, @/A), and finally anything that is not
 * a letter. "AUBR3Y", "Aubrеy" (Cyrillic е), "A u b r e y" and "ᴬubrey" share one skeleton.
 */
export function nameSkeleton(raw: string): string {
  let s = stripBadgeLookalikes(raw).normalize('NFKC').toLowerCase()
  s = s.normalize('NFD').replace(/\p{M}/gu, '')
  let out = ''
  for (const ch of s) out += HOMOGLYPHS[ch] ?? ch
  // i, l and the I that lower cases to i are one letter here; so are rn and m, vv and w.
  return out.replace(/[^a-z]/g, '').replace(/i/g, 'l').replace(/rn/g, 'm').replace(/vv/g, 'w')
}

/** Skeletons of the reserved names in a comma-separated list. Empty entries are dropped. */
export function parseReservedNames(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return [...new Set(raw.split(',').map((n) => nameSkeleton(n)).filter((s) => s.length > 0))]
}

/**
 * True when `name` is, or imitates, a reserved name: the same skeleton, either whole or with
 * its trailing decoration dropped first (so "Aubrey 2" and "Aubrey ~*~" count, while "AUBR3Y"
 * keeps its 3 as an E).
 */
export function isReservedName(name: string, reserved: readonly string[]): boolean {
  if (reserved.length === 0) return false
  const whole = nameSkeleton(name)
  const base = nameSkeleton(stripBadgeLookalikes(name).normalize('NFKC').replace(TRAILING_DECORATION, ''))
  return reserved.some((r) => r === whole || r === base)
}

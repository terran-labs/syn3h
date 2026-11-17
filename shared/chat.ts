/**
 * Chat: the rules every client and the room server agree on. No browser or Node dependencies.
 *
 * The room is the authority. It cleans and limits every line (`cleanChatText`), masks the
 * worst words (`filterChat`), rate limits each speaker (`ChatBucket`) and stamps the sender's
 * real id. Nothing here is stored: a line exists only on the wire and in each screen's log.
 */
import { defineParam } from './params'

/** Longest line, in characters (code points), after cleaning. */
export const MAX_CHAT_LENGTH = 200

/** A person may say this many lines at once, then one every CHAT_REFILL_S seconds. */
export const CHAT_BURST = 4
export const CHAT_REFILL_S = 2
/** The bot simulator speaks for every bot through one shared, slower bucket. */
export const BOT_CHAT_BURST = 4
export const BOT_CHAT_REFILL_S = 3

// Room settings. Only the host may change these (the room enforces it), whether or not the
// shared sliders are locked: a guest turning chat off for everyone is not a guest's call.

/** Chat between people in this room. */
export const chatOn = defineParam({ id: 'chat.on', label: 'Room chat (host only)', group: 'Game', scope: 'world', default: true })
/** Bots talk in the chat (src/bots/banter). */
export const botChatter = defineParam({ id: 'bots.chatter', label: 'Bot chatter (host only)', group: 'Bots', scope: 'world', default: true })
/** How often bots talk: 0 quiet, 1 normal, 2 chatty. */
export const botChatterLevel = defineParam({ id: 'bots.chatterLevel', label: 'Bot chatter: 0 quiet, 1 normal, 2 chatty (host only)', group: 'Bots', scope: 'world', default: 1, min: 0, max: 2, step: 1 })
/** Bots go and free a stuck bot with the grapple (src/bots/rescue). Works with chatter off. */
export const botRescue = defineParam({ id: 'bots.rescue', label: 'Bots rescue each other (host only)', group: 'Bots', scope: 'world', default: true })

/** Parameters only the host may change. */
export const HOST_ONLY_PARAMS: ReadonlySet<string> = new Set([chatOn.def.id, botChatter.def.id, botChatterLevel.def.id, botRescue.def.id])

// Personal settings, never sent.

/** See chat at all. Off hides the panel and stops this player sending. */
export const chatShow = defineParam({ id: 'chat.show', label: 'Show chat', group: 'Chat', scope: 'client', default: true })
/** Hide lines from bots on this screen only. */
export const chatHideBots = defineParam({ id: 'chat.hideBots', label: 'Hide bot chatter', group: 'Chat', scope: 'client', default: false })

/**
 * Control characters, bidirectional overrides, zero width and other invisible format
 * characters. Removing them stops a line from reordering the text around it, hiding
 * characters inside a filtered word or drawing an empty line.
 */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]/g

/** Trim, strip invisible characters, collapse runs of space, limit length. Null when empty or not text. */
export function cleanChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // A sender cannot make the room do much work: anything far over the limit is refused outright.
  if (raw.length > MAX_CHAT_LENGTH * 8) return null
  const s = raw.replace(/[\t\n\r]+/g, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  const chars = Array.from(s)
  return chars.length > MAX_CHAT_LENGTH ? chars.slice(0, MAX_CHAT_LENGTH).join('').trimEnd() : s
}

// ---------------------------------------------------------------------------------------
// Word filter
// ---------------------------------------------------------------------------------------
//
// A short, honest list. It masks the commonest slurs and a few phrases of the worst abuse,
// spelled plainly or with the usual disguises: capitals, accents, look-alike digits and
// symbols (0 for o, 3 for e, @ for a), repeated letters ("niiiice" style stretching) and
// letters spaced or dotted apart (s.l.u.r). It does NOT catch: words in other languages,
// deliberate misspellings that change letters, Cyrillic or other look-alike alphabets
// beyond the few mapped below, words split across two messages, abuse phrased in ordinary
// words, emoji or pictures made of characters. It also over-masks a few innocent words (the
// country Niger, "a chink in the armour"). It is a speed bump, not moderation.
//
// Entries are stems after normalising (lower case, digits mapped, repeated letters
// collapsed). `whole` stems only match a whole word, so short stems do not mask innocent
// words that contain them; `part` stems match anywhere inside a word.

const WHOLE: readonly string[] = [
  'fag', 'fags', 'kike', 'kikes', 'spic', 'spics', 'chink', 'chinks', 'gok', 'goks', 'wetback', 'tranny', 'trannies',
  'nigger', 'niggers', 'nigga', 'niggas', 'niggaz', 'retard', 'retards', 'retarded', 'kys', 'coon', 'coons', 'paki', 'pakis', 'raghead', 'towelhead', 'rape', 'raped', 'rapist', 'rapists',
]
const PART: readonly string[] = [
  'faggot', 'fagot', 'kikes', 'beaner', 'sandnig', 'junglebunny', 'porchmonkey', 'golliwog',
  'dyke', 'shemale', 'killyourself', 'killurself', 'hangyourself',
]

/** Look-alike digits, symbols and a few Cyrillic letters, to their Latin letter. */
const LOOKALIKE: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'к': 'k', 'ı': 'i',
}

/** Lower case, accents off, look-alikes mapped, anything else not a letter dropped, repeats collapsed. */
export function normalizeForFilter(word: string): string {
  let out = ''
  for (const ch of word.normalize('NFKD').toLowerCase()) {
    if (/\p{M}/u.test(ch)) continue
    const c = LOOKALIKE[ch] ?? ch
    if (c < 'a' || c > 'z') continue
    if (out[out.length - 1] === c) continue
    out += c
  }
  return out
}

// Stems compared after the same collapsing of repeats ("faggot" becomes "fagot").
const collapse = (s: string) => normalizeForFilter(s)
const WHOLE_SET = new Set(WHOLE.map(collapse))
const PART_LIST = [...new Set(PART.map(collapse))]

function badWord(norm: string): boolean {
  if (!norm) return false
  if (WHOLE_SET.has(norm)) return true
  return PART_LIST.some((stem) => norm.includes(stem))
}

const mask = (s: string) => '*'.repeat(Math.max(3, Array.from(s).length))

/**
 * Mask filtered words with asterisks. Words are runs between spaces; a run of one-letter
 * words ("s l u r") and pairs of neighbouring words ("kill your self") are also tested
 * joined up.
 */
export function filterChat(text: string): string {
  const words = text.split(' ')
  const norms = words.map(normalizeForFilter)
  const hit = norms.map(badWord)
  // Joined neighbours: two or three words, or any run of single letters. A group counts only
  // when none of its words is a match alone, so a match does not spread to the words beside it.
  const joined = (i: number, j: number) => !hit.slice(i, j).some(Boolean) && badWord(normalizeForFilter(norms.slice(i, j).join('')))
  const single = norms.map((_, i) => Array.from(words[i]).length === 1)
  for (let i = 0; i < words.length; i++) {
    if (single[i] && (i === 0 || !single[i - 1])) {
      let j = i
      while (j < words.length && single[j]) j++
      if (j - i >= 3 && badWord(normalizeForFilter(norms.slice(i, j).join('')))) for (let k = i; k < j; k++) hit[k] = true
    }
    for (let n = 2; n <= 3 && i + n <= words.length; n++) {
      if (joined(i, i + n)) for (let k = i; k < i + n; k++) hit[k] = true
    }
  }
  return words.map((w, i) => (hit[i] ? mask(w) : w)).join(' ')
}

/** True when the filter would change this text. */
export function chatFiltered(text: string): boolean {
  return filterChat(text) !== text
}

/**
 * A token bucket: `burst` lines at once, then one per `refill` seconds. Time is milliseconds
 * from whatever clock the caller uses.
 */
export class ChatBucket {
  private tokens: number
  private at: number
  constructor(private readonly burst: number, private readonly refillS: number, now: number) {
    this.tokens = burst
    this.at = now
  }

  /** Spend one token if there is one. */
  take(now: number): boolean {
    this.refill(now)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  /** Seconds until the next token, 0 if one is ready. */
  wait(now: number): number {
    this.refill(now)
    return this.tokens >= 1 ? 0 : (1 - this.tokens) * this.refillS
  }

  private refill(now: number): void {
    const dt = Math.max(0, now - this.at) / 1000
    this.at = now
    this.tokens = Math.min(this.burst, this.tokens + dt / this.refillS)
  }
}

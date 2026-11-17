/**
 * Template expansion for bot lines. No DOM, no Three.js: tests run it by the thousand.
 *
 *   {name}       a slot from the context (speaker, the other bot, the player, a place...)
 *   {@frag}      a fragment list from FRAGMENTS, expanded recursively
 *   [a|b|c]      pick one, inline; may nest and contain slots
 *
 * Picking never repeats a template within a session until its pool is used up (`Picker`).
 */
import { FRAGMENTS } from './data/fragments'

export type Rand = () => number
export type Context = Record<string, string | number | undefined>

export const pickOne = <T>(items: readonly T[], r: Rand): T => items[Math.floor(r() * items.length) % items.length]

/** Expand one template. Unknown slots become empty and a double space is tidied. */
export function expand(template: string, ctx: Context, r: Rand, depth = 0): string {
  if (depth > 6) return template
  let s = template
  // Innermost alternations first, so "[a|[b|c]]" works.
  for (let guard = 0; guard < 40 && s.includes('['); guard++) {
    const next = s.replace(/\[([^[\]]*)\]/, (_, body: string) => pickOne(body.split('|'), r))
    if (next === s) break
    s = next
  }
  s = s.replace(/\{@([a-zA-Z]+)\}/g, (_, key: string, at: number, whole: string) => {
    const list = FRAGMENTS[key]
    if (!list) return ''
    const text = expand(pickOne(list, r), ctx, r, depth + 1)
    // Mid-sentence, a fragment written as a sentence of its own starts in lower case
    // ("Mind you, my instructor..."), unless it starts with "I" or an acronym.
    const before = whole.slice(0, at).trimEnd()
    const midSentence = before.length > 0 && !/[.!?:]$/.test(before)
    return midSentence && /^[A-Z](?:[a-z]|\s)/.test(text) && !/^I\b/.test(text) ? text[0].toLowerCase() + text.slice(1) : text
  })
  s = s.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
    const v = ctx[key]
    return v === undefined ? '' : String(v)
  })
  return tidy(s)
}

/** Collapse doubled spaces, fix " ," and capitalise the first letter. */
export function tidy(s: string): string {
  const t = s.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

/** English ordinal for callbacks: 2 -> "second". */
export function ordinal(n: number): string {
  const words = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
  if (n < words.length) return words[n]
  // Past a dozen nobody is counting precisely any more.
  return 'umpteenth'
}

/**
 * Chooses templates without repeats: each pool remembers what it has used, and only starts
 * again once every template in it has been said. The whole session also remembers each
 * finished line, so two templates cannot produce the same words twice.
 */
export class Picker {
  private readonly used = new Map<string, Set<number>>()
  /** Order of use in the current round, per pool. */
  private readonly order = new Map<string, number[]>()
  private readonly said = new Set<string>()

  constructor(private readonly r: Rand) {}

  /** A fresh template index from `pool` (key `key`), or -1 when the pool is empty. */
  index(key: string, size: number): number {
    if (size <= 0) return -1
    let used = this.used.get(key), order = this.order.get(key)
    if (!used || !order) { this.used.set(key, (used = new Set())); this.order.set(key, (order = [])) }
    if (used.size >= size) {
      // A new round. The most recent half of the last one sits it out, so a line can never
      // come straight back at the turn of a round.
      const half = Math.floor(size / 2)
      const keep = half > 0 ? order.slice(-half) : []
      used.clear(); order.length = 0
      for (const i of keep) { used.add(i); order.push(i) }
    }
    const free: number[] = []
    for (let i = 0; i < size; i++) if (!used.has(i)) free.push(i)
    const i = pickOne(free, this.r)
    used.add(i); order.push(i)
    return i
  }

  /** Templates in `key` not yet used in this round. */
  remaining(key: string, size: number): number {
    return size - (this.used.get(key)?.size ?? 0)
  }

  /** The last lines said, newest last: none of these is said again while it is here. */
  private readonly recent: string[] = []
  static readonly RECENT = 80

  /**
   * Expand a fresh template from `pool`, trying a few times for words not said recently.
   * With `strict`, returns null rather than a recent line, so the caller can try elsewhere.
   */
  line(key: string, pool: readonly string[], ctx: Context, strict = false): string | null {
    if (!pool.length) return null
    let fallback: string | null = null
    for (let attempt = 0; attempt < Math.min(8, pool.length + 2); attempt++) {
      const text = expand(pool[this.index(key, pool.length)], ctx, this.r)
      if (!this.recent.includes(text) && !this.said.has(text)) return this.remember(text)
      if (!this.recent.includes(text)) fallback ??= text
    }
    if (fallback) return this.remember(fallback)
    return strict ? null : this.remember(expand(pool[this.index(key, pool.length)], ctx, this.r))
  }

  private remember(text: string): string {
    this.said.add(text)
    this.recent.push(text)
    if (this.recent.length > Picker.RECENT) this.recent.shift()
    return text
  }

  /** Lines said this session, for tests. */
  get history(): ReadonlySet<string> { return this.said }
}

/**
 * Who a world refuses after an eject (the owner, 25 November 2026: an eject asks "are you sure"
 * with a banish choice: none, 5 minutes, 30 minutes, 24 hours or permanently). Kept in the room
 * object's own storage, apart from the roster snapshot, so a 24 hour or permanent banish outlives
 * the room emptying, hibernation, a release and a public world's reset to its canonical world.
 * It applies to that one world (that room), never to the game.
 *
 * Who is refused: the person's anonymous id (the analytics id kept in their browser storage) when
 * their client sends one, else their rejoin secret (one tab only). Never a network address. So a
 * banish, even "permanent", holds until that person clears their browser storage or opens a
 * private window. Without accounts nothing sturdier exists that is not a network address or a
 * fingerprint.
 */
export const BANISH_MS = { none: 0, '5m': 5 * 60_000, '30m': 30 * 60_000, '24h': 24 * 3_600_000, permanent: Infinity } as const
export type BanishChoice = keyof typeof BANISH_MS
export const isBanishChoice = (x: unknown): x is BanishChoice => typeof x === 'string' && Object.prototype.hasOwnProperty.call(BANISH_MS, x)

export interface Banish {
  /** Opaque handle for lifting it; never an identity. */
  ref: string
  aid?: string
  token?: string
  /** The name at the time, for the moderators' list. */
  name: string
  /** Server ms when it ends; null for permanent. */
  until: number | null
  /** The moderator's choice, to tell a returning person. */
  choice?: BanishChoice
}
/** At most this many per world. */
export const BANISH_CAP = 200

export class BanishList {
  private entries: Banish[]
  constructor(saved: unknown, private readonly now: () => number, private readonly ref: () => string = () => Math.random().toString(36).slice(2, 10)) {
    this.entries = Array.isArray(saved) ? saved.filter(isBanish).slice(0, BANISH_CAP) : []
  }
  /** Drop the ones that have ended. Returns whether anything changed. */
  prune(): boolean {
    const now = this.now(), before = this.entries.length
    this.entries = this.entries.filter(b => b.until === null || b.until > now)
    return this.entries.length !== before
  }
  /** The banish refusing this person now, if any. */
  find(aid: string | undefined, token: string | null | undefined): Banish | undefined {
    this.prune()
    return this.entries.find(b => (aid && b.aid === aid) || (token && b.token === token))
  }
  /**
   * Add one. At the cap: ended entries go first; then a new timed banish replaces the timed one
   * ending soonest; a new permanent one, or any when every entry is permanent, is refused ('full')
   * rather than silently dropping someone else's.
   */
  add(b: Omit<Banish, 'ref'>): Banish | 'full' {
    this.prune()
    // The same person again: the new choice replaces the old one.
    this.entries = this.entries.filter(e => !((b.aid && e.aid === b.aid) || (b.token && e.token === b.token)))
    if (this.entries.length >= BANISH_CAP) {
      const timed = this.entries.filter(e => e.until !== null).sort((x, y) => x.until! - y.until!)
      if (b.until === null || !timed.length) return 'full'
      this.entries.splice(this.entries.indexOf(timed[0]), 1)
    }
    const entry = { ...b, ref: this.ref() }
    this.entries.push(entry)
    return entry
  }
  lift(ref: unknown): boolean {
    const i = this.entries.findIndex(b => b.ref === ref)
    if (i < 0) return false
    this.entries.splice(i, 1)
    return true
  }
  /** For moderators: names at the time and time left, no identities. */
  list(): { ref: string; name: string; seconds: number | null }[] {
    this.prune()
    const now = this.now()
    return this.entries.map(b => ({ ref: b.ref, name: b.name, seconds: b.until === null ? null : Math.ceil((b.until - now) / 1000) }))
  }
  save(): Banish[] { return this.entries.map(b => ({ ...b })) }
}

function isBanish(x: unknown): x is Banish {
  const b = x as Banish
  return !!b && typeof b.ref === 'string' && typeof b.name === 'string' && (b.until === null || typeof b.until === 'number')
    && (typeof b.aid === 'string' || typeof b.token === 'string')
}

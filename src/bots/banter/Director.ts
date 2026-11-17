/**
 * The banter director: decides which bot says what, and when. Runs only on the client that
 * simulates the bots (the host), on a slow timer, so every client sees one conversation.
 *
 * It reads the game through `BanterWorld` (positions, what each bot is doing, trouble, the
 * players, the hour) and acts through `BanterHooks` (say a line, ask a bot to do something).
 * Nothing here touches Three.js or the DOM, so tests drive it with a fake world and clock.
 *
 * Restraint is the joke's timing:
 *   - one conversation at a time, lines spaced by a reading pause, never two bots at once
 *   - idle talk every 20 to 40 s at "normal" with four bots, longer when quiet, shorter chatty
 *   - events (a near miss, a sighting, a player's jump) speak only when nothing else is
 *   - silent while people are chatting, apart from answers to them
 *   - no template repeats in a session until its pool is used up
 */
import { botChatter, botChatterLevel, botRescue } from '../../../shared/chat'
import { hashString, seededRandom } from '../random'
import { POOLS } from './data'
import type { Pool } from './data/types'
import { type Context, Picker, ordinal, pickOne, type Rand, expand } from './grammar'
import { type Intent, type IntentKind, type NamedBot, parseIntent } from './intents'
import { VOICES, type VoiceId, shortName, voiceFor } from './voices'
import { FRAGMENTS } from './data/fragments'
import type { RescueEvent } from '../rescue/HostRescue'

export interface BanterBot {
  id: number
  name: string
  x: number; y: number; z: number
  speed: number
  /** The mind's activity ('road', 'visit', 'follow'...) or 'chase' while duck-following. */
  activity: string
  /** What it is doing, as a phrase: "cruising the road". */
  caption: string
  /** Seconds of trouble: going nowhere, upside down, wheels in liquid, in the air. */
  stuckFor: number
  flippedFor: number
  bogFor: number
  airFor: number
  /** Times it has been put back on a pad by the old self-rescue. */
  resets: number
  /** Within a few metres of a lava sea's edge. */
  nearLava: boolean
  /** The kind of place it is visiting and has nearly reached ('vent', 'peak', 'shore'...), or null. */
  sight: string | null
}

export interface BanterPlayer {
  id: number
  name: string
  x: number; y: number; z: number
  speed: number
  airFor: number
  /** Seconds with almost no movement. */
  idleFor: number
  kind: string
  flippedFor: number
  stuckFor: number
}

export interface BanterWorld {
  /** Seconds, any origin. */
  now(): number
  bots(): readonly BanterBot[]
  players(): readonly BanterPlayer[]
  /** Hour of day, 0 to 24. */
  hour(): number
  /** The planet's look in a word: "volcanic", "icy". */
  planet(): string
  sea(): 'lava' | 'water'
  cloudy(): boolean
  /** A real thing near a point, as a phrase, or null. */
  feature(x: number, z: number): { kind: string; phrase: string } | null
}

/** Something a bot is asked to do. Seconds is how long, before it gets bored. */
export type Directive =
  | { kind: 'follow'; player: number; seconds: number }
  | { kind: 'goto'; player: number; seconds: number }
  | { kind: 'stay'; seconds: number }
  | { kind: 'avoid'; player: number; seconds: number }
  | { kind: 'chase'; player: number; seconds: number }
  | { kind: 'pursueBot'; bot: number; seconds: number }

export interface BanterHooks {
  /** Say a line as bot `bot`. */
  say(bot: number, text: string): void
  /** Ask a bot to do something, or null to let it be. False when the bot cannot. */
  direct(bot: number, d: Directive | null): boolean
  /** Whether the room's settings allow bots to follow and to drive at all. */
  allows(what: 'follow' | 'drive'): boolean
  /** True while a game of Tag is on. */
  tagOn?(): boolean
  /** Ask the rescue system to send a rescuer to a stuck player (stage 3). */
  helpPlayer?(player: number): boolean
}

/** Timings per chatter level: quiet, normal, chatty. Seconds. */
const IDLE_GAP: [number, number][] = [[80, 150], [28, 50], [10, 20]]
const MIN_GAP = [16, 9, 3]
const EVENT_CHANCE = [0.3, 0.55, 1]
/** People chatted this recently: the bots keep out of it, apart from answering. */
const HUMAN_HUSH = 15
/** Requests a player may make: burst, then one per this many seconds. */
const REQUEST_BURST = 3
const REQUEST_REFILL = 6
/** "Be quiet" lasts this long. */
const QUIET_FOR = 180

interface Memory { stuck: number; flips: number; resets: number; edges: number; critters: string[] }

interface BotState {
  id: number
  name: string
  short: string
  voice: VoiceId
  mem: Memory
  /** Edge detection: was this true last tick. */
  was: { stuck: boolean; flipped: boolean; bog: boolean; air: boolean; lava: boolean; sight: string | null; resets: number }
  /** The request it is acting on. */
  request: { kind: IntentKind; player: number; until: number; base: number } | null
  /** When it may drift back to a player it left, and who. */
  driftBack: { player: number; at: number } | null
  lastSpoke: number
  near: Set<number>
  /** Until when it is off on a mishap's bold line: it turns invitations down meanwhile. */
  bold?: number
}

interface PlayerState {
  id: number
  name: string
  kind: string
  was: { air: boolean; idle: boolean; fast: boolean; flipped: boolean }
  tokens: number
  tokensAt: number
  speedAt: number
}

/** A line waiting its turn. */
interface Queued { at: number; bot: number; text: string; then?: () => void }

export interface DirectorOptions {
  seed?: string
  /** Called with each line as it is said, for tests and transcripts. */
  onLine?(bot: number, name: string, text: string): void
}

export class BanterDirector {
  private readonly r: Rand
  private readonly picker: Picker
  private readonly bots = new Map<number, BotState>()
  private readonly players = new Map<number, PlayerState>()
  private readonly queue: Queued[] = []
  private nextIdleAt = 0
  private lastLineAt = -Infinity
  private humanAt = -Infinity
  private quietUntil = -Infinity
  private hourWas = -1
  private cloudyWas: boolean | null = null
  private started = false
  private lastPuzzled = -Infinity
  private lastLeave = -Infinity
  private goneAt = -Infinity
  private readonly awayAt = new Map<number, number>()
  private readonly session = { critters: [] as { critter: string; by: string }[], resets: 0 }
  /** Count of lines said, for the cost report and tests. */
  said = 0

  constructor(private readonly world: BanterWorld, private readonly hooks: BanterHooks, private readonly options: DirectorOptions = {}) {
    this.r = seededRandom(hashString(`banter:${options.seed ?? 'session'}`))
    this.picker = new Picker(this.r)
  }

  get level(): number { return Math.round(botChatterLevel.value) }
  get chatterOn(): boolean { return Boolean(botChatter.value) }
  /** Lines waiting to be said. */
  get pending(): number { return this.queue.length }

  // -------------------------------------------------------------------------------------
  // The slow timer
  // -------------------------------------------------------------------------------------

  /** Call about once a second. */
  tick(): void {
    const now = this.world.now()
    if (!this.started) { this.started = true; this.scheduleIdle(now, 0.5) }
    this.syncRoster(now)
    this.flush(now)
    this.tickRequests(now)
    if (!this.chatterOn) {
      for (const q of this.queue.splice(0)) q.then?.()
      return
    }
    if (this.queue.length || now < this.lastLineAt + MIN_GAP[this.level] || now < this.quietUntil) return
    if (this.detectEvents(now)) return
    const hushed = now < this.humanAt + HUMAN_HUSH
    if (!hushed && now >= this.nextIdleAt && this.bots.size) {
      this.idle(now)
      this.scheduleIdle(now)
    }
  }

  /** A chat line from a person (not a bot). Bots may answer it, and act on it. */
  hear(from: number, text: string): void {
    const now = this.world.now()
    this.humanAt = now
    const named: NamedBot[] = [...this.bots.values()].map((b) => ({ id: b.id, name: b.name }))
    if (!this.players.has(from)) this.syncRoster(now)
    const intent = parseIntent(text, named)
    const player = this.players.get(from)
    if (!player) return
    if (!intent) {
      // Addressed by name but not understood: a puzzled reply, now and then.
      const to = named.filter((b) => text.toLowerCase().includes(shortName(b.name).toLowerCase()))
      if (to.length && now - this.lastPuzzled > 60 && this.r() < 0.5) {
        this.lastPuzzled = now
        this.speak(this.bots.get(to[0].id)!, 'req.unknown', { player: player.name, you: player.name }, now + 1.5)
      }
      return
    }
    if (!this.allowRequest(player, now)) return
    this.onIntent(intent, player, now)
  }

  /** What the bots are doing on request, for tests and the transcript. */
  requests(): { bot: string; kind: IntentKind; player: number; left: number }[] {
    const now = this.world.now()
    return [...this.bots.values()].filter((b) => b.request).map((b) => ({ bot: b.short, kind: b.request!.kind, player: b.request!.player, left: Math.round(b.request!.until - now) }))
  }

  // -------------------------------------------------------------------------------------
  // Saying things
  // -------------------------------------------------------------------------------------

  private scheduleIdle(now: number, scale = 1): void {
    const [lo, hi] = IDLE_GAP[this.level]
    // Fewer bots, longer pauses; many bots, not much shorter.
    const crowd = Math.min(1.6, Math.max(0.8, 4 / Math.max(1, this.bots.size)))
    this.nextIdleAt = now + (lo + this.r() * (hi - lo)) * crowd * scale
  }

  /** Expand a line from `key` for this bot's voice. */
  line(bot: BotState, key: string, ctx: Context = {}): string | null {
    const pool: Pool | undefined = POOLS[key]
    if (!pool) return null
    const own = pool[bot.voice] ?? []
    const any = pool.any ?? []
    if (!own.length && !any.length) return null
    const full: Context = { me: bot.short, role: bot.name.split(' ').slice(1).join(' ') || 'bot', planet: this.world.planet(), sea: this.world.sea(), ...ctx }
    // The voice's own lines weigh double, so voices stay distinct but never run dry. Each
    // list keeps its own record of what was said: the shared lines are used up once for
    // everyone, not once per voice.
    const ownKey = `${key}:${bot.voice}`, anyKey = `${key}:any`
    let ownShare = (own.length * 2) / (own.length * 2 + any.length)
    // When one list is used up, lean on the other before starting either list again.
    const ownLeft = this.picker.remaining(ownKey, own.length), anyLeft = this.picker.remaining(anyKey, any.length)
    if (ownLeft === 0 && anyLeft > 0) ownShare = 0
    else if (anyLeft === 0 && ownLeft > 0) ownShare = 1
    const [first, second]: [string, readonly string[]][] = this.r() < ownShare ? [[ownKey, own], [anyKey, any]] : [[anyKey, any], [ownKey, own]]
    return this.picker.line(first[0], first[1], full, true) ?? this.picker.line(second[0], second[1], full, true) ?? this.picker.line(first[0], first[1], full)
  }

  /** Queue a line from `key` at time `at` (or after the queue). Returns the time it will be said. */
  private speak(bot: BotState, key: string, ctx: Context, at?: number, then?: () => void): number {
    // Chatter off, or asked to be quiet: the bots still do what they agreed to, silently.
    if (!this.chatterOn || (this.world.now() < this.quietUntil && key !== 'req.talk')) {
      if (then) this.timers.push({ at: at ?? this.world.now(), run: then })
      return at ?? this.world.now()
    }
    const text = this.line(bot, key, ctx)
    const last = this.queue.length ? this.queue[this.queue.length - 1].at : this.world.now()
    const when = at ?? last + this.readingPause(this.queue.length ? this.queue[this.queue.length - 1].text : '')
    if (!text) { then?.(); return when }
    this.queue.push({ at: Math.max(when, last + (this.queue.length ? 1.2 : 0)), bot: bot.id, text, then })
    this.queue.sort((a, b) => a.at - b.at)
    return when
  }

  /** Seconds to read a line before the next one: about a third of a second per word, plus a beat. */
  private readingPause(text: string): number {
    const words = text ? text.split(' ').length : 4
    return 1.4 + words * 0.28 + this.r() * 0.8
  }

  private flush(now: number): void {
    while (this.queue.length && this.queue[0].at <= now) {
      const q = this.queue.shift()!
      const bot = this.bots.get(q.bot)
      if (!bot) continue
      if (this.chatterOn) {
        this.hooks.say(q.bot, q.text)
        this.options.onLine?.(q.bot, bot.name, q.text)
        this.said++
        bot.lastSpoke = now
        this.lastLineAt = now
      }
      q.then?.()
    }
  }

  // -------------------------------------------------------------------------------------
  // Who is here
  // -------------------------------------------------------------------------------------

  private syncRoster(now: number): void {
    const seen = new Set<number>()
    const arrivals: BotState[] = []
    for (const b of this.world.bots()) {
      seen.add(b.id)
      let s = this.bots.get(b.id)
      if (!s || s.name !== b.name) {
        s = {
          id: b.id, name: b.name, short: shortName(b.name), voice: voiceFor(b.name),
          mem: { stuck: 0, flips: 0, resets: 0, edges: 0, critters: [] },
          was: { stuck: false, flipped: false, bog: false, air: false, lava: false, sight: null, resets: b.resets },
          request: null, driftBack: null, lastSpoke: -Infinity, near: new Set(),
        }
        if (this.bots.size && now > 5) arrivals.push(s)
        this.bots.set(b.id, s)
      }
    }
    const gone: BotState[] = []
    for (const [id, s] of this.bots) if (!seen.has(id)) { gone.push(s); this.bots.delete(id) }
    for (const i in this.queue) if (!seen.has(this.queue[i].bot)) this.queue[i].text = ''
    for (let i = this.queue.length - 1; i >= 0; i--) if (!this.queue[i].text) this.queue.splice(i, 1)
    const people = new Set<number>()
    for (const p of this.world.players()) {
      people.add(p.id)
      if (!this.players.has(p.id)) {
        this.players.set(p.id, { id: p.id, name: p.name, kind: p.kind, was: { air: false, idle: false, fast: false, flipped: false }, tokens: REQUEST_BURST, tokensAt: now, speedAt: p.speed })
        if (now > 5) this.pendingEvents.push({ key: 'player.arrive', player: p.id, weight: 1 })
      }
      const ps = this.players.get(p.id)!
      ps.name = p.name
      if (ps.kind !== p.kind) { ps.kind = p.kind; this.pendingEvents.push({ key: 'player.kind', player: p.id, weight: 0.8 }) }
    }
    for (const [id, ps] of this.players) {
      if (people.has(id)) continue
      this.players.delete(id)
      this.pendingEvents.push({ key: 'player.leave', playerName: ps.name, weight: 0.8 })
      for (const b of this.bots.values()) if (b.request?.player === id) { b.request = null; this.hooks.direct(b.id, null) }
    }
    if (this.chatterOn) {
      for (const s of arrivals) this.pendingEvents.push({ key: 'bot.arrive', bot: s.id, weight: 1 })
      // Bots come and go with the quality governor: remark on it now and then, not every time.
      for (const s of gone) if (now - this.goneAt > 300) { this.goneAt = now; this.pendingEvents.push({ key: 'bot.gone', subjName: s.short, weight: 0.5 }) }
    }
  }

  // -------------------------------------------------------------------------------------
  // Events read from the game
  // -------------------------------------------------------------------------------------

  private readonly pendingEvents: { key: string; bot?: number; player?: number; playerName?: string; subjName?: string; weight: number }[] = []

  /** Look for something worth a remark. Returns true if a line was queued. */
  private detectEvents(now: number): boolean {
    const views = new Map(this.world.bots().map((b) => [b.id, b]))
    const found = this.pendingEvents.splice(0)
    for (const b of views.values()) {
      const s = this.bots.get(b.id)
      if (!s) continue
      const was = s.was
      const stuck = b.stuckFor > 4, flipped = b.flippedFor > 1.2, bog = b.bogFor > 2, air = b.airFor > 1.1
      if (b.resets > was.resets) { s.mem.resets++; this.session.resets++; found.push({ key: 'mishap.reset', bot: b.id, weight: 1 }) }
      else if (flipped && !was.flipped) { s.mem.flips++; found.push({ key: 'mishap.flipped', bot: b.id, weight: 1 }) }
      else if (bog && !was.bog) { s.mem.stuck++; found.push({ key: this.world.sea() === 'lava' ? 'mishap.lava' : 'mishap.water', bot: b.id, weight: 1 }) }
      else if (stuck && !was.stuck) { s.mem.stuck++; found.push({ key: 'mishap.stuck', bot: b.id, weight: 0.9 }) }
      else if (air && !was.air) { s.mem.edges++; found.push({ key: 'mishap.edge', bot: b.id, weight: 0.8 }) }
      else if (b.nearLava && !was.lava && this.world.sea() === 'lava') found.push({ key: 'mishap.lava', bot: b.id, weight: 0.6 })
      if (b.sight && b.sight !== was.sight) found.push({ key: `sight.real.${SIGHT_KEYS[b.sight] ?? 'peak'}`, bot: b.id, weight: 0.7 })
      Object.assign(was, { stuck, flipped, bog, air, lava: b.nearLava, sight: b.sight, resets: b.resets })
      // Meeting: another bot within 14 m that was not near last time.
      for (const o of views.values()) {
        if (o.id <= b.id) continue
        const close = Math.hypot(o.x - b.x, o.z - b.z) < 14
        if (close && !s.near.has(o.id)) { s.near.add(o.id); found.push({ key: 'meet', bot: b.id, player: o.id, weight: 0.25 }) }
        else if (!close && Math.hypot(o.x - b.x, o.z - b.z) > 40) s.near.delete(o.id)
      }
    }
    for (const p of this.world.players()) {
      const ps = this.players.get(p.id)
      if (!ps) continue
      const air = p.airFor > 1.4, idle = p.idleFor > 75, fast = p.speed > 28, flipped = p.flippedFor > 3
      const crash = ps.speedAt - p.speed > 14
      if (air && !ps.was.air) found.push({ key: 'player.jump', player: p.id, weight: 0.9 })
      else if (crash) found.push({ key: 'player.crash', player: p.id, weight: 0.6 })
      else if (flipped && !ps.was.flipped) found.push({ key: 'player.flipped', player: p.id, weight: 1 })
      else if (idle && !ps.was.idle) found.push({ key: 'player.idle', player: p.id, weight: 0.7 })
      else if (fast && !ps.was.fast) found.push({ key: 'player.fast', player: p.id, weight: 0.4 })
      ps.was = { air, idle, fast, flipped }
      ps.speedAt = p.speed
    }
    // The hour and the weather.
    const hour = this.world.hour()
    if (this.hourWas >= 0) {
      const crossed = (h: number) => (this.hourWas < h && hour >= h) || (this.hourWas > hour && h >= this.hourWas)
      if (crossed(6)) found.push({ key: 'time.sunrise', weight: 1 })
      else if (crossed(18.5)) found.push({ key: 'time.sunset', weight: 1 })
      else if (crossed(21.5)) found.push({ key: 'time.night', weight: 0.8 })
    }
    this.hourWas = hour
    const cloudy = this.world.cloudy()
    if (this.cloudyWas !== null && cloudy !== this.cloudyWas) found.push({ key: cloudy ? 'weather.cloudy' : 'weather.clear', weight: 0.6 })
    this.cloudyWas = cloudy

    const hushed = now < this.humanAt + HUMAN_HUSH
    // Strongest first; one remark per tick at most.
    found.sort((a, b) => b.weight - a.weight)
    for (const e of found) {
      if (hushed && e.weight < 1) continue
      if (this.r() > e.weight * EVENT_CHANCE[this.level]) continue
      if (this.react(e, now)) return true
    }
    return false
  }

  /** Turn an event into a line or a short exchange. */
  private react(e: { key: string; bot?: number; player?: number; playerName?: string; subjName?: string }, now: number): boolean {
    const subj = e.bot !== undefined ? this.bots.get(e.bot) : undefined
    const player = e.player !== undefined ? this.players.get(e.player) : undefined
    const others = (not?: BotState) => [...this.bots.values()].filter((b) => b !== not)
    const someone = (not?: BotState) => { const o = others(not); return o.length ? pickOne(o, this.r) : undefined }
    const t = now + 0.6 + this.r() * 1.5
    if (e.key.startsWith('mishap.') && subj) {
      const count = Math.max(subj.mem.stuck + subj.mem.flips + subj.mem.resets, 1)
      // The subject speaks first, usually; sometimes a friend notices first.
      const teaser = someone(subj)
      if (count >= 2 && teaser && this.r() < 0.5) {
        this.speak(teaser, 'callback.clumsy', { subj: subj.short, count: ordinal(count), you: subj.short }, t)
        this.speak(subj, 'reply.tease', { you: teaser.short })
        return true
      }
      this.speak(subj, e.key, {}, t)
      if (teaser && this.r() < 0.55) {
        this.speak(teaser, 'tease.mishap', { subj: subj.short, you: subj.short })
        if (this.r() < 0.5) this.speak(subj, 'reply.tease', { you: teaser.short })
      }
      return true
    }
    if (e.key.startsWith('sight.real.') && subj) {
      const feature = subj ? this.world.feature(this.view(subj)?.x ?? 0, this.view(subj)?.z ?? 0) : null
      const ctx = { feature: feature?.phrase ?? 'this' }
      this.speak(subj, e.key, ctx, t)
      const o = someone(subj)
      if (o && this.r() < 0.6) this.speak(o, 'sight.reply', { ...ctx, you: subj.short, subj: subj.short })
      return true
    }
    if (e.key === 'meet' && subj && e.player !== undefined) {
      const other = this.bots.get(e.player)
      if (!other) return false
      this.speak(subj, 'meet.hello', { you: other.short }, t)
      this.speak(other, 'meet.reply', { you: subj.short })
      return true
    }
    if (e.key === 'bot.arrive' && subj) {
      const o = someone(subj)
      if (o && this.r() < 0.5) { this.speak(o, 'bot.arrive', { subj: subj.short, you: subj.short }, t); this.speak(subj, 'bot.arrive.self', { you: o.short }) }
      else this.speak(subj, 'bot.arrive.self', { you: o?.short ?? 'everyone' }, t)
      return true
    }
    if (e.key === 'bot.gone' && e.subjName) {
      const o = someone()
      if (!o) return false
      this.speak(o, 'bot.gone', { subj: e.subjName }, t)
      return true
    }
    if (e.key.startsWith('player.')) {
      const name = player?.name ?? e.playerName ?? 'our friend'
      const speaker = this.nearestBot(e.player) ?? someone()
      if (!speaker) return false
      this.speak(speaker, e.key, { player: name, you: name, kind: player?.kind ?? 'buggy' }, t)
      const o = someone(speaker)
      if (o && e.key === 'player.jump' && this.r() < 0.4) this.speak(o, 'idle.reply', { you: speaker.short })
      if (e.key === 'player.flipped' && player && this.hooks.helpPlayer && this.r() < 0.6) {
        const helper = this.nearestBot(player.id)
        if (helper && this.hooks.helpPlayer(player.id)) this.speak(helper, 'req.help.player', { player: name, you: name })
      }
      return true
    }
    if (e.key.startsWith('time.') || e.key.startsWith('weather.')) {
      const speaker = someone()
      if (!speaker) return false
      this.speak(speaker, e.key, {}, t)
      const o = someone(speaker)
      if (o && this.r() < 0.4) this.speak(o, 'idle.reply', { you: speaker.short })
      return true
    }
    return false
  }

  // -------------------------------------------------------------------------------------
  // Idle talk
  // -------------------------------------------------------------------------------------

  private idle(now: number): void {
    const all = [...this.bots.values()]
    if (!all.length) return
    const weighted = all.flatMap((b) => Array(Math.round(VOICES[b.voice].chatty * 4)).fill(b) as BotState[])
    const a = pickOne(weighted, this.r)
    const others = all.filter((b) => b !== a)
    const b = others.length ? pickOne(others, this.r) : undefined
    const roll = this.r()
    const t = now + 0.5
    const view = this.view(a)
    if (b && roll < 0.3) return this.proposal(a, b, t)
    if (b && roll < 0.5) return this.critter(a, b, others.filter((o) => o !== b), t)
    if (b && roll < 0.58 && this.session.critters.length) {
      const c = pickOne(this.session.critters, this.r)
      this.speak(a, 'callback.critter', { critter: c.critter, subj: c.by, you: b.short }, t)
      if (this.r() < 0.6) this.speak(b, 'idle.reply', { you: a.short })
      return
    }
    const key = roll < 0.66 ? 'idle.planet' : roll < 0.72 ? (this.world.hour() > 20 || this.world.hour() < 5 ? 'idle.night' : 'idle.sky') : 'idle.musing'
    this.speak(a, key, { activity: view?.caption ?? 'driving about' }, t)
    if (b && this.r() < 0.35) this.speak(b, 'idle.reply', { you: a.short })
  }

  /** "Tag?" "I'm in the middle of something." "You're in the middle of a puddle." */
  private proposal(a: BotState, b: BotState, t: number): void {
    const kind = pickOne(['tag', 'tag', 'race', 'explore', 'summit', 'convoy'] as const, this.r)
    const bold = (b.bold ?? 0) > this.world.now()
    const busy = bold ? 'taking a shortcut' : this.view(b)?.caption ?? 'something'
    this.speak(a, `propose.${kind}`, { you: b.short }, t)
    const v = VOICES[b.voice]
    // A bot heading off on a mishap is busy, whatever its temper.
    const roll = bold ? 0 : this.r()
    const act = () => {
      // Sometimes they actually do it: the one who agreed tails the one who asked.
      // A player's request comes first: a bot already with someone does not wander off.
      if (b.request || a.request) return
      if (kind === 'tag' || kind === 'race' || kind === 'convoy') this.hooks.direct(b.id, { kind: 'pursueBot', bot: a.id, seconds: 25 + this.r() * 20 })
    }
    if (roll < 0.25) {
      this.speak(b, 'reply.busy', { you: a.short, activity: busy })
      this.speak(a, 'retort.busy', { you: b.short, activity: busy })
      if (this.r() < 0.5) this.speak(b, 'payoff.refused', { you: a.short })
    } else if (roll < 0.25 + v.agreeable * 0.6) {
      if (this.r() < v.haggle) {
        this.speak(b, 'reply.haggle', { you: a.short })
        this.speak(a, 'payoff.accepted', { you: b.short }, undefined, act)
      } else {
        this.speak(b, 'reply.accept', { you: a.short }, undefined, act)
        if (this.r() < 0.5) this.speak(a, 'payoff.accepted', { you: b.short })
      }
    } else {
      this.speak(b, 'reply.refuse', { you: a.short })
      this.speak(a, 'payoff.refused', { you: b.short })
    }
  }

  /** "I found a sand crab." "There are no sand crabs here." "Then what is that?" */
  private critter(a: BotState, b: BotState, rest: BotState[], t: number): void {
    const critter = expand(pickOne(FRAGMENTS.critter ?? ['sand crab'], this.r), {}, this.r).toLowerCase()
    const ctx = { critter, subj: a.short }
    this.speak(a, 'sight.critter', ctx, t)
    this.speak(b, 'doubt.critter', { ...ctx, you: a.short })
    if (this.r() < 0.75) this.speak(a, 'defend.critter', { ...ctx, you: b.short })
    if (rest.length && this.r() < 0.5) this.speak(pickOne(rest, this.r), 'settle.critter', { ...ctx, you: a.short })
    this.session.critters.push({ critter, by: a.short })
  }

  // -------------------------------------------------------------------------------------
  // Requests from players
  // -------------------------------------------------------------------------------------

  private allowRequest(p: PlayerState, now: number): boolean {
    p.tokens = Math.min(REQUEST_BURST, p.tokens + (now - p.tokensAt) / REQUEST_REFILL)
    p.tokensAt = now
    if (p.tokens < 1) return false
    p.tokens -= 1
    return true
  }

  /** Bots that should answer: those named, everyone, or whoever is with or nearest the player. */
  private responders(intent: Intent, player: PlayerState): BotState[] {
    if (intent.to.length) return intent.to.map((id) => this.bots.get(id)).filter((b): b is BotState => !!b)
    if (intent.all) return [...this.bots.values()]
    const engaged = [...this.bots.values()].filter((b) => b.request?.player === player.id)
    if (engaged.length) return engaged
    const nearest = this.nearestBot(player.id)
    return nearest ? [nearest] : []
  }

  private onIntent(intent: Intent, player: PlayerState, now: number): void {
    const bots = this.responders(intent, player)
    if (!bots.length) return
    const ctx = { player: player.name, you: player.name }
    let t = now + 1 + this.r() * 1.2
    // Talk only: one or two answer.
    const talkers = bots.length > 2 ? shuffled(bots, this.r).slice(0, 2) : bots
    switch (intent.kind) {
      case 'quiet': {
        const b = pickOne(talkers, this.r)
        this.queue.length = 0
        this.speak(b, 'req.quiet', ctx, t, () => { this.quietUntil = this.world.now() + QUIET_FOR })
        return
      }
      case 'talk':
        this.quietUntil = -Infinity
        this.speak(pickOne(talkers, this.r), 'req.talk', ctx, t)
        this.nextIdleAt = now + 6
        return
      case 'who':
        for (const b of talkers) t = this.speak(b, 'req.who', ctx, t) + 2.5
        return
      case 'what':
        for (const b of talkers) t = this.speak(b, 'req.what', { ...ctx, activity: this.activityPhrase(b) }, t) + 2.5
        return
      case 'thanks': case 'hello': case 'bye': case 'insult':
        this.speak(pickOne(talkers, this.r), `req.${intent.kind}`, ctx, t)
        return
      case 'away': {
        // Once, lightly: not every "brb" in a long evening.
        const last = this.awayAt.get(player.id) ?? -Infinity
        if (now - last < 600) return
        this.awayAt.set(player.id, now)
        this.speak(pickOne(talkers, this.r), 'req.away', ctx, t)
        return
      }
    }
    // Requests with behaviour behind them.
    let spoken = 0
    for (const b of bots) {
      t = this.consider(b, intent.kind, player, t, spoken < 2, intent.to.includes(b.id)) + (spoken < 2 ? 2 : 0)
      spoken++
    }
  }

  /** One bot weighs a request, answers in character and acts (or pointedly does not). */
  private consider(b: BotState, kind: IntentKind, player: PlayerState, t: number, talk: boolean, named = false): number {
    const v = VOICES[b.voice]
    const ctx = { player: player.name, you: player.name }
    const say = (key: string, extra: Context = {}, at?: number, then?: () => void): number => {
      if (talk) return this.speak(b, key, { ...ctx, ...extra }, at, then)
      then?.()
      return at ?? t
    }
    const moving = kind !== 'stop'
    if ((kind === 'follow' && !this.hooks.allows('follow')) || (moving && !this.hooks.allows('drive'))) return say('req.refuse.settings', {}, t)
    if (kind === 'help') {
      if (this.hooks.helpPlayer?.(player.id)) return say('req.help.player', {}, t)
      return this.consider(b, 'come', player, t, talk, named)
    }
    // Already with someone else. The rule: a bot leaves the player it is with only when the
    // new player asks it by name; asked as one of a group, or not named, it stays and says so.
    const prior = b.request && b.request.player !== player.id ? this.players.get(b.request.player) : undefined
    if (prior) {
      if (!named) return say('req.refuse.busy', { you: prior.name }, t)
      t = say('req.switch', { you: prior.name }, t)
    }
    const r = this.r()
    if (r < v.contrary) {
      // The contrarian does the opposite, briefly.
      const opposite: Partial<Record<IntentKind, Directive>> = {
        follow: { kind: 'avoid', player: player.id, seconds: 8 }, come: { kind: 'avoid', player: player.id, seconds: 8 },
        stop: { kind: 'chase', player: player.id, seconds: 8 }, scatter: { kind: 'follow', player: player.id, seconds: 15 },
        chase: { kind: 'avoid', player: player.id, seconds: 10 }, flee: { kind: 'chase', player: player.id, seconds: 10 },
      }
      const d = opposite[kind]
      return say('req.contrary', {}, t, () => { if (d) this.hooks.direct(b.id, d) })
    }
    if (r > v.agreeable + 0.25) return say('req.refuse', {}, t)
    const seconds = this.lifetime(b, kind)
    // The bot is told the longest it could last (three times the start, see tickRequests);
    // the director ends it sooner, with a word, when boredom wins.
    const hold = seconds * 3 + 10
    const directive: Directive | null =
      kind === 'follow' ? { kind: 'follow', player: player.id, seconds: hold } :
      kind === 'come' || kind === 'look' ? { kind: 'goto', player: player.id, seconds: hold } :
      kind === 'stop' ? { kind: 'stay', seconds: hold } :
      kind === 'scatter' ? { kind: 'avoid', player: player.id, seconds: hold } :
      kind === 'chase' ? { kind: 'chase', player: player.id, seconds: hold } :
      kind === 'flee' ? { kind: 'avoid', player: player.id, seconds: hold } :
      kind === 'race' ? { kind: 'chase', player: player.id, seconds: hold } : null
    if (!directive) return t
    const act = () => {
      if (!this.hooks.direct(b.id, directive)) return
      const now = this.world.now()
      b.request = { kind, player: player.id, until: now + seconds, base: seconds }
      b.driftBack = null
      if (kind === 'look') this.lookLater(b, player, now + Math.min(25, seconds))
    }
    if (v.delay > 0) {
      t = say('req.moment', {}, t)
      return say(`req.accept.${kind}`, {}, t + v.delay, act)
    }
    if (this.r() < v.haggle) {
      t = say('req.haggle', {}, t)
      return say(`req.accept.${kind}`, {}, undefined, act)
    }
    return say(`req.accept.${kind}`, {}, t, act)
  }

  /** How long a bot sticks with a request before boredom: its character and the request. */
  private lifetime(b: BotState, kind: IntentKind): number {
    const v = VOICES[b.voice]
    const base = kind === 'follow' ? 55 : kind === 'stop' ? 25 : kind === 'scatter' || kind === 'flee' ? 18 : kind === 'chase' || kind === 'race' ? 40 : 35
    return base * (0.7 + v.loyalty * 0.6) * (0.8 + this.r() * 0.4)
  }

  /** After coming to look, say what is actually there. */
  private lookLater(b: BotState, player: PlayerState, at: number): void {
    const check = () => {
      const p = this.world.players().find((q) => q.id === player.id)
      const me = this.view(b)
      if (!p || !me || !this.bots.has(b.id)) return
      const close = Math.hypot(p.x - me.x, p.z - me.z) < 30
      const feature = this.world.feature(p.x, p.z)
      if (close) this.speak(b, feature ? 'look.comment' : 'look.nothing', { player: player.name, you: player.name, feature: feature?.phrase ?? '' })
    }
    this.timers.push({ at, run: check })
  }

  private readonly timers: { at: number; run: () => void }[] = []

  /** Boredom: requests wear off, faster when the player sits still, slower when things happen. */
  private tickRequests(now: number): void {
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].at <= now) { const t = this.timers.splice(i, 1)[0]; t.run() }
    const views = new Map(this.world.players().map((p) => [p.id, p]))
    const dt = 1
    for (const b of this.bots.values()) {
      const req = b.request
      if (req) {
        const p = views.get(req.player)
        if (!p) { b.request = null; this.hooks.direct(b.id, null); continue }
        // Interesting: moving fast, in the air. Dull: parked.
        if (req.kind === 'follow' || req.kind === 'chase') {
          if (p.speed > 10 || p.airFor > 0.5) req.until += dt * 0.6
          if (p.idleFor > 8) req.until -= dt * 1.5
          // Never longer than three times the start, whatever happens: boredom always wins.
          req.until = Math.min(req.until, now + req.base * 3)
        }
        if (now < req.until) continue
        // One leaves at a time, a few seconds apart.
        if (now - this.lastLeave < 7) { req.until = now + 1; continue }
        this.lastLeave = now
        b.request = null
        this.hooks.direct(b.id, null)
        if (this.chatterOn && now >= this.quietUntil && (req.kind === 'follow' || req.kind === 'chase' || req.kind === 'come' || req.kind === 'look')) {
          this.speak(b, req.kind === 'chase' ? 'tag.escaped' : 'bored.leave', { player: p.name, you: p.name })
        }
        if (req.kind === 'follow' && this.r() < 0.35) b.driftBack = { player: req.player, at: now + 60 + this.r() * 90 }
      } else if (b.driftBack && now >= b.driftBack.at) {
        const p = views.get(b.driftBack.player), ps = this.players.get(b.driftBack.player)
        b.driftBack = null
        if (!p || !ps || !this.hooks.allows('follow')) continue
        const seconds = 25 + this.r() * 20
        if (this.hooks.direct(b.id, { kind: 'follow', player: p.id, seconds })) {
          b.request = { kind: 'follow', player: p.id, until: now + seconds, base: seconds }
          if (this.chatterOn && now >= this.quietUntil) this.speak(b, 'bored.back', { player: ps.name, you: ps.name })
        }
      }
    }
  }

  /** The player a bot is with on request, or null. The rescue weighs leaving them. */
  playerOf(bot: number): number | null {
    return this.bots.get(bot)?.request?.player ?? null
  }

  private readonly rescued = new Map<number, number>()
  private conflictAt = -Infinity
  private conflicted: BotState | null = null
  private conflictedWent = false

  /** A rescue happened (src/bots/rescue): say so, in character. */
  rescue(e: RescueEvent): void {
    const now = this.world.now()
    const bot = (id: number) => this.bots.get(id)
    const others = (not: BotState) => [...this.bots.values()].filter((b) => b !== not)
    const t = now + 0.6
    switch (e.kind) {
      case 'stuck': {
        const s = bot(e.stuck)
        if (!s) return
        s.bold = 0
        this.speak(s, 'stuck.call', {}, t)
        const o = others(s)
        // The clumsy one's first time today has a reputation but no count yet.
        if (o.length && (e.clumsy || e.count >= 2) && this.r() < 0.75) this.speak(pickOne(o, this.r), e.count >= 2 ? 'stuck.reputation' : 'stuck.clumsy', { subj: s.short, you: s.short, count: ordinal(e.count) })
        return
      }
      case 'pointed': { const s = bot(e.stuck); if (s) this.speak(s, 'stuck.pointed', {}); return }
      case 'conflict': {
        const b = bot(e.bot), s = bot(e.stuck)
        if (!b || !s) return
        const p = e.player !== null ? this.players.get(e.player) : undefined
        const ctx = { subj: s.short, player: p?.name ?? 'everyone', you: p?.name ?? s.short }
        const v = b.voice
        if (e.going) this.speak(b, v === 'clerk' ? 'conflict.form' : this.r() < 0.6 ? 'conflict.go' : 'conflict.guilt', ctx)
        // A bot that stays never reads from conflict.go or conflict.guilt.
        // Bargaining is with a bot still deciding, never with one already on its way.
        else if (this.conflicted && this.conflicted !== b && !this.conflictedWent && now - this.conflictAt < 20) this.speak(b, 'conflict.bargain', { ...ctx, you: this.conflicted.short })
        else if (v === 'clerk') this.speak(b, 'conflict.form', ctx)
        else if (p && this.r() < 0.4) this.speak(b, 'conflict.ask.player', ctx)
        // Staying: only lines that stay. (The guilt lines often end in going, so they are for goers.)
        else this.speak(b, 'conflict.stay', ctx)
        this.conflicted = b; this.conflictedWent = e.going; this.conflictAt = now
        return
      }
      case 'start': {
        const b = bot(e.bot), s = bot(e.stuck), person = this.players.get(e.stuck)
        if (!b) return
        // A person gets told what to do: drive with the cord.
        if (person) this.speak(b, 'rescue.player.drive', { player: person.name, you: person.name })
        else this.speak(b, 'rescue.start', { subj: s?.short ?? 'you', you: s?.short ?? 'you' })
        return
      }
      case 'retry': { const b = bot(e.bot), s = bot(e.stuck); if (b && this.r() < 0.7) this.speak(b, 'rescue.retry', { subj: s?.short ?? 'you', you: s?.short ?? 'you' }); return }
      case 'freed': {
        const s = bot(e.stuck)
        const helper = e.by.map(bot).find((b): b is BotState => !!b)
        const person = e.players.map((id) => this.players.get(id)).find((p) => !!p)
        const n = (this.rescued.get(e.stuck) ?? 0) + 1
        this.rescued.set(e.stuck, n)
        if (s) {
          const thanksTo = person?.name ?? helper?.short ?? 'everyone'
          // The braggart and the moon are the ungrateful ones, mostly.
          const ingrate = (s.voice === 'pilot' || s.voice === 'moon') ? this.r() < 0.7 : this.r() < 0.2
          this.speak(s, ingrate ? 'rescue.success.ingrate' : 'rescue.success.thanks', { you: thanksTo, player: thanksTo }, t)
        }
        if (helper && this.r() < 0.7) this.speak(helper, 'rescue.helper.modest', { subj: s?.short ?? 'them', you: s?.short ?? 'them' })
        if (person && helper) this.speak(helper, 'rescue.player.thanks', { player: person.name, you: person.name })
        if (s && n >= 2) this.timers.push({ at: now + 90 + this.r() * 120, run: () => {
          const o = [...this.bots.values()].filter((b) => b !== s)
          if (o.length && this.bots.has(s.id)) this.speak(pickOne(o, this.r), 'rescue.callback', { subj: s.short, you: s.short, count: ordinal(n) })
        } })
        return
      }
      case 'giveup': { const s = bot(e.stuck); if (s) this.speak(s, 'rescue.giveup', {}); return }
      case 'player.came': {
        const p = this.players.get(e.player), s = bot(e.stuck)
        if (!p || !s) return
        const speaker = this.r() < 0.5 ? s : pickOne(others(s).length ? others(s) : [s], this.r)
        this.speak(speaker, 'rescue.player.came', { player: p.name, you: p.name, subj: s.short })
        return
      }
      case 'mishap': {
        // The setup for the stuck call to come: the bot says something bold as it commits,
        // and sometimes a friend sees it coming.
        const s = bot(e.bot)
        if (!s) return
        s.bold = now + 40
        this.speak(s, 'mishap.bold', {}, t)
        const o = others(s)
        if (o.length && this.r() < 0.45) this.speak(pickOne(o, this.r), 'mishap.watch', { subj: s.short, you: s.short })
        return
      }
      case 'handoff': {
        const b = bot(e.bot), s = bot(e.stuck), person = this.players.get(e.stuck)
        if (b) this.speak(b, 'rescue.handoff', { subj: s?.short ?? person?.name ?? 'you', you: s?.short ?? person?.name ?? 'you' })
        return
      }
    }
  }

  /** The chase caught up: "Tag!" Called by the host when a chasing bot touches its player. */
  caught(bot: number): void {
    const b = this.bots.get(bot)
    if (!b || b.request?.kind !== 'chase') return
    const p = this.players.get(b.request.player)
    b.request.until = Math.min(b.request.until, this.world.now() + 4)
    if (p && this.chatterOn) this.speak(b, 'tag.caught', { player: p.name, you: p.name })
  }

  // -------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------

  private view(b: BotState): BanterBot | undefined {
    return this.world.bots().find((v) => v.id === b.id)
  }

  private activityPhrase(b: BotState): string {
    if (b.request) {
      const p = this.players.get(b.request.player)
      const who = p?.name ?? 'someone'
      return ({ follow: `following ${who}`, chase: `chasing ${who}`, come: `coming over to ${who}`, look: `going to look at what ${who} found`, stop: 'staying put, as asked', scatter: `giving ${who} some room`, flee: `running from ${who}` } as Partial<Record<IntentKind, string>>)[b.request.kind] ?? this.view(b)?.caption ?? 'driving about'
    }
    return this.view(b)?.caption ?? 'driving about'
  }

  private nearestBot(playerId?: number): BotState | undefined {
    const p = this.world.players().find((q) => q.id === playerId)
    let best: BotState | undefined, d = Infinity
    for (const v of this.world.bots()) {
      const s = this.bots.get(v.id)
      if (!s) continue
      const dist = p ? Math.hypot(v.x - p.x, v.z - p.z) : this.r()
      if (dist < d) { d = dist; best = s }
    }
    return best
  }

  /** For tests: the voice a bot was given. */
  voiceOf(bot: number): VoiceId | undefined { return this.bots.get(bot)?.voice }
  /** For tests: is rescue chatter allowed by the room. */
  get rescueOn(): boolean { return Boolean(botRescue.value) }
}

const SIGHT_KEYS: Record<string, string> = { vent: 'vent', peak: 'peak', summit: 'summit', shore: 'shore', 'road-end': 'road', 'road-mid': 'road', spawn: 'road' }

function shuffled<T>(items: readonly T[], r: Rand): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

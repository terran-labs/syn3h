/**
 * Bots playing with people in Explore: now and then one grapples a person for fun, and
 * sometimes two or three pin them, briefly. The owner, 18 November 2026: "they should even
 * grapple me for the fun of it when we're in explore mode and perhaps multiple of them should
 * try to grapple and pin me. They should be playful about it, and they should message what
 * they're doing, and if I say stop it or similar, then they should not do it anymore. I want
 * them to tease and delight human players, not frustrate or intimidate them."
 *
 * The rules, each a promise:
 *  - It reads as a game: a bot says what it is doing, in character, before it does it, inside
 *    the room's chatter budget. No line, no play: never a silent grab.
 *  - The first play with a person says how to make it stop ("say stop and we will").
 *  - Brief: a tug lets go after a few seconds; a pin after at most five.
 *  - Never someone new (under three minutes here), busy or struggling (fast, airborne, in
 *    liquid, on their side or roof, arriving, paused, racing) in the last ten seconds.
 *  - A ten-minute cooldown per person, and one play at a time in the room.
 *  - Consent: a stop request from the person (consent.ts) ends every grab on them at once, the
 *    bots say so kindly, once, and never play with them again this session. Breaking a bot's
 *    cord yourself three times counts as stop. The room's setting (bots.play) and the person's
 *    own ("Bots may play with me") turn it off. A stop lasts for the session (it is not saved),
 *    unless they invite the bots back ("you can play again") or toggle their setting off and on.
 *  - A cord is physics: nothing here moves a person any other way (AGENTS.md).
 *
 * Host only, ticked from HostBanter. Free of the game apart from the hooks, for tests.
 */
import type { Vehicle } from '../../vehicles/Vehicle'
import { defineParam } from '../../../shared/params'
import { isPlayAgain, isStopRequest } from './consent'
import { hashString, seededRandom } from '../random'

export const botsPlay = defineParam({ id: 'bots.play', label: 'Bots play with people (a grab for fun, in Explore)', group: 'Bots', scope: 'world', default: true })
/**
 * The person's own "Bots may play with me": personal, sent to the room in the hello and as a
 * profile change, so the host's bots honour it. Saying stop in chat does the same for a session.
 */
export const playWithMe = defineParam({ id: 'bots.playWithMe', label: 'Bots may play with me', group: 'Bots', scope: 'client', default: true })
export const botsPlayRate = defineParam({ id: 'bots.playRate', label: 'Bot playful grabs an hour per person', group: 'Bots', scope: 'world', default: 3, min: 0, max: 30, step: 0.5 })

/** Seconds a person must have been in the session before any play. */
export const NEW_FOR_S = 180
/** Seconds clear of every busy or struggling sign before a play. */
export const CLEAR_FOR_S = 10
/** Seconds between plays with one person. */
export const COOLDOWN_S = 600
/** Seconds after a play in which unhappy words count as stop (consent.ts, the play window). */
export const WINDOW_S = 60
/** Longest a tug's cord stays on; a pin's. Seconds. */
export const TUG_HOLD_S = 6
export const PIN_HOLD_S = 5
/** Longest a play may take to get a cord on before it is called off. Seconds. */
const REACH_S = 25
/** Breaking a bot's cord yourself this many times counts as stop. */
export const BREAKS_ARE_STOP = 3

export interface PlayPerson {
  readonly id: number
  readonly name: string
  readonly vehicle: Vehicle
  /** Their own "Bots may play with me" (absent from an older client means yes). */
  readonly allows: boolean
  /** True while they are busy or struggling: fast, airborne, in liquid, flipped, arriving, paused, racing. */
  readonly busy: boolean
}
export interface PlayBot { readonly id: number; readonly vehicle: Vehicle; readonly free: boolean }
export interface Tug { readonly finished: boolean; cancel(): void }
export interface PlayHooks {
  /** Seconds, any clock that runs while the room does. */
  now(): number
  /** Explore, with no race on: the only time the bots play like this. */
  explore(): boolean
  people(): readonly PlayPerson[]
  bots(): readonly PlayBot[]
  /** Bot `bot` hooks `target` and tugs it along `pull` for a moment (HostRescue.tug). */
  tug(bot: number, target: Vehicle, pull: { x: number; z: number }, hold: number): Tug | null
  /** Whether bot `bot`'s cord is on person `person` now. */
  attached(bot: number, person: number): boolean
  /** Say `text` as `bot`, inside the chatter budget; true when it will be said (`exempt`: an answer). */
  say(bot: number, text: string, exempt?: boolean): boolean
  /** Distance in metres on the ground, round the wrap. */
  distance(a: Vehicle, b: Vehicle): number
}

interface Person { firstSeen: number; clearSince: number; lastPlay: number; played: boolean; stopped: boolean; breaks: number; allowed: boolean }
interface Play { person: number; tugs: Map<number, Tug>; started: number; attachedAt: number; pin: boolean; announcer: number }

const START = [
  'Hey {name}! Hold still, I want to try something.', 'Incoming hug, {name}!', 'Grapple practice! {name}, you are the target.',
  '{name}, catch!', 'Tow service, free of charge. Hello, {name}!', 'Hold on to your hat, {name}.',
]
const PIN = ['Everybody, grab {name}!', 'Group hug for {name}!', 'Pile on {name}! Gently!']
const FIRST = ' (Say stop and we will.)'
const END = ['Ha! You are free.', 'And released. Thanks for playing!', 'Okay, okay, off you go.', 'That was fun. Free again!']
const AGAIN = ['Yay! Game on, {name}.', 'Deal, {name}. We will play nicely.', 'Oh good. Back in the game, {name}!']
const ACK = ['Got it, {name}. No more grabbing. Sorry!', 'Okay! Hands off, {name}.', 'Understood, {name}. We will leave you be.']

export class PlayDirector {
  private readonly persons = new Map<number, Person>()
  private play: Play | null = null
  private readonly random: () => number
  private lastCheck = -Infinity

  constructor(private readonly hooks: PlayHooks, seed = 'play') { this.random = seededRandom(hashString(seed)) }

  /** True when this person may not be played with again this session (they asked us to stop). */
  stopped(person: number): boolean { return this.persons.get(person)?.stopped ?? false }
  /** The play under way, for tests and the HUD: who, and which bots. */
  get current(): { person: number; bots: number[]; pin: boolean } | null {
    return this.play ? { person: this.play.person, bots: [...this.play.tugs.keys()], pin: this.play.pin } : null
  }

  /** Every half second or so. */
  update(): void {
    const now = this.hooks.now()
    const people = this.hooks.people()
    for (const p of people) {
      let s = this.persons.get(p.id)
      if (!s) this.persons.set(p.id, s = { firstSeen: now, clearSince: now, lastPlay: -Infinity, played: false, stopped: false, breaks: 0, allowed: p.allows })
      if (p.busy) s.clearSince = now
      // Turning "Bots may play with me" off and on again is a fresh start: any stop is cleared.
      if (p.allows && !s.allowed) { s.stopped = false; s.breaks = 0 }
      s.allowed = p.allows
    }
    if (this.play) { this.tend(now, people); return }
    if (!botsPlay.value || !this.hooks.explore() || now - this.lastCheck < 5) return
    this.lastCheck = now
    // A chance per check that comes to bots.playRate an hour for each person.
    const chance = Math.max(0, botsPlayRate.value) / 720
    const ready = people.filter(p => this.eligible(p, now))
    if (!ready.length || this.random() >= chance * ready.length) return
    this.begin(ready[Math.floor(this.random() * ready.length)], now)
  }

  /**
   * A person's chat line: a stop request ends every grab on them and every play to come. True
   * when it was about play (they were being played with), so the banter does not answer it too.
   */
  hear(person: number, text: string): boolean {
    const s = this.persons.get(person)
    if (!s) return false
    if (s.stopped) {
      // Invited back ("you can play again", "ok you can grab me"): one kind reply, inside the budget.
      if (!isPlayAgain(text)) return false
      s.stopped = false; s.breaks = 0
      const bot = this.hooks.bots()[0]?.id
      const name = this.hooks.people().find(p => p.id === person)?.name ?? 'friend'
      if (bot !== undefined) this.hooks.say(bot, AGAIN[Math.floor(this.random() * AGAIN.length)].replace('{name}', name))
      return true
    }
    const now = this.hooks.now()
    const inWindow = this.play?.person === person || now - s.lastPlay < WINDOW_S
    if (!isStopRequest(text, inWindow)) return false
    this.stop(person, inWindow)
    return inWindow
  }

  /** Person `person` broke free of bot `bot`'s cord themselves (their own Grapple, or a double tap of brake). */
  unhooked(person: number, bot: number): void {
    const s = this.persons.get(person)
    if (!s || s.stopped) return
    if (this.play?.person === person) this.play.tugs.get(bot)?.cancel()
    if (++s.breaks >= BREAKS_ARE_STOP) this.stop(person, true)
  }

  /** The person left, or the game changed: drop everything on them. */
  forget(person: number): void {
    if (this.play?.person === person) this.end(false)
  }

  dispose(): void { if (this.play) this.end(false) }

  private eligible(p: PlayPerson, now: number): boolean {
    const s = this.persons.get(p.id)!
    if (s.stopped || !p.allows || p.busy) return false
    if (now - s.firstSeen < NEW_FOR_S || now - s.clearSince < CLEAR_FOR_S || now - s.lastPlay < COOLDOWN_S) return false
    return this.hooks.bots().some(b => b.free && this.hooks.distance(b.vehicle, p.vehicle) < 90)
  }

  private begin(p: PlayPerson, now: number): void {
    const s = this.persons.get(p.id)!
    const near = this.hooks.bots().filter(b => b.free).map(b => ({ b, d: this.hooks.distance(b.vehicle, p.vehicle) })).filter(x => x.d < 90).sort((a, b) => a.d - b.d)
    if (!near.length) return
    // Now and then a pin: two or three at once, from round the person, briefly.
    const pin = near.length >= 2 && this.random() < 0.25
    const crew = near.slice(0, pin ? Math.min(3, near.length) : 1).map(x => x.b)
    const line = (pin ? PIN : START)[Math.floor(this.random() * (pin ? PIN : START).length)].replace('{name}', p.name) + (s.played ? '' : FIRST)
    // No line, no play: the budget is spent or chatter is off.
    if (!this.hooks.say(crew[0].id, line)) return
    const tugs = new Map<number, Tug>()
    const base = this.random() * Math.PI * 2
    crew.forEach((b, i) => {
      const a = base + (i * 2 * Math.PI) / crew.length
      const tug = this.hooks.tug(b.id, p.vehicle, { x: Math.cos(a), z: Math.sin(a) }, pin ? PIN_HOLD_S : TUG_HOLD_S)
      if (tug) tugs.set(b.id, tug)
    })
    if (!tugs.size) return
    s.played = true; s.lastPlay = now
    this.play = { person: p.id, tugs, started: now, attachedAt: -Infinity, pin, announcer: crew[0].id }
  }

  private tend(now: number, people: readonly PlayPerson[]): void {
    const play = this.play!
    const person = people.find(p => p.id === play.person)
    // Gone, or the game changed, or the room turned play off: let go at once, without a word.
    if (!person || !this.hooks.explore() || !botsPlay.value) { this.end(false); return }
    if (play.attachedAt === -Infinity && [...play.tugs.keys()].some(b => this.hooks.attached(b, play.person))) play.attachedAt = now
    const hold = play.pin ? PIN_HOLD_S : TUG_HOLD_S
    const done = [...play.tugs.values()].every(t => t.finished)
    if (done || now - play.attachedAt >= hold || (play.attachedAt === -Infinity && now - play.started > REACH_S)) this.end(play.attachedAt !== -Infinity)
    this.persons.get(play.person)!.lastPlay = now
  }

  private end(cheerfully: boolean): void {
    const play = this.play
    if (!play) return
    this.play = null
    for (const tug of play.tugs.values()) tug.cancel()
    if (cheerfully) this.hooks.say(play.announcer, END[Math.floor(this.random() * END.length)])
  }

  private stop(person: number, answer: boolean): void {
    const s = this.persons.get(person)!
    s.stopped = true
    const announcer = this.play?.person === person ? this.play.announcer : null
    if (this.play?.person === person) this.end(false)
    // Said kindly, once, and never mentioned again. Only when they were being played with: a
    // "stop" about something else needs no answer from us, but still ends play for them.
    if (answer) {
      const name = this.hooks.people().find(p => p.id === person)?.name ?? 'friend'
      const bot = announcer ?? this.hooks.bots()[0]?.id
      if (bot !== undefined) this.hooks.say(bot, ACK[Math.floor(this.random() * ACK.length)].replace('{name}', name), true)
    }
  }
}

/**
 * Short control tips, taught by use (the owner, 25 November 2026: the jet "is frustrating until
 * players figure this out"; Q, E and Space were hard to discover).
 *
 * Each tip line is a lesson tied to an input. A lesson is learned when the player uses that
 * input where the line says, and learned lessons are remembered on this device, so a returning
 * player who knows them sees nothing. The box shows the lessons left for the vehicle and its
 * state (the jet in hover or in flight, the buggy with wings open or shut), starts again on
 * entering a world, changing vehicle or changing state, and gives up after CAP_SECONDS whatever
 * is left. No DOM here: Shell draws what `update` returns.
 *
 * A mode (Tag, King of the Hill) can add its own context later; none does yet.
 */
import { keyFor, type KeyAction } from './bindings'

/** One piece of a tip line: a key (drawn as a keycap) or words. */
export type TipPart = { key: KeyAction } | { text: string }
/** What the lessons read each frame: the vehicle and the player's input vector. */
export interface TipInput {
  kind: string
  touch: boolean
  /** -1 to 1: steer, drive or pitch, throttle (the jet's E and Q). */
  x: number; y: number; z: number
  brakes: boolean
  /** Buggy wings open; the jet in flight (false is its starting hover). */
  special: boolean
  fire: boolean
  /** Plasma Tag is allowed in this world. */
  tagAllowed: boolean
  /** Riding in the Zorb ball: its own controls, nothing here to teach. */
  zorbed?: boolean
}
interface LessonSpec {
  id: string
  keys: TipPart[]
  touch: string
  /** Seconds the input must be held for the lesson to count (0: any use). */
  hold?: number
  used(s: TipInput): boolean
  /** Shown only when this holds (Plasma Tag only where it is allowed). */
  when?(s: TipInput): boolean
}
const k = (key: KeyAction): TipPart => ({ key }), t = (text: string): TipPart => ({ text })
const moved = (s: TipInput) => Math.abs(s.x) > 0.3 || Math.abs(s.y) > 0.3
/** A press of Space changes `special`; the lesson for it is learned by the change itself (see update). */
const toggled = () => false

/** Lessons by context, top to bottom in the box. Context ids are kept in storage: do not rename. */
export const LESSONS: Readonly<Record<string, readonly LessonSpec[]>> = {
  'jet.hover': [
    { id: 'liftoff', keys: [k('jetUp'), t('hold: lift off and climb ·'), k('jetDown'), t('come down')], touch: 'Hold THR + to lift off and climb · THR − to come down', hold: 0.5, used: s => s.z > 0.2 },
    { id: 'mode', keys: [k('special'), t('switch to flight')], touch: 'MODE: switch to flight', used: toggled },
    { id: 'move', keys: [k('forward'), k('back'), t('forward and back ·'), k('left'), k('right'), t('turn')], touch: 'Left thumb: move and turn', hold: 0.3, used: moved },
  ],
  'jet.flight': [
    { id: 'thrust', keys: [k('jetUp'), t('more thrust ·'), k('jetDown'), t('less thrust')], touch: 'THR + and THR −: more and less thrust', hold: 0.2, used: s => Math.abs(s.z) > 0.2 },
    { id: 'pitch', keys: [k('forward'), k('back'), t('nose down and up ·'), k('left'), k('right'), t('bank')], touch: 'Left thumb: pitch and bank', hold: 0.3, used: moved },
    { id: 'hover', keys: [k('special'), t('back to hover')], touch: 'MODE: back to hover', used: toggled },
  ],
  buggy: [
    { id: 'drive', keys: [k('forward'), k('back'), t('drive ·'), k('left'), k('right'), t('steer ·'), k('brake'), t('brake')], touch: 'Left thumb: drive and steer · BRAKE: slow down', hold: 0.3, used: s => Math.abs(s.y) > 0.3 },
    { id: 'wings', keys: [k('special'), t('wings, to fly off a jump')], touch: 'WINGS: fly off a jump', used: toggled },
    { id: 'tag', keys: [k('fire'), t('or click: Plasma Tag')], touch: 'TAG: Plasma Tag', used: s => s.fire, when: s => s.tagAllowed },
  ],
  'buggy.wings': [
    { id: 'fly', keys: [k('forward'), k('back'), t('pitch ·'), k('left'), k('right'), t('roll ·'), k('special'), t('fold wings')], touch: 'Left thumb: pitch and roll · WINGS: fold', used: toggled },
  ],
  hovercraft: [
    { id: 'thrust', keys: [k('forward'), t('thrust ·'), k('left'), k('right'), t('turn')], touch: 'Left thumb: thrust and turn', hold: 0.3, used: moved },
    { id: 'brake', keys: [k('back'), t('pitch ·'), k('brake'), t('brake')], touch: 'BRAKE: slow down', used: s => s.brakes || s.y < -0.3 },
  ],
}
/** The context a vehicle and its state teach. Null: nothing to teach (the tank, the Zorb). */
export function contextOf(s: Pick<TipInput, 'kind' | 'special' | 'zorbed'>): string | null {
  if (s.zorbed) return null
  if (s.kind === 'jet') return s.special ? 'jet.flight' : 'jet.hover'
  if (s.kind === 'buggy' || s.kind === 'buggy-syn3h') return s.special ? 'buggy.wings' : 'buggy'
  if (s.kind === 'hovercraft') return 'hovercraft'
  return null
}
/** The box gives up after this long in one vehicle and state, whatever is left. */
export const CAP_SECONDS = 90
/** A learned line stays, dimmed, this long before it goes. */
export const LEARNED_SECONDS = 1.5

export interface TipLine { id: string; parts: TipPart[]; text: string; learned: boolean }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const KEY = 'mira.tips.learned'

/** The lessons a player has, what they have learned, and what to show this frame. */
export class Lessons {
  private learned: Set<string>
  private context: string | null = null
  private shownFor = 0
  private special: boolean | null = null
  private readonly holding = new Map<string, number>()
  /** Lessons learned this showing, with seconds left before their line goes. */
  private readonly leaving = new Map<string, number>()
  constructor(private readonly store: Store | null = (() => { try { return localStorage } catch { return null } })()) {
    let saved: unknown = []
    try { saved = JSON.parse(store?.getItem(KEY) ?? '[]') } catch { /* A broken value starts fresh. */ }
    this.learned = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  }
  /** Start showing again: entering a world or changing vehicle. */
  restart(): void { this.context = null; this.shownFor = 0; this.special = null; this.holding.clear(); this.leaving.clear() }
  /** Forget every learned lesson ("Show tips again"). */
  forget(): void { this.learned.clear(); try { this.store?.removeItem(KEY) } catch { /* Storage is optional. */ } this.restart() }
  isLearned(context: string, id: string): boolean { return this.learned.has(`${context}.${id}`) }
  /** The lines to show this frame, empty when there is nothing (left) to teach. */
  update(dt: number, s: TipInput): TipLine[] {
    const context = contextOf(s)
    // Space (or MODE, or WINGS) changed the state: that teaches the lesson about it, in the
    // state the player was in, and the new state's lessons start their own showing.
    const flipped = this.special !== null && s.special !== this.special && this.context !== null
    if (flipped) for (const spec of LESSONS[this.context!] ?? []) if (spec.used === toggled) this.learn(this.context!, spec.id)
    this.special = s.special
    if (context !== this.context) { this.context = context; this.shownFor = 0; this.holding.clear(); this.leaving.clear() }
    if (!context) return []
    this.shownFor += dt
    if (this.shownFor > CAP_SECONDS) return []
    const lines: TipLine[] = []
    for (const spec of LESSONS[context]) {
      if (spec.when && !spec.when(s)) continue
      const id = `${context}.${spec.id}`
      if (spec.used !== toggled && !this.learned.has(id)) {
        const held = spec.used(s) ? (this.holding.get(id) ?? 0) + dt : 0
        this.holding.set(id, held)
        if (spec.used(s) && held >= (spec.hold ?? 0)) this.learn(context, spec.id)
      }
      if (this.learned.has(id)) {
        // Learned before this showing: never shown. Learned now: shown dimmed, then gone.
        if (!this.leaving.has(id)) continue
        const left = this.leaving.get(id)! - dt; this.leaving.set(id, left)
        if (left <= 0) continue
      }
      lines.push({ id, parts: spec.keys, text: s.touch ? spec.touch : spec.keys.map(p => 'key' in p ? keyFor(p.key) : p.text).join(' '), learned: this.learned.has(id) })
    }
    return lines
  }
  private learn(context: string, id: string): void {
    const key = `${context}.${id}`
    if (this.learned.has(key)) return
    this.learned.add(key); this.leaving.set(key, LEARNED_SECONDS)
    try { this.store?.setItem(KEY, JSON.stringify([...this.learned])) } catch { /* Storage is optional. */ }
  }
}

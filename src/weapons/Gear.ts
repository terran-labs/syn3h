/**
 * The gear rack: which piece of gear the player has in hand. Players read "gear"; files keep
 * the folder name src/weapons.
 *
 * Keys 1 to 9 pick directly and T cycles; a gamepad's D-pad left and right cycle. Only gear
 * the host allows is on the rack, so with the Grapple off the rack holds just Plasma Tag and
 * nothing changes for anyone. The HUD chip and touch button belong to the UX lane: they read
 * `current`, `label` and `list()` and call `select` or `next`.
 *
 * Key hints and touch buttons read `controls()` (see GearControls) and never reach into the
 * gear itself. Ids, parameter ids, wire messages and cue names keep the older words (beam,
 * red, pester, bungee); only the names players read changed.
 */
import { params } from '../../shared/params'
import type { Game, System } from '../core/Game'
import type { BigRed } from './BigRed'
import type { Bungee } from './bungee/Bungee'
import type { Pesters } from './pester/Pesters'
import type { Yoink } from './yoink/Yoink'
import { bungeeAllowed } from './bungee/params'
import { yoinkAllowed } from './yoink/params'
import { bigRedAllowed } from './bigRedParams'
import { pesterAllowed } from './pester/params'
import { lasersAllowed } from './params'

export type FireOwner = string | number | symbol
type FireHold = { kind: 'hold' | 'deferred' | 'reelIn' | 'payOut'; blocked: boolean; consumed: boolean }

export type GearId = 'beam' | 'bungee' | 'yoink' | 'red' | 'pester'

/** Player-facing names. Kept here so the wording test sees them. */
export const GEAR_LABELS: Record<GearId, string> = {
  beam: 'Plasma Tag',
  bungee: 'Grapple',
  yoink: 'Yoink',
  red: 'Plasma Thunder',
  pester: 'Chaser',
}

/** One line each: what the gear does, in plain words. */
export const GEAR_DESCRIPTIONS: Record<GearId, string> = {
  beam: 'Touch another vehicle with a streak of plasma to tag it.',
  bungee: 'Hook the ground or another vehicle and reel yourself in.',
  yoink: 'Lift another vehicle, carry it about, and let go to fling it.',
  red: 'Hold to gather light, then let go to send a wide pulse that shoves what it touches.',
  pester: 'Send a glowing cloud of light to chase another vehicle and tag it.',
}

/**
 * What the gear in hand can do right now, for key hints, touch buttons and sound. The UX
 * lane reads this every frame; it is the same object until gear, state, status or the list
 * of actions changes. `level` is live.
 */
export interface GearControls {
  readonly gear: GearId
  /** Player-facing name. */
  readonly name: string
  /** One line: what it does, plain words. */
  readonly description: string
  /** Grapple: idle, flying, ground, vehicle. Yoink: idle, holding. Plasma Thunder: idle, charging, ready. Others: idle. */
  readonly state: string
  /** Short HUD readout, such as "Cord 42 m" or "Holding Bot 3". */
  readonly status?: string
  /** 0 to 1, for sound: Grapple tension, Plasma Thunder charge, Yoink 1 while holding. Read live. */
  readonly level?: number
  /** Only the actions that apply in this state, in display order. */
  readonly actions: readonly GearAction[]
}

export interface GearAction {
  /** 'launch' | 'reelIn' | 'payOut' | 'release' | 'grab' | 'fling' | 'charge' | 'fire' */
  readonly id: string
  readonly label: string
  /** Display form, such as ["Click", "L"] or ["V", "Wheel down"]. */
  readonly keys: readonly string[]
  /** True: acts while held, call `stop` on release. False: one press. */
  readonly hold: boolean
  start(): void
  stop?(): void
}

/** The live gear, given to the rack once networking has made it. */
export interface GearSystems {
  bungee: Bungee
  yoink: Yoink
  bigRed: BigRed
  pesters: Pesters
  /** Player-facing name of a vehicle, for "Holding <name>". Falls back to the id. */
  nameOf?(id: number): string
}

const NO_ACTIONS: readonly GearAction[] = Object.freeze([])

const ORDER: GearId[] = ['beam', 'red', 'pester', 'bungee', 'yoink']

const ALLOWED: Record<GearId, { value: boolean }> = { beam: lasersAllowed, bungee: bungeeAllowed, yoink: yoinkAllowed, red: bigRedAllowed, pester: pesterAllowed }

export class GearRack implements System {
  private chosen: GearId = 'beam'
  private readonly listeners = new Set<(id: GearId) => void>()
  private padWas = { left: false, right: false }
  private last: GearId
  private systems: GearSystems | null = null
  private shown: GearControls | null = null
  /** What `shown` was built from; `detail` is cord metres or the carried vehicle's id. */
  private shownKey = { gear: '' as GearId | '', state: '', detail: NaN, bound: false }
  private actions: Partial<Record<string, readonly GearAction[]>> = {}
  /** A one press action raised the tag control; drop it once a step has seen it. */
  private pulse = false
  private stepFire = false
  private physicalFire = false
  private physicalBlocked = false
  private deferred = false
  private ownsReel = false
  private readonly fireOwners = new Map<FireOwner, FireHold>()
  private readonly actionOwner = Symbol('gear action')
  private readonly reelOwner = Symbol('reel in')
  private readonly payoutOwner = Symbol('pay out')

  constructor(private readonly game: Game, target: Window = window) {
    this.last = this.current
    game.input.fireControl = {
      poll: physical => this.pollFire(physical),
      cancel: () => this.fireCancel(),
    }
    target.addEventListener('keydown', (e) => {
      if (e.repeat || game.input.suspended) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'KeyT') this.next()
      const m = /^Digit([1-9])$/.exec(e.code)
      if (m) {
        const g = this.list()[Number(m[1]) - 1]
        if (g) this.select(g)
      }
    })
    params.onChange(() => this.notifyIfChanged())
  }

  /** Gear the host allows, in rack order. Never empty: the tag beam stands in. */
  list(): GearId[] {
    const on = ORDER.filter((g) => ALLOWED[g].value)
    return on.length ? on : ['beam']
  }

  /** The chosen gear if allowed, else the first allowed. Same as `list()` gives, without allocating. */
  get current(): GearId {
    if (ALLOWED[this.chosen].value) return this.chosen
    for (const g of ORDER) if (ALLOWED[g].value) return g
    return 'beam'
  }

  get label(): string {
    return GEAR_LABELS[this.current]
  }

  select(id: GearId): void {
    this.chosen = id
    this.notifyIfChanged()
  }

  next(step = 1): void {
    const list = this.list()
    const i = list.indexOf(this.current)
    this.select(list[(i + step + list.length) % list.length])
  }

  /** Hand the rack the live gear. Networking calls this once, after making them. */
  bind(systems: GearSystems): void {
    this.systems = systems
    this.actions = {}
    this.shown = null
  }

  /**
   * What the gear in hand can do now. Returns the same object until something a hint would
   * show changes, and allocates nothing when it has not.
   */
  controls(): GearControls {
    const gear = this.current
    const sys = this.systems
    let state = 'idle'
    let detail = NaN
    if (sys) {
      if (gear === 'bungee') {
        const c = sys.bungee.mine
        if (c) {
          state = c.hook ? 'flying' : c.to !== null ? 'vehicle' : 'ground'
          if (!c.hook) detail = Math.round(c.rest)
        }
      } else if (gear === 'yoink') {
        const held = sys.yoink.holding
        if (held !== null) { state = 'holding'; detail = held }
      } else if (gear === 'red') {
        const charge = sys.bigRed.charge
        state = charge < 0 ? 'idle' : charge < 1 ? 'charging' : 'ready'
      }
    }
    const k = this.shownKey
    if (this.shown && k.gear === gear && k.state === state && Object.is(k.detail, detail) && k.bound === Boolean(sys)) return this.shown
    k.gear = gear; k.state = state; k.detail = detail; k.bound = Boolean(sys)
    this.shown = this.build(gear, state, detail)
    return this.shown
  }

  onChange(listener: (id: GearId) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Each touch owns a unique token. Only aim gestures defer Chaser and idle Grapple. */
  fireBegin(owner: FireOwner, mode: 'aim' | 'hold' = 'hold'): void {
    if (this.fireOwners.has(owner)) return
    const gear = this.current
    const kind = mode === 'aim' && (gear === 'pester' || (gear === 'bungee' && !this.systems?.bungee.mine))
      ? 'deferred' : mode === 'aim' && gear === 'bungee' ? 'reelIn' : 'hold'
    this.fireOwners.set(owner, { kind, blocked: false, consumed: this.hasImmediateFire() })
    this.publishFire()
  }

  /** UX applies the final look delta before ending an intentional gesture. */
  fireEnd(owner: FireOwner, intentional = true): void {
    const held = this.fireOwners.get(owner)
    if (!held) return
    if (!intentional) { this.fireCancel(owner); return }
    this.fireOwners.delete(owner)
    if (held.kind === 'deferred' && !held.blocked && !held.consumed) this.deferred = true
    if (!this.fireOwners.size && this.deferred) {
      this.deferred = false
      this.pulse = true
    }
    this.publishFire()
  }

  /** Interruptions discard charges/carries, never synthesize an ordinary release. */
  fireCancel(owner?: FireOwner): void {
    if (owner !== undefined && !this.fireOwners.has(owner)) return
    this.interruptFire()
    if (owner === undefined) this.fireOwners.clear()
    else this.fireOwners.delete(owner)
    this.publishFire()
  }

  private interruptFire(): void {
    this.systems?.bigRed.cancel()
    this.systems?.yoink.cancel()
    for (const held of this.fireOwners.values()) held.blocked = true
    this.pulse = this.deferred = false
    this.physicalBlocked = this.physicalFire
    // A switch may happen between polling and physics; discard that sampled held value too.
    this.game.input.state.fire = false
  }

  private hasImmediateFire(): boolean {
    if (this.physicalFire && !this.physicalBlocked) return true
    for (const held of this.fireOwners.values()) if (!held.blocked && held.kind === 'hold') return true
    return false
  }

  private pollFire(physical: boolean): boolean {
    this.physicalFire = physical
    if (!physical) this.physicalBlocked = false
    this.publishFire()
    return Boolean(this.game.input.external.fire)
  }

  /** Publish the one fire level. Reel buttons share ownership but remain non-firing actions. */
  private publishFire(): void {
    const immediate = this.hasImmediateFire()
    if (immediate) {
      this.deferred = false
      this.pulse = false
      for (const held of this.fireOwners.values()) if (held.kind === 'deferred') held.consumed = true
    }
    let reel: -1 | 0 | 1 = 0
    for (const held of this.fireOwners.values()) {
      if (!held.blocked && held.kind === 'reelIn') reel = -1
      if (!held.blocked && held.kind === 'payOut') reel = 1
    }
    if (reel || this.ownsReel) this.systems?.bungee.setReel(reel)
    this.ownsReel = reel !== 0
    this.game.input.external.fire = immediate || (this.pulse && !this.stepFire)
  }

  private tapFire(): void {
    // A button tap cannot add an edge underneath another holder.
    if (!this.hasImmediateFire()) this.pulse = true
    for (const held of this.fireOwners.values()) if (held.kind === 'deferred') held.consumed = true
    this.publishFire()
  }

  fixedUpdate(): void {
    // A pulse survives frames with no physics. After consumption it needs a low step before
    // another pulse can rise; multiple fixed steps in the same frame cannot duplicate it.
    if (this.pulse && !this.stepFire && this.game.input.state.fire) {
      this.pulse = false
    }
    this.stepFire = this.game.input.state.fire
    this.publishFire()
  }

  update(): void {
    const pad = navigator.getGamepads?.().find((p) => p && p.connected)
    if (!pad) return
    const left = Boolean(pad.buttons[14]?.pressed)
    const right = Boolean(pad.buttons[15]?.pressed)
    if (left && !this.padWas.left) this.next(-1)
    if (right && !this.padWas.right) this.next(1)
    this.padWas = { left, right }
  }

  private build(gear: GearId, state: string, detail: number): GearControls {
    const sys = this.systems
    let status: string | undefined
    if (gear === 'bungee' && detail === detail) status = `Cord ${detail} m`
    if (gear === 'yoink' && detail === detail) status = `Holding ${sys?.nameOf?.(detail) ?? detail}`
    const base = {
      gear, name: GEAR_LABELS[gear], description: GEAR_DESCRIPTIONS[gear], state, status,
      actions: sys ? this.actionsFor(gear, state, sys) : NO_ACTIONS,
    }
    if (!sys || (gear !== 'bungee' && gear !== 'yoink' && gear !== 'red')) return Object.freeze(base)
    return Object.freeze(Object.defineProperty(base, 'level', {
      enumerable: true,
      get: gear === 'bungee' ? () => sys.bungee.tension
        : gear === 'yoink' ? () => (sys.yoink.holding !== null ? 1 : 0)
          : () => Math.max(0, sys.bigRed.charge),
    }) as GearControls)
  }

  /** Action lists, made once per gear and state and then reused. */
  private actionsFor(gear: GearId, state: string, sys: GearSystems): readonly GearAction[] {
    const key = `${gear}:${state}`
    const made = this.actions[key]
    if (made) return made
    const press = () => this.fireBegin(this.actionOwner)
    const unpress = () => this.fireEnd(this.actionOwner)
    const tap = () => this.tapFire()
    const act = (a: GearAction) => Object.freeze(a)
    const release = act({ id: 'release', label: 'Let go', keys: ['G', 'Double tap'], hold: false, start: () => sys.bungee.letGo('released') })
    const reelStart = (owner: FireOwner, kind: 'reelIn' | 'payOut') => () => {
      if (!this.fireOwners.has(owner)) this.fireOwners.set(owner, { kind, blocked: false, consumed: false })
      this.publishFire()
    }
    let list: GearAction[]
    switch (`${gear}:${state}`) {
      case 'beam:idle':
        list = [act({ id: 'fire', label: 'Tag', keys: ['Click', 'L'], hold: true, start: press, stop: unpress })]
        break
      case 'pester:idle':
        list = [act({ id: 'launch', label: 'Send a Chaser', keys: ['Click', 'L'], hold: false, start: tap })]
        break
      case 'bungee:idle':
        // Use the same one-step launch edge as TAG and deferred aim.
        list = [act({ id: 'launch', label: 'Launch', keys: ['Click', 'L'], hold: false, start: tap })]
        break
      case 'bungee:flying':
        list = [release]
        break
      case 'bungee:ground':
      case 'bungee:vehicle':
        list = [
          act({ id: 'reelIn', label: 'Reel in', keys: ['Hold click', 'Wheel up'], hold: true, start: reelStart(this.reelOwner, 'reelIn'), stop: () => this.fireEnd(this.reelOwner) }),
          act({ id: 'payOut', label: 'Let out', keys: ['V', 'Wheel down'], hold: true, start: reelStart(this.payoutOwner, 'payOut'), stop: () => this.fireEnd(this.payoutOwner) }),
          release,
        ]
        break
      case 'yoink:idle':
        list = [act({ id: 'grab', label: 'Grab', keys: ['Hold click', 'Hold L'], hold: true, start: press, stop: unpress })]
        break
      case 'yoink:holding':
        // Letting go of the grab flings. As its own button, it lets go of the tag control and
        // flings at once; a held key then lets go with nothing left to fling.
        list = [act({ id: 'fling', label: 'Fling', keys: ['Let go of click'], hold: false, start: () => { sys.yoink.release(); this.fireCancel() } })]
        break
      case 'red:idle':
      case 'red:charging':
        list = [act({ id: 'charge', label: 'Charge', keys: ['Hold click', 'Hold L'], hold: true, start: press, stop: unpress })]
        break
      case 'red:ready':
        list = [act({ id: 'fire', label: 'Let go to send', keys: ['Let go of click'], hold: true, start: press, stop: unpress })]
        break
      default:
        list = []
    }
    const frozen = Object.freeze(list)
    this.actions[key] = frozen
    return frozen
  }

  private notifyIfChanged(): void {
    const now = this.current
    if (now === this.last) return
    this.interruptFire()
    this.publishFire()
    this.last = now
    for (const l of this.listeners) l(now)
  }
}

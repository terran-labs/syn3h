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
  /** Cleanup suppresses gameplay but retains ownership until the real end. */
  stop?(reason?: 'end' | 'cleanup'): void
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
  private pulse: symbol | null = null
  private pulseSeen = false
  private readonly fireOwners = new Map<symbol, GearId>()
  /** Invalidates callbacks retained by UI controls across cancellation. */
  private actionGeneration = 0
  private reelOwner: symbol | null = null

  constructor(private readonly game: Game, target: Window = window) {
    this.last = this.current
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
    this.actionGeneration++
    this.reelOwner = null
    this.systems = systems
    this.actions = {}
    this.shown = null
  }

  /**
   * Cancel local pending actions before a modal suspends input or tears down gestures.
   * The required Input callback must capture held owners and inhibit each until real
   * neutral followed by a fresh press. Synthetic cleanup/suspension is not neutral.
   * This rack cannot enforce native input rearming on its own.
   *
   * Already launched shots and remote/bot gear remain live. Existing cancel methods
   * retain normal cooldown semantics; no reset or intentional release is performed.
   * If the inhibitor throws, rack owners are suppressed and sampled fire is cleared,
   * but the caller must not resume play assuming native rearming is guarded.
   */
  cancelActions(inhibitFireUntilNeutral: () => void): void {
    const sys = this.systems
    sys?.bigRed.cancel()
    sys?.yoink.cancel()
    sys?.bungee.cancel()
    sys?.bungee.setReel(0)
    this.reelOwner = null
    this.actionGeneration++
    this.actions = {}
    this.shown = null
    try {
      // Capture raw ownership before clearing the public fire outputs.
      inhibitFireUntilNeutral()
    } finally {
      for (const owner of this.fireOwners.keys()) this.game.input.suppressExternalFire(owner)
      if (this.pulse) {
        this.game.input.suppressExternalFire(this.pulse)
        this.game.input.endExternalFire(this.pulse)
        this.pulse = null
      }
      this.pulseSeen = false
      this.game.input.state.fire = false
    }
  }

  /** After an external owner is suppressed, discard release-sensitive actions only
   * when Input's synchronously recomputed aggregate has no eligible holder. */
  cancelFireActionsIfIdle(): void {
    if (this.game.input.state.fire) return
    this.systems?.bigRed.cancel()
    this.systems?.yoink.cancel()
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

  fixedUpdate(): void {
    if (this.pulse && this.game.input.state.fire) this.pulseSeen = true
  }

  postPhysics(): void {
    // Every fixedUpdate consumer must see the pulse before Input recomputes fire.
    if (this.pulse && this.pulseSeen) {
      this.game.input.endExternalFire(this.pulse)
      this.pulse = null
      this.pulseSeen = false
    }
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
    const input = this.game.input
    const noop = () => {}
    const tap = () => {
      if (this.pulse) return
      this.pulse = Symbol('gear pulse')
      input.beginExternalFire(this.pulse)
    }
    const generation = this.actionGeneration
    const act = (a: GearAction, fire = false): GearAction => {
      let owner: symbol | null = null
      let active = false
      let retired = false
      return Object.freeze({
        ...a,
        start: () => {
          if (generation !== this.actionGeneration || gear !== this.current || input.suspended || active) return
          if (a.hold) active = true
          if (fire) {
            owner = Symbol('gear hold')
            this.fireOwners.set(owner, gear)
            input.beginExternalFire(owner)
          }
          a.start()
        },
        ...(a.stop ? { stop: (reason: 'end' | 'cleanup' = 'end') => {
          if (!active) return
          const current = generation === this.actionGeneration
          if (reason === 'cleanup') {
            if (retired) return
            retired = true
            // Refresh the aggregate without rearming an already blocked owner.
            if (owner) input.beginExternalFire(owner)
            const hadFire = input.state.fire
            if (owner) input.suppressExternalFire(owner)
            // Input updates state synchronously but never dispatches gameplay.
            // Cancel before the next step interprets the final false as release.
            // An outgoing gear must also cancel: inHand becomes false independently
            // of a fresh holder belonging to the newly selected gear.
            if (current && fire) {
              if (gear !== this.current) {
                if (gear === 'red') sys.bigRed.cancel()
                if (gear === 'yoink') sys.yoink.cancel()
              } else if (hadFire) this.cancelFireActionsIfIdle()
            }
            if (current) a.stop!('cleanup')
            return
          }
          if (owner) {
            input.endExternalFire(owner)
            this.fireOwners.delete(owner)
            owner = null
          }
          active = false
          if (current && !retired) a.stop!('end')
          retired = false
        } } : {}),
      })
    }
    const release = act({ id: 'release', label: 'Let go', keys: ['G', 'Double tap'], hold: false, start: () => sys.bungee.letGo('released') })
    const reelAction = (direction: -1 | 1, id: string, label: string, keys: readonly string[]) => {
      let owner: symbol | null = null
      return act({ id, label, keys, hold: true,
        start: () => {
          owner = Symbol('gear reel')
          this.reelOwner = owner
          sys.bungee.setReel(direction)
        },
        stop: () => {
          if (owner !== null && this.reelOwner === owner) {
            this.reelOwner = null
            sys.bungee.setReel(0)
          }
        },
      })
    }
    let list: GearAction[]
    switch (`${gear}:${state}`) {
      case 'beam:idle':
        list = [act({ id: 'fire', label: 'Tag', keys: ['Click', 'L'], hold: true, start: noop, stop: noop }, true)]
        break
      case 'pester:idle':
        list = [act({ id: 'launch', label: 'Send a Chaser', keys: ['Click', 'L'], hold: false, start: tap })]
        break
      case 'bungee:idle':
        // Straight to the launcher, not the tag control: nothing can be left held down.
        list = [act({ id: 'launch', label: 'Launch', keys: ['Click', 'L'], hold: false, start: () => { sys.bungee.launch() } })]
        break
      case 'bungee:flying':
        list = [release]
        break
      case 'bungee:ground':
      case 'bungee:vehicle':
        list = [
          reelAction(-1, 'reelIn', 'Reel in', ['Hold click', 'Wheel up']),
          reelAction(1, 'payOut', 'Let out', ['V', 'Wheel down']),
          release,
        ]
        break
      case 'yoink:idle':
        list = [act({ id: 'grab', label: 'Grab', keys: ['Hold click', 'Hold L'], hold: true, start: noop, stop: noop }, true)]
        break
      case 'yoink:holding':
        // Explicit fling suppresses our grab owners without pretending their gestures ended.
        list = [act({ id: 'fling', label: 'Fling', keys: ['Let go of click'], hold: false, start: () => {
          for (const [owner, kind] of this.fireOwners) if (kind === 'yoink') input.suppressExternalFire(owner)
          sys.yoink.release()
        } })]
        break
      case 'red:idle':
      case 'red:charging':
        list = [act({ id: 'charge', label: 'Charge', keys: ['Hold click', 'Hold L'], hold: true, start: noop, stop: noop }, true)]
        break
      case 'red:ready':
        list = [act({ id: 'fire', label: 'Let go to send', keys: ['Let go of click'], hold: true, start: noop, stop: noop }, true)]
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
    this.last = now
    for (const l of this.listeners) l(now)
  }
}

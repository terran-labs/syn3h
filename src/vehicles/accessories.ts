/**
 * Accessories: the optional states a player can switch on the vehicle they drive, for the
 * HUD's accessory controls (src/ui/AccessoryControls.ts). One registry, keyed by vehicle
 * kind: a new vehicle, or a new switch on an old one, is one entry here and appears in the
 * HUD with its key, its state and a click target, with no UI code to write.
 *
 * Each entry only reads what the vehicle and the input already expose and switches the same
 * input state its key does, so a key press, a click and a touch button always agree.
 */
import type { Input, InputState } from '../core/Input'
import type { VehicleKind } from './index'
import { zorbSpeed } from './zorb'

/** What a vehicle exposes that accessories read. Every field is optional: a vehicle without wings has no wingState. */
export interface AccessoryVehicle {
  readonly kind: string
  /** True while the Zorb ball is out. */
  readonly zorbed?: boolean
  /** The buggy's wings, 0 folded to 1 open; between the two while moving. */
  readonly wingState?: number
}

/** An accessory's state this frame. Written into a reused object: reading allocates nothing. */
export interface AccessoryState {
  /** On reads bright; off reads quiet. */
  on: boolean
  /** The state in a word: Open, Closed, Hover, Flight, On, Off. */
  value: string
  /** 0 to 1 while changing between states (wings unfolding), else -1. */
  moving: number
  /** Why it cannot be switched right now, in a word or two, shown dimmed; empty when it can. The
   * accessory's `reasons` gives the full sentence for the tooltip. */
  unavailable: string
}

export interface Accessory {
  /** Stable id: 'zorb', 'wings', 'flight'. */
  readonly id: string
  /** Its name in the HUD. */
  readonly name: string
  /** The key cap shown, and the KeyboardEvent.code that switches it. */
  readonly cap: string
  readonly code: string
  /** One line for a tooltip and screen readers. */
  readonly title: string
  /** The full sentence for each short `unavailable` reason. */
  readonly reasons?: Readonly<Record<string, string>>
  read(vehicle: AccessoryVehicle, input: InputState, out: AccessoryState): AccessoryState
  /** Switch it exactly as the key does. */
  toggle(input: Input): void
}

/** Ride inside a ball (src/vehicles/zorb.ts). Every vehicle has it; a world can turn it off. */
export const ZORB: Accessory = {
  id: 'zorb', name: 'Zorb', cap: 'X', code: 'KeyX', title: 'Zorb: ride inside a ball. X switches it.', reasons: { 'Off here': 'This world has Zorb mode turned off.' },
  read(_vehicle, input, out) {
    out.on = input.zorb; out.value = input.zorb ? 'On' : 'Off'; out.moving = -1
    out.unavailable = zorbSpeed.value > 0 ? '' : 'Off here'
    return out
  },
  toggle(input) { input.toggleZorb() },
}

/** The special toggle (Space): the same flip the key makes in src/core/Input.ts. */
const flipSpecial = (input: Input): void => { input.state.special = !input.state.special }

/** The buggy's wings: Space opens and folds them; they animate between the two. */
export const WINGS: Accessory = {
  id: 'wings', name: 'Wings', cap: 'Space', code: 'Space', title: 'Wings: open them to glide and fly. Space switches them.', reasons: { 'In Zorb': 'Inside the Zorb, Space hops and the wings stay stowed.' },
  read(vehicle, input, out) {
    const state = vehicle.wingState ?? (input.special ? 1 : 0)
    out.on = input.special
    out.moving = state > 0 && state < 1 ? state : -1
    out.value = out.moving >= 0 ? (input.special ? 'Opening' : 'Folding') : input.special ? 'Open' : 'Folded'
    // Inside the Zorb, Space is a hop and the wings stay stowed (zorb.ts, `hold`).
    out.unavailable = vehicle.zorbed ? 'In Zorb' : ''
    return out
  },
  toggle: flipSpecial,
}

/** The jet: Space switches between hovering and forward flight (Jet.hoverMode). */
export const FLIGHT: Accessory = {
  id: 'flight', name: 'Flight', cap: 'Space', code: 'Space', title: 'Jet mode: hover in place or fly forward. Space switches it.', reasons: { 'In Zorb': 'Inside the Zorb, Space hops and the jet holds its mode.' },
  read(vehicle, input, out) {
    out.on = input.special; out.value = input.special ? 'Flight' : 'Hover'; out.moving = -1
    out.unavailable = vehicle.zorbed ? 'In Zorb' : ''
    return out
  },
  toggle: flipSpecial,
}

/**
 * The registry: each vehicle kind's accessories, in the order the HUD lists them. Kinds not
 * listed (or added later without an entry) still get Zorb.
 */
export const ACCESSORIES: Readonly<Record<VehicleKind, readonly Accessory[]>> = {
  buggy: [WINGS, ZORB],
  'buggy-syn3h': [WINGS, ZORB],
  'buggy-classic': [WINGS, ZORB],
  jet: [FLIGHT, ZORB],
  hovercraft: [ZORB],
  tank: [ZORB],
}

/** The accessories of a vehicle, by its kind. */
export function accessoriesOf(kind: string): readonly Accessory[] {
  return (ACCESSORIES as Record<string, readonly Accessory[]>)[kind] ?? [ZORB]
}

export const newAccessoryState = (): AccessoryState => ({ on: false, value: '', moving: -1, unavailable: '' })

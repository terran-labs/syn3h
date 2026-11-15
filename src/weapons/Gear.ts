/**
 * The gear rack: which piece of gear the player has in hand. Players read "gear"; files keep
 * the folder name src/weapons.
 *
 * Keys 1 to 9 pick directly and T cycles; a gamepad's D-pad left and right cycle. Only gear
 * the host allows is on the rack, so with the Bungee off the rack holds just the tag beam and
 * nothing changes for anyone. The HUD chip and touch button belong to the UX lane: they read
 * `current`, `label` and `list()` and call `select` or `next`.
 */
import { params } from '../../shared/params'
import type { Game, System } from '../core/Game'
import { bungeeAllowed } from './bungee/params'
import { lasersAllowed } from './params'

export type GearId = 'beam' | 'bungee'

/** Player-facing names. Kept here so the wording test sees them. */
export const GEAR_LABELS: Record<GearId, string> = {
  beam: 'Tag beam',
  bungee: 'Bungee',
}

const ORDER: GearId[] = ['beam', 'bungee']

export class GearRack implements System {
  private chosen: GearId = 'beam'
  private readonly listeners = new Set<(id: GearId) => void>()
  private padWas = { left: false, right: false }
  private last: GearId

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
    const on = ORDER.filter((g) => (g === 'beam' ? lasersAllowed.value : bungeeAllowed.value))
    return on.length ? on : ['beam']
  }

  get current(): GearId {
    const list = this.list()
    return list.includes(this.chosen) ? this.chosen : list[0]
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

  onChange(listener: (id: GearId) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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

  private notifyIfChanged(): void {
    const now = this.current
    if (now === this.last) return
    this.last = now
    for (const l of this.listeners) l(now)
  }
}

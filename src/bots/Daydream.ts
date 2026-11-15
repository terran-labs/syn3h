/**
 * Daydream: when the player leaves the controls alone, their own vehicle goes exploring.
 *
 * After `daydream.seconds` without a key, touch, click, wheel or gamepad input while playing,
 * a Mind takes the controls: it follows roads, strikes out for ground it has not seen, tails
 * bots and shows off. Any input hands the vehicle straight back. It writes only to the input
 * layer, exactly where the keyboard and touch stick write, so the vehicle's physics, the
 * network and the camera cannot tell the difference, and it never teleports the player.
 *
 * It does nothing in the lobby or a menu (input is suspended there), in a hidden tab, or for
 * a vehicle no pilot can drive yet.
 */
import { params, worldSeed } from '../../shared/params'
import type { Game, System } from '../core/Game'
import { emptyInput } from '../core/Input'
import type { Vehicle } from '../vehicles/Vehicle'
import type { BotTerrain } from './BotBrain'
import { Mind, type MindOptions } from './mind/Mind'
import type { Personality } from './mind/personality'
import { daydreamSeconds } from './params'
import { createPilot } from './pilot'
import type { Navigator, Pilot } from './pilot/types'

/** Lively by design: the owner asked for rambunctious and playful. */
export const DAYDREAM_PERSONALITY: Personality = { boldness: 0.7, curiosity: 0.85, sociability: 0.5, mischief: 0.7, patience: 0.35, archetype: 'explorer' }

const AXES = ['x', 'y', 'z', 'w'] as const

export interface DaydreamOptions {
  /** Other vehicles it may tail. */
  others?: () => readonly Vehicle[]
  navigator?: Navigator
  /** Places worth a visit; see MindOptions.places. */
  places?: MindOptions['places']
  /** Replace the pilot lookup, for tests. */
  pilot?: Pilot | null
}

export class Daydream implements System {
  /** True while the vehicle is driving itself. */
  active = false
  /** Seconds since the last human input while playing. */
  idleFor = 0
  mind: Mind | null = null
  private pilot: Pilot | null
  private readonly auto = emptyInput()
  private touched = false
  private specialBefore = false
  private engagements = 0
  private pill?: HTMLDivElement
  private readonly abort = typeof AbortController === 'undefined' ? undefined : new AbortController()
  private readonly unsubscribe?: () => void

  constructor(
    private readonly game: Game,
    private readonly terrain: BotTerrain,
    private player: Vehicle,
    private readonly options: DaydreamOptions = {},
  ) {
    this.pilot = options.pilot !== undefined ? options.pilot : createPilot(player, terrain)
    if (typeof window !== 'undefined' && this.abort) {
      const touch = () => { this.touched = true }
      const signal = this.abort.signal
      // Capture phase: a control that stops propagation still counts as the player being there.
      for (const type of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const) window.addEventListener(type, touch, { capture: true, passive: true, signal })
      // ?daydream=5 sets the idle time for a quick look or an automated check; 0 turns it off.
      const override = new URLSearchParams(window.location.search).get('daydream')
      if (override !== null && override !== '') params.set(daydreamSeconds.def.id, Number(override) || 0, 'preset')
    }
    this.unsubscribe = terrain.onRegenerate?.(() => this.mind?.reset())
  }

  /** Call when a human did something this class cannot see for itself. */
  noteActivity(): void { this.touched = true }

  /**
   * The player changed vehicle in place. A daydream in progress ends, as if a control had been
   * touched: its mind and pilot were built for the old vehicle. A pilot for the new kind is
   * made now, and the idle clock starts again.
   */
  setPlayer(next: Vehicle): void {
    if (next === this.player) return
    if (this.active) this.release()
    this.mind = null
    this.player = next
    this.pilot = this.options.pilot !== undefined ? this.options.pilot : createPilot(next, this.terrain)
    this.idleFor = 0; this.touched = false
  }

  update(dt: number): void {
    const input = this.game.input
    const playing = !input.suspended && (typeof document === 'undefined' || !document.hidden)
    if (!playing || !this.pilot || !(daydreamSeconds.value > 0) || !this.player.body.isValid()) {
      this.idleFor = 0; this.touched = false
      if (this.active) this.release()
      return
    }
    let human = this.touched || this.gamepadBusy()
    // While it is not driving, anything in the polled state is the player's own doing:
    // a key held down for a minute sends no new events but is certainly not idle.
    if (!this.active) {
      const s = input.state
      human ||= s.x !== 0 || s.y !== 0 || s.z !== 0 || s.w !== 0 || s.brakes || s.fire
    }
    this.touched = false
    if (human) {
      this.idleFor = 0
      if (this.active) this.release()
      return
    }
    this.idleFor += dt
    if (!this.active && this.idleFor >= daydreamSeconds.value) this.engage()
    if (this.active && this.pill && this.mind) this.pill.textContent = `Daydreaming: ${this.mind.caption}. Touch any control to take over.`
  }

  fixedUpdate(dt: number): void {
    if (!this.active || !this.mind) return
    this.mind.step(dt, this.auto)
    this.write(this.auto.x, this.auto.y, this.auto.z, this.auto.w, this.auto.brakes, this.auto.special)
  }

  private engage(): void {
    this.active = true
    this.specialBefore = this.game.input.state.special
    // A fresh mind each time, seeded so no two daydreams in a session take the same drive.
    this.mind = new Mind(this.player, this.terrain, this.pilot!, {
      seed: `${worldSeed.value}:daydream:${this.engagements++}:${this.game.tick}`,
      personality: DAYDREAM_PERSONALITY, navigator: this.options.navigator, places: this.options.places, others: this.options.others,
    })
    this.pilot!.reset()
    if (typeof document !== 'undefined') {
      this.pill ??= this.createPill()
      this.pill.hidden = false
    }
    this.announce()
  }

  private release(): void {
    this.active = false
    // Hand back only what this class put there: a thumb already on the touch stick has
    // written its own values by now, and those are the player's.
    const { state, external } = this.game.input
    for (const axis of AXES) { state[axis] = 0; if (external && external[axis] === this.auto[axis]) external[axis] = 0 }
    state.brakes = false; state.special = this.specialBefore
    if (external && external.brakes === this.auto.brakes) external.brakes = false
    this.pilot?.reset()
    if (this.pill) this.pill.hidden = true
    this.announce()
  }

  /**
   * Put the controls where a human's would go. `external` is added in by the next poll, so
   * the value survives into the next frame; `state` is written too so the remaining physics
   * steps of this frame already see it.
   */
  private write(x: number, y: number, z: number, w: number, brakes: boolean, special: boolean): void {
    const { state, external } = this.game.input, values = { x, y, z, w }
    for (const axis of AXES) { state[axis] = values[axis]; if (external) external[axis] = values[axis] }
    state.brakes = brakes; state.fire = false; state.special = special
    if (external) { external.brakes = brakes; external.fire = false }
  }

  private gamepadBusy(): boolean {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected) continue
      if (pad.axes.some(a => Math.abs(a) > 0.25) || pad.buttons.some(b => b.pressed || b.value > 0.25)) return true
    }
    return false
  }

  private createPill(): HTMLDivElement {
    // Top centre: the bottom edge belongs to the minimap, touch controls and reload notice.
    const pill = document.createElement('div')
    pill.className = 'daydream-pill'; pill.setAttribute('role', 'status')
    pill.style.cssText = 'position:fixed;left:50%;top:max(52px,calc(env(safe-area-inset-top) + 44px));transform:translateX(-50%);z-index:20;padding:7px 16px;border-radius:999px;background:rgba(8,12,20,.55);color:#dff6ff;font:500 13px/1.3 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;backdrop-filter:blur(6px);max-width:min(90vw,440px);text-align:center'
    document.body.append(pill)
    return pill
  }

  /** `syn3h:daydream` on window, detail `{ active }`, for the camera, HUD or music to react. */
  private announce(): void {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent('syn3h:daydream', { detail: { active: this.active } }))
  }

  dispose(): void {
    if (this.active) this.release()
    this.abort?.abort(); this.unsubscribe?.(); this.pill?.remove()
  }
}

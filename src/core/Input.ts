/**
 * Input: keyboard and gamepad mapped to the original Mars Explorer control vector.
 *
 * Original mapping (VehicleMe.js): input.x Horizontal, input.y Vertical, input.z Throttle,
 * input.w Yaw, Space toggles the special ability (buggy wings, jet hover), Shift brakes.
 * X toggles zorb mode, the original "/x" command (Messaging.js 67, Settings.js 423).
 */

export interface InputState {
  /** -1 left to +1 right. */
  x: number
  /** -1 back or pitch down to +1 forward or pitch up. */
  y: number
  /** Throttle, -1 to +1. */
  z: number
  /** Yaw, -1 to +1. */
  w: number
  brakes: boolean
  /** Toggled ability: buggy wings, jet hover mode. */
  special: boolean
  fire: boolean
  /** Toggled: ride inside a zorb ball (src/vehicles/zorb.ts). */
  zorb: boolean
}

export function emptyInput(): InputState {
  return { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false, zorb: false }
}

export class Input {
  readonly state: InputState = emptyInput()
  /** Additive UI controls. Special and zorb remain toggles on state; see `toggleZorb`. */
  readonly external: Partial<Omit<InputState, 'special' | 'zorb'>> = {}
  private readonly keys = new Set<string>()
  /** Set true by UI code (chat, text fields) to stop driving while typing. */
  suspended = false
  /**
   * Set by the chat field while it has focus (src/ui/chat). Separate from `suspended`, which
   * the shell recomputes from its own state at pause, menu and invite changes: typing must
   * hold however those change, and nothing but the chat field clears it.
   */
  typing = false

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (this.suspended || this.typing || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      this.keys.add(e.code)
      if (e.code === 'Space') {
        this.state.special = !this.state.special
        e.preventDefault()
      }
      if (e.code === 'KeyX') this.toggleZorb()
    })
    target.addEventListener('keyup', (e) => this.keys.delete(e.code))
    target.addEventListener('blur', () => this.keys.clear())
  }

  /**
   * Whether a physical key is down right now (KeyboardEvent.code). For a vehicle that gives a
   * key its own meaning, where the shared axes cannot say which key produced a value. False
   * while input is suspended or another mode has taken the key (roam camera).
   */
  held(code: string): boolean { return !this.suspended && !this.typing && this.keys.has(code) }

  private axis(neg: string[], pos: string[]): number {
    let v = 0
    for (const k of neg) if (this.keys.has(k)) v -= 1
    for (const k of pos) if (this.keys.has(k)) v += 1
    return Math.max(-1, Math.min(1, v))
  }

  /** Call once per rendered frame, before the fixed steps. */
  poll(): InputState {
    const s = this.state
    if (this.suspended || this.typing) {
      this.keys.clear()
      Object.assign(s, emptyInput(), { special: s.special, zorb: s.zorb })
      return s
    }
    s.x = this.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight'])
    s.y = this.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp'])
    s.z = this.axis(['KeyF'], ['KeyR'])
    s.w = this.axis(['KeyQ'], ['KeyE'])
    s.brakes = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    s.fire = this.keys.has('KeyL') || this.keys.has('Enter') || this.mouseFire

    const pad = navigator.getGamepads?.().find((p) => p && p.connected)
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v)
      const px = dz(pad.axes[0] ?? 0)
      const trigger = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0)
      const py = Math.abs(trigger) > 0.05 ? trigger : -dz(pad.axes[1] ?? 0)
      if (px !== 0) s.x = px
      if (py !== 0) s.y = py
      s.w = s.w || dz(pad.axes[2] ?? 0)
      // Throttle (z) on the right stick's vertical axis, with the D-pad as a digital fallback.
      // Only the jet reads z, so ground vehicles are unaffected; without this a jet could not
      // lift off from a gamepad at all.
      const pz = -dz(pad.axes[3] ?? 0) || (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0)
      if (pz !== 0) s.z = pz
      s.brakes = s.brakes || Boolean(pad.buttons[1]?.pressed)
      s.fire = s.fire || Boolean(pad.buttons[0]?.pressed)
      const specialDown = Boolean(pad.buttons[3]?.pressed)
      if (specialDown && !this.padSpecialWasDown) s.special = !s.special
      this.padSpecialWasDown = specialDown
    }
    for (const axis of ['x', 'y', 'z', 'w'] as const) {
      s[axis] = Math.max(-1, Math.min(1, s[axis] + (this.external[axis] ?? 0)))
    }
    s.brakes ||= this.external.brakes ?? false
    s.fire ||= this.external.fire ?? false
    return s
  }

  /**
   * Let go of everything, toggles included: wings or flight mode (`special`), Zorb, held keys,
   * the touch and gear controls' additions and a held mouse fire. For entering a different
   * world, where the player arrives in a fresh vehicle (src/core/worldEntry.ts). Suspending
   * input (the menus) keeps the toggles; this does not.
   */
  releaseAll(): void {
    this.keys.clear()
    Object.assign(this.state, emptyInput())
    for (const key of Object.keys(this.external) as (keyof typeof this.external)[]) delete this.external[key]
    this.mouseFire = false
  }

  /** Switch zorb mode. For the X key and a future touch button. */
  toggleZorb(): void {
    this.state.zorb = !this.state.zorb
  }

  /** Set by the game when the pointer is held on the canvas. */
  mouseFire = false
  private padSpecialWasDown = false
}

/**
 * Input: keyboard and gamepad mapped to the original Mars Explorer control vector.
 *
 * Original mapping (VehicleMe.js): input.x Horizontal, input.y Vertical, input.z Throttle,
 * input.w Yaw, Space toggles the special ability (buggy wings, jet hover), Shift brakes.
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
}

export function emptyInput(): InputState {
  return { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false }
}

export class Input {
  readonly state: InputState = emptyInput()
  /** Additive UI controls. Special remains a toggle on state.special. */
  readonly external: Partial<Omit<InputState, 'special'>> = {}
  private readonly keys = new Set<string>()
  /** Set true by UI code (chat, text fields) to stop driving while typing. */
  suspended = false

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (this.suspended || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      this.keys.add(e.code)
      if (e.code === 'Space') {
        this.state.special = !this.state.special
        e.preventDefault()
      }
    })
    target.addEventListener('keyup', (e) => this.keys.delete(e.code))
    target.addEventListener('blur', () => this.keys.clear())
  }

  private axis(neg: string[], pos: string[]): number {
    let v = 0
    for (const k of neg) if (this.keys.has(k)) v -= 1
    for (const k of pos) if (this.keys.has(k)) v += 1
    return Math.max(-1, Math.min(1, v))
  }

  /** Call once per rendered frame, before the fixed steps. */
  poll(): InputState {
    const s = this.state
    if (this.suspended) {
      this.keys.clear()
      Object.assign(s, emptyInput(), { special: s.special })
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

  /** Set by the game when the pointer is held on the canvas. */
  mouseFire = false
  private padSpecialWasDown = false
}

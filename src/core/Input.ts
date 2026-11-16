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

export type ExternalFireOwner = object | symbol

/** End observation only. Never use this to start a gesture from ordinary movement.
 * Cleanup, lost capture and blur provide no physical button-state sample. */
export function primaryPointerEnded(event: Pick<PointerEvent, 'type' | 'pointerType' | 'buttons'>): boolean {
  if (event.type === 'pointercancel') return true
  if (event.pointerType === 'touch') return event.type === 'pointerup'
  return (event.pointerType === 'mouse' || event.pointerType === 'pen') &&
    (event.type === 'pointermove' || event.type === 'pointerup') && (event.buttons & 1) === 0
}

export class Input {
  readonly state: InputState = emptyInput()
  /** Additive UI controls. Special and zorb remain toggles on state; see `toggleZorb`. */
  readonly external: Partial<Omit<InputState, 'special' | 'zorb'>> = {}
  private readonly keys = new Set<string>()
  private readonly fireOwners = new Map<ExternalFireOwner, boolean>()
  private readonly rawFireKeys = new Set<string>()
  private readonly blockedFireKeys = new Set<string>()
  private readonly rawMouse = new Set<number>()
  private readonly blockedMouse = new Set<number>()
  private readonly blockedPads = new Set<number>()
  private unknownMouseBlocked = false
  private legacyFire = false
  private legacyFireDisabled = false
  /** Set true by UI code (chat, text fields) to stop driving while typing. */
  suspended = false

  constructor(target: Window = window) {
    // Legacy writes remain compatible until cancellation. A boolean cannot prove that a
    // physical gesture ended: ALL external writers must migrate before modal delivery.
    Object.defineProperty(this.external, 'fire', {
      enumerable: true,
      get: () => !this.suspended && (this.ownerFire() || (!this.legacyFireDisabled && this.legacyFire)),
      set: (value: boolean) => { this.legacyFire = Boolean(value) },
    })
    target.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyL' && e.code !== 'Enter') return
      this.rawFireKeys.add(e.code)
      if (this.suspended || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        this.blockedFireKeys.add(e.code)
    }, true)
    target.addEventListener('keyup', (e) => {
      this.rawFireKeys.delete(e.code)
      this.blockedFireKeys.delete(e.code)
      this.keys.delete(e.code)
    }, true)
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.pointerType === 'touch') return
      this.rawMouse.add(e.pointerId)
      if (this.suspended) this.blockedMouse.add(e.pointerId)
    }, true)
    const mouseEnd = (e: PointerEvent) => {
      if (!this.rawMouse.has(e.pointerId) || e.pointerType === 'touch' || !primaryPointerEnded(e)) return
      this.rawMouse.delete(e.pointerId)
      this.blockedMouse.delete(e.pointerId)
      this.unknownMouseBlocked = false
      // Net's last-button pointerup can arrive later in a chord. Do not let its stale
      // boolean keep primary fire alive after this observed primary-neutral transition.
      this.mouseFire = false
      this.refreshFire()
    }
    target.addEventListener('pointermove', mouseEnd, true)
    target.addEventListener('pointerup', mouseEnd, true)
    target.addEventListener('pointercancel', mouseEnd, true)
    target.addEventListener('keydown', (e) => {
      if (this.suspended || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      this.keys.add(e.code)
      if (e.code === 'Space') {
        this.state.special = !this.state.special
        e.preventDefault()
      }
      if (e.code === 'KeyX') this.toggleZorb()
    })
    target.addEventListener('keyup', (e) => this.keys.delete(e.code))
    // Raw fire identities survive blur. The composition owner must cancel Gear first,
    // then call cancelFireUntilNeutral from its capture-phase blur handler. Dropping
    // sampled fire here before Gear cancellation could release a charge or carry.
    target.addEventListener('blur', () => this.keys.clear())
  }

  /**
   * Whether a physical key is down right now (KeyboardEvent.code). For a vehicle that gives a
   * key its own meaning, where the shared axes cannot say which key produced a value. False
   * while input is suspended or another mode has taken the key (roam camera).
   */
  held(code: string): boolean { return !this.suspended && this.keys.has(code) }

  private axis(neg: string[], pos: string[]): number {
    let v = 0
    for (const k of neg) if (this.keys.has(k)) v -= 1
    for (const k of pos) if (this.keys.has(k)) v += 1
    return Math.max(-1, Math.min(1, v))
  }

  /** Call once per rendered frame, before the fixed steps. */
  poll(): InputState {
    const s = this.state
    const pad = this.samplePads()
    if (this.suspended) {
      this.refreshFire(pad)
      this.keys.clear()
      Object.assign(s, emptyInput(), { special: s.special, zorb: s.zorb })
      return s
    }
    s.x = this.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight'])
    s.y = this.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp'])
    s.z = this.axis(['KeyF'], ['KeyR'])
    s.w = this.axis(['KeyQ'], ['KeyE'])
    s.brakes = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    s.fire = false
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
      const specialDown = Boolean(pad.buttons[3]?.pressed)
      if (specialDown && !this.padSpecialWasDown) s.special = !s.special
      this.padSpecialWasDown = specialDown
    }
    for (const axis of ['x', 'y', 'z', 'w'] as const) {
      s[axis] = Math.max(-1, Math.min(1, s[axis] + (this.external[axis] ?? 0)))
    }
    s.brakes ||= this.external.brakes ?? false
    this.refreshFire(pad)
    return s
  }

  /** One token per real gesture. Reusing a suppressed token never rearms it. */
  beginExternalFire(owner: ExternalFireOwner): void {
    if (!this.fireOwners.has(owner)) this.fireOwners.set(owner, this.suspended)
    this.refreshFire()
  }

  /** Only a real end/cancel retires identity, never UI teardown or blur. */
  endExternalFire(owner: ExternalFireOwner): void {
    if (!this.fireOwners.delete(owner)) return
    this.refreshFire()
  }

  /** Suppress this holder without retiring it or interrupting other eligible holders.
   * These APIs update state only. They never dispatch events or tick gameplay. */
  suppressExternalFire(owner: ExternalFireOwner): void {
    if (!this.fireOwners.has(owner)) return
    this.fireOwners.set(owner, true)
    this.refreshFire()
  }

  /** Call before clearing UI gestures or suspending input. Legacy boolean fire is
   * permanently ignored afterwards: it cannot distinguish cleanup from real release. */
  cancelFireUntilNeutral(): void {
    for (const key of this.rawFireKeys) this.blockedFireKeys.add(key)
    for (const id of this.rawMouse) this.blockedMouse.add(id)
    if (this.mouseFire && this.rawMouse.size === 0) this.unknownMouseBlocked = true
    this.samplePads(true)
    for (const owner of this.fireOwners.keys()) this.fireOwners.set(owner, true)
    this.legacyFireDisabled = true
    this.legacyFire = false
    this.state.fire = false
  }

  private ownerFire(): boolean {
    for (const blocked of this.fireOwners.values()) if (!blocked) return true
    return false
  }

  private samplePads(block = this.suspended): Gamepad | undefined {
    const pads = navigator.getGamepads?.() ?? []
    let first: Gamepad | undefined
    for (const pad of pads) {
      if (!pad?.connected) continue
      first ??= pad
      if (!pad.buttons[0]?.pressed) this.blockedPads.delete(pad.index)
      else if (block) this.blockedPads.add(pad.index)
    }
    // Disconnection is not evidence of neutral. Reconnection while held stays blocked.
    return first
  }

  private refreshFire(pad = this.samplePads()): void {
    if (this.suspended) {
      for (const key of this.rawFireKeys) this.blockedFireKeys.add(key)
      for (const id of this.rawMouse) this.blockedMouse.add(id)
      for (const owner of this.fireOwners.keys()) this.fireOwners.set(owner, true)
      this.state.fire = false
      return
    }
    const key = ['KeyL', 'Enter'].some(code => this.keys.has(code) && !this.blockedFireKeys.has(code))
    const mouse = this.mouseFire && !this.unknownMouseBlocked &&
      (this.rawMouse.size === 0 ? this.blockedMouse.size === 0 :
        [...this.rawMouse].some(id => !this.blockedMouse.has(id)))
    this.state.fire = key || mouse || Boolean(pad?.buttons[0]?.pressed && !this.blockedPads.has(pad.index)) ||
      Boolean(this.external.fire)
  }

  /** Switch zorb mode. For the X key and a future touch button. */
  toggleZorb(): void {
    this.state.zorb = !this.state.zorb
  }

  /** Set by the game when the pointer is held on the canvas. */
  mouseFire = false
  private padSpecialWasDown = false
}

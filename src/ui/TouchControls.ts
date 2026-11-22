import type { VehicleKind } from '../vehicles'
import type { Input } from '../core/Input'
import { params } from '../../shared/params'
import './touch-stick.css'
import { persistHandedness, touchAimCurve, touchAimRadius, touchAimSpeed, touchLeftHanded, touchPinchSpeed, touchRole } from './TouchPreferences'
import { AimTouches, TagStick, type TagMode, type Zone } from './tagStick'
import { setTouchAiming } from '../core/touchAim'

/*
 * The floating thumb stick: pure maths, exported for tests/ui/touch-stick.test.ts.
 *
 * The response is the one the permanent stick had: the finger's offset from the base centre,
 * divided by the radius, clamped to the unit circle, with each axis zeroed inside a dead zone
 * of 0.08 (and not rescaled outside it). The radius is 0.34 of the base's width, which the
 * stylesheets size per layout (140, 124 or 110 px), so the travel is unchanged too.
 */
export const STICK_RADIUS_SCALE = 0.34
export const STICK_DEAD_ZONE = 0.08
/** How far a touch moves, in CSS px, before it is a drag rather than a tap. */
export const DRAG_THRESHOLD = 8
/** Drags that start within this fraction of the screen width, from the driving hand's edge, drive. */
export { STICK_REGION } from './TouchPreferences'

export interface StickPoint { x: number; y: number }
export const stickRadius = (baseWidth: number): number => baseWidth * STICK_RADIUS_SCALE
/** One axis through the dead zone. */
export const stickResponse = (value: number): number => Math.abs(value) < STICK_DEAD_ZONE ? 0 : value
/**
 * The deflection, from -1 to 1 on each axis with screen y down, written into `out`.
 * A finger past the radius gives a unit vector; a zero radius gives no deflection.
 */
export function stickVector(origin: Readonly<StickPoint>, fingerX: number, fingerY: number, radius: number, out: StickPoint): StickPoint {
  if (!(radius > 0)) { out.x = 0; out.y = 0; return out }
  const x = (fingerX - origin.x) / radius, y = (fingerY - origin.y) / radius
  const length = Math.max(1, Math.hypot(x, y))
  out.x = x / length; out.y = y / length
  return out
}
/** True once a touch has moved far enough from where it went down to be a drag. */
export const isDrag = (fromX: number, fromY: number, x: number, y: number): boolean => Math.hypot(x - fromX, y - fromY) >= DRAG_THRESHOLD

const DRIVEN_KEY = 'syn3h.touch.driven'
function readDriven(): boolean { try { return localStorage.getItem(DRIVEN_KEY) === '1' } catch { return false } }
function writeDriven(): void { try { localStorage.setItem(DRIVEN_KEY, '1') } catch { /* No storage: the hint returns next session. */ } }

/** Each control owns its pointer so driving and tagging can happen simultaneously. */
export interface TouchGear { attached(): boolean; letGo(): void }
/** How the Tag button reaches the gear in hand (bound by the Shell; see src/ui/tagStick.ts). */
export interface TouchTag {
  /** What a press does with the gear in hand now. */
  mode(): TagMode
  /** Press the tag control for exactly one physics step. */
  tap(): void
  /** Drop a held charge or carry without sending it. */
  cancel(): void
}
/** How long the reticle and the camera aim outlast the lift, ms: a release shot still goes where it pointed. */
export const TAG_FADE_MS = 150
/** The cameras with a distance to pinch: chase (camera.mode 0) and orbit (2). Cockpit, stationary and roam have none. */
const zoomableCamera = (): boolean => { const mode = Math.round(Number(params.get('camera.mode')?.value ?? 0)); return mode === 0 || mode === 2 }
export class TouchControls {
  readonly element = document.createElement('div')
  private readonly abort = new AbortController()
  private readonly resetters: (() => void)[] = []
  private active = false
  readonly available = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches
  /** Whether this device has driven with the stick, so the first-run hint can stay away. */
  private driven = readDriven()
  private hint?: HTMLElement
  private kind: VehicleKind = 'buggy'
  /** Camera look in CSS px of finger travel, from the aiming hand. ChaseCamera listens for syn3h:look. */
  onLook = (dx: number, dy: number): void => { window.dispatchEvent(new CustomEvent('syn3h:look', { detail: { dx, dy } })) }
  /** Camera zoom in wheel pixels, positive out. ChaseCamera listens for syn3h:zoom. */
  onZoom = (deltaY: number): void => { window.dispatchEvent(new CustomEvent('syn3h:zoom', { detail: { deltaY } })) }
  /** The gear behind the Tag button. Unbound, Tag holds the tag control as it always did. */
  tag?: TouchTag
  private readonly tagStick = new TagStick({
    fire: (on) => { this.input.external.fire = on },
    tap: () => { if (this.tag) this.tag.tap(); else this.input.external.fire = true },
    cancel: () => { this.tag?.cancel(); this.input.external.fire = false },
    look: (dx, dy) => this.onLook(dx, dy),
  }, () => ({ speed: touchAimSpeed.value, radius: touchAimRadius.value, curve: touchAimCurve.value }))
  private lastFrame = 0
  private fadeTimer = 0
  private cancelRing?: HTMLElement
  /** Shows Tag's held state and the Cancel ring; run on every Tag event and every held frame. */
  private syncTag = (): void => {}

  constructor(private readonly input: Input, parent: HTMLElement = document.body) {
    this.element.className = 'touch-controls'
    this.element.setAttribute('aria-label', 'Touch driving controls')
    this.element.hidden = true
    if (!this.available) return
    // Every thumb button is the shared glass button (liquid-glass, shell.css), round; this file
    // and touch-stick.css set only its size, place and states.
    this.element.innerHTML = `<div class="touch-stick touch-float" aria-hidden="true"><span class="touch-knob"></span></div><div class="touch-stick-hint" hidden><span class="touch-stick-ghost"><span></span></span><span class="touch-stick-label">Drag on the left to drive</span></div><div class="touch-actions"><button type="button" class="liquid-glass glass-round" data-action="throttleUp" hidden>THR +</button><button type="button" class="liquid-glass glass-round" data-action="throttleDown" hidden>THR −</button><button type="button" class="liquid-glass glass-round" data-action="special" aria-pressed="false">WINGS</button><button type="button" class="liquid-glass glass-round" data-action="brakes">BRAKE</button><button type="button" class="liquid-glass glass-round" data-action="flip" aria-label="Flip upright" hidden>FLIP</button><button type="button" class="liquid-glass glass-round" data-action="zorb" aria-pressed="false">ZORB</button><button type="button" class="liquid-glass glass-round" data-action="letOut" hidden>LET OUT</button><button type="button" class="liquid-glass glass-round" data-action="letGo" hidden>LET GO</button><button type="button" class="liquid-glass glass-round touch-fire" data-action="fire">TAG</button></div><div class="touch-cancel" aria-hidden="true"><span>Cancel</span></div>`
    parent.append(this.element)
    const signal = this.abort.signal
    this.hint = this.element.querySelector<HTMLElement>('.touch-stick-hint')!
    this.cancelRing = this.element.querySelector<HTMLElement>('.touch-cancel')!
    signal.addEventListener('abort', persistHandedness())
    const unwatch = params.onChange((id) => { if (id === touchLeftHanded.def.id) { this.reset(); this.syncHandedness() } })
    signal.addEventListener('abort', unwatch)
    this.syncHandedness()
    this.stick(signal)
    this.aim(signal)
    this.tagButton(signal)
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('button:not([data-action="fire"])')) {
      const action = button.dataset.action as 'brakes' | 'special' | 'throttleUp' | 'throttleDown' | 'zorb' | 'letOut' | 'letGo' | 'flip'
      const pointers = new Set<number>()
      const throttle = action === 'throttleUp' || action === 'throttleDown'
      const release = () => { pointers.clear(); if (throttle) { this.thrust.delete(action); this.syncThrust() } else if (action === 'letOut') this.key('keyup'); else if (action !== 'special' && action !== 'zorb' && action !== 'letGo' && action !== 'flip') input.external[action] = false; button.classList.remove('held') }
      this.resetters.push(release)
      button.addEventListener('pointerdown', (event) => {
        if (!this.active || input.suspended) return
        event.preventDefault(); button.setPointerCapture(event.pointerId); pointers.add(event.pointerId)
        if (action === 'special') input.state.special = !input.state.special
        // Zorb mode, the X key: ride inside a ball. A toggle, like the wings.
        else if (action === 'zorb') input.toggleZorb()
        else if (throttle) { this.thrust.add(action); this.syncThrust() }
        // Bungee: LET GO drops the cord; LET OUT pays it out for as long as it is held (the V key).
        else if (action === 'letGo') this.gear?.letGo()
        else if (action === 'letOut') this.key('keydown')
        // Flip upright, the U key: offered in BRAKE's place only while it can act (setFlipReady).
        else if (action === 'flip') input.requestFlip()
        else input.external[action] = true
        button.classList.add('held'); this.update()
      }, { signal })
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(name, (event) => { pointers.delete(event.pointerId); if (!pointers.size) release() }, { signal })
      }
    }
    // Rotation invalidates the old viewport coordinates. Release all held controls;
    // only a fresh touch may establish a new stick centre.
    window.addEventListener('resize', () => this.reset(), { signal })
    window.addEventListener('blur', () => this.reset(), { signal })
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset() }, { signal })
    this.element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal })
  }

  /**
   * The floating stick. The rule, as built:
   *
   * - A touch becomes a stick candidate when it goes down in the driving hand's 55% of the
   *   screen (the left for a right-handed player, the right for a left-handed one) on the
   *   game view itself (the game canvas or the bare page), not on a button, the gear selector,
   *   any panel or HUD element (those are other elements, so they are never the target). The
   *   minimap sits in the stick's corner and lets touches through to the canvas, so a touch on
   *   it drives too (the owner, 17 November 2026); it never aims. Nothing is prevented or
   *   captured at that point, so a tap reaches whatever is under it exactly as before.
   * - A candidate that moves 8 px becomes the stick: its base appears centred where the touch
   *   went down, the pointer is captured, and from then on the knob follows the finger. Past
   *   the radius the knob and output saturate; the base stays at touch-down. Lifting fades it out in 150 ms.
   * - Only one stick at a time: while one is active or pending, further touches in the region
   *   are ignored by the stick (they still reach whatever is under them).
   * - The network layer excludes touch pointers from mouse tagging; the other thumb owns
   *   the action buttons and aiming (see `aim`) while this one drives. Each finger is
   *   independent, so steering, aiming and holding a button all work at once.
   */
  private stick(signal: AbortSignal): void {
    const input = this.input
    const base = this.element.querySelector<HTMLElement>('.touch-stick')!
    const knob = base.querySelector<HTMLElement>('.touch-knob')!
    // Reused for every event: the move handler allocates nothing but the transform strings.
    const origin: StickPoint = { x: 0, y: 0 }, down: StickPoint = { x: 0, y: 0 }, vector: StickPoint = { x: 0, y: 0 }
    let pending: number | null = null, pointer: number | null = null, radius = 0, half = 0
    const place = () => {
      base.style.transform = `translate3d(${origin.x - half}px,${origin.y - half}px,0)`
      // A driving notice's face may be drawn by the glass shader into the canvas, under every
      // element, so no stacking order keeps the ring off it: the ring and knob are cut where a
      // shown notice is instead (an even-odd hole). Once per drag: the base stays put.
      const notice = document.querySelector<HTMLElement>('.syn3h-shell > .drive-notices > :not([hidden])')
      const r = notice?.getBoundingClientRect()
      const l = r ? r.left - (origin.x - half) : 0, t = r ? r.top - (origin.y - half) : 0, w = half * 2
      base.style.clipPath = r && r.width && l < w && t < w && l + r.width > 0 && t + r.height > 0
        ? `polygon(evenodd, 0 0, ${w}px 0, ${w}px ${w}px, 0 ${w}px, 0 0, ${l}px ${t}px, ${l + r.width}px ${t}px, ${l + r.width}px ${t + r.height}px, ${l}px ${t + r.height}px, ${l}px ${t}px)`
        : ''
    }
    const release = () => {
      if (pointer !== null && base.hasPointerCapture?.(pointer)) try { base.releasePointerCapture(pointer) } catch { /* Already gone. */ }
      pending = null; pointer = null; input.external.x = 0; input.external.y = 0; base.classList.remove('is-active')
    }
    this.resetters.push(release)
    const drive = (x: number, y: number) => {
      stickVector(origin, x, y, radius, vector)
      input.external.x = stickResponse(vector.x)
      input.external.y = stickResponse(-vector.y)
      knob.style.transform = `translate3d(${vector.x * radius}px,${vector.y * radius}px,0)`
    }
    const start = (event: PointerEvent) => {
      pending = null; pointer = event.pointerId
      origin.x = down.x; origin.y = down.y
      half = base.offsetWidth / 2; radius = stickRadius(base.offsetWidth)
      try { base.setPointerCapture(pointer) } catch { /* The window listeners below still follow it. */ }
      place(); base.classList.add('is-active')
      if (!this.driven) { this.driven = true; writeDriven(); this.syncHint() }
    }
    const candidate = (event: PointerEvent): boolean => this.role(event) === 'drive'
    addEventListener('pointerdown', (event) => {
      if (!this.active || input.suspended || !candidate(event)) return
      if (pending !== null || pointer !== null) return
      pending = event.pointerId; down.x = event.clientX; down.y = event.clientY
    }, { capture: true, signal })
    addEventListener('pointermove', (event) => {
      const id = event.pointerId
      if (id === pending) { if (!isDrag(down.x, down.y, event.clientX, event.clientY)) return; start(event) }
      if (id === pointer) { event.preventDefault(); drive(event.clientX, event.clientY) }
    }, { capture: true, signal })
    const end = (event: PointerEvent) => { if (event.pointerId === pending) pending = null; else if (event.pointerId === pointer) release() }
    for (const name of ['pointerup', 'pointercancel'] as const) addEventListener(name, end, { capture: true, signal })
    base.addEventListener('lostpointercapture', end, { signal })
  }

  /** What a touch that just went down should do: see `touchRole`. */
  private role(event: PointerEvent): 'drive' | 'aim' | null {
    if (event.pointerType !== 'touch') return null
    const target = event.target
    const inside = (el: Element | null) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
    }
    // A driving notice (the slow-frames offer, race status) shows exactly while someone drives,
    // where the steering thumb rests. Its body lets touches through (touch-stick.css); a touch
    // that lands on one of its buttons may still become the stick if it drags, which captures
    // the pointer so the button is never pressed. A tap that does not drag presses it as before.
    // On the aiming side such a button stays a plain button.
    const onNotice = target instanceof Element && !!target.closest('.drive-notices button')
    const role = touchRole({
      x: event.clientX, width: innerWidth, leftHanded: touchLeftHanded.value,
      onGameView: onNotice || target === document.body || target === document.documentElement || (target instanceof HTMLCanvasElement && !target.closest('.syn3h-shell, .touch-controls')),
      // The minimap lets touches through to the canvas, and the gaps between action buttons are
      // canvas too, so both are tested by position.
      onMinimap: inside(document.querySelector('.shell-minimap')),
      onActions: inside(this.element.querySelector('.touch-actions')),
    })
    return onNotice && role !== 'drive' ? null : role
  }

  /**
   * The free game view opposite the stick (see `touchRole`). Like the stick, a touch is only a
   * candidate until it moves 8 px, so a tap still reaches whatever is under it. One finger
   * dragging turns the camera by the finger's travel, at the mouse look sensitivity
   * (camera.sensitivity). In the chase and orbit cameras a second finger there makes a pinch
   * that zooms as the wheel does, while the stick and buttons go on working; see AimTouches in
   * src/ui/tagStick.ts.
   */
  private aim(signal: AbortSignal): void {
    const touches = new AimTouches({ look: (dx, dy) => this.onLook(dx, dy), zoom: (deltaY) => this.onZoom(deltaY) }, () => touchPinchSpeed.value)
    this.resetters.push(() => touches.reset())
    addEventListener('pointerdown', (event) => {
      if (!this.active || this.input.suspended || this.role(event) !== 'aim') return
      if (touches.down(event.pointerId, event.clientX, event.clientY, zoomableCamera()) === 'pinch') event.preventDefault()
    }, { capture: true, signal })
    addEventListener('pointermove', (event) => {
      if (this.input.suspended) { touches.reset(); return }
      const wasLooking = touches.looking
      if (!touches.move(event.pointerId, event.clientX, event.clientY)) return
      event.preventDefault()
      if (!wasLooking && touches.looking) try { (event.target as Element).setPointerCapture?.(event.pointerId) } catch { /* The window listeners still follow it. */ }
    }, { capture: true, signal })
    for (const name of ['pointerup', 'pointercancel'] as const) addEventListener(name, (event) => touches.up(event.pointerId), { capture: true, signal })
  }

  /**
   * TAG: press and drag to aim, lift to send. See TagStick in src/ui/tagStick.ts for the rule.
   * The button captures its pointer, so the thumb may wander anywhere and the drive stick and
   * the other buttons keep their own fingers. While Tag is down the gear aims through the
   * centre reticle (src/core/touchAim.ts) and the Shell draws it; both outlast the lift by
   * TAG_FADE_MS.
   */
  private tagButton(signal: AbortSignal): void {
    const button = this.element.querySelector<HTMLButtonElement>('[data-action="fire"]')!
    const stick = this.tagStick
    const ring = this.cancelRing!
    const sync = this.syncTag = () => {
      button.classList.toggle('held', stick.held)
      ring.classList.toggle('is-shown', stick.cancellable)
      ring.classList.toggle('is-armed', stick.overCancel)
    }
    const end = () => {
      sync()
      clearTimeout(this.fadeTimer)
      document.documentElement.dataset.touchAim = 'out'
      this.fadeTimer = window.setTimeout(() => { if (!stick.held) { delete document.documentElement.dataset.touchAim; setTouchAiming(false) } }, TAG_FADE_MS)
    }
    this.resetters.push(() => { if (stick.held) { stick.reset(); end() } })
    button.addEventListener('pointerdown', (event) => {
      if (!this.active || this.input.suspended || stick.held) return
      event.preventDefault()
      try { button.setPointerCapture(event.pointerId) } catch { /* The button's listeners still see it while it is over the button. */ }
      const mode = this.tag?.mode() ?? 'stream'
      clearTimeout(this.fadeTimer)
      setTouchAiming(true); document.documentElement.dataset.touchAim = 'on'
      stick.down(event.pointerId, event.clientX, event.clientY, mode, this.cancelZone(button, ring))
      this.lastFrame = performance.now()
      sync(); this.update()
    }, { signal })
    button.addEventListener('pointermove', (event) => {
      if (event.pointerId !== stick.pointer) return
      event.preventDefault()
      stick.move(event.pointerId, event.clientX, event.clientY); sync()
    }, { signal })
    const lift = (how: 'up' | 'cancel') => (event: PointerEvent) => { if (stick.up(event.pointerId, how)) end() }
    button.addEventListener('pointerup', lift('up'), { signal })
    button.addEventListener('pointercancel', lift('cancel'), { signal })
    // Capture lost without a pointerup (the element was hidden, say): nothing is sent.
    button.addEventListener('lostpointercapture', lift('cancel'), { signal })
  }

  /**
   * Place the Cancel ring diagonally above the cluster, one slot up and one slot in from Tag
   * toward the middle of the screen (outward it would cover the chat button on phones), and
   * return its catch circle.
   */
  private cancelZone(button: HTMLElement, ring: HTMLElement): Zone | null {
    const r = button.getBoundingClientRect()
    if (!(r.width > 0)) return null
    const gap = parseFloat(getComputedStyle(button.parentElement!).columnGap) || 0
    const inward = touchLeftHanded.value ? 1 : -1
    const x = r.left + r.width / 2 + inward * (r.width + gap), y = r.top - gap - r.height / 2
    ring.style.width = ring.style.height = `${r.width}px`
    ring.style.transform = `translate3d(${x - r.width / 2}px,${y - r.height / 2}px,0)`
    return { x, y, r: r.width * 0.6 }
  }

  /** Mirror the stick, hint and buttons for the driving hand. */
  private syncHandedness(): void {
    const left = touchLeftHanded.value
    this.element.dataset.hand = left ? 'left' : 'right'
    document.documentElement.dataset.touchHand = left ? 'left' : 'right'
    const label = this.element.querySelector('.touch-stick-label')
    if (label) label.textContent = `Drag on the ${left ? 'right' : 'left'} to ${this.kind === 'jet' ? 'fly' : 'drive'}`
  }

  /** The first-run hint shows in play until this device has driven once. */
  private syncHint(): void { if (this.hint) this.hint.hidden = this.driven || !this.active }
  private readonly thrust = new Set<string>()
  private syncThrust(): void { this.input.external.z = Number(this.thrust.has('throttleUp')) - Number(this.thrust.has('throttleDown')) }
  setVehicleKind(kind: VehicleKind): void {
    this.reset(); this.kind = kind; this.syncHandedness()
    // The thumb grid's shape (touch-stick.css), and how many columns it has, so the gear's own
    // buttons (src/ui/gear/gear.css) line up as the next column out.
    this.element.dataset.vehicle = kind
    document.documentElement.style.setProperty('--thumb-columns', kind === 'jet' ? '3' : '2')
    for (const button of this.element.querySelectorAll<HTMLElement>('[data-action^="throttle"]')) button.hidden = kind !== 'jet'
    const special = this.element.querySelector<HTMLButtonElement>('[data-action="special"]')
    if (special) {
      // The Liquid Glass press gathers a button's text into one label (src/fx/post/GlassPress.ts): write into it when it is there.
      (special.querySelector('.glass-press-label') ?? special).textContent = kind === 'jet' ? 'MODE' : 'WINGS'
      special.hidden = kind === 'hovercraft'
    }
  }
  set enabled(value: boolean) {
    this.active = value; this.element.hidden = !value || !this.available
    if (!value) this.reset()
    this.syncHint()
  }
  private gear?: TouchGear
  /** The Bungee, once networking exists. Its two buttons show only while a cord is attached. */
  setGear(gear: TouchGear): void { this.gear = gear }
  /** The Bungee reads V from the keyboard; holding LET OUT is holding V. */
  private key(type: 'keydown' | 'keyup'): void { window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyV', key: 'v' })) }
  update(): void {
    if (this.tagStick.held) {
      const now = performance.now()
      this.tagStick.frame((now - this.lastFrame) / 1000)
      this.lastFrame = now
      // Held still, the Cancel ring appears after a moment (TagStick.cancellable).
      this.syncTag()
    }
    const cord = Boolean(this.gear?.attached())
    for (const action of ['letOut', 'letGo']) { const button = this.element.querySelector<HTMLElement>(`[data-action="${action}"]`); if (button && button.hidden === cord) button.hidden = !cord }
    this.element.querySelector('[data-action="special"]')?.setAttribute('aria-pressed', String(this.input.state.special))
    this.element.querySelector('[data-action="zorb"]')?.setAttribute('aria-pressed', String(this.input.state.zorb))
  }
  private flipReady = false
  /**
   * Offer Flip upright: while the vehicle lies on its side or roof, nearly still
   * (Vehicle.canFlip), FLIP takes BRAKE's place in the thumb grid, where the thumb rests and
   * where braking does nothing for a vehicle that is not moving. The grid keeps its shape.
   */
  setFlipReady(ready: boolean): void {
    if (ready === this.flipReady || !this.available) return
    this.flipReady = ready
    const flip = this.element.querySelector<HTMLElement>('[data-action="flip"]'), brakes = this.element.querySelector<HTMLElement>('[data-action="brakes"]')
    if (flip) flip.hidden = !ready
    if (brakes) brakes.hidden = ready
  }
  /** Pulse one button, to go with a hint that names it. Null clears it. */
  highlight(action: string | null): void {
    for (const button of this.element.querySelectorAll<HTMLElement>('button')) button.classList.toggle('is-hinted', button.dataset.action === action)
  }
  private reset(): void { for (const reset of this.resetters) reset() }
  dispose(): void { this.reset(); this.abort.abort(); this.element.remove() }
}

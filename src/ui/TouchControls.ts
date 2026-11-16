import type { VehicleKind } from '../vehicles'
import type { Input } from '../core/Input'
import { params } from '../../shared/params'
import './touch-stick.css'
import { persistHandedness, touchLeftHanded, touchRole } from './TouchPreferences'

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

  constructor(private readonly input: Input, parent: HTMLElement = document.body) {
    this.element.className = 'touch-controls'
    this.element.setAttribute('aria-label', 'Touch driving controls')
    this.element.hidden = true
    if (!this.available) return
    this.element.innerHTML = `<div class="touch-stick touch-float" aria-hidden="true"><span class="touch-knob"></span></div><div class="touch-stick-hint" hidden><span class="touch-stick-ghost"><span></span></span><span class="touch-stick-label">Drag on the left to drive</span></div><div class="touch-actions"><button type="button" data-action="throttleUp" hidden>THR +</button><button type="button" data-action="throttleDown" hidden>THR −</button><button type="button" data-action="special" aria-pressed="false">WINGS</button><button type="button" data-action="brakes">BRAKE</button><button type="button" data-action="zorb" aria-pressed="false">ZORB</button><button type="button" data-action="letOut" hidden>LET OUT</button><button type="button" data-action="letGo" hidden>LET GO</button><button type="button" class="touch-fire" data-action="fire">TAG</button></div>`
    parent.append(this.element)
    const signal = this.abort.signal
    this.hint = this.element.querySelector<HTMLElement>('.touch-stick-hint')!
    signal.addEventListener('abort', persistHandedness())
    const unwatch = params.onChange((id) => { if (id === touchLeftHanded.def.id) { this.reset(); this.syncHandedness() } })
    signal.addEventListener('abort', unwatch)
    this.syncHandedness()
    this.stick(signal)
    this.aim(signal)
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('button')) {
      const action = button.dataset.action as 'brakes' | 'special' | 'fire' | 'throttleUp' | 'throttleDown' | 'zorb' | 'letOut' | 'letGo'
      const pointers = new Set<number>()
      const throttle = action === 'throttleUp' || action === 'throttleDown'
      const release = () => { pointers.clear(); if (throttle) { this.thrust.delete(action); this.syncThrust() } else if (action === 'letOut') this.key('keyup'); else if (action !== 'special' && action !== 'zorb' && action !== 'letGo') input.external[action] = false; button.classList.remove('held') }
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
   *   any panel or HUD element (those are other elements, so they are never the target), and
   *   not inside the minimap's rectangle (the minimap lets touches through to the canvas, so
   *   it is tested by position). Nothing is prevented or captured at that point, so a tap
   *   reaches whatever is under it exactly as before.
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
    const place = () => { base.style.transform = `translate3d(${origin.x - half}px,${origin.y - half}px,0)` }
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
    return touchRole({
      x: event.clientX, width: innerWidth, leftHanded: touchLeftHanded.value,
      onGameView: target === document.body || target === document.documentElement || (target instanceof HTMLCanvasElement && !target.closest('.syn3h-shell, .touch-controls')),
      // The minimap lets touches through to the canvas, and the gaps between action buttons are
      // canvas too, so both are tested by position.
      onMinimap: inside(document.querySelector('.shell-minimap')),
      onActions: inside(this.element.querySelector('.touch-actions')),
    })
  }

  /**
   * Drag to aim, on the free game view opposite the stick. Like the stick, a touch is only a
   * candidate until it moves 8 px, so a tap still reaches whatever is under it. Then it owns
   * its pointer until it lifts and turns the camera (and the gear, which aims along it) by the
   * finger's travel, at the mouse look sensitivity (camera.sensitivity). One aiming finger at a time.
   */
  private aim(signal: AbortSignal): void {
    let pending: number | null = null, pointer: number | null = null, x = 0, y = 0
    const release = () => { pending = null; pointer = null }
    this.resetters.push(release)
    addEventListener('pointerdown', (event) => {
      if (!this.active || this.input.suspended || pending !== null || pointer !== null) return
      if (this.role(event) !== 'aim') return
      pending = event.pointerId; x = event.clientX; y = event.clientY
    }, { capture: true, signal })
    addEventListener('pointermove', (event) => {
      const id = event.pointerId
      if (id === pending) {
        if (!isDrag(x, y, event.clientX, event.clientY)) return
        pending = null; pointer = id
        try { (event.target as Element).setPointerCapture?.(id) } catch { /* The window listeners still follow it. */ }
      }
      if (id !== pointer) return
      event.preventDefault()
      if (this.input.suspended) { release(); return }
      this.onLook(event.clientX - x, event.clientY - y)
      x = event.clientX; y = event.clientY
    }, { capture: true, signal })
    for (const name of ['pointerup', 'pointercancel'] as const) {
      addEventListener(name, (event) => { if (event.pointerId === pending || event.pointerId === pointer) release() }, { capture: true, signal })
    }
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
    for (const button of this.element.querySelectorAll<HTMLElement>('[data-action^="throttle"]')) button.hidden = kind !== 'jet'
    const special = this.element.querySelector<HTMLButtonElement>('[data-action="special"]')
    if (special) { special.textContent = kind === 'jet' ? 'MODE' : 'WINGS'; special.hidden = kind === 'hovercraft' }
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
    const cord = Boolean(this.gear?.attached())
    for (const action of ['letOut', 'letGo']) { const button = this.element.querySelector<HTMLElement>(`[data-action="${action}"]`); if (button && button.hidden === cord) button.hidden = !cord }
    this.element.querySelector('[data-action="special"]')?.setAttribute('aria-pressed', String(this.input.state.special))
    this.element.querySelector('[data-action="zorb"]')?.setAttribute('aria-pressed', String(this.input.state.zorb))
  }
  /** Pulse one button, to go with a hint that names it. Null clears it. */
  highlight(action: string | null): void {
    for (const button of this.element.querySelectorAll<HTMLElement>('button')) button.classList.toggle('is-hinted', button.dataset.action === action)
  }
  private reset(): void { for (const reset of this.resetters) reset() }
  dispose(): void { this.reset(); this.abort.abort(); this.element.remove() }
}

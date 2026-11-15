import type { VehicleKind } from '../vehicles'
import type { Input } from '../core/Input'

/** Each control owns its pointer so driving and firing can happen simultaneously. */
export class TouchControls {
  readonly element = document.createElement('div')
  private readonly abort = new AbortController()
  private readonly resetters: (() => void)[] = []
  private active = false
  readonly available = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches

  constructor(private readonly input: Input, parent: HTMLElement = document.body) {
    this.element.className = 'touch-controls'
    this.element.setAttribute('aria-label', 'Touch driving controls')
    this.element.hidden = true
    if (!this.available) return
    this.element.innerHTML = `<div class="touch-stick" role="group" aria-label="Drag to steer and drive"><span class="touch-knob"></span><span class="touch-stick-label">DRIVE</span></div><div class="touch-actions"><button type="button" data-action="throttleUp" hidden>THR +</button><button type="button" data-action="throttleDown" hidden>THR −</button><button type="button" data-action="special" aria-pressed="false">WINGS</button><button type="button" data-action="brakes">BRAKE</button><button type="button" data-action="zorb" aria-pressed="false">ZORB</button><button type="button" class="touch-fire" data-action="fire">TAG</button></div>`
    parent.append(this.element)
    const signal = this.abort.signal
    const stick = this.element.querySelector<HTMLElement>('.touch-stick')!
    const knob = stick.querySelector<HTMLElement>('.touch-knob')!
    let pointer: number | null = null
    const reset = () => { pointer = null; input.external.x = 0; input.external.y = 0; knob.style.transform = '' }
    this.resetters.push(reset)
    const move = (event: PointerEvent) => {
      const rect = stick.getBoundingClientRect(), radius = rect.width * 0.34
      let x = (event.clientX - rect.left - rect.width / 2) / radius
      let y = (event.clientY - rect.top - rect.height / 2) / radius
      const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length
      input.external.x = Math.abs(x) < 0.08 ? 0 : x
      input.external.y = Math.abs(y) < 0.08 ? 0 : -y
      knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`
    }
    stick.addEventListener('pointerdown', (event) => {
      if (!this.active || input.suspended || pointer !== null) return
      event.preventDefault(); pointer = event.pointerId; stick.setPointerCapture(pointer); move(event)
    }, { signal })
    stick.addEventListener('pointermove', (event) => { if (event.pointerId === pointer) move(event) }, { signal })
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      stick.addEventListener(name, (event) => { if (event.pointerId === pointer) reset() }, { signal })
    }
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('button')) {
      const action = button.dataset.action as 'brakes' | 'special' | 'fire' | 'throttleUp' | 'throttleDown' | 'zorb'
      const pointers = new Set<number>()
      const throttle = action === 'throttleUp' || action === 'throttleDown'
      const release = () => { pointers.clear(); if (throttle) { this.thrust.delete(action); this.syncThrust() } else if (action !== 'special' && action !== 'zorb') input.external[action] = false; button.classList.remove('held') }
      this.resetters.push(release)
      button.addEventListener('pointerdown', (event) => {
        if (!this.active || input.suspended) return
        event.preventDefault(); button.setPointerCapture(event.pointerId); pointers.add(event.pointerId)
        if (action === 'special') input.state.special = !input.state.special
        // Zorb mode, the X key: ride inside a ball. A toggle, like the wings.
        else if (action === 'zorb') input.toggleZorb()
        else if (throttle) { this.thrust.add(action); this.syncThrust() }
        else input.external[action] = true
        button.classList.add('held'); this.update()
      }, { signal })
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(name, (event) => { pointers.delete(event.pointerId); if (!pointers.size) release() }, { signal })
      }
    }
    window.addEventListener('blur', () => this.reset(), { signal })
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset() }, { signal })
    this.element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal })
  }
  private readonly thrust = new Set<string>()
  private syncThrust(): void { this.input.external.z = Number(this.thrust.has('throttleUp')) - Number(this.thrust.has('throttleDown')) }
  setVehicleKind(kind: VehicleKind): void {
    this.reset()
    for (const button of this.element.querySelectorAll<HTMLElement>('[data-action^="throttle"]')) button.hidden = kind !== 'jet'
    const special = this.element.querySelector<HTMLButtonElement>('[data-action="special"]')
    if (special) { special.textContent = kind === 'jet' ? 'MODE' : 'WINGS'; special.hidden = kind === 'hovercraft' }
    const label = this.element.querySelector('.touch-stick-label')
    if (label) label.textContent = kind === 'jet' ? 'FLIGHT' : 'DRIVE'
  }
  set enabled(value: boolean) {
    this.active = value; this.element.hidden = !value || !this.available
    if (!value) this.reset()
  }
  update(): void {
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

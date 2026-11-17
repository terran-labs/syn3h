/**
 * The vehicle's accessory controls: one row per optional state of the vehicle being driven
 * (src/vehicles/accessories.ts), each with its key cap, its name and its state, switched by
 * the key, a click or a tap. Part of the HUD's left column (hud-column.css), drawn by light
 * like the gear selector above it: no backgrounds, hairlines, tracked small capitals, on
 * bright and off quiet.
 *
 * `update()` runs every frame. It rebuilds rows only when the vehicle kind changes and
 * touches the DOM only when a state changes; otherwise it allocates and writes nothing.
 */
import type { Input } from '../core/Input'
import { type Accessory, type AccessoryVehicle, accessoriesOf, newAccessoryState } from '../vehicles/accessories'

interface Row {
  readonly accessory: Accessory
  readonly button: HTMLButtonElement
  readonly value: HTMLElement
  on: boolean
  shown: string
  unavailable: string
  moving: number
}

/** How long the column stays awake after a change, in milliseconds. */
const WAKE_MS = 2600

export class AccessoryControls {
  readonly element = document.createElement('div')
  private kind = ''
  private rows: Row[] = []
  private readonly state = newAccessoryState()
  private awakeUntil = 0
  private awake = false

  constructor(parent: HTMLElement, private readonly input: Input, private readonly onToggle?: () => void, signal?: AbortSignal) {
    this.element.className = 'hud-accessories'
    this.element.setAttribute('role', 'group'); this.element.setAttribute('aria-label', 'Vehicle accessories')
    this.element.addEventListener('pointerenter', () => this.wake(), { signal })
    parent.append(this.element)
  }

  /** Rows for a vehicle kind. Allocates; runs only when the kind changes. */
  private build(kind: string): void {
    this.kind = kind
    this.element.replaceChildren()
    this.rows = accessoriesOf(kind).map((accessory) => {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'acc-row'; button.dataset.id = accessory.id
      button.setAttribute('aria-pressed', 'false'); button.title = accessory.title
      button.innerHTML = `<kbd>${accessory.cap}</kbd><span class="acc-name">${accessory.name}</span><span class="acc-value"></span><i class="acc-pip" aria-hidden="true"></i>`
      const row: Row = { accessory, button, value: button.querySelector('.acc-value')!, on: false, shown: '', unavailable: '', moving: -2 }
      button.addEventListener('click', () => {
        this.wake()
        if (!row.unavailable) { accessory.toggle(this.input); this.onToggle?.() }
        button.blur()
      })
      this.element.append(button)
      return row
    })
    this.element.dataset.count = String(this.rows.length)
    // The column above stacks on this count (hud-column.css, --acc-rows).
    this.element.parentElement?.style.setProperty('--acc-rows', String(this.rows.length))
  }

  /** Show the column at full strength for a moment: after a change, or while pointed at. */
  wake(now = performance.now()): void { this.awakeUntil = now + WAKE_MS }

  update(vehicle: AccessoryVehicle | null, now = performance.now()): void {
    if (!vehicle) return
    if (vehicle.kind !== this.kind) this.build(vehicle.kind)
    for (const row of this.rows) {
      const s = row.accessory.read(vehicle, this.input.state, this.state)
      // Wings move for about a second: a coarse step keeps the writes to a few.
      const moving = s.moving < 0 ? -1 : Math.round(s.moving * 10) / 10
      if (s.on === row.on && s.value === row.shown && s.unavailable === row.unavailable && moving === row.moving) continue
      if (s.on !== row.on || s.unavailable !== row.unavailable) this.wake(now)
      row.on = s.on; row.shown = s.value; row.unavailable = s.unavailable; row.moving = moving
      row.button.setAttribute('aria-pressed', String(s.on))
      row.button.classList.toggle('is-on', s.on)
      row.button.classList.toggle('is-moving', moving >= 0)
      row.button.style.setProperty('--acc-moving', String(Math.max(0, moving)))
      row.button.setAttribute('aria-disabled', String(Boolean(s.unavailable)))
      row.value.textContent = s.unavailable || s.value
      row.button.title = s.unavailable ? `${row.accessory.title} ${row.accessory.reasons?.[s.unavailable] ?? s.unavailable}` : row.accessory.title
    }
    const awake = now < this.awakeUntil || this.element.matches(':hover')
    if (awake !== this.awake) { this.awake = awake; this.element.classList.toggle('is-awake', awake) }
  }

  dispose(): void { this.element.remove() }
}

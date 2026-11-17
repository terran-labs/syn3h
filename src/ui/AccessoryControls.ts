/**
 * The vehicle's accessory controls: one row per optional state of the vehicle being driven
 * (src/vehicles/accessories.ts), each with its key cap, its name and its state, switched by
 * the key, a click or a tap. Part of the HUD's left column (hud-column.css), drawn by light
 * like the gear selector above it: no backgrounds, hairlines, tracked small capitals. State is
 * shown by the row's node on the spine and its brightness, never in words on screen; the
 * words are in its accessible name and its tooltip (the HUD's own, .wi-tooltip).
 *
 * `update()` runs every frame. It rebuilds rows only when the vehicle kind changes and
 * touches the DOM only when a state changes; otherwise it allocates and writes nothing.
 */
import type { Input } from '../core/Input'
import { type Accessory, type AccessoryVehicle, accessoriesOf, newAccessoryState } from '../vehicles/accessories'

interface Row {
  readonly accessory: Accessory
  readonly button: HTMLButtonElement
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
  /** One tooltip for every row, in the HUD's tooltip style, opening upward beside the row. */
  private readonly tip = document.createElement('div')
  private tipTimer: ReturnType<typeof setTimeout> | undefined
  private tipRow: Row | null = null

  constructor(parent: HTMLElement, private readonly input: Input, private readonly onToggle?: () => void, signal?: AbortSignal) {
    this.element.className = 'hud-accessories'
    this.element.setAttribute('role', 'group'); this.element.setAttribute('aria-label', 'Vehicle accessories')
    this.element.addEventListener('pointerenter', () => this.wake(), { signal })
    this.tip.className = 'wi-glass wi-tooltip hud-column-tip'; this.tip.setAttribute('role', 'tooltip'); this.tip.hidden = true
    this.tip.innerHTML = '<strong></strong><p></p>'
    parent.append(this.element, this.tip)
  }

  /** Rows for a vehicle kind. Allocates; runs only when the kind changes. */
  private build(kind: string): void {
    this.kind = kind
    this.element.replaceChildren()
    this.rows = accessoriesOf(kind).map((accessory) => {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'acc-row'; button.dataset.id = accessory.id
      button.setAttribute('aria-pressed', 'false')
      button.innerHTML = `<kbd aria-hidden="true">${accessory.cap}</kbd><span class="acc-name" aria-hidden="true">${accessory.name}</span><i class="acc-pip" aria-hidden="true"></i>`
      const row: Row = { accessory, button, on: false, shown: '', unavailable: '', moving: -2 }
      button.addEventListener('click', () => {
        this.wake()
        if (!row.unavailable) { accessory.toggle(this.input); this.onToggle?.() }
        button.blur()
      })
      button.addEventListener('pointerenter', () => this.showTip(row, 450))
      button.addEventListener('focus', () => this.showTip(row, 0))
      for (const type of ['pointerleave', 'blur', 'pointerdown'] as const) button.addEventListener(type, () => this.hideTip())
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
      row.button.setAttribute('aria-label', `${row.accessory.name}: ${s.unavailable ? this.reason(row) : s.value}. Key ${row.accessory.cap}.`)
      if (this.tipRow === row && !this.tip.hidden) this.fillTip(row)
    }
    const awake = now < this.awakeUntil || this.element.matches(':hover')
    if (awake !== this.awake) { this.awake = awake; this.element.classList.toggle('is-awake', awake) }
  }

  private reason(row: Row): string { return row.accessory.reasons?.[row.unavailable] ?? row.unavailable }
  private fillTip(row: Row): void {
    this.tip.firstElementChild!.textContent = `${row.accessory.name} · ${row.unavailable ? row.unavailable : row.shown}`
    this.tip.lastElementChild!.textContent = row.unavailable ? `${this.reason(row)} ${row.accessory.title}` : row.accessory.title
  }
  /** Beside the row, its bottom on the row's bottom, so it grows upward and never covers chat below. */
  private showTip(row: Row, delay: number): void {
    clearTimeout(this.tipTimer)
    this.tipTimer = setTimeout(() => {
      this.tipRow = row; this.fillTip(row)
      const box = row.button.getBoundingClientRect()
      this.tip.style.left = `${Math.round(box.right + 12)}px`; this.tip.style.top = 'auto'
      this.tip.style.bottom = `${Math.round(innerHeight - box.bottom)}px`
      this.tip.hidden = false
    }, delay)
  }
  private hideTip(): void { clearTimeout(this.tipTimer); this.tip.hidden = true; this.tipRow = null }

  dispose(): void { this.hideTip(); this.element.remove(); this.tip.remove() }
}
